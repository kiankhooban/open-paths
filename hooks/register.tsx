import type { EngineInterface, Register } from 'claude-code'

import { actionFor, describe, terminalHref } from './openers'
import type { Action, Kind, Platform } from './openers'
import { applyEdits, blockRows, findBlocks, findRefs, homeOf, hrefOf, isWindowsPath, linkOf, linkRow, resolvePath, shortLabel } from './paths'
import type { Ctx, Item, Ref } from './paths'
import { command, DEFAULTS, prefsOf } from './prefs'
import type { Prefs } from './prefs'
import { recall, remember } from './touched'
import type { Touched } from './touched'

/** How long a lookup is trusted: a file that exists rarely vanishes, a missing one may appear soon. */
const HIT_MS = 60_000
const MISS_MS = 5_000
/** Lookups one drawing may start; the rest wait for the next drawing. */
const MAX_PROBES = 64
const MAX_CACHE = 2000
/** A stat that has not answered by then counts as missing, so a stalled mount never holds up a reply. */
const STAT_TIMEOUT_MS = 300
/** Tool calls whose file is remembered, and which tool rows get an open line under each setting. */
const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const ROW_TOOLS = { write: new Set(['Write']), all: FILE_TOOLS, off: new Set<string>() }

/** What a path is and where it really lands, every symlink followed; null when missing or refused. */
type Found = { kind: Kind; real: string }
const cache = new Map<string, { found: Found | null; at: number }>()
let prefs: Prefs = DEFAULTS
let touched: Touched = {}
let home: string | undefined
let platform: Platform | undefined
/** The touched index is saved one write at a time, so an older snapshot never lands after a newer one. */
let saving: Promise<unknown> = Promise.resolve()

/** Opening a network path can hand credentials to the host it names, whatever spelling led there. */
const isNetwork = (real: string) => /^(\/\/|\\\\)|^\/(net|Network)(\/|$)/.test(real)

async function statOf($: EngineInterface, abs: string): Promise<Found | null> {
  let timer: { cancel(): void } | undefined
  const late = new Promise<undefined>(done => {
    timer = $.clock.after(STAT_TIMEOUT_MS, () => done(undefined))
  })
  const st = await Promise.race([$.fs.stat(abs, { resolve: true }).catch(() => undefined), late])
  timer?.cancel()
  const kind = st?.kind === 'file' ? 'file' : st?.kind === 'dir' ? 'dir' : null
  const real = st?.realPath?.replace(/\\/g, '/')
  return kind && real && !isNetwork(real) ? { kind, real } : null
}

async function lookUp($: EngineInterface, paths: string[]): Promise<void> {
  const now = await $.clock.now()
  const stale = paths.filter(p => {
    const c = cache.get(p)
    return !c || now - c.at > (c.found ? HIT_MS : MISS_MS)
  })
  await Promise.all(
    stale.slice(0, MAX_PROBES).map(async p => {
      const found = await statOf($, p)
      cache.delete(p) // re-inserted last, so eviction takes the oldest lookups
      cache.set(p, { found, at: now })
    }),
  )
  if (cache.size > MAX_CACHE) for (const k of [...cache.keys()].slice(0, cache.size - MAX_CACHE)) cache.delete(k)
}

// The home folder comes from where the mod is installed, not from any variable.
async function ctxOf($: EngineInterface): Promise<Ctx> {
  const cwd = await $.session.cwd().catch(() => undefined)
  if (home === undefined) home = homeOf($.plugin.root, cwd) ?? ''
  return { home: home || undefined, cwd }
}

/**
 * The system the session runs on, or undefined when it cannot be told: then nothing is opened, since a
 * guess is unsafe (`open` on Debian is openvt, which runs the file). A failed check is tried again.
 */
async function platformOf($: EngineInterface): Promise<Platform | undefined> {
  if (platform) return platform
  if (isWindowsPath($.plugin.root) || isWindowsPath(await $.session.cwd().catch(() => undefined))) return (platform = 'windows')
  const r = await $.process.run(['uname', '-sr'], { timeoutMs: 3000 }).catch(() => undefined)
  const s = r?.exitCode === 0 ? r.stdout : ''
  if (/^Darwin/.test(s)) return (platform = 'mac')
  if (/^Linux/.test(s)) return (platform = /microsoft/i.test(s) ? 'wsl' : 'linux')
  return undefined
}

/** Each written path's real path and kind: as written first, else the newest touched file it may mean. */
async function resolveAll($: EngineInterface, refs: Ref[]): Promise<Map<Ref, { abs: string; kind: Kind }>> {
  const ctx = await ctxOf($)
  const tries = refs.map(ref => {
    const first = resolvePath(ref.path, ctx)
    return { ref, cands: [...(first ? [first] : []), ...recall(touched, ref.path)] }
  })
  await lookUp($, [...new Set(tries.flatMap(t => t.cands))])
  const out = new Map<Ref, { abs: string; kind: Kind }>()
  for (const { ref, cands } of tries) {
    const hit = cands.map(c => cache.get(c)?.found).find(Boolean)
    if (hit) out.set(ref, { abs: hit.real, kind: hit.kind })
  }
  return out
}

/** The file and line a link of ours points at. */
export function targetOf(href: string): { abs: string; line?: number; col?: number } | undefined {
  const m = /^file:\/\/([^#]*)(?:#L(\d+)(?::(\d+))?)?$/.exec(href)
  if (!m) return undefined
  try {
    const abs = decodeURIComponent(m[1]!).replace(/^\/([A-Za-z]:\/)/, '$1')
    return { abs, line: m[2] ? Number(m[2]) : undefined, col: m[3] ? Number(m[3]) : undefined }
  } catch {
    return undefined
  }
}

async function run($: EngineInterface, action: Action, abs: string): Promise<boolean> {
  if (action.how === 'refuse') return false
  let argv = action.argv
  let fallback = action.fallback
  if (action.windowsPath) {
    const w = await $.process.run(['wslpath', '-w', abs], { timeoutMs: 3000 }).catch(() => undefined)
    const win = w?.exitCode === 0 ? w.stdout.trim() : undefined
    if (!win) {
      $.ui.toast('open-paths: could not translate the path for Windows')
      return false
    }
    // A function replacer: a `$&` or `$1` in a Windows path is text, not a pattern.
    argv = argv.map(a => a.replace(abs, () => win))
    fallback = fallback?.map(a => a.replace(abs, () => win))
  }
  const tryRun = (cmd: string[]) =>
    $.process.run(cmd, { timeoutMs: 10_000 }).catch((err: unknown) => ({ exitCode: -1, stdout: '', stderr: String(err) }))
  let res = await tryRun(argv)
  if (res.exitCode !== 0 && fallback) res = await tryRun(fallback)
  if (res.exitCode !== 0) $.ui.toast(`open-paths: could not open it (${res.stderr.trim().slice(0, 120) || `exit ${res.exitCode}`})`)
  return res.exitCode === 0
}

/** A click on one of our links: the file opens in its app, never a Finder reveal (unless it is a launcher). */
export async function openHref($: EngineInterface, href: string): Promise<void> {
  const t = targetOf(href)
  if (!t) return
  const found = await statOf($, t.abs)
  if (!found) {
    $.ui.toast(`open-paths: could not find ${t.abs}`)
    return
  }
  const plat = await platformOf($)
  if (!plat) {
    $.ui.toast('open-paths: could not tell which system this is, so nothing was opened')
    return
  }
  // Classified and opened by where it really lands: a link named report.pdf may lead to an app.
  const action = actionFor(found.real, found.kind, prefs, plat, t.line, t.col)
  if (prefs.toast || action.how === 'refuse') $.ui.toast(describe(action, found.real, t.line))
  await run($, action, found.real)
}

const itemOf = (ref: Ref, abs: string): Item => ({ ref, href: hrefOf(abs, ref.line, ref.col) })

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    prefs = prefsOf(options, await $.store.get('prefs').catch(() => undefined))
    const t = await $.store.get('touched').catch(() => undefined)
    touched = t && typeof t === 'object' ? Object.assign(Object.create(null) as Touched, t) : Object.create(null)
    await $.command.register({
      name: 'open-paths',
      description: 'open-paths: click a path, the file opens in its app (/open-paths help)',
      argumentHint: '[setting] [value]   (/open-paths help lists them)',
      immediate: true,
    })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'open-paths' }, async ($, e) => {
    const res = command(prefs, e.args)
    if (res.prefs) {
      prefs = res.prefs
      await $.store.set('prefs', prefs).catch(() => undefined)
      $.ui.invalidate('ui.render')
    }
    return { text: res.text }
  })

  // Remember the files Claude's tools touch, so a bare name in a later reply finds them.
  on('tool.call', async ($, e, next) => {
    const done = await next(e)
    const input = e as { tool?: unknown; file_path?: unknown; notebook_path?: unknown }
    const file = typeof input.file_path === 'string' ? input.file_path : input.notebook_path
    const abs = typeof file === 'string' ? resolvePath(file, await ctxOf($)) : undefined
    if (FILE_TOOLS.has(String(input.tool)) && abs && done.deny === undefined && !done.isError) {
      touched = remember(touched, abs)
      const snapshot = touched
      saving = saving.then(() => $.store.set('touched', snapshot)).catch(() => undefined)
      // A reply drawn before the file existed cached a miss: forget it and draw again.
      if (cache.get(abs)?.found === null) {
        cache.delete(abs)
        $.ui.invalidate('ui.render')
      }
    }
    return done
  }).catch(($, e, next) => next(e))

  // The stored reply stays as written; only its drawing carries the links.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (prefs.mode === 'off' || e.surface !== 'terminal' || e.props.isSummary) return next(e)
    const text = e.props.text
    const refs = findRefs(text)
    const blocks = findBlocks(text)
    if (refs.length === 0 && blocks.length === 0) return next(e)

    const found = await resolveAll($, [...refs, ...blocks.flatMap(b => b.refs)])
    const items = refs.flatMap(r => (found.has(r) ? [itemOf(r, found.get(r)!.abs)] : []))
    const blockItems = blocks.map(b => ({ end: b.end, items: b.refs.flatMap(r => (found.has(r) ? [itemOf(r, found.get(r)!.abs)] : [])) }))
    const all = [...items, ...blockItems.flatMap(b => b.items)]
    if (all.length === 0) return next(e)

    const { Box, Text, Markdown, Link } = $.ui.resolve(e)
    const drawn = await next(e)

    // The classic renderer reports no clicks: the terminal follows the link itself.
    if (e.viewport?.isFullscreen === false) {
      const plat = await platformOf($)
      const links = all.flatMap(it => {
        const f = found.get(it.ref)!
        const href = plat && terminalHref(f.abs, f.kind, prefs, it.href, plat, it.ref.line, it.ref.col)
        return href ? [{ href, label: shortLabel(it, false).replace(/\\(.)/g, '$1') }] : []
      })
      if (links.length === 0) return drawn
      return (
        <Box flexDirection="column">
          {drawn}
          <Box paddingLeft={2}>
            <Text dimColor>
              {'↳ open  '}
              {links.slice(0, 12).flatMap((l, i) => [i ? ' · ' : '', <Link key={`l${i}`} href={l.href}>{l.label}</Link>])}
            </Text>
          </Box>
        </Box>
      )
    }

    const hrefs = [...new Set(all.map(i => i.href))].slice(0, 256)
    const press = (link: { href: string }) => void openHref($, link.href)
    const own = prefs.mode === 'inline' || (prefs.mode === 'auto' && drawn.type === 'engine')
    if (own) {
      const edits = [...items.map(it => ({ start: it.ref.start, end: it.ref.end, text: linkOf(it) })), ...blockRows(text, blockItems)]
      // The engine's own reply row: a blank line above and a "● " gutter on a reply's first block.
      return (
        <Box flexDirection="row" marginTop={1}>
          <Box width={2} flexShrink={0}>
            <Text>{e.props.isFirstOfReply ? '●' : ' '}</Text>
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            <Markdown key="open-paths" text={applyEdits(text, edits)} pressableLinks={hrefs} onLinkPress={press} />
          </Box>
        </Box>
      )
    }
    // Another mod drew the reply: keep its drawing whole, the links in a row beneath it.
    return (
      <Box flexDirection="column">
        {drawn}
        <Box paddingLeft={2}>
          <Markdown key="open-paths" dimColor text={linkRow(all)} pressableLinks={hrefs} onLinkPress={press} />
        </Box>
      </Box>
    )
  }).catch(($, e, next) => next(e)) // never in the way of a reply

  // A Write (or Read/Write/Edit) row: the engine's row, with a line under it that opens the file.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const input = e.props.input as { file_path?: unknown; notebook_path?: unknown } | null
    const file = typeof input?.file_path === 'string' ? input.file_path : input?.notebook_path
    if (prefs.mode === 'off' || e.surface !== 'terminal' || !ROW_TOOLS[prefs.toolRows].has(e.props.tool)) return next(e)
    if (typeof file !== 'string' || e.props.isRunning || e.props.isErrored || e.props.isInterrupted) return next(e)
    const abs = resolvePath(file, await ctxOf($))
    if (!abs) return next(e)
    await lookUp($, [abs])
    const found = cache.get(abs)?.found
    if (!found) return next(e)
    const { Box, Text, Markdown, Link } = $.ui.resolve(e)
    const drawn = await next(e)
    const ref: Ref = { start: 0, end: 0, label: abs, path: abs, code: false }
    const item = itemOf(ref, found.real)
    const name = shortLabel(item, false)
    if (e.viewport?.isFullscreen === false) {
      const plat = await platformOf($)
      const href = plat && terminalHref(found.real, found.kind, prefs, item.href, plat)
      if (!href) return drawn
      return (
        <Box flexDirection="column">
          {drawn}
          <Box paddingLeft={2}>
            <Text dimColor>
              {'⎿  open '}
              <Link href={href}>{name.replace(/\\(.)/g, '$1')}</Link>
            </Text>
          </Box>
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {drawn}
        <Box paddingLeft={2}>
          <Markdown key="open-paths-tool" dimColor text={`⎿  open [${name}](${item.href})`} pressableLinks={[item.href]} onLinkPress={link => void openHref($, link.href)} />
        </Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))
}

// Finding file paths in a reply's markdown and turning the ones that exist into links.
// Pure: no engine calls, so the tests can pin every rule.

export type Ctx = { home?: string; cwd?: string }

/** One path written in the text: where it sits, what was written, and the line it points at. */
export type Ref = {
  start: number
  end: number
  /** The text as written, backticks and :line included: what the link draws. */
  label: string
  /** The path alone, as written (`~/x`, `src/a.ts`), no :line. */
  path: string
  line?: number
  col?: number
  /** Written inside backticks. */
  code: boolean
}

// Any indentation and quote markers: a fence nested in a list item or a blockquote is still code.
const FENCE = /^[ \t]*(?:>[ \t]*)*(`{3,}|~{3,})/
// Markdown links, autolinks and bare URLs: never touched.
const MASK = /\[[^\]\n]*\]\([^)\n]*\)|<[a-z][a-z0-9+.-]*:[^>\s]*>|\b[a-z][a-z0-9+.-]*:\/\/[^\s<>()]+/gi
const CODE = /`([^`\n]+)`/g
// A run of characters a path can hold outside backticks; spaces and brackets end it.
const TOKEN = /[^\s`'"<>()[\]{}|,;]+/g
// `:42`, `:42:7`, and a range `:10-20` (its first line).
const LINE = /^(.*?)(?::(\d+)(?:-\d+|:(\d+))?)?$/
const BARE_NAME = /^[\w@+-][\w.@+-]*\.([A-Za-z][A-Za-z0-9]{0,9})$/
const NOT_NAMES = new Set(['e.g', 'i.e', 'a.k.a', 'p.s', 'vs', 'etc'])
/** A Windows absolute path: `C:\\Users\\me` or `C:/Users/me`. */
const DRIVE = /^[A-Za-z]:[\\/]/

/** Whether written text looks like a path: has a slash, starts at home, or is a name with an extension. */
function isPathy(s: string, allowSpaces: boolean): boolean {
  if (!s || s.length > 1024 || s.includes('://') || s.startsWith('-')) return false
  if (/\s/.test(s) && !allowSpaces) return false
  if (s === '~' || s.startsWith('~/') || DRIVE.test(s)) return true
  if (s.includes('/')) return !/^[\d/.:-]+$/.test(s) && /[^/.]/.test(s)
  // In backticks a name may hold spaces (`My Notes.docx`); the existence check weeds out commands.
  const m = BARE_NAME.exec(allowSpaces ? s.replace(/ /g, '_') : s)
  if (!m) return false
  const name = s.slice(0, -m[1]!.length - 1)
  return !/^[\d.]+$/.test(name) && !NOT_NAMES.has(s.toLowerCase())
}

function splitLine(written: string): { path: string; line?: number; col?: number } {
  const m = LINE.exec(written)!
  const path = m[1]!
  if (m[2] === undefined || !path) return { path: written }
  return { path, line: Number(m[2]), col: m[3] === undefined ? undefined : Number(m[3]) }
}

function lineRefs(text: string, offset: number, out: Ref[]): void {
  const masked: [number, number][] = []
  for (const m of text.matchAll(MASK)) masked.push([m.index, m.index + m[0].length])
  const isMasked = (s: number, e: number) => masked.some(([a, b]) => s < b && e > a)

  for (const m of text.matchAll(CODE)) {
    const s = m.index
    const e = s + m[0].length
    if (isMasked(s, e)) continue
    masked.push([s, e])
    const inner = m[1]!.trim()
    const { path, line, col } = splitLine(inner)
    if (isPathy(path, true)) out.push({ start: offset + s, end: offset + e, label: m[0], path, line, col, code: true })
  }

  for (const m of text.matchAll(TOKEN)) {
    let s = m.index
    let tok = m[0]
    const lead = /^\*+/.exec(tok)?.[0].length ?? 0
    s += lead
    tok = tok.slice(lead).replace(/[*.,:;!?]+$/, '')
    if (!tok || isMasked(s, s + tok.length)) continue
    const { path, line, col } = splitLine(tok)
    if (isPathy(path, false)) out.push({ start: offset + s, end: offset + s + tok.length, label: tok, path, line, col, code: false })
  }
}

/** A closed fenced code block's paths, and where the block ends (just past its closing fence line). */
export type Block = { end: number; refs: Ref[] }

function scan(text: string): { refs: Ref[]; blocks: Block[] } {
  const refs: Ref[] = []
  const blocks: Block[] = []
  let fence: { mark: string; refs: Ref[] } | undefined
  let offset = 0
  for (const line of text.split('\n')) {
    const f = FENCE.exec(line)?.[1]
    if (fence) {
      if (f && f[0] === fence.mark[0] && f.length >= fence.mark.length && line.replace(/^[ \t]*(?:>[ \t]*)*/, '').trim() === f) {
        if (fence.refs.length) blocks.push({ end: Math.min(text.length, offset + line.length + 1), refs: fence.refs })
        fence = undefined
      } else {
        lineRefs(line, offset, fence.refs)
      }
    } else if (f) {
      fence = { mark: f, refs: [] }
    } else {
      lineRefs(line, offset, refs)
    }
    offset += line.length + 1
  }
  // A block still open (a reply streaming in) gives nothing yet.
  return { refs: refs.sort((a, b) => a.start - b.start), blocks }
}

/** Every path written in the markdown, outside fenced code, links and URLs, in order. */
export function findRefs(text: string): Ref[] {
  return scan(text).refs
}

/** The paths written inside each closed fenced code block, the block left as written. */
export function findBlocks(text: string): Block[] {
  return scan(text).blocks
}

/**
 * The home folder, found without reading the environment: an installed mod lives under
 * `<home>/.claude/`, else the working directory sits under `/Users/<name>`, `/home/<name>`
 * or `C:/Users/<name>`. Undefined when neither says, and then `~` paths are not linked.
 */
export function homeOf(pluginRoot: string | undefined, cwd: string | undefined): string | undefined {
  const fwd = (p?: string) => p?.replace(/\\/g, '/')
  const root = fwd(pluginRoot)
  const at = root?.indexOf('/.claude/') ?? -1
  if (root && at > 0) return root.slice(0, at)
  const m = /^(\/Users\/[^/]+|\/home\/[^/]+|\/root|[A-Za-z]:\/Users\/[^/]+)(?=\/|$)/.exec(fwd(cwd) ?? '')
  return m?.[1]
}

/** True for a Windows path (`C:\\…` or `C:/…`). */
export const isWindowsPath = (p: string | undefined) => !!p && /^[A-Za-z]:[\\/]/.test(p)

/** The absolute path a written path names, or undefined when it cannot be resolved or is a network path. */
export function resolvePath(p: string, ctx: Ctx): string | undefined {
  if (p.includes('\0')) return undefined
  let abs: string
  if (DRIVE.test(p)) {
    abs = p
  } else if (p === '~' || p.startsWith('~/')) {
    if (!ctx.home) return undefined
    abs = ctx.home + p.slice(1)
  } else if (p.startsWith('/')) {
    if (p.startsWith('//')) return undefined
    abs = p
  } else {
    if (!ctx.cwd) return undefined
    abs = `${ctx.cwd}/${p}`
  }
  abs = abs.replace(/\\/g, '/')
  let root = '/'
  if (DRIVE.test(abs)) {
    root = `${abs[0]!.toUpperCase()}:/`
    abs = abs.slice(3)
  } else if (abs.startsWith('//')) {
    return undefined
  }
  const segs: string[] = []
  for (const seg of abs.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') segs.pop()
    else segs.push(seg)
  }
  const norm = root + segs.join('/')
  // Opening a network path can hand credentials to the host it names.
  if (/^\/(net|Network)(\/|$)/.test(norm)) return undefined
  return norm
}

const encodeSeg = (s: string) => encodeURIComponent(s).replace(/[()]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/** A file: URL for the path, the line in its fragment. The mod answers the click, so the URL is its key. */
export function hrefOf(abs: string, line?: number, col?: number): string {
  const frag = line === undefined ? '' : `#L${line}${col === undefined ? '' : `:${col}`}`
  const path = abs.split('/').map(encodeSeg).join('/').replace(/^([A-Za-z])%3A/, '/$1:')
  return `file://${path}${frag}`
}

export const escapeMd = (s: string) => s.replace(/[\\`*_[\]<>~]/g, c => `\\${c}`)

export type Edit = { start: number; end: number; text: string }
export type Item = { ref: Ref; href: string }

/** Applies non-overlapping edits, each against the original offsets. */
export function applyEdits(text: string, edits: Edit[]): string {
  let out = text
  for (const ed of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) out = out.slice(0, ed.start) + ed.text + out.slice(ed.end)
  return out
}

/** A markdown link to the item, its label as written. */
export const linkOf = ({ ref, href }: Item) => `[${ref.code ? ref.label : escapeMd(ref.label)}](${href})`

/** The short name an item goes by in a row of links: the file name and line, or the path as written when names clash. */
export function shortLabel(item: Item, clash: boolean): string {
  const at = item.ref.line === undefined ? '' : `:${item.ref.line}${item.ref.col === undefined ? '' : `:${item.ref.col}`}`
  const name = clash ? item.ref.path : item.ref.path.replace(/\/+$/, '').split('/').pop() || item.ref.path
  return escapeMd(name + at)
}

/** One dim row of links: `↳ open  a.docx · b.py:3`, each item once. */
export function linkRow(items: Item[], max = 12): string {
  const seen = new Map<string, Item>()
  for (const it of items) if (!seen.has(it.href)) seen.set(it.href, it)
  const list = [...seen.values()]
  const names = list.map(it => it.ref.path.replace(/\/+$/, '').split('/').pop())
  const parts = list.slice(0, max).map((it, i) => `[${shortLabel(it, names.filter(n => n === names[i]).length > 1)}](${it.href})`)
  const more = list.length > max ? ` · +${list.length - max} more` : ''
  return `↳ open  ${parts.join(' · ')}${more}`
}

/** The text with each given ref replaced by a markdown link to its href. */
export function linkify(text: string, items: Item[]): string {
  return applyEdits(text, items.map(it => ({ start: it.ref.start, end: it.ref.end, text: linkOf(it) })))
}

/** Edits that put a row of links after each code block that names files. */
export function blockRows(text: string, blocks: { end: number; items: Item[] }[]): Edit[] {
  return blocks
    .filter(b => b.items.length)
    .map(b => {
      const lead = b.end > 0 && text[b.end - 1] !== '\n' ? '\n' : ''
      const tail = b.end < text.length && text[b.end] !== '\n' ? '\n' : ''
      return { start: b.end, end: b.end, text: `${lead}${linkRow(b.items)}\n${tail}` }
    })
}

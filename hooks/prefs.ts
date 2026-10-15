// Settings: defaults, what `/open-paths` changes, and the report it prints. Pure.

import { EDITORS, LOCKED_EXTS } from './openers'
import type { Prefs as OpenPrefs, Target } from './openers'

export type Mode = 'auto' | 'inline' | 'below' | 'off'
export type ToolRows = 'write' | 'all' | 'off'

export type Prefs = OpenPrefs & {
  mode: Mode
  toolRows: ToolRows
  toast: boolean
}

export const DEFAULTS: Prefs = { mode: 'inline', editor: 'vscode', overrides: {}, folders: 'files', toolRows: 'write', toast: true }

const MODES: readonly Mode[] = ['auto', 'inline', 'below', 'off']
const TOOL_ROWS: readonly ToolRows[] = ['write', 'all', 'off']

const isTarget = (v: unknown): v is Target =>
  v === 'editor' || v === 'default' || v === 'reveal' || (typeof v === 'object' && v !== null && typeof (v as { app?: unknown }).app === 'string')

/** The manifest's options under what `/open-paths` stored, each value checked. */
export function prefsOf(options: Record<string, unknown>, stored: unknown): Prefs {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<Record<keyof Prefs, unknown>>
  const editor = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  const overrides: Record<string, Target> = Object.create(null)
  if (s.overrides && typeof s.overrides === 'object')
    for (const [k, v] of Object.entries(s.overrides as Record<string, unknown>)) if (isTarget(v)) overrides[k] = v
  return {
    mode: MODES.includes(s.mode as Mode) ? (s.mode as Mode) : DEFAULTS.mode,
    editor: editor(s.editor) ?? editor(options.editor) ?? DEFAULTS.editor,
    overrides,
    folders: s.folders === 'editor' || s.folders === 'files' ? s.folders : DEFAULTS.folders,
    toolRows: TOOL_ROWS.includes(s.toolRows as ToolRows) ? (s.toolRows as ToolRows) : DEFAULTS.toolRows,
    toast: typeof s.toast === 'boolean' ? s.toast : DEFAULTS.toast,
  }
}

export const HELP = [
  'Commands:',
  '  /open-paths                           this report',
  '  /open-paths mode inline|auto|below|off  links in the reply; auto keeps another mod\'s drawing and adds a row; below always a row; off',
  `  /open-paths editor <name|App Name>    ${Object.keys(EDITORS).join(', ')}, default, or any app`,
  '  /open-paths set <ext> <target>        target: editor, default, reveal, or an app name',
  '  /open-paths unset <ext>               back to the built-in rule for that type',
  '  /open-paths folders files|editor      folders open in the file manager or the editor',
  '  /open-paths tools write|all|off       an open line under Write, or Read/Write/Edit, tool rows',
  '  /open-paths toast on|off              say what is opening',
  '  /open-paths reset                     every setting back to its default',
].join('\n')

const show = (t: Target) => (typeof t === 'object' ? t.app : t)

export function report(p: Prefs): string {
  const ov = Object.entries(p.overrides)
  return [
    `open-paths: mode ${p.mode} · editor ${p.editor} · folders ${p.folders} · tool rows ${p.toolRows} · toast ${p.toast ? 'on' : 'off'}`,
    ov.length ? `overrides: ${ov.map(([k, v]) => `.${k} → ${show(v)}`).join(', ')}` : 'overrides: none',
    '',
    HELP,
  ].join('\n')
}

/** What a `/open-paths` line does: the new settings and what to say, or just what to say. */
export function command(p: Prefs, args: string): { prefs?: Prefs; text: string } {
  const raw = args.trim()
  const [cmd = '', ...rest] = raw.split(/\s+/)
  const arg = rest.join(' ')
  const say = (prefs: Prefs, text: string) => ({ prefs, text: `open-paths: ${text}` })
  const onOff = (v: string, cur: boolean) => (v === 'on' ? true : v === 'off' ? false : !cur)

  switch (cmd.toLowerCase()) {
    case '':
    case 'help':
    case 'status':
      return { text: report(p) }
    case 'mode':
      return MODES.includes(arg as Mode) ? say({ ...p, mode: arg as Mode }, `mode ${arg}`) : { text: `open-paths: mode is one of ${MODES.join(', ')}` }
    case 'auto':
    case 'inline':
    case 'below':
    case 'off':
      return say({ ...p, mode: cmd.toLowerCase() as Mode }, `mode ${cmd.toLowerCase()}`)
    case 'on':
      return say({ ...p, mode: DEFAULTS.mode }, `mode ${DEFAULTS.mode}`)
    case 'editor': {
      if (!arg) return { text: `open-paths: editor ${p.editor}` }
      const key = arg.toLowerCase()
      const editor = key in EDITORS || key === 'default' ? key : arg
      return say({ ...p, editor }, `code and text open in ${EDITORS[editor]?.name ?? editor}`)
    }
    case 'set': {
      const [ext0 = '', ...to] = rest
      const ext = ext0.replace(/^\./, '').toLowerCase()
      const t = to.join(' ')
      if (!ext || !t) return { text: 'open-paths: /open-paths set <ext> <editor|default|reveal|App Name>' }
      const target: Target = ['editor', 'default', 'reveal'].includes(t.toLowerCase()) ? (t.toLowerCase() as Target) : { app: t }
      if (LOCKED_EXTS.has(ext) && (target === 'default' || typeof target === 'object'))
        return { text: `open-paths: .${ext} runs or installs something when opened; it can go to the editor or be revealed, nothing else` }
      return say({ ...p, overrides: { ...p.overrides, [ext]: target } }, `.${ext} → ${show(target)}`)
    }
    case 'unset': {
      const ext = arg.replace(/^\./, '').toLowerCase()
      const { [ext]: _gone, ...overrides } = p.overrides
      return say({ ...p, overrides }, `.${ext} back to the built-in rule`)
    }
    case 'folders':
      return arg === 'files' || arg === 'editor' ? say({ ...p, folders: arg }, `folders open in ${arg === 'files' ? 'the file manager' : 'the editor'}`) : { text: 'open-paths: folders files|editor' }
    case 'tools':
      return TOOL_ROWS.includes(arg as ToolRows) ? say({ ...p, toolRows: arg as ToolRows }, `tool rows ${arg}`) : { text: `open-paths: tools ${TOOL_ROWS.join('|')}` }
    case 'toast': {
      const toast = onOff(arg, p.toast)
      return say({ ...p, toast }, `toast ${toast ? 'on' : 'off'}`)
    }
    case 'reset':
      return say({ ...DEFAULTS }, 'settings reset')
    default:
      return { text: `open-paths: unknown command "${cmd}"\n\n${HELP}` }
  }
}

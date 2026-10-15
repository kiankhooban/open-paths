// What a click on a path runs. Pure: the argv only, run by register.tsx.
//
// The rule is an allow-list. Known document and media types go to the system opener, which picks the
// type's default app (Word, Preview, Excel). Source, text and script files go to the editor: their
// default app can be a runner (Python Launcher, a terminal, Windows Script Host). Everything else is
// revealed in the file manager, never opened: a type not on the lists may launch, install or run.
// Callers classify by the path's real target, so a symlink named report.pdf cannot open an app.

export type Platform = 'mac' | 'linux' | 'windows' | 'wsl'
export type Kind = 'file' | 'dir'
/** What an extension is sent to: the editor, the default app, a reveal, or a named app. */
export type Target = 'editor' | 'default' | 'reveal' | { app: string }

export type Prefs = {
  /** A key of EDITORS, `default` for the system's own choice, or an app name (a command on Linux). */
  editor: string
  /** Extension (lower case, no dot) to where it goes. */
  overrides: Record<string, Target>
  folders: 'files' | 'editor'
}

export type Action = {
  how: 'open' | 'editor' | 'reveal' | 'app' | 'refuse'
  argv: string[]
  fallback?: string[]
  /** WSL: the path in argv is turned into a Windows path (`wslpath -w`) before it runs. */
  windowsPath?: boolean
  /** Who opens it, for the toast: an app or editor name; absent for the default app. */
  by?: string
}

type Editor = {
  name: string
  /** The macOS app. */
  app: string
  /** The command line launcher, which can go to a line. */
  cli: string
  at: (file: string, line: number, col?: number) => string[]
  /** A URL a terminal hands to the editor itself, for terminals the mod gets no click from. */
  url?: (file: string, line?: number, col?: number) => string
}

const colon = (file: string, line: number, col?: number) => `${file}:${line}${col === undefined ? '' : `:${col}`}`
// Each segment encoded whole, so a `#` or `?` in a name cannot cut the URL short; a drive letter stays as it is.
const urlPath = (file: string) =>
  (file.startsWith('/') ? file : `/${file}`).split('/').map((seg, i) => (i === 1 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg))).join('/')
const lc = (line?: number, col?: number) => (line === undefined ? '' : `:${line}${col === undefined ? '' : `:${col}`}`)

export const EDITORS: Record<string, Editor> = {
  vscode: {
    name: 'Visual Studio Code',
    app: 'Visual Studio Code',
    cli: 'code',
    at: (f, l, c) => ['-g', colon(f, l, c)],
    url: (f, l, c) => `vscode://file${urlPath(f)}${lc(l, c)}`,
  },
  cursor: {
    name: 'Cursor',
    app: 'Cursor',
    cli: 'cursor',
    at: (f, l, c) => ['-g', colon(f, l, c)],
    url: (f, l, c) => `cursor://file${urlPath(f)}${lc(l, c)}`,
  },
  zed: { name: 'Zed', app: 'Zed', cli: 'zed', at: (f, l, c) => [colon(f, l, c)] },
  sublime: { name: 'Sublime Text', app: 'Sublime Text', cli: 'subl', at: (f, l, c) => [colon(f, l, c)] },
  idea: {
    name: 'IntelliJ IDEA',
    app: 'IntelliJ IDEA',
    cli: 'idea',
    at: (f, l, c) => ['--line', String(l), ...(c === undefined ? [] : ['--column', String(c)]), f],
  },
}

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean))

/** Documents and media: the only types the system opener is ever handed. */
export const DOC_EXTS = words(`
  docx doc dotx odt rtf pages txt text pdf epub
  xlsx xls csv tsv numbers ods pptx ppt key odp
  png jpg jpeg gif webp heic heif bmp tif tiff svg ico avif psd
  mp3 wav m4a aac flac ogg oga aiff mp4 m4v mov mkv avi webm
  html htm
`)

/** Opened by a terminal or a script host, these run: they go to the editor and nowhere else. */
export const SCRIPT_EXTS = words('sh bash zsh fish ksh csh tcsh command tool ps1 psm1 bat cmd')

export const EDITOR_EXTS = words(`
  py pyi pyw ipynb java kt kts scala groovy gradle c h cc cpp cxx hpp hh hxx m mm swift go rs zig
  js mjs cjs jsx ts mts cts tsx vue svelte astro css scss sass less json jsonc json5 yaml yml toml ini cfg conf
  env properties xml xsd sql graphql gql proto md mdx markdown rst tex bib sty cls r rmd jl lua rb php pl pm
  cs fs fsx vb dart ex exs erl hrl hs elm clj cljs edn ml mli nim v sv vhd vhdl tf hcl nix dockerfile
  makefile cmake mk gitignore gitattributes editorconfig lock log diff patch
`)

/** Known launchers, installers and auto-running types: an override may not send these to an app. */
export const LAUNCHER_EXTS = words(`
  app pkg mpkg dmg iso img terminal workflow action jar exe msi msp mst msix msixbundle appx appxbundle appinstaller
  scpt scptd applescript fileloc inetloc webloc afploc ftploc vncloc mailloc newsloc rdp ica jnlp mobileconfig shortcut
  prefpane saver kext plugin bundle appex xpc service com scr vbs vbe js_ jse ws wsf wsh wsc sct hta reg lnk url cpl msc pif
  chm application appref-ms settingcontent-ms xll scf library-ms search-ms searchconnector-ms theme themepack
  vhd vhdx diagcab gadget inf ins isp pyc pyo pyz pyzw desktop appimage run deb rpm docm dotm xlsm xltm pptm potm
`)

/** Extensions an override may not send to the default app or a named app, since that runs them. */
export const LOCKED_EXTS = new Set([...SCRIPT_EXTS, ...LAUNCHER_EXTS])

/** Characters cmd.exe re-parses, and Explorer's switch separator: a path holding one never reaches either. */
const CMD_UNSAFE = /[&|<>^%!"\r\n,]/

export const extOf = (abs: string) => {
  const name = abs.slice(abs.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** True when some folder on the way holds a launcher extension (a file inside Foo.app/Contents). */
const insideLauncher = (abs: string) => abs.split('/').slice(0, -1).some(seg => LAUNCHER_EXTS.has(extOf(`/${seg}`)))

const parentOf = (abs: string) => abs.slice(0, Math.max(abs.lastIndexOf('/'), 1)) || '/'
const nameOf = (abs: string) => abs.slice(abs.lastIndexOf('/') + 1)
const winPath = (abs: string) => abs.replace(/\//g, '\\')
const refuse = (why: string): Action => ({ how: 'refuse', argv: [], by: why })

function opener(platform: Platform, abs: string): Action {
  switch (platform) {
    case 'mac':
      return { how: 'open', argv: ['open', abs] }
    case 'linux':
      return { how: 'open', argv: ['xdg-open', abs] }
    case 'windows':
      // Explorer opens a document in its app without a shell; cmd.exe would re-parse the name.
      return CMD_UNSAFE.test(abs) ? refuse('its name holds characters Windows would run') : { how: 'open', argv: ['explorer.exe', winPath(abs)] }
    case 'wsl':
      return CMD_UNSAFE.test(abs)
        ? refuse('its name holds characters Windows would run')
        : { how: 'open', argv: ['wslview', abs], fallback: ['explorer.exe', abs], windowsPath: true }
  }
}

function revealer(platform: Platform, abs: string): Action {
  switch (platform) {
    case 'mac':
      return { how: 'reveal', argv: ['open', '-R', abs], by: 'Finder' }
    case 'linux':
      // Selecting a file needs a FileManager1 D-Bus service; its folder opens everywhere.
      return { how: 'reveal', argv: ['xdg-open', parentOf(abs)], by: 'the file manager' }
    case 'windows':
      return CMD_UNSAFE.test(abs) ? refuse('its name holds characters Explorer would misread') : { how: 'reveal', argv: ['explorer.exe', `/select,${winPath(abs)}`], by: 'Explorer' }
    case 'wsl':
      return CMD_UNSAFE.test(abs) ? refuse('its name holds characters Explorer would misread') : { how: 'reveal', argv: ['explorer.exe', `/select,${abs}`], windowsPath: true, by: 'Explorer' }
  }
}

function withApp(platform: Platform, app: string, abs: string): Action {
  if (platform === 'mac') return { how: 'app', argv: ['open', '-a', app, abs], by: app }
  if (platform === 'windows')
    return CMD_UNSAFE.test(abs) || CMD_UNSAFE.test(app) ? refuse('its name holds characters Windows would run') : { how: 'app', argv: ['cmd', '/c', app, winPath(abs)], by: app }
  return { how: 'app', argv: [app, abs], by: app }
}

function inEditor(platform: Platform, prefs: Prefs, abs: string, line?: number, col?: number): Action {
  const ed = EDITORS[prefs.editor]
  if (prefs.editor === 'default') {
    // A code file's default app can be its runner: the plain text editor on a Mac, a reveal elsewhere.
    return platform === 'mac' ? { how: 'editor', argv: ['open', '-t', abs], by: 'the text editor' } : revealer(platform, abs)
  }
  if (!ed) {
    const byApp = withApp(platform, prefs.editor, abs)
    return byApp.how === 'refuse' ? byApp : { ...byApp, how: 'editor' }
  }
  if (platform === 'windows') {
    // Editor launchers on Windows are .cmd shims, so cmd.exe reads the path: refuse what it would run.
    if (CMD_UNSAFE.test(abs)) return refuse('its name holds characters Windows would run')
    const f = winPath(abs)
    return { how: 'editor', argv: ['cmd', '/c', ed.cli, ...(line === undefined ? [f] : ed.at(f, line, col))], by: ed.name }
  }
  const byCli = line === undefined ? [ed.cli, abs] : [ed.cli, ...ed.at(abs, line, col)]
  if (platform === 'mac') {
    const app = ['open', '-a', ed.app, abs]
    return line === undefined ? { how: 'editor', argv: app, by: ed.name } : { how: 'editor', argv: byCli, fallback: app, by: ed.name }
  }
  return { how: 'editor', argv: byCli, by: ed.name }
}

/** `abs` is the real path, every symlink followed: the name it was written under says nothing safe. */
export function actionFor(abs: string, kind: Kind, prefs: Prefs, platform: Platform = 'mac', line?: number, col?: number): Action {
  const ext = extOf(abs)
  if (LAUNCHER_EXTS.has(ext) || insideLauncher(abs)) return revealer(platform, abs)
  if (kind === 'dir') return prefs.folders === 'editor' ? inEditor(platform, prefs, abs) : opener(platform, abs)

  const set = prefs.overrides[ext]
  if (set !== undefined && !(LOCKED_EXTS.has(ext) && (set === 'default' || typeof set === 'object'))) {
    if (set === 'editor') return inEditor(platform, prefs, abs, line, col)
    if (set === 'reveal') return revealer(platform, abs)
    if (set === 'default') return opener(platform, abs)
    return withApp(platform, set.app, abs)
  }
  // A file with no extension (Makefile, LICENSE, a script) is text far more often than not.
  if (ext === '' || SCRIPT_EXTS.has(ext) || EDITOR_EXTS.has(ext)) return inEditor(platform, prefs, abs, line, col)
  if (DOC_EXTS.has(ext)) return opener(platform, abs)
  return revealer(platform, abs)
}

/** The words a toast says: `Opening Handout.docx`, `… in Visual Studio Code`, `Showing X.app in Finder`. */
export function describe(action: Action, abs: string, line?: number): string {
  const name = nameOf(abs) + (line === undefined ? '' : `:${line}`)
  if (action.how === 'refuse') return `Not opening ${name}: ${action.by}`
  if (action.how === 'reveal') return `Showing ${name} in ${action.by ?? 'the file manager'}`
  return action.by ? `Opening ${name} in ${action.by}` : `Opening ${name}`
}

/**
 * A link a terminal can follow by itself (no click reaches the mod): a file URL for documents and
 * folders, the editor's own URL for code, nothing for the rest, since the terminal would open it.
 */
export function terminalHref(abs: string, kind: Kind, prefs: Prefs, fileHref: string, platform: Platform, line?: number, col?: number): string | undefined {
  const action = actionFor(abs, kind, prefs, platform, line, col)
  if (action.how === 'open') return fileHref
  if (action.how === 'editor') return EDITORS[prefs.editor]?.url?.(abs, line, col)
  return undefined
}

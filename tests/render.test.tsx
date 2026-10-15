import { describe, expect, mock, test } from 'claude-code/testing'

const FILES: Record<string, 'file' | 'dir'> = {
  '/Users/me/Desktop': 'dir',
  '/Users/me/Desktop/Handout.docx': 'file',
  '/Users/me/proj/src/app.py': 'file',
  '/Users/me/out/Report.docx': 'file',
  '/Users/me/proj/deploy.sh': 'file',
  '/Applications/Evil.app': 'dir',
}
/** Symlinks: the name written, and where it really leads. */
const LINKS: Record<string, string> = { '/Users/me/Desktop/report.pdf': '/Applications/Evil.app' }

/** `other`: another mod draws the reply (a tree); `engine`: Claude Code's own drawing (an engine node). */
type Opts = { draws?: 'other' | 'engine'; uname?: string }

/** Stand-in for the engine beneath the plugin: a pretend Mac, its files, and every command it is asked to run. */
function engine(on: any, opts: Opts = {}) {
  mock.clock(on)
  mock.store(on)
  const runs: string[][] = []
  const toasts: string[] = []
  on('ui.render', ($: any, e: any) => {
    if (opts.draws === 'engine') return { type: 'engine', ref: 0 }
    const { Text } = $.ui.resolve(e)
    return <Text>OTHER MOD</Text>
  })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/Users/me/proj' }))
  on('command.register', () => ({ value: undefined }))
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/Users/me' : undefined }))
  on('ui.toast', (_$: any, e: any) => {
    toasts.push(typeof e === 'string' ? e : (e.text ?? JSON.stringify(e)))
    return { value: undefined }
  })
  on('fs.stat', (_$: any, e: any) => {
    const real = LINKS[e.path] ?? e.path
    const kind = FILES[real]
    if (!kind) throw Object.assign(new Error(`ENOENT: ${e.path}`), { code: 'ENOENT' })
    return { value: { kind, size: 0, mtimeMs: 0, isLink: real !== e.path, ...(e.resolve ? { realPath: real } : {}) } }
  })
  on('process.run', (_$: any, e: any) => {
    if (e.argv[0] === 'uname')
      return { value: opts.uname === undefined ? { exitCode: 0, stdout: 'Darwin 25.0.0\n', stderr: '' } : { exitCode: 1, stdout: '', stderr: 'no uname' } }
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('tool.call', () => ({ result: { type: 'create' } }))
  return { runs, toasts }
}

const start = ($: any) => $.session.start({ cwd: '/Users/me/proj', surface: 'terminal', isInteractive: true })
const VIEW = { columns: 120, rows: 40, isFullscreen: true }
const reply = ($: any, text: string, viewport: object = VIEW) =>
  $.ui.mount({ plugin: 'open-paths', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, surface: 'terminal', viewport })
const markdownOf = async (ui: any) => (await ui.findAll({ type: 'Markdown' })).map((m: any) => m.text ?? m.props?.text).join('\n')

describe('drawing', () => {
  test('by default the paths become links in place, even over another mod', async ($, on) => {
    engine(on)
    await start($)
    const ui = await reply($, 'Made ~/Desktop/Handout.docx')
    expect(await ui.find({ type: 'Text', text: /OTHER MOD/ })).toBeUndefined()
    expect(await markdownOf(ui)).toBe('Made [\\~/Desktop/Handout.docx](file:///Users/me/Desktop/Handout.docx)')
  })

  test('in auto mode another mod keeps its drawing, the links in a row beneath', async ($, on) => {
    engine(on)
    await start($)
    await $.command.run({ command: 'open-paths', args: 'mode auto' } as any)
    const ui = await reply($, 'Made ~/Desktop/Handout.docx and src/app.py:3, not gone.pdf')
    expect(await ui.find({ type: 'Text', text: /OTHER MOD/ })).toBeDefined()
    expect(await markdownOf(ui)).toBe(
      '↳ open  [Handout.docx](file:///Users/me/Desktop/Handout.docx) · [app.py:3](file:///Users/me/proj/src/app.py#L3)',
    )
  })

  test('when the engine draws the reply, the paths become links in place', async ($, on) => {
    engine(on, { draws: 'engine' })
    await start($)
    const ui = await reply($, 'Made ~/Desktop/Handout.docx and src/app.py:3, not gone.pdf')
    expect(await markdownOf(ui)).toBe(
      'Made [\\~/Desktop/Handout.docx](file:///Users/me/Desktop/Handout.docx) and [src/app.py:3](file:///Users/me/proj/src/app.py#L3), not gone.pdf',
    )
  })

  test('a reply with no existing path is left to whoever draws it', async ($, on) => {
    engine(on)
    await start($)
    const ui = await reply($, 'Nothing here, just gone.pdf and words.')
    expect(await ui.findAll({ type: 'Markdown' })).toEqual([])
  })

  test('paths in a code block get a row under the block', async ($, on) => {
    engine(on, { draws: 'engine' })
    await start($)
    const ui = await reply($, 'Run:\n```bash\npython src/app.py\n```\nok')
    expect(await markdownOf(ui)).toBe('Run:\n```bash\npython src/app.py\n```\n↳ open  [app.py](file:///Users/me/proj/src/app.py)\n\nok')
  })

  test('mode off draws nothing of ours', async ($, on) => {
    engine(on)
    await start($)
    await $.command.run({ command: 'open-paths', args: 'off' } as any)
    const ui = await reply($, 'Made ~/Desktop/Handout.docx')
    expect(await ui.findAll({ type: 'Markdown' })).toEqual([])
  })
})

describe('clicking', () => {
  test('a document opens in its app, with a toast saying so', async ($, on) => {
    const { runs, toasts } = engine(on)
    await start($)
    const ui = await reply($, 'Made ~/Desktop/Handout.docx')
    await ui.press({ key: 'open-paths', link: { href: 'file:///Users/me/Desktop/Handout.docx' } })
    expect(runs).toEqual([['open', '/Users/me/Desktop/Handout.docx']])
    expect(toasts.join('\n')).toContain('Opening Handout.docx')
  })

  test('code with a line opens the editor at that line', async ($, on) => {
    const { runs } = engine(on)
    await start($)
    const ui = await reply($, 'Bug at src/app.py:3')
    await ui.press({ key: 'open-paths', link: { href: 'file:///Users/me/proj/src/app.py#L3' } })
    expect(runs).toEqual([['code', '-g', '/Users/me/proj/src/app.py:3']])
  })

  test('a folder opens as a folder', async ($, on) => {
    const { runs } = engine(on)
    await start($)
    const ui = await reply($, 'Look in ~/Desktop')
    await ui.press({ key: 'open-paths', link: { href: 'file:///Users/me/Desktop' } })
    expect(runs).toEqual([['open', '/Users/me/Desktop']])
  })
})

describe('touched files and tool rows', () => {
  test('a bare name finds the file a tool wrote outside the working directory', async ($, on) => {
    engine(on, { draws: 'engine' })
    await start($)
    await $.tool.call({ tool: 'Write', file_path: '/Users/me/out/Report.docx', content: 'x' })
    const ui = await reply($, 'Done, see Report.docx')
    expect(await markdownOf(ui)).toBe('Done, see [Report.docx](file:///Users/me/out/Report.docx)')
  })

  test('a Write row gets an open line under it', async ($, on) => {
    engine(on)
    await start($)
    const ui = await $.ui.mount({
      plugin: 'open-paths',
      component: 'ToolUse',
      props: { tool_use_id: 't1', tool: 'Write', input: { file_path: '/Users/me/out/Report.docx' }, isRunning: false, isErrored: false, isInterrupted: false },
      surface: 'terminal',
      viewport: VIEW,
    })
    expect(await markdownOf(ui)).toBe('⎿  open [Report.docx](file:///Users/me/out/Report.docx)')
  })
})

describe('classic renderer', () => {
  test('the terminal follows the links itself: a file URL for documents, the editor URL for code', async ($, on) => {
    engine(on)
    await start($)
    const ui = await reply($, 'Made ~/Desktop/Handout.docx and src/app.py:3', { columns: 120, rows: 40, isFullscreen: false })
    const links = (await ui.findAll({ type: 'Link' })).map((l: any) => l.props?.href ?? l.href)
    expect(links).toEqual(['file:///Users/me/Desktop/Handout.docx', 'vscode://file/Users/me/proj/src/app.py:3'])
    expect(await ui.findAll({ type: 'Markdown' })).toEqual([])
  })
})

describe('safety, end to end through a click', () => {
  test('a symlink named like a document that leads to an app is revealed, never opened', async ($, on) => {
    const { runs, toasts } = engine(on)
    await start($)
    const ui = await reply($, 'Read ~/Desktop/report.pdf')
    const md = await markdownOf(ui)
    expect(md).toContain('(file:///Applications/Evil.app)')
    await ui.press({ key: 'open-paths', link: { href: 'file:///Applications/Evil.app' } })
    expect(runs).toEqual([['open', '-R', '/Applications/Evil.app']])
    expect(toasts.join('\n')).toContain('Showing Evil.app in Finder')
  })

  test('a script is opened in the editor, never run', async ($, on) => {
    const { runs } = engine(on)
    await start($)
    const ui = await reply($, 'Run deploy.sh')
    await ui.press({ key: 'open-paths', link: { href: 'file:///Users/me/proj/deploy.sh' } })
    expect(runs).toEqual([['open', '-a', 'Visual Studio Code', '/Users/me/proj/deploy.sh']])
  })

  test('when the system cannot be told, nothing is opened', async ($, on) => {
    const { runs, toasts } = engine(on, { uname: 'fail' })
    await start($)
    const ui = await reply($, 'Made ~/Desktop/Handout.docx')
    await ui.press({ key: 'open-paths', link: { href: 'file:///Users/me/Desktop/Handout.docx' } })
    expect(runs).toEqual([])
    expect(toasts.join('\n')).toContain('could not tell which system')
  })

  test('a click on a file that has gone opens nothing', async ($, on) => {
    const { runs, toasts } = engine(on)
    await start($)
    const ui = await reply($, 'Made ~/out/Report.docx')
    delete FILES['/Users/me/out/Report.docx'] // deleted after the reply was drawn
    try {
      await ui.press({ key: 'open-paths', link: { href: 'file:///Users/me/out/Report.docx' } })
    } finally {
      FILES['/Users/me/out/Report.docx'] = 'file'
    }
    expect(runs).toEqual([])
    expect(toasts.join('\n')).toContain('could not find')
  })
})

describe('a file written after the reply named it', () => {
  test('the reply is drawn again with the link once a tool writes the file', async ($, on) => {
    engine(on, { draws: 'engine' })
    await start($)
    delete FILES['/Users/me/out/Later.docx']
    const ui = await reply($, 'Writing ~/out/Later.docx now')
    expect(await markdownOf(ui)).toBe('')
    FILES['/Users/me/out/Later.docx'] = 'file'
    try {
      await $.tool.call({ tool: 'Write', file_path: '/Users/me/out/Later.docx', content: 'x' })
      const again = await reply($, 'Writing ~/out/Later.docx now')
      expect(await markdownOf(again)).toBe('Writing [\\~/out/Later.docx](file:///Users/me/out/Later.docx) now')
    } finally {
      delete FILES['/Users/me/out/Later.docx']
    }
  })
})

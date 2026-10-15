import { describe, expect, test } from 'claude-code/testing'

import { actionFor, describe as say, terminalHref } from '../hooks/openers'
import type { Prefs } from '../hooks/openers'

const P: Prefs = { editor: 'vscode', overrides: {}, folders: 'files' }
const VSC = 'Visual Studio Code'

describe('macOS', () => {
  test('documents open in their default app', async () => {
    for (const f of ['/a/x.docx', '/a/x.pdf', '/a/x.xlsx', '/a/x.pptx', '/a/x.png', '/a/x.csv', '/a/x.html']) {
      expect(actionFor(f, 'file', P)).toEqual({ how: 'open', argv: ['open', f] })
    }
  })

  test('code and text sources open in the editor app', async () => {
    for (const f of ['/a/x.py', '/a/x.java', '/a/x.ts', '/a/x.tsx', '/a/x.c', '/a/x.go', '/a/x.json', '/a/x.md', '/a/Makefile']) {
      expect(actionFor(f, 'file', P)).toEqual({ how: 'editor', argv: ['open', '-a', VSC, f], by: VSC })
    }
  })

  test('a line goes to the editor command at that line, the app as fallback', async () => {
    expect(actionFor('/a/x.py', 'file', P, 'mac', 42)).toEqual({
      how: 'editor',
      argv: ['code', '-g', '/a/x.py:42'],
      fallback: ['open', '-a', VSC, '/a/x.py'],
      by: VSC,
    })
    expect(actionFor('/a/x.py', 'file', P, 'mac', 42, 7).argv).toEqual(['code', '-g', '/a/x.py:42:7'])
  })

  test('other editors go to their own line syntax', async () => {
    expect(actionFor('/a/x.py', 'file', { ...P, editor: 'zed' }, 'mac', 4).argv).toEqual(['zed', '/a/x.py:4'])
    expect(actionFor('/a/x.py', 'file', { ...P, editor: 'idea' }, 'mac', 4, 2).argv).toEqual(['idea', '--line', '4', '--column', '2', '/a/x.py'])
    expect(actionFor('/a/x.py', 'file', { ...P, editor: 'cursor' }, 'mac').argv).toEqual(['open', '-a', 'Cursor', '/a/x.py'])
  })

  test('an editor given by app name opens with that app', async () => {
    expect(actionFor('/a/x.py', 'file', { ...P, editor: 'BBEdit' }, 'mac', 3)).toEqual({ how: 'editor', argv: ['open', '-a', 'BBEdit', '/a/x.py'], by: 'BBEdit' })
  })

  test('shell scripts are never handed to open: they would run', async () => {
    for (const f of ['/a/x.sh', '/a/x.zsh', '/a/x.command', '/a/x.tool', '/a/x.bash']) {
      expect(actionFor(f, 'file', P).argv).toEqual(['open', '-a', VSC, f])
    }
  })

  test('with the default editor, code goes to the text editor, never its default app (a runner)', async () => {
    expect(actionFor('/a/x.sh', 'file', { ...P, editor: 'default' }).argv).toEqual(['open', '-t', '/a/x.sh'])
    expect(actionFor('/a/x.py', 'file', { ...P, editor: 'default' }).argv).toEqual(['open', '-t', '/a/x.py'])
    expect(actionFor('/h/x.js', 'file', { ...P, editor: 'default' }, 'windows').how).toBe('reveal')
  })

  test('a type on no list is revealed, never handed to the opener', async () => {
    for (const f of ['/a/x.webloc', '/a/x.mobileconfig', '/a/x.pyz', '/a/x.rdp', '/a/x.unknownthing', '/a/x.docm', '/a/x.zip']) {
      expect(actionFor(f, 'file', P).how).toBe('reveal')
    }
  })

  test('a file inside an app bundle is revealed', async () => {
    expect(actionFor('/Applications/X.app/Contents/Info.plist', 'file', P).how).toBe('reveal')
  })

  test('apps, installers and other launchers are revealed, never opened', async () => {
    for (const f of ['/a/X.app', '/a/x.pkg', '/a/x.terminal', '/a/x.jar', '/a/x.workflow', '/a/x.exe', '/a/x.dmg', '/a/x.fileloc']) {
      expect(actionFor(f, 'file', P)).toEqual({ how: 'reveal', argv: ['open', '-R', f], by: 'Finder' })
    }
    expect(actionFor('/Applications/Safari.app', 'dir', P).argv).toEqual(['open', '-R', '/Applications/Safari.app'])
  })

  test('a folder opens in the file manager, or the editor when asked', async () => {
    expect(actionFor('/Users/me/Desktop', 'dir', P)).toEqual({ how: 'open', argv: ['open', '/Users/me/Desktop'] })
    expect(actionFor('/Users/me/proj', 'dir', { ...P, folders: 'editor' }).argv).toEqual(['open', '-a', VSC, '/Users/me/proj'])
  })

  test('overrides send a type where asked, but never let a script or launcher run', async () => {
    const o: Prefs = { ...P, overrides: { pdf: { app: 'Skim' }, txt: 'editor', png: 'reveal', md: 'default', sh: 'default', app: { app: 'X' } } }
    expect(actionFor('/a/x.pdf', 'file', o).argv).toEqual(['open', '-a', 'Skim', '/a/x.pdf'])
    expect(actionFor('/a/x.txt', 'file', o).argv).toEqual(['open', '-a', VSC, '/a/x.txt'])
    expect(actionFor('/a/x.png', 'file', o).argv).toEqual(['open', '-R', '/a/x.png'])
    expect(actionFor('/a/x.md', 'file', o).argv).toEqual(['open', '/a/x.md'])
    expect(actionFor('/a/x.sh', 'file', o).argv).toEqual(['open', '-a', VSC, '/a/x.sh'])
    expect(actionFor('/a/X.app', 'file', o).argv).toEqual(['open', '-R', '/a/X.app'])
  })

  test('extension matching ignores case', async () => {
    expect(actionFor('/a/X.PY', 'file', P).how).toBe('editor')
    expect(actionFor('/a/X.DOCX', 'file', P).how).toBe('open')
  })
})

describe('Linux, Windows and WSL', () => {
  test('the system opener of each', async () => {
    expect(actionFor('/h/x.pdf', 'file', P, 'linux').argv).toEqual(['xdg-open', '/h/x.pdf'])
    expect(actionFor('C:/u/x.pdf', 'file', P, 'windows').argv).toEqual(['explorer.exe', 'C:\\u\\x.pdf'])
    expect(actionFor('/h/x.pdf', 'file', P, 'wsl')).toEqual({ how: 'open', argv: ['wslview', '/h/x.pdf'], fallback: ['explorer.exe', '/h/x.pdf'], windowsPath: true })
  })

  test('the editor goes by its command', async () => {
    expect(actionFor('/h/x.py', 'file', P, 'linux', 3).argv).toEqual(['code', '-g', '/h/x.py:3'])
    expect(actionFor('/h/x.py', 'file', P, 'linux').argv).toEqual(['code', '/h/x.py'])
    expect(actionFor('C:/u/x.py', 'file', P, 'windows').argv).toEqual(['cmd', '/c', 'code', 'C:\\u\\x.py'])
  })

  test('a reveal shows the file in its file manager', async () => {
    expect(actionFor('/h/X.AppImage', 'file', P, 'linux').argv).toEqual(['xdg-open', '/h'])
    expect(actionFor('C:/u/x.exe', 'file', P, 'windows').argv).toEqual(['explorer.exe', '/select,C:\\u\\x.exe'])
  })

  test('a name cmd.exe or Explorer would re-parse is refused, never passed on', async () => {
    for (const f of ['C:/r/x&calc&.md', 'C:/r/a^b.pdf', 'C:/r/%PATH%.docx', 'C:/r/a|b.txt', 'C:/r/a,b.exe']) {
      expect(actionFor(f, 'file', P, 'windows').how).toBe('refuse')
    }
    expect(actionFor('/h/x&y.pdf', 'file', P, 'wsl').how).toBe('refuse')
    expect(actionFor('C:/r/x (1).docx', 'file', P, 'windows').how).toBe('open')
  })
})

describe('describe and terminalHref', () => {
  test('the toast says what opens and where', async () => {
    expect(say(actionFor('/a/Handout.docx', 'file', P), '/a/Handout.docx')).toBe('Opening Handout.docx')
    expect(say(actionFor('/a/x.py', 'file', P, 'mac', 3), '/a/x.py', 3)).toBe('Opening x.py:3 in Visual Studio Code')
    expect(say(actionFor('/a/X.app', 'file', P), '/a/X.app')).toBe('Showing X.app in Finder')
    expect(say(actionFor('C:/a/x&y.pdf', 'file', P, 'windows'), 'C:/a/x&y.pdf')).toBe('Not opening x&y.pdf: its name holds characters Windows would run')
  })

  test('in a terminal that opens links itself: documents as files, code by the editor URL, launchers not at all', async () => {
    expect(terminalHref('/a/x.docx', 'file', P, 'file:///a/x.docx', 'mac')).toBe('file:///a/x.docx')
    expect(terminalHref('/a/my x.py', 'file', P, 'file:///a/my%20x.py', 'mac', 3, 2)).toBe('vscode://file/a/my%20x.py:3:2')
    expect(terminalHref('/a/X.app', 'file', P, 'file:///a/X.app', 'mac')).toBeUndefined()
    expect(terminalHref('/a/x.sh', 'file', { ...P, editor: 'zed' }, 'file:///a/x.sh', 'mac')).toBeUndefined()
    expect(terminalHref('/a/x.py', 'file', { ...P, editor: 'zed' }, 'file:///a/x.py', 'mac')).toBeUndefined()
    expect(terminalHref('/a/x.webloc', 'file', P, 'file:///a/x.webloc', 'mac')).toBeUndefined()
  })

  test('an editor URL encodes # and ? inside names', async () => {
    expect(terminalHref('/a/#1?.py', 'file', P, 'x', 'mac')).toBe('vscode://file/a/%231%3F.py')
  })
})

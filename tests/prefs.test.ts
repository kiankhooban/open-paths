import { describe, expect, test } from 'claude-code/testing'

import { command, DEFAULTS, prefsOf } from '../hooks/prefs'
import { recall, remember } from '../hooks/touched'

describe('prefsOf', () => {
  test('defaults, then the manifest option, then what was stored', async () => {
    expect(prefsOf({}, undefined)).toEqual(DEFAULTS)
    expect(prefsOf({ editor: 'cursor' }, undefined).editor).toBe('cursor')
    expect(prefsOf({ editor: 'cursor' }, { editor: 'zed', mode: 'below' })).toEqual({ ...DEFAULTS, editor: 'zed', mode: 'below' })
  })

  test('bad stored values fall back', async () => {
    expect(prefsOf({}, { mode: 'loud', toolRows: 7, overrides: { pdf: 3, md: 'editor' } })).toEqual({ ...DEFAULTS, overrides: { md: 'editor' } })
  })
})

describe('/open-paths', () => {
  test('no arguments reports the settings and the help', async () => {
    const r = command(DEFAULTS, '')
    expect(r.prefs).toBeUndefined()
    expect(r.text).toContain('mode inline')
    expect(r.text).toContain('/open-paths set <ext> <target>')
  })

  test('mode, editor, folders, tools, toast', async () => {
    expect(command(DEFAULTS, 'mode below').prefs?.mode).toBe('below')
    expect(command(DEFAULTS, 'off').prefs?.mode).toBe('off')
    expect(command(DEFAULTS, 'editor Cursor').prefs?.editor).toBe('cursor')
    expect(command(DEFAULTS, 'editor Sublime Merge').prefs?.editor).toBe('Sublime Merge')
    expect(command(DEFAULTS, 'folders editor').prefs?.folders).toBe('editor')
    expect(command(DEFAULTS, 'tools all').prefs?.toolRows).toBe('all')
    expect(command(DEFAULTS, 'toast off').prefs?.toast).toBe(false)
  })

  test('set and unset an extension', async () => {
    const a = command(DEFAULTS, 'set .PDF Skim').prefs!
    expect(a.overrides).toEqual({ pdf: { app: 'Skim' } })
    const b = command(a, 'set txt editor').prefs!
    expect(b.overrides).toEqual({ pdf: { app: 'Skim' }, txt: 'editor' })
    expect(command(b, 'unset pdf').prefs!.overrides).toEqual({ txt: 'editor' })
  })

  test('a script or launcher cannot be sent to its default app', async () => {
    const r = command(DEFAULTS, 'set sh default')
    expect(r.prefs).toBeUndefined()
    expect(r.text).toContain('runs or installs')
    expect(command(DEFAULTS, 'set command Terminal').prefs).toBeUndefined()
    expect(command(DEFAULTS, 'set sh reveal').prefs?.overrides).toEqual({ sh: 'reveal' })
  })

  test('reset and unknown', async () => {
    expect(command({ ...DEFAULTS, mode: 'off' }, 'reset').prefs).toEqual(DEFAULTS)
    expect(command(DEFAULTS, 'frobnicate').text).toContain('unknown command')
  })
})

describe('touched files', () => {
  test('a bare name or tail finds the newest touched file it matches', async () => {
    let t = remember({}, '/Users/me/out/Handout.docx')
    t = remember(t, '/Users/me/old/Handout.docx')
    expect(recall(t, 'Handout.docx')).toEqual(['/Users/me/old/Handout.docx', '/Users/me/out/Handout.docx'])
    expect(recall(t, 'out/Handout.docx')).toEqual(['/Users/me/out/Handout.docx'])
    expect(recall(t, 'other/Handout.docx')).toEqual([])
  })

  test('touching again moves it to the front; absolute or home paths are not recalled', async () => {
    let t = remember({}, '/a/x.md')
    t = remember(t, '/b/x.md')
    t = remember(t, '/a/x.md')
    expect(recall(t, 'x.md')).toEqual(['/a/x.md', '/b/x.md'])
    expect(recall(t, '/a/x.md')).toEqual([])
    expect(recall(t, '~/x.md')).toEqual([])
  })

  test('names like __proto__ and constructor are plain names', async () => {
    const t = remember(remember({}, '/a/__proto__'), '/a/constructor')
    expect(recall(t, '__proto__')).toEqual(['/a/__proto__'])
    expect(recall(t, 'constructor')).toEqual(['/a/constructor'])
    expect(recall({}, 'toString')).toEqual([])
  })

  test('a relative path is never remembered', async () => {
    expect(remember({}, 'src/x.md')).toEqual({})
  })
})

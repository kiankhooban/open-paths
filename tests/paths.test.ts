import { describe, expect, test } from 'claude-code/testing'

import { applyEdits, blockRows, findBlocks, findRefs, hrefOf, linkify, linkRow, resolvePath } from '../hooks/paths'

const CTX = { home: '/Users/me', cwd: '/Users/me/proj' }
const paths = (text: string) => findRefs(text).map(r => r.path)

describe('findRefs', () => {
  test('absolute, home and relative paths in prose', async () => {
    expect(paths('see ~/Desktop/Handout.docx and /tmp/a.pdf or src/app.ts')).toEqual([
      '~/Desktop/Handout.docx',
      '/tmp/a.pdf',
      'src/app.ts',
    ])
  })

  test('a bare file name with an extension', async () => {
    expect(paths('open README.md now')).toEqual(['README.md'])
  })

  test('trailing punctuation is not part of the path', async () => {
    expect(paths('Saved to ~/out/report.pdf. Then (see wiki/hot.md), done!')).toEqual(['~/out/report.pdf', 'wiki/hot.md'])
  })

  test('a :line and :line:col suffix is split off', async () => {
    const [a, b] = findRefs('at src/app.ts:42 and lib/x.py:7:3')
    expect([a!.path, a!.line, a!.col]).toEqual(['src/app.ts', 42, undefined])
    expect([b!.path, b!.line, b!.col]).toEqual(['lib/x.py', 7, 3])
  })

  test('a path in backticks may hold spaces, and keeps its backticks in the label', async () => {
    const [r] = findRefs('the file `~/My Drive/Notes Q1.docx` is ready')
    expect(r!.path).toBe('~/My Drive/Notes Q1.docx')
    expect(r!.code).toBe(true)
    expect(r!.label).toBe('`~/My Drive/Notes Q1.docx`')
  })

  test('backticked words that are not paths are ignored', async () => {
    expect(paths('run `npm install` then `git status`')).toEqual([])
  })

  test('fenced code blocks are left alone', async () => {
    expect(paths('before a.md\n```bash\ncat ~/x/b.md\n```\nafter c.md')).toEqual(['a.md', 'c.md'])
  })

  test('URLs and existing markdown links are left alone', async () => {
    expect(paths('see https://x.com/a/b.html and [doc](docs/a.md) or <https://y.io/z.md>')).toEqual([])
  })

  test('numbers, versions and abbreviations are not paths', async () => {
    expect(paths('version 1.2.3, e.g. this, 3.14 and 50/50 odds')).toEqual([])
  })
})

describe('resolvePath', () => {
  test('home, absolute and relative', async () => {
    expect(resolvePath('~/Desktop/a.docx', CTX)).toBe('/Users/me/Desktop/a.docx')
    expect(resolvePath('~', CTX)).toBe('/Users/me')
    expect(resolvePath('/etc/hosts', CTX)).toBe('/etc/hosts')
    expect(resolvePath('src/../lib/./x.py', CTX)).toBe('/Users/me/proj/lib/x.py')
  })

  test('network paths are refused', async () => {
    expect(resolvePath('//server/share/a.txt', CTX)).toBeUndefined()
    expect(resolvePath('/net/host/a.txt', CTX)).toBeUndefined()
    expect(resolvePath('/Network/Servers/a.txt', CTX)).toBeUndefined()
  })

  test('relative without a cwd, or ~ without a home, resolves to nothing', async () => {
    expect(resolvePath('a.md', {})).toBeUndefined()
    expect(resolvePath('~/a.md', { cwd: '/x' })).toBeUndefined()
  })
})

describe('hrefOf and linkify', () => {
  test('spaces, parentheses and non-ASCII are percent-encoded', async () => {
    expect(hrefOf('/Users/me/My Drive/a (1).docx')).toBe('file:///Users/me/My%20Drive/a%20%281%29.docx')
    expect(hrefOf('/Users/me/ü.md')).toBe('file:///Users/me/%C3%BC.md')
  })

  test('a line rides in the fragment', async () => {
    expect(hrefOf('/a/b.py', 4, 2)).toBe('file:///a/b.py#L4:2')
  })

  test('only resolved refs become links, labels escaped, the rest untouched', async () => {
    const text = 'open ~/a_b*c.docx and `x y.md` but not gone.md'
    const refs = findRefs(text)
    const out = linkify(text, [
      { ref: refs[0]!, href: hrefOf('/Users/me/a_b*c.docx') },
      { ref: refs[1]!, href: hrefOf('/Users/me/proj/x y.md') },
    ])
    expect(out).toBe(
      'open [\\~/a\\_b\\*c.docx](file:///Users/me/a_b*c.docx) and [`x y.md`](file:///Users/me/proj/x%20y.md) but not gone.md',
    )
  })
})

describe('code blocks', () => {
  const TEXT = 'Run this:\n```bash\ncat ~/out/a.md src/b.py\n```\nDone.'

  test('paths inside a closed block are found apart from the prose', async () => {
    const [b] = findBlocks(TEXT)
    expect(b!.refs.map(r => r.path)).toEqual(['~/out/a.md', 'src/b.py'])
    expect(TEXT.slice(0, b!.end)).toBe('Run this:\n```bash\ncat ~/out/a.md src/b.py\n```\n')
  })

  test('a block still streaming in gives nothing', async () => {
    expect(findBlocks('```bash\ncat ~/out/a.md')).toEqual([])
  })

  test('a row of links goes under the block, the block untouched', async () => {
    const [b] = findBlocks(TEXT)
    const items = b!.refs.map((ref, i) => ({ ref, href: `file:///x/${i}` }))
    expect(applyEdits(TEXT, blockRows(TEXT, [{ end: b!.end, items }]))).toBe(
      'Run this:\n```bash\ncat ~/out/a.md src/b.py\n```\n↳ open  [a.md](file:///x/0) · [b.py](file:///x/1)\n\nDone.',
    )
  })
})

describe('linkRow', () => {
  const item = (path: string, href: string, line?: number) => ({ ref: { start: 0, end: 0, label: path, path, line, code: false }, href })

  test('file names with their line, each link once', async () => {
    expect(linkRow([item('~/a/Hand_out.docx', 'h1'), item('src/x.py', 'h2', 3), item('~/a/Hand_out.docx', 'h1')])).toBe(
      '↳ open  [Hand\\_out.docx](h1) · [x.py:3](h2)',
    )
  })

  test('two files of one name show their paths', async () => {
    expect(linkRow([item('a/x.md', 'h1'), item('b/x.md', 'h2')])).toBe('↳ open  [a/x.md](h1) · [b/x.md](h2)')
  })

  test('past the cap, a count', async () => {
    const many = Array.from({ length: 14 }, (_, i) => item(`f${i}.md`, `h${i}`))
    expect(linkRow(many)).toMatch(/· \+2 more$/)
  })
})

describe('Windows paths', () => {
  test('a drive path is found, resolved and linked', async () => {
    expect(findRefs('saved C:\\Users\\me\\a.docx ok').map(r => r.path)).toEqual(['C:\\Users\\me\\a.docx'])
    expect(resolvePath('C:\\Users\\me\\..\\you\\a.docx', {})).toBe('C:/Users/you/a.docx')
    expect(hrefOf('C:/Users/me/a b.docx')).toBe('file:///C:/Users/me/a%20b.docx')
  })
})

describe('review fixes', () => {
  test('a fence nested in a list item or a blockquote is code', async () => {
    expect(paths('- step\n    ```bash\n    cat a/b.md\n    ```\n- c.md')).toEqual(['c.md'])
    expect(paths('> ```\n> cat a/b.md\n> ```\nd.md')).toEqual(['d.md'])
    expect(findBlocks('- step\n    ```bash\n    cat a/b.md\n    ```\n')[0]!.refs.map(r => r.path)).toEqual(['a/b.md'])
  })

  test('a line range links its first line', async () => {
    const [r] = findRefs('see src/a.ts:10-20 here')
    expect([r!.path, r!.line, r!.label]).toEqual(['src/a.ts', 10, 'src/a.ts:10-20'])
  })

  test('the row under a block is its own paragraph', async () => {
    const text = '```\ncat a.md\n```\nNext.'
    const [b] = findBlocks(text)
    const out = applyEdits(text, blockRows(text, [{ end: b!.end, items: b!.refs.map(ref => ({ ref, href: 'h' })) }]))
    expect(out).toBe('```\ncat a.md\n```\n↳ open  [a.md](h)\n\nNext.')
  })
})

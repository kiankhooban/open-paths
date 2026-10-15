// The files Claude's tools read or wrote, by name, newest first: so "see Handout.docx" finds the
// ~/output/Handout.docx it wrote an hour ago, outside the working directory. Pure.

/** File name to absolute paths, newest first. */
export type Touched = Record<string, string[]>

const PER_NAME = 5
const MAX_NAMES = 500

const nameOf = (abs: string) => abs.replace(/\/+$/, '').slice(abs.replace(/\/+$/, '').lastIndexOf('/') + 1)

/** The index with `abs` as the newest under its name; the oldest names leave past the cap. */
export function remember(index: Touched, abs: string): Touched {
  const name = nameOf(abs)
  if (!name || (!abs.startsWith('/') && !/^[A-Za-z]:\//.test(abs))) return index
  // A null-prototype copy: a file named __proto__ or constructor is just a name here.
  const next: Touched = Object.assign(Object.create(null) as Touched, index)
  const had = Object.prototype.hasOwnProperty.call(index, name) ? index[name]! : []
  delete next[name]
  next[name] = [abs, ...had.filter(p => p !== abs)].slice(0, PER_NAME)
  const names = Object.keys(next)
  if (names.length > MAX_NAMES) for (const n of names.slice(0, names.length - MAX_NAMES)) delete next[n]
  return next
}

/**
 * The touched paths a written path may mean, newest first: those with its name whose
 * tail matches what was written (`docs/a.md` matches `/x/docs/a.md`, not `/x/notes/a.md`).
 */
export function recall(index: Touched, written: string): string[] {
  const w = written.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  if (!w || w.startsWith('/') || w.startsWith('~') || w.includes('..')) return []
  const name = nameOf(w)
  const list = Object.prototype.hasOwnProperty.call(index, name) ? index[name]! : []
  return list.filter(abs => abs === w || abs.endsWith(`/${w}`))
}

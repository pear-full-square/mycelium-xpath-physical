// offset-files: a topic stored a record a file, named by its offset, in
// folders by its digits (README.md beside it).

// the node set's storage: { type, topic, levels, batch, extension }
//   topic      where the topic is in its layer ('' the layer itself; 'done')
//   levels     how many of the offset's digits name each folder ([5, 6])
//   batch      how many records a batch holds (50)
//   extension  a record's file ('json')
const DIGITS = 13
const meta = set => ({ topic: '', levels: [5, 6], batch: 50, extension: 'json', ...set.physical })
const nameOf = offset => String(offset).padStart(DIGITS, '0')
const quoted = text => `'${text}'`

// The filters right after `<topic>/*`, each its text, and what follows them.
function filters (rest) {
  const out = []
  let at = 0
  while (rest[at] === '[') {
    let depth = 0
    let end = at
    for (let quote = null; end < rest.length; end++) {
      const c = rest[end]
      if (quote) { if (c === quote) quote = null; continue }
      if (c === '\'' || c === '"') quote = c
      else if (c === '[') depth++
      else if (c === ']' && --depth === 0) break
    }
    out.push(rest.slice(at + 1, end).trim())
    at = end + 1
  }
  return { filters: out, after: rest.slice(at) }
}
const positional = filter => /^\d+$/.test(filter) || /\b(position|last)\s*\(/.test(filter.replace(/'[^']*'|"[^"]*"/g, ''))

// What a logical query asks of its topic, read once from its text:
//   handed down, the filters right on the records, in this order:
//     bounds on the offset      [@offset=N] one record; [@offset<N],
//                               [@offset<=N] from there back; [@offset>N],
//                               [@offset>=N] back to there: the offset's
//                               digits say the folder, the scan is in it
//     then a position           [last()] the latest; [position()>last()-N]
//                               the latest N: how many records are read
//   asked of each record read (filters on its data, a path into it): the rest
// A position anywhere else (after a filter on the data, from the topic's
// start) is not built yet: refused, said.
export function plan (set) {
  const { topic } = meta(set)
  const all = topic ? `${topic}/*` : '*'
  const query = set.logical.query
  if (query !== all && !(query.startsWith(all) && '[/'.includes(query[all.length]))) throw new Error(`not a topic's records: ${query} (${all}, its filters, a path into a record)`)
  const { filters: list, after } = filters(query.slice(all.length))
  const p = { exact: null, upper: null, lower: null, limit: null, asked: '' }
  let i = 0
  for (; i < list.length; i++) {
    const m = list[i].match(/^@?offset\s*(=|<=|>=|<|>)\s*(\d+)$/)
    if (!m) break
    const n = Number(m[2])
    if (m[1] === '=') p.exact = n
    // (several: the narrowest holds)
    else if (m[1][0] === '<') { const at = m[1] === '<' ? n - 1 : n; p.upper = p.upper === null ? at : Math.min(p.upper, at) } else { const at = m[1] === '>' ? n + 1 : n; p.lower = p.lower === null ? at : Math.max(p.lower, at) }
  }
  if (i < list.length) {
    const m = list[i].match(/^position\s*\(\s*\)\s*>\s*last\s*\(\s*\)\s*-\s*(\d+)$/)
    if (/^last\s*\(\s*\)$/.test(list[i]) || /^position\s*\(\s*\)\s*=\s*last\s*\(\s*\)$/.test(list[i])) { p.limit = 1; i++ } else if (m) { p.limit = Number(m[1]); i++ }
  }
  for (const f of list.slice(i)) if (positional(f)) throw new Error(`a position among a topic's records, here: not built yet: [${f}] (in ${query}; built: [last()] and [position()>last()-N] right on the records, after bounds on @offset)`)
  p.asked = list.slice(i).map(f => `[${f}]`).join('') + after
  return p
}
export const asked = set => plan(set).asked

// Where a node set starts: the folder of the latest offset it wants (its
// fixed one, or its upper bound where that is earlier), that offset the
// first wanted; how many are still to read (its limit).
const start = (set, p) => {
  const { levels, batch } = meta(set)
  const name = nameOf(p.upper === null ? set.fixed : Math.min(set.fixed, p.upper))
  return { phase: 'records', folder: levels.map(n => name.slice(0, n)), bound: name, inclusive: true, need: p.limit === null ? batch : Math.min(batch, p.limit), left: p.limit }
}
const stateOf = (set, p) => set.reached ?? start(set, p)
const pathOf = (set, ...names) => [meta(set).topic, ...names].filter(Boolean).join('/')
const folderOf = (set, offset) => meta(set).levels.map(n => nameOf(offset).slice(0, n))

export function next (set) {
  if (set.fixed === null || set.fixed === undefined || set.reached === 'end') return null
  const { extension } = meta(set)
  const p = plan(set)
  const file = name => quoted(`${name}.${extension}`)
  // one record, by its offset: its folder said by its digits, scanned for it
  if (p.exact !== null) {
    const out = p.exact > set.fixed || (p.upper !== null && p.exact > p.upper) || (p.lower !== null && p.exact < p.lower) || p.limit === 0
    return out ? null : `${pathOf(set, ...folderOf(set, p.exact))}/*[name()=${file(nameOf(p.exact))}]${p.asked}`
  }
  if (p.limit === 0 || (p.lower !== null && p.lower > set.fixed)) return null
  const s = stateOf(set, p)
  // back to a lower bound: in its folder, the scan stops at it
  const floor = p.lower !== null && s.folder.join('/') === folderOf(set, p.lower).join('/') ? `[name()>=${file(nameOf(p.lower))}]` : ''
  // the records of one folder, from where it has read to, back: by name and position, none opened
  if (s.phase === 'records') return `${pathOf(set, ...s.folder)}/*${s.bound === null ? '' : `[name()${s.inclusive ? '<=' : '<'}${file(s.bound)}]`}${floor}[position()>last()-${s.need}]`
  // those same records, what is asked of them: opened
  if (s.phase === 'asked') return `${pathOf(set, ...s.folder)}/*[name()>=${file(s.low)}][name()<=${file(s.high)}]${p.asked}`
  // the folder before this one, in its parent
  if (s.phase === 'before') return `${pathOf(set, ...s.folder.slice(0, s.level))}/*[name()<${quoted(s.folder[s.level])}][last()]`
  // the last folder of one found, a level down
  if (s.phase === 'last') return `${pathOf(set, ...s.folder.slice(0, s.level))}/*[last()]`
  throw new Error(`not a state of an offset-files node set: ${s.phase}`)
}

const last = path => path.slice(path.lastIndexOf('/') + 1)
export function took (set, text, result) {
  const { batch, levels, extension } = meta(set)
  const p = plan(set)
  const none = { nodes: [], stopped: [], done: false, full: false }
  const end = { ...none, reached: 'end', done: true }
  if (p.exact !== null) return { nodes: result.found, stopped: result.stopped, reached: 'end', done: true, full: true }
  const s = stateOf(set, p)
  const lowest = p.lower === null ? null : folderOf(set, p.lower)
  // a folder earlier than the lower bound's: nothing wanted there or before it
  const below = folder => lowest !== null && folder.some((name, i) => name < lowest[i] && folder.slice(0, i).every((x, j) => x === lowest[j]))
  // a part of a batch read: on to where it ended; the folder run out: the
  // one before; its limit reached, or its lower bound's folder done: the end
  const on = (from, low, count) => {
    const left = from.left === null ? null : from.left - count
    if (left === 0) return 'end'
    const need = from.need - count
    const size = left === null ? batch : Math.min(batch, left)
    if (count < from.need) return lowest !== null && from.folder.join('/') === lowest.join('/') ? 'end' : { phase: 'before', folder: from.folder, level: levels.length - 1, need: need > 0 ? need : size, left }
    return { phase: 'records', folder: from.folder, bound: low, inclusive: false, need: need > 0 ? need : size, left }
  }
  const part = (nodes, stopped, low, count) => {
    const reached = on(s, low, count)
    return { nodes, stopped, reached, done: reached === 'end', full: s.need - count <= 0 }
  }
  if (s.phase === 'records') {
    // (in the order they arrived; handed over the latest first)
    const names = result.found.map(f => last(f.path).slice(0, -(extension.length + 1)))
    if (!names.length) return part([], [], null, 0)
    if (p.asked) return { ...none, reached: { phase: 'asked', folder: s.folder, low: names[0], high: names.at(-1), count: names.length, need: s.need, left: s.left } }
    return part([...result.found].reverse(), result.stopped, names[0], names.length)
  }
  if (s.phase === 'asked') return part([...result.found].reverse(), result.stopped, s.low, s.count)
  const into = folder => (below(folder) ? end : folder.length === levels.length
    ? { ...none, reached: { phase: 'records', folder, bound: null, inclusive: false, need: s.need, left: s.left } }
    : { ...none, reached: { phase: 'last', folder, level: folder.length, need: s.need, left: s.left } })
  if (s.phase === 'before') {
    const found = result.found[0]
    // none before it at this level: a level up; at the top: the topic's start
    if (!found) return s.level === 0 ? end : { ...none, reached: { ...s, level: s.level - 1 } }
    return into([...s.folder.slice(0, s.level), last(found.path)])
  }
  if (s.phase === 'last') {
    const found = result.found[0]
    // a folder with nothing in it: the one before it
    if (!found) return { ...none, reached: { phase: 'before', folder: s.folder, level: s.level - 1, need: s.need, left: s.left } }
    return into([...s.folder, last(found.path)])
  }
  throw new Error(`not a state of an offset-files node set: ${s.phase}`)
}

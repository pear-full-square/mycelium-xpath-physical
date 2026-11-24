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

// What is asked of the topic's records, after `<topic>/*`: filters on a
// record, a path into it. A position among the records is not handed down
// yet: refused, said.
export function asked (set) {
  const { topic } = meta(set)
  const all = topic ? `${topic}/*` : '*'
  const query = set.logical.query
  if (query !== all && !(query.startsWith(all) && '[/'.includes(query[all.length]))) throw new Error(`not a topic's records: ${query} (${all}, its filters, a path into a record)`)
  const rest = query.slice(all.length)
  // the filters right on the records: none a position
  for (let at = 0; rest[at] === '[';) {
    let depth = 0
    let end = at
    for (let quote = null; end < rest.length; end++) {
      const c = rest[end]
      if (quote) { if (c === quote) quote = null; continue }
      if (c === '\'' || c === '"') quote = c
      else if (c === '[') depth++
      else if (c === ']' && --depth === 0) break
    }
    const filter = rest.slice(at + 1, end)
    if (/^\s*\d+\s*$/.test(filter) || /\b(position|last)\s*\(/.test(filter.replace(/'[^']*'|"[^"]*"/g, ''))) throw new Error(`a position among a topic's records is not built yet: [${filter}] (in ${query})`)
    at = end + 1
  }
  return rest
}

// Where a node set starts: the folder its fixed offset is in, that offset
// the first wanted, a whole batch to get.
const start = set => {
  const { levels, batch } = meta(set)
  const name = nameOf(set.fixed)
  return { phase: 'records', folder: levels.map(n => name.slice(0, n)), bound: name, inclusive: true, need: batch }
}
const stateOf = set => set.reached ?? start(set)
const pathOf = (set, ...names) => [meta(set).topic, ...names].filter(Boolean).join('/')

export function next (set) {
  if (set.fixed === null || set.fixed === undefined || set.reached === 'end') return null
  const { extension } = meta(set)
  const s = stateOf(set)
  const rest = asked(set)
  const file = name => quoted(`${name}.${extension}`)
  // the records of one folder, from where it has read to, back: by name and position, none opened
  if (s.phase === 'records') return `${pathOf(set, ...s.folder)}/*${s.bound === null ? '' : `[name()${s.inclusive ? '<=' : '<'}${file(s.bound)}]`}[position()>last()-${s.need}]`
  // those same records, what is asked of them: opened
  if (s.phase === 'asked') return `${pathOf(set, ...s.folder)}/*[name()>=${file(s.low)}][name()<=${file(s.high)}]${rest}`
  // the folder before this one, in its parent
  if (s.phase === 'before') return `${pathOf(set, ...s.folder.slice(0, s.level))}/*[name()<${quoted(s.folder[s.level])}][last()]`
  // the last folder of one found, a level down
  if (s.phase === 'last') return `${pathOf(set, ...s.folder.slice(0, s.level))}/*[last()]`
  throw new Error(`not a state of an offset-files node set: ${s.phase}`)
}

const last = path => path.slice(path.lastIndexOf('/') + 1)
export function took (set, text, result) {
  const { batch, levels, extension } = meta(set)
  const s = stateOf(set)
  const rest = asked(set)
  const none = { nodes: [], stopped: [], done: false, full: false }
  // a part of a batch read: on to where it ended; the folder run out: the one before
  const on = (from, low, count) => {
    const need = from.need - count
    const exhausted = count < from.need
    if (exhausted) return { phase: 'before', folder: from.folder, level: levels.length - 1, need: need > 0 ? need : batch }
    return { phase: 'records', folder: from.folder, bound: low, inclusive: false, need: need > 0 ? need : batch }
  }
  if (s.phase === 'records') {
    // (in the order they arrived; handed over the latest first)
    const names = result.found.map(f => last(f.path).slice(0, -(extension.length + 1)))
    if (!names.length) return { ...none, reached: { phase: 'before', folder: s.folder, level: levels.length - 1, need: s.need } }
    if (rest) return { ...none, reached: { phase: 'asked', folder: s.folder, low: names[0], high: names.at(-1), count: names.length, need: s.need } }
    const reached = on(s, names[0], names.length)
    return { nodes: [...result.found].reverse(), stopped: result.stopped, reached, done: false, full: s.need - names.length <= 0 }
  }
  if (s.phase === 'asked') {
    const reached = on(s, s.low, s.count)
    return { nodes: [...result.found].reverse(), stopped: result.stopped, reached, done: false, full: s.need - s.count <= 0 }
  }
  if (s.phase === 'before') {
    const found = result.found[0]
    // none before it at this level: a level up; at the top: the topic's start
    if (!found) return s.level === 0 ? { ...none, reached: 'end', done: true } : { ...none, reached: { ...s, level: s.level - 1 } }
    const folder = [...s.folder.slice(0, s.level), last(found.path)]
    return folder.length === levels.length
      ? { ...none, reached: { phase: 'records', folder, bound: null, inclusive: false, need: s.need } }
      : { ...none, reached: { phase: 'last', folder, level: folder.length, need: s.need } }
  }
  if (s.phase === 'last') {
    const found = result.found[0]
    // a folder with nothing in it: the one before it
    if (!found) return { ...none, reached: { phase: 'before', folder: s.folder, level: s.level - 1, need: s.need } }
    const folder = [...s.folder, last(found.path)]
    return folder.length === levels.length
      ? { ...none, reached: { phase: 'records', folder, bound: null, inclusive: false, need: s.need } }
      : { ...none, reached: { phase: 'last', folder, level: folder.length, need: s.need } }
  }
  throw new Error(`not a state of an offset-files node set: ${s.phase}`)
}

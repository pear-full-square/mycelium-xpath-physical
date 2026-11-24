import test from 'brittle'
import { query, nodeset, reader } from 'mycelium-xpath'
import { next, took } from '../index.js'

// A topic as it is stored: a record a file named by its offset, in folders
// by its digits; the layer's own files beside them, hidden.
const record = (offset, protocol) => ({ topic: '/request/done', offset, value: { topic: null, offset, value: { protocol } } })
const OFFSETS = [1795312345678, 1795312345679, 1795312399999, 1795399999999, 1795400000000, 1795400000001, 1795400000002, 1795400000003, 1795500000000]
function stored (offsets = OFFSETS) {
  const done = {}
  offsets.forEach((o, i) => { const n = String(o); ((done[n.slice(0, 5)] ??= {})[n.slice(0, 6)] ??= {})[`${n}.json`] = record(o, i % 2 ? 'crud' : 'boot') })
  return { done, pending: {} }
}
const isFile = node => node && typeof node === 'object' && 'topic' in node && 'offset' in node
const treeOf = (asked = { documents: 0 }) => ({
  children: node => (node && typeof node === 'object' && !isFile(node) ? Object.entries(node).sort(([a], [b]) => (a < b ? -1 : 1)) : null),
  document: node => { if (isFile(node)) { asked.documents++; return node } return null }
})
const TOPIC = { type: 'offset-files', topic: 'done', levels: [5, 6], batch: 3, extension: 'json' }
function reading (logical, { root = stored(), fixed = OFFSETS.at(-1), physical = TOPIC } = {}) {
  const ran = []
  const asked = { documents: 0 }
  const set = nodeset({ query: logical, mode: 'logical', layer: 'request' }, physical, fixed)
  const read = reader(set, { next, took, run: text => { ran.push(text); return query(treeOf(asked), root, text) } })
  return { set, read, ran, asked }
}
const offsets = nodes => nodes.map(n => Number(n.path.slice(n.path.lastIndexOf('/') + 1, -'.json'.length)))

test('offset-files: the physical queries of a batch: from the fixed offset back, a folder at a time, by name and position; no record opened', async (t) => {
  const { set, read, ran, asked } = reading('done/*')
  t.alike([set.nodes, ran], [[], []], 'made: nothing loaded, nothing run')
  const first = await read.more()
  t.alike(offsets(first), [1795500000000, 1795400000003, 1795400000002], 'the first batch: the latest three, the latest first')
  t.alike(ran, [
    "done/17955/179550/*[name()<='1795500000000.json'][position()>last()-3]",
    "done/17955/*[name()<'179550'][last()]",
    "done/*[name()<'17955'][last()]",
    'done/17954/*[last()]',
    'done/17954/179540/*[position()>last()-2]'
  ], 'its physical queries: the fixed offset\'s folder by its digits; that folder run out, the one before it, a level up where there is none; then the rest of the batch there')
  t.is(asked.documents, 0, 'by names and positions: no record opened')
  ran.length = 0
  t.alike(offsets(await read.more()), [1795400000001, 1795400000000, 1795399999999], 'the next batch: on from where it read to, across a folder')
  t.alike(ran, [
    "done/17954/179540/*[name()<'1795400000002.json'][position()>last()-3]",
    "done/17954/*[name()<'179540'][last()]",
    "done/*[name()<'17954'][last()]",
    'done/17953/*[last()]',
    'done/17953/179539/*[position()>last()-1]'
  ])
  t.alike(offsets(await read.all()), [...OFFSETS].reverse(), 'read to its end: every record, from the latest back')
  t.alike([set.done, set.reached], [true, 'end'])
  t.is(await read.more(), null, 'no more')
})

test('offset-files: fixed at the time of the request: what arrived after is not in it', async (t) => {
  const { read } = reading('done/*', { fixed: 1795400000001 })
  t.alike(offsets(await read.all()), [1795400000001, 1795400000000, 1795399999999, 1795312399999, 1795312345679, 1795312345678], 'from the fixed offset back: the later ones left out')
  const empty = reading('done/*', { root: { done: {} }, fixed: null })
  t.alike([await empty.read.all(), empty.ran], [[], []], 'a topic with nothing in it: nothing to read, nothing run')
})

test('offset-files: what is asked of the records goes with each batch: a filter on their data, a path into them; only the batch opened', async (t) => {
  const { read, ran, asked } = reading("done/*[value/value/protocol='crud']")
  const first = await read.more()
  t.alike(offsets(first), [1795400000003], 'of the latest three, those the filter holds for')
  t.alike(ran.filter(x => x.includes('protocol')), [
    "done/17955/179550/*[name()>='1795500000000.json'][name()<='1795500000000.json'][value/value/protocol='crud']",
    "done/17954/179540/*[name()>='1795400000002.json'][name()<='1795400000003.json'][value/value/protocol='crud']"
  ], 'the batch\'s records, named from first to last, with what is asked of them')
  t.is(asked.documents, 3, 'the batch opened, nothing else')
  t.alike(offsets(await read.all()), [1795400000003, 1795400000001, 1795399999999, 1795312345679], 'to its end')
  const values = reading('done/*/value/value/protocol', { fixed: 1795312345679 })
  t.alike((await values.read.all()).map(n => n.value), ['crud', 'boot'], 'a path into each record: its values, the latest first')
})

test('offset-files: a topic that is its layer; other levels; a batch larger than what is there', async (t) => {
  const inbox = reading('*', { root: stored().done, physical: { type: 'offset-files', topic: '', batch: 50 } })
  t.alike(offsets(await inbox.read.more()), [...OFFSETS].reverse(), 'the layer itself the topic; a batch of 50: all nine, in one')
  t.is(inbox.ran[0], "17955/179550/*[name()<='1795500000000.json'][position()>last()-50]", 'the defaults: two levels, 5 and 6 digits')
  t.is(inbox.set.done, true, 'a batch not filled: read on to the topic\'s start, its end known')
  t.is(await inbox.read.more(), null, 'asked again: no more')
})

test('offset-files: what is no topic\'s records, and a position among them, said', (t) => {
  const set = q => nodeset({ query: q, mode: 'logical' }, TOPIC, 1)
  t.exception(() => next(set('pending/*')), /not a topic's records: pending\/\* \(done\/\*, its filters, a path into a record\)/)
  t.exception(() => next(set('done')), /not a topic's records/)
  t.exception(() => next(set('done/*[last()]')), /a position among a topic's records is not built yet: \[last\(\)\]/)
  t.exception(() => next(set('done/*[2]')), /not built yet: \[2\]/)
  t.exception(() => next(set("done/*[offset>5][position()<=10]")), /not built yet: \[position\(\)<=10\]/)
  t.execution(() => next(set("done/*[value/note='the last() one']")), 'a text that says last() is no position')
})

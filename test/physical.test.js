import test from 'brittle'
import { query, nodeset, reader } from 'mycelium-xpath'
import { next, took, isType, TYPES } from '../index.js'

const root = { swarms: { 'swarm-1': { nodes: { 'node-1': {}, 'node-2': {} } }, 'swarm-2': { nodes: {} } }, notes: {} }
const tree = { children: node => (node !== null && typeof node === 'object' ? Object.entries(node) : null) }
const paths = nodes => nodes.map(n => n.path)

test('the structure types there are; one not there is said', (t) => {
  t.alike(Object.keys(TYPES), ['tree'])
  t.ok(isType('tree'))
  t.absent(isType('offset-files'), 'not built yet')
  t.absent(isType('toString'), 'a name of the object\'s own is none')
  t.exception(() => next(nodeset({ query: 'swarms/*' }, { type: 'parquet' })), /not a structure type: parquet \(tree\)/)
})

test('tree: its physical query is the logical one, once; its result the whole answer', (t) => {
  const set = nodeset({ query: 'swarms/*', layer: 'main' })
  t.alike(set, { logical: { query: 'swarms/*', mode: 'physical', layer: 'main' }, fixed: null, reached: null, physical: { type: 'tree' }, nodes: [], stopped: [], done: false }, 'a node set, made: the request, its storage, nothing loaded')
  t.is(next(set), 'swarms/*', 'the physical XPath: the logical one')
  const step = took(set, 'swarms/*', { found: [{ path: '/swarms/swarm-1' }], stopped: [] })
  t.alike(step, { nodes: [{ path: '/swarms/swarm-1' }], stopped: [], reached: 'end', done: true, full: true })
  t.is(next({ ...set, reached: 'end' }), null, 'read to its end: no more')
})

test('a node set read: nothing loaded until it is asked; a batch by a physical query, seen; the answer the engine gives', async (t) => {
  const seen = []
  const ran = []
  const set = nodeset({ query: 'swarms/*/nodes/*' })
  const read = reader(set, { next, took, run: text => { ran.push(text); return query(tree, root, text) }, observe: async (event, fn) => { const r = await fn(); seen.push({ ...event, returned: r.found.length }); return r } })
  t.alike([set.nodes, set.done, ran], [[], false, []], 'made: no data in it, nothing run')
  const batch = await read.more()
  t.alike(paths(batch), ['/swarms/swarm-1/nodes/node-1', '/swarms/swarm-1/nodes/node-2'], 'its first batch')
  t.alike(paths(batch), paths((await query(tree, root, 'swarms/*/nodes/*')).found), 'what the engine answers for the query')
  t.alike([set.reached, set.done, paths(set.nodes)], ['end', true, paths(batch)], 'the node set now: read to its end, its nodes loaded')
  t.alike(seen, [{ logical: 'swarms/*/nodes/*', mode: 'physical', type: 'tree', from: null, physical: 'swarms/*/nodes/*', returned: 2 }], 'the physical query seen: from where, its text, how many came')
  t.is(await read.more(), null, 'no more')
  t.is(ran.length, 1, 'nothing run again')
  t.alike(JSON.parse(JSON.stringify(set)).logical, set.logical, 'it travels as data')
})

test('a node set read to its end, and node by node', async (t) => {
  const reading = text => reader(nodeset({ query: text }), { next, took, run: x => query(tree, root, x) })
  t.alike(paths(await reading('swarms/*').all()), ['/swarms/swarm-1', '/swarms/swarm-2'], 'all()')
  const one = []
  for await (const node of reading('swarms/*')) { one.push(node.path); break }
  t.alike(one, ['/swarms/swarm-1'], 'iterated: a reader that stops early')
  const every = []
  for await (const node of reading('*')) every.push(node.path)
  t.alike(every, ['/swarms', '/notes'])
  t.alike(await reading('nothing/*').all(), [], 'nothing there: empty, done')
})

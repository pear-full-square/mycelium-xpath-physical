# test/

The tests of mycelium-xpath-physical, a section per file, each test by its name.

## `physical.test.js`

- the structure types there are; one not there is said
- tree: its physical query is the logical one, once; its result the whole answer
- a node set read: nothing loaded until it is asked; a batch by a physical query, seen; the answer the engine gives
- a node set read to its end, and node by node
- XPathResult: a query's result as an iterator: the next node asked for, its slices fetched under the hood, each node at its logical address

## `offset-files.test.js`

- offset-files: the physical queries of a batch: from the fixed offset back, a folder at a time, by name and position; no record opened
- offset-files: fixed at the time of the request: what arrived after is not in it
- offset-files: what is asked of the records goes with each batch: a filter on their data, a path into them; only the batch opened
- offset-files: a topic that is its layer; other levels; a batch larger than what is there
- offset-files: a position right on the records: the latest, the latest N: read from the latest back and no further
- offset-files: an offset is an index: one record by a scan of its folder; bounds say where the reading starts and stops
- offset-files: what is no topic's records, and a position not built yet, said

# tree

The structure type of a plain tree: read as it is stored, logical and physical the same.

A tree has no storage structure to hide: what a query names is what is
there. Its node set is read with one physical query, the logical query
itself, and its result is the whole answer: one batch, then no more.

## Signature

- `next(set)`: the physical query for the node set's next batch.
- `took(set, text, result)`: what that query's result is to the node set.

## Returns

- `next`: the node set's logical query while nothing of it is read
  (`reached` is `null`); `null` after: no more.
- `took`: `{ nodes, stopped, reached: 'end', done: true, full: true }`:
  the nodes found, where the query stopped at a shortcut, and that it is
  read to its end.

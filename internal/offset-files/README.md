# offset-files

The structure type of a topic stored a record a file, named by its offset, in folders by its digits.

A streaming layer keeps its records this way
(`mycelium-container-document` writes it): `<topic>/17954/179540/1795400000002.json`,
a folder a level for the first digits of the offset. To a query the
topic is its records, in the order they arrived; this generator gives
the physical XPath that fetches them from the stored folders, a batch
at a time, from the node set's fixed offset back: the latest first.

## Signature

- `next(set)`: the physical query for the next part of the node set's
  next batch.
- `took(set, text, result)`: what that query's result is to the node set.
- `asked(set)`: what the logical query asks of the records, after
  `<topic>/*`.

The node set's `physical`: `{ type: 'offset-files', topic, levels,
batch, extension }`: where the topic is in its layer (`''`: the layer
itself), how many digits name each folder (`[5, 6]`), a batch's records
(50), a record's file (`json`). Its `fixed`: the topic's latest offset
when the query was made; `null`: nothing in it.

## Returns

- `next`: a physical XPath, by where the node set has read to:
  - a folder's records from there back, by name and position, none
    opened: `done/17954/179540/*[name()<'1795400000002.json'][position()>last()-50]`
    (the first of a node set: its fixed offset's folder, by its digits,
    that offset included);
  - those same records with what the logical query asks of them, where
    it asks something (a filter on their data, a path into them), named
    from first to last: `…/*[name()>='<low>.json'][name()<='<high>.json'][value/value/protocol='crud']`;
  - a folder run out, the one before it in its parent,
    `done/17954/*[name()<'179540'][last()]`, a level up where there is
    none, and the last folder below one found, `done/17953/*[last()]`;
  - `null`: read to the topic's start, or nothing in it.
- `took`: `{ nodes, stopped, reached, done, full }`: a batch's records
  handed over the latest first; `full` when the batch has its count;
  `done` at the topic's start. A batch may take several physical
  queries: one stays inside one stored folder.
- `asked`: the rest of the logical query. A logical query that is not
  `<topic>/*` with filters and a path is refused; a position among the
  records (`[last()]`, `[position()<=10]`) too, said as not built yet.

## Side effects

None: pure functions of the node set's data. A query made after
another, at the same fixed offset, reads the same records: what arrived
later is not in it.

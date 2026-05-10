---
name: live_database_ingest
description: Capture semantic-layer and knowledge updates from a live database schema snapshot.
callers: [memory_agent]
---

# Live Database Ingest

Use this skill when the ingest work unit contains raw files under
`raw-sources/<connectionId>/live-database/<syncId>/`.

## Workflow

1. Read the table JSON file listed in the work unit.
2. Read `connection.json` to understand the snapshot metadata.
3. Read `foreign-keys.json` when the table has a foreign key or when joins are
   needed for the semantic-layer source.
4. Create or update one semantic-layer source for the table with
   `sl_write_source`.
5. Use the physical table name from the raw JSON as the source `table` field.
6. Preserve database comments as `descriptions.db` on tables and columns.
7. Add joins only when the foreign key index names both sides.
8. Write wiki pages only for durable business meaning that is present in table
   or column comments.
9. Run `sl_validate` for the table source before the work unit completes.

## Source shape

For a raw table with this shape:

```json
{
  "name": "orders",
  "db": "public",
  "columns": [
    { "name": "id", "type": "integer", "nullable": false, "primaryKey": true }
  ]
}
```

Write a semantic-layer source with this shape:

```yaml
name: orders
table: public.orders
grain: id
columns:
  - name: id
    type: number
```

Use `string`, `number`, `time`, or `boolean` for column types. When a database
type is ambiguous, use `string`.

## Boundaries

The raw snapshot is structural evidence. Do not invent measures, segments,
business definitions, or joins that are not present in the snapshot files.

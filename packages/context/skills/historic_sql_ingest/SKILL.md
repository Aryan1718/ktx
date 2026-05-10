---
name: historic_sql_ingest
description: Convert one full-tier historic-SQL template WorkUnit into a canonical query knowledge page, linked SL refs, and optional semantic-layer proposals.
callers: [memory_agent]
---

# Historic SQL Ingest

Use this skill when the WorkUnit contains files under `raw-sources/<connectionId>/historic-sql/<syncId>/templates/<templateId>/`.

Read exactly one historic-SQL template WorkUnit. Each WorkUnit represents one staged template or categorical sub-cluster that already survived full-tier page triage. It is not an intent cluster.

## Input Shape

The WorkUnit normally exposes:

- `metadata.json` in `rawFiles`.
- `page.md` in `rawFiles`.
- `usage.json` in `dependencyPaths`.
- `manifest.json` in `dependencyPaths`.
- `peerFileIndex` containing sibling templates that you cannot read.

`metadata.json` has the stable identity:

```json
{
  "id": "fp_1",
  "title": "snowflake - analytics.orders [fp_1]",
  "path": "templates/fp_1/page.md",
  "objectType": "historic_sql_template",
  "lastEditedAt": null,
  "properties": {
    "fingerprint": "fp_1",
    "sub_cluster_id": null,
    "dialect": "snowflake",
    "tables_touched": ["analytics.orders"],
    "literal_slots": [
      { "position": 1, "type": "string", "classification": "constant" },
      { "position": 2, "type": "date", "classification": "runtime" }
    ],
    "triage_signals": {
      "executions_bucket": "high",
      "distinct_users_bucket": "team",
      "error_rate_bucket": "ok",
      "recency_bucket": "active",
      "service_account_only": "false",
      "slot_summary": "1 constant, 1 runtime"
    }
  }
}
```

`page.md` contains mechanically generated normalized SQL and touched tables:

```text
# fp_1

## Normalized SQL
SELECT date_trunc(?, created_at), count(*) FROM analytics.orders WHERE status = ? AND created_at >= ? GROUP BY 1

## Tables touched
- analytics.orders
```

`usage.json` contains volatile stats, literal top values, and redacted samples. Use it for intent inference and usage summaries. Do not treat usage-only drift as a reason to group this template with siblings.

## Required Workflow

1. Read the WorkUnit section in the prompt first.
2. Call `read_raw_file` for `metadata.json`, `page.md`, `usage.json`, and `manifest.json`.
3. Confirm `metadata.objectType === "historic_sql_template"`. If it is not, call `emit_unmapped_fallback` with `reason: "parse_error"`, `fallback: "flagged"`, and the `metadata.json` raw path.
4. Extract `fingerprint`, `sub_cluster_id`, `dialect`, `tables_touched`, `literal_slots`, normalized SQL, usage stats, top literal values, and sample timestamps.
5. Infer one canonical query intent from this template only. Use table names, selected expressions, aggregations, joins, grouping, constant literal slots, and repeated successful samples. Runtime literal slots are parameters, not fixed business rules.
6. Build a short intent slug in kebab-case. Use `queries/<intent_slug>` as the wiki key.
7. Search existing knowledge with `wiki_search` using the intent phrase and the primary table. Prefer updating an existing `queries/...` page when it is the same intent.
8. Discover touched tables with `sl_discover`. Add cleanly matched source names to `sl_refs`. If a table does not map cleanly, keep it in the page body and do not include it in `sl_refs`.
9. Write or update the query page with `wiki_write`.
10. Apply the SL proposal threshold below. If it passes and a useful generic measure, segment, join, or overlay is clear, update the semantic layer and run `sl_validate`.
11. Exit without reading peer files or grouping sibling templates.

## Wiki Page Shape

Use `wiki_write` for pages. Emit the spec frontmatter fields directly on the query page.

Use this shape:

```json
{
  "key": "queries/<intent_slug>",
  "summary": "<one sentence canonical intent>",
  "tags": ["historic-sql", "query-pattern"],
  "sl_refs": ["<clean_source_name>"],
  "source": "historic-sql",
  "intent": "<human-readable canonical intent>",
  "tables": ["<tables_touched>"],
  "representative_sql": "<parameterized representative SQL>",
  "usage": {
    "executions": 47812,
    "distinct_users": 12,
    "first_seen": "2026-02-01",
    "last_seen": "2026-04-30",
    "p50_runtime_ms": 320,
    "p95_runtime_ms": 1180,
    "error_rate": 0.0007
  },
  "fingerprints": ["<fingerprint or sub-cluster id>"],
  "content": "## <Canonical Intent Title>\n\n### Parameters\n- <constant/runtime/categorical slot notes>\n\n### When To Use\n- <concise reusable guidance>\n\n### Caveats\n- <redaction, service-account, low-confidence, or mapping notes if present>"
}
```

For Snowflake templates include `usage.rows_produced` when present in `usage.json`; for BigQuery v1 omit `usage.rows_produced`.

The `key: "queries/<intent_slug>"` value writes to `knowledge/global/queries/<intent_slug>.md` during external ingest because bundle ingests write global wiki pages.

## Representative SQL Rules

- Start from normalized SQL in `page.md`.
- For constant slots, use the dominant `usage.literal_slots[].top_values[0][0]` when it has definitional meaning. Quote string and date values in the representative SQL.
- For runtime slots, render named parameters such as `:start_date`, `:as_of`, `:status`, or `:threshold`.
- For categorical slots, document the known categories and write this WorkUnit's sub-cluster value when `sub_cluster_id` is present.
- Preserve the warehouse dialect named by `metadata.properties.dialect`.
- Do not copy sample bound_sql into the wiki unless it is visibly redacted and safer than the normalized SQL. Prefer normalized SQL plus parameter notes.

## SL Proposal Threshold

Only propose semantic-layer changes when all are true:

1. This WorkUnit reached Stage 3 full tier. The runner normally guarantees this, but treat `executions_bucket=low` plus `distinct_users_bucket=solo` or `service_account_only=true` as a reason to write wiki only.
2. At least one `literal_slots[]` entry has `classification: "constant"` and the value has durable business meaning, such as a status, plan tier, channel, threshold, or fixed category.
3. Every table in `tables_touched` maps cleanly through `sl_discover` to an existing SL source.

When the threshold passes:

- Call `sl_read_source` before editing an existing source.
- Prefer adding a measure, segment, computed dimension, join, or manifest-backed overlay over creating a standalone SQL source.
- Use `sl_write_source` for a manifest-backed overlay only with `name:` plus additive fields such as `measures:`, `segments:`, `description:`, or `joins:`. Do not include `sql:`, `table:`, `grain:`, or `columns:` on manifest-backed overlays.
- Use `sl_edit_source` for targeted edits when the source file already exists.
- Run `sl_validate` after every SL write or edit.
- Keep runtime parameters as caller filters. Do not bake dates, user ids, ids, search strings, or other runtime slots into SL measures.

When the threshold does not pass, write the wiki page and set `sl_refs` for any cleanly discovered touched tables. A wiki-only result is valid.

## Intent Inference Guidance

Prefer canonical intent names that describe the business question, not the SQL shape:

- Good: `queries/monthly-paid-order-count`
- Good: `queries/enterprise-contract-renewal-risk`
- Good: `queries/support-ticket-first-response-time`
- Weak: `queries/fp-1`
- Weak: `queries/count-orders-group-by-date`

Use the SQL shape to infer intent:

- `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `GROUP BY`, and date truncation usually indicate metrics or rollups.
- Constant slots often name segments, statuses, tiers, regions, or thresholds.
- Runtime slots usually represent time windows, selected entities, or caller filters.
- Repeated successful samples from multiple human users make the page more durable.
- High error rates, service-account-only use, or old `last_seen` values belong in caveats.

## Boundaries

- Do not group sibling templates. Stage 4 `historic_sql_curator` owns cross-template clustering and dedupe.
- Do not read paths listed only in `peerFileIndex`.
- Do not create or update `historic_sql_curator`.
- Do not call `context_candidate_write`; historic-SQL Stage 3 writes final wiki and optional SL artifacts directly.
- Do not invent joins, measures, or definitions that are not supported by the normalized SQL, touched tables, literal slots, or existing SL sources.
- Do not copy unredacted sample `bound_sql`, user emails, account ids, tokens, or free-text literal values into wiki or SL output.
- Do not write SL changes when any touched table lacks a clean SL mapping.
- Do not finish after only an SL write. Always write or update the query knowledge page first so the canonical SQL pattern is searchable.

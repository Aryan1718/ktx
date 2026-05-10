---
name: historic_sql_curator
description: Reconcile historic-SQL query knowledge pages by deduping collapsed intents, cross-linking categorical sub-clusters, and demoting stale low-signal pages.
callers: [memory_agent]
---

# Historic SQL Curator

Use this skill during Stage 4 reconciliation for the `historic-sql` source. It runs after `historic_sql_ingest` has written query knowledge pages from full-tier template WorkUnits. The Stage 4 runner may use curator pagination, so treat the current prompt as one bounded page of work and finish every listed item you inspect.

## Input Shape

The reconciliation prompt normally exposes:

- `# Stage Index` with WorkUnit keys, raw paths, and wiki or SL actions from Stage 3.
- `# Eviction Set` with deleted raw paths from retired templates.
- `# Curator Pass State` when curator pagination splits reconciliation into multiple passes.
- `# Source Reconciliation Notes` with run-level notes such as staged template count.

Use tools instead of guessing:

- `stage_list` shows every WorkUnit raw path and action.
- `stage_diff` compares two WorkUnits by written artifact overlap.
- `read_raw_span` reads staged `metadata.json`, `page.md`, `usage.json`, and `manifest.json` snippets when page content is not enough.
- `wiki_search`, `wiki_read`, and `wiki_write` inspect and update query knowledge pages.
- `emit_artifact_resolution` records merged or subsumed wiki pages for provenance.
- `eviction_list` and `emit_eviction_decision` handle deleted raw paths.

## Required Workflow

1. Read the `# Stage Index`, `# Eviction Set`, `# Curator Pass State`, and `# Source Reconciliation Notes` sections first.
2. Call `stage_list` when the prompt omits raw paths or when more than one WorkUnit wrote a `queries/...` page.
3. For each successful historic-SQL WorkUnit that wrote a wiki page, call `wiki_read` on that page before deciding whether to merge, cross-link, or demote it.
4. If the page body does not show fingerprint, sub-cluster, tables, or usage clearly enough, call `read_raw_span` on that WorkUnit's `metadata.json` and `usage.json` raw paths.
5. Build intent clusters using table overlap, representative SQL shape, page summaries, fingerprints, sub-cluster IDs, and usage. Same table is not enough to merge; the business intent must collapse.
6. Deduplicate collapsed intents by electing one canonical page, merging useful variant details into it with `wiki_write`, and recording each merged loser with `emit_artifact_resolution`.
7. Cross-link categorical sub-cluster pages that share the same base fingerprint but differ by `__cat_...` sub-cluster ID.
8. Demote pages whose underlying cluster has decayed below the floor in the most recent 3 windows, or in the current window plus eviction evidence showing the template retired.
9. For every deleted raw path in the Eviction Set that you inspect, call `eviction_list` and then `emit_eviction_decision`.

## Canonical Page Election

When two or more pages describe the same query intent, choose the canonical page with this order:

1. The clearest human-readable intent summary.
2. The page with broader non-service-account usage.
3. The page covering more fingerprints or categorical variants of the same intent.
4. The page with the most recent successful usage.
5. Lexicographically first page key.

After electing the canonical page:

- Read every page that will be merged.
- Update the canonical page so it contains one "Historic SQL Variants" section with fingerprints, sub-cluster IDs, tables, usage summaries, and links to sibling page keys when retained.
- Keep `tags` including `historic-sql` and `query-pattern`.
- Preserve useful `sl_refs`; when replacing refs, include the union of cleanly matched SL refs from merged pages.
- For each merged loser, call `emit_artifact_resolution` with:

```json
{
  "rawPath": "<loser WorkUnit metadata.json or page.md raw path>",
  "artifactKind": "wiki",
  "artifactKey": "<loser wiki page key>",
  "actionType": "merged",
  "reason": "Historic-SQL query intent collapsed into <canonical wiki page key>."
}
```

Use `actionType: "subsumed"` only when the loser page is a thin duplicate with no unique facts worth retaining in the canonical body.

## Categorical Sub-Cluster Cross-Links

A categorical sub-cluster normally has a staged ID like `<fingerprint>__cat_<hash>` or page content that says `Sub-cluster: <value>`. For sibling pages that share the same base fingerprint:

1. Read all sibling pages visible in the current Stage Index or found through `wiki_search`.
2. Keep one page per meaningful category value.
3. Add or update a "Categorical Variants" section in each sibling page:

```markdown
### Categorical Variants
- `<category value>`: [[queries/<sibling_key>]] - <short intent or parameter note>
```

4. Use `wiki_write` with `refs` containing the sibling page keys so cross-links also live in frontmatter.
5. Do not merge categorical siblings only because they share a fingerprint. Merge them only when the category value no longer changes intent.

## Demotion

Demotion preserves history; it is not deletion. A page is demoted when evidence shows its underlying cluster has fallen below the historic-SQL floor:

- `executions < 3`, or
- `distinct_users < 2`, or
- service-account-only usage below the frequency floor, or
- the template was evicted and no active sibling or replacement page supports the same intent.

Require the low-signal state across the most recent 3 windows when page history is available. If only the current window is visible, demote only when eviction evidence confirms the raw template retired; otherwise add a caveat and leave the page active.

Use `wiki_write` to express demotion with the current wiki frontmatter fields:

- Add the `historic-sql-demoted` tag while preserving `historic-sql` and `query-pattern`.
- Prefix the summary with `Demoted historic-SQL pattern: ` unless it already begins with that phrase.
- Add a `### Demotion` section in the body with the last observed usage window, the floor that failed, and the raw path or fingerprint that supports the decision.

When demoting because of an eviction, also call `emit_eviction_decision`:

```json
{
  "rawPath": "<deleted raw path>",
  "artifactKind": "wiki",
  "artifactKey": "<wiki page key>",
  "action": "retained_deprecated",
  "reason": "Historic-SQL template retired or decayed below the floor; page retained with historic-sql-demoted frontmatter tag."
}
```

## What To Write

Use `wiki_write` for every page update. The tool supports `summary`, `content`, `tags`, `refs`, and `sl_refs` frontmatter fields.

Canonical pages should keep this body shape:

```markdown
## <Canonical Query Intent>
- Source: historic-sql
- Tables: <tables>
- Fingerprints: <fingerprints and sub-clusters>
- Usage: <executions>, <distinct users>, first seen <date>, last seen <date>

### Representative SQL
```sql
<representative SQL or parameterized SQL>
```

### Historic SQL Variants
- `<fingerprint or sub-cluster>`: <what differs and when to use it>

### Categorical Variants
- `<category value>`: [[queries/<sibling_key>]] - <short intent or parameter note>

### Demotion
- Omit this section unless the page is demoted.
```

## Boundaries

- Do not call `context_candidate_write`; historic-SQL Stage 3 writes query pages directly.
- Do not create new artifact types, stores, ports, or tables.
- Do not group low-tier templates that triage already filtered out.
- Do not merge pages on table overlap alone.
- Do not delete a query page solely because usage is low; demote it unless eviction rules and inbound-reference evidence make removal clearly safer.
- Do not copy unredacted sample `bound_sql`, user emails, account IDs, tokens, or free-text literal values into wiki or SL output.
- Do not edit SL unless the reconciliation prompt shows a concrete same-intent conflict or duplicate that requires an existing SL artifact resolution.
- Do not finish a curator pagination pass while a merged page, demoted page, or inspected eviction lacks the corresponding provenance call.

# Page Triage Classifier

Classify one staged evidence page into exactly one lane:

- `skip` - the page is indexed evidence, but it is transient, repetitive, task-like, date-titled status reporting, or too weak to produce durable knowledge candidates.
- `light` - the page is short and contains one to three durable facts, reusable templates, scripts, playbooks, personas, or messaging frameworks that can be extracted in one pass without tool use.
- `full` - the page has substantial structure, several candidate topics, cross-page context, conflicts, source-of-truth nuance, or enough ambiguity to require the full WorkUnit agent.

Use the page excerpt and structural signals as evidence. Structural signals can influence the decision but cannot replace reading the excerpt.

Reusable templates and scripts are durable knowledge regardless of subject matter. Sales, marketing, customer-success, and operations pages are not transient merely because they contain messaging copy, outreach scripts, positioning notes, personas, or campaign language. Date-titled standups are still skip; named templates and scripts are not.

Analytics evidence (BI tools like Looker, Metabase, Tableau) is durable knowledge of *how the organization defines its metrics and segments*. The `signals.objectType` tells you what you are looking at:

- `looker_explore` (or any explore-like analytics surface) -> `full` by default. Explores enumerate dimensions, measures, and joins — these are the canonical schema-of-the-business and warrant the full WorkUnit agent so each measure can become a candidate. Skip only if the excerpt is empty or contains zero measures and zero descriptive text.
- `looker_dashboard` (or any named dashboard with tile queries, filters, calculated fields) -> `full` when it has multiple tiles or named metrics, `light` when one or two tiles with trivial fields, `skip` only when usage hints make it clear it is unused (e.g. `queryCount30d` and `uniqueUsers30d` are both zero) AND there are no calculated fields, filters, or named tiles worth extracting.
- `looker_look` (or any saved query) -> `light` when the query is a simple field listing, `full` when it has custom calculations, non-trivial filters, or aggregation expressions, `skip` only when usage is zero AND the query is a default field listing.

Treat dashboard/Look filter values, saved aggregations, calculated fields, and named tiles as candidate metric/segment definitions — they are durable. Do **not** mark BI evidence as `skip` solely because it is "configuration" or "tied to a data model"; that is exactly the durable knowledge we want to capture.

Historic SQL query-history evidence is durable when usage signals show a repeated pattern worth memory work. For `signals.objectType === "historic_sql_template"`:

- If `propertyHints.executions_bucket=low AND distinct_users_bucket=solo`, return `skip`. A one-off query by one user is indexed evidence, but it is too weak to produce durable knowledge candidates.
- Else if `propertyHints.service_account_only=true AND below the frequency floor`, return `light`. Treat `executions_bucket=low` or `distinct_users_bucket=solo` as below the frequency floor for this rule. Service-account-only templates can preserve useful SQL evidence, but should not occupy a full WorkUnit unless other signals show shared human usage.
- Otherwise apply the standard full/light/skip logic to the page excerpt. Favor `full` for shared human usage with mid or high execution volume, especially when `tables_touched`, normalized SQL, and slot classifications define a reusable metric, segment, threshold, or operational query pattern.

Historic-SQL synthetic signal examples:

- skip low solo template:

```json
{
  "objectType": "historic_sql_template",
  "propertyHints": {
    "executions_bucket": "low",
    "distinct_users_bucket": "solo",
    "error_rate_bucket": "ok",
    "recency_bucket": "active",
    "service_account_only": "false",
    "slot_summary": "1 constant, 1 runtime"
  }
}
```

-> `skip`

- light service-account-only template:

```json
{
  "objectType": "historic_sql_template",
  "propertyHints": {
    "executions_bucket": "high",
    "distinct_users_bucket": "solo",
    "error_rate_bucket": "ok",
    "recency_bucket": "active",
    "service_account_only": "true",
    "slot_summary": "1 constant, 0 runtime"
  }
}
```

-> `light`

- full shared human template:

```json
{
  "objectType": "historic_sql_template",
  "propertyHints": {
    "executions_bucket": "high",
    "distinct_users_bucket": "team",
    "error_rate_bucket": "ok",
    "recency_bucket": "active",
    "service_account_only": "false",
    "slot_summary": "2 constant, 1 runtime"
  }
}
```

-> `full`

Examples:

- `Cold Call Script` with reusable call flow, objection handling, or positioning language -> `light` when short, `full` when multi-section or ambiguous.
- `Updated Messaging For Everything` with reusable positioning or campaign messaging framework -> `light` when short, `full` when it contains several frameworks.
- `Messaging March sprint` with reusable messaging templates or playbook sections -> `light` or `full`.
- `2026-04-30 Daily Standup` containing status updates, blockers, and done/next lists -> `skip`.
- `Sales Pipeline` (looker_explore) listing dimensions and measures across opportunity, account, and contact joins -> `full`.
- `Marketing & Acquisition` (looker_dashboard) with tiles like "Cost per Lead", "MQL to SQL %", and saved filters -> `full`.
- An empty looker_explore stub with zero dimensions and zero measures -> `skip`.

Return only JSON with this shape:

```json
{
  "lane": "skip",
  "reason": "short reason"
}
```

Valid lane values are `skip`, `light`, and `full`.

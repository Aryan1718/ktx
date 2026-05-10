---
page_id: notion_page_retention_policy_current
title: 'Retention and NRR Definition Notes'
owner_person_key: maya_chen
owner_team: analytics
owner_notion_user_id: notion_user_0001
status: current
created_time: 2026-01-08T10:00:00-08:00
last_edited_time: 2026-03-30T16:40:00-07:00
tags:
  - analytics
  - retention
  - board-reporting
related_expected_answers:
  - enterprise_nrr_q1_vs_q4_breakout
  - enterprise_expansions_q1_2026
related_metric_keys:
  - net_revenue_retention
  - segment
anchors:
  - notion://notion_page_retention_policy_current#nrr-definition
  - notion://notion_page_retention_policy_current#discount-expiration-treatment
---

# Retention and NRR Definition Notes

Owner: Maya Chen (analytics)

## NRR Definition
Anchor: notion://notion_page_retention_policy_current#nrr-definition

Enterprise NRR is calculated as (starting_arr + expansion_arr - contraction_arr - churned_arr) / starting_arr.

Movement classification happens after child accounts roll up to parent_account_id.

Reactivations within 30 days are excluded from NRR movement components and kept in audit columns.

Q1 2026 discount expiration is contraction, not churn; the board-prep view calls out 11 enterprise parent accounts.

## Parent-Account Grain
Anchor: notion://notion_page_retention_policy_current#parent-account-grain

## Reactivation Exclusion
Anchor: notion://notion_page_retention_policy_current#reactivation-exclusion

Reactivations within 30 days are excluded from NRR movement components and kept in audit columns.

## Discount Expiration Treatment
Anchor: notion://notion_page_retention_policy_current#discount-expiration-treatment

Q1 2026 discount expiration is contraction, not churn; the board-prep view calls out 11 enterprise parent accounts.

## Related Evidence

- notion://notion_page_retention_policy_current#nrr-definition
- notion://notion_page_retention_policy_current#discount-expiration-treatment
- expected-answer://enterprise_nrr_q1_vs_q4_breakout
- expected-answer://enterprise_expansions_q1_2026

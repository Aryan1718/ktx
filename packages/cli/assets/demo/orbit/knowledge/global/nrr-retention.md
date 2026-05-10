---
summary: NRR is calculated at parent-account grain by calendar quarter.
tags:
  - analytics
  - retention
  - nrr
refs:
  - arr-contract-first
sl_refs:
  - orbit_demo.arr_movements
  - orbit_demo.accounts
usage_mode: auto
---

Net Revenue Retention uses parent-account rollups by calendar quarter.

The formula is starting ARR plus expansion minus contraction and churn, divided by starting ARR.

Exclude parent accounts with zero starting ARR, new business, reactivations, and internal/test accounts from the denominator.

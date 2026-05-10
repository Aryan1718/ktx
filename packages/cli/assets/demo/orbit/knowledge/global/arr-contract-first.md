---
summary: ARR uses contract-first precedence before subscription-derived revenue.
tags:
  - finance
  - arr
  - revenue
refs: []
sl_refs:
  - orbit_demo.contracts
  - orbit_demo.arr_movements
usage_mode: auto
---

ARR is calculated from active recurring contract ARR before falling back to subscription-derived revenue.

Do not double-count subscription MRR when an active contract row covers the same account and period.

Exclude cancelled contracts ending before the metric date, future-starting contracts, internal accounts, and test accounts.

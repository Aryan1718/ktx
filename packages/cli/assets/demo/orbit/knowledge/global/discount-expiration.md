---
summary: Discount expirations are tracked separately from organic contraction.
tags:
  - finance
  - retention
refs:
  - arr-contract-first
  - nrr-retention
sl_refs:
  - orbit_demo.contracts
  - orbit_demo.arr_movements
usage_mode: auto
---

Discount expiration events identify pricing changes when negotiated discounts end.

Track these separately from organic contraction so board reporting can split pricing-driven and usage-driven changes.

Use movement_reason on arr_movements when separating discount expiration from churn or seat-reduction events.

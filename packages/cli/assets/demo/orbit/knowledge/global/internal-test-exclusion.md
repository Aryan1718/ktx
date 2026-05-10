---
summary: Canonical metrics exclude internal and test accounts and users.
tags:
  - data-quality
  - governance
refs: []
sl_refs:
  - orbit_demo.accounts
usage_mode: auto
---

All canonical customer metrics exclude rows marked as internal or test fixtures.

This exclusion applies at both account and user grain when joining procurement, support, and revenue activity.

If a metric unexpectedly increases, check whether new internal or test accounts were created without proper flags.

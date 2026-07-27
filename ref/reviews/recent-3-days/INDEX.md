# Recent 3 Days Reviews

## Scope

This bucket contains only reviews that currently belong to this mutually exclusive date range. Remove rows for files moved to another bucket during rebucketing.

| Bucket | Date Range |
|---|---|
| `recent-3-days` | `reviewed_at` is within the last 3 days, inclusive |
| `recent-week` | `reviewed_at` is older than 3 days and within the last 7 days, inclusive |
| `recent-month` | `reviewed_at` is older than 7 days and within the last 30 days, inclusive |
| `history` | `reviewed_at` is older than 30 days, or missing a parseable date |

## Index Table

| reviewed_at | File | Topic | Severity Distribution |
|---|---|---|---|
| 2026-07-27 | [REVIEW_15_policy-scroll-paint.md](REVIEW_15_policy-scroll-paint.md) | Policy editor scroll backing and stable WebKit text paint | 1 MED / 1 LOW fixed; 1 prior decision superseded; native visual acceptance pending |
| 2026-07-26 | [REVIEW_14_profile-responsive-paint.md](REVIEW_14_profile-responsive-paint.md) | Responsive profile actions and stable WebKit text paint | 1 MED / 1 LOW fixed; 1 prior decision superseded; visual smoke blocked |
| 2026-07-26 | [REVIEW_13_profile-modal-containment.md](REVIEW_13_profile-modal-containment.md) | Profile overlay containment and notebook selects | 1 MED / 1 LOW fixed; 1 rejected; visual smoke blocked |
| 2026-07-26 | [REVIEW_12_backup-policy-security.md](REVIEW_12_backup-policy-security.md) | Backup policy and profile workflow audit | 2 HIGH / 3 MED / 1 LOW fixed; 2 rejected; 1 blocked |

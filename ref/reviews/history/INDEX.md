# History Reviews

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
| 2026-06-09 | [REVIEW_10.md](REVIEW_10.md) | Bun Subprocess.kill typecheck fix | 1 MED |
| 2026-05-15 | [REVIEW_9.md](REVIEW_9.md) | Deep review R1/R2 and G1-G12 closure | 24 HIGH / 28 MED / multiple LOW/INFO |
| 2026-05-14 | [REVIEW_8.md](REVIEW_8.md) | Two deep-review rounds and fix closure | 14 HIGH / 24 MED / 7 LOW |
| 2026-05-12 | [REVIEW_7.md](REVIEW_7.md) | Profile-switch process lifecycle | 7 HIGH / 3 MED / 1 LOW |
| 2026-05-11 | [REVIEW_6.md](REVIEW_6.md) | Config/profile auto-refresh races | 2 HIGH / 5 MED / 1 LOW |
| 2026-05-07 | [REVIEW_5.md](REVIEW_5.md) | Production Loading-screen root cause | 2 HIGH / 2 MED + 2 follow-ups |
| 2026-05-06 | [REVIEW_4.md](REVIEW_4.md) | CHANGELOG_8 closure review | 5 HIGH / 16 MED / 9 LOW |
| 2026-05-06 | [REVIEW_3.md](REVIEW_3.md) | Schema/CodeMirror milestone gate | 5 HIGH / 9 MED / 9 LOW |
| 2026-05-04 | [REVIEW_2.md](REVIEW_2.md) | First comprehensive code review | 3 HIGH / 13 MED / about 30 LOW |
| 2026-05-04 | [REVIEW_1.md](REVIEW_1.md) | Windows support infrastructure | 4 HIGH / 4 MED / 4 LOW |

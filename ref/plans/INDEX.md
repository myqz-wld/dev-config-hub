# Plans Index

Terminal plan documents live here. Draft or in-progress plans stay in the current environment's plan workspace; when no stronger convention exists, use `<repo>/.ref/plans/`. `.ref/` must stay ignored and must not contain terminal records.

When a plan reaches terminal state, archive the final document and plan-specific support material here, update this index, and remove workspace drafts.

## Naming

Existing historical records keep their current filenames. New final plans use `PLAN_X_<topic>.md`. Before creating one, run `ls ref/plans/`, set `X` to the maximum existing plan number in this directory plus 1, and do not guess. `<topic>` is short stable kebab-case and must not be vague like `update`, `fix`, or `misc`. Update this index in the same change.

| Plan | Status | Completed | Summary | Related Changelog/Review |
|---|---|---:|---|---|
| [deep-review-fix-20260514.md](deep-review-fix-20260514.md) | completed | 2026-05-14 | Deep review Round 1 fixes and Round 2 preparation. | [CHANGELOG_18](../changelogs/CHANGELOG_18.md), [REVIEW_8](../reviews/REVIEW_8.md) |
| [dch-secrets-dedup-20260514.md](dch-secrets-dedup-20260514.md) | completed | 2026-05-14 | Backup/restore secret deduplication and interactive value filling. | [CHANGELOG_19](../changelogs/CHANGELOG_19.md) |
| [dch-deep-review-20260515.md](dch-deep-review-20260515.md) | completed | 2026-05-15 | REVIEW_9 + CHANGELOG_21 deep review G1-G12 closeout. | [CHANGELOG_21](../changelogs/CHANGELOG_21.md), [REVIEW_9](../reviews/REVIEW_9.md) |
| [dch-deep-review-followup-20260515.md](dch-deep-review-followup-20260515.md) | completed | 2026-05-15 | REVIEW_9 follow-up F1-F4 closeout. | [CHANGELOG_22](../changelogs/CHANGELOG_22.md), [REVIEW_9](../reviews/REVIEW_9.md) |
| [build-dir-migration-20260526.md](build-dir-migration-20260526.md) | completed | 2026-05-26 | Frontend build artifacts migrated to `build/fe/`. | [CHANGELOG_23](../changelogs/CHANGELOG_23.md) |
| [PLAN_1_commit-build-metadata.md](PLAN_1_commit-build-metadata.md) | completed | 2026-06-24 | Packaged builds expose commit metadata and `dch` checks installed freshness by commit. | [CHANGELOG_34_commit-build-metadata](../changelogs/CHANGELOG_34_commit-build-metadata.md) |

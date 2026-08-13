# Workspace state persistence mapping

This artifact maps the persisted analysis-workspace snapshot before its storage
is introduced.  `repositories` remains the owner of registered repository
identity; a snapshot records only its identifier and never writes to the Git
worktree.

| Persisted field | Storage owner and identifier | Nullability | Validation and migration | Recovery behavior | Verifying test |
| --- | --- | --- | --- | --- | --- |
| snapshot ID | `workspace_snapshots.snapshot_id` (`INTEGER PRIMARY KEY AUTOINCREMENT`) | never | SQLite assigns a monotonically increasing value | The prior `current` row stays readable when a save rolls back | `workspace_snapshot_save_is_atomic_and_keeps_the_preceding_valid_snapshot` |
| lifecycle status | `workspace_snapshots.status` | never | `pending`, `current`, or `previous_valid`; unique partial index permits one current | Pending rows are never promoted after a failed transaction | `workspace_snapshot_save_is_atomic_and_keeps_the_preceding_valid_snapshot` |
| schema version | `workspace_snapshots.schema_version` | never | positive supported version; incompatible values reject the save without mutation | caller can load a prior valid snapshot | `workspace_snapshot_rejects_invalid_metadata_and_recovery_is_idempotent` |
| app version | `workspace_snapshots.app_version` | never | non-empty application version string | caller can load a prior valid snapshot | `workspace_snapshot_rejects_invalid_metadata_and_recovery_is_idempotent` |
| database format version | `workspace_snapshots.database_format_version` | never | positive supported format version | caller can load a prior valid snapshot | `workspace_snapshot_rejects_invalid_metadata_and_recovery_is_idempotent` |
| repository ID | `workspace_snapshots.repository_id` → `repositories.id` | never | foreign key and in-transaction repository lookup | caller can load a prior valid snapshot | `workspace_snapshot_rejects_unknown_repository_without_changing_current` |
| creation time | `workspace_snapshots.created_at` | never | SQLite `CURRENT_TIMESTAMP` at pending insertion | caller can load a prior valid snapshot | `workspace_snapshot_save_is_atomic_and_keeps_the_preceding_valid_snapshot` |
| workspace state payload | `workspace_snapshots.state_json` | never | valid JSON object; field-level workspace validation is owned by the workspace restore criterion | invalid payload rolls back before promotion | `workspace_snapshot_rejects_invalid_metadata_and_recovery_is_idempotent` |

## Lifecycle

1. Insert a `pending` row with generated snapshot ID and all version metadata.
2. Validate required metadata, JSON payload, and registered repository reference
   in the same transaction.
3. Remove an older `previous_valid` row, demote the existing `current` row to
   `previous_valid`, then promote the pending row to `current`.
4. Commit atomically. A failed validation or interrupted transaction rolls back
   every lifecycle write, leaving the earlier current snapshot readable.

No required field is unmapped. Later workspace-specific criteria may validate
the contents of `state_json`; they do not change the ownership or atomic
lifecycle recorded here.

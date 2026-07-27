/**
 * Stable backup facade.
 *
 * Creation is a two-step immutable snapshot: prepare scans/transforms once,
 * commit only moves that exact archive into its final slot. The legacy
 * createBackup API remains as prepare+commit for CLI and existing callers.
 */

import {
  cancelPreparedBackup,
  commitPreparedBackup,
  prepareBackup,
  type PrepareBackupOptions,
} from "./backup-pending.ts";
import type { Manifest } from "./backup-shared.ts";

export interface CreateBackupOptions extends PrepareBackupOptions {
  /** Required when effective rules retain plaintext credentials. */
  confirmRawSecrets?: boolean;
}

export interface CreateBackupResult {
  outFile: string;
  bytes: number;
  manifest: Manifest;
}

export async function createBackup(
  opts: CreateBackupOptions = {},
): Promise<CreateBackupResult> {
  const prepared = await prepareBackup(opts);
  try {
    return await commitPreparedBackup(prepared.token, {
      confirmRawSecrets: opts.confirmRawSecrets,
    });
  } catch (error) {
    await cancelPreparedBackup(prepared.token).catch(() => {});
    throw error;
  }
}

export {
  prepareBackup,
  commitPreparedBackup,
  cancelPreparedBackup,
  type PrepareBackupOptions,
  type PrepareBackupResult,
  type CommitPreparedBackupOptions,
  type CommitPreparedBackupResult,
} from "./backup-pending.ts";

export {
  FORMAT_VERSION,
  walkFiles,
  fileExists,
  tsForFilename,
  spawnSimple,
  type ManifestProfile,
  type PlaceholderEntry,
  type Manifest,
  type BackupAudit,
  type BackupPolicyAudit,
  type BackupFileAudit,
} from "./backup-shared.ts";

export {
  parseBackup,
  cleanupParsed,
  applyBackup,
  type ParseBackupResult,
  type ApplyBackupOptions,
  type ApplyBackupResult,
  type AppliedProfile,
  type SharedAction,
  type ConflictAction,
} from "./backup-restore.ts";

export {
  applyBackupWithSecrets,
  type ApplyBackupWithSecretsOptions,
  type ApplyBackupWithSecretsResult,
} from "./backup-restore-secrets.ts";

import type { BackupPolicyV1, ToolKind } from "./profiles/types.ts";
import { PROFILE_TOOL_IDS } from "./profiles/types.ts";
import {
  getProfile,
  listProfiles,
  setProfileBackupPolicy,
  setScriptsBackupEnabled,
  setScriptsBackupPolicy,
  setToolBackupPolicy,
  updateProfile,
} from "./profiles/manager.ts";
import {
  resolveProfileBackupPolicy,
  resolveScriptsBackupPolicy,
  resolveToolBackupPolicy,
} from "./profiles/backup-policy.ts";
import { isJsonMode, jsonOut, ok, parseFlags } from "./cli-shared.ts";

const PAYLOAD_ALLOWED = new Set(["payload"]);

function parsePolicy(payload: string | true | undefined): BackupPolicyV1 {
  if (typeof payload !== "string") throw new Error("--payload 需要完整备份规则 JSON");
  try {
    return JSON.parse(payload) as BackupPolicyV1;
  } catch (error) {
    throw new Error(`无法解析备份规则 JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseTool(value: string | undefined): ToolKind {
  if (!value || !PROFILE_TOOL_IDS.includes(value as ToolKind)) {
    throw new Error(`工具必须是 ${PROFILE_TOOL_IDS.join("|")}`);
  }
  return value as ToolKind;
}

export async function cmdBackupPolicy(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args, { allowedFlags: PAYLOAD_ALLOWED });
  const [operation, scope, target] = positional;
  if (!operation || !scope) {
    throw new Error(
      "用法: dch profile backup-policy <resolve|set|reset|snapshot|inherit|scripts-enabled> <tool|profile|scripts> [id] [--payload <json>]",
    );
  }

  if (operation === "resolve") {
    const store = await listProfiles();
    const resolved = scope === "tool"
      ? resolveToolBackupPolicy(store, parseTool(target))
      : scope === "profile"
      ? resolveProfileBackupPolicy(store, await getProfile(target ?? ""))
      : scope === "scripts"
      ? resolveScriptsBackupPolicy(store)
      : null;
    if (!resolved) throw new Error(`未知规则范围: ${scope}`);
    return jsonOut({ ok: true, ...resolved });
  }

  if (operation === "set") {
    const policy = parsePolicy(flags.payload);
    if (scope === "tool") await setToolBackupPolicy(parseTool(target), policy);
    else if (scope === "profile") {
      if (!target) throw new Error("方案级规则缺少 profile id");
      await setProfileBackupPolicy(target, policy);
    } else if (scope === "scripts") await setScriptsBackupPolicy(policy);
    else throw new Error(`未知规则范围: ${scope}`);
    if (isJsonMode()) return jsonOut({ ok: true });
    return ok("备份规则已保存");
  }

  if (operation === "reset") {
    if (scope === "tool") await setToolBackupPolicy(parseTool(target), null);
    else if (scope === "scripts") await setScriptsBackupPolicy(null);
    else throw new Error("reset 仅支持 tool 或 scripts");
    if (isJsonMode()) return jsonOut({ ok: true });
    return ok("已恢复工具内置规则");
  }

  if (operation === "snapshot" && scope === "profile") {
    if (!target) throw new Error("缺少 profile id");
    await setProfileBackupPolicy(target, "snapshot-effective");
    if (isJsonMode()) return jsonOut({ ok: true });
    return ok("已复制当前有效规则，方案后续不再跟随工具级变化");
  }

  if (operation === "inherit" && scope === "profile") {
    if (!target) throw new Error("缺少 profile id");
    await setProfileBackupPolicy(target, null);
    if (isJsonMode()) return jsonOut({ ok: true });
    return ok("已恢复继承工具级规则");
  }

  if (operation === "scripts-enabled" && scope === "scripts") {
    if (target !== "true" && target !== "false") {
      throw new Error("scripts-enabled 需要 true 或 false");
    }
    await setScriptsBackupEnabled(target === "true");
    if (isJsonMode()) return jsonOut({ ok: true });
    return ok(`切换脚本备份已${target === "true" ? "启用" : "停用"}`);
  }

  throw new Error(`不支持的备份规则操作: ${operation} ${scope}`);
}

export async function cmdUpdateProfile(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args, { allowedFlags: PAYLOAD_ALLOWED });
  const [id] = positional;
  if (!id || typeof flags.payload !== "string") {
    throw new Error("用法: dch profile update <id> --payload <json>");
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(flags.payload) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`无法解析方案更新 JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const allowed = new Set([
    "configDir", "description", "env", "hooks", "hookTimeoutMs",
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new Error(`方案更新不允许字段: ${key}`);
  }
  if (
    raw.hookTimeoutMs !== undefined &&
    (
      !Number.isInteger(raw.hookTimeoutMs) ||
      (raw.hookTimeoutMs as number) < 1_000 ||
      (raw.hookTimeoutMs as number) > 600_000
    )
  ) {
    throw new Error("hookTimeoutMs 必须是 1000-600000 之间的整数");
  }
  const patch = {
    ...raw,
    ...(raw.description === null ? { description: undefined } : {}),
    ...(raw.env === null ? { env: undefined } : {}),
    ...(raw.hooks === null ? { hooks: undefined } : {}),
  };
  await updateProfile(id, patch);
  const profile = await getProfile(id);
  if (isJsonMode()) return jsonOut({ ok: true, profile });
  ok(`已更新 profile ${id}`);
}

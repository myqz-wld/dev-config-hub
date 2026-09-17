import { getProfile, updateProfile } from "./profiles/manager.ts";
import { isJsonMode, jsonOut, ok, parseFlags } from "./cli-shared.ts";

const PAYLOAD_ALLOWED = new Set(["payload"]);

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
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("方案更新必须是 JSON 对象");
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

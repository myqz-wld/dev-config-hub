#!/usr/bin/env bun
import type { Profile, ToolKind, HookResult } from "./profiles/types.ts";
import {
  listProfiles, getProfile, addProfile, removeProfile,
  useProfile, initTool, getActive, testHook, setPreference,
} from "./profiles/manager.ts";
import { TOOL_PATHS } from "./profiles/symlink.ts";
import { collapseHome, expandHome, STORE_PATH } from "./profiles/store.ts";
import { defaultProfileDir } from "./profiles/defaults.ts";
import { defaultEditor } from "./platform.ts";
import { c } from "./cli-colors.ts";
import {
  createBackup, parseBackup, applyBackup, cleanupParsed,
  type Manifest, type ApplyBackupResult,
} from "./profiles/backup.ts";

const TOOLS: ToolKind[] = ["claude", "codex"];

let JSON_MODE = false;

// REVIEW_7 H1（双方实证）：Bun 在 stdout=pipe 场景下（Tauri Rust `command.output()` 调 CLI 的真实场景）
// 单次 `process.stdout.write(big)` + 立即 `process.exit(0)` 在 ≥ 65537 byte 时**必被截断到 65536 byte**
// （macOS pipe buffer 上限）。`SwitchResult.hooks[].stdout/stderr` 跑大输出 hook（npm install / 大 curl）
// 时完全可能超 64KB → UI `JSON.parse(r.stdout)` 抛 SyntaxError → 用户看到「切换失败：Unexpected end
// of JSON input」比卡死还难诊断。
//
// 实测：`process.stdout.end(cb)` 与 `'drain' event` 都不能保证 flush；**只有 `write(data, callback)`
// 的 callback 形式生效**。所有 stdout 输出统一走该模式。
function flushStdout(): Promise<void> {
  return new Promise((resolve) => {
    // 写零字节强制让 Bun 把已 buffered 的字节真正 flush 到 pipe；callback 触发即代表 OS 已收
    process.stdout.write("", () => resolve());
  });
}

async function jsonOut(data: unknown): Promise<void> {
  await new Promise<void>((resolve) => {
    process.stdout.write(JSON.stringify(data) + "\n", () => resolve());
  });
}

// 给 cmdEnv 这种「多行 export 直接走 process.stdout.write」的非 JSON 路径用：
// 同样有 65536 截断风险（codex MED-A1：cmdEnv 大 env 场景下也会被 process.exit 截断）。
async function writeOut(s: string): Promise<void> {
  await new Promise<void>((resolve) => {
    process.stdout.write(s, () => resolve());
  });
}

function err(msg: string): never {
  if (JSON_MODE) {
    // 同样要 await flush 后再 exit；但 err() 类型契约是 never（不 return），用 setImmediate 起一个微小
    // 异步窗口让 callback 触发后再 exit(1)，throw 兜类型让 TS 满意（callback 触发前 throw 同步抛出）。
    process.stdout.write(JSON.stringify({ error: msg }) + "\n", () => process.exit(1));
    // throw 让函数满足 never（callback 是异步的，throw 先于 callback 触发）
    throw new Error(msg);
  }
  console.error(`${c.red}${msg}${c.reset}`);
  process.exit(1);
}

function ok(msg: string) {
  if (JSON_MODE) return;
  console.log(`${c.green}✓${c.reset} ${msg}`);
}

function info(msg: string) {
  if (JSON_MODE) return;
  console.log(`${c.gray}${msg}${c.reset}`);
}

// 已知带值的 flag。next arg 一律当 value 收下，不再用 startsWith("--") 误判，
// 否则用户传 --pre-hook '--foo' 这类 hook 字面值会被吞。
export const VALUE_FLAGS = new Set(["dir", "desc", "from", "pre-hook", "post-hook"]);

// export 给单测（CHANGELOG_5 反复修过这块没 spec 易再退化，REVIEW_2 PR-1 补回归保护）。
// 注意：内部 `--env BADFORMAT`（缺 `=`）会调 err() 触发 process.exit(1)；单测捕获该路径。
export function parseFlags(argv: string[]): { positional: string[]; flags: Record<string, string | true>; envPairs: [string, string][] } {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  const envPairs: [string, string][] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--env" && argv[i + 1]) {
      const kv = argv[++i]!;
      const eq = kv.indexOf("=");
      if (eq < 0) err(`--env 需要 KEY=VALUE 形式: ${kv}`);
      envPairs.push([kv.slice(0, eq), kv.slice(eq + 1)]);
    } else if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && (VALUE_FLAGS.has(key) || !next.startsWith("--"))) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags, envPairs };
}

function fmtToolBadge(tool: ToolKind): string {
  return tool === "claude" ? `${c.magenta}claude${c.reset}` : `${c.cyan}codex${c.reset}`;
}

function fmtProfileLine(p: Profile, isActive: boolean): string {
  const star = isActive ? `${c.green}●${c.reset}` : ` `;
  const id = `${c.bold}${c.white}${p.id}${c.reset}`;
  const tag = fmtToolBadge(p.tool);
  const dir = `${c.gray}${p.configDir}${c.reset}`;
  const def = p.isDefault ? ` ${c.dim}(default)${c.reset}` : "";
  const desc = p.description ? `\n     ${c.gray}${p.description}${c.reset}` : "";
  const envCount = Object.keys(p.env ?? {}).length;
  const hookCount = (p.hooks?.preSwitch ? 1 : 0) + (p.hooks?.postSwitch ? 1 : 0);
  const meta = [
    envCount > 0 ? `env:${envCount}` : null,
    hookCount > 0 ? `hooks:${hookCount}` : null,
  ].filter(Boolean).join(" ");
  const metaStr = meta ? ` ${c.gray}[${meta}]${c.reset}` : "";
  return `  ${star} ${id} ${tag}${def}${metaStr}\n     ${dir}${desc}`;
}

async function cmdList() {
  const store = await listProfiles();
  if (JSON_MODE) return jsonOut(store);
  console.log(`${c.bold}${c.blue}Dev Config Hub - Profiles${c.reset}`);
  console.log(`${c.gray}${STORE_PATH}${c.reset}`);
  console.log();

  for (const tool of TOOLS) {
    const profiles = store.profiles.filter((p) => p.tool === tool);
    const activeId = store.active[tool];
    console.log(`${c.bold}${fmtToolBadge(tool)}${c.reset} ${c.gray}(${TOOL_PATHS[tool]})${c.reset}`);
    if (profiles.length === 0) {
      console.log(`  ${c.gray}(无 profile，可跑: dch profile init ${tool})${c.reset}`);
    } else {
      for (const p of profiles) console.log(fmtProfileLine(p, p.id === activeId));
    }
    console.log();
  }

  console.log(`${c.gray}hook 超时: ${c.reset}${store.preferences.hookTimeoutMs}ms`);
}

async function cmdShow(id: string) {
  const p = await getProfile(id);
  if (JSON_MODE) return jsonOut(p);
  console.log(JSON.stringify(p, null, 2));
}

async function cmdAdd(args: string[]) {
  const { positional, flags, envPairs } = parseFlags(args);
  const [toolRaw, id] = positional;
  if (!toolRaw || !id) err("用法: dch profile add <claude|codex> <id> [--dir <path>] [--env K=V ...] [--from <id>] [--desc <text>] [--pre-hook <script>] [--post-hook <script>]");
  if (!TOOLS.includes(toolRaw as ToolKind)) err(`tool 必须是 claude 或 codex (收到 ${toolRaw})`);
  const tool = toolRaw as ToolKind;

  let base: Partial<Profile> = {};
  if (flags.from && typeof flags.from === "string") {
    const src = await getProfile(flags.from);
    base = {
      tool: src.tool,
      configDir: src.configDir,
      env: { ...(src.env ?? {}) },
      hooks: { ...(src.hooks ?? {}) },
      // PR-6 (#M2)：原版漏 description → line 146 `base.description` 永远 undefined
      // → clone 出来的 profile description 永远丢失
      description: src.description,
    };
  }

  const env: Record<string, string> = { ...(base.env ?? {}) };
  for (const [k, v] of envPairs) env[k] = v;

  const preHook = typeof flags["pre-hook"] === "string" ? flags["pre-hook"] : base.hooks?.preSwitch;
  const postHook = typeof flags["post-hook"] === "string" ? flags["post-hook"] : base.hooks?.postSwitch;
  const hooks = (preHook || postHook)
    ? { ...(preHook ? { preSwitch: preHook } : {}), ...(postHook ? { postSwitch: postHook } : {}) }
    : undefined;

  const profile: Profile = {
    id,
    tool,
    configDir: typeof flags.dir === "string" ? flags.dir : (base.configDir ?? defaultProfileDir(tool, id)),
    env: Object.keys(env).length > 0 ? env : undefined,
    description: typeof flags.desc === "string" ? flags.desc : base.description,
    hooks,
  };

  await addProfile(profile);
  if (JSON_MODE) return jsonOut({ ok: true, profile });
  ok(`已添加 profile ${c.bold}${id}${c.reset} → ${profile.configDir}`);
  info(`提示: dch profile use ${id} 切换；dch profile edit ${id} 改细节`);
}

async function cmdEdit(_id: string) {
  const editor = defaultEditor();
  const proc = Bun.spawn([editor, STORE_PATH], { stdio: ["inherit", "inherit", "inherit"] });
  await proc.exited;
}

async function cmdRemove(args: string[]) {
  const { positional, flags } = parseFlags(args);
  const [id] = positional;
  if (!id) err("用法: dch profile remove <id> [--yes]");
  const p = await getProfile(id);
  if (!flags.yes) {
    process.stdout.write(`${c.yellow}确认删除 profile ${c.bold}${id}${c.reset}${c.yellow}? configDir ${p.configDir} 不会被删除。[y/N] ${c.reset}`);
    const line = await readStdinLine();
    if (line.toLowerCase() !== "y" && line.toLowerCase() !== "yes") {
      info("已取消");
      return;
    }
  }
  await removeProfile(id);
  if (JSON_MODE) return jsonOut({ ok: true, removed: id });
  ok(`已移除 profile ${id}`);
}

/**
 * stdin 单行读取 helper。Ctrl+D / EOF 视为空输入（caller 当"取消"）。
 * data / end listener 都清干净，避免 keep-alive 阻塞 dispatcher 末尾的 process.exit(0)。
 */
async function readStdinLine(): Promise<string> {
  return new Promise((resolve) => {
    let acc = "";
    process.stdin.resume();
    const onData = (d: Buffer) => {
      acc += d.toString();
      if (acc.includes("\n")) {
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stdin.removeListener("end", onEnd);
        resolve(acc.trim());
      }
    };
    const onEnd = () => {
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      resolve(acc.trim());
    };
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

function fmtHookResult(r: HookResult): string {
  const tag = r.exitCode === 0 ? `${c.green}OK${c.reset}` : `${c.red}FAIL${c.reset}`;
  const t = r.timedOut ? ` ${c.red}[超时]${c.reset}` : "";
  const head = `  ${c.bold}${r.hook}${c.reset} ${tag} ${c.gray}exit=${r.exitCode} ${r.durationMs}ms${c.reset}${t}`;
  const lines = [head];
  if (r.stdout.trim()) lines.push(`  ${c.gray}stdout:${c.reset}\n${r.stdout.trimEnd().split("\n").map((l) => "    " + l).join("\n")}`);
  if (r.stderr.trim()) lines.push(`  ${c.gray}stderr:${c.reset}\n${r.stderr.trimEnd().split("\n").map((l) => "    " + l).join("\n")}`);
  return lines.join("\n");
}

async function cmdUse(args: string[]) {
  const { positional } = parseFlags(args);
  const [id] = positional;
  if (!id) err("用法: dch profile use <id>");

  const result = await useProfile(id);
  if (JSON_MODE) return jsonOut(result);
  for (const h of result.hooks) console.log(fmtHookResult(h));

  if (!result.ok) {
    err(result.message ?? "切换失败");
  }
  ok(`已切换 ${fmtToolBadge(result.profile.tool)} → ${c.bold}${result.profile.id}${c.reset} (symlink: ${TOOL_PATHS[result.profile.tool]} → ${expandHome(result.profile.configDir)})`);
  if (result.previousActive && result.previousActive !== result.profile.id) {
    info(`先前 active: ${result.previousActive}`);
  }
}

async function cmdCurrent(args: string[]) {
  const [toolRaw] = args;
  const tools: ToolKind[] = toolRaw ? [toolRaw as ToolKind] : TOOLS;
  const result: Record<string, { id: string | null; symlinkTarget: string | null }> = {};
  for (const tool of tools) {
    if (!TOOLS.includes(tool)) err(`tool 必须是 claude 或 codex (收到 ${tool})`);
    result[tool] = await getActive(tool);
  }
  if (JSON_MODE) return jsonOut(result);
  for (const [tool, a] of Object.entries(result)) {
    const link = a.symlinkTarget ? collapseHome(a.symlinkTarget) : `${c.gray}(非 symlink)${c.reset}`;
    const id = a.id ?? `${c.gray}<未设置>${c.reset}`;
    console.log(`${fmtToolBadge(tool as ToolKind)} active=${id} symlink→${link}`);
  }
}

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

async function cmdEnv(args: string[]) {
  const [toolRaw] = args;
  if (!toolRaw || !TOOLS.includes(toolRaw as ToolKind)) {
    err("用法: dch profile env <claude|codex>");
  }
  const tool = toolRaw as ToolKind;
  const store = await listProfiles();
  const activeId = store.active[tool] ?? null;
  if (!activeId) {
    if (JSON_MODE) return jsonOut({ tool, active: null, env: {} });
    return; // wrapper 静默 fall-through
  }
  const profile = store.profiles.find((p) => p.id === activeId);
  const env = profile?.env ?? {};
  if (JSON_MODE) return jsonOut({ tool, active: activeId, env });
  for (const [k, v] of Object.entries(env)) {
    if (!ENV_KEY_RE.test(k)) continue; // 拒绝非法 key，防止 shell 注入
    // REVIEW_7 H1（codex MED-A1）：cmdEnv 大 env（多条 + 大 value）+ 上层 wrapper eval 时也会被
    // runProfileCommand 末尾的 process.exit(0) 截断到 65536 byte → wrapper eval 拿不到完整 export
    // → API key 被静默截尾 → 后续请求鉴权失败。统一走 await writeOut。
    await writeOut(`export ${k}=${shellQuote(String(v))}\n`);
  }
}

async function cmdInit(args: string[]) {
  const [toolRaw] = args;
  if (!toolRaw) err("用法: dch profile init <claude|codex>");
  if (!TOOLS.includes(toolRaw as ToolKind)) err(`tool 必须是 claude 或 codex`);
  const tool = toolRaw as ToolKind;
  const r = await initTool(tool);
  if (JSON_MODE) return jsonOut({ ok: true, ...r });
  ok(`init ${tool}: ${r.state}, default profile = ${c.bold}${r.profileId}${c.reset} → ${r.configDir}`);
  info(`现在 ${TOOL_PATHS[tool]} 是 symlink，可以用 dch profile use 切换。`);
}

async function cmdHook(args: string[]) {
  const [sub, id, which] = args;
  if (sub !== "test" || !id || (which !== "pre" && which !== "post")) {
    err("用法: dch profile hook test <id> <pre|post>");
  }
  const r = await testHook(id, which as "pre" | "post");
  if (JSON_MODE) return jsonOut(r);
  if (!r) {
    info(`profile ${id} 未配置 ${which}Switch hook`);
    return;
  }
  console.log(fmtHookResult(r));
  // REVIEW_7 H1：原 process.exit(1) 同样有 stdout 截断风险（fmtHookResult 大输出场景）。
  // 改 flushAndExit 让上面 console.log 的所有字节都 flush 到 pipe 再退；调用 await flushStdout 强制。
  if (r.exitCode !== 0) {
    await flushStdout();
    process.exit(1);
  }
}

async function cmdConfig(args: string[]) {
  const [key, value] = args;
  if (!key || value === undefined) err("用法: dch profile config hookTimeoutMs <value>");
  if (key === "hookTimeoutMs") {
    const n = Number(value);
    // REVIEW_4 M5：与 src/schemas/dch-store.ts 的 hookTimeoutMs min:1000 max:600000 + UI 三方对齐
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1000 || n > 600000) {
      err("hookTimeoutMs 必须是 1000-600000 之间的整数（毫秒，1s ~ 10 分钟）");
    }
    await setPreference("hookTimeoutMs", n);
  } else {
    err(`未知配置项: ${key}（仅支持 hookTimeoutMs）`);
  }
  if (JSON_MODE) return jsonOut({ ok: true, key, value });
  ok(`已设置 ${key} = ${value}`);
}

async function cmdBackup(args: string[]) {
  const { flags } = parseFlags(args);
  const noPlaceholder = flags["no-placeholder"] === true;
  const includeShared = flags["no-shared"] !== true;
  const yes = flags.yes === true;
  const profileIds = typeof flags.profiles === "string"
    ? flags.profiles.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const outFile = typeof flags.out === "string" ? flags.out : undefined;

  // --no-placeholder 二次确认（JSON_MODE 下必须 --yes，避免脚本误用泄露明文凭据）
  if (noPlaceholder && !yes) {
    if (JSON_MODE) {
      err("--no-placeholder 在 --json 模式下必须配 --yes（避免脚本误用泄露明文凭据）");
    }
    process.stdout.write(`${c.yellow}⚠ --no-placeholder：备份将含明文 token / API key${c.reset}\n`);
    process.stdout.write(`${c.yellow}  请确认你只在加密渠道（gpg / age / 本地）使用此包。继续? [y/N] ${c.reset}`);
    const line = await readStdinLine();
    if (line.toLowerCase() !== "y" && line.toLowerCase() !== "yes") {
      info("已取消");
      return;
    }
  }

  const result = await createBackup({ outFile, profileIds, includeShared, noPlaceholder });

  if (JSON_MODE) return jsonOut({ ok: true, ...result });
  ok(`已写入 ${result.outFile} (${formatBytes(result.bytes)})`);
  info(`包含 ${result.manifest.profiles.length} 个 profile: ${result.manifest.profiles.map((p) => p.id).join(", ")}`);
  if (result.manifest.shared.dch_scripts.length || result.manifest.shared.agents_paths.length) {
    info(`共享资源: ${result.manifest.shared.dch_scripts.length} 个 hook 脚本, ${result.manifest.shared.agents_paths.length} 个 agent 文件`);
  }
  if (result.manifest.placeholders.length > 0) {
    process.stdout.write(`${c.yellow}⚠ 已脱敏 ${result.manifest.placeholders.length} 处凭据:${c.reset}\n`);
    for (const ph of result.manifest.placeholders) {
      process.stdout.write(`  - ${ph.packPath} :: ${ph.fieldName}\n`);
    }
  }
  if (noPlaceholder) {
    process.stdout.write(`${c.red}⚠ --no-placeholder 模式：包内含明文凭据，请只通过加密渠道分享${c.reset}\n`);
  }
  info(`还原方式: dch profile restore ${result.outFile}`);
}

async function cmdRestore(args: string[]) {
  const { positional, flags } = parseFlags(args);
  const [packFile] = positional;
  if (!packFile) {
    err("用法: dch profile restore <pack> [--prefix <p>] [--rename OLD=NEW,...] [--dry-run] [--yes]");
  }

  const dryRun = flags["dry-run"] === true;
  const prefix = typeof flags.prefix === "string" ? flags.prefix : undefined;
  const renameMap: Record<string, string> = {};
  if (typeof flags.rename === "string") {
    for (const pair of flags.rename.split(",")) {
      const trimmed = pair.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) err(`--rename 格式 OLD=NEW (收到 ${trimmed})`);
      const k = trimmed.slice(0, eq).trim();
      const v = trimmed.slice(eq + 1).trim();
      if (!k || !v) err(`--rename 格式 OLD=NEW (收到 ${trimmed})`);
      renameMap[k] = v;
    }
  }

  const parsed = await parseBackup(packFile);
  try {
    const dryPlan = await applyBackup({ parsed, prefix, renameMap, dryRun: true });

    if (dryRun) {
      if (JSON_MODE) return jsonOut({ ok: true, dryRun: true, manifest: parsed.manifest, plan: dryPlan });
      printRestorePreview(parsed.manifest, dryPlan);
      return;
    }

    const result = await applyBackup({ parsed, prefix, renameMap });
    if (JSON_MODE) return jsonOut({ ok: result.errors.length === 0, manifest: parsed.manifest, ...result });

    if (result.errors.length > 0) {
      for (const e of result.errors) process.stdout.write(`${c.red}✗ ${e}${c.reset}\n`);
    }
    ok(`已还原 ${result.appliedProfiles.length} 个 profile`);
    for (const ap of result.appliedProfiles) {
      const tag = ap.conflict === "none" ? "" : ` ${c.gray}[${ap.conflict}]${c.reset}`;
      info(`  ${ap.originalId} → ${c.bold}${ap.finalId}${c.reset} (${ap.configDir})${tag}`);
    }
    if (result.sharedActions.length > 0) {
      info(`共享资源 ${result.sharedActions.length} 项:`);
      for (const sa of result.sharedActions) {
        info(`  ${sa.category} ${sa.relPath} → ${sa.action}`);
      }
    }
    if (result.placeholders.length > 0) {
      process.stdout.write(`${c.yellow}待填占位符 ${result.placeholders.length} 处:${c.reset}\n`);
      for (const ph of result.placeholders) {
        process.stdout.write(`  ${ph.hostPath ?? ph.packPath} :: ${ph.fieldName} — ${ph.hint}\n`);
      }
      info(`填完后跑: dch profile use <id>`);
    }
  } finally {
    await cleanupParsed(parsed);
  }
}

function printRestorePreview(manifest: Manifest, plan: ApplyBackupResult): void {
  console.log(`${c.bold}${c.blue}DRY-RUN — 不会修改文件${c.reset}\n`);
  console.log(`${c.bold}来源：${c.reset}${manifest.source_user}@${manifest.source_host} · ${manifest.created_at}`);
  console.log(`${c.bold}DCH 版本：${c.reset}${manifest.dch_version}`);
  if (manifest.options.no_placeholder) {
    console.log(`${c.red}⚠ 包内含明文凭据 (--no-placeholder 模式)${c.reset}`);
  }
  console.log();

  console.log(`${c.bold}待还原 profile (${plan.appliedProfiles.length}):${c.reset}`);
  for (const ap of plan.appliedProfiles) {
    const tag = ap.conflict === "none"
      ? `${c.gray}无冲突 ✓${c.reset}`
      : `${c.yellow}${ap.conflict}${c.reset}`;
    console.log(`  ${ap.originalId} → ${c.bold}${ap.finalId}${c.reset} (${ap.configDir}) ${tag}`);
  }

  if (plan.sharedActions.length > 0) {
    console.log(`\n${c.bold}共享资源:${c.reset}`);
    for (const sa of plan.sharedActions) {
      console.log(`  ${sa.category} ${sa.relPath} → ${sa.action}`);
    }
  }

  if (plan.placeholders.length > 0) {
    console.log(`\n${c.bold}${c.yellow}待填占位符 (${plan.placeholders.length}):${c.reset}`);
    for (const ph of plan.placeholders) {
      console.log(`  ${ph.hostPath ?? ph.packPath} :: ${ph.fieldName} — ${ph.hint}`);
    }
  }

  if (plan.errors.length > 0) {
    console.log(`\n${c.bold}${c.red}错误 (${plan.errors.length}):${c.reset}`);
    for (const e of plan.errors) console.log(`  ${e}`);
  }
}

function help() {
  console.log(`${c.bold}${c.blue}dch profile${c.reset} - Profile 快速切换

${c.bold}子命令:${c.reset}
  ${c.cyan}list${c.reset}                          列出所有 profile
  ${c.cyan}show${c.reset}    <id>                  打印 profile JSON
  ${c.cyan}add${c.reset}     <claude|codex> <id>   添加 profile [--dir <path>] [--env K=V ...] [--from <id>] [--desc <text>] [--pre-hook <script>] [--post-hook <script>]
  ${c.cyan}edit${c.reset}    <id>                  $EDITOR 打开 ${STORE_PATH}
  ${c.cyan}remove${c.reset}  <id>                  删除 profile (不删 configDir) [--yes]
  ${c.cyan}use${c.reset}     <id>                  原子切换 ~/.claude / ~/.codex symlink + 跑 pre/post hook
  ${c.cyan}current${c.reset} [tool]                查询当前 active
  ${c.cyan}env${c.reset}     <claude|codex>        输出当前 active profile.env 为 shell-eval 格式（供 shell wrapper 注入到 claude / codex 进程）
  ${c.cyan}init${c.reset}    <claude|codex>        把 ~/.claude / ~/.codex 转成 symlink，建立 default profile
  ${c.cyan}hook test${c.reset} <id> <pre|post>     单独运行 hook 测试
  ${c.cyan}config${c.reset}  hookTimeoutMs <ms>    设置 hook 超时
  ${c.cyan}backup${c.reset}                        备份所有 profile + 共享资源到 .dchpack
                                  [--out <file>] [--profiles <id1,id2>] [--no-shared] [--no-placeholder] [--yes]
  ${c.cyan}restore${c.reset} <pack>                还原 .dchpack（自动加 -restored-<TS> 后缀避免撞名）
                                  [--prefix <p>] [--rename OLD=NEW,...] [--dry-run] [--yes]

${c.bold}env 变量 (hook 内可用):${c.reset}
  DCH_PROFILE_ID, DCH_PROFILE_TOOL, DCH_PROFILE_CONFIG_DIR
  DCH_SWITCH_TO, DCH_SWITCH_FROM (首次 init 后可能为空)
`);
}

export async function runProfileCommand(args: string[]): Promise<void> {
  if (args.includes("--json")) {
    JSON_MODE = true;
    args = args.filter((a) => a !== "--json");
  }
  const [sub, ...rest] = args;

  // REVIEW_7 H7（codex HIGH-A3 实证）：runHook 内 Promise.race 输掉的 setTimeout 仍保活 bun
  // event loop（实测 hook=`echo ok` 函数 3ms 返回但 bun 进程总耗时 4510ms ≈ timeoutMs+1000ms）。
  // REVIEW_2 H1 detach 子进程（hook 内 `(sleep N &)`）继承 bun stdio pipe FD 让 ReadableStream
  // pump 永挂同样让 bun 不退。
  // 兜底：所有 profile 子命令走完后 await flushStdout + process.exit(0) 强退，让 Tauri Rust
  // `command.output()` 立即拿到结果，UI 不卡。
  // 例外：cmdEdit 走 spawn editor + await proc.exited（vim/nano 长时交互），不能强退；提前 return。
  if (sub === "edit") {
    if (!rest[0]) err("用法: dch profile edit <id>");
    return cmdEdit(rest[0]);
  }

  // 路由：所有非 edit 子命令统一 await，让 cmd 内部 await（loadStore/saveStore/runHook/jsonOut/...）
  // 全 settle 才到末尾兜底强退。jsonOut 已改 async + write callback，process.exit 不会截断 stdout
  // （详 REVIEW_7 H1 + 本文件顶部 flushStdout/jsonOut 注释）。
  if (!sub || sub === "list") await cmdList();
  else if (sub === "show") rest[0] ? await cmdShow(rest[0]) : err("用法: dch profile show <id>");
  else if (sub === "add") await cmdAdd(rest);
  else if (sub === "remove" || sub === "rm") await cmdRemove(rest);
  else if (sub === "use") await cmdUse(rest);
  else if (sub === "current") await cmdCurrent(rest);
  else if (sub === "env") await cmdEnv(rest);
  else if (sub === "init") await cmdInit(rest);
  else if (sub === "hook") await cmdHook(rest);
  else if (sub === "config") await cmdConfig(rest);
  else if (sub === "backup") await cmdBackup(rest);
  else if (sub === "restore") await cmdRestore(rest);
  else if (sub === "--help" || sub === "-h" || sub === "help") help();
  else err(`未知子命令: ${sub}\n跑 dch profile --help 查看用法`);

  // 统一兜底强退：先 flush stdout（防 65536 截断 — 双 reviewer 实测 macOS pipe buffer 边界），
  // 再 exit(0) 干掉 race 输掉的 setTimeout / detach 孙子持 pipe FD 等任何 keep-alive task。
  await flushStdout();
  process.exit(0);
}

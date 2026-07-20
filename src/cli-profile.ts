#!/usr/bin/env bun
import { PROFILE_TOOL_IDS, type Profile, type ToolKind, type HookResult } from "./profiles/types.ts";
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
  setJsonMode, isJsonMode, flushStdout, jsonOut, writeOut, err, ok, info,
  parseFlags, readStdinLine, VALUE_FLAGS,
} from "./cli-shared.ts";
import {
  cmdBackup, cmdRestore, cmdBackups, cmdBackupRm, cmdBackupPin,
} from "./cli-backup.ts";

// 兼容旧 import 路径（src/profiles/manager.test.ts 等导入 parseFlags / VALUE_FLAGS / readStdinLine）
export { parseFlags, VALUE_FLAGS } from "./cli-shared.ts";

/**
 * REVIEW_8 M10 / B5：从 args 中剥离 `--json` 全局 flag，但**不能**误吃其它 flag 的值。
 *
 * 旧实现 `args.filter((a) => a !== "--json")` 在场景 `add ... --desc --json` 下把 `--json`
 * 字面值（作为 desc 的 value）一并 strip → cmdAdd 拿到 desc=undefined（被 parseFlags 当成
 * boolean true）+ JSON_MODE 错误启用。
 *
 * 修复：单 pass 扫描 args，遇到 VALUE_FLAGS 中的 flag 时跳过下一个 arg（视为 value），
 * 其余位置的 `--json` 标记并 strip。
 */
function extractJsonFlag(argv: string[]): { args: string[]; json: boolean } {
  const out: string[] = [];
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    // 已知带值的 flag → 透传 flag 本身 + 下一个 arg（即便它是 "--json"）
    if (a.startsWith("--") && VALUE_FLAGS.has(a.slice(2)) && argv[i + 1] !== undefined) {
      out.push(a, argv[++i]!);
      continue;
    }
    if (a === "--json") {
      json = true;
      continue;
    }
    out.push(a);
  }
  return { args: out, json };
}

const TOOLS: ToolKind[] = [...PROFILE_TOOL_IDS];
const TOOL_USAGE = PROFILE_TOOL_IDS.join("|");

function fmtToolBadge(tool: ToolKind): string {
  const color = {
    claude: c.magenta,
    codex: c.cyan,
    grok: c.green,
    cursor: c.blue,
  }[tool];
  return `${color}${tool}${c.reset}`;
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

// REVIEW_8 M11 / B6：每个 cmd 显式 allowed flag 集合（防 `--no-share` 这类 typo 被静默吞）。
const ADD_ALLOWED = new Set(["dir", "from", "desc", "pre-hook", "post-hook"]);
const REMOVE_ALLOWED = new Set(["yes"]);

async function cmdList() {
  const store = await listProfiles();
  if (isJsonMode()) return jsonOut(store);
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
  if (isJsonMode()) return jsonOut(p);
  console.log(JSON.stringify(p, null, 2));
}

async function cmdAdd(args: string[]) {
  const { positional, flags, envPairs } = parseFlags(args, { allowedFlags: ADD_ALLOWED });
  const [toolRaw, id] = positional;
  if (!toolRaw || !id) err(`用法: dch profile add <${TOOL_USAGE}> <id> [--dir <path>] [--env K=V ...] [--from <id>] [--desc <text>] [--pre-hook <script>] [--post-hook <script>]`);
  if (!TOOLS.includes(toolRaw as ToolKind)) err(`tool 必须是 ${TOOL_USAGE} 之一 (收到 ${toolRaw})`);
  const tool = toolRaw as ToolKind;

  let base: Partial<Profile> = {};
  if (flags.from && typeof flags.from === "string") {
    const src = await getProfile(flags.from);
    if (src.tool !== tool) {
      err(`--from ${src.id} 属于 ${src.tool}，不能复制到 ${tool}`);
    }
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
  if (isJsonMode()) return jsonOut({ ok: true, profile });
  ok(`已添加 profile ${c.bold}${id}${c.reset} → ${profile.configDir}`);
  info(`提示: dch profile use ${id} 切换；dch profile edit ${id} 改细节`);
}

async function cmdEdit(_id: string) {
  const editor = defaultEditor();
  const proc = Bun.spawn([editor, STORE_PATH], { stdio: ["inherit", "inherit", "inherit"] });
  await proc.exited;
}

async function cmdRemove(args: string[]) {
  const { positional, flags } = parseFlags(args, { allowedFlags: REMOVE_ALLOWED });
  const [id] = positional;
  if (!id) err("用法: dch profile remove <id> [--yes]");
  const p = await getProfile(id);
  // REVIEW_8 H6 / B2：json 模式（Tauri UI / 脚本调用）不允许走 stdin prompt —
  // 进程没绑 TTY 会 hang 等 EOF；强制要求 --yes 与 cmdBackup --no-placeholder 同款约束。
  if (!flags.yes) {
    if (isJsonMode()) {
      err("--json 模式必须配 --yes（无法 stdin prompt）");
    }
    process.stdout.write(`${c.yellow}确认删除 profile ${c.bold}${id}${c.reset}${c.yellow}? configDir ${p.configDir} 不会被删除。[y/N] ${c.reset}`);
    const line = await readStdinLine();
    if (line.toLowerCase() !== "y" && line.toLowerCase() !== "yes") {
      info("已取消");
      return;
    }
  }
  await removeProfile(id);
  if (isJsonMode()) return jsonOut({ ok: true, removed: id });
  ok(`已移除 profile ${id}`);
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
  if (isJsonMode()) {
    await jsonOut(result);
    // REVIEW_8 H6 / B3：useProfile 返回 {ok: false, message} 表 hook 失败 / symlink swap 失败。
    // 旧路径 jsonOut 后 return → dispatcher 落到 process.exit(0)，Tauri bridge 看到 code=0
    // + 解析 stdout JSON 拿到 ok:false，但没法和「真 exit 0 + stdout 是别的 JSON」区分 → 误判。
    // 这里用 exit(1) 让 r.code !== 0 在 bridge 端立即被 throw。
    if (!result.ok) process.exit(1);
    return;
  }
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
    if (!TOOLS.includes(tool)) err(`tool 必须是 ${TOOL_USAGE} 之一 (收到 ${tool})`);
    result[tool] = await getActive(tool);
  }
  if (isJsonMode()) return jsonOut(result);
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
    err(`用法: dch profile env <${TOOL_USAGE}>`);
  }
  const tool = toolRaw as ToolKind;
  const store = await listProfiles();
  const activeId = store.active[tool] ?? null;
  if (!activeId) {
    if (isJsonMode()) return jsonOut({ tool, active: null, env: {} });
    return; // wrapper 静默 fall-through
  }
  const profile = store.profiles.find((p) => p.id === activeId);
  const env = profile?.env ?? {};
  if (isJsonMode()) return jsonOut({ tool, active: activeId, env });
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
  if (!toolRaw) err(`用法: dch profile init <${TOOL_USAGE}>`);
  if (!TOOLS.includes(toolRaw as ToolKind)) err(`tool 必须是 ${TOOL_USAGE} 之一`);
  const tool = toolRaw as ToolKind;
  const r = await initTool(tool);
  if (isJsonMode()) return jsonOut({ ok: true, ...r });
  ok(`init ${tool}: ${r.state}, default profile = ${c.bold}${r.profileId}${c.reset} → ${r.configDir}`);
  info(`现在 ${TOOL_PATHS[tool]} 是 symlink，可以用 dch profile use 切换。`);
}

async function cmdHook(args: string[]) {
  const [sub, id, which] = args;
  if (sub !== "test" || !id || (which !== "pre" && which !== "post")) {
    err("用法: dch profile hook test <id> <pre|post>");
  }
  const r = await testHook(id, which as "pre" | "post");
  if (isJsonMode()) return jsonOut(r);
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
  if (isJsonMode()) return jsonOut({ ok: true, key, value });
  ok(`已设置 ${key} = ${value}`);
}

function help() {
  console.log(`${c.bold}${c.blue}dch profile${c.reset} - Profile 快速切换

${c.bold}子命令:${c.reset}
  ${c.cyan}list${c.reset}                          列出所有 profile
  ${c.cyan}show${c.reset}    <id>                  打印 profile JSON
  ${c.cyan}add${c.reset}     <${TOOL_USAGE}> <id>   添加 profile [--dir <path>] [--env K=V ...] [--from <id>] [--desc <text>] [--pre-hook <script>] [--post-hook <script>]
  ${c.cyan}edit${c.reset}    <id>                  $EDITOR 打开 ${STORE_PATH}
  ${c.cyan}remove${c.reset}  <id>                  删除 profile (不删 configDir) [--yes]
  ${c.cyan}use${c.reset}     <id>                  原子切换工具配置根目录 symlink/junction + 跑 pre/post hook
  ${c.cyan}current${c.reset} [tool]                查询当前 active
  ${c.cyan}env${c.reset}     <${TOOL_USAGE}>        输出当前 active profile.env 为 shell-eval 格式
  ${c.cyan}init${c.reset}    <${TOOL_USAGE}>        接管工具用户配置根目录并建立 default profile
  ${c.cyan}hook test${c.reset} <id> <pre|post>     单独运行 hook 测试
  ${c.cyan}config${c.reset}  hookTimeoutMs <ms>    设置 hook 超时

${c.bold}备份 / 还原:${c.reset}
  ${c.cyan}backup${c.reset}                        备份所有 profile + 共享资源到 .dchpack
                                  默认覆盖 ~/.dch/backups/latest.dchpack（默认位）
                                  [--keep] 保留为 dch-backup-<TS>.dchpack 历史副本
                                  [--out <file>] [--profiles <id1,id2>] [--no-shared] [--no-placeholder] [--yes]
  ${c.cyan}restore${c.reset} <pack>                还原 .dchpack（自动加 -restored-<TS> 后缀避免撞名）
                                  [--prefix <p>] [--rename OLD=NEW,...] [--dry-run] [--yes]
  ${c.cyan}backups${c.reset}                       列出所有 .dchpack（默认位 / 置顶 / 历史 三组）
  ${c.cyan}backup-rm${c.reset} <file>              删除指定备份（basename 或绝对路径）[--yes]
  ${c.cyan}backup-pin${c.reset} <file>             置顶备份不被覆盖（默认位 → 复制副本 + 置顶；其他 → 原地置顶）[--unpin]

${c.bold}env 变量 (hook 内可用):${c.reset}
  DCH_PROFILE_ID, DCH_PROFILE_TOOL, DCH_PROFILE_CONFIG_DIR
  DCH_SWITCH_TO, DCH_SWITCH_FROM (首次 init 后可能为空)
`);
}

export async function runProfileCommand(args: string[]): Promise<void> {
  // REVIEW_8 M10 / B5：走 VALUE_FLAGS-aware 提取，避免误吃 `--desc --json` 这类的 value。
  const extracted = extractJsonFlag(args);
  if (extracted.json) {
    setJsonMode(true);
    args = extracted.args;
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
  // （详 REVIEW_7 H1 + cli-shared.ts 顶部 flushStdout/jsonOut 注释）。
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
  else if (sub === "backups") await cmdBackups(rest);
  else if (sub === "backup-rm") await cmdBackupRm(rest);
  else if (sub === "backup-pin") await cmdBackupPin(rest);
  else if (sub === "--help" || sub === "-h" || sub === "help") help();
  else err(`未知子命令: ${sub}\n跑 dch profile --help 查看用法`);

  // 统一兜底强退：先 flush stdout（防 65536 截断 — 双 reviewer 实测 macOS pipe buffer 边界），
  // 再 exit(0) 干掉 race 输掉的 setTimeout / detach 孙子持 pipe FD 等任何 keep-alive task。
  await flushStdout();
  process.exit(0);
}

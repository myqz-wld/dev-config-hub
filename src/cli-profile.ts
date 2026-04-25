#!/usr/bin/env bun
import type { Profile, ToolKind, SwitchMode, TerminalApp, HookResult } from "./profiles/types.ts";
import {
  listProfiles, getProfile, addProfile, updateProfile, removeProfile,
  useProfile, initTool, getActive, testHook, setPreference,
} from "./profiles/manager.ts";
import { TOOL_PATHS } from "./profiles/symlink.ts";
import { collapseHome, expandHome, STORE_PATH } from "./profiles/store.ts";
import { c } from "./cli-colors.ts";

const TOOLS: ToolKind[] = ["claude", "codex"];
const TERMINALS: TerminalApp[] = ["Terminal", "iTerm", "Ghostty"];
const MODES: SwitchMode[] = ["env", "symlink"];

let JSON_MODE = false;

function jsonOut(data: unknown) {
  process.stdout.write(JSON.stringify(data) + "\n");
}

function err(msg: string): never {
  if (JSON_MODE) {
    process.stdout.write(JSON.stringify({ error: msg }) + "\n");
    process.exit(1);
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

function parseFlags(argv: string[]): { positional: string[]; flags: Record<string, string | true>; envPairs: [string, string][] } {
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
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
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

  console.log(`${c.gray}默认模式: ${c.reset}${store.preferences.defaultMode}  ${c.gray}终端: ${c.reset}${store.preferences.terminal}  ${c.gray}hook 超时: ${c.reset}${store.preferences.hookTimeoutMs}ms`);
}

async function cmdShow(id: string) {
  const p = await getProfile(id);
  if (JSON_MODE) return jsonOut(p);
  console.log(JSON.stringify(p, null, 2));
}

async function cmdAdd(args: string[]) {
  const { positional, flags, envPairs } = parseFlags(args);
  const [toolRaw, id] = positional;
  if (!toolRaw || !id) err("用法: dch profile add <claude|codex> <id> [--dir <path>] [--env K=V ...] [--from <id>] [--desc <text>]");
  if (!TOOLS.includes(toolRaw as ToolKind)) err(`tool 必须是 claude 或 codex (收到 ${toolRaw})`);
  const tool = toolRaw as ToolKind;

  let base: Partial<Profile> = {};
  if (flags.from && typeof flags.from === "string") {
    const src = await getProfile(flags.from);
    base = { tool: src.tool, configDir: src.configDir, env: { ...(src.env ?? {}) }, hooks: { ...(src.hooks ?? {}) } };
  }

  const env: Record<string, string> = { ...(base.env ?? {}) };
  for (const [k, v] of envPairs) env[k] = v;

  const profile: Profile = {
    id,
    tool,
    configDir: typeof flags.dir === "string" ? flags.dir : (base.configDir ?? `~/.${tool}-${id}`),
    env: Object.keys(env).length > 0 ? env : undefined,
    description: typeof flags.desc === "string" ? flags.desc : base.description,
    hooks: base.hooks && (base.hooks.preSwitch || base.hooks.postSwitch) ? base.hooks : undefined,
  };

  await addProfile(profile);
  if (JSON_MODE) return jsonOut({ ok: true, profile });
  ok(`已添加 profile ${c.bold}${id}${c.reset} → ${profile.configDir}`);
  info(`提示: 用 dch profile edit ${id} 添加 hooks，或 dch profile use ${id} 直接切换`);
}

async function cmdEdit(_id: string) {
  const editor = process.env.EDITOR || process.env.VISUAL || "vi";
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
    const line = await new Promise<string>((res) => {
      const buf: Buffer[] = [];
      process.stdin.resume();
      process.stdin.on("data", (d) => {
        buf.push(d);
        if (d.toString().includes("\n")) {
          process.stdin.pause();
          res(Buffer.concat(buf).toString().trim());
        }
      });
    });
    if (line.toLowerCase() !== "y" && line.toLowerCase() !== "yes") {
      info("已取消");
      return;
    }
  }
  await removeProfile(id);
  if (JSON_MODE) return jsonOut({ ok: true, removed: id });
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
  const { positional, flags } = parseFlags(args);
  const [id] = positional;
  if (!id) err("用法: dch profile use <id> [--mode env|symlink] [--terminal Terminal|iTerm|Ghostty]");

  const mode = flags.mode as SwitchMode | undefined;
  if (mode && !MODES.includes(mode)) err(`--mode 必须是 ${MODES.join("/")}`);
  const terminal = flags.terminal as TerminalApp | undefined;
  if (terminal && !TERMINALS.includes(terminal)) err(`--terminal 必须是 ${TERMINALS.join("/")}`);

  const result = await useProfile(id, { mode, terminal });
  if (JSON_MODE) return jsonOut(result);
  for (const h of result.hooks) console.log(fmtHookResult(h));

  if (!result.ok) {
    err(result.message ?? "切换失败");
  }
  if (result.mode === "symlink") {
    ok(`已切换 ${fmtToolBadge(result.profile.tool)} → ${c.bold}${result.profile.id}${c.reset} (symlink: ${TOOL_PATHS[result.profile.tool]} → ${expandHome(result.profile.configDir)})`);
    if (result.previousActive) info(`先前 active: ${result.previousActive}`);
  } else {
    ok(`已启动 ${result.spawnedTerminal} 新窗口，注入 ${result.profile.tool === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME"}=${expandHome(result.profile.configDir)}`);
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
  if (r.exitCode !== 0) process.exit(1);
}

async function cmdConfig(args: string[]) {
  const [key, value] = args;
  if (!key || value === undefined) err("用法: dch profile config <terminal|defaultMode|hookTimeoutMs> <value>");
  if (key === "terminal") {
    if (!TERMINALS.includes(value as TerminalApp)) err(`terminal 必须是 ${TERMINALS.join("/")}`);
    await setPreference("terminal", value as TerminalApp);
  } else if (key === "defaultMode") {
    if (!MODES.includes(value as SwitchMode)) err(`defaultMode 必须是 ${MODES.join("/")}`);
    await setPreference("defaultMode", value as SwitchMode);
  } else if (key === "hookTimeoutMs") {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) err("hookTimeoutMs 必须是正数");
    await setPreference("hookTimeoutMs", n);
  } else {
    err(`未知配置项: ${key}`);
  }
  if (JSON_MODE) return jsonOut({ ok: true, key, value });
  ok(`已设置 ${key} = ${value}`);
}

function help() {
  console.log(`${c.bold}${c.blue}dch profile${c.reset} - Profile 快速切换

${c.bold}子命令:${c.reset}
  ${c.cyan}list${c.reset}                          列出所有 profile
  ${c.cyan}show${c.reset}    <id>                  打印 profile JSON
  ${c.cyan}add${c.reset}     <claude|codex> <id>   添加 profile [--dir <path>] [--env K=V ...] [--from <id>] [--desc <text>]
  ${c.cyan}edit${c.reset}    <id>                  $EDITOR 打开 ${STORE_PATH}
  ${c.cyan}remove${c.reset}  <id>                  删除 profile (不删 configDir) [--yes]
  ${c.cyan}use${c.reset}     <id>                  切换 [--mode env|symlink] [--terminal Terminal|iTerm|Ghostty]
  ${c.cyan}current${c.reset} [tool]                查询当前 active
  ${c.cyan}init${c.reset}    <claude|codex>        把 ~/.claude / ~/.codex 转成 symlink，建立 default profile
  ${c.cyan}hook test${c.reset} <id> <pre|post>     单独运行 hook 测试
  ${c.cyan}config${c.reset}  <key> <value>         设置 preferences (terminal/defaultMode/hookTimeoutMs)

${c.bold}env 变量 (hook 内可用):${c.reset}
  DCH_PROFILE_ID, DCH_PROFILE_TOOL, DCH_PROFILE_CONFIG_DIR
  DCH_SWITCH_FROM (仅 symlink 模式), DCH_SWITCH_TO, DCH_SWITCH_MODE
`);
}

export async function runProfileCommand(args: string[]): Promise<void> {
  if (args.includes("--json")) {
    JSON_MODE = true;
    args = args.filter((a) => a !== "--json");
  }
  const [sub, ...rest] = args;
  if (!sub || sub === "list") return cmdList();
  if (sub === "show") return rest[0] ? cmdShow(rest[0]) : err("用法: dch profile show <id>");
  if (sub === "add") return cmdAdd(rest);
  if (sub === "edit") return rest[0] ? cmdEdit(rest[0]) : err("用法: dch profile edit <id>");
  if (sub === "remove" || sub === "rm") return cmdRemove(rest);
  if (sub === "use") return cmdUse(rest);
  if (sub === "current") return cmdCurrent(rest);
  if (sub === "init") return cmdInit(rest);
  if (sub === "hook") return cmdHook(rest);
  if (sub === "config") return cmdConfig(rest);
  if (sub === "--help" || sub === "-h" || sub === "help") return help();
  err(`未知子命令: ${sub}\n跑 dch profile --help 查看用法`);
}

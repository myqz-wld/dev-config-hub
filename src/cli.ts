#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve as pathResolve } from "node:path";
import type { ToolConfig, ConfigScope } from "./types.ts";
import { readShellConfig } from "./readers/shell.ts";
import { readClaudeCodeConfig } from "./readers/claude-code.ts";
import { readCodexConfig } from "./readers/codex.ts";
import { runProfileCommand } from "./cli-profile.ts";
import { c, LEVEL_COLORS } from "./cli-colors.ts";
import { HOME, defaultEditor } from "./platform.ts";
import { isJsonMode, jsonOut } from "./cli-shared.ts";

type BuildInfo = {
  name?: string;
  productName?: string;
  version?: string;
  commit?: string;
  shortCommit?: string;
  branch?: string;
  dirty?: boolean;
  builtAt?: string;
};

const PROJECT_ROOT = pathResolve(import.meta.dir, "..");

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function git(args: string[]): string | null {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: PROJECT_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return null;
  return new TextDecoder().decode(result.stdout).trim();
}

function installedBuildInfoPath(): string {
  const appPath = process.env.DCH_APP_PATH || process.env.DEV_CONFIG_HUB_APP || "/Applications/Dev Config Hub.app";
  if (appPath.endsWith(".app")) {
    return join(appPath, "Contents", "Resources", "build-info.json");
  }
  const bundleIndex = appPath.indexOf(".app/");
  if (bundleIndex >= 0) {
    return join(appPath.slice(0, bundleIndex + ".app".length), "Contents", "Resources", "build-info.json");
  }
  return join(dirname(appPath), "resources", "build-info.json");
}

async function projectVersion(): Promise<string> {
  const config = await readJsonFile<{ version?: string }>(join(PROJECT_ROOT, "src-tauri", "tauri.conf.json"));
  return config?.version ?? "unknown";
}

async function renderVersionStatus(checkOnly: boolean): Promise<number> {
  const version = await projectVersion();
  const sourceCommit = git(["rev-parse", "HEAD"]) ?? "unknown";
  const sourceShort = git(["rev-parse", "--short=12", "HEAD"]) ?? "unknown";
  const originMain = git(["rev-parse", "--verify", "--quiet", "origin/main"]);
  const originShort = originMain ? git(["rev-parse", "--short=12", "--verify", "--quiet", "origin/main"]) : null;
  const sourceDirty = Boolean(git(["status", "--porcelain"]));
  const buildInfoPath = installedBuildInfoPath();
  const installed = existsSync(buildInfoPath) ? await readJsonFile<BuildInfo>(buildInfoPath) : null;

  console.log(`${c.bold}${c.blue}Dev Config Hub${c.reset} ${c.gray}v${version}${c.reset}`);
  console.log(`  ${c.gray}source commit:${c.reset} ${sourceCommit} (${sourceShort})`);
  console.log(`  ${c.gray}source dirty:${c.reset} ${sourceDirty}`);
  if (originMain) {
    console.log(`  ${c.gray}origin/main:${c.reset} ${originMain} (${originShort ?? "unknown"})`);
  }

  if (!installed) {
    console.log(`  ${c.gray}installed build-info:${c.reset} 未找到`);
    console.log(`  ${c.gray}path:${c.reset} ${buildInfoPath}`);
    console.log(`  ${c.gray}status:${c.reset} 无法按 commit 判断安装包是否最新`);
    return checkOnly ? 2 : 0;
  }

  console.log(`  ${c.gray}installed commit:${c.reset} ${installed.commit ?? "unknown"} (${installed.shortCommit ?? "unknown"})`);
  console.log(`  ${c.gray}installed branch:${c.reset} ${installed.branch ?? "unknown"}`);
  console.log(`  ${c.gray}installed dirty:${c.reset} ${installed.dirty ?? "unknown"}`);
  console.log(`  ${c.gray}built at:${c.reset} ${installed.builtAt ?? "unknown"}`);

  if (installed.commit === sourceCommit) {
    const dirtySuffix = sourceDirty ? "，但当前源码有未提交改动" : "";
    console.log(`  ${c.gray}status:${c.reset} 安装包与当前 checkout commit 一致${dirtySuffix}`);
    return 0;
  }
  if (originMain && installed.commit === originMain) {
    console.log(`  ${c.gray}status:${c.reset} 安装包与 origin/main 一致，但不同于当前 checkout`);
    return checkOnly ? 1 : 0;
  }
  console.log(`  ${c.gray}status:${c.reset} 安装包不是当前 checkout 构建`);
  return checkOnly ? 1 : 0;
}

function renderScope(scope: ConfigScope): string {
  const lines: string[] = [];
  const levelColor = LEVEL_COLORS[scope.level] || c.gray;
  const exists = scope.exists ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
  lines.push(`  ${levelColor}${c.bold}[${scope.level.toUpperCase()}]${c.reset} ${exists} ${c.white}${scope.label}${c.reset} ${c.gray}(${scope.format})${c.reset}`);

  if (!scope.exists) {
    lines.push(`    ${c.gray}文件不存在${c.reset}`);
    return lines.join("\n");
  }

  const contentLines = scope.content.split("\n");
  if (!scope.content || contentLines.every((l) => !l.trim())) {
    lines.push(`    ${c.gray}(空文件)${c.reset}`);
    return lines.join("\n");
  }

  for (const line of contentLines) {
    if (line.trimStart().startsWith("#")) {
      lines.push(`    ${c.gray}${line}${c.reset}`);
    } else {
      lines.push(`    ${c.white}${line}${c.reset}`);
    }
  }
  return lines.join("\n");
}

function renderTool(tool: ToolConfig): string {
  const lines: string[] = [];
  lines.push(`${c.bold}${c.white}${tool.name}${c.reset} ${c.gray}v${tool.version}${c.reset}`);
  lines.push(`${c.gray}${tool.description}${c.reset}`);
  lines.push("");

  for (const scope of tool.scopes) {
    lines.push(renderScope(scope));
    lines.push("");
  }

  return lines.join("\n");
}

function renderOverview(tools: ToolConfig[]): string {
  const lines: string[] = [];
  lines.push(`${c.bold}${c.blue}Dev Config Hub${c.reset} ${c.gray}— 开发工具配置查看器${c.reset}`);
  lines.push("");

  for (const tool of tools) {
    const scopeInfo = tool.scopes.map((s) => {
      const color = LEVEL_COLORS[s.level] || c.gray;
      const mark = s.exists ? `${c.green}✓${c.reset}` : `${c.gray}·${c.reset}`;
      return `${mark} ${color}${s.label}${c.reset}`;
    }).join("  ");
    lines.push(`  ${c.bold}${tool.name}${c.reset} ${c.gray}v${tool.version}${c.reset}`);
    lines.push(`  ${scopeInfo}`);
    lines.push("");
  }

  lines.push(`${c.gray}用法: dch <tool> [--edit <file>]${c.reset}`);
  lines.push(`${c.gray}工具: shell | claude | codex${c.reset}`);
  lines.push(`${c.gray}窗口: dch gui${c.reset}`);
  lines.push(`${c.gray}编辑: dch edit ~/.claude/settings.json${c.reset}`);

  return lines.join("\n");
}

const TOOL_ALIASES: Record<string, number> = {
  shell: 0, zsh: 0,
  claude: 1, "claude-code": 1, cc: 1,
  codex: 2,
};

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "--version" || args[0] === "version") {
    await renderVersionStatus(false);
    return;
  }

  if (args[0] === "--check-installed" || args[0] === "check-installed") {
    process.exit(await renderVersionStatus(true));
  }

  if (args[0] === "profile") {
    await runProfileCommand(args.slice(1));
    return;
  }

  const tools = await Promise.all([
    readShellConfig(),
    readClaudeCodeConfig(),
    readCodexConfig(),
  ]);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(renderOverview(tools));
    console.log(`${c.gray}Profile: dch profile [list|add|use|...]${c.reset}`);
    return;
  }

  if (args[0] === "gui" || args[0] === "ui") {
    const proc = Bun.spawn(["bunx", "tauri", "dev"], {
      cwd: pathResolve(import.meta.dir, ".."),
      stdio: ["inherit", "inherit", "inherit"],
    });
    // REVIEW_8 M9：Bun.spawn 后必须把子进程 exit code 透传给父进程，否则 tauri dev
    // 失败（端口占用 / Rust 编译错）退非零，dch 仍 exit 0 → caller (CI / wrapper) 误判成功。
    const exitCode = await proc.exited;
    process.exit(exitCode ?? 1);
  }

  if (args[0] === "edit") {
    const filePath = args[1];
    if (!filePath) {
      console.error(`${c.red}用法: dch edit <filepath>${c.reset}`);
      console.log(`${c.gray}可编辑的文件:${c.reset}`);
      for (const tool of tools) {
        for (const scope of tool.scopes) {
          if (scope.exists) console.log(`  ${scope.filePath}`);
        }
      }
      process.exit(1);
    }
    const editor = defaultEditor();
    const resolved = filePath.startsWith("~") ? filePath.replace("~", HOME) : filePath;
    const proc = Bun.spawn([editor, resolved], { stdio: ["inherit", "inherit", "inherit"] });
    // 同上 REVIEW_8 M9：editor 异常退出（vim 撞 read-only / 用户 :cq）应让 dch 也非零退。
    const exitCode = await proc.exited;
    process.exit(exitCode ?? 1);
  }

  if (args[0] === "all" || args[0] === "--all") {
    for (const tool of tools) {
      console.log(renderTool(tool));
      console.log(`${c.gray}${"─".repeat(60)}${c.reset}\n`);
    }
    return;
  }

  const toolIndex = TOOL_ALIASES[args[0]!];
  if (toolIndex === undefined) {
    console.error(`${c.red}未知工具: ${args[0]}${c.reset}`);
    console.log(`${c.gray}可用: shell, claude, codex${c.reset}`);
    process.exit(1);
  }

  console.log(renderTool(tools[toolIndex]!));
}

main().catch(async (e) => {
  // REVIEW_8 H6：runProfileCommand 内部把 jsonMode 设到 cli-shared 模块状态；
  // 若错误是从 profile cmd throw 上来（如 manager.useProfile 拒绝 / parseFlags 崩），
  // 必须 jsonOut 错误而不是 console.error 文本 — Tauri bridge runDch 解析 stdout 拿不到
  // JSON 时只能从 stderr 拼错误，且 r.code 仍 = 1 但前端 message 一会儿 JSON 一会儿
  // 文本，体感不一致。
  if (isJsonMode()) {
    const message = e instanceof Error ? e.message : String(e);
    await jsonOut({ error: message });
    process.exit(1);
  }
  console.error(`${c.red}${e}${c.reset}`);
  process.exit(1);
});

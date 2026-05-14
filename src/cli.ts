#!/usr/bin/env bun
import { resolve as pathResolve } from "node:path";
import type { ToolConfig, ConfigScope } from "./types.ts";
import { readShellConfig } from "./readers/shell.ts";
import { readClaudeCodeConfig } from "./readers/claude-code.ts";
import { readCodexConfig } from "./readers/codex.ts";
import { readOpenCodeConfig } from "./readers/opencode.ts";
import { runProfileCommand } from "./cli-profile.ts";
import { c, LEVEL_COLORS } from "./cli-colors.ts";
import { HOME, defaultEditor } from "./platform.ts";
import { isJsonMode, jsonOut } from "./cli-shared.ts";

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
  lines.push(`${c.gray}工具: shell | claude | codex | opencode${c.reset}`);
  lines.push(`${c.gray}窗口: dch gui${c.reset}`);
  lines.push(`${c.gray}编辑: dch edit ~/.claude/settings.json${c.reset}`);

  return lines.join("\n");
}

const TOOL_ALIASES: Record<string, number> = {
  shell: 0, zsh: 0,
  claude: 1, "claude-code": 1, cc: 1,
  codex: 2,
  opencode: 3, oc: 3,
};

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "profile") {
    await runProfileCommand(args.slice(1));
    return;
  }

  const tools = await Promise.all([
    readShellConfig(),
    readClaudeCodeConfig(),
    readCodexConfig(),
    readOpenCodeConfig(),
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
    console.log(`${c.gray}可用: shell, claude, codex, opencode${c.reset}`);
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

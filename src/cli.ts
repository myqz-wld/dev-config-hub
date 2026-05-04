#!/usr/bin/env bun
import { resolve as pathResolve } from "node:path";
import type { ToolConfig, ConfigScope, ConfigEntry } from "./types.ts";
import { readShellConfig } from "./readers/shell.ts";
import { readClaudeCodeConfig } from "./readers/claude-code.ts";
import { readCodexConfig } from "./readers/codex.ts";
import { readOpenCodeConfig } from "./readers/opencode.ts";
import { runProfileCommand } from "./cli-profile.ts";
import { c, LEVEL_COLORS } from "./cli-colors.ts";
import { HOME, defaultEditor } from "./platform.ts";

function renderValue(value: unknown, indent: number): string {
  const pad = " ".repeat(indent);
  if (value === null || value === undefined) return `${c.gray}null${c.reset}`;
  if (typeof value === "boolean") return value ? `${c.green}true${c.reset}` : `${c.red}false${c.reset}`;
  if (typeof value === "number") return `${c.yellow}${value}${c.reset}`;
  if (typeof value === "string") return `${c.green}"${value}"${c.reset}`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${c.gray}[]${c.reset}`;
    if (value.every((v) => typeof v === "string") && value.length <= 5) {
      return value.map((v) => `${c.green}"${v}"${c.reset}`).join(`${c.gray}, ${c.reset}`);
    }
    const lines = JSON.stringify(value, null, 2).split("\n");
    return lines.map((l, i) => i === 0 ? l : pad + l).join("\n");
  }
  if (typeof value === "object") {
    const json = JSON.stringify(value, null, 2);
    if (json.length < 80 && !json.includes("\n")) return `${c.gray}${json}${c.reset}`;
    const lines = json.split("\n");
    return lines.map((l, i) => i === 0 ? l : pad + l).join("\n");
  }
  return String(value);
}

function renderEntry(entry: ConfigEntry, keyWidth: number): string {
  const key = `${c.cyan}${entry.key.padEnd(keyWidth)}${c.reset}`;
  const val = renderValue(entry.value, keyWidth + 6);
  const desc = entry.description ? `  ${c.gray}# ${entry.description}${c.reset}` : "";
  if (typeof entry.value === "object" && entry.value !== null) {
    return `  ${key}${desc}\n      ${val}`;
  }
  return `  ${key}  ${val}${desc}`;
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

  if (scope.format === "dotfile" || scope.format === "markdown") {
    const contentLines = scope.content.split("\n").filter((l) => l.trim());
    if (contentLines.length === 0) {
      lines.push(`    ${c.gray}(空文件)${c.reset}`);
    } else {
      for (const line of contentLines) {
        if (line.trimStart().startsWith("#")) {
          lines.push(`    ${c.gray}${line}${c.reset}`);
        } else {
          lines.push(`    ${c.white}${line}${c.reset}`);
        }
      }
    }
    return lines.join("\n");
  }

  for (const cat of scope.categories) {
    const maxKeyLen = Math.min(30, Math.max(...cat.items.map((i) => i.key.length)));
    for (const item of cat.items) {
      lines.push(renderEntry(item, maxKeyLen));
    }
  }

  if (scope.categories.length === 0 && scope.content) {
    lines.push(`    ${c.gray}(已解析但无配置项)${c.reset}`);
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
    await proc.exited;
    return;
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
    await proc.exited;
    return;
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

main().catch((e) => {
  console.error(`${c.red}${e}${c.reset}`);
  process.exit(1);
});

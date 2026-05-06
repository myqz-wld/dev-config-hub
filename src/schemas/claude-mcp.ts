import type { ToolSchema } from "./types.ts";

/**
 * Claude Code MCP servers schema（`~/.claude/.mcp.json`）。
 *
 * **字段来源**：MCP（Model Context Protocol）官方规范 + Claude Code 文档。
 * `~/.claude/.mcp.json` 是 Claude Code 当前用户的 MCP server 注册表。
 *
 * 顶层结构：
 *   - `mcpServers`: kv-map，key 为 server name，value 为 MCP server 配置 object
 *
 * Server 配置 object 浅声明（不展开 stdio / SSE / HTTP / WebSocket 各类型的子字段差异），
 * 让 UnknownField 按 typeof 兜底。后续 PR 按需深化（每种 transport 一个独立 schema）。
 */

export const CLAUDE_MCP: ToolSchema = {
  $id: "claude-mcp@1",
  $source: "https://modelcontextprotocol.io/docs/concepts/transports + https://docs.claude.com/en/docs/claude-code/mcp",
  fetchedAt: "2026-05-06",
  scopeKind: "claude-mcp",
  rootSchema: {
    type: "object",
    description: "Claude Code MCP servers 注册表。",
    additionalProperties: true,
    properties: {
      // source: MCP spec mcpServers map
      mcpServers: {
        type: "kv-map",
        description: "MCP servers 配置。key 为 server 显示名，value 为 transport 配置 object（stdio / SSE / HTTP / WebSocket 各类型）。",
        keyHint: "server 显示名（任意标识）",
        valueSchema: {
          type: "object",
          description: "MCP server 配置 object。常见字段：command / args / env (stdio) 或 url / headers (SSE/HTTP)。",
          additionalProperties: true,
        },
      },
    },
  },
};

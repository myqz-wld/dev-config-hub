import type { ToolKind } from "./types.ts";

// 新建 profile 时 configDir 的默认值。UI 端 onSubmit 用它算 writeProfileConfigFile 的目标路径，
// CLI 端 cmdAdd 用它给 profile 兜底 — 必须保持单一来源，否则两边脱节会把配置写错地方。
export function defaultProfileDir(tool: ToolKind, id: string): string {
  return `~/.${tool}-${id}`;
}

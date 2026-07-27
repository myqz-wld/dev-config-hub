import type { ToolKind } from "./types.ts";

// 新建 profile 时管理目录的默认值。UI 仅用作 placeholder，CLI 在未传 --dir 时采用它；
// 创建流程只建立空目录，不生成 settings.json / config.toml 等工具配置文件。
export function defaultProfileDir(tool: ToolKind, id: string): string {
  return `~/.${tool}-${id}`;
}

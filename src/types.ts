export interface ConfigScope {
  level: "global" | "user" | "project" | "local";
  label: string;
  filePath: string;
  exists: boolean;
  format: "json" | "jsonc" | "toml" | "dotfile" | "powershell" | "markdown";
  content: string;
  /** Suggested contents when the user creates a missing file from the UI. */
  initialContent?: string;
  /**
   * 加载时 mtime（Unix epoch microseconds）。
   * 用于 ConfigPanel edit 模式 TOCTOU 校验：save 前 stat 比对，不一致 → 弹「文件已外部变更」。
   *
   * 三态语义：
   *   - undefined：旧 reader 路径（仍走 readFile，未填充） → 跳过 TOCTOU 检查
   *   - null：新路径（readFileWithMtime）返回，但文件不存在 / 拿不到 mtime
   *   - number：正常 mtime（us 精度）
   */
  loadedMtimeUs?: number | null;
}

export interface ToolConfig {
  name: string;
  version: string;
  icon: string;
  description: string;
  scopes: ConfigScope[];
}

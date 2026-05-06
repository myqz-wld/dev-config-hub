export interface ConfigEntry {
  key: string;
  value: unknown;
  type: string;
  description?: string;
  editable?: boolean;
  sensitive?: boolean;
}

export interface ConfigCategory {
  name: string;
  description: string;
  items: ConfigEntry[];
}

export interface ConfigScope {
  level: "global" | "user" | "project" | "local";
  label: string;
  filePath: string;
  exists: boolean;
  format: "json" | "toml" | "dotfile" | "markdown";
  content: string;
  parsed: Record<string, unknown>;
  categories: ConfigCategory[];
  /**
   * 加载时 mtime（Unix epoch microseconds）。
   * PR-D 之后用于写回 TOCTOU 校验：save 前 stat 比对，不一致 → 弹「文件已外部变更」。
   *
   * **三态语义**（REVIEW_3 R_1·C17）：
   *   - `undefined`：旧 reader 路径（仍走 readFile，未填充） → PR-D 应**跳过**
   *     TOCTOU 检查（兼容期）
   *   - `null`：新路径（readFileWithMtime）返回，但文件不存在 / 拿不到 mtime
   *   - `number`：正常 mtime（us 精度，REVIEW_3 R_1·C7 ms→us 提精度）
   *
   * **禁用** `if (!scope.loadedMtimeUs)`：把 undefined / null / 0 全混为一谈
   * 会让「未填充」与「文件不存在」语义合并，TOCTOU 在「外部删文件」场景失效。
   * 必须用 `=== undefined` / `=== null` / 显式 `typeof === "number"` 区分。
   *
   * 当前 readers 暂未填充（仍走旧 readFile），PR-D 切换 readFileWithMtime 时统一刷新。
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

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
}

export interface ToolConfig {
  name: string;
  version: string;
  icon: string;
  description: string;
  scopes: ConfigScope[];
}

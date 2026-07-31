import type { ConfigScope } from "./types.ts";
import {
  CONFIG_TOOL_IDS,
  buildConfigToolDefinitions,
  joinConfigPath,
  type ConfigEnvironment,
  type ConfigFileLocation,
  type ConfigToolDefinition,
  type ConfigToolId,
} from "./config-locations.ts";

export const CONFIG_FILE_OVERRIDES_VERSION = 1 as const;

export interface AddedConfigFile {
  filePath: string;
  format: ConfigScope["format"];
}

export interface ToolConfigFileOverrides {
  added: AddedConfigFile[];
  removed: string[];
}

export interface ConfigFileOverridesV1 {
  version: typeof CONFIG_FILE_OVERRIDES_VERSION;
  tools: Partial<Record<ConfigToolId, ToolConfigFileOverrides>>;
}

const FORMATS = new Set<ConfigScope["format"]>([
  "json",
  "jsonc",
  "toml",
  "dotfile",
  "powershell",
  "markdown",
]);

export function emptyConfigFileOverrides(): ConfigFileOverridesV1 {
  return { version: CONFIG_FILE_OVERRIDES_VERSION, tools: {} };
}

export function configFileOverridesPath(env: ConfigEnvironment): string {
  return joinConfigPath(env.platform, env.home, ".dch", "config-files.json");
}

export function configPathKey(path: string, platform: ConfigEnvironment["platform"]): string {
  let normalized = platform === "win32"
    ? path.replace(/[\\/]+/g, "\\")
    : path.replace(/\/+/g, "/");
  if (normalized.length > 1) {
    normalized = platform === "win32"
      ? normalized.replace(/[\\/]+$/, "")
      : normalized.replace(/\/+$/, "");
  }
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function hasParentSegment(path: string, platform: ConfigEnvironment["platform"]): boolean {
  return (platform === "win32" ? path.split(/[\\/]+/) : path.split("/"))
    .some((part) => part === "..");
}

export function isPathInsideHome(path: string, env: ConfigEnvironment): boolean {
  if (!path || hasParentSegment(path, env.platform)) return false;
  const separator = env.platform === "win32" ? "\\" : "/";
  const home = configPathKey(env.home, env.platform);
  const candidate = configPathKey(path, env.platform);
  return candidate.startsWith(`${home}${separator}`);
}

export function displayConfigPath(path: string, env: ConfigEnvironment): string {
  if (!isPathInsideHome(path, env)) return path;
  const separator = env.platform === "win32" ? "\\" : "/";
  let home = env.platform === "win32"
    ? env.home.replace(/[\\/]+/g, separator)
    : env.home.replace(/\/+/g, separator);
  home = env.platform === "win32"
    ? home.replace(/[\\/]+$/, "")
    : home.replace(/\/+$/, "");
  const candidate = env.platform === "win32"
    ? path.replace(/[\\/]+/g, separator)
    : path.replace(/\/+/g, separator);
  const relativePath = candidate.slice(home.length);
  const relative = env.platform === "win32" ? relativePath.replace(/\\/g, "/") : relativePath;
  return `~${relative}`;
}

export function inferConfigFileFormat(path: string): ConfigScope["format"] {
  const lower = path.toLocaleLowerCase("en-US");
  if (lower.endsWith(".jsonc")) return "jsonc";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".toml")) return "toml";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".ps1") || lower.endsWith(".psm1") || lower.endsWith(".psd1")) {
    return "powershell";
  }
  return "dotfile";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dedupePaths(paths: string[], platform: ConfigEnvironment["platform"]): string[] {
  const seen = new Set<string>();
  return paths.filter((path) => {
    const key = configPathKey(path, platform);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseConfigFileOverrides(
  content: string,
  platform: ConfigEnvironment["platform"],
): ConfigFileOverridesV1 {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    throw new Error(`无法解析 config-files.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(raw) || raw.version !== CONFIG_FILE_OVERRIDES_VERSION || !isRecord(raw.tools)) {
    throw new Error(`config-files.json 版本无效，仅支持 version ${CONFIG_FILE_OVERRIDES_VERSION}`);
  }

  const result = emptyConfigFileOverrides();
  for (const toolId of CONFIG_TOOL_IDS) {
    const candidate = raw.tools[toolId];
    if (candidate === undefined) continue;
    if (!isRecord(candidate) || !Array.isArray(candidate.added) || !Array.isArray(candidate.removed)) {
      throw new Error(`config-files.json 中 ${toolId} 的管理范围格式无效`);
    }
    const added: AddedConfigFile[] = [];
    const seenAdded = new Set<string>();
    for (const item of candidate.added) {
      if (
        !isRecord(item)
        || typeof item.filePath !== "string"
        || item.filePath.trim().length === 0
        || !FORMATS.has(item.format as ConfigScope["format"])
      ) {
        throw new Error(`config-files.json 中 ${toolId}.added 含无效文件`);
      }
      const key = configPathKey(item.filePath, platform);
      if (seenAdded.has(key)) continue;
      seenAdded.add(key);
      added.push({ filePath: item.filePath, format: item.format as ConfigScope["format"] });
    }
    if (candidate.removed.some((path) => typeof path !== "string" || path.trim().length === 0)) {
      throw new Error(`config-files.json 中 ${toolId}.removed 含无效文件路径`);
    }
    const removed = dedupePaths(candidate.removed as string[], platform);
    if (added.length > 0 || removed.length > 0) result.tools[toolId] = { added, removed };
  }
  return result;
}

export function serializeConfigFileOverrides(overrides: ConfigFileOverridesV1): string {
  const tools: ConfigFileOverridesV1["tools"] = {};
  for (const toolId of CONFIG_TOOL_IDS) {
    const entry = overrides.tools[toolId];
    if (!entry || (entry.added.length === 0 && entry.removed.length === 0)) continue;
    tools[toolId] = {
      added: entry.added.map((file) => ({ ...file })),
      removed: [...entry.removed],
    };
  }
  return `${JSON.stringify({ version: CONFIG_FILE_OVERRIDES_VERSION, tools }, null, 2)}\n`;
}

function toolDefaults(env: ConfigEnvironment, toolId: ConfigToolId): ConfigFileLocation[] {
  return buildConfigToolDefinitions(env).find((definition) => definition.id === toolId)?.files ?? [];
}

function cloneOverrides(overrides: ConfigFileOverridesV1): ConfigFileOverridesV1 {
  const next = emptyConfigFileOverrides();
  for (const toolId of CONFIG_TOOL_IDS) {
    const entry = overrides.tools[toolId];
    if (!entry) continue;
    next.tools[toolId] = {
      added: entry.added.map((file) => ({ ...file })),
      removed: [...entry.removed],
    };
  }
  return next;
}

function finishToolOverride(
  next: ConfigFileOverridesV1,
  toolId: ConfigToolId,
  entry: ToolConfigFileOverrides,
): ConfigFileOverridesV1 {
  if (entry.added.length === 0 && entry.removed.length === 0) delete next.tools[toolId];
  else next.tools[toolId] = entry;
  return next;
}

export function addConfigFileOverride(
  overrides: ConfigFileOverridesV1,
  env: ConfigEnvironment,
  toolId: ConfigToolId,
  filePath: string,
): ConfigFileOverridesV1 {
  const next = cloneOverrides(overrides);
  const current = next.tools[toolId] ?? { added: [], removed: [] };
  const key = configPathKey(filePath, env.platform);
  current.removed = current.removed.filter((path) => configPathKey(path, env.platform) !== key);
  current.added = current.added.filter((file) => configPathKey(file.filePath, env.platform) !== key);
  current.added.push({ filePath, format: inferConfigFileFormat(filePath) });
  return finishToolOverride(next, toolId, current);
}

export function removeConfigFileOverride(
  overrides: ConfigFileOverridesV1,
  env: ConfigEnvironment,
  toolId: ConfigToolId,
  filePath: string,
): ConfigFileOverridesV1 {
  const next = cloneOverrides(overrides);
  const current = next.tools[toolId] ?? { added: [], removed: [] };
  const key = configPathKey(filePath, env.platform);
  current.added = current.added.filter((file) => configPathKey(file.filePath, env.platform) !== key);
  const defaultFile = toolDefaults(env, toolId)
    .find((file) => configPathKey(file.filePath, env.platform) === key);
  if (defaultFile && !current.removed.some((path) => configPathKey(path, env.platform) === key)) {
    current.removed.push(defaultFile.filePath);
  }
  return finishToolOverride(next, toolId, current);
}

export function resetConfigFileOverrides(
  overrides: ConfigFileOverridesV1,
  toolId: ConfigToolId,
): ConfigFileOverridesV1 {
  const next = cloneOverrides(overrides);
  delete next.tools[toolId];
  return next;
}

export function hasConfigFileOverrides(
  overrides: ConfigFileOverridesV1,
  toolId: ConfigToolId,
): boolean {
  const entry = overrides.tools[toolId];
  return !!entry && (entry.added.length > 0 || entry.removed.length > 0);
}

function pinnedDefault(
  spec: ConfigFileLocation,
  added: Map<string, AddedConfigFile>,
  platform: ConfigEnvironment["platform"],
): ConfigFileLocation {
  if (!added.has(configPathKey(spec.filePath, platform))) return spec;
  const { alternativeGroup: _group, alternativePriority: _priority, optional: _optional, ...pinned } = spec;
  return pinned;
}

export function applyConfigFileOverrides(
  definitions: ConfigToolDefinition[],
  overrides: ConfigFileOverridesV1,
  env: ConfigEnvironment,
): ConfigToolDefinition[] {
  return definitions.map((definition) => {
    const entry = overrides.tools[definition.id];
    if (!entry) return definition;

    const removed = new Set(entry.removed.map((path) => configPathKey(path, env.platform)));
    const added = new Map(
      entry.added.map((file) => [configPathKey(file.filePath, env.platform), file]),
    );
    for (const key of added.keys()) removed.delete(key);
    const defaultKeys = new Set(definition.files.map((file) => configPathKey(file.filePath, env.platform)));
    const files = definition.files
      .filter((file) => !removed.has(configPathKey(file.filePath, env.platform)))
      .map((file) => pinnedDefault(file, added, env.platform));

    for (const file of entry.added) {
      const key = configPathKey(file.filePath, env.platform);
      if (defaultKeys.has(key) || !isPathInsideHome(file.filePath, env)) continue;
      files.push({
        level: "user",
        label: displayConfigPath(file.filePath, env),
        filePath: file.filePath,
        format: file.format,
      });
    }
    return { ...definition, files };
  });
}

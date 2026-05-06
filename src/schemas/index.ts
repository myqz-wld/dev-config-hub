export type * from "./types.ts";
export {
  buildFieldIndex,
  resolveFieldAtPath,
  normalizeEnum,
  pathToString,
} from "./helpers.ts";
export { detectScope, getSchemaForScope, listRegisteredSchemas } from "./registry.ts";
export { CLAUDE_SETTINGS } from "./claude-settings.ts";
export { CLAUDE_MCP } from "./claude-mcp.ts";
export { CODEX_CONFIG } from "./codex-config.ts";
export { OPENCODE_CONFIG } from "./opencode-config.ts";
export { DCH_STORE } from "./dch-store.ts";
export {
  patchJson,
  detectFormat,
  type JsonPatch,
  type JsonPatchOptions,
  type DetectedFormat,
} from "./json-patcher.ts";
export {
  patchToml,
  type TomlPatch,
  type TomlPatchResult,
} from "./toml-patcher.ts";
export { diffPatches } from "./diff.ts";
export {
  fieldSchemaToJsonSchema,
  toolSchemaToJsonSchema,
  type StandardJsonSchema,
} from "./to-json-schema.ts";
export { validate } from "./validator.ts";

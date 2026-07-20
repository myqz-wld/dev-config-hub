import { PROFILE_TOOL_IDS, type ProfileToolId } from "../config-locations.ts";

export { PROFILE_TOOL_IDS };
export type ToolKind = ProfileToolId;

/**
 * Hook 脚本支持两种形式：
 * - **string**：按当前平台默认 shell 跑（POSIX 走 bash -lc / Win 走 powershell -NoProfile -Command）。
 *   向后兼容历史 profiles.json 已有的字符串形式。
 * - **object**：分平台单独提供脚本。优先级：当前平台对应字段 > 同 family fallback。
 *   - Win：powershell > cmd（>posix 不走，因为 bash 在 Win 默认无）
 *   - POSIX：posix（不 fallback 到 powershell/cmd）
 *   匹配不到 → 视为「该平台未提供 hook」返回 null（与 script 为空字符串同语义，不报错）。
 */
export type HookScript =
  | string
  | {
      /** POSIX bash/zsh script，跑 `bash -lc "..."`。macOS / Linux 用。 */
      posix?: string;
      /** PowerShell script，跑 `powershell -NoProfile -Command "..."`。Win 默认。 */
      powershell?: string;
      /** cmd.exe script，跑 `cmd.exe /c "..."`。Win 备选（不推荐，cmd quoting 易踩坑）。 */
      cmd?: string;
    };

export interface ProfileHooks {
  preSwitch?: HookScript;
  postSwitch?: HookScript;
}

export interface Profile {
  id: string;
  tool: ToolKind;
  configDir: string; // 可含 ~ 前缀
  env?: Record<string, string>;
  description?: string;
  hooks?: ProfileHooks;
  isDefault?: boolean;
}

export interface Preferences {
  hookTimeoutMs: number;
}

export interface ProfileStore {
  version: 1;
  profiles: Profile[];
  active: Partial<Record<ToolKind, string | null>>;
  preferences: Preferences;
}

export interface HookResult {
  hook: "preSwitch" | "postSwitch";
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface SwitchResult {
  ok: boolean;
  profile: Profile;
  previousActive?: string | null;
  hooks: HookResult[];
  message?: string;
}

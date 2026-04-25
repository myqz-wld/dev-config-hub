export type ToolKind = "claude" | "codex";

export type SwitchMode = "env" | "symlink";

export type TerminalApp = "Terminal" | "iTerm" | "Ghostty";

export interface ProfileHooks {
  preSwitch?: string;
  postSwitch?: string;
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
  terminal: TerminalApp;
  defaultMode: SwitchMode;
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
  mode: SwitchMode;
  profile: Profile;
  previousActive?: string | null;
  hooks: HookResult[];
  message?: string;
  spawnedTerminal?: string;
}

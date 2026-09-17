import type { Profile } from "./types.ts";

export const DEFAULT_HOOK_TIMEOUT_MS = 30_000;
export const MIN_HOOK_TIMEOUT_MS = 1_000;
export const MAX_HOOK_TIMEOUT_MS = 600_000;

export function normalizeHookTimeout(value: unknown): number {
  return Number.isInteger(value) && (value as number) >= MIN_HOOK_TIMEOUT_MS &&
      (value as number) <= MAX_HOOK_TIMEOUT_MS
    ? value as number
    : DEFAULT_HOOK_TIMEOUT_MS;
}

export function profileHookTimeout(profile: Profile): number {
  return normalizeHookTimeout(profile.hookTimeoutMs);
}


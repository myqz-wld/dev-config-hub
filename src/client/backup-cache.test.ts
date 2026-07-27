import { beforeEach, describe, expect, it } from "bun:test";
import type { BackupPolicyV1 } from "./bridge.ts";
import { backupPolicyCache } from "./backup-cache.ts";

const policy = (): BackupPolicyV1 => ({
  schemaVersion: 1,
  defaultFileAction: "include",
  unscannableFileAction: "include-with-warning",
  fileRules: [],
  secretRules: {
    wholeFile: [],
    field: [],
    content: [],
  },
});

describe("backupPolicyCache", () => {
  beforeEach(() => backupPolicyCache.clear());

  it("按工具、方案和切换脚本目标分别缓存", () => {
    backupPolicyCache.set("tool", "claude", policy(), "factory");
    backupPolicyCache.set("profile", "claude-work", policy(), "profile-snapshot");
    backupPolicyCache.set("scripts", undefined, policy(), "scripts");

    expect(backupPolicyCache.get("tool", "claude")?.source).toBe("factory");
    expect(backupPolicyCache.get("tool", "codex")).toBeNull();
    expect(backupPolicyCache.get("profile", "claude-work")?.source)
      .toBe("profile-snapshot");
    expect(backupPolicyCache.get("scripts")?.source).toBe("scripts");
  });

  it("返回克隆值，未保存的表格编辑不会污染缓存", () => {
    backupPolicyCache.set("tool", "claude", policy(), "factory");
    const first = backupPolicyCache.get("tool", "claude");
    first?.policy.fileRules.push({
      id: "local-only",
      label: "未保存",
      enabled: true,
      target: "relative-path",
      match: { kind: "glob", pattern: "**/*.tmp" },
      action: "exclude",
    });

    expect(backupPolicyCache.get("tool", "claude")?.policy.fileRules).toHaveLength(0);
    backupPolicyCache.clear();
    expect(backupPolicyCache.get("tool", "claude")).toBeNull();
  });
});

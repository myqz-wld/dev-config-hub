import { describe, expect, it } from "bun:test";
import type {
  BackupContentSecretRule,
  BackupFileRule,
  BackupPolicyV1,
  Profile,
  ProfileStore,
} from "./types.ts";
import {
  factoryBackupPolicy,
  factoryScriptsBackupPolicy,
} from "./backup-policy-defaults.ts";
import {
  resolveProfileBackupPolicy,
  resolveScriptsBackupPolicy,
  resolveToolBackupPolicy,
  snapshotProfileBackupPolicy,
} from "./backup-policy.ts";
import { BACKUP_COVERAGE_FIXTURES } from "./backup-policy.fixture.ts";
import { evaluateFileCoverage } from "./backup-policy-match.ts";
import { transformBackupFile } from "./backup-policy-transform.ts";
import { validateBackupPolicy } from "./backup-policy-validation.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function policyWith(
  fileRules: BackupFileRule[] = [],
  content: BackupContentSecretRule[] = [],
): BackupPolicyV1 {
  return {
    schemaVersion: 1,
    defaultFileAction: "include",
    unscannableFileAction: "include-with-warning",
    fileRules,
    secretRules: { wholeFile: [], field: [], content },
  };
}

describe("factory backup coverage fixtures", () => {
  for (const fixture of BACKUP_COVERAGE_FIXTURES) {
    it(`${fixture.tool}: ${fixture.path} -> ${fixture.action}`, () => {
      const policy = fixture.tool === "scripts"
        ? factoryScriptsBackupPolicy()
        : factoryBackupPolicy(fixture.tool);
      expect(evaluateFileCoverage(policy, fixture.path)).toEqual({
        action: fixture.action,
        ruleId: fixture.ruleId,
      });
    });
  }

  it("whole credential files are excluded by secret policy", () => {
    for (const [tool, filename] of [
      ["claude", "auth.json"],
      ["codex", "credentials.json"],
      ["grok", "mcp_credentials.json"],
    ] as const) {
      const result = transformBackupFile(
        encoder.encode('{"token":"secret-value"}'),
        filename,
        factoryBackupPolicy(tool),
      );
      expect(result.outcome).toBe("exclude");
      expect(result.secretHits[0]?.action).toBe("exclude-file");
    }
  });
});

describe("backup policy hierarchy", () => {
  const profile: Profile = {
    id: "demo",
    tool: "claude",
    configDir: "~/.claude-demo",
    hookTimeoutMs: 30_000,
  };
  const store: ProfileStore = {
    version: 2,
    profiles: [profile],
    active: { claude: null },
    backup: { toolPolicies: {} },
  };

  it("factory -> saved tool policy -> live profile inheritance", () => {
    expect(resolveToolBackupPolicy(store, "claude").source).toBe("factory");
    const custom = factoryBackupPolicy("claude");
    custom.defaultFileAction = "exclude";
    store.backup.toolPolicies.claude = custom;
    expect(resolveToolBackupPolicy(store, "claude").source).toBe("tool");
    expect(resolveProfileBackupPolicy(store, profile).policy.defaultFileAction).toBe("exclude");
  });

  it("profile snapshot stops following tool changes; deleting it restores inheritance", () => {
    const firstTool = factoryBackupPolicy("claude");
    firstTool.defaultFileAction = "exclude";
    store.backup.toolPolicies.claude = firstTool;
    profile.backupPolicy = snapshotProfileBackupPolicy(store, profile);

    const laterTool = factoryBackupPolicy("claude");
    laterTool.defaultFileAction = "include";
    store.backup.toolPolicies.claude = laterTool;
    expect(resolveProfileBackupPolicy(store, profile).source).toBe("profile-snapshot");
    expect(resolveProfileBackupPolicy(store, profile).policy.defaultFileAction).toBe("exclude");

    delete profile.backupPolicy;
    expect(resolveProfileBackupPolicy(store, profile).source).toBe("tool");
    expect(resolveProfileBackupPolicy(store, profile).policy.defaultFileAction).toBe("include");
    delete store.backup.toolPolicies.claude;
    expect(resolveProfileBackupPolicy(store, profile).source).toBe("factory");
  });

  it("switch scripts report factory versus saved-global source", () => {
    delete store.backup.scriptsPolicy;
    expect(resolveScriptsBackupPolicy(store).source).toBe("factory");
    store.backup.scriptsPolicy = factoryScriptsBackupPolicy();
    expect(resolveScriptsBackupPolicy(store).source).toBe("scripts");
    delete store.backup.scriptsPolicy;
  });
});

describe("ordered file and secret rules", () => {
  it("first matching file rule wins and reversing order reverses result", () => {
    const includeSpecific: BackupFileRule = {
      id: "include-specific", label: "include", enabled: true,
      target: "relative-path", match: { kind: "glob", pattern: "keep/**" },
      action: "include",
    };
    const excludeAll: BackupFileRule = {
      id: "exclude-all", label: "exclude", enabled: true,
      target: "relative-path", match: { kind: "glob", pattern: "**" },
      action: "exclude",
    };
    expect(evaluateFileCoverage(policyWith([includeSpecific, excludeAll]), "keep/a.txt").action).toBe("include");
    expect(evaluateFileCoverage(policyWith([excludeAll, includeSpecific]), "keep/a.txt").action).toBe("exclude");
  });

  it("field ignore outranks later field redact", () => {
    const policy = factoryBackupPolicy("claude");
    const result = transformBackupFile(
      encoder.encode('{"tokenExpiry":"sk-ant-AAAAAAAAAAAAAAAAAAAAAAAA"}'),
      "settings.json",
      policy,
    );
    expect(decoder.decode(result.content)).toContain("sk-ant-");
    expect(result.secretHits).toEqual([{
      ruleId: "field-ignore-token-expiry",
      action: "ignore",
      fieldPath: "$.tokenExpiry",
    }]);
  });

  it("whole-file ignore is terminal and bypasses content rules", () => {
    const policy = factoryBackupPolicy("claude");
    policy.secretRules.wholeFile[0]!.action = "ignore";
    const result = transformBackupFile(
      encoder.encode('{"token":"sk-ant-AAAAAAAAAAAAAAAAAAAAAAAA"}'),
      "auth.json",
      policy,
    );
    expect(decoder.decode(result.content)).toContain("sk-ant-");
    expect(result.secretHits).toHaveLength(1);
    expect(result.secretHits[0]?.ruleId).toBe("secret-auth-json");
  });

  it("earlier content rule claims overlapping token", () => {
    const first: BackupContentSecretRule = {
      id: "specific", label: "specific", enabled: true, formats: ["text"],
      match: { kind: "regex", pattern: "sk-proj-[A-Za-z0-9_-]{8,}" },
      action: "placeholder", placeholderName: "SPECIFIC",
    };
    const second: BackupContentSecretRule = {
      id: "broad", label: "broad", enabled: true, formats: ["text"],
      match: { kind: "regex", pattern: "sk-[A-Za-z0-9_-]{8,}" },
      action: "placeholder", placeholderName: "BROAD",
    };
    const result = transformBackupFile(
      encoder.encode("token=sk-proj-ABCDEFGHIJKLMNOP"),
      "note.txt",
      policyWith([], [first, second]),
    );
    expect(decoder.decode(result.content)).toContain("<<DCH_PLACEHOLDER:SPECIFIC>>");
    expect(result.secretHits.map((hit) => hit.ruleId)).toEqual(["specific"]);
  });

  it("any accepted exclude-file hit excludes the complete file", () => {
    const placeholder: BackupContentSecretRule = {
      id: "redact", label: "redact", enabled: true, formats: ["text"],
      match: { kind: "regex", pattern: "TOKEN_[A-Z]+" },
      action: "placeholder",
    };
    const exclude: BackupContentSecretRule = {
      id: "exclude", label: "exclude", enabled: true, formats: ["text"],
      match: { kind: "regex", pattern: "DANGER_[A-Z]+" },
      action: "exclude-file",
    };
    const result = transformBackupFile(
      encoder.encode("TOKEN_ONE DANGER_TWO"),
      "note.txt",
      policyWith([], [placeholder, exclude]),
    );
    expect(result.outcome).toBe("exclude");
    expect(result.secretHits.map((hit) => hit.action)).toEqual(["placeholder", "exclude-file"]);
  });
});

describe("formats, binary behavior, and CLI override semantics", () => {
  it("JSON/JSONC/TOML fields are processed structurally", () => {
    for (const [filename, content] of [
      ["config.json", '{"api_key":"super-secret-value"}'],
      ["config.jsonc", '{// comment\n"api_key":"super-secret-value",}'],
      ["config.toml", 'api_key = "super-secret-value"'],
    ] as Array<[string, string]>) {
      const result = transformBackupFile(
        encoder.encode(content),
        filename,
        factoryBackupPolicy("codex"),
      );
      expect(decoder.decode(result.content)).toContain("<<DCH_PLACEHOLDER:API_KEY>>");
      expect(result.outcome).toBe("include");
    }
  });

  it("structured string values apply all non-overlapping content rules in order", () => {
    const rules: BackupContentSecretRule[] = [
      {
        id: "first", label: "first", enabled: true, formats: ["json"],
        match: { kind: "regex", pattern: "TOKEN_[A-Z]+" },
        action: "placeholder",
        placeholderName: "TOKEN",
      },
      {
        id: "second", label: "second", enabled: true, formats: ["json"],
        match: { kind: "regex", pattern: "SECRET_[A-Z]+" },
        action: "placeholder",
        placeholderName: "SECRET",
      },
    ];
    const result = transformBackupFile(
      encoder.encode('{"command":"TOKEN_ONE and SECRET_TWO"}'),
      "config.json",
      policyWith([], rules),
    );
    const output = decoder.decode(result.content);
    expect(output).toContain("<<DCH_PLACEHOLDER:TOKEN>>");
    expect(output).toContain("<<DCH_PLACEHOLDER:SECRET>>");
    expect(result.secretHits.map((hit) => hit.ruleId)).toEqual(["first", "second"]);
  });

  it("invalid structured input falls back to text with a warning", () => {
    const result = transformBackupFile(
      encoder.encode('{"api_key":"super-secret-value" trailing'),
      "broken.json",
      factoryBackupPolicy("claude"),
    );
    expect(result.warnings[0]).toContain("解析失败");
    expect(decoder.decode(result.content)).toContain("<<DCH_PLACEHOLDER:API_KEY>>");
  });

  it("binary follows unscannableFileAction", () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0xfd]);
    const includePolicy = policyWith();
    const included = transformBackupFile(bytes, "blob.bin", includePolicy);
    expect(included.outcome).toBe("include");
    expect(included.unscannable).toBeTrue();
    includePolicy.unscannableFileAction = "exclude";
    expect(transformBackupFile(bytes, "blob.bin", includePolicy).outcome).toBe("exclude");
  });

  it("--no-placeholder converts only placeholder to keep-original", () => {
    const policy = factoryBackupPolicy("claude");
    const raw = transformBackupFile(
      encoder.encode('{"api_key":"super-secret-value"}'),
      "settings.json",
      policy,
      { noPlaceholder: true },
    );
    expect(decoder.decode(raw.content)).toContain("super-secret-value");
    expect(raw.rawSecret).toBeTrue();
    expect(raw.secretHits[0]?.action).toBe("keep-original");

    const auth = transformBackupFile(
      encoder.encode('{"api_key":"super-secret-value"}'),
      "auth.json",
      policy,
      { noPlaceholder: true },
    );
    expect(auth.outcome).toBe("exclude");
    expect(auth.secretHits[0]?.action).toBe("exclude-file");
  });
});

describe("policy validation", () => {
  it("factory policies are valid", () => {
    for (const tool of ["claude", "codex", "grok", "cursor"] as const) {
      expect(() => validateBackupPolicy(factoryBackupPolicy(tool))).not.toThrow();
    }
    expect(() => validateBackupPolicy(factoryScriptsBackupPolicy())).not.toThrow();
  });

  it("rejects illegal glob, regex, capture group, duplicate id, and schema", () => {
    const invalidGlob = policyWith([{
      id: "x", label: "x", enabled: true, target: "relative-path",
      match: { kind: "glob", pattern: "[abc" }, action: "exclude",
    }]);
    expect(() => validateBackupPolicy(invalidGlob)).toThrow(/Glob/);

    const invalidRegex = policyWith([], [{
      id: "x", label: "x", enabled: true, formats: ["text"],
      match: { kind: "regex", pattern: "(" }, action: "ignore",
    }]);
    expect(() => validateBackupPolicy(invalidRegex)).toThrow(/正则/);

    const invalidCapture = policyWith([], [{
      id: "x", label: "x", enabled: true, formats: ["text"],
      match: { kind: "regex", pattern: "(token)", secretCaptureGroup: 2 },
      action: "placeholder",
    }]);
    expect(() => validateBackupPolicy(invalidCapture)).toThrow(/capture group/);

    const duplicate = policyWith([
      {
        id: "same", label: "a", enabled: true, target: "basename",
        match: { kind: "glob", pattern: "a" }, action: "include",
      },
      {
        id: "same", label: "b", enabled: true, target: "basename",
        match: { kind: "glob", pattern: "b" }, action: "exclude",
      },
    ]);
    expect(() => validateBackupPolicy(duplicate)).toThrow(/重复/);

    const wrongSchema = { ...policyWith(), schemaVersion: 2 };
    expect(() => validateBackupPolicy(wrongSchema as unknown as BackupPolicyV1)).toThrow(/版本/);

    const invalidAction = policyWith([{
      id: "bad-action", label: "bad", enabled: true, target: "basename",
      match: { kind: "glob", pattern: "*" }, action: "archive" as "include",
    }]);
    expect(() => validateBackupPolicy(invalidAction)).toThrow(/动作非法/);

    const invalidTarget = policyWith([{
      id: "bad-target", label: "bad", enabled: true,
      target: "absolute-path" as "basename",
      match: { kind: "glob", pattern: "*" }, action: "include",
    }]);
    expect(() => validateBackupPolicy(invalidTarget)).toThrow(/目标非法/);
  });
});

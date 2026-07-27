import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { factoryBackupPolicy } from "./backup-policy-defaults.ts";
import type { Manifest } from "./backup.ts";
import type { ProfileStore } from "./types.ts";

const CLI_PATH = join(resolve(import.meta.dir, "../.."), "src", "cli.ts");
let testHome = "";

beforeEach(async () => {
  testHome = await mkdtemp(join(tmpdir(), "dch-preview-e2e-"));
});

afterEach(async () => {
  await rm(testHome, { recursive: true, force: true });
});

async function writeStore(store: ProfileStore): Promise<void> {
  const path = join(testHome, ".dch", "profiles.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(store, null, 2));
}

async function run(args: string[]) {
  const proc = Bun.spawn(["bun", CLI_PATH, "profile", ...args, "--json"], {
    env: { ...process.env, HOME: testHome },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function extract(pack: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dch-preview-extract-"));
  const proc = Bun.spawn(["tar", "-xzf", pack, "-C", directory], {
    stdout: "ignore",
    stderr: "pipe",
  });
  if (await proc.exited !== 0) {
    throw new Error(await new Response(proc.stderr).text());
  }
  return directory;
}

async function listArchive(pack: string): Promise<Set<string>> {
  const proc = Bun.spawn(["tar", "-tzf", pack], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error("tar list failed");
  return new Set(stdout.split("\n").filter(Boolean).map(
    (path) => path.replace(/^\.\//, "").replace(/\/$/, ""),
  ));
}

function baseStore(configDir: string): ProfileStore {
  return {
    version: 2,
    profiles: [{
      id: "main",
      tool: "claude",
      configDir,
      hookTimeoutMs: 30_000,
    }],
    active: { claude: null, codex: null, grok: null, cursor: null },
    backup: { toolPolicies: {} },
  };
}

describe("immutable backup preview", () => {
  test("preview audit, committed manifest, and archive are the same snapshot", async () => {
    const profileDir = join(testHome, "claude-main");
    await mkdir(join(profileDir, "logs"), { recursive: true });
    await writeFile(
      join(profileDir, "settings.json"),
      JSON.stringify({ api_key: "sk-ant-abcdefghijklmnopqrstuvwxyz123456" }),
    );
    await writeFile(join(profileDir, "notes.txt"), "before-preview\n");
    await writeFile(join(profileDir, "logs", "run.log"), "not-in-backup\n");
    await mkdir(join(testHome, ".dch", "scripts"), { recursive: true });
    await writeFile(
      join(testHome, ".dch", "scripts", "switch.sh"),
      "TOKEN=script-secret-value\n",
    );
    await mkdir(join(testHome, ".agents", "skills"), { recursive: true });
    await writeFile(join(testHome, ".agents", "skills", "never.txt"), "never");
    await writeStore(baseStore(profileDir));

    const outFile = join(testHome, "snapshot.dchpack");
    const previewRun = await run(["backup-prepare", "--out", outFile]);
    expect(previewRun.exitCode).toBe(0);
    const preview = JSON.parse(previewRun.stdout) as {
      token: string;
      manifest: Manifest;
    };
    expect(preview.manifest.options.include_scripts).toBe(true);
    expect(preview.manifest.options).not.toHaveProperty("include_shared");
    expect(preview.manifest.shared).not.toHaveProperty("agents_paths");

    const pendingPack = join(
      testHome,
      ".dch",
      "backups",
      ".pending",
      `${preview.token}.dchpack`,
    );
    const pendingEntries = await listArchive(pendingPack);
    for (const file of preview.manifest.backup_audit!.files) {
      if (file.outcome === "included") {
        expect(pendingEntries.has(file.pack_path)).toBe(true);
      } else {
        expect(pendingEntries.has(file.pack_path)).toBe(false);
      }
    }
    expect([...pendingEntries].some((path) => path.includes(".agents"))).toBe(false);

    // A commit publishes the already prepared bytes; later source changes must not leak in.
    await writeFile(join(profileDir, "notes.txt"), "after-preview\n");
    await writeFile(join(testHome, ".dch", "scripts", "switch.sh"), "TOKEN=after-preview-secret\n");
    const commitRun = await run(["backup-commit", preview.token]);
    expect(commitRun.exitCode).toBe(0);
    const committed = JSON.parse(commitRun.stdout) as {
      manifest: Manifest;
      outFile: string;
    };
    expect(committed.manifest).toEqual(preview.manifest);
    expect(committed.outFile).toBe(outFile);

    const extracted = await extract(outFile);
    try {
      const actualManifest = JSON.parse(
        await readFile(join(extracted, "manifest.json"), "utf8"),
      );
      expect(actualManifest).toEqual(preview.manifest);
      expect(await readFile(
        join(extracted, "profiles", "main", "configDir", "notes.txt"),
        "utf8",
      )).toBe("before-preview\n");
      const settings = await readFile(
        join(extracted, "profiles", "main", "configDir", "settings.json"),
        "utf8",
      );
      expect(settings).not.toContain("sk-ant-abcdefghijklmnopqrstuvwxyz123456");
      expect(settings).toContain("<<DCH_PLACEHOLDER:API_KEY>>");
      const script = await readFile(
        join(extracted, "dch", "scripts", "switch.sh"),
        "utf8",
      );
      expect(script).not.toContain("script-secret-value");
      expect(script).not.toContain("after-preview-secret");
      expect(script).toContain("<<DCH_PLACEHOLDER:TOKEN>>");
      await expect(stat(join(
        extracted,
        "profiles",
        "main",
        "configDir",
        "logs",
        "run.log",
      ))).rejects.toThrow();
    } finally {
      await rm(extracted, { recursive: true, force: true });
    }
  }, 60_000);

  test("--no-scripts and deprecated --no-shared both skip only DCH scripts", async () => {
    const profileDir = join(testHome, "claude-main");
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, "settings.json"), "{}\n");
    await mkdir(join(testHome, ".dch", "scripts"), { recursive: true });
    await writeFile(join(testHome, ".dch", "scripts", "switch.sh"), "echo ok\n");
    await writeStore(baseStore(profileDir));

    for (const flag of ["--no-scripts", "--no-shared"]) {
      const result = await run(["backup-prepare", flag]);
      expect(result.exitCode).toBe(0);
      const prepared = JSON.parse(result.stdout) as {
        token: string;
        manifest: Manifest;
      };
      expect(prepared.manifest.options.include_scripts).toBe(false);
      expect(prepared.manifest.shared.dch_scripts).toEqual([]);
      expect(prepared.manifest.profiles).toHaveLength(1);
      expect((await run(["backup-cancel", prepared.token])).exitCode).toBe(0);
      await expect(stat(join(
        testHome,
        ".dch",
        "backups",
        ".pending",
        `${prepared.token}.dchpack`,
      ))).rejects.toThrow();
    }
  }, 60_000);

  test("--no-placeholder requires explicit commit confirmation and never bypasses excludes", async () => {
    const profileDir = join(testHome, "claude-main");
    await mkdir(join(profileDir, "keys"), { recursive: true });
    const secret = "super-secret-value";
    await writeFile(join(profileDir, "settings.json"), JSON.stringify({ api_key: secret }));
    await writeFile(join(profileDir, "auth.json"), JSON.stringify({ token: secret }));
    await writeFile(join(profileDir, "keys", "private.pem"), secret);
    await mkdir(join(testHome, ".dch", "scripts"), { recursive: true });
    await writeFile(join(testHome, ".dch", "scripts", "switch.sh"), `TOKEN=${secret}\n`);
    await writeStore(baseStore(profileDir));

    const direct = await run(["backup", "--no-placeholder"]);
    expect(direct.exitCode).toBe(1);
    expect(JSON.parse(direct.stdout).error).toMatch(/必须配 --yes/);

    const outFile = join(testHome, "raw-confirmed.dchpack");
    const preparedRun = await run([
      "backup-prepare", "--no-placeholder", "--out", outFile,
    ]);
    expect(preparedRun.exitCode).toBe(0);
    expect(preparedRun.stdout).not.toContain(secret);
    const prepared = JSON.parse(preparedRun.stdout) as {
      token: string;
      manifest: Manifest;
    };
    expect(prepared.manifest.backup_audit?.contains_raw_secrets).toBeTrue();
    expect(prepared.manifest.backup_audit?.files.some((file) => (
      file.owner === "scripts" &&
      file.secret_hits.some((hit) => hit.action === "keep-original")
    ))).toBeTrue();
    expect(JSON.stringify(prepared.manifest)).not.toContain(secret);

    const denied = await run(["backup-commit", prepared.token]);
    expect(denied.exitCode).toBe(1);
    expect(JSON.parse(denied.stdout).error).toMatch(/明文密钥/);

    const committed = await run(["backup-commit", prepared.token, "--yes"]);
    expect(committed.exitCode).toBe(0);
    const extracted = await extract(outFile);
    try {
      expect(await readFile(join(
        extracted,
        "profiles",
        "main",
        "configDir",
        "settings.json",
      ), "utf8")).toContain(secret);
      await expect(stat(join(
        extracted,
        "profiles",
        "main",
        "configDir",
        "auth.json",
      ))).rejects.toThrow();
      await expect(stat(join(
        extracted,
        "profiles",
        "main",
        "configDir",
        "keys",
        "private.pem",
      ))).rejects.toThrow();
      expect(await readFile(
        join(extracted, "dch", "scripts", "switch.sh"),
        "utf8",
      )).toContain(secret);
    } finally {
      await rm(extracted, { recursive: true, force: true });
    }
  }, 60_000);

  test("expired prepared snapshots are removed by the next backup operation", async () => {
    const profileDir = join(testHome, "claude-main");
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, "settings.json"), "{}\n");
    await writeStore(baseStore(profileDir));

    const first = JSON.parse(
      (await run(["backup-prepare", "--no-scripts"])).stdout,
    ) as { token: string };
    const pendingRoot = join(testHome, ".dch", "backups", ".pending");
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1_000);
    for (const extension of ["dchpack", "json"]) {
      await utimes(join(pendingRoot, `${first.token}.${extension}`), oldTime, oldTime);
    }

    const secondRun = await run(["backup-prepare", "--no-scripts"]);
    expect(secondRun.exitCode).toBe(0);
    const second = JSON.parse(secondRun.stdout) as { token: string };
    for (const extension of ["dchpack", "json"]) {
      await expect(stat(join(
        pendingRoot,
        `${first.token}.${extension}`,
      ))).rejects.toThrow();
    }
    expect((await run(["backup-cancel", second.token])).exitCode).toBe(0);
  }, 60_000);

  test("restore follows manifest file list and does not apply current backup rules again", async () => {
    const profileDir = join(testHome, "claude-main");
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, "keep.txt"), "from-package\n");
    await writeStore(baseStore(profileDir));

    const outFile = join(testHome, "restore-exact.dchpack");
    expect((await run(["backup", "--out", outFile, "--no-scripts", "--yes"])).exitCode)
      .toBe(0);

    const excludeEverything = factoryBackupPolicy("claude");
    excludeEverything.fileRules.unshift({
      id: "now-exclude-everything",
      label: "当前规则排除全部",
      enabled: true,
      target: "relative-path",
      match: { kind: "glob", pattern: "**" },
      action: "exclude",
    });
    await writeStore({
      version: 2,
      profiles: [],
      active: { claude: null, codex: null, grok: null, cursor: null },
      backup: { toolPolicies: { claude: excludeEverything } },
    });
    await rm(profileDir, { recursive: true, force: true });

    const restored = await run(["restore", outFile, "--yes"]);
    expect(restored.exitCode).toBe(0);
    const result = JSON.parse(restored.stdout) as {
      appliedProfiles: Array<{ finalId: string }>;
    };
    const restoredFile = join(
      testHome,
      ".dch-restored",
      result.appliedProfiles[0]!.finalId,
      "keep.txt",
    );
    expect(await readFile(restoredFile, "utf8")).toBe("from-package\n");
  }, 60_000);

  test("legacy package without profile file lists still imports while agents payload is ignored", async () => {
    const stage = await mkdtemp(join(tmpdir(), "dch-legacy-stage-"));
    const configRoot = join(stage, "profiles", "legacy", "configDir");
    await mkdir(configRoot, { recursive: true });
    await writeFile(join(configRoot, "legacy.txt"), "legacy-content\n");
    await writeFile(join(stage, "profiles", "legacy", "_meta.json"), JSON.stringify({
      id: "legacy",
      tool: "claude",
      configDir: "~/.claude-legacy",
    }));
    await mkdir(join(stage, "shared", "agents", "skills"), { recursive: true });
    await writeFile(join(stage, "shared", "agents", "skills", "never.txt"), "never");
    const legacyManifest = {
      format_version: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      source_host: "legacy-host",
      source_user: "legacy-user",
      dch_version: "0.1.0",
      options: {
        include_shared: true,
        no_placeholder: false,
        profile_ids: ["legacy"],
      },
      profiles: [{
        id: "legacy",
        tool: "claude",
        configDir_original: "~/.claude-legacy",
        env_keys: [],
        active_in_source: false,
        // Deliberately no `files`: this activates the safe legacy walk fallback.
      }],
      shared: {
        dch_scripts: [],
        agents_paths: ["skills/never.txt"],
      },
      placeholders: [],
      security_warnings: [],
    };
    await writeFile(
      join(stage, "manifest.json"),
      JSON.stringify(legacyManifest, null, 2),
    );
    const pack = join(testHome, "legacy.dchpack");
    const archive = Bun.spawn(["tar", "-czf", pack, "-C", stage, "."], {
      stdout: "ignore",
      stderr: "pipe",
    });
    expect(await archive.exited).toBe(0);
    await rm(stage, { recursive: true, force: true });
    await writeStore({
      version: 2,
      profiles: [],
      active: { claude: null, codex: null, grok: null, cursor: null },
      backup: { toolPolicies: {} },
    });

    const restored = await run(["restore", pack, "--yes"]);
    expect(restored.exitCode).toBe(0);
    const result = JSON.parse(restored.stdout) as {
      ignoredLegacyAgents: number;
      appliedProfiles: Array<{ finalId: string }>;
    };
    expect(result.ignoredLegacyAgents).toBe(1);
    expect(await readFile(join(
      testHome,
      ".dch-restored",
      result.appliedProfiles[0]!.finalId,
      "legacy.txt",
    ), "utf8")).toBe("legacy-content\n");
    await expect(stat(join(testHome, ".agents", "skills", "never.txt"))).rejects.toThrow();
  }, 60_000);
});

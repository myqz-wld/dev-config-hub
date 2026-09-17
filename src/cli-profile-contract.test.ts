import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI_PATH = resolve(import.meta.dir, "cli.ts");
let testHome = "";
beforeEach(async () => { testHome = await mkdtemp(join(tmpdir(), "dch-contract-")); });
afterEach(async () => { await rm(testHome, { recursive: true, force: true }); });

async function run(args: string[]) {
  const proc = Bun.spawn([process.execPath, CLI_PATH, "profile", ...args, "--json"], {
    env: {
      ...process.env, HOME: testHome, USERPROFILE: testHome,
      CODEX_HOME: join(testHome, ".codex"), GROK_HOME: join(testHome, ".grok"),
    }, stdout: "pipe", stderr: "pipe", stdin: "ignore",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  return { code, stdout, stderr };
}

describe("profile command contract", () => {
  test("removed archive commands reject and leave existing user data untouched", async () => {
    const archiveDir = join(testHome, ".dch", "backups");
    await mkdir(archiveDir, { recursive: true });
    const archive = join(archiveDir, "existing.dchpack");
    await writeFile(archive, "existing-user-archive");
    for (const command of [
      "backup", "restore", "backups", "backup-rm", "backup-pin",
      "backup-prepare", "backup-commit", "backup-cancel", "backup-policy",
    ]) {
      const result = await run([command]);
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stdout).error).toContain(`未知子命令: ${command}`);
    }
    expect(await readFile(archive, "utf8")).toBe("existing-user-archive");
    expect(await readdir(join(testHome, ".dch"))).toEqual(["backups"]);
    const help = await run(["help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).not.toMatch(/backup|restore|dchpack|备份/);
  });

  test("update preserves core fields and supports both hook forms and explicit clearing", async () => {
    const dir = join(testHome, "work");
    expect((await run(["add", "claude", "work", "--dir", dir])).code).toBe(0);
    const nextDir = join(testHome, "next");
    await mkdir(nextDir);
    const patch = {
      configDir: nextDir, description: "work profile", env: { DEMO: "a'b $text" },
      hooks: { preSwitch: "echo pre", postSwitch: { posix: "echo post", powershell: "Write-Output post" } },
      hookTimeoutMs: 45_000,
    };
    const update = await run(["update", "work", "--payload", JSON.stringify(patch)]);
    expect(update.code).toBe(0);
    expect(JSON.parse(update.stdout).profile).toEqual({ id: "work", tool: "claude", ...patch });
    const show = await run(["show", "work"]);
    expect(JSON.parse(show.stdout)).toEqual({ id: "work", tool: "claude", ...patch });
    const clear = await run(["update", "work", "--payload", '{"env":null,"hooks":null,"description":null}']);
    expect(clear.code).toBe(0);
    expect(JSON.parse(clear.stdout).profile).toEqual({ id: "work", tool: "claude", configDir: nextDir, hookTimeoutMs: 45_000 });
    expect(await readdir(dir)).toEqual([]);
  });

  test("unsupported stores reject before init changes directories or save changes bytes", async () => {
    const storePath = join(testHome, ".dch", "profiles.json");
    await mkdir(join(testHome, ".dch"));
    await mkdir(join(testHome, ".claude"));
    await writeFile(join(testHome, ".claude", "settings.json"), "keep");
    const original = '{"version":1,"profiles":[],"active":{}}';
    await writeFile(storePath, original);
    for (const args of [["list"], ["init", "claude"], ["add", "claude", "new", "--dir", join(testHome, "new")]]) {
      const result = await run(args);
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stdout).error).toContain("仅支持 version: 2");
    }
    expect(await readFile(storePath, "utf8")).toBe(original);
    expect((await readdir(testHome)).sort()).toEqual([".claude", ".dch"]);
    expect(await readFile(join(testHome, ".claude", "settings.json"), "utf8")).toBe("keep");
  });

  test.each(["null", "[]", '{"backupPolicy":{}}', '{"hookTimeoutMs":0}'])("invalid update payload %s does not save", async (payload) => {
    const directory = join(testHome, "work");
    expect((await run(["add", "claude", "work", "--dir", directory])).code).toBe(0);
    const path = join(testHome, ".dch", "profiles.json");
    const before = await readFile(path, "utf8");
    expect((await run(["update", "work", "--payload", payload])).code).toBe(1);
    expect(await readFile(path, "utf8")).toBe(before);
  });
});

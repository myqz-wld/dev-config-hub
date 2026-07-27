import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI_PATH = join(resolve(import.meta.dir, ".."), "src", "cli.ts");
let testHome = "";

beforeEach(async () => {
  testHome = await mkdtemp(join(tmpdir(), "dch-profile-create-"));
});

afterEach(async () => {
  await rm(testHome, { recursive: true, force: true });
});

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

describe("profile add directory semantics", () => {
  test("all four tools create only an empty management directory", async () => {
    for (const tool of ["claude", "codex", "grok", "cursor"]) {
      const directory = join(testHome, `${tool}-empty`);
      const result = await run([
        "add", tool, `${tool}-empty`, "--dir", directory, "--timeout", "45000",
      ]);
      expect(result.exitCode).toBe(0);
      expect(await readdir(directory)).toEqual([]);
    }

    const store = JSON.parse(
      await readFile(join(testHome, ".dch", "profiles.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(store.version).toBe(2);
    expect(store).not.toHaveProperty("preferences");
    expect((store.profiles as Array<{ hookTimeoutMs: number }>).map(
      (profile) => profile.hookTimeoutMs,
    )).toEqual([45_000, 45_000, 45_000, 45_000]);
  });

  test("--existing registers a real directory without copying or modifying contents", async () => {
    const directory = join(testHome, "already-here");
    await mkdir(directory);
    await writeFile(join(directory, "custom.conf"), "keep-me\n");

    const result = await run([
      "add", "claude", "existing", "--dir", directory, "--existing",
    ]);
    expect(result.exitCode).toBe(0);
    expect(await readdir(directory)).toEqual(["custom.conf"]);
    expect(await readFile(join(directory, "custom.conf"), "utf8")).toBe("keep-me\n");
  });

  test("existing directory requires --existing and duplicate directories are rejected", async () => {
    const directory = join(testHome, "owned");
    await mkdir(directory);
    await writeFile(join(directory, "settings.json"), "{}\n");

    const createResult = await run(["add", "claude", "wrong-mode", "--dir", directory]);
    expect(createResult.exitCode).toBe(1);
    expect(JSON.parse(createResult.stdout).error).toMatch(/已存在|已有目录/);
    expect(await readFile(join(directory, "settings.json"), "utf8")).toBe("{}\n");

    expect((await run([
      "add", "claude", "first", "--dir", directory, "--existing",
    ])).exitCode).toBe(0);
    const duplicate = await run([
      "add", "codex", "second", "--dir", directory, "--existing",
    ]);
    expect(duplicate.exitCode).toBe(1);
    expect(JSON.parse(duplicate.stdout).error).toMatch(/已由方案 first 管理/);
  });

  test("legacy clone flag is rejected", async () => {
    const result = await run([
      "add", "claude", "clone", "--dir", join(testHome, "clone"), "--from", "old",
    ]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error).toMatch(/未知 flag --from/);
  });
});

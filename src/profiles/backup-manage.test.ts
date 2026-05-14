import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import {
  listBackups, deleteBackup, pinBackup,
  BACKUP_DIR, DEFAULT_FILENAME, resolveBackupPath,
} from "./backup-manage.ts";

// 注：listBackups 走 BACKUP_DIR 常量（来自真实 ~/.dch/backups），无法用 module mock 隔离（top-level
// await 顺序问题导致 mock 不生效）。这里只测：
//   1. resolveBackupPath（纯函数）
//   2. deleteBackup / pinBackup 用**绝对路径**调用，绕过 BACKUP_DIR，操作临时目录的 fake .dchpack
//   3. 常量本身（DEFAULT_FILENAME / BACKUP_DIR 末段）
// listBackups 的端到端覆盖留 CLI 冒烟（dch profile backups）。

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "dch-backup-mgmt-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function fileExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

const FAKE_MANIFEST = {
  format_version: 1,
  created_at: "2026-05-13T08:00:00.000Z",
  source_user: "tester",
  source_host: "test-mac",
  dch_version: "1.0.0",
  options: { include_shared: true, no_placeholder: false, profile_ids: ["claude-default"] },
  profiles: [{ id: "claude-default", tool: "claude" }],
  shared: { dch_scripts: ["a.sh"], agents_paths: [] },
  placeholders: [{ packPath: "x", fieldName: "TOKEN", fieldPath: "$.t", hint: "" }],
};

async function writeFakeDchpack(path: string): Promise<void> {
  const stagingDir = await mkdtemp(join(tmpdir(), "dch-fake-staging-"));
  try {
    await writeFile(join(stagingDir, "manifest.json"), JSON.stringify(FAKE_MANIFEST));
    const proc = Bun.spawn(["tar", "-czf", path, "-C", stagingDir, "."], { stdout: "ignore", stderr: "pipe" });
    const code = await proc.exited;
    if (code !== 0) throw new Error("tar failed");
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

describe("常量", () => {
  it("DEFAULT_FILENAME = latest.dchpack", () => {
    expect(DEFAULT_FILENAME).toBe("latest.dchpack");
  });

  it("BACKUP_DIR 末段是 backups", () => {
    expect(BACKUP_DIR.endsWith("/backups")).toBe(true);
    expect(isAbsolute(BACKUP_DIR)).toBe(true);
  });
});

describe("resolveBackupPath", () => {
  it("basename → BACKUP_DIR/<name>", () => {
    expect(resolveBackupPath("foo.dchpack")).toBe(join(BACKUP_DIR, "foo.dchpack"));
  });

  it("绝对路径原样返回", () => {
    expect(resolveBackupPath("/tmp/x.dchpack")).toBe("/tmp/x.dchpack");
  });

  it("~/形态展开 home", () => {
    const r = resolveBackupPath("~/foo.dchpack");
    expect(r.endsWith("/foo.dchpack")).toBe(true);
    expect(r.startsWith("/")).toBe(true);
    expect(r.includes("~")).toBe(false);
  });

  it("空字符串抛错", () => {
    expect(() => resolveBackupPath("")).toThrow();
  });

  it("含 / 的相对路径 → cwd 拼接", () => {
    const r = resolveBackupPath("./foo/bar.dchpack");
    expect(isAbsolute(r)).toBe(true);
  });
});

describe("deleteBackup（绝对路径）", () => {
  // **REVIEW_9 B-codex M2**: 默认 deleteBackup enforce BACKUP_DIR 边界 + .dchpack 后缀。
  // 单元测试在 mkdtemp tmpDir 下创 fake .dchpack(非真 BACKUP_DIR),传 opt-out 让 test 通过;
  // production caller (cli-backup cmdBackupRm / bridge.backupRm) **不**传此 opt 走默认严格。
  const TEST_OPTS = { allowOutsideBackupDir: true };

  it("删 .dchpack + 同名 .pinned sidecar", async () => {
    const pack = join(tmpDir, "test.dchpack");
    await writeFakeDchpack(pack);
    await writeFile(`${pack}.pinned`, "");
    expect(await fileExists(pack)).toBe(true);
    expect(await fileExists(`${pack}.pinned`)).toBe(true);

    await deleteBackup(pack, TEST_OPTS);

    expect(await fileExists(pack)).toBe(false);
    expect(await fileExists(`${pack}.pinned`)).toBe(false);
  });

  it("无 sidecar 时也能正常删 .dchpack", async () => {
    const pack = join(tmpDir, "test-no-sidecar.dchpack");
    await writeFakeDchpack(pack);
    await deleteBackup(pack, TEST_OPTS);
    expect(await fileExists(pack)).toBe(false);
  });

  it("不存在 → 抛错", async () => {
    await expect(deleteBackup(join(tmpDir, "non-exist.dchpack"), TEST_OPTS)).rejects.toThrow("备份不存在");
  });

  // **REVIEW_9 B-codex M2**: 加固测试
  it("拒非 .dchpack 后缀(防 webview 误传任意路径)", async () => {
    const evil = join(tmpDir, "creds.txt");
    await writeFile(evil, "secret");
    await expect(deleteBackup(evil, TEST_OPTS)).rejects.toThrow(/拒绝删除非 .dchpack/);
    expect(await fileExists(evil)).toBe(true); // 原文件未动
  });

  it("默认 enforce BACKUP_DIR 边界(不传 opt-out)→ 拒 BACKUP_DIR 外路径", async () => {
    const outside = join(tmpDir, "test.dchpack");
    await writeFakeDchpack(outside);
    await expect(deleteBackup(outside)).rejects.toThrow(/BACKUP_DIR 外的文件/);
    expect(await fileExists(outside)).toBe(true);
  });
});

describe("pinBackup（绝对路径，非默认位）", () => {
  it("pin=true → 原地 touch sidecar，不复制", async () => {
    const pack = join(tmpDir, "history.dchpack");
    await writeFakeDchpack(pack);

    const r = await pinBackup(pack, true);

    expect(r.copiedFromLatest).toBe(false);
    expect(r.pinnedPath).toBe(pack);
    expect(await fileExists(`${pack}.pinned`)).toBe(true);
  });

  it("pin=false → 删 sidecar", async () => {
    const pack = join(tmpDir, "history.dchpack");
    await writeFakeDchpack(pack);
    await writeFile(`${pack}.pinned`, "");

    const r = await pinBackup(pack, false);

    expect(r.copiedFromLatest).toBe(false);
    expect(await fileExists(`${pack}.pinned`)).toBe(false);
  });

  it("pin=false 但本来没 sidecar → 不报错（idempotent）", async () => {
    const pack = join(tmpDir, "history.dchpack");
    await writeFakeDchpack(pack);

    await expect(pinBackup(pack, false)).resolves.toBeDefined();
  });

  it("pin 不存在的 .dchpack → 抛错", async () => {
    await expect(pinBackup(join(tmpDir, "non-exist.dchpack"), true)).rejects.toThrow("备份不存在");
  });
});

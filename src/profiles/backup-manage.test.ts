import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import {
  deleteBackup, pinBackup,
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

// **REVIEW_9 B-codex M2 / B-MED-1**: deleteBackup / pinBackup 默认 enforce BACKUP_DIR 边界 +
// `.dchpack` 后缀。单元测试在 mkdtemp tmpDir 下创 fake .dchpack(非真 BACKUP_DIR),传 opt-out
// 让 test 通过;production caller (CLI cmdBackup* / bridge.backup*)**不**传此 opt 走默认严格。
const TEST_OPTS = { allowOutsideBackupDir: true };

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
  // pinBackup 同款约束(REVIEW_9 B-MED-1) — 共用 TEST_OPTS。

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

    const r = await pinBackup(pack, true, TEST_OPTS);

    expect(r.copiedFromLatest).toBe(false);
    expect(r.pinnedPath).toBe(pack);
    expect(await fileExists(`${pack}.pinned`)).toBe(true);
  });

  it("pin=false → 删 sidecar", async () => {
    const pack = join(tmpDir, "history.dchpack");
    await writeFakeDchpack(pack);
    await writeFile(`${pack}.pinned`, "");

    const r = await pinBackup(pack, false, TEST_OPTS);

    expect(r.copiedFromLatest).toBe(false);
    expect(await fileExists(`${pack}.pinned`)).toBe(false);
  });

  it("pin=false 但本来没 sidecar → 不报错（idempotent）", async () => {
    const pack = join(tmpDir, "history.dchpack");
    await writeFakeDchpack(pack);

    await expect(pinBackup(pack, false, TEST_OPTS)).resolves.toBeDefined();
  });

  it("pin 不存在的 .dchpack → 抛错", async () => {
    await expect(
      pinBackup(join(tmpDir, "non-exist.dchpack"), true, TEST_OPTS),
    ).rejects.toThrow("备份不存在");
  });
});

describe("REVIEW_9 B-MED-2 [NEW REG post-G3]: resolveBackupPath / deleteBackup 防 `..` 逃逸", () => {
  it("resolveBackupPath 把 `..` 段折叠掉(防 startsWith 字符串前缀绕过)", () => {
    // 攻击 payload: BACKUP_DIR 字符串前缀 + `..` 段实际指向 BACKUP_DIR 外
    const malicious = `${BACKUP_DIR}/../../etc/passwd`;
    const r = resolveBackupPath(malicious);
    // resolve 折叠 `..` → 实际路径不再以 BACKUP_DIR + "/" 开头(escape 出去了)
    expect(r.startsWith(BACKUP_DIR + "/")).toBe(false);
    expect(r).not.toContain("..");
  });

  it("正常 BACKUP_DIR 内绝对路径 normalize 后不变", () => {
    const inside = `${BACKUP_DIR}/test.dchpack`;
    expect(resolveBackupPath(inside)).toBe(inside);
  });

  it("deleteBackup 默认严格模式拒 `..` 逃逸 BACKUP_DIR 边界", async () => {
    const malicious = `${BACKUP_DIR}/../../etc/passwd.dchpack`;
    await expect(deleteBackup(malicious)).rejects.toThrow(/BACKUP_DIR 外的文件|BACKUP_DIR 边界/);
  });

  it("deleteBackup 默认严格模式拒非 .dchpack 后缀", async () => {
    const nonDchpack = `${BACKUP_DIR}/test.txt`;
    await expect(deleteBackup(nonDchpack)).rejects.toThrow(/非 .dchpack/);
  });
});

describe("REVIEW_9 B-MED-1: pinBackup BACKUP_DIR + .dchpack 边界默认严格", () => {
  it("pinBackup 默认严格模式拒 BACKUP_DIR 外路径", async () => {
    const outside = join(tmpDir, "outside.dchpack");
    await writeFakeDchpack(outside);
    await expect(pinBackup(outside, true)).rejects.toThrow(/BACKUP_DIR 外的文件|BACKUP_DIR 边界/);
  });

  it("pinBackup 默认严格模式拒非 .dchpack 后缀", async () => {
    const nonDchpack = `${BACKUP_DIR}/something.txt`;
    await expect(pinBackup(nonDchpack, true)).rejects.toThrow(/非 .dchpack/);
  });

  it("pinBackup 默认严格模式拒 `..` 逃逸 BACKUP_DIR 边界", async () => {
    const malicious = `${BACKUP_DIR}/../../etc/passwd.dchpack`;
    await expect(pinBackup(malicious, true)).rejects.toThrow(/BACKUP_DIR 外的文件|BACKUP_DIR 边界/);
  });

  it("pinBackup allowOutsideBackupDir opt-in 时绕过边界(test 用)", async () => {
    const outside = join(tmpDir, "outside.dchpack");
    await writeFakeDchpack(outside);
    await expect(pinBackup(outside, true, TEST_OPTS)).resolves.toBeDefined();
  });
});

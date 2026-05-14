/**
 * REVIEW_9 G2 / B-HIGH-2: parseBackup tmpDir 泄漏修复测试。
 *
 * 旧实现 `Bun.file(manifestPath).json()` parse 失败时直接 throw 让 mkdtemp 出来的 tmpDir leak;
 * 实测用户开发机已堆 44 个 `dch-restore-*` 泄漏目录。
 *
 * 修法:把 mkdtemp 之后所有可能抛错的步骤包 try/catch,catch 内统一 cleanup tmpDir 后 rethrow。
 *
 * 测试策略:每条 test 跑前数 `os.tmpdir()` 下 `dch-restore-*` 目录数,跑后再数,确保无新增。
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBackup } from "./backup-restore.ts";

async function countRestoreDirs(): Promise<number> {
  const entries = await readdir(tmpdir());
  return entries.filter((n) => n.startsWith("dch-restore-")).length;
}

async function makeMinimalDchpack(tmpDir: string, manifestContent: string | null): Promise<string> {
  // 用真 tar -cz 创一个最小合法 .dchpack(只含 manifest.json),给 parseBackup 当输入。
  const stage = await mkdtemp(join(tmpDir, "stage-"));
  try {
    if (manifestContent !== null) {
      await writeFile(join(stage, "manifest.json"), manifestContent);
    }
    const out = join(tmpDir, "test.dchpack");
    const proc = Bun.spawn(["tar", "-czf", out, "-C", stage, "."], { stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    if (code !== 0) throw new Error(`tar 失败 code=${code}`);
    return out;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

describe("REVIEW_9 G2 / B-HIGH-2: parseBackup tmpDir cleanup on failure", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "dch-test-work-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("manifest.json 是损坏 JSON → throw + cleanup tmpDir", async () => {
    // 制造 broken manifest(非合法 JSON)
    const pack = await makeMinimalDchpack(workDir, "{ this is not json");

    const before = await countRestoreDirs();
    await expect(parseBackup(pack)).rejects.toThrow(/manifest.json 解析失败/);
    const after = await countRestoreDirs();

    expect(after).toBe(before); // 无 tmpDir leak
  });

  it("manifest.json 缺 format_version → throw + cleanup tmpDir", async () => {
    // 合法 JSON 但缺 format_version 字段(不兼容版本)
    const pack = await makeMinimalDchpack(workDir, JSON.stringify({ profiles: [] }));

    const before = await countRestoreDirs();
    await expect(parseBackup(pack)).rejects.toThrow(/不兼容的 format_version/);
    const after = await countRestoreDirs();

    expect(after).toBe(before);
  });

  it("manifest.json 不存在(empty .dchpack)→ throw + cleanup tmpDir", async () => {
    const pack = await makeMinimalDchpack(workDir, null);

    const before = await countRestoreDirs();
    await expect(parseBackup(pack)).rejects.toThrow(/未找到 manifest.json/);
    const after = await countRestoreDirs();

    expect(after).toBe(before);
  });

  it(".dchpack 文件不存在 → throw 不创建 tmpDir", async () => {
    const before = await countRestoreDirs();
    await expect(parseBackup(join(workDir, "missing.dchpack"))).rejects.toThrow(/备份文件不存在/);
    const after = await countRestoreDirs();

    expect(after).toBe(before);
  });

  it("非合法 .dchpack(随便一个 binary 文件)→ tar 解压失败 + cleanup tmpDir", async () => {
    const bad = join(workDir, "bad.dchpack");
    await writeFile(bad, Buffer.from([0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa]));

    const before = await countRestoreDirs();
    await expect(parseBackup(bad)).rejects.toThrow(/解压备份失败/);
    const after = await countRestoreDirs();

    expect(after).toBe(before);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IS_WIN } from "../platform.ts";
import {
  resolveSafeArchiveFile,
  restoreManifestProfileFiles,
} from "./backup-restore-files.ts";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dch-restore-files-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe.skipIf(IS_WIN)("manifest-only restore path boundaries", () => {
  it("rejects an archive root that is itself a symlink", async () => {
    const realSource = join(root, "real-source");
    const linkedSource = join(root, "linked-source");
    await mkdir(realSource);
    await writeFile(join(realSource, "safe.txt"), "source");
    await symlink(realSource, linkedSource);

    expect(await resolveSafeArchiveFile(linkedSource, "safe.txt", root)).toBeNull();
  });

  it("rejects a destination root symlink even for an empty manifest file list", async () => {
    const source = join(root, "source");
    const victim = join(root, "victim");
    const linkedDestination = join(root, "linked-destination");
    await mkdir(source);
    await mkdir(victim);
    await symlink(victim, linkedDestination);

    await expect(
      restoreManifestProfileFiles(source, linkedDestination, [], {
        source: root,
        destination: root,
      }),
    ).rejects.toThrow(/还原目标根目录/);
    await expect(readFile(join(victim, "safe.txt"), "utf8")).rejects.toThrow();
  });
});

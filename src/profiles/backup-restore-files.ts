import {
  copyFile,
  lstat,
  mkdir,
  realpath,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { copyDirRecursive } from "./backup-shared.ts";
import { safeJoinUnderRoot } from "./backup-restore-paths.ts";

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (
    rel !== ".." &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel)
  );
}

async function assertDirectoryRoot(
  root: string,
  label: string,
  allowMissing = false,
): Promise<boolean> {
  try {
    const stats = await lstat(root);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`${label}必须是真实目录，不能是符号链接或特殊文件`);
    }
    return true;
  } catch (error) {
    if (
      allowMissing &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

/** Check existing descendants below a trusted root without following symlinks. */
export async function hasSymlinkBelowRoot(
  root: string,
  target: string,
): Promise<boolean> {
  const rel = relative(root, target);
  if (rel === "") return false;
  if (rel.startsWith("..") || isAbsolute(rel)) return true;
  let current = root;
  for (const segment of rel.split(sep)) {
    current = resolve(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) return true;
    } catch {
      // Missing destination segments are created by this restore and are safe.
      return false;
    }
  }
  return false;
}

export async function resolveSafeArchiveFile(
  sourceRoot: string,
  relativePath: unknown,
  archiveBoundaryRoot = sourceRoot,
): Promise<string | null> {
  if (typeof relativePath !== "string") return null;
  const lexical = safeJoinUnderRoot(sourceRoot, relativePath);
  if (!lexical || await hasSymlinkBelowRoot(archiveBoundaryRoot, lexical)) return null;
  try {
    const stats = await lstat(lexical);
    if (!stats.isFile() || stats.isSymbolicLink()) return null;
    const [boundaryReal, fileReal] = await Promise.all([
      realpath(archiveBoundaryRoot),
      realpath(lexical),
    ]);
    return isInside(boundaryReal, fileReal) ? lexical : null;
  } catch {
    return null;
  }
}

export async function restoreManifestProfileFiles(
  sourceRoot: string,
  destinationRoot: string,
  files: unknown,
  boundaries: {
    source?: string;
    destination?: string;
  } = {},
): Promise<void> {
  if (files !== undefined && !Array.isArray(files)) {
    throw new Error("manifest profile files 必须是数组");
  }
  if (await hasSymlinkBelowRoot(boundaries.destination ?? destinationRoot, destinationRoot)) {
    throw new Error("还原目标根目录含符号链接段");
  }
  await assertDirectoryRoot(destinationRoot, "还原目标根目录");
  if (await hasSymlinkBelowRoot(boundaries.source ?? sourceRoot, sourceRoot)) {
    throw new Error("包内配置根目录含符号链接段");
  }
  const sourceExists = await assertDirectoryRoot(
    sourceRoot,
    "包内配置根目录",
    true,
  );
  if (!sourceExists && (files === undefined || files.length === 0)) return;

  // Legacy v1 packages did not list profile files. walkFiles provides the
  // compatibility fallback and skips every symlink/special entry.
  if (files === undefined) {
    await copyDirRecursive(sourceRoot, destinationRoot);
    return;
  }
  for (const relativePath of files) {
    const source = await resolveSafeArchiveFile(
      sourceRoot,
      relativePath,
      boundaries.source,
    );
    if (!source || typeof relativePath !== "string") {
      throw new Error(`manifest profile file 被拒: ${JSON.stringify(relativePath)}`);
    }
    const destination = safeJoinUnderRoot(destinationRoot, relativePath);
    if (
      !destination ||
      await hasSymlinkBelowRoot(boundaries.destination ?? destinationRoot, destination)
    ) {
      throw new Error(`还原目标路径被拒: ${JSON.stringify(relativePath)}`);
    }
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
}

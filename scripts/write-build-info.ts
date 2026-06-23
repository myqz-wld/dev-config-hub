#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const outputPath = join(repoRoot, "build", "build-info.json");

function git(args: string[]): string | null {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return null;
  return new TextDecoder().decode(result.stdout).trim();
}

const tauriConfig = JSON.parse(readFileSync(join(repoRoot, "src-tauri", "tauri.conf.json"), "utf8")) as {
  productName?: string;
  version?: string;
};
const status = git(["status", "--porcelain"]);
const info = {
  name: "dev-config-hub",
  productName: tauriConfig.productName ?? "Dev Config Hub",
  version: tauriConfig.version ?? "unknown",
  commit: git(["rev-parse", "HEAD"]) ?? "unknown",
  shortCommit: git(["rev-parse", "--short=12", "HEAD"]) ?? "unknown",
  branch: git(["rev-parse", "--abbrev-ref", "HEAD"]) ?? "unknown",
  dirty: Boolean(status),
  builtAt: new Date().toISOString(),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(info, null, 2)}\n`);
console.log(`wrote ${outputPath}`);

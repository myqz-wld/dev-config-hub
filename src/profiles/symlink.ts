import { join, dirname, isAbsolute, resolve as pathResolve } from "node:path";
import { mkdir, lstat, readlink, rename, unlink, symlink } from "node:fs/promises";
import type { Profile, ToolKind } from "./types.ts";
import { expandHome, collapseHome, HOME } from "./store.ts";
import { getNodeConfigEnvironmentSync } from "../config-environment.ts";
import { profileToolRoot } from "../config-locations.ts";

const CONFIG_ENVIRONMENT = getNodeConfigEnvironmentSync();
export const TOOL_PATHS: Record<ToolKind, string> = {
  claude: profileToolRoot(CONFIG_ENVIRONMENT, "claude"),
  codex: profileToolRoot(CONFIG_ENVIRONMENT, "codex"),
  grok: profileToolRoot(CONFIG_ENVIRONMENT, "grok"),
  cursor: profileToolRoot(CONFIG_ENVIRONMENT, "cursor"),
};

/**
 * Win symlink 平台细节：
 * - 普通用户默认无 `SeCreateSymbolicLinkPrivilege`，`fs.symlink(target, path)` 抛 EPERM
 * - 解决：第三参传 `'junction'`，走 NTFS reparse point（不需要提权 + 不需要 Developer Mode）
 * - junction 限制：只能指向**绝对路径的目录**、不能跨分区
 * - profile.configDir 都在用户主目录下的子目录，全部满足
 *
 * POSIX：保留无 type 参（默认走 dir / file 自动判别）。
 *
 * 拆出 `getSymlinkType` / `normalizeSymlinkTarget` 纯函数让测试能跨平台直接验：
 * 在 macOS 上跑 unit test 不能动态改 `process.platform`，所以用纯函数 + 平台参数
 * 让 Win 行为也能在 mac 主机上单测。
 */
export type SymlinkType = "junction" | undefined;

export function getSymlinkType(platform: NodeJS.Platform = process.platform): SymlinkType {
  return platform === "win32" ? "junction" : undefined;
}

export function normalizeSymlinkTarget(p: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? pathResolve(p) : p;
}

const SYMLINK_TYPE: SymlinkType = getSymlinkType();
const symlinkTarget = (p: string): string => normalizeSymlinkTarget(p);

export type PathState = "missing" | "symlink" | "directory" | "file";

export interface InitResult {
  tool: ToolKind;
  state: "created-empty" | "wrapped-existing-dir" | "adopted-existing-symlink";
  defaultProfile: Profile;
}

export async function pathState(p: string): Promise<PathState> {
  try {
    const st = await lstat(p);
    if (st.isSymbolicLink()) return "symlink";
    if (st.isDirectory()) return "directory";
    return "file";
  } catch {
    return "missing";
  }
}

/**
 * 把工具的用户级配置根目录转成 symlink/junction，建立默认 profile 的目录基础。
 * - 真实目录：mv 到 ~/.<tool>-default，再 ln -s 回去
 * - 已是 symlink：读 target，注册成 default profile
 * - 不存在：创建空 ~/.<tool>-default 目录并 ln -s
 */
export async function initToolDir(tool: ToolKind): Promise<InitResult> {
  const target = TOOL_PATHS[tool];
  const defaultDir = join(HOME, `.${tool}-default`);
  const state = await pathState(target);

  if (state === "file") {
    throw new Error(`${target} 是普通文件，无法作为 ${tool} 的配置目录`);
  }

  let actualDir = defaultDir;
  let stateOut: InitResult["state"];

  if (state === "symlink") {
    let t = await readlink(target);
    if (!isAbsolute(t)) t = join(dirname(target), t);
    actualDir = t;
    stateOut = "adopted-existing-symlink";
  } else if (state === "directory") {
    if ((await pathState(defaultDir)) !== "missing") {
      throw new Error(`${defaultDir} 已存在但 ${target} 仍是真实目录，请手动清理后再 init`);
    }
    await rename(target, defaultDir);
    await symlink(symlinkTarget(defaultDir), target, SYMLINK_TYPE);
    stateOut = "wrapped-existing-dir";
  } else {
    if ((await pathState(defaultDir)) === "missing") {
      await mkdir(defaultDir, { recursive: true });
    }
    await mkdir(dirname(target), { recursive: true });
    await symlink(symlinkTarget(defaultDir), target, SYMLINK_TYPE);
    stateOut = "created-empty";
  }

  const defaultProfile: Profile = {
    id: `${tool}-default`,
    tool,
    configDir: collapseHome(actualDir),
    env: {},
    description: "默认 profile（由 dch profile init 创建）",
    isDefault: true,
  };

  return { tool, state: stateOut, defaultProfile };
}

/**
 * 原子切换 symlink。前置：target 必须已是 symlink（init 过）。
 * 步骤：
 *   1. 确认 target 是 symlink
 *   2. 确保新 configDir 存在（不存在则 mkdir -p）
 *   3. ln -s 新目标到临时名
 *   4. rename 临时名 → target（原子）
 */
export async function switchSymlink(profile: Profile): Promise<void> {
  const target = TOOL_PATHS[profile.tool];
  const newDir = expandHome(profile.configDir);
  const state = await pathState(target);

  if (state === "missing") {
    throw new Error(`${target} 不存在，请先跑: dch profile init ${profile.tool}`);
  }
  if (state === "directory") {
    throw new Error(`${target} 当前是真实目录（非 symlink）。请先跑: dch profile init ${profile.tool}`);
  }
  if (state === "file") {
    throw new Error(`${target} 是普通文件，拒绝覆盖`);
  }

  if ((await pathState(newDir)) === "missing") {
    await mkdir(newDir, { recursive: true });
  }

  const tmp = `${target}.dch-switch-${Date.now()}`;
  await symlink(symlinkTarget(newDir), tmp, SYMLINK_TYPE);
  try {
    await rename(tmp, target);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    // EXDEV：rename 跨设备 / 跨分区。junction 也不能跨卷，user-friendly 错误更有用。
    if ((e as NodeJS.ErrnoException)?.code === "EXDEV") {
      throw new Error(
        `[switchSymlink] 跨分区切换不支持（${target} 与 ${newDir} 在不同卷上）。` +
          `请把 profile.configDir 放与 ${target} 同卷的目录下重试。`,
      );
    }
    throw e;
  }
}

export async function currentSymlinkTarget(tool: ToolKind): Promise<string | null> {
  const target = TOOL_PATHS[tool];
  if ((await pathState(target)) !== "symlink") return null;
  let t = await readlink(target);
  if (!isAbsolute(t)) t = join(dirname(target), t);
  return t;
}

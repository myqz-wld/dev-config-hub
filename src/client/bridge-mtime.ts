/**
 * REVIEW_8 H7 / R3 G5：mtime CAS（compare-and-swap）错误类型 + classifier。
 *
 * 抽自 bridge.ts（504 LOC 越过 ≤500 护栏，R2-2）。本 module self-contained：纯类型 + 字符串
 * 解析，不 import bridge.call / Tauri runtime，避免循环 import；test 可独立 import。
 *
 * 后端约定（src-tauri/src/atomic.rs:write_atomic_check_mtime）：
 * - `MTIME_MISMATCH:<expected>:<actual>` → throw `MtimeMismatchError`（含 expected/actual）
 * - `MTIME_MISSING:<expected>`           → throw `MtimeMissingError`（caller 期望存在但已删）
 * - 其他 IO / boundary 失败 → 原始 Error 透传
 *
 * caller 用 `isMtimeMismatch(e)` / `isMtimeMissing(e)` 判定，而非 instanceof —— 见下面注释。
 */

export class MtimeMismatchError extends Error {
  constructor(public readonly expectedMtimeUs: number, public readonly actualMtimeUs: number) {
    super(`文件已被外部修改（expected mtime=${expectedMtimeUs}us, actual=${actualMtimeUs}us）`);
    this.name = "MtimeMismatchError";
  }
}

export class MtimeMissingError extends Error {
  constructor(public readonly expectedMtimeUs: number) {
    super(`文件已被删除（expected mtime=${expectedMtimeUs}us）`);
    this.name = "MtimeMissingError";
  }
}

/**
 * REVIEW_8 H7 / Group E1：判断 Error 是否为 mtime CAS 错（mismatch / missing）。
 *
 * **不直接用 `instanceof`**：bun mock.module 替换 module exports 时，consumer 通过
 * `import { MtimeMismatchError } from "./bridge.ts"` 拿到的 class 与 test 文件直接
 * `new MtimeMismatchError(...)` 的 class **不一定是同一个 prototype 引用** — instanceof
 * 比较 prototype chain，跨 module / 跨 mock 时可能 false-negative。改用 `e.name === ...`
 * 判断更鲁棒（约定：classifySaveError 输出的实例必带 name="MtimeMismatchError" /
 * "MtimeMissingError"）。
 */
export function isMtimeMismatch(e: unknown): boolean {
  return e instanceof Error && e.name === "MtimeMismatchError";
}
export function isMtimeMissing(e: unknown): boolean {
  return e instanceof Error && e.name === "MtimeMissingError";
}

/**
 * 把 Tauri invoke 抛出的错误（string / Error）按前缀分类成专门的错误类，
 * 让 caller 可以 isMtimeMismatch / isMtimeMissing 区分 mtime CAS 失败 vs 普通 IO 错。
 *
 * 抽成 pure 函数（named export）方便单测：bridge.test.ts 不能 mock invoke
 * （`bun mock.module` 跨 file 污染：App.test.tsx mock 了 ./bridge.ts 让其他 file
 * import 拿到 stub），但可以直接测 classifySaveError 的字符串解析逻辑。
 */
export function classifySaveError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  const mismatch = /MTIME_MISMATCH:(\d+):(\d+)/.exec(msg);
  if (mismatch) {
    return new MtimeMismatchError(Number(mismatch[1]), Number(mismatch[2]));
  }
  const missing = /MTIME_MISSING:(\d+)/.exec(msg);
  if (missing) {
    return new MtimeMissingError(Number(missing[1]));
  }
  return e instanceof Error ? e : new Error(msg);
}

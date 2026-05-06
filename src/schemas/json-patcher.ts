import {
  modify,
  applyEdits,
  parse as parseJsonc,
  type JSONPath,
  type FormattingOptions,
  type ParseError,
} from "jsonc-parser";

/**
 * 字段级 JSON patch：原文 + 局部 edit，注释 / 字段顺序 / 缩进 / 空行尽可能保留。
 *
 * **数据完整性铁律**：所有写回必须以 `patchJson(原文, [...patches])` 形式做，
 * 禁止「全量序列化 ConfigScope.parsed」——只有这样 schema 不认识的用户自定义 key 才永远不丢。
 *
 * 底层用 VSCode 同款 `jsonc-parser`（modify + applyEdits）。
 */

export interface JsonPatch {
  /** JSON 路径：每段是 string（object key）或 number（array index）。 */
  path: ReadonlyArray<string | number>;
  /** undefined = 删除该 key 或 array element。 */
  value: unknown | undefined;
}

export interface JsonPatchOptions {
  /** 覆盖自动嗅探的缩进宽度（空格数；制表符传 1 + insertSpaces=false）。 */
  tabSize?: number;
  insertSpaces?: boolean;
  /** 覆盖自动嗅探的换行符。 */
  eol?: "\n" | "\r\n";
}

export interface DetectedFormat {
  tabSize: number;
  insertSpaces: boolean;
  eol: "\n" | "\r\n";
}

/**
 * 在原文上按 patches 顺序做字段级 edit。
 *
 * 行为：
 *   - 单 key 改值：in-place 替换字面，注释 / 前后空行不动
 *   - 删 key：`value === undefined`，整行删除（含尾随逗号 jsonc-parser 自动处理）
 *   - 加 key：value 不为 undefined 且 path 在原文不存在 → 追加到父对象末尾，按现有缩进
 *   - 数组操作：末段是 number index → 修改 / 删除该下标；index === length → push
 *   - 多个 patch 顺序应用（前一个 applyEdits 完后再算下一个，避免位置串扰）
 *   - patches 为空 → 原样返
 *
 * **顶层非 object 防御**（REVIEW_3 R_1·C4 + R_2 D1 实证修订）：
 *   - jsonc-parser@3.3.1 实测：`null` / `number` / `array` / `string-literal` 顶层
 *     **全部 modify 抛异常** "Can not add index to parent of type X"。patchJson 内 try/catch
 *     转换为带 path 上下文的友好 Error，避免直接异常冒泡到 caller UI 崩
 *     （参考 REVIEW_2 #H2：save 抛异常会让用户编辑内容丢失）
 *   - `assertValidJsonOut` 后置校验：在当前 jsonc-parser 版本下**实测无触发场景**——
 *     所有非 object 顶层都被 modify throw 截在 try/catch。但保留作为「**回归网**」：
 *     若上游升级 jsonc-parser 后 string-literal 改成 silent corruption（产出 `{"a":1}hi`
 *     这种合法文本但无效 JSON），后置校验能立刻捕获。perf cost 实测 100KB JSON ~1ms，
 *     可接受
 *
 * **caller 责任**（PR-D 集成时）：在调用 patchJson 之前必须 guard
 *   `typeof scope.parsed === "object" && scope.parsed !== null && !Array.isArray(scope.parsed)`，
 *   只对 object 顶层文件触发字段级 edit；patchJson 的防御只是兜底，不是替代前置校验。
 */
export function patchJson(
  source: string,
  patches: readonly JsonPatch[],
  options: JsonPatchOptions = {},
): string {
  if (patches.length === 0) return source;
  const detected = detectFormat(source);
  const formattingOptions: FormattingOptions = {
    tabSize: options.tabSize ?? detected.tabSize,
    insertSpaces: options.insertSpaces ?? detected.insertSpaces,
    eol: options.eol ?? detected.eol,
  };
  let out = source;
  for (const { path, value } of patches) {
    let edits;
    try {
      edits = modify(out, path as JSONPath, value, { formattingOptions });
    } catch (e) {
      const pathStr = path.length ? path.map(String).join(".") : "<root>";
      throw new Error(
        `patchJson 失败 at [${pathStr}]: ${(e as Error).message}. ` +
          `源文件顶层应是 object —— jsonc-parser 对 null / number / array 顶层会抛`,
      );
    }
    if (edits.length > 0) out = applyEdits(out, edits);
  }
  assertValidJsonOut(out);
  return out;
}

/**
 * 后置 silent corruption 校验：jsonc-parser modify 在某些 caller 路径（ESM/CJS 解析模式）
 * 下对顶层字符串字面量 (如 `"hi"`) 不抛异常但产出非法 JSON 文本（`{"a":1}hi`）—— 比 throw 更危险。
 *
 * **R_2 D1 实证**：jsonc-parser@3.3.1 + bun TS test 上下文下，所有非 object 顶层都被 modify throw
 * 截在外层 try/catch，本函数实际无触发场景。**保留作为升级回归网**：上游 jsonc-parser 改了
 * string-literal 行为（变 silent corruption）能立刻在此被捕获。perf cost 实测 100KB JSON ~1ms，
 * 占 patchJson 总耗时 50% 但绝对值可接受（用户主动 save 触发，非 onChange 高频）。
 *
 * 用 jsonc-parser 自带的 parseJsonc 容忍 jsonc 注释 / trailing comma，避免对合法 jsonc 误报。
 */
function assertValidJsonOut(out: string): void {
  if (!out.length) return;
  const errors: ParseError[] = [];
  parseJsonc(out, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new Error(
      `patchJson 产出无效 JSON（${errors.length} 处解析错误，可能源文件顶层非 object 导致 silent corruption）`,
    );
  }
}

/**
 * 从原文嗅探缩进与 EOL。
 *
 * 缩进规则（按优先级）：
 *   1. 找首个 `{` 或 `[` 之后第一个「真正缩进的非注释、非空白行」前导空白
 *   2. 跳过空行 / 纯空白行 / 行首 jsonc 注释（`//` 或 `/*` 或 ` *`）—— REVIEW_3 R_1·C10
 *   3. 起首是 `\t` → tab 缩进（tabSize=1, insertSpaces=false）
 *   4. 否则按空格数（常见 2 / 4）
 *   5. 嗅不到（空文件 / 单行 JSON / 紧凑 JSON）→ 默认 2-space
 *
 * EOL 规则：原文出现过 `\r\n` 即视为 CRLF，否则 LF。
 *
 * **已知限制**（REVIEW_3 R_2·#2）：多行 block comment 的 continuation 行如果**不带 `*` 前缀**
 * （罕见非 JSDoc 风格，如 `   continuation without star`），会被误识为缩进行，嗅成错的 tabSize。
 * 实际配置文件（settings.json / config.toml）此风格极少见；接受此 heuristic 限制不引入更复杂
 * 多行 comment 解析。命中时只影响新增 key 的格式，不丢数据。
 */
export function detectFormat(source: string): DetectedFormat {
  const eol: "\n" | "\r\n" = /\r\n/.test(source) ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);

  let braceLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/[\{\[]/.test(lines[i] ?? "")) {
      braceLineIdx = i;
      break;
    }
  }
  if (braceLineIdx < 0) return { tabSize: 2, insertSpaces: true, eol };

  for (let i = braceLineIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed) continue;
    // 跳行首 jsonc 注释，让缩进嗅探穿透到首个真实内容行
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;
    const m = /^([ \t]+)\S/.exec(line);
    if (!m) return { tabSize: 2, insertSpaces: true, eol };
    const lead = m[1] as string;
    if (lead.startsWith("\t")) return { tabSize: 1, insertSpaces: false, eol };
    return { tabSize: lead.length, insertSpaces: true, eol };
  }
  return { tabSize: 2, insertSpaces: true, eol };
}

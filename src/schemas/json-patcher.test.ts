import { describe, expect, it } from "bun:test";
import { detectFormat, patchJson } from "./json-patcher.ts";

describe("detectFormat", () => {
  it("默认 2 空格 + LF", () => {
    expect(detectFormat("")).toEqual({ tabSize: 2, insertSpaces: true, eol: "\n" });
  });

  it("4 空格缩进", () => {
    const src = `{\n    "a": 1\n}\n`;
    expect(detectFormat(src)).toEqual({ tabSize: 4, insertSpaces: true, eol: "\n" });
  });

  it("tab 缩进", () => {
    const src = "{\n\t\"a\": 1\n}\n";
    expect(detectFormat(src)).toEqual({ tabSize: 1, insertSpaces: false, eol: "\n" });
  });

  it("CRLF 命中", () => {
    const src = `{\r\n  "a": 1\r\n}\r\n`;
    expect(detectFormat(src).eol).toBe("\r\n");
  });

  // ─── REVIEW_3 R_1·C10 回归：jsonc 顶部注释穿透 ───
  it("REVIEW_3 R_1·C10: 4-space + 顶部行注释 → 嗅出 4-space（不是 fallback 2）", () => {
    // codex 实证：原 regex `[\{\[][^\n]*\n([ \t]+)\S` 只看 `{` 后第一行，
    // 命中注释行而非缩进行 → fallback 2-space 错。修复后跳过 `//` 行
    const src = `{\n// 顶部注释\n    "model": "claude-opus-4-7"\n}\n`;
    expect(detectFormat(src).tabSize).toBe(4);
  });

  it("REVIEW_3 R_1·C10: 4-space + 顶部 block 注释 → 嗅出 4-space", () => {
    const src = `{\n/* block */\n    "a": 1\n}\n`;
    expect(detectFormat(src).tabSize).toBe(4);
  });

  it("REVIEW_3 R_1·C10: tab 缩进 + 顶部注释 → 嗅出 tab", () => {
    const src = "{\n// comment\n\t\"a\": 1\n}\n";
    expect(detectFormat(src).insertSpaces).toBe(false);
  });

  it("REVIEW_3 R_1·C10: 紧凑单行 JSON → fallback 2-space（不命中怪缩进）", () => {
    expect(detectFormat(`{ "a": 1 }`).tabSize).toBe(2);
  });

  it("REVIEW_3 R_1·C10: 多空行 + 多注释行 → 跳到首个真实缩进行", () => {
    const src = `{\n\n   // 注释\n\n    "a": 1\n}\n`;
    expect(detectFormat(src).tabSize).toBe(4);
  });
});

describe("patchJson", () => {
  it("改单 scalar：行内注释 + 前后空行保留", () => {
    const src = `{
  // 模型选择
  "model": "claude-opus-4-7", // 默认 opus

  "fastMode": false
}
`;
    const out = patchJson(src, [{ path: ["model"], value: "claude-sonnet-4-6" }]);
    expect(out).toContain('"model": "claude-sonnet-4-6"');
    expect(out).toContain("// 模型选择");
    expect(out).toContain("// 默认 opus");
    // 字段间空行保留
    expect(out).toMatch(/"claude-sonnet-4-6".*\n\n\s+"fastMode"/s);
  });

  it("改嵌套 object 内字段：兄弟字段 / 顺序不动", () => {
    const src = `{
  "permissions": {
    "defaultMode": "plan",
    "allow": ["Read"]
  },
  "model": "claude-opus-4-7"
}
`;
    const out = patchJson(src, [{ path: ["permissions", "defaultMode"], value: "acceptEdits" }]);
    expect(out).toContain('"defaultMode": "acceptEdits"');
    expect(out).toContain('"allow": ["Read"]');
    expect(out).toContain('"model": "claude-opus-4-7"');
    // permissions 在 model 之前
    expect(out.indexOf('"permissions"')).toBeLessThan(out.indexOf('"model"'));
  });

  it("删 key：含尾随逗号自动处理 + 兄弟字段保留", () => {
    const src = `{
  "a": 1,
  "b": 2,
  "c": 3
}
`;
    const out = patchJson(src, [{ path: ["b"], value: undefined }]);
    expect(out).not.toContain('"b"');
    expect(out).toContain('"a": 1');
    expect(out).toContain('"c": 3');
    // 不应该出现连续两个逗号
    expect(out).not.toMatch(/,\s*,/);
  });

  it("加新 key：追加到父对象末尾，按现有缩进", () => {
    const src = `{
  "a": 1
}
`;
    const out = patchJson(src, [{ path: ["b"], value: 2 }]);
    expect(out).toContain('"a": 1');
    expect(out).toContain('"b": 2');
    expect(out.indexOf('"a"')).toBeLessThan(out.indexOf('"b"'));
  });

  it("数组元素替换（按 index）", () => {
    const src = `{
  "allow": ["Read", "Write", "Bash"]
}
`;
    const out = patchJson(src, [{ path: ["allow", 1], value: "Edit" }]);
    expect(out).toContain('"Read"');
    expect(out).toContain('"Edit"');
    expect(out).toContain('"Bash"');
    expect(out).not.toContain('"Write"');
  });

  it("数组 push（index === length）", () => {
    const src = `{
  "allow": ["Read"]
}
`;
    const out = patchJson(src, [{ path: ["allow", 1], value: "Write" }]);
    expect(out).toMatch(/"allow":\s*\[\s*"Read",\s*"Write"\s*\]/);
  });

  it("4-space 缩进保持", () => {
    const src = `{
    "a": 1
}
`;
    const out = patchJson(src, [{ path: ["b"], value: 2 }]);
    // 新加的 key 也应该 4-space 缩进
    expect(out).toMatch(/^ {4}"b": 2/m);
  });

  it("tab 缩进保持", () => {
    const src = "{\n\t\"a\": 1\n}\n";
    const out = patchJson(src, [{ path: ["b"], value: 2 }]);
    expect(out).toMatch(/^\t"b": 2/m);
  });

  it("CRLF EOL 保持", () => {
    const src = `{\r\n  "a": 1\r\n}\r\n`;
    const out = patchJson(src, [{ path: ["b"], value: 2 }]);
    // 新增内容应该用 CRLF
    expect(out).toContain("\r\n");
    // 原本的 CRLF 不能被替换成 LF
    const lfOnly = out.replace(/\r\n/g, "");
    expect(lfOnly).not.toContain("\n");
  });

  it("trailing comma：jsonc 容忍，patch 后 trailing comma 保留", () => {
    const src = `{
  "a": 1,
  "b": 2,
}
`;
    const out = patchJson(src, [{ path: ["a"], value: 10 }]);
    expect(out).toContain('"a": 10');
    expect(out).toContain('"b": 2');
    // trailing comma 仍然存在
    expect(out).toMatch(/2,\s*\n}/);
  });

  it("schema 不认识的字段不丢（数据完整性铁律）", () => {
    const src = `{
  "model": "claude-opus-4-7",
  "my_custom_field": { "nested": [1, 2, 3] },
  "another_unknown": "value",
  "fastMode": false
}
`;
    const out = patchJson(src, [{ path: ["model"], value: "claude-sonnet-4-6" }]);
    expect(out).toContain('"model": "claude-sonnet-4-6"');
    expect(out).toContain('"my_custom_field"');
    expect(out).toContain('"nested"');
    expect(out).toContain("[1, 2, 3]");
    expect(out).toContain('"another_unknown": "value"');
    expect(out).toContain('"fastMode": false');
  });

  it("空 patches → 原样返回", () => {
    const src = `{ "a": 1 }`;
    expect(patchJson(src, [])).toBe(src);
  });

  it("多 patch 顺序应用", () => {
    const src = `{
  "a": 1,
  "b": 2
}
`;
    const out = patchJson(src, [
      { path: ["a"], value: 10 },
      { path: ["b"], value: 20 },
      { path: ["c"], value: 30 },
    ]);
    expect(out).toContain('"a": 10');
    expect(out).toContain('"b": 20');
    expect(out).toContain('"c": 30');
  });

  it("删除嵌套字段：保留父 object 与兄弟（语义断言）", () => {
    // 注意：jsonc-parser 在 patch 受影响的范围内会顺便 reformat（如把 `["Read"]`
    // 单行重排为多行），这是其设计行为而非 bug。本 case 用 JSON.parse round-trip
    // 校验**语义**不变，不依赖具体格式串。
    const src = `{
  "permissions": {
    "allow": ["Read"],
    "deny": ["Bash"]
  }
}
`;
    const out = patchJson(src, [{ path: ["permissions", "deny"], value: undefined }]);
    expect(JSON.parse(out)).toEqual({ permissions: { allow: ["Read"] } });
    expect(out).not.toContain('"deny"');
  });

  // ─── REVIEW_3 R_1·C4 回归：顶层非 object 防御 ───
  it("REVIEW_3 R_1·C4: 顶层 null → 抛带 path 上下文的友好 Error", () => {
    expect(() => patchJson("null", [{ path: ["a"], value: 1 }])).toThrow(/patchJson 失败 at \[a\]/);
  });

  it("REVIEW_3 R_1·C4: 顶层 number → 抛友好 Error", () => {
    expect(() => patchJson("1", [{ path: ["a"], value: 1 }])).toThrow(/patchJson 失败 at \[a\]/);
  });

  it("REVIEW_3 R_1·C4: 顶层 array → 抛友好 Error", () => {
    expect(() => patchJson("[]", [{ path: ["a"], value: 1 }])).toThrow(/patchJson 失败 at \[a\]/);
  });

  it("REVIEW_3 R_1·C4: 顶层 string-literal 也 throw（与 null/number/array 一致，被外层 try/catch 截）", () => {
    // R_2 D1 实证澄清：jsonc-parser@3.3.1 对 string-literal 顶层与 null/number/array 一致 throw
    // "Can not add index to parent of type string"，被 patchJson 外层 try/catch 截转友好 Error。
    // **不**触发 assertValidJsonOut（assertValidJsonOut 仅作上游升级后可能引入 silent corruption 的回归网，
    // 在当前版本实测无触发场景）。本断言验证「外层 try/catch 路径」生效，不验证 assertValidJsonOut。
    expect(() => patchJson('"hi"', [{ path: ["a"], value: 1 }])).toThrow(/patchJson 失败 at \[a\]/);
  });

  it("REVIEW_3 R_1·C4: 顶层空字符串 → modify 重写为 object，校验通过", () => {
    const out = patchJson("", [{ path: ["a"], value: 1 }]);
    expect(JSON.parse(out)).toEqual({ a: 1 });
  });

  it("REVIEW_3 R_1·C4: 顶层空 object 加 key → 校验通过", () => {
    const out = patchJson("{}", [{ path: ["a"], value: 1 }]);
    expect(JSON.parse(out)).toEqual({ a: 1 });
  });

  it("REVIEW_3 R_1·C4: nested array of objects 修改下标元素的字段 → 不丢兄弟", () => {
    // codex finding：原 18 case 没覆盖嵌套数组对象的字段操作
    const src = `{
  "items": [
    { "name": "a" },
    { "name": "b" }
  ]
}
`;
    const out = patchJson(src, [{ path: ["items", 1, "name"], value: "B" }]);
    expect(JSON.parse(out)).toEqual({ items: [{ name: "a" }, { name: "B" }] });
  });
});

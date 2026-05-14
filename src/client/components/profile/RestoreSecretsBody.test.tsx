import { describe, expect, it } from "bun:test";
import {
  computeSecretsButton,
} from "./RestoreSecretsBody.tsx";
import type { SecretLogicalEntry } from "../../bridge.ts";

// CHANGELOG_18：lock RestoreSecretsBody 的 derived helper 行为（pure，纯输入决定输出）。
// React 组件本身（4 banner 状态 / SecretEntryRow input value 隐藏 / details 折叠）走手工 UI 冒烟
// 验，放 plan §Step 8c case A-H。

const mockEntry = (name: string, count = 1): SecretLogicalEntry => ({
  name,
  fieldName: name.replace(/-\d+$/, ""),
  count,
  hint: `${count} occurrence`,
  locations: Array.from({ length: count }, (_, i) => ({
    packPath: `profiles/p${i}/configDir/x.json`,
    fieldPath: "$.k",
  })),
});

describe("computeSecretsButton — derived label / hasError", () => {
  const entries = [mockEntry("A-1"), mockEntry("B-1"), mockEntry("C-1")];

  it("全空 → hasError + 「还有 N 个待处理」", () => {
    const r = computeSecretsButton(entries, { secretsMap: {}, skipMap: {} });
    expect(r.hasError).toBe(true);
    expect(r.label).toContain("3 个待处理");
  });

  it("部分填部分空（仍有 pending）→ hasError + pending count", () => {
    const r = computeSecretsButton(entries, {
      secretsMap: { "A-1": "x" },
      skipMap: {},
    });
    expect(r.hasError).toBe(true);
    expect(r.label).toContain("2 个待处理");
  });

  it("部分填部分跳过（无 pending）→ no error + 「还原（K 填 / M 跳过）」", () => {
    const r = computeSecretsButton(entries, {
      secretsMap: { "A-1": "x" },
      skipMap: { "B-1": true, "C-1": true },
    });
    expect(r.hasError).toBe(false);
    expect(r.label).toBe("还原（1 填 / 2 跳过）");
  });

  it("全跳过 → no error + 「保留占位符还原」", () => {
    const r = computeSecretsButton(entries, {
      secretsMap: {},
      skipMap: { "A-1": true, "B-1": true, "C-1": true },
    });
    expect(r.hasError).toBe(false);
    expect(r.label).toBe("保留占位符还原");
  });

  it("全填 → no error + 「填值还原」", () => {
    const r = computeSecretsButton(entries, {
      secretsMap: { "A-1": "x", "B-1": "y", "C-1": "z" },
      skipMap: {},
    });
    expect(r.hasError).toBe(false);
    expect(r.label).toBe("填值还原");
  });

  it("空 entries（不该到 step 3）→ filled=skipped=pending=0 → no error；分支次序 skipped===total 先命中", () => {
    const r = computeSecretsButton([], { secretsMap: {}, skipMap: {} });
    // 实现里 total = 0 / filled = 0 / skipped = 0 / pending = 0
    // 分支次序：pending > 0（false） → skipped === total（true，0===0 命中） → "保留占位符还原"
    expect(r.hasError).toBe(false);
    expect(r.label).toBe("保留占位符还原");
  });

  it("skip 同时也填了 value → skip 优先（filled 不算）", () => {
    // skipMap[name]=true 在 filtered 计算里短路，value 即便存在不算 filled
    const r = computeSecretsButton(entries, {
      secretsMap: { "A-1": "x" },
      skipMap: { "A-1": true, "B-1": true, "C-1": true },
    });
    expect(r.hasError).toBe(false);
    expect(r.label).toBe("保留占位符还原");
  });

  it("空字符串 value 不算 filled（length === 0 短路）", () => {
    const r = computeSecretsButton(entries, {
      secretsMap: { "A-1": "", "B-1": "", "C-1": "" },
      skipMap: {},
    });
    // 全空 value 视同未填 → pending = 3
    expect(r.hasError).toBe(true);
    expect(r.label).toContain("3 个待处理");
  });
});

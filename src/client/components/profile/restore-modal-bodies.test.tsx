/**
 * REVIEW_9 follow-up F4 — splitErrorsForReport pure helper test。
 *
 * RestoreReportBody 用本 helper 把 result.errors[] 拆成「plain-text fill 失败」+「其他」两组,
 * 让 UI 单独友好显示前者。文件尾部另覆盖自定义 keep-original 包的明文风险提示。
 *
 * 匹配 regex 与 field-path.ts:fillSingleFile 报的文案对齐(R1 G1 落地的 "文件后缀非
 * .json/.toml,不支持自动 fill" 这种格式)— 改 field-path.ts 文案需同步本 helper RE。
 */

import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { Manifest } from "../../bridge.ts";
import {
  RestorePreviewBody,
  splitErrorsForReport,
} from "./restore-modal-bodies.tsx";

afterEach(() => cleanup());

describe("REVIEW_9 follow-up F4 — splitErrorsForReport", () => {
  it("空 errors 返双空数组", () => {
    const r = splitErrorsForReport([]);
    expect(r.plainTextFillFiles).toEqual([]);
    expect(r.otherErrors).toEqual([]);
  });

  it("仅普通 error(非 secrets-fill / 非后缀拒)→ 全进 otherErrors", () => {
    const errs = [
      "profile claude-pro 还原失败 (in-add): EACCES",
      "rename 失败: tmpOut 不存在",
    ];
    const r = splitErrorsForReport(errs);
    expect(r.plainTextFillFiles).toEqual([]);
    expect(r.otherErrors).toEqual(errs);
  });

  it("提取 plain-text 文件路径(后缀拒型)", () => {
    const errs = [
      "secrets-fill: /Users/me/.dch-restored/foo/CLAUDE.md: 文件后缀非 .json/.toml，不支持自动 fill（2 处占位符跳过）",
      "secrets-fill: /home/u/.dch-restored/bar/setup.sh: 文件后缀非 .json/.toml，不支持自动 fill（1 处占位符跳过）",
    ];
    const r = splitErrorsForReport(errs);
    expect(r.plainTextFillFiles).toEqual([
      "/Users/me/.dch-restored/foo/CLAUDE.md",
      "/home/u/.dch-restored/bar/setup.sh",
    ]);
    expect(r.otherErrors).toEqual([]);
  });

  it("混合后缀拒 + 其他 secrets-fill error → 后缀拒进 friendly,其他进 otherErrors", () => {
    const errs = [
      "secrets-fill: /Users/me/.dch-restored/x/notes.md: 文件后缀非 .json/.toml，不支持自动 fill（1 处占位符跳过）",
      "secrets-fill: /Users/me/.dch-restored/x/.mcp.json: writeFile 失败: ENOSPC",
      "profile foo 还原失败: EACCES",
    ];
    const r = splitErrorsForReport(errs);
    expect(r.plainTextFillFiles).toEqual(["/Users/me/.dch-restored/x/notes.md"]);
    expect(r.otherErrors).toEqual([
      "secrets-fill: /Users/me/.dch-restored/x/.mcp.json: writeFile 失败: ENOSPC",
      "profile foo 还原失败: EACCES",
    ]);
  });

  it("后缀拒匹配带空格 / 中文 / 括号路径不挂(贪婪 lazy 抓全 hostPath)", () => {
    const errs = [
      "secrets-fill: /Users/中文用户/path with spaces/file (1).md: 文件后缀非 .json/.toml，不支持自动 fill（5 处占位符跳过）",
    ];
    const r = splitErrorsForReport(errs);
    expect(r.plainTextFillFiles).toEqual(["/Users/中文用户/path with spaces/file (1).md"]);
    expect(r.otherErrors).toEqual([]);
  });

  it("不挂在子串匹配:errors 里含 `secrets-fill:` 但不是后缀拒型 → 全进 otherErrors", () => {
    const errs = [
      "secrets-fill: applyFilledSecrets 寻址失败: 路径 $.k 不存在",
      "其他 ::secrets-fill::: 不是开头 → otherErrors",
    ];
    const r = splitErrorsForReport(errs);
    expect(r.plainTextFillFiles).toEqual([]);
    expect(r.otherErrors).toEqual(errs);
  });

  it("自定义 keep-original 包即使不是 --no-placeholder 也显示明文警告", () => {
    const manifest = {
      format_version: 1,
      created_at: "2026-07-26T00:00:00.000Z",
      source_host: "test",
      source_user: "test",
      dch_version: "1.0.0",
      options: {
        include_scripts: false,
        no_placeholder: false,
        profile_ids: [],
      },
      profiles: [],
      shared: { dch_scripts: [] },
      placeholders: [],
      security_warnings: [],
      backup_audit: { contains_raw_secrets: true },
    } as unknown as Manifest;
    const { container } = render(
      <RestorePreviewBody
        manifest={manifest}
        plan={{
          appliedProfiles: [],
          sharedActions: [],
          placeholders: [],
          errors: [],
          ignoredLegacyAgents: 0,
        }}
        renameMap={{}}
        renameError={() => null}
        onUpdate={() => {}}
        busy={false}
        secretEntries={null}
      />,
    );
    expect(container.textContent).toContain("这个备份包含未脱敏的密钥");
  });
});

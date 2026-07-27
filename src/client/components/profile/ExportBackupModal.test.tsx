import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ExportBackupModal } from "./ExportBackupModal.tsx";
import type { Profile } from "../../../profiles/types.ts";

const profiles: Profile[] = [
  { id: "claude-main", tool: "claude", configDir: "~/.claude-main" },
  { id: "codex-main", tool: "codex", configDir: "~/.codex-main" },
];

describe("ExportBackupModal copy", () => {
  afterEach(() => cleanup());

  it("历史备份开关文案稳定，并说明规则在方案页维护", () => {
    const { container, getByText } = render(
      <ExportBackupModal
        profiles={profiles}
        scriptsEnabled
        onClose={() => {}}
        onToast={() => {}}
      />,
    );

    const label = getByText((_, element) =>
      element?.tagName === "LABEL" &&
      element.textContent === "保留为独立历史备份，不覆盖 latest.dchpack"
    ).closest("label");
    const checkbox = label?.querySelector<HTMLInputElement>("input[type='checkbox']");
    expect(checkbox).toBeTruthy();

    fireEvent.click(checkbox!);

    expect(container.textContent).toContain("保留为独立历史备份");
    expect(container.textContent).toContain("配置方案页的“备份规则”");
    expect(container.textContent).toContain("不可变快照");
    expect(container.querySelector(".backup-rules")).toBeNull();
  });

  it("配置方案选中态使用备份页固定样式，不只依赖系统 checkbox 外观", () => {
    const { getByText } = render(
      <ExportBackupModal
        profiles={profiles}
        scriptsEnabled
        onClose={() => {}}
        onToast={() => {}}
      />,
    );

    const row = getByText("claude-main").closest<HTMLElement>(".backup-profile-choice");
    const checkbox = row?.querySelector<HTMLInputElement>("input[type='checkbox']");
    expect(row).toBeTruthy();
    expect(checkbox).toBeTruthy();
    expect(row!.className).toContain("selected");

    window.dispatchEvent(new Event("blur"));
    expect(row!.className).toContain("selected");

    fireEvent.click(checkbox!);
    expect(row!.className).not.toContain("selected");
  });

  it("全局停用切换脚本时，本次导出不能重新打开", () => {
    const { getByText } = render(
      <ExportBackupModal
        profiles={profiles}
        scriptsEnabled={false}
        onClose={() => {}}
        onToast={() => {}}
      />,
    );
    const label = getByText((_, element) =>
      element?.tagName === "LABEL" &&
      element.textContent === "全局规则已停用 ~/.dch/scripts/**"
    ).closest("label");
    const checkbox = label?.querySelector<HTMLInputElement>("input[type='checkbox']");
    expect(checkbox?.checked).toBeFalse();
    expect(checkbox?.disabled).toBeTrue();
  });
});

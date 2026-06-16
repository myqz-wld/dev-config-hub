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

  it("保留为历史开关勾选后文案保持稳定，并展示备份规则入口", () => {
    const { container, getByText } = render(
      <ExportBackupModal
        profiles={profiles}
        onClose={() => {}}
        onToast={() => {}}
      />,
    );

    const label = getByText("保存为历史备份，不覆盖默认备份").closest("label");
    const checkbox = label?.querySelector<HTMLInputElement>("input[type='checkbox']");
    expect(checkbox).toBeTruthy();

    fireEvent.click(checkbox!);

    expect(getByText("保存为历史备份，不覆盖默认备份")).toBeTruthy();
    expect(container.textContent).toContain("不勾选时写入默认备份");
    expect(container.textContent).toContain("dch-backup-<时间>.dchpack");
    expect(container.querySelector(".backup-rules summary")?.textContent).toBe("查看备份规则");
    expect(container.textContent).toContain("不会跟随配置目录里的 symlink");
  });
});

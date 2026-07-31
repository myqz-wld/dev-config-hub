import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

describe("Tauri dialog capability", () => {
  it("主窗口只开放目录与配置文件选择所需的 dialog.open 权限", async () => {
    const raw = await readFile(
      `${import.meta.dir}/../../src-tauri/capabilities/default.json`,
      "utf8",
    );
    const capability = JSON.parse(raw) as {
      windows: string[];
      permissions: string[];
    };

    expect(capability.windows).toEqual(["main"]);
    expect(capability.permissions).toContain("core:default");
    expect(capability.permissions).toContain("dialog:allow-open");
    expect(capability.permissions).not.toContain("dialog:default");
  });
});

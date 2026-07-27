import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import type { BackupPolicyV1 } from "../../../profiles/types.ts";
import { FileRuleTable, SecretRuleTable } from "./BackupRuleTable.tsx";

function emptyPolicy(): BackupPolicyV1 {
  return {
    schemaVersion: 1,
    defaultFileAction: "include",
    unscannableFileAction: "include-with-warning",
    fileRules: [],
    secretRules: {
      wholeFile: [],
      field: [],
      content: [],
    },
  };
}

describe("BackupRuleTable", () => {
  afterEach(() => cleanup());

  it("adds a file rule at the visible highest priority and focuses its name", () => {
    function Harness() {
      const [policy, setPolicy] = useState<BackupPolicyV1>(() => ({
        ...emptyPolicy(),
        fileRules: [{
          id: "existing",
          label: "已有规则",
          enabled: true,
          target: "relative-path" as const,
          match: { kind: "glob" as const, pattern: "**/*.log" },
          action: "exclude" as const,
        }],
      }));
      return (
        <FileRuleTable
          policy={policy}
          sourceLabel="内置默认"
          onChange={setPolicy}
        />
      );
    }

    const { getByRole, container } = render(<Harness />);
    fireEvent.click(getByRole("button", { name: "+ 添加" }));

    const rows = container.querySelectorAll<HTMLTableRowElement>("tbody tr");
    const nameInput = rows[0]?.querySelector<HTMLInputElement>(
      'input:not([type="checkbox"])',
    );
    expect(rows).toHaveLength(2);
    expect(nameInput?.value).toBe("新文件规则");
    expect(document.activeElement).toBe(nameInput ?? null);
    expect(rows[0]?.querySelector("td:nth-child(2)")?.textContent).toBe("1");
  });

  it("opens the advanced section when adding a content rule", () => {
    function Harness() {
      const [policy, setPolicy] = useState(emptyPolicy);
      return (
        <SecretRuleTable
          policy={policy}
          sourceLabel="内置默认"
          onChange={setPolicy}
        />
      );
    }

    const { getByRole, container } = render(<Harness />);
    const details = container.querySelector<HTMLDetailsElement>(".rule-content-details");
    expect(details?.open).toBe(false);

    fireEvent.click(getByRole("button", { name: "+ 内容" }));

    const contentRow = details?.querySelector<HTMLTableRowElement>("tbody tr");
    const nameInput = contentRow?.querySelector<HTMLInputElement>(
      'input:not([type="checkbox"])',
    );
    expect(details?.open).toBe(true);
    expect(nameInput?.value).toBe("新密钥规则");
    expect(document.activeElement).toBe(nameInput ?? null);
  });

  it("uses themed custom selects instead of native policy selects", () => {
    function Harness() {
      const [policy, setPolicy] = useState<BackupPolicyV1>(() => ({
        ...emptyPolicy(),
        fileRules: [{
          id: "target",
          label: "目标规则",
          enabled: true,
          target: "relative-path" as const,
          match: { kind: "glob" as const, pattern: "**/*" },
          action: "include" as const,
        }],
      }));
      return (
        <FileRuleTable
          policy={policy}
          sourceLabel="内置默认"
          onChange={setPolicy}
        />
      );
    }

    const { getByRole, container } = render(<Harness />);
    expect(container.querySelector("select")).toBeNull();

    fireEvent.click(getByRole("button", { name: "目标规则 的匹配对象" }));
    expect(document.body.querySelector(".policy-select-popover")).toBeTruthy();
    fireEvent.mouseDown(getByRole("option", { name: "文件名" }));
    expect(getByRole("button", { name: "目标规则 的匹配对象" }).textContent)
      .toContain("文件名");
  });
});

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
    expect(rows[0]?.querySelector(".rule-order-actions > span")?.textContent).toBe("1");
    expect(container.querySelector<HTMLDetailsElement>(".backup-policy-advanced")?.open).toBe(true);
  });

  it("opens the advanced section when adding a content rule", () => {
    function Harness() {
      const [policy, setPolicy] = useState(emptyPolicy);
      return (
        <SecretRuleTable
          policy={policy}
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
          onChange={setPolicy}
        />
      );
    }

    const { getByRole, getByText, container } = render(<Harness />);
    expect(container.querySelector("select")).toBeNull();

    fireEvent.click(getByText("查看和调整文件规则（共 1 条）"));
    fireEvent.click(getByRole("button", { name: "目标规则 的匹配对象" }));
    expect(document.body.querySelector(".policy-select-popover")).toBeTruthy();
    fireEvent.mouseDown(getByRole("option", { name: "文件名" }));
    expect(getByRole("button", { name: "目标规则 的匹配对象" }).textContent)
      .toContain("文件名");
  });

  it("moves a file rule from the priority control on that row", () => {
    function Harness() {
      const [policy, setPolicy] = useState<BackupPolicyV1>(() => ({
        ...emptyPolicy(),
        fileRules: ["第一条", "第二条"].map((label, index) => ({
          id: `rule-${index}`,
          label,
          enabled: true,
          target: "relative-path" as const,
          match: { kind: "glob" as const, pattern: `**/${index}` },
          action: "exclude" as const,
        })),
      }));
      return <FileRuleTable policy={policy} onChange={setPolicy} />;
    }

    const { getByText, container } = render(<Harness />);
    fireEvent.click(getByText("查看和调整文件规则（共 2 条）"));
    const firstRow = container.querySelectorAll<HTMLTableRowElement>("tbody tr")[0];
    fireEvent.click(firstRow!.querySelector<HTMLButtonElement>('button[title="降低优先级"]')!);

    const labels = Array.from(
      container.querySelectorAll<HTMLInputElement>('tbody tr input:not([type="checkbox"])'),
    ).filter((input) => input.className !== "rule-pattern").map((input) => input.value);
    expect(labels).toEqual(["第二条", "第一条"]);
  });

  it("keeps defaults with file coverage and groups secret editors by rule kind", () => {
    const policy = {
      ...emptyPolicy(),
      fileRules: [{
        id: "file",
        label: "文件规则",
        enabled: true,
        target: "relative-path" as const,
        match: { kind: "glob" as const, pattern: "**/*" },
        action: "include" as const,
      }],
      secretRules: {
        wholeFile: [{
          id: "whole",
          label: "整文件规则",
          enabled: true,
          target: "basename" as const,
          match: { kind: "glob" as const, pattern: "auth.json" },
          action: "exclude-file" as const,
        }],
        field: [],
        content: [],
      },
    };
    const { getByText, getByRole, container } = render(
      <div>
        <FileRuleTable policy={policy} onChange={() => {}} />
        <SecretRuleTable policy={policy} onChange={() => {}} />
      </div>,
    );

    const fileSection = getByText("文件涵盖规则").closest(".backup-rule-section");
    expect(fileSection?.querySelector(".policy-default-row")).toBeTruthy();
    expect(fileSection?.querySelector("details")?.open).toBe(false);
    expect(getByText("整文件规则").closest(".secret-rule-group")).toBeTruthy();
    expect(getByText("字段名规则").closest(".secret-rule-group")).toBeTruthy();
    expect(getByText("文件内容规则").closest(".secret-rule-group")).toBeTruthy();
    expect(getByRole("button", { name: "+ 整文件" })).toBeTruthy();
    expect(getByRole("button", { name: "+ 字段" })).toBeTruthy();
    expect(getByRole("button", { name: "+ 内容" })).toBeTruthy();
    expect(container.querySelectorAll(".secret-rule-group details[open]")).toHaveLength(0);
  });
});

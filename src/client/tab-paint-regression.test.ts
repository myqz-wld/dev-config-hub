import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const CLIENT_DIR = import.meta.dir;

describe("tab paint regression", () => {
  test("panel visibility avoids retained paint layers", async () => {
    const css = await readFile(`${CLIENT_DIR}/styles.css`, "utf8");
    const workflowCss = await readFile(`${CLIENT_DIR}/profile-workflows.css`, "utf8");
    const profilePanel = await readFile(`${CLIENT_DIR}/components/ProfilePanel.tsx`, "utf8");
    const panelHostBlock = css.match(/\.panel-host\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(panelHostBlock).toContain("display: block");
    expect(panelHostBlock).not.toContain("contain:");
    expect(panelHostBlock).not.toContain("isolation:");
    expect(workflowCss).not.toMatch(/\.panel-host\s*\{/);
    expect(css).toMatch(/\.panel-host\.panel-hidden\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/body\s*\{[^}]*-webkit-font-smoothing:\s*antialiased/s);
    expect(profilePanel).toContain("<ProfileModalPortal>");
    expect(profilePanel).toMatch(/<ProfileModalPortal>[\s\S]*?<BackupPolicyModal[\s\S]*?<\/ProfileModalPortal>/);
  });

  test("text-bearing tab and navigation nodes are never transformed or shadowed", async () => {
    const css = await readFile(`${CLIENT_DIR}/profile-workflows.css`, "utf8");
    const stableTextBlock = css.match(/:is\([\s\S]*?\)\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(stableTextBlock).toContain("transform: none");
    expect(stableTextBlock).toContain("text-shadow: none");
    expect(css).not.toMatch(/\.profile-tab\.on\s*\{[^}]*transform:(?!\s*none)/s);
  });

  test("policy fields share notebook controls and sources stay plain", async () => {
    const css = await readFile(`${CLIENT_DIR}/profile-modals.css`, "utf8");
    const policyModal = await readFile(`${CLIENT_DIR}/components/profile/BackupPolicyModal.tsx`, "utf8");
    const ruleTable = await readFile(`${CLIENT_DIR}/components/profile/BackupRuleTable.tsx`, "utf8");
    const policySelect = await readFile(`${CLIENT_DIR}/components/profile/PolicySelect.tsx`, "utf8");
    expect(policyModal).not.toContain("<select");
    expect(ruleTable).not.toContain("<select");
    expect(policySelect).toContain("popoverClassName=\"policy-select-popover\"");
    expect(policySelect).toContain("portal");
    expect(css).toContain("background-image:");
    expect(css).toContain("var(--hand)");
    expect(css).toContain('.modal-policy input:not([type="checkbox"]),');
    expect(css).toContain(".modal-policy .policy-select > .select-button");
    expect(css).toMatch(/body \.policy-select-popover\s*\{[^}]*background-image:/s);
    expect(css).toMatch(/\.modal-policy input:not\(\[type="checkbox"\]\)\s*\{[^}]*caret-color:/s);
    expect(css).toMatch(/\.modal-policy \.policy-source-label\s*\{[^}]*white-space:\s*nowrap/s);
    expect(ruleTable.match(/className="policy-source-label"/g)).toHaveLength(2);
    expect(ruleTable).not.toContain('className="badge">{sourceLabel}');
    expect(policyModal).toContain('来源：<span className="policy-source-label">');
  });

  test("backup policy copy names the tool without the tool-level term", async () => {
    const files = await Promise.all([
      readFile(`${CLIENT_DIR}/components/profile/BackupPolicyModal.tsx`, "utf8"),
      readFile(`${CLIENT_DIR}/components/profile/ExportBackupModal.tsx`, "utf8"),
      readFile(`${CLIENT_DIR}/../cli-profile-policy.ts`, "utf8"),
      readFile(`${CLIENT_DIR}/../profiles/backup-policy.ts`, "utf8"),
      readFile(`${CLIENT_DIR}/../schemas/dch-store.ts`, "utf8"),
    ]);
    expect(files.join("\n")).not.toContain("工具级");
    expect(files[0]).toContain("`${target.tool} 备份规则`");
    expect(files[0]).toContain('tool: "工具自定义"');
  });

  test("DCH script backup is separated from the active tool toolbar", async () => {
    const profilePanel = await readFile(`${CLIENT_DIR}/components/ProfilePanel.tsx`, "utf8");
    const policyModal = await readFile(`${CLIENT_DIR}/components/profile/BackupPolicyModal.tsx`, "utf8");
    const globalCss = await readFile(`${CLIENT_DIR}/profile-global.css`, "utf8");
    const toolbar = profilePanel.match(
      /<div className="profile-toolbar">([\s\S]*?)<\/div>\s*\n\s*<div className="profile-status">/,
    )?.[1] ?? "";
    expect(toolbar).not.toContain('scope: "scripts"');
    expect(profilePanel).toContain('className="profile-global-backup"');
    expect(profilePanel).toContain("仅处理 <code>~/.dch/scripts/**</code>");
    expect(policyModal).toContain("这是 DCH 全局规则，只处理");
    expect(globalCss).toMatch(/\.profile-global-backup\s*\{[^}]*display:\s*flex/s);
  });

  test("profile actions use rectangular notebook controls", async () => {
    const css = await readFile(`${CLIENT_DIR}/paper-overrides.css`, "utf8");
    const workflowCss = await readFile(`${CLIENT_DIR}/profile-workflows.css`, "utf8");
    const profilePanel = await readFile(`${CLIENT_DIR}/components/ProfilePanel.tsx`, "utf8");
    expect(css).toMatch(/body \.profile-toolbar\s*\{[^}]*border-radius:\s*6px 9px 5px 7px/s);
    expect(css).toMatch(
      /body \.profile-toolbar :is\(\.btn, \.btn-sm\)\s*\{[^}]*border-radius:\s*4px 7px 3px 6px/s,
    );
    expect(workflowCss).toMatch(/\.profile-toolbar\s*\{[^}]*flex-wrap:\s*wrap/s);
    expect(profilePanel).not.toContain("profile-toolbar-spacer");
  });
});

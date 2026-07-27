import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const CLIENT_DIR = import.meta.dir;

describe("tab paint regression", () => {
  test("panel visibility is paint-isolated", async () => {
    const css = await readFile(`${CLIENT_DIR}/profile-workflows.css`, "utf8");
    const profilePanel = await readFile(`${CLIENT_DIR}/components/ProfilePanel.tsx`, "utf8");
    expect(css).toContain("contain: layout paint style");
    expect(css).toContain("isolation: isolate");
    expect(css).toMatch(/\.panel-host\.panel-hidden\s*\{[^}]*display:\s*none/s);
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

  test("policy selects use the notebook control instead of native macOS bevels", async () => {
    const css = await readFile(`${CLIENT_DIR}/profile-modals.css`, "utf8");
    expect(css).toMatch(/\.modal-policy select\s*\{[^}]*appearance:\s*none/s);
    expect(css).toContain("-webkit-appearance: none");
    expect(css).toContain("background-image:");
    expect(css).toContain("var(--hand)");
  });

  test("profile actions use rectangular notebook controls", async () => {
    const css = await readFile(`${CLIENT_DIR}/paper-overrides.css`, "utf8");
    expect(css).toMatch(/body \.profile-toolbar\s*\{[^}]*border-radius:\s*6px 9px 5px 7px/s);
    expect(css).toMatch(
      /body \.profile-toolbar :is\(\.btn, \.btn-sm\)\s*\{[^}]*border-radius:\s*4px 7px 3px 6px/s,
    );
  });
});

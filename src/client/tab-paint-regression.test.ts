import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const CLIENT_DIR = import.meta.dir;

describe("tab paint regression", () => {
  test("panel visibility avoids retained paint layers", async () => {
    const css = await readFile(`${CLIENT_DIR}/styles.css`, "utf8");
    const paperCss = await readFile(`${CLIENT_DIR}/paper-overrides.css`, "utf8");
    const workflowCss = await readFile(`${CLIENT_DIR}/profile-workflows.css`, "utf8");
    const profilePanel = await readFile(`${CLIENT_DIR}/components/ProfilePanel.tsx`, "utf8");
    const panelHostBlock = css.match(/\.panel-host\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(panelHostBlock).toContain("display: block");
    expect(panelHostBlock).not.toContain("contain:");
    expect(panelHostBlock).not.toContain("isolation:");
    expect(workflowCss).not.toMatch(/\.panel-host\s*\{/);
    expect(css).toMatch(/\.panel-host\.panel-hidden\s*\{[^}]*display:\s*none/s);
    expect(css).not.toMatch(/\.panel\s*\{[^}]*(?:position|z-index):/s);
    expect(paperCss).not.toMatch(/body \.panel\s*\{[^}]*z-index:/s);
    expect(css).toMatch(/body\s*\{[^}]*-webkit-font-smoothing:\s*antialiased/s);
    expect(profilePanel).toContain("<ProfileModalPortal>");
    expect(profilePanel).toMatch(/<ProfileModalPortal>[\s\S]*?<ProfileFormModal[\s\S]*?<\/ProfileModalPortal>/);
  });

  test("modal overlays avoid retained paint layers", async () => {
    const css = await readFile(`${CLIENT_DIR}/styles.css`, "utf8");
    const paperCss = await readFile(`${CLIENT_DIR}/paper-overrides.css`, "utf8");
    const backdropBlock = css.match(/\.modal-backdrop\s*\{([^}]*)\}/)?.[1] ?? "";
    const modalBlock = paperCss.match(/body \.modal\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(backdropBlock).not.toContain("backdrop-filter");
    expect(backdropBlock).not.toContain("animation:");
    expect(modalBlock).not.toContain("isolation:");
    expect(paperCss).not.toMatch(/body \.modal > \*\s*\{/);
  });

  test("text-bearing tab and navigation nodes are never transformed or shadowed", async () => {
    const css = await readFile(`${CLIENT_DIR}/profile-workflows.css`, "utf8");
    const stableTextBlock = css.match(/:is\([\s\S]*?\)\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(stableTextBlock).toContain("transform: none");
    expect(stableTextBlock).toContain("text-shadow: none");
    expect(css).not.toMatch(/\.profile-tab\.on\s*\{[^}]*transform:(?!\s*none)/s);
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

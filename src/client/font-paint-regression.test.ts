import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const CLIENT_DIR = import.meta.dir;

describe("font paint stability", () => {
  test("policy tables do not create a transparent nested scroll layer", async () => {
    const modalCss = await readFile(`${CLIENT_DIR}/profile-modals.css`, "utf8");
    const workflowCss = await readFile(`${CLIENT_DIR}/profile-workflows.css`, "utf8");
    const bodyBlock = modalCss.match(
      /\.modal-policy > \.modal-body\s*\{([^}]*)\}/,
    )?.[1] ?? "";
    const policyTableWrapBlock = workflowCss.match(
      /\.modal-policy \.rule-table-wrap\s*\{([^}]*)\}/,
    )?.[1] ?? "";

    expect(bodyBlock).toMatch(/overflow:\s*auto/);
    expect(bodyBlock).toMatch(/background:\s*#[0-9a-f]{6}/i);
    expect(policyTableWrapBlock).toMatch(/overflow:\s*visible/);
    expect(policyTableWrapBlock).not.toMatch(/overflow(?:-x|-y)?:\s*auto/);
  });

  test("the notebook font cannot be synthetically emboldened", async () => {
    const css = await readFile(`${CLIENT_DIR}/styles.css`, "utf8");
    const bodyBlock = css.match(/body\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(bodyBlock).toMatch(/-webkit-font-smoothing:\s*antialiased/);
    expect(bodyBlock).toMatch(/font-synthesis:\s*none/);
  });
});

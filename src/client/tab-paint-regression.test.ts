import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const CLIENT_DIR = import.meta.dir;

describe("tab paint regression", () => {
  test("panel visibility is paint-isolated", async () => {
    const css = await readFile(`${CLIENT_DIR}/profile-workflows.css`, "utf8");
    expect(css).toContain("contain: layout paint style");
    expect(css).toContain("isolation: isolate");
    expect(css).toMatch(/\.panel-host\.panel-hidden\s*\{[^}]*display:\s*none/s);
  });

  test("text-bearing tab and navigation nodes are never transformed or shadowed", async () => {
    const css = await readFile(`${CLIENT_DIR}/profile-workflows.css`, "utf8");
    const stableTextBlock = css.match(/:is\([\s\S]*?\)\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(stableTextBlock).toContain("transform: none");
    expect(stableTextBlock).toContain("text-shadow: none");
    expect(css).not.toMatch(/\.profile-tab\.on\s*\{[^}]*transform:(?!\s*none)/s);
  });
});

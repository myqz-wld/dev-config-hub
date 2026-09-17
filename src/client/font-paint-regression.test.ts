import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const CLIENT_DIR = import.meta.dir;

describe("font paint stability", () => {
  test("the notebook font cannot be synthetically emboldened", async () => {
    const css = await readFile(`${CLIENT_DIR}/styles.css`, "utf8");
    const bodyBlock = css.match(/body\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(bodyBlock).toMatch(/-webkit-font-smoothing:\s*antialiased/);
    expect(bodyBlock).toMatch(/font-synthesis:\s*none/);
  });
});

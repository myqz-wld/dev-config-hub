import { describe, expect, it } from "bun:test";
import {
  redactJsonContent, redactTomlContent, redactWholeFile,
  redactProfileEnv, redactByFilename, makePlaceholder, placeholderCount,
} from "./redact.ts";

describe("redactJsonContent", () => {
  it("顶层敏感 key value 替换为占位符", () => {
    const r = redactJsonContent(JSON.stringify({ api_key: "sk-secret", model: "opus" }));
    const obj = JSON.parse(r.content);
    expect(obj.api_key).toBe(makePlaceholder("api_key"));
    expect(obj.model).toBe("opus");
    expect(r.placeholders).toHaveLength(1);
    expect(r.placeholders[0]?.fieldName).toBe("api_key");
    expect(r.placeholders[0]?.fieldPath).toBe("$.api_key");
  });

  it("嵌套敏感 key 也命中（mcp 风格）", () => {
    const input = {
      mcpServers: {
        intern: {
          env: { INTERN_TOKEN: "ghp_xxx", READ_ONLY: "1" },
        },
      },
    };
    const r = redactJsonContent(JSON.stringify(input));
    const obj = JSON.parse(r.content);
    expect(obj.mcpServers.intern.env.INTERN_TOKEN).toBe(makePlaceholder("INTERN_TOKEN"));
    expect(obj.mcpServers.intern.env.READ_ONLY).toBe("1");
    expect(r.placeholders).toHaveLength(1);
    expect(r.placeholders[0]?.fieldPath).toBe("$.mcpServers.intern.env.INTERN_TOKEN");
  });

  it("数组里的敏感 key 命中（带 index）", () => {
    const input = { items: [{ token: "a" }, { token: "b" }] };
    const r = redactJsonContent(JSON.stringify(input));
    expect(r.placeholders).toHaveLength(2);
    expect(r.placeholders[0]?.fieldPath).toBe("$.items[0].token");
    expect(r.placeholders[1]?.fieldPath).toBe("$.items[1].token");
  });

  it("非 string value 不动（数字 / 布尔 / null / 对象）", () => {
    const input = { token_count: 42, has_token: true, token: null, nested_token: { a: 1 } };
    const r = redactJsonContent(JSON.stringify(input));
    const obj = JSON.parse(r.content);
    expect(obj.token_count).toBe(42);
    expect(obj.has_token).toBe(true);
    expect(obj.token).toBeNull();
    expect(obj.nested_token).toEqual({ a: 1 });
    expect(r.placeholders).toHaveLength(0);
  });

  it("非敏感 key 不动（HTTP_PROXY 等）", () => {
    const input = { HTTP_PROXY: "http://proxy", model: "opus" };
    const r = redactJsonContent(JSON.stringify(input));
    expect(r.placeholders).toHaveLength(0);
    const obj = JSON.parse(r.content);
    expect(obj.HTTP_PROXY).toBe("http://proxy");
  });

  it("parse 失败 → 原样返回 + 空 placeholders", () => {
    const broken = "{ invalid json ";
    const r = redactJsonContent(broken);
    expect(r.content).toBe(broken);
    expect(r.placeholders).toHaveLength(0);
  });
});

describe("redactTomlContent", () => {
  it("顶层敏感 key 替换", () => {
    const r = redactTomlContent('experimental_bearer_token = "sk-xxx"\nmodel = "gpt-5.5"\n');
    expect(r.content).toContain(makePlaceholder("experimental_bearer_token"));
    expect(r.content).toContain('model = "gpt-5.5"');
    expect(r.placeholders).toHaveLength(1);
    expect(r.placeholders[0]?.fieldName).toBe("experimental_bearer_token");
  });

  it("section 内的敏感 key 替换", () => {
    const r = redactTomlContent(`
[server.intern]
api_key = "secret"
url = "https://x.com"
`);
    expect(r.content).toContain(makePlaceholder("api_key"));
    expect(r.placeholders[0]?.fieldPath).toBe("server.intern.api_key");
  });
});

describe("redactWholeFile", () => {
  it("整文件替换为 placeholder JSON", () => {
    const r = redactWholeFile('{"OPENAI_API_KEY":"sk-real-token-here"}', "auth.json");
    const obj = JSON.parse(r.content);
    expect(obj.placeholder).toBe(makePlaceholder("AUTH"));
    expect(r.placeholders[0]?.fieldName).toBe("AUTH");
  });
});

describe("redactProfileEnv", () => {
  it("敏感 key value 替换 + 非敏感保留", () => {
    const r = redactProfileEnv({
      ANTHROPIC_API_KEY: "sk-ant-secret",
      HTTP_PROXY: "http://proxy",
    });
    expect(r.env.ANTHROPIC_API_KEY).toBe(makePlaceholder("ANTHROPIC_API_KEY"));
    expect(r.env.HTTP_PROXY).toBe("http://proxy");
    expect(r.placeholders).toHaveLength(1);
    expect(r.placeholders[0]?.fieldPath).toBe("env.ANTHROPIC_API_KEY");
  });

  it("undefined env 返回空", () => {
    const r = redactProfileEnv(undefined);
    expect(r.env).toEqual({});
    expect(r.placeholders).toHaveLength(0);
  });
});

describe("redactByFilename", () => {
  it(".json → JSON 脱敏", () => {
    const r = redactByFilename('{"api_key":"x"}', "settings.json");
    expect(r.placeholders).toHaveLength(1);
  });

  it(".toml → TOML 脱敏", () => {
    const r = redactByFilename('token = "x"', "config.toml");
    expect(r.placeholders).toHaveLength(1);
  });

  it("auth.json → 整文件脱敏（命中 SENSITIVE_FILES）", () => {
    const r = redactByFilename('{"foo":"bar"}', "auth.json");
    expect(r.placeholders[0]?.fieldName).toBe("AUTH");
  });

  it("credentials.json → 整文件脱敏", () => {
    const r = redactByFilename('{"foo":"bar"}', "credentials.json");
    expect(r.placeholders[0]?.fieldName).toBe("CREDENTIALS");
  });

  it("非 JSON / TOML（CLAUDE.md / 脚本）→ 走 redactPlainTextContent regex 替换（REVIEW_8 M2/D5）", () => {
    // 旧行为：fall-through 原样返回 → 内含 sk-ant-... 的 markdown 备份会泄漏
    // 新行为：HIGH_CONFIDENCE_PATTERNS 命中 token 替换为 placeholder
    const r = redactByFilename(
      "# CLAUDE.md\n\n用我的 key: sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890",
      "CLAUDE.md",
    );
    expect(r.placeholders.length).toBeGreaterThan(0);
    expect(r.content).not.toContain("sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890");
    expect(r.content).toContain("<<DCH_PLACEHOLDER:ANTHROPIC_API_KEY>>");
  });
});

describe("redactPlainTextContent (REVIEW_8 M2/D5)", () => {
  it("HIGH_CONFIDENCE: sk-ant-... 被替换", () => {
    const r = redactByFilename(
      "ANTHROPIC_API_KEY=sk-ant-api03-XYZ12345678901234567890",
      "hook.sh",
    );
    expect(r.content).not.toContain("sk-ant-api03-XYZ");
    expect(r.placeholders.some((p) => p.fieldName === "ANTHROPIC_API_KEY")).toBe(true);
  });

  it("HIGH_CONFIDENCE: GitHub PAT (ghp_...) 被替换", () => {
    const r = redactByFilename(
      "export GH_TOKEN=ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
      "env.sh",
    );
    expect(r.content).not.toContain("ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789");
    expect(r.placeholders.some((p) => p.fieldName === "GITHUB_PAT")).toBe(true);
  });

  it("HIGH_CONFIDENCE: AWS Access Key 被替换", () => {
    const r = redactByFilename("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE", "env.sh");
    expect(r.content).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(r.placeholders.some((p) => p.fieldName === "AWS_ACCESS_KEY_ID")).toBe(true);
  });

  it("KEY_VALUE: SECRET_TOKEN=xxx 被替换", () => {
    const r = redactByFilename(`SECRET_TOKEN=randomTokenValue123456`, "config.env");
    expect(r.content).not.toContain("randomTokenValue123456");
    expect(r.placeholders.some((p) => p.fieldName.includes("SECRET_TOKEN"))).toBe(true);
  });

  it("HTTP_AUTH: Authorization: Bearer xxx 被替换", () => {
    const r = redactByFilename(
      `Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9XXXX`,
      "request.txt",
    );
    expect(r.content).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9XXXX");
    expect(r.content).toMatch(/Bearer\s*<<DCH_PLACEHOLDER:HTTP_AUTH_TOKEN>>/);
  });

  it("REVIEW_8 R2-11 / R3 G2: HTTP_AUTH 大小写不敏感（lowercase authorization / scheme 也脱敏）", () => {
    // 旧 regex 末尾 `/g` 不是 `/gi`，lowercase `authorization:` 漏脱敏（HTTP request log /
    // curl 例子常见小写写法 → 备份明文泄漏凭据）。R3 G2 加 `i` flag 修复。
    // 注意：x-api-key 会被 KEY_VALUE pattern (/gi) 优先匹配（不同 placeholder name 但都脱敏），
    // 这里专测 Authorization 头 + lowercase scheme（HTTP_AUTH 独占覆盖的）。
    const lower = redactByFilename(
      `authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9LowerXXXX`,
      "request-lower.txt",
    );
    expect(lower.content).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9LowerXXXX");
    expect(lower.content).toMatch(/<<DCH_PLACEHOLDER:HTTP_AUTH_TOKEN>>/);

    const lowerScheme = redactByFilename(
      `Authorization: bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9SchemeXXXX`,
      "request-scheme.txt",
    );
    expect(lowerScheme.content).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9SchemeXXXX");
    expect(lowerScheme.content).toMatch(/<<DCH_PLACEHOLDER:HTTP_AUTH_TOKEN>>/);

    // x-api-key 验证只检查 value 被脱敏（具体 placeholder name 由先匹配的 pattern 决定 — KEY_VALUE 优先）
    const apiKey = redactByFilename(
      `x-api-key: abcDEF1234567890abcdefXYZ`,
      "request-apikey.txt",
    );
    expect(apiKey.content).not.toContain("abcDEF1234567890abcdefXYZ");
    expect(apiKey.placeholders.length).toBeGreaterThan(0);
  });

  it("无敏感内容 → 原样返回 + 空 placeholders", () => {
    const input = "# CLAUDE.md\n\nThis is plain documentation.";
    const r = redactByFilename(input, "CLAUDE.md");
    expect(r.content).toBe(input);
    expect(r.placeholders).toHaveLength(0);
  });
});

describe("placeholderCount", () => {
  it("数 <<DCH_PLACEHOLDER:...>> 出现次数", () => {
    expect(placeholderCount("foo <<DCH_PLACEHOLDER:A>> bar <<DCH_PLACEHOLDER:B>>")).toBe(2);
    expect(placeholderCount("no placeholders here")).toBe(0);
  });
});

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

// CHANGELOG_18：valueHash 字段（仅 backup 内存阶段做 secrets-index dedup group key 用，不入 manifest）

describe("valueHash on PlaceholderHit", () => {
  it("redactJsonContent：同输入同 hash（deterministic）", () => {
    const a = redactJsonContent(JSON.stringify({ token: "same-secret" }));
    const b = redactJsonContent(JSON.stringify({ token: "same-secret" }));
    expect(a.placeholders[0]?.valueHash).toBeString();
    expect(a.placeholders[0]?.valueHash).toBe(b.placeholders[0]?.valueHash);
  });

  it("redactJsonContent：异输入异 hash", () => {
    const a = redactJsonContent(JSON.stringify({ token: "secret-a" }));
    const b = redactJsonContent(JSON.stringify({ token: "secret-b" }));
    expect(a.placeholders[0]?.valueHash).toBeString();
    expect(b.placeholders[0]?.valueHash).toBeString();
    expect(a.placeholders[0]?.valueHash).not.toBe(b.placeholders[0]?.valueHash);
  });

  it("redactJsonContent：valueHash 长度 = 16 hex 字符（短 sha256）", () => {
    const r = redactJsonContent(JSON.stringify({ token: "x" }));
    expect(r.placeholders[0]?.valueHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("redactWholeFile：不带 valueHash（整文件场景每条独立 logical key）", () => {
    const r = redactWholeFile('{"foo":"bar"}', "auth.json");
    expect(r.placeholders[0]?.valueHash).toBeUndefined();
  });

  it("redactProfileEnv：env 段也带 valueHash", () => {
    const r = redactProfileEnv({ ANTHROPIC_API_KEY: "sk-ant-xxx" });
    expect(r.placeholders[0]?.valueHash).toBeString();
    expect(r.placeholders[0]?.valueHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("redactTomlContent：TOML 也带 valueHash", () => {
    const r = redactTomlContent('experimental_bearer_token = "sk-real"');
    expect(r.placeholders[0]?.valueHash).toBeString();
    expect(r.placeholders[0]?.valueHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("不变量：脱敏后输出 content 内绝不含真值或 valueHash 字符串", () => {
    const real = "sk-very-secret-real-value-12345";
    const r = redactJsonContent(JSON.stringify({ api_key: real }));
    expect(r.content).not.toContain(real);
    if (r.placeholders[0]?.valueHash) {
      expect(r.content).not.toContain(r.placeholders[0].valueHash);
    }
  });

  // CHANGELOG_20 fix：plain-text scan 命中也必须带 valueHash，否则 secrets-index 会误判
  // 为 whole-file（hashByEntry.get(entry) === undefined → buildSecretsIndex isWhole=true），
  // 让 .md / .sh / .yaml 里同 token 多处出现无法 dedup → 用户看到 ACCESS_TOKEN-1..N 全标
  // "whole-file secret" 而不是合并成 1 个。
  it("redactPlainTextContent HIGH_CONFIDENCE：valueHash 同 token 同 hash（dedup 关键）", () => {
    const a = redactByFilename(`SK=sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAA`, "a.sh");
    const b = redactByFilename(`# in markdown: sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAA`, "b.md");
    const ha = a.placeholders.find((p) => p.fieldName === "ANTHROPIC_API_KEY");
    const hb = b.placeholders.find((p) => p.fieldName === "ANTHROPIC_API_KEY");
    expect(ha?.valueHash).toMatch(/^[0-9a-f]{16}$/);
    expect(hb?.valueHash).toMatch(/^[0-9a-f]{16}$/);
    expect(ha?.valueHash).toBe(hb?.valueHash);
  });

  it("redactPlainTextContent HIGH_CONFIDENCE：异 token 异 hash", () => {
    const a = redactByFilename(`ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, "a.sh");
    const b = redactByFilename(`ghp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`, "b.sh");
    const ha = a.placeholders.find((p) => p.fieldName === "GITHUB_PAT");
    const hb = b.placeholders.find((p) => p.fieldName === "GITHUB_PAT");
    expect(ha?.valueHash).toBeString();
    expect(hb?.valueHash).toBeString();
    expect(ha?.valueHash).not.toBe(hb?.valueHash);
  });

  it("redactPlainTextContent KEY_VALUE：valueHash 来自 value 部分（非整 line）", () => {
    // 同 value 不同 KEY 名 → valueHash 应一致（hash 算的是 value 不是 KEY=value 整串）
    const a = redactByFilename(`ACCESS_TOKEN=samevaluetoken1234567`, "a.sh");
    const b = redactByFilename(`MY_ACCESS_TOKEN=samevaluetoken1234567`, "b.sh");
    expect(a.placeholders[0]?.valueHash).toBe(b.placeholders[0]?.valueHash);
  });

  it("redactPlainTextContent HTTP_AUTH：valueHash 来自 token（不含 scheme/header）", () => {
    const a = redactByFilename(`Authorization: Bearer eyJTOKEN_VALUE_AAAAAAAAA`, "a.txt");
    const b = redactByFilename(`X-Api-Key: Token eyJTOKEN_VALUE_AAAAAAAAA`, "b.txt");
    const ha = a.placeholders.find((p) => p.fieldName === "HTTP_AUTH_TOKEN");
    const hb = b.placeholders.find((p) => p.fieldName === "HTTP_AUTH_TOKEN");
    expect(ha?.valueHash).toBeString();
    expect(hb?.valueHash).toBeString();
    expect(ha?.valueHash).toBe(hb?.valueHash);
  });
});

// ─── REVIEW_9 G1 fix 覆盖测试 ─────────────────────────────────────────

describe("REVIEW_9 A-HIGH-4 + A-claude M1: KEY_VALUE 保留分隔符 + 引号(不损坏 YAML / TS)", () => {
  it("YAML `:` 分隔符 + 双引号: api_key: \"sk-...\" → 保留 `:` + `\"` 不强转 `=`", () => {
    const r = redactByFilename(`api_key: "sk-ant-api03-XYZXYZXYZXYZXYZXYZXYZ"`, "config.yaml");
    expect(r.content).not.toContain("sk-ant-api03-XYZXYZXYZXYZXYZXYZXYZ");
    // HIGH_CONFIDENCE_PATTERNS 优先命中 sk-ant-,直接换 token,保留 KEY: " " 外层
    expect(r.content).toContain("api_key:");
    expect(r.content).toContain('"<<DCH_PLACEHOLDER:ANTHROPIC_API_KEY>>"');
    // 验证不再强转 `=` 形式
    expect(r.content).not.toMatch(/api_key=<<DCH_PLACEHOLDER/);
  });

  it("KEY_VALUE 单引号: SECRET='value' → 保留单引号", () => {
    const r = redactByFilename(`MY_SECRET='supersecret123456'`, "shell.sh");
    expect(r.content).not.toContain("supersecret123456");
    expect(r.content).toMatch(/MY_SECRET\s*=\s*'<<DCH_PLACEHOLDER:/);
  });

  it("KEY_VALUE 无引号: TOKEN=value → 不加引号", () => {
    const r = redactByFilename(`MY_TOKEN=randomvaluetoken123`, "config.env");
    expect(r.content).not.toContain("randomvaluetoken123");
    // 不应有引号包围
    expect(r.content).toMatch(/MY_TOKEN\s*=\s*<<DCH_PLACEHOLDER:/);
    expect(r.content).not.toMatch(/MY_TOKEN\s*=\s*"</);
    expect(r.content).not.toMatch(/MY_TOKEN\s*=\s*'</);
  });

  it("KEY_VALUE 含 `:` 字符的 value(Slack webhook style)→ 整体进 placeholder 不被旧 charset 截断", () => {
    // 旧 regex `[A-Za-z0-9_+./=-]{16,}` 漏 `:`,导致 `https://hooks.slack.com/services/T0/B0/xxx:abc` 中
    // `:abc` 部分残留进备份。新 regex 用引号或行尾边界,完整截到下一空白。
    const r = redactByFilename(
      `SLACK_WEBHOOK_SECRET="https://hooks.slack.com/services/T0/B0/key:abcdefghij"`,
      "webhook.env",
    );
    // 完整 secret URL 都被替换,不留 `:abcdefghij` 残尾
    expect(r.content).not.toContain("hooks.slack.com");
    expect(r.content).not.toContain(":abcdefghij");
    expect(r.content).toContain("<<DCH_PLACEHOLDER:");
  });

  it("KEY_VALUE 含 shell special 的 password → 完整截至引号边界", () => {
    // 旧 charset 漏 `!@#$%^&*` 等,密码含特殊字符的尾部残留进备份
    const r = redactByFilename(
      `MY_PASSWORD="p@ssw0rd!#$%^&*()"`,
      "secrets.env",
    );
    expect(r.content).not.toContain("p@ssw0rd!#$%^&*()");
    expect(r.content).toMatch(/MY_PASSWORD\s*=\s*"<<DCH_PLACEHOLDER:/);
  });
});

describe("REVIEW_9 A-HIGH-2 / B-HIGH-2: redactJsonContent / redactTomlContent parse fail → fall back regex + warning", () => {
  it("redactJsonContent broken JSON → fall back redactPlainTextContent + warnings 非空", () => {
    const broken = "{ invalid json with sk-ant-api03-XYZXYZXYZXYZXYZXYZXYZ token";
    const r = redactJsonContent(broken, "broken.json");
    expect(r.content).not.toContain("sk-ant-api03-XYZXYZXYZXYZXYZXYZXYZ");
    expect(r.content).toContain("<<DCH_PLACEHOLDER:ANTHROPIC_API_KEY>>");
    expect(r.warnings).toBeDefined();
    expect(r.warnings!.length).toBeGreaterThan(0);
    expect(r.warnings![0]).toContain("JSON 解析失败");
    expect(r.warnings![0]).toContain("broken.json");
  });

  it("redactTomlContent broken TOML → fall back + warnings 含 filename", () => {
    const broken = '[server\nname = "x"\napi_key = ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';
    const r = redactTomlContent(broken, "config.toml");
    expect(r.content).not.toContain("ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789");
    expect(r.warnings).toBeDefined();
    expect(r.warnings![0]).toContain("TOML 解析失败");
    expect(r.warnings![0]).toContain("config.toml");
  });

  it("成功 parse 时 warnings 应为 undefined(不污染合法路径)", () => {
    const r = redactJsonContent('{"api_key": "secret"}');
    expect(r.warnings).toBeUndefined();
  });
});

describe("REVIEW_9 A-HIGH-3: shortHash empty value → undefined", () => {
  it("redactJsonContent: 空字符串敏感 value → placeholder + valueHash undefined", () => {
    const r = redactJsonContent(JSON.stringify({ api_key: "" }));
    expect(r.placeholders).toHaveLength(1);
    expect(r.placeholders[0]!.valueHash).toBeUndefined();
  });

  it("redactProfileEnv: 空 env value → placeholder + valueHash undefined", () => {
    const r = redactProfileEnv({ MY_TOKEN: "" });
    expect(r.placeholders).toHaveLength(1);
    expect(r.placeholders[0]!.valueHash).toBeUndefined();
  });
});

describe("REVIEW_9 A-codex M2: walkAndRedact 对含特殊字符 key escape 让 fieldPath 单段还原", () => {
  it("JSON key 含 `.` 字面量(命中 token 子串) → fieldPath 用 \\. 转义", () => {
    // key `my.token` 含 `token` sensitive 子串 + 含 `.` 字面量(罕见但合法 JSON)
    const r = redactJsonContent(JSON.stringify({ "my.token": "sk-real-secret" }));
    expect(r.placeholders).toHaveLength(1);
    expect(r.placeholders[0]!.fieldPath).toBe("$.my\\.token");
    expect(r.placeholders[0]!.fieldName).toBe("my.token"); // 原始 key 名
  });

  it("JSON 嵌套 key 含 `.`(命中 secret 子串) → fieldPath escape 后 parseFieldPath 还原成单段", () => {
    const r = redactJsonContent(JSON.stringify({ outer: { "v1.secret": "value" } }));
    expect(r.placeholders).toHaveLength(1);
    expect(r.placeholders[0]!.fieldPath).toBe("$.outer.v1\\.secret");
  });
});

import { describe, expect, it } from "bun:test";
import {
  redactJsonContent, redactTomlContent, redactWholeFile,
  redactProfileEnv, redactByFilename, makePlaceholder,
} from "./redact.ts";

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

describe("REVIEW_9 A-HIGH-1: 中性 key 配 token-shape value 兜底脱敏", () => {
  it("中性 key `value` 配 sk-ant-... 长度 token → 命中 ANTHROPIC_API_KEY", () => {
    const r = redactJsonContent(JSON.stringify({ value: "sk-ant-abcdefghijklmnopqrstuvwxyz0123456789" }));
    const obj = JSON.parse(r.content);
    expect(obj.value).toBe(makePlaceholder("ANTHROPIC_API_KEY"));
    expect(r.placeholders).toHaveLength(1);
    expect(r.placeholders[0]!.fieldName).toBe("ANTHROPIC_API_KEY");
  });

  it("中性 key `config` 嵌套含 ghp_ token → 命中 GITHUB_PAT", () => {
    const r = redactJsonContent(JSON.stringify({
      config: { meta: "ghp_abcdefghijklmnopqrstuvwxyz0123456789AB" },
    }));
    const obj = JSON.parse(r.content);
    expect(obj.config.meta).toBe(makePlaceholder("GITHUB_PAT"));
  });

  it("中性 key 配普通字符串 → 不脱敏", () => {
    const r = redactJsonContent(JSON.stringify({ name: "production", model: "opus" }));
    expect(r.placeholders).toHaveLength(0);
  });
});

describe("REVIEW_9 A-HIGH-2: sensitive key + array value → 遍历 array 把 string item 换 placeholder", () => {
  it("`tokens: [...]` 数组里 string 元素逐一换 placeholder 拼 fieldPath `[i]`", () => {
    const r = redactJsonContent(JSON.stringify({
      tokens: ["sk-real-1-aaaaaaaaa", "sk-real-2-bbbbbbbbb", "sk-real-3-ccccccccc"],
    }));
    const obj = JSON.parse(r.content);
    expect(obj.tokens).toEqual([
      makePlaceholder("tokens"),
      makePlaceholder("tokens"),
      makePlaceholder("tokens"),
    ]);
    expect(r.placeholders).toHaveLength(3);
    expect(r.placeholders[0]!.fieldPath).toBe("$.tokens[0]");
    expect(r.placeholders[1]!.fieldPath).toBe("$.tokens[1]");
    expect(r.placeholders[2]!.fieldPath).toBe("$.tokens[2]");
    expect(r.placeholders.every((p) => p.fieldName === "tokens")).toBe(true);
  });

  it("array 嵌入 object 时 object 走常规 walkAndRedact 不串扰", () => {
    const r = redactJsonContent(JSON.stringify({
      secrets: ["plain-string-token-1", { not_sensitive: "hello" }, "plain-string-token-2"],
    }));
    const obj = JSON.parse(r.content);
    expect(obj.secrets[0]).toBe(makePlaceholder("secrets"));
    expect(obj.secrets[1]).toEqual({ not_sensitive: "hello" });
    expect(obj.secrets[2]).toBe(makePlaceholder("secrets"));
  });

  it("非 sensitive key + array 不脱敏(避免假阳)", () => {
    const r = redactJsonContent(JSON.stringify({
      models: ["opus", "sonnet", "haiku"],
    }));
    expect(r.placeholders).toHaveLength(0);
  });
});

describe("REVIEW_9 A-HIGH-3: walkAndRedact TOML Date short-circuit 不损坏", () => {
  it("TOML Date 字段不被 Object.entries 改写成空 table", () => {
    const toml = [
      "created_at = 2024-01-01T00:00:00Z",
      "name = \"prod\"",
      "[server]",
      "api_key = \"sk-real-toml\"",
    ].join("\n");
    const r = redactTomlContent(toml);
    // Date 字段保留为 ISO datetime,不被改写
    expect(r.content).toContain("2024-01-01");
    // 敏感 key 仍正确脱敏
    expect(r.content).toContain(makePlaceholder("api_key"));
    expect(r.placeholders).toHaveLength(1);
  });

  it("嵌套 [section] 内 Date + sensitive 同时正确处理", () => {
    const toml = [
      "[meta]",
      "updated = 2024-06-15T12:00:00Z",
      "token = \"sk-real-nested\"",
    ].join("\n");
    const r = redactTomlContent(toml);
    expect(r.content).toContain("2024-06-15");
    expect(r.content).toContain(makePlaceholder("token"));
  });
});

describe("REVIEW_9 A-HIGH-4: KEY_VALUE charset 不吞行内分隔符 + URL 整段优先", () => {
  it("`API_KEY=secret123,name=foo` value 不吞 `,name=foo` 跨字段(unquoted 分支)", () => {
    const text = "API_KEY=secret-token-12345,name=foo";
    const r = redactByFilename(text, "config.env");
    // 原 charset bug 会让 value 匹配成 "secret-token-12345,name=foo" 整段
    // 新 charset 在 `,` 处自然停止,只换 secret 部分,保留 `,name=foo`
    expect(r.content).toContain("name=foo");
    expect(r.content).toContain(makePlaceholder("API_KEY"));
  });

  it("管道 `|` 不被吞", () => {
    const text = "TOKEN=abc12345defghi|piped_command";
    const r = redactByFilename(text, "script.sh");
    expect(r.content).toContain("|piped_command");
    expect(r.content).toContain(makePlaceholder("TOKEN"));
  });

  it("分号 `;` 不被吞(shell 命令分隔)", () => {
    const text = "SECRET=abcdefghijklm;echo done";
    const r = redactByFilename(text, "script.sh");
    expect(r.content).toContain(";echo done");
    expect(r.content).toContain(makePlaceholder("SECRET"));
  });

  it("URL 整段(含 query 内 `&`)优先匹配", () => {
    // 用命中 sensitive key 列表的 key (TOKEN/AUTH 等) 才走 KEY_VALUE 分支
    const text = `BEARER_TOKEN=https://hooks.slack.com/services/T0/B0/abcdefghijk?token=xyz&channel=ops`;
    const r = redactByFilename(text, "config.env");
    // URL 应整段被换(query 内 `&` 不截断)
    expect(r.content).not.toContain("hooks.slack.com");
    expect(r.content).not.toContain("&channel=ops");
    expect(r.content).toContain(makePlaceholder("BEARER_TOKEN"));
  });

  it("双引号 / 单引号包裹的 value 仍按引号边界 callback 拼回", () => {
    const yaml1 = `api_key: "sk-quoted-secret-1234"`;
    const r1 = redactByFilename(yaml1, "config.yaml");
    // 引号保留,key/sep 不破坏
    expect(r1.content).toMatch(/api_key: "<<DCH_PLACEHOLDER:API_KEY>>"/);

    const yaml2 = `api_key: 'sk-quoted-secret-5678'`;
    const r2 = redactByFilename(yaml2, "config.yaml");
    expect(r2.content).toMatch(/api_key: '<<DCH_PLACEHOLDER:API_KEY>>'/);
  });
});

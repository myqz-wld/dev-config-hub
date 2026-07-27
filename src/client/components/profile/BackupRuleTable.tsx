import type {
  BackupContentSecretRule,
  BackupFieldSecretRule,
  BackupFileRule,
  BackupPolicyV1,
  BackupRuleBase,
  BackupSecretAction,
  BackupTextFormat,
  BackupWholeFileSecretRule,
} from "../../../profiles/types.ts";

const SECRET_ACTIONS: Array<{ value: BackupSecretAction; label: string }> = [
  { value: "placeholder", label: "替换为占位符" },
  { value: "exclude-file", label: "排除整个文件" },
  { value: "keep-original", label: "保留原值（危险）" },
  { value: "ignore", label: "忽略命中" },
];

function move<T>(items: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

function MoveButtons({
  index,
  length,
  onMove,
}: {
  index: number;
  length: number;
  onMove: (delta: -1 | 1) => void;
}) {
  return (
    <div className="rule-order-actions">
      <button disabled={index === 0} onClick={() => onMove(-1)} title="提高优先级">↑</button>
      <button disabled={index === length - 1} onClick={() => onMove(1)} title="降低优先级">↓</button>
    </div>
  );
}

function OrderEditor({
  title,
  rules,
  onMove,
}: {
  title: string;
  rules: BackupRuleBase[];
  onMove: (index: number, delta: -1 | 1) => void;
}) {
  return (
    <details className="rule-sort-details">
      <summary>{title}</summary>
      <div className="rule-sort-list">
        {rules.map((rule, index) => (
          <div key={rule.id}>
            <code>{index + 1}</code>
            <span>{rule.label}</span>
            <MoveButtons
              index={index}
              length={rules.length}
              onMove={(delta) => onMove(index, delta)}
            />
          </div>
        ))}
      </div>
    </details>
  );
}

export function FileRuleTable({
  policy,
  sourceLabel,
  onChange,
}: {
  policy: BackupPolicyV1;
  sourceLabel: string;
  onChange: (policy: BackupPolicyV1) => void;
}) {
  const update = (index: number, rule: BackupFileRule) => {
    const fileRules = [...policy.fileRules];
    fileRules[index] = rule;
    onChange({ ...policy, fileRules });
  };
  return (
    <section className="backup-rule-section">
      <div className="backup-rule-section-head">
        <div>
          <h3>文件涵盖规则</h3>
          <p>从上到下匹配，第一条命中即停止。</p>
        </div>
        <button className="btn-sm" onClick={() => onChange({
          ...policy,
          fileRules: [...policy.fileRules, {
            id: newId("file"),
            label: "新文件规则",
            enabled: true,
            target: "relative-path",
            match: { kind: "glob", pattern: "**/*.example" },
            action: "exclude",
          }],
        })}>+ 添加</button>
      </div>
      <div className="rule-table-wrap">
        <table className="rule-table">
          <thead>
            <tr>
              <th>启用</th><th>顺序</th><th>名称</th><th>匹配对象</th>
              <th>方式</th><th>内容</th><th>动作</th><th>来源</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {policy.fileRules.map((rule, index) => (
              <tr key={rule.id}>
                <td><input type="checkbox" checked={rule.enabled} onChange={(event) => update(index, { ...rule, enabled: event.target.checked })} /></td>
                <td>{index + 1}</td>
                <td><input value={rule.label} onChange={(event) => update(index, { ...rule, label: event.target.value })} /></td>
                <td>
                  <select value={rule.target} onChange={(event) => update(index, { ...rule, target: event.target.value as BackupFileRule["target"] })}>
                    <option value="relative-path">相对路径</option>
                    <option value="basename">文件名</option>
                  </select>
                </td>
                <td>
                  <select value={rule.match.kind} onChange={(event) => update(index, {
                    ...rule,
                    match: { ...rule.match, kind: event.target.value as "glob" | "regex" },
                  })}>
                    <option value="glob">Glob</option>
                    <option value="regex">正则</option>
                  </select>
                </td>
                <td><input className="rule-pattern" value={rule.match.pattern} onChange={(event) => update(index, { ...rule, match: { ...rule.match, pattern: event.target.value } })} /></td>
                <td>
                  <select value={rule.action} onChange={(event) => update(index, { ...rule, action: event.target.value as BackupFileRule["action"] })}>
                    <option value="include">包含</option>
                    <option value="exclude">排除</option>
                  </select>
                </td>
                <td><span className="policy-source-label">{sourceLabel}</span></td>
                <td>
                  <button className="rule-remove-button" onClick={() => onChange({
                    ...policy,
                    fileRules: policy.fileRules.filter((_, itemIndex) => itemIndex !== index),
                  })}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <OrderEditor
        title="调整文件规则优先级"
        rules={policy.fileRules}
        onMove={(index, delta) => onChange({
          ...policy,
          fileRules: move(policy.fileRules, index, delta),
        })}
      />
    </section>
  );
}

type SecretKind = "wholeFile" | "field" | "content";
type SecretRule =
  | BackupWholeFileSecretRule
  | BackupFieldSecretRule
  | BackupContentSecretRule;

function secretMatcher(rule: SecretRule): string {
  if (rule.match.kind === "key-value") return rule.match.keyPattern;
  return rule.match.pattern;
}

function formatsText(rule: SecretRule): string {
  return "formats" in rule ? rule.formats.join(",") : "全部";
}

function parseFormats(value: string, kind: SecretKind): BackupTextFormat[] {
  const allowed = kind === "field"
    ? new Set<BackupTextFormat>(["json", "jsonc", "toml"])
    : new Set<BackupTextFormat>(["json", "jsonc", "toml", "text"]);
  return value.split(",")
    .map((item) => item.trim() as BackupTextFormat)
    .filter((item) => allowed.has(item));
}

function kindLabel(kind: SecretKind): string {
  return kind === "wholeFile" ? "整文件" : kind === "field" ? "字段名" : "文件内容";
}

export function SecretRuleTable({
  policy,
  sourceLabel,
  onChange,
}: {
  policy: BackupPolicyV1;
  sourceLabel: string;
  onChange: (policy: BackupPolicyV1) => void;
}) {
  const sections: Array<{ kind: SecretKind; rules: SecretRule[] }> = [
    { kind: "wholeFile", rules: policy.secretRules.wholeFile },
    { kind: "field", rules: policy.secretRules.field },
    { kind: "content", rules: policy.secretRules.content },
  ];
  const setRules = (kind: SecretKind, rules: SecretRule[]) => {
    const secretRules = { ...policy.secretRules };
    if (kind === "wholeFile") secretRules.wholeFile = rules as BackupWholeFileSecretRule[];
    else if (kind === "field") secretRules.field = rules as BackupFieldSecretRule[];
    else secretRules.content = rules as BackupContentSecretRule[];
    onChange({ ...policy, secretRules });
  };
  const add = (kind: SecretKind) => {
    const base = { id: newId(`secret-${kind}`), label: "新密钥规则", enabled: true };
    const rule: SecretRule = kind === "wholeFile"
      ? { ...base, target: "basename", match: { kind: "glob", pattern: "secret.json" }, action: "exclude-file" }
      : kind === "field"
      ? { ...base, formats: ["json", "jsonc", "toml"], match: { kind: "contains", pattern: "token" }, action: "placeholder" }
      : { ...base, formats: ["text"], match: { kind: "regex", pattern: "SECRET_[A-Za-z0-9_-]+" }, action: "placeholder" };
    const section = sections.find((item) => item.kind === kind)!;
    setRules(kind, [...section.rules, rule]);
  };

  return (
    <section className="backup-rule-section">
      <div className="backup-rule-section-head">
        <div>
          <h3>密钥处理规则</h3>
          <p>整文件优先；结构化文件先看字段，再看内容。排除整个文件的结果优先。</p>
        </div>
        <div className="rule-add-actions">
          <button className="btn-sm" onClick={() => add("wholeFile")}>+ 整文件</button>
          <button className="btn-sm" onClick={() => add("field")}>+ 字段</button>
          <button className="btn-sm" onClick={() => add("content")}>+ 内容</button>
        </div>
      </div>
      {sections.map(({ kind, rules }) => {
        const table = (
          <>
            <div className="rule-table-wrap">
              <table className="rule-table">
            <thead>
              <tr>
                <th>启用</th><th>顺序</th><th>类型</th><th>名称</th>
                <th>方式</th><th>内容</th><th>格式/对象</th><th>动作</th><th>来源</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, index) => {
                const update = (next: SecretRule) => {
                  const updated = [...rules];
                  updated[index] = next;
                  setRules(kind, updated);
                };
                const matchKind = rule.match.kind;
                return (
                  <tr key={rule.id} className={rule.action === "keep-original" ? "rule-danger" : ""}>
                    <td><input type="checkbox" checked={rule.enabled} onChange={(event) => update({ ...rule, enabled: event.target.checked })} /></td>
                    <td>{index + 1}</td>
                    <td>{kindLabel(kind)}</td>
                    <td><input value={rule.label} onChange={(event) => update({ ...rule, label: event.target.value })} /></td>
                    <td>
                      <select value={matchKind} onChange={(event) => {
                        const nextKind = event.target.value;
                        if (kind === "content" && nextKind === "key-value") {
                          update({ ...rule, match: { kind: "key-value", keyPattern: "TOKEN|SECRET", minValueLength: 8 } } as SecretRule);
                        } else {
                          update({ ...rule, match: { kind: nextKind, pattern: secretMatcher(rule) } } as SecretRule);
                        }
                      }}>
                        {kind === "wholeFile" && <option value="glob">Glob</option>}
                        {kind === "field" && <option value="exact">精确</option>}
                        {kind === "field" && <option value="contains">包含</option>}
                        {kind === "field" && <option value="suffix">后缀</option>}
                        {kind === "field" && <option value="glob">Glob</option>}
                        <option value="regex">正则</option>
                        {kind === "content" && <option value="key-value">键值</option>}
                      </select>
                    </td>
                    <td><input className="rule-pattern" value={secretMatcher(rule)} onChange={(event) => {
                      const match = rule.match.kind === "key-value"
                        ? { ...rule.match, keyPattern: event.target.value }
                        : { ...rule.match, pattern: event.target.value };
                      update({ ...rule, match } as SecretRule);
                    }} /></td>
                    <td>
                      {"target" in rule ? (
                        <select value={rule.target} onChange={(event) => update({ ...rule, target: event.target.value as BackupWholeFileSecretRule["target"] })}>
                          <option value="relative-path">相对路径</option>
                          <option value="basename">文件名</option>
                        </select>
                      ) : (
                        <input
                          value={formatsText(rule)}
                          title="逗号分隔：json,jsonc,toml,text"
                          onChange={(event) => update({
                            ...rule,
                            formats: parseFormats(event.target.value, kind),
                          } as SecretRule)}
                        />
                      )}
                    </td>
                    <td>
                      <select value={rule.action} onChange={(event) => update({ ...rule, action: event.target.value as BackupSecretAction })}>
                        {SECRET_ACTIONS.map((action) => <option key={action.value} value={action.value}>{action.label}</option>)}
                      </select>
                    </td>
                    <td><span className="policy-source-label">{sourceLabel}</span></td>
                    <td>
                      <button className="rule-remove-button" onClick={() => setRules(
                        kind,
                        rules.filter((_, itemIndex) => itemIndex !== index),
                      )}>删除</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
              </table>
            </div>
            <OrderEditor
              title={`调整${kindLabel(kind)}规则优先级`}
              rules={rules}
              onMove={(index, delta) => setRules(kind, move(rules, index, delta))}
            />
          </>
        );
        return kind === "content" ? (
          <details className="backup-policy-advanced rule-content-details" key={kind}>
            <summary>高级内容匹配规则（正则 / 键值，共 {rules.length} 条）</summary>
            {table}
          </details>
        ) : (
          <div className="secret-rule-group" key={kind}>
            {table}
          </div>
        );
      })}
    </section>
  );
}

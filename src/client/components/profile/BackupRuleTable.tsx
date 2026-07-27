import { useEffect, useRef, useState } from "react";
import type {
  BackupContentSecretRule,
  BackupFieldSecretRule,
  BackupFileRule,
  BackupPolicyV1,
  BackupSecretAction,
  BackupTextFormat,
  BackupWholeFileSecretRule,
} from "../../../profiles/types.ts";
import { PolicySelect } from "./PolicySelect.tsx";

const SECRET_ACTIONS: Array<{ value: BackupSecretAction; label: string }> = [
  { value: "placeholder", label: "替换为占位符" },
  { value: "exclude-file", label: "排除整个文件" },
  { value: "keep-original", label: "保留原值（危险）" },
  { value: "ignore", label: "忽略命中" },
];

const FILE_TARGETS = [
  { value: "relative-path", label: "相对路径" },
  { value: "basename", label: "文件名" },
] as const;

const FILE_MATCHERS = [
  { value: "glob", label: "Glob" },
  { value: "regex", label: "正则" },
] as const;

const FILE_ACTIONS = [
  { value: "include", label: "包含" },
  { value: "exclude", label: "排除" },
] as const;

const DEFAULT_FILE_ACTIONS = [
  { value: "include", label: "默认包含" },
  { value: "exclude", label: "默认排除" },
] as const;

const UNSCANNABLE_FILE_ACTIONS = [
  { value: "include-with-warning", label: "包含并警告" },
  { value: "exclude", label: "排除" },
] as const;

const WHOLE_FILE_MATCHERS = [
  { value: "glob", label: "Glob" },
  { value: "regex", label: "正则" },
] as const;

const FIELD_MATCHERS = [
  { value: "exact", label: "精确" },
  { value: "contains", label: "包含" },
  { value: "suffix", label: "后缀" },
  { value: "glob", label: "Glob" },
  { value: "regex", label: "正则" },
] as const;

const CONTENT_MATCHERS = [
  { value: "regex", label: "正则" },
  { value: "key-value", label: "键值" },
] as const;

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

function useNewRuleFocus() {
  const sectionRef = useRef<HTMLElement>(null);
  const [pendingRuleId, setPendingRuleId] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingRuleId) return;
    const row = sectionRef.current?.querySelector<HTMLElement>(
      `[data-rule-id="${pendingRuleId}"]`,
    );
    const nameInput = row?.querySelector<HTMLInputElement>(
      'input:not([type="checkbox"])',
    );
    row?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    nameInput?.focus();
    nameInput?.select();
    setPendingRuleId(null);
  }, [pendingRuleId]);

  return { sectionRef, focusRule: setPendingRuleId };
}

function RuleOrder({
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
      <span>{index + 1}</span>
      <button type="button" disabled={index === 0} onClick={() => onMove(-1)} title="提高优先级">↑</button>
      <button type="button" disabled={index === length - 1} onClick={() => onMove(1)} title="降低优先级">↓</button>
    </div>
  );
}

export function FileRuleTable({
  policy,
  onChange,
}: {
  policy: BackupPolicyV1;
  onChange: (policy: BackupPolicyV1) => void;
}) {
  const update = (index: number, rule: BackupFileRule) => {
    const fileRules = [...policy.fileRules];
    fileRules[index] = rule;
    onChange({ ...policy, fileRules });
  };
  const { sectionRef, focusRule } = useNewRuleFocus();
  const [rulesOpen, setRulesOpen] = useState(false);
  const addRule = () => {
    const rule: BackupFileRule = {
      id: newId("file"),
      label: "新文件规则",
      enabled: true,
      target: "relative-path",
      match: { kind: "glob", pattern: "**/*.example" },
      action: "exclude",
    };
    onChange({ ...policy, fileRules: [rule, ...policy.fileRules] });
    setRulesOpen(true);
    focusRule(rule.id);
  };

  return (
    <section className="backup-rule-section" ref={sectionRef}>
      <div className="backup-rule-section-head">
        <div>
          <h3>文件涵盖规则</h3>
          <p>从上到下匹配，第一条命中即停止。</p>
        </div>
        <button type="button" className="btn-sm" onClick={addRule}>+ 添加</button>
      </div>
      <div className="policy-default-row">
        <label>未命中文件</label>
        <PolicySelect
          ariaLabel="未命中文件的默认动作"
          className="policy-default-select"
          value={policy.defaultFileAction}
          options={DEFAULT_FILE_ACTIONS}
          onChange={(defaultFileAction) => onChange({
            ...policy,
            defaultFileAction: defaultFileAction as BackupPolicyV1["defaultFileAction"],
          })}
        />
        <label>二进制/不可扫描文件</label>
        <PolicySelect
          ariaLabel="二进制或不可扫描文件的默认动作"
          className="policy-default-select"
          value={policy.unscannableFileAction}
          options={UNSCANNABLE_FILE_ACTIONS}
          onChange={(unscannableFileAction) => onChange({
            ...policy,
            unscannableFileAction: unscannableFileAction as BackupPolicyV1["unscannableFileAction"],
          })}
        />
      </div>
      <details
        className="backup-policy-advanced"
        open={rulesOpen}
        onToggle={(event) => setRulesOpen(event.currentTarget.open)}
      >
        <summary>查看和调整文件规则（共 {policy.fileRules.length} 条）</summary>
        <div className="rule-table-wrap">
          <table className="rule-table">
            <thead>
              <tr>
                <th>启用</th><th>优先级</th><th>名称</th><th>匹配对象</th>
                <th>方式</th><th>内容</th><th>动作</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {policy.fileRules.map((rule, index) => (
                <tr key={rule.id} data-rule-id={rule.id}>
                  <td><input type="checkbox" checked={rule.enabled} onChange={(event) => update(index, { ...rule, enabled: event.target.checked })} /></td>
                  <td>
                    <RuleOrder
                      index={index}
                      length={policy.fileRules.length}
                      onMove={(delta) => onChange({
                        ...policy,
                        fileRules: move(policy.fileRules, index, delta),
                      })}
                    />
                  </td>
                  <td><input value={rule.label} onChange={(event) => update(index, { ...rule, label: event.target.value })} /></td>
                  <td>
                    <PolicySelect
                      ariaLabel={`${rule.label} 的匹配对象`}
                      value={rule.target}
                      options={FILE_TARGETS}
                      onChange={(target) => update(index, {
                        ...rule,
                        target: target as BackupFileRule["target"],
                      })}
                    />
                  </td>
                  <td>
                    <PolicySelect
                      ariaLabel={`${rule.label} 的匹配方式`}
                      value={rule.match.kind}
                      options={FILE_MATCHERS}
                      onChange={(kind) => update(index, {
                        ...rule,
                        match: { ...rule.match, kind: kind as "glob" | "regex" },
                      })}
                    />
                  </td>
                  <td><input className="rule-pattern" value={rule.match.pattern} onChange={(event) => update(index, { ...rule, match: { ...rule.match, pattern: event.target.value } })} /></td>
                  <td>
                    <PolicySelect
                      ariaLabel={`${rule.label} 的处理动作`}
                      value={rule.action}
                      options={FILE_ACTIONS}
                      onChange={(action) => update(index, {
                        ...rule,
                        action: action as BackupFileRule["action"],
                      })}
                    />
                  </td>
                  <td>
                    <button type="button" className="rule-remove-button" onClick={() => onChange({
                      ...policy,
                      fileRules: policy.fileRules.filter((_, itemIndex) => itemIndex !== index),
                    })}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
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

function kindAddLabel(kind: SecretKind): string {
  return kind === "wholeFile" ? "整文件" : kind === "field" ? "字段" : "内容";
}

function kindDescription(kind: SecretKind): string {
  if (kind === "wholeFile") return "命中后直接决定整个文件的处理方式。";
  if (kind === "field") return "用于 JSON、JSONC 和 TOML 的结构化字段。";
  return "用于正则或键值形式的高级内容匹配。";
}

export function SecretRuleTable({
  policy,
  onChange,
}: {
  policy: BackupPolicyV1;
  onChange: (policy: BackupPolicyV1) => void;
}) {
  const sections: Array<{ kind: SecretKind; rules: SecretRule[] }> = [
    { kind: "wholeFile", rules: policy.secretRules.wholeFile },
    { kind: "field", rules: policy.secretRules.field },
    { kind: "content", rules: policy.secretRules.content },
  ];
  const { sectionRef, focusRule } = useNewRuleFocus();
  const [openSections, setOpenSections] = useState<Record<SecretKind, boolean>>({
    wholeFile: false,
    field: false,
    content: false,
  });
  const setSectionOpen = (kind: SecretKind, open: boolean) => {
    setOpenSections((current) => ({ ...current, [kind]: open }));
  };
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
    setRules(kind, [rule, ...section.rules]);
    setSectionOpen(kind, true);
    focusRule(rule.id);
  };
  const hasKeepOriginal = sections.some(({ rules }) => (
    rules.some((rule) => rule.enabled && rule.action === "keep-original")
  ));

  return (
    <section className="backup-rule-section" ref={sectionRef}>
      <div className="backup-rule-section-head">
        <div>
          <h3>密钥处理规则</h3>
          <p>整文件优先；结构化文件先看字段，再看内容。排除整个文件的结果优先。</p>
        </div>
      </div>
      {hasKeepOriginal && (
        <div className="policy-raw-warning">
          ⚠ 已启用“保留原值”。匹配到的密钥会以明文进入备份，导出前必须再次确认。
        </div>
      )}
      {sections.map(({ kind, rules }) => {
        return (
          <div className="secret-rule-group" key={kind}>
            <div className="backup-rule-section-head">
              <div>
                <h3>{kindLabel(kind)}规则</h3>
                <p>{kindDescription(kind)}</p>
              </div>
              <button type="button" className="btn-sm" onClick={() => add(kind)}>
                + {kindAddLabel(kind)}
              </button>
            </div>
            <details
              className={`backup-policy-advanced${kind === "content" ? " rule-content-details" : ""}`}
              open={openSections[kind]}
              onToggle={(event) => setSectionOpen(kind, event.currentTarget.open)}
            >
              <summary>查看和调整{kindLabel(kind)}规则（共 {rules.length} 条）</summary>
              <div className="rule-table-wrap">
                <table className="rule-table">
                  <thead>
                    <tr>
                      <th>启用</th><th>优先级</th><th>名称</th><th>方式</th>
                      <th>内容</th><th>格式/对象</th><th>动作</th><th>操作</th>
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
                        <tr
                          key={rule.id}
                          data-rule-id={rule.id}
                          className={rule.action === "keep-original" ? "rule-danger" : ""}
                        >
                          <td><input type="checkbox" checked={rule.enabled} onChange={(event) => update({ ...rule, enabled: event.target.checked })} /></td>
                          <td>
                            <RuleOrder
                              index={index}
                              length={rules.length}
                              onMove={(delta) => setRules(kind, move(rules, index, delta))}
                            />
                          </td>
                          <td><input value={rule.label} onChange={(event) => update({ ...rule, label: event.target.value })} /></td>
                          <td>
                            <PolicySelect
                              ariaLabel={`${rule.label} 的匹配方式`}
                              value={matchKind}
                              options={kind === "wholeFile"
                                ? WHOLE_FILE_MATCHERS
                                : kind === "field"
                                ? FIELD_MATCHERS
                                : CONTENT_MATCHERS}
                              onChange={(nextKind) => {
                                if (kind === "content" && nextKind === "key-value") {
                                  update({
                                    ...rule,
                                    match: {
                                      kind: "key-value",
                                      keyPattern: "TOKEN|SECRET",
                                      minValueLength: 8,
                                    },
                                  } as SecretRule);
                                } else {
                                  update({
                                    ...rule,
                                    match: { kind: nextKind, pattern: secretMatcher(rule) },
                                  } as SecretRule);
                                }
                              }}
                            />
                          </td>
                          <td><input className="rule-pattern" value={secretMatcher(rule)} onChange={(event) => {
                            const match = rule.match.kind === "key-value"
                              ? { ...rule.match, keyPattern: event.target.value }
                              : { ...rule.match, pattern: event.target.value };
                            update({ ...rule, match } as SecretRule);
                          }} /></td>
                          <td>
                            {"target" in rule ? (
                              <PolicySelect
                                ariaLabel={`${rule.label} 的匹配对象`}
                                value={rule.target}
                                options={FILE_TARGETS}
                                onChange={(target) => update({
                                  ...rule,
                                  target: target as BackupWholeFileSecretRule["target"],
                                })}
                              />
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
                            <PolicySelect
                              ariaLabel={`${rule.label} 的密钥处理动作`}
                              value={rule.action}
                              options={SECRET_ACTIONS}
                              onChange={(action) => update({
                                ...rule,
                                action: action as BackupSecretAction,
                              })}
                            />
                          </td>
                          <td>
                            <button type="button" className="rule-remove-button" onClick={() => setRules(
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
            </details>
          </div>
        );
      })}
    </section>
  );
}

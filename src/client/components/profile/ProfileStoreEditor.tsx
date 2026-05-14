import React, { useState, useEffect, useMemo, useRef } from "react";
import { CMEditor } from "../editor/CMEditor.tsx";
import { languageByName } from "../editor/languages.ts";
import { buildSchemaExtensions } from "../editor/schema-lint.ts";
import { DCH_STORE } from "../../../schemas/dch-store.ts";
import {
  readFileWithMtime, saveFileIfMtime, getHomeDir,
  isMtimeMismatch, isMtimeMissing,
} from "../../bridge.ts";

/**
 * 编辑 `~/.dch/profiles.json` 的 schema-aware modal（PR-I）。
 *
 * - 用 CMEditor + JSON schema lint（dch-store schema），让用户改 profiles.json 时
 *   实时看 lint / hover / completion
 * - schema 还能让用户直接改 hook 的 object 形式（`{ posix?, powershell?, cmd? }`），
 *   而 ProfilePanel UI 只支持 string 形式 hook —— 这是补全跨平台 hook 唯一 UI 入口
 * - 简单 save 走全文 saveFileIfMtime（不用 patchJson 字段级 patch），因为这是用户主动「raw 编辑」语义
 *
 * REVIEW_8 H7 / Group E3：modal 自闭环（自己 readFileWithMtime 拿基线，自己 saveFileIfMtime
 * 写回）；外部修改通过后端 mtime CAS 拦截。modal 期间外部 reload 不强制回流 content（modal
 * 是 short-lived，用户改完关闭，父级 reload 后再打开新内容） —— 万一被外部抢改，CAS 会
 * 在 save 时硬拦，banner 让用户决定 reload / overwrite。
 */
export function ProfileStoreEditor({
  onClose,
  onSaved,
  onToast,
}: {
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string, ok: boolean) => void;
}) {
  const [content, setContent] = useState<string>("");
  const [filePath, setFilePath] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // REVIEW_8 H7 / Group E3：modal 打开时 snapshot 当前 mtime；save 时透传给后端做 CAS。
  // - undefined: 初始未读
  // - null: CAS 弃权（用户「保留我的改动」点击后） / 文件不存在 → 后端跳 CAS
  // - number: 正常 CAS 基线
  const enterEditMtimeRef = useRef<number | null | undefined>(undefined);
  const [conflict, setConflict] = useState<{ kind: "mismatch" | "missing"; actualMtimeUs?: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const home = await getHomeDir();
        const path = `${home}/.dch/profiles.json`;
        setFilePath(path);
        const r = await readFileWithMtime(path);
        setContent(r.content);
        // 文件不存在 → mtimeUs=null → 走 first-write 语义（CAS 跳过）
        enterEditMtimeRef.current = r.mtimeUs;
      } catch (e) {
        onToast(e instanceof Error ? e.message : String(e), false);
      } finally {
        setLoading(false);
      }
    })();
  }, [onToast]);

  // REVIEW_8 H8 / Group E5：caller useMemo 稳定 language / extras 引用，
  // 否则 CMEditor langCompartment / extraCompartment 每次 render 都 reconfigure 一次。
  const langExt = useMemo(() => languageByName("json"), []);
  const schemaExt = useMemo(() => buildSchemaExtensions(DCH_STORE), []);

  const onSave = async () => {
    setSaving(true);
    try {
      // 简单 save：全文写盘。dch-store 没有「未知 key 保留」需求（profile 系统 SSOT 完整定义）
      // 但仍走 JSON.parse 验证一下避免写坏
      try { JSON.parse(content); } catch (e) {
        onToast(`JSON 语法错误：${(e as Error).message}`, false);
        setSaving(false);
        return;
      }
      const newMtime = await saveFileIfMtime(filePath, content, enterEditMtimeRef.current ?? null);
      enterEditMtimeRef.current = newMtime;
      onToast("已保存 profiles.json", true);
      onSaved();
      onClose();
    } catch (e) {
      // REVIEW_8 H7 / Group E3：mtime CAS 失败 → inline banner 让用户决定 reload / overwrite
      // （走 isMtimeMismatch / isMtimeMissing helper 而非 instanceof：跨 module mock 兼容性，
      //  详 bridge.ts 注释）
      if (isMtimeMismatch(e)) {
        // 优先取实例的 actualMtimeUs 字段；测试 stub 可能没此字段，fallback undefined
        const actualMtimeUs = (e as { actualMtimeUs?: number }).actualMtimeUs;
        setConflict({ kind: "mismatch", actualMtimeUs });
      } else if (isMtimeMissing(e)) {
        setConflict({ kind: "missing" });
      } else {
        onToast(e instanceof Error ? e.message : String(e), false);
      }
    } finally {
      setSaving(false);
    }
  };

  const reloadFromDisk = async () => {
    try {
      const r = await readFileWithMtime(filePath);
      setContent(r.content);
      enterEditMtimeRef.current = r.mtimeUs;
      setConflict(null);
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>编辑 <code>~/.dch/profiles.json</code></h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {loading ? (
            <div className="empty">读取中…</div>
          ) : (
            <>
              <p className="form-hint">
                schema-aware 编辑（lint / hover / completion）。这里是改 profile 系统状态的唯一 raw 入口
                —— 用于添加跨平台 hook 的 object 形式（<code>{`{ posix?, powershell?, cmd? }`}</code>）等
                ProfilePanel UI 不直接支持的字段。
              </p>
              {conflict && (
                <div className="schema-conflict">
                  <div className="schema-conflict-msg">
                    {conflict.kind === "mismatch"
                      ? "⚠️ 文件已被外部修改。继续保存会覆盖外部改动。"
                      : "⚠️ 文件已被外部删除。继续保存等于重新创建。"}
                  </div>
                  <div className="schema-conflict-actions">
                    <button
                      className="btn-sm"
                      disabled={saving}
                      onClick={reloadFromDisk}
                    >重新加载（放弃我的改动）</button>
                    <button
                      className="btn-sm danger"
                      disabled={saving}
                      onClick={() => {
                        // 用户主动放弃 CAS（强制覆盖）→ 后续 save 传 null 跳过后端 mtime 校验
                        enterEditMtimeRef.current = null;
                        setConflict(null);
                      }}
                    >保留我的改动（保存会覆盖）</button>
                    <button
                      className="btn-sm"
                      disabled={saving}
                      onClick={() => setConflict(null)}
                    >取消</button>
                  </div>
                </div>
              )}
              <CMEditor
                value={content}
                onChange={setContent}
                language={langExt}
                extraExtensions={schemaExt}
                readOnly={saving}
                maxHeight={500}
              />
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={saving}>取消</button>
          <button className="btn primary" onClick={onSave} disabled={loading || saving || conflict !== null}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

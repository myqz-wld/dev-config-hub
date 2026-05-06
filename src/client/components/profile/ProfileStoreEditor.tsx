import React, { useState, useEffect } from "react";
import { CMEditor } from "../editor/CMEditor.tsx";
import { languageByName } from "../editor/languages.ts";
import { buildSchemaExtensions } from "../editor/schema-lint.ts";
import { DCH_STORE } from "../../../schemas/dch-store.ts";
import { readFileWithMtime, saveFile, getHomeDir } from "../../bridge.ts";

/**
 * 编辑 `~/.dch/profiles.json` 的 schema-aware modal（PR-I）。
 *
 * - 用 CMEditor + JSON schema lint（dch-store schema），让用户改 profiles.json 时
 *   实时看 lint / hover / completion
 * - schema 还能让用户直接改 hook 的 object 形式（`{ posix?, powershell?, cmd? }`），
 *   而 ProfilePanel UI 只支持 string 形式 hook —— 这是补全跨平台 hook 唯一 UI 入口
 * - 简单 save 走全文 saveFile（不用 patchJson 字段级 patch），因为这是用户主动「raw 编辑」语义
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

  useEffect(() => {
    (async () => {
      try {
        const home = await getHomeDir();
        const path = `${home}/.dch/profiles.json`;
        setFilePath(path);
        const r = await readFileWithMtime(path);
        setContent(r.content);
      } catch (e) {
        onToast(e instanceof Error ? e.message : String(e), false);
      } finally {
        setLoading(false);
      }
    })();
  }, [onToast]);

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
      await saveFile(filePath, content);
      onToast("已保存 profiles.json", true);
      onSaved();
      onClose();
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), false);
    } finally {
      setSaving(false);
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
              <CMEditor
                value={content}
                onChange={setContent}
                language={languageByName("json")}
                extraExtensions={buildSchemaExtensions(DCH_STORE)}
                readOnly={saving}
                maxHeight={500}
              />
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={saving}>取消</button>
          <button className="btn primary" onClick={onSave} disabled={loading || saving}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

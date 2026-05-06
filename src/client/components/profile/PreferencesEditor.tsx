import React, { useState } from "react";
import { dchProfile, type ProfileStore } from "../../bridge.ts";

export function PreferencesEditor({
  store, onChange, onToast,
}: {
  store: ProfileStore;
  onChange: () => void;
  onToast: (m: string, ok: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  // REVIEW_4 R_2 R-M2：之前 uncontrolled input + 校验失败 input.value 不还原 → UI 显 50（用户输的非法值）但 store 仍是 30000，脱节
  // 改 controlled：state 跟 store 同步；onBlur 失败时 setState 还原到 store 当前值
  const [draftMs, setDraftMs] = useState<number>(store.preferences.hookTimeoutMs);

  const update = async (k: "hookTimeoutMs", v: number) => {
    // REVIEW_4 M5：与 dch-store.ts schema 1000-600000 + cli-profile.ts cmdConfig 三方对齐
    if (!Number.isInteger(v) || v < 1000 || v > 600000) {
      onToast(`hookTimeoutMs 必须是 1000-600000 之间的整数（1s ~ 10 分钟）`, false);
      setDraftMs(store.preferences.hookTimeoutMs);  // R_2 R-M2：还原 input
      return;
    }
    try {
      await dchProfile.config(k, v);
      onToast(`${k} = ${v}`, true);
      onChange();
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), false);
      setDraftMs(store.preferences.hookTimeoutMs);  // R_2 R-M2：失败也还原
    }
  };

  return (
    <div className="prefs">
      <button className="btn-sm" onClick={() => setOpen(!open)}>设置 ⚙</button>
      {open && (
        <div className="prefs-popover">
          <div className="form-row">
            <label>hook 超时(ms)</label>
            <input
              type="number"
              min={1000}
              max={600000}
              step={1000}
              value={draftMs}
              onChange={(e) => setDraftMs(Number(e.target.value))}
              onBlur={() => {
                if (draftMs !== store.preferences.hookTimeoutMs) update("hookTimeoutMs", draftMs);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

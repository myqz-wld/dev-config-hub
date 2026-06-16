import type { HookResult } from "../../bridge.ts";

export function HookOutputModal({
  data, onClose,
}: {
  data: { id: string; which: string; result: HookResult | null };
  onClose: () => void;
}) {
  const r = data.result;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>脚本运行结果 — {data.id} / {data.which}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {!r ? (
            <p>未配置该脚本。</p>
          ) : (
            <>
              <div className="form-row">
                <label>结果码</label>
                <code className={r.exitCode === 0 ? "ok" : "fail"}>{r.exitCode}{r.timedOut ? " (超时)" : ""}</code>
              </div>
              <div className="form-row">
                <label>耗时</label>
                <code>{r.durationMs} ms</code>
              </div>
              {r.stdout && (
                <div className="form-row form-row-block">
                  <label>正常输出</label>
                  <pre className="raw">{r.stdout}</pre>
                </div>
              )}
              {r.stderr && (
                <div className="form-row form-row-block">
                  <label>错误输出</label>
                  <pre className="raw">{r.stderr}</pre>
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn primary" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

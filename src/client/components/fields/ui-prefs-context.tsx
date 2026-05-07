import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ScopeKind } from "../../../schemas/registry.ts";
import type { FieldSchema } from "../../../schemas/types.ts";
import type { UiPrefs } from "../../bridge.ts";
import { saveUiPrefs } from "../../bridge.ts";

/**
 * UI 偏好（隐藏字段 + advanced 显示控制）Context（PR-CSv1）。
 *
 * **职责**：
 *   1. 持久化用户主动隐藏的 root level 字段列表（per ScopeKind）→ ~/.dch/ui-prefs.json
 *   2. 计算每个字段的「是否应当隐藏」（手动隐藏 OR schema.advanced 默认隐藏）
 *   3. 顶部 toggle「显示隐藏字段」临时翻出全部隐藏字段（session-scope，不持久）
 *
 * **二级 Provider 模式**：App.tsx 顶层用 RootUiPrefsProvider 包整个 main，提供持久化层；
 * SchemaScopeBody 内部用 ScopedUiPrefsProvider 注入当前 scopeKind，让 ObjectField
 * 能拿到「我属于哪个 scope」（避免 ObjectField 自己 prop drill scopeKind 来源）。
 *
 * **粒度**：所有判断仅作用于 root level（path === ""）字段，嵌套字段 hidden 函数始终
 * 返 false（不隐藏）。
 */

interface RootUiPrefsState {
  prefs: UiPrefs;
  setPrefs: (next: UiPrefs) => void;
  showHidden: boolean;
  setShowHidden: (v: boolean) => void;
}

const RootUiPrefsContext = createContext<RootUiPrefsState | null>(null);

/**
 * 顶层 Provider：持久化 prefs + 全局 showHidden state。
 * App.tsx 启动时加载初始 prefs 传入。
 */
export function RootUiPrefsProvider({
  initial,
  children,
}: {
  initial: UiPrefs;
  children: React.ReactNode;
}) {
  const [prefs, setPrefsState] = useState<UiPrefs>(initial);
  const [showHidden, setShowHidden] = useState(false);

  const setPrefs = useCallback((next: UiPrefs) => {
    setPrefsState(next);
    // 写盘失败仅 console.warn，不阻塞 UI（隐藏只是体验性 feature，丢一次可接受）
    saveUiPrefs(next).catch((e) => console.warn("[ui-prefs] save 失败:", e));
  }, []);

  const value = useMemo<RootUiPrefsState>(
    () => ({ prefs, setPrefs, showHidden, setShowHidden }),
    [prefs, setPrefs, showHidden],
  );

  return <RootUiPrefsContext.Provider value={value}>{children}</RootUiPrefsContext.Provider>;
}

/**
 * 当前 scope 的 UI prefs view（含 scopeKind 注入）。
 * SchemaScopeBody 在渲染前用 ScopedUiPrefsProvider 包一层，传入 scopeKind。
 */
export interface ScopedUiPrefsView {
  scopeKind: ScopeKind;
  /** 该 scope 的手动隐藏 key list（持久化）。 */
  hiddenKeys: ReadonlySet<string>;
  /** 临时显示所有隐藏字段（session 级，不持久）。 */
  showHidden: boolean;
  setShowHidden: (v: boolean) => void;
  /**
   * 给定 root level key + 字段 schema，决定 UI 是否应隐藏。
   * showHidden=true 时永远返 false（透出全部）。
   * 否则：手动隐藏 OR schema.advanced=true → 返 true。
   */
  isHidden: (key: string, fieldSchema: FieldSchema | undefined) => boolean;
  /**
   * 切换某个 key 的手动隐藏状态（写盘）。
   */
  toggleHide: (key: string) => void;
  /**
   * 给定 root properties 字典，统计当前 scope 隐藏的字段数（含手动 + advanced）。
   * 用于顶部 toggle "显示隐藏字段 (N)" 的 N。
   */
  countHidden: (allProperties: Record<string, FieldSchema>) => number;
}

const ScopedUiPrefsContext = createContext<ScopedUiPrefsView | null>(null);

export function ScopedUiPrefsProvider({
  scopeKind,
  children,
}: {
  scopeKind: ScopeKind;
  children: React.ReactNode;
}) {
  const root = useContext(RootUiPrefsContext);
  if (!root) {
    throw new Error("ScopedUiPrefsProvider 必须在 RootUiPrefsProvider 内");
  }

  const hiddenKeys = useMemo<ReadonlySet<string>>(
    () => new Set(root.prefs.hiddenFields[scopeKind] ?? []),
    [root.prefs.hiddenFields, scopeKind],
  );

  const isHidden = useCallback(
    (key: string, fieldSchema: FieldSchema | undefined): boolean => {
      if (root.showHidden) return false;
      if (hiddenKeys.has(key)) return true;
      if (fieldSchema?.advanced) return true;
      return false;
    },
    [hiddenKeys, root.showHidden],
  );

  const toggleHide = useCallback(
    (key: string) => {
      const cur = new Set(hiddenKeys);
      if (cur.has(key)) cur.delete(key);
      else cur.add(key);
      const nextHidden = [...cur];
      const nextPrefs: UiPrefs = {
        ...root.prefs,
        hiddenFields: {
          ...root.prefs.hiddenFields,
          [scopeKind]: nextHidden.length > 0 ? nextHidden : undefined,
        },
      };
      // 清掉空数组 key（避免 JSON 里残留 "claude-settings": []）
      if (!nextHidden.length) {
        delete (nextPrefs.hiddenFields as Record<string, unknown>)[scopeKind];
      }
      root.setPrefs(nextPrefs);
    },
    [hiddenKeys, root, scopeKind],
  );

  const countHidden = useCallback(
    (allProperties: Record<string, FieldSchema>): number => {
      let n = 0;
      for (const [key, fs] of Object.entries(allProperties)) {
        if (hiddenKeys.has(key) || fs.advanced) n++;
      }
      return n;
    },
    [hiddenKeys],
  );

  const value = useMemo<ScopedUiPrefsView>(
    () => ({
      scopeKind,
      hiddenKeys,
      showHidden: root.showHidden,
      setShowHidden: root.setShowHidden,
      isHidden,
      toggleHide,
      countHidden,
    }),
    [scopeKind, hiddenKeys, root.showHidden, root.setShowHidden, isHidden, toggleHide, countHidden],
  );

  return <ScopedUiPrefsContext.Provider value={value}>{children}</ScopedUiPrefsContext.Provider>;
}

/**
 * 拿当前 scope 的 UI prefs view。
 * 不在 ScopedUiPrefsProvider 内调返 null（caller 做 null-check 决定降级行为）。
 *
 * 典型调用：root level ObjectField + SchemaScopeBody + FieldMenu。
 * 嵌套 ObjectField 也可以调，但 isHidden / toggleHide 的语义只对 root key 有意义。
 */
export function useScopedUiPrefs(): ScopedUiPrefsView | null {
  return useContext(ScopedUiPrefsContext);
}

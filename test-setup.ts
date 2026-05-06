/**
 * happy-dom 全局 DOM 注册（PR-J follow-up #2）。
 *
 * bunfig.toml `[test] preload = ["./test-setup.ts"]` 让 bun test 跑 React 组件单测前
 * 把 happy-dom Window / document / HTMLElement 等注册到全局，否则 bun test 默认无 DOM。
 *
 * 注意：每个 test 文件 fresh 起一个 happy-dom；不需要测试间清理（GlobalRegistrator 内部处理）。
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!globalThis.document) {
  GlobalRegistrator.register();
}

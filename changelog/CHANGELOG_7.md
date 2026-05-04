# CHANGELOG_7: REVIEW_2 落地（综合 deep code review fix）

## 概要

REVIEW_2（首次全维度 deep code review，3 轮异构对抗 + 1 反驳轮，3 HIGH / 13 MED / ~30 LOW）的修复落地总账。按 reviewer-claude fix 时机提醒分 PR 推进，逐个 commit；本 changelog 在每个 PR 完成时追加一节。

REVIEW_2 主题与 REVIEW_1（跨平台 Win 支持，CHANGELOG_6 落地）正交：本轮聚焦 macOS 现网代码的综合质量（架构 / bug / 安全 / 性能 / 测试盲区）。

## PR-1 — 测试地基

> reviewer-claude fix 时机提醒：「没测试光修 finding 容易再退化，先做」。

### `src/profiles/store.ts`

- `loadStore` / `saveStore` 加可选 `path` 参数（默认 `STORE_PATH`），生产 caller（manager.ts 全 7 处写操作）不受影响。让单测能注入 tmpdir 不污染 `~/.dch/profiles.json`
- `saveStore` 用 `dirname(path)` 处理非默认路径的父目录 mkdir

### `src/profiles/store.test.ts`（+9 case）

`loadStore` 边界（覆盖 H3 lost update + L 系列回归保护）：
- 文件不存在 → 返 EMPTY_STORE 深拷贝（避免共享引用变形）
- corrupt JSON → throw 含明确 path
- 空文件 / 0 字节 → throw（与 corrupt 同语义）
- 缺 active 字段 → fallback `{ claude: null, codex: null }`
- 缺 preferences 字段 → fallback DEFAULT_PREFERENCES
- active 部分提供 → 与 default 合并

`saveStore + loadStore roundtrip`：
- 完整 ProfileStore 写入后读回保持一致
- saveStore 自动 mkdir 多层 parent dir

H3 lost update 回归测（`it.skip`，PR-5 修文件锁后反 skip）：
- spawn 5 child 各自 load → push → save，期望最终 6 条 profile

### `src/cli-profile.ts`

- `parseFlags` / `VALUE_FLAGS` 加 `export`（CHANGELOG_5 反复修过这块没 spec 易再退化）

### `src/cli-profile.parseFlags.test.ts`（new，+14 case）

- 空 argv / 纯 positional / VALUE_FLAGS 5 项分别 lock
- **`--pre-hook '--foo bar baz'` 字面值保留**（CHANGELOG_5 修复点回归保护）
- `--env KEY=VALUE` / 多对 / value 含 `=` 号 / value 为空（`KEY=`）
- 非 VALUE_FLAGS 的 flag 也允许带 value
- VALUE_FLAGS 末尾缺 value → 静默变 boolean true（lock 当前 LOW 行为）

### `src/profiles/symlink.test.ts`（+6 case）

`pathState` 四态（initToolDir / switchSymlink 决策核心）：
- missing：路径不存在
- file：普通文件
- directory：真实目录
- symlink：指向目录 / 指向文件 / dangling（target 不存在）— `lstat` 不 follow 行为锁定

### 测试基线

- 38 pass（CHANGELOG_6 后基线）→ **68 pass + 1 skip**（H3 lost update 等 PR-5 修复后反 skip）
- 0 fail，covered store/parseFlags/symlink 三个核心模块的单测保护层

## 备注

- **PR 切分原则**：每个 PR 单一目标 + 自带 test 自带 commit；reviewer-claude 给的合并顺序 PR-1 → PR-2 → PR-3..PR-7
- **不写 CHANGELOG_8/9/...**：本 review 落地走单文件追加节（PR-1/PR-2/...）而非每 PR 一个 CHANGELOG，便于一处看完总账。后续 PR 完成时本文件追加新节

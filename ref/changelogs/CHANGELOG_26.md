# CHANGELOG_26: Foundation template alignment

## 概要

将仓库操作文档和 `ref/` 索引组织对齐 project-engineering-foundation 模板；不改变运行时行为。

## 变更内容

### `.gitignore`

- 给活跃、未终态的 plan/review 工作副本新增 `.refs/` ignore 规则。
- 保持终态项目记录在 `ref/` 下继续纳入版本管理。

### `CLAUDE.md` / `AGENTS.md`

- 在 `CLAUDE.md` 增补共享基础目录架构和 plan/review 生命周期规则。
- 保持 `AGENTS.md` 只记录入口 / 运行时机制差异，并指向 `CLAUDE.md` 的共享生命周期规则。
- 根据 prompt review 反馈，同步 `AGENTS.md` 的历史读取提醒覆盖 changelog、review、plan 和 convention 记录。

### `ref/` indexes

- 将终态 plan/review 索引组织对齐基础工程模板。
- 保留历史 changelog、review、plan 和 convention 记录。

## 备注

- 上一轮 ignore 规则验证：结构检查确认 AGENTS.md、CLAUDE.md、README.md 和 `ref/` 索引已存在；`git check-ignore -v .refs/example.md` 确认 `.refs/` 被忽略；`bun test` 通过，419 pass / 0 fail。
- 本轮验证：`git diff --check` 通过；剥离代码示例和占位符后，变更 Markdown 的本地链接均可解析；`git check-ignore -v .refs/example.md` 输出 `.gitignore:29:.refs/`；`bun test` 通过，419 pass / 0 fail。

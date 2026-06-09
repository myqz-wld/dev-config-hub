# CHANGELOG_25: 测试文件拆分与本地残留检查

## 概要

本轮按项目组织规范处理测试文件 500 行护栏，并检查仓库级 `.claude/` 本地状态残留。不改变运行时行为。

## 变更内容

- 拆分 `src/profiles/redact.test.ts`：
  - 原文件保留基础脱敏行为与 placeholder 计数测试。
  - 新增 `src/profiles/redact.regression.test.ts` 承载 valueHash 与 REVIEW_9 回归用例。
- 拆分 `src/profiles/secrets-index.test.ts`：
  - 原文件保留索引构建、fieldPath 解析、setByFieldPath 和基础 round-trip 测试。
  - 新增 `src/profiles/secrets-index.apply-filled.test.ts` 承载 fan-out 写盘测试。
  - 新增 `src/profiles/secrets-index.regression.test.ts` 承载 REVIEW_9 回归用例。

## 文件大小护栏

- `redact.test.ts` 从 565 行降到 232 行。
- `secrets-index.test.ts` 从 763 行降到 348 行。
- 新增测试文件均低于 500 行。

## `.claude` 检查

仓库根目录没有 `.claude/` 目录，无需清理。

## 验证

- `bun test src/profiles/redact.test.ts src/profiles/redact.regression.test.ts src/profiles/secrets-index.test.ts src/profiles/secrets-index.apply-filled.test.ts src/profiles/secrets-index.regression.test.ts`
- 结果：119 pass / 0 fail。

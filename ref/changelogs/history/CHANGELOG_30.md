---
changelog_id: 30
changed_at: 2026-06-16
---

# CHANGELOG_30: UI 文案用户化

## 概要

对前端用户可见文案做一轮收敛，把页面、弹窗、按钮和提示中的内部字段名 / 技术词改成更面向用户的表达。功能逻辑、命令协议和数据结构不变。

## 变更内容

### 配置文件页

- 配置范围从 `global/user/project/local` 改为「全局 / 个人 / 项目 / 本地」。
- 文件类型展示从 `dotfile` 等内部值改为「文本 / JSON / TOML / Markdown」。
- 外部修改冲突提示改成「其他程序修改」，并把「重新加载」按钮改为「使用磁盘版本」。

### 配置方案页

- 主入口从 `Profiles` 改为「配置方案」，并统一「当前使用 / 配置目录 / 切换脚本」等用户视角说法。
- 新建配置方案、方案卡片、脚本输出和高级编辑弹窗去掉 `tool`、`configDir`、`store`、`symlink`、`hook`、`stdout/stderr` 等直接暴露的内部词。
- 表单校验提示从正则表达式说明改为自然语言规则说明。

### 备份与导入

- 备份导出页改用「配置方案 / 密钥 / 脱敏 / 默认备份 / 历史备份」等表达，弱化 `no-placeholder`、`unique secret`、`fan-out` 等术语。
- 备份历史页改用「默认备份 / 备份摘要 / 配置方案 / 脱敏位置」等用户语言。
- 导入流程统一使用「导入」口径，把密钥填写、跳过和手动补填提示改成可执行的用户任务说明。
- 导出备份「保留为历史」开关改为固定文案，避免勾选后整句替换造成「按钮语义变了」的歧义。
- 导出备份页新增「查看备份规则」折叠说明，说明包含范围、共享资源、默认脱敏、symlink 边界和排除项，并指向 README / `backup-rules.ts`。
- 导出备份 profile 选择行新增固定选中样式与自绘 checkbox，避免窗口失焦 / 聚焦时系统原生 checkbox active/inactive 样式跳变。
- 工具配置页选中态从数组下标改为稳定工具名，避免切回窗口触发 focus reload 后因工具列表重排导致选中应用跳变。

### 测试

- 同步更新 ConfigPanel、AddProfileModal、ProfileStoreEditor、RestoreSecretsBody 的文案相关断言。
- 新增 App 回归测试：focus reload 后工具列表重排仍保持当前选中的工具配置页。
- 新增 ExportBackupModal 文案测试：勾选「保留为历史」后文案保持稳定，并展示备份规则入口。
- 新增 ExportBackupModal 选中样式测试：profile 选择行使用固定 `selected` class，失焦事件不改变选中样式状态。

## 验证

- `bun test src/client/components/ConfigPanel.test.tsx src/client/components/profile/AddProfileModal.test.tsx src/client/components/profile/ProfileStoreEditor.test.tsx src/client/components/profile/RestoreSecretsBody.test.tsx src/client/components/profile/restore-modal-bodies.test.tsx`
- `bun test`

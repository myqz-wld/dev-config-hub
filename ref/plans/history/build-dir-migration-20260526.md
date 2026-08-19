---
plan_id: "build-dir-migration-20260526"
created_at: "2026-05-26"
worktree_path: ".claude/worktrees/build-dir-migration-20260526"
status: "completed"
base_commit: "ae8268e"
base_branch: "main"
final_commit: "fc1591ddd76410787ba094f0636a1e8ba88e0c20"
completed_at: "2026-05-26"
---
# Plan: dev-config-hub 项目 build 产物全面迁移到 build/ 统一根出口

## 总目标

把 dev-config-hub 项目前端 build 产物统一收纳到 `build/` 根出口下:
- bun build outDir:`dist/` → `build/fe/`
- 同步 Tauri `frontendDist`(`src-tauri/tauri.conf.json` 引用前端产物路径)
- 同步 `.gitignore`(删 `dist` / `out` 单数 entry + 加 `build/`)
- 同步 src/ doc 注释(grep 范围内 `dist/` / `out/` 命中)+ README/CLAUDE 自描述文件(如有命中)

**学样资料**:agent-deck 项目已完成同类改造(`ref/plans/build-dir-migration-20260526.md` + `ref/changelogs/CHANGELOG_154.md`)。

**Why**:对齐 `build/<sub>/` canonical 标准跨项目可迁移(详 §设计决策 D1);本项目前端产物当前散落项目根 `dist/` 与 `out/`(已忽略但无意义保留)等多个潜在落点,统一到 `build/` 让 git ignore + retro 命名一致。

**与 agent-deck plan 的关键差异**(self-contained,不假设你读过 agent-deck plan):

| 项 | agent-deck (Electron) | dev-config-hub (Tauri) |
|---|---|---|
| 前端 bundler | electron-vite (3 入口 main/preload/renderer) | bun build (1 入口 `src/client/index.html`) |
| 打包工具 | electron-builder(JS-only,产物自管) | Tauri CLI(Rust + 集成前端,Rust 部分用 Cargo) |
| 前端 outDir 配置 | `electron.vite.config.ts main/preload/renderer.build.outDir` × 3 | `package.json scripts.build:fe --outdir <DIR>` + `src-tauri/tauri.conf.json build.frontendDist` 引用 |
| 打包产物 outDir | `electron-builder directories.output: "build/dist"`(JS-only 项目可控) | Tauri 默认 `src-tauri/target/release/bundle/`(基于 Cargo target/,**整 src-tauri/target/ 已 .gitignore L37 忽略,本 plan 不动**) |
| Rust 编译产物 | N/A | `src-tauri/target/`(Cargo 标准,**不动**) |
| 改造 scope | 4 个 build/<sub>/(main + preload + renderer + dist) | 1 个 build/<sub>/(fe);Tauri Rust + bundle 产物全留 src-tauri/target/) |
| 影响 cross-file | 1(electron-builder asar / files glob 内部引用) | 1(Tauri tauri.conf.json frontendDist 跨文件引用 outdir) |

**例外不适用**:`build/` canonical 标准的「例外」条款说「已有项目按工具链默认惯例保留原状,不要 retro 改造;如需迁移走 §复杂 plan 完整流程」— 本 plan 即走 §复杂 plan 完整流程做 retro。

> **canonical 标准出处**:本 plan 的 `build/<sub>/` canonical 标准 + §不变量 4 .gitignore 必备条目源自学样 agent-deck plan 内部 inline 资产(`agent-deck/ref/plans/build-dir-migration-20260526.md`)。本 plan §不变量 1-10 + §设计决策 D1-D8 已自包含所有 canonical 内容,无需读 agent-deck plan 即可执行;reference 仅作历史出处。

**如何应用**(给下一会话):cold-start `Bash: cat <plan-abs-path>` 全文 → frontmatter 取 worktree_path → `EnterWorktree(path: <worktree_path>)` → 按 §下一会话第一步 接力

## 不变量

1. **bun build outDir + Tauri frontendDist cross-file 同步**:`package.json scripts.build:fe --outdir build/fe` + `src-tauri/tauri.conf.json build.frontendDist "../build/fe"` 必须**一致指向同一路径**(Tauri tauri.conf.json 在 `src-tauri/` 内,`../build/fe` 相对 src-tauri/ 解析到项目根 `build/fe`,与 bun outDir 一致)。**任一改不同步另一边都会让 Tauri build 撞「frontendDist not found」fail-fast**。
2. **canonical 命名 `build/fe`**:`fe` = frontend bundle 直观命名;**不**用 `build/dist`(本项目 Tauri bundle 产物在 `src-tauri/target/release/bundle/macos/`,与 build/dist 命名歧义)+ **不**用 `build/renderer`(Electron 命名习惯 / 本项目 Tauri 没有 main/preload 入口,renderer 一词 misleading)+ **不**用 `build/frontend`(过长)+ **不**用 `build/web`(WebView 概念太宽,fe 简洁)。
3. **`src-tauri/target/` 是 Cargo 标准目录**:整 Tauri Rust 编译 + bundle 产物全在其下(`target/release/bundle/macos/Dev Config Hub.app` / `target/release/bundle/dmg/*.dmg` / `target/release/bundle/msi/*.msi` 等),本 plan **不动**(canonical 例外:已有项目按工具链默认惯例保留;Tauri CLI 没有标准 config 字段改 bundle outdir;Cargo target/ 是 Rust 全生态共识;改了反而不直观)。Tauri bundle 产物路径 `src-tauri/target/release/bundle/macos/Dev Config Hub.app` **完全不变**(README + CLAUDE 内 cp 命令保持原样)。
4. **`.gitignore` 项目根 `/build/` 锚定忽略**(**前置 `/` 锚定项目根**,不忽略任意层级 nested `src/build/` `foo/build/` 等子目录;本 plan 设计意图是只忽略项目根产物,nested 同名目录意外隐藏会误导未来代码)+ 删 L4 `out` 单数 + L5 `dist` 单数 entry(本项目历史无 out/ 但 entry 保留无义,清理冗余);整 `src-tauri/target/` L37 + `src-tauri/gen/` L38 **保持不变**(Tauri 产物归属 Cargo target 不归属 `build/`,这两条是 Tauri 标准忽略 entry 与本 plan 0 关系)。
5. **不向后兼容**(hard cutover):老 `dist/` 产物即时无效;升级前 user 跑 `bun run build:fe` 一次产生 `build/fe` 即可;`bunx tauri build` 内部自动跑 `beforeBuildCommand: bun run build:fe` 不需 user 手动。**不**留兼容旧 `dist/` 路径 fallback。
6. **不留兼容旧 `dist/` `out/` 描述 / fallback / migration helper**(user 硬指令 + 应用 CLAUDE §提示词资产维护 约束 2「当前事实」)。**例外**:`changelog/ reviews/ plans/` 历史归档保持当时事实(参 agent-deck plan §不变量 9)。
7. **bun test + bunx tauri build --bundles app 全 pass** 是收口前置条件;**`bun run dev` 留 user 收口后自验证**(与 agent-deck §F.6 同款 dog-fooding 责任分配 — lead 自杀风险禁主跑 `pkill "Dev Config Hub"` / 重装 .app,详 §Phase F.5)。
8. **每个 fix 必有同步实测** — 改 config 同步跑相应 bun / Tauri 命令 verify 产物 actually 落 build/fe/(不积累多 fix 一次 batch 跑,单点错误难定位)。
9. **src/ + doc 内 `dist/` `out/` 提及全替换**(同款 hard cutover 不留旧标准描述)。**扫描范围**:`src/ package.json src-tauri/tauri.conf.json tsconfig.json bunfig.toml README.md CLAUDE.md`(顶层 self-describe + 配置文件,**含 tsconfig.json + bunfig.toml** R1 finding 修法 — claude HIGH-1 + codex LOW-2 双方独立提出)。**不扫**:`changelog/ reviews/ plans/`(历史归档保持当时事实) + `node_modules/` + `build/` + `dist/` + `src-tauri/target/`(产物 / 第三方);**`patches/` 例外**:`patches/ebnf@1.9.1.patch` 等第三方 npm 包 patch 内部含 `dist/Grammars/...` 等是该包 build 产物路径属合法引用,**不替换**(R1 codex LOW-2 修法)。**特别注意 README.md L60** 的 `src-tauri/target/release/bundle/msi/` 是 Tauri Windows bundle 标准产物路径,**不属于 dist/ 替换范围**(Tauri target/ 是 §不变量 3 例外)。
10. **base_commit 严格在 main 上**(`ae8268e chore(cleanup): trim & skeleton refresh per CLAUDE.md (plan: personal-projects-cleanup-20260520)`,本项目当前 HEAD)。

## 设计决策(不再争论)

### D1: build/ 子目录命名 — `build/fe`(直观 + 跨项目可迁移)

`build/fe/` 是前端 bundle 唯一落点(本项目只有 1 入口 `src/client/index.html`)。

**Why**(选项对比详 §不变量 2):`fe` 直观 / 短;不与 Tauri bundle 产物路径(`src-tauri/target/release/bundle/`)歧义;不用 Electron-style `renderer` 命名(本项目无 main/preload);跨项目可迁移(其他 Tauri 项目都可遵循 `build/fe` 命名)。

### D2: Tauri Rust + bundle 产物保留 `src-tauri/target/`(canonical 例外)

整 Tauri Rust 编译 + bundle 产物全留 `src-tauri/target/` 子树。**不**改 Tauri bundle outdir(详 §不变量 3 — Cargo 标准 + Tauri CLI 没有标准 config 字段改 bundle outdir + 改了不直观)。

### D3: changelog X 接起算

收口时按 §Phase G-manual.2.0 fail-fast 重算 X(`ls changelog/CHANGELOG_*.md | max + 1`),避免本 plan in_progress 期间被别 plan 撞号。当前最大 X=22(CHANGELOG_22 占),预计本 plan X=23。

### D4: 不向后兼容(hard cutover)

老 `dist/` 产物即时无效;升级前 user 跑 `bun run build:fe` 一次重生即可。**不**留兼容旧 `dist/` 路径 fallback。

### D5: Step 1.5 deep-review SKILL kind='plan' 评审 plan + Step 5 deep-review kind='mixed' 实施评审

复杂度评估:本项目改动仅 2 个 config 文件 + .gitignore + 可能少量 doc/src 注释,比 agent-deck plan 简单(无 ASAR 内部 / 无 main/preload/renderer 拆分);**预计 1-2 轮 review 收敛**(R1 必跑,R2 视 R1 finding 数量决定);R3+ 不需(本 plan 体量小)。

### D6: dev mode 兼容性

本项目 `bun run dev = tauri dev`,`tauri dev` 内部会调 `beforeDevCommand: bun run dev:fe`(注意是 dev:fe 不是 build:fe — 见 `tauri.conf.json` L7)。`dev:fe` 是 `bun src/client/dev-server.ts`(自定义 dev server,不走 build)。改 build:fe outDir 不影响 dev mode(dev mode 不写 outDir,与 build mode 解耦)。**Phase F dev mode 留 user 自验证**(参 §不变量 7)。

### D7: 改造 cross-file 引用 — `tauri.conf.json frontendDist`

`src-tauri/tauri.conf.json L10 frontendDist: "../dist"` 必须与 `package.json L11 scripts.build:fe --outdir dist` 同步改成 `"../build/fe"` + `--outdir build/fe`。任一改不同步会让 `bunx tauri build` 找不到前端产物 fail-fast。

### D8: README/CLAUDE doc 改动

`README.md` 与 `CLAUDE.md` 的 `bunx tauri build --bundles app` + `cp -R "src-tauri/target/release/bundle/macos/Dev Config Hub.app" /Applications/` 命令保持原样(Tauri target/ 是 §不变量 3 例外)。**只改 grep 命中的 `dist/` / `out/` 引用**(若有)。Phase D 实测确定改动量。

## 影响面 spike(待 spike 实测)

### A. bun build outDir(`package.json scripts.build:fe`)

实测项:
- `bun build src/client/index.html --outdir build/fe --splitting` 是否让产物落 `build/fe/`?(spike1)
- 改后 `bun run build:fe` 输出是否 0 残留 `dist/`?(spike1)

### B. Tauri frontendDist cross-file 同步(`src-tauri/tauri.conf.json`)

实测项:
- `tauri.conf.json build.frontendDist: "../build/fe"` 是否让 `bunx tauri build` 找到前端产物?(spike2)
- bunx tauri build 完整链路是否成功打包出 .app(`src-tauri/target/release/bundle/macos/Dev Config Hub.app`)?(spike2)

### C. src/ 注释 / doc 内 hardcode 路径(Phase C/D 完成清单)

`spike pre-check` grep 实测命中(scope = §不变量 9):
- `src/cli-profile.ts:366` 注释含 "stdout/" — **不构成 dist/ 引用**(stdout 普通词)
- `src/client/bridge-backup.invariants.test.ts:95` 注释含 "stdout" — 同上
- `src/client/components/ProfilePanel.tsx:80` 注释含 "stdout/stderr" — 同上
- `package.json:11` `--outdir dist`(Phase A 改)
- `src-tauri/tauri.conf.json:10` `frontendDist: "../dist"`(Phase A 改)
- `tsconfig.json:30` `"exclude": ["node_modules", "src-tauri", "dist"]`(R1 HIGH-1 漏检 — Phase G' 补 fix,`§不变量 6 hard cutover 直接 break`)
- `bunfig.toml` 0 命中(顶层 self-describe 配置文件,实测 only `[test] preload = ["./test-setup.ts"]` 与 build 无关)

**实际命中范围**:Phase A 改 2 处 + Phase G' R1 finding fix 改 1 处(tsconfig.json:30);**0 个真正 hardcode `dist/` 路径引用**(stdout 等普通词不是路径)。**doc(README/CLAUDE)0 处 dist/ 命中**(README L58/L60/L330 + CLAUDE L13-15 全是 `src-tauri/target/release/bundle/` 路径,不属于 dist/ 替换范围)。

### D. .gitignore(L4-L5)

- 删 L4 `out` 单数 entry(本项目历史无 out/ 但保留无义,清理)
- 删 L5 `dist` 单数 entry
- 加 `/build/`(canonical .gitignore 必备条目,**前置 `/` 锚定项目根**不撞 nested 同名目录;详 §不变量 4)
- L37 `src-tauri/target` + L38 `src-tauri/gen` 保留不变(Tauri 标准 ignore entry,与本 plan 0 关系)

## 步骤 checklist

### Phase Spike: spike 实测(在 worktree 内跑)

- [x] **spike1 bun build outDir**:改 `package.json scripts.build:fe --outdir dist` → `--outdir build/fe` → `bun run build:fe` 验证产物落 `build/fe/`(`ls build/fe/`)+ 0 残留 `dist/`
  - **结论 ✅**:`build/fe/{index.html, index-ybs2e64j.js (3.35 MB entry), index-xctyhsh6.js (145.56 KB), core-f8x60nwn.js (76.58 KB), engine-oniguruma-qz1cn7rm.js (16.57 KB), github-dark-8802te7c.js, wasm-wb0dhcrp.js (0.62 MB), vitesse-light/dark-*.js, javascript-dwm2cmrf.js, index-f146p45v.css (22.74 KB)}` 共 13 个文件全部正确(R1 codex INFO-1 实测 verify:`find build/fe -maxdepth 1 -type f | wc -l` = 13;**flat 输出无 assets/ 子目录**,index.html 内资源用 `./index-*.css` `./index-*.js` 相对路径引用同目录文件);`dist/` 0 残留(worktree 内不存在 dist/ 目录)。Bundled 650 modules in 104ms,bun bundler 极速。
- [x] **spike2 Tauri frontendDist cross-file + 完整 build 链路**:改 `src-tauri/tauri.conf.json build.frontendDist "../dist"` → `"../build/fe"` → `bunx tauri build --bundles app` 验证 .app 落 `src-tauri/target/release/bundle/macos/Dev Config Hub.app`(整链路成功 = bun build:fe 生成 build/fe + Tauri 拷 build/fe 内容到 .app + Rust 编译 + bundle .app)
  - **结论 ✅**:Rust release profile compiled in 46.48s,Bundled `src-tauri/target/release/bundle/macos/Dev Config Hub.app` 成功;.app 内部结构 `Contents/{Info.plist, MacOS/dev-config-hub (Rust binary,前端 inline via tauri-codegen), Resources/icon.icns}` 标准 Tauri .app 结构(**Tauri 与 Electron asar 不同 — 前端资源在编译时 embed 进 Rust binary,不在 Resources/ 单独 copy**)。Tauri build 成功 = embed 成功 = `frontendDist "../build/fe"` 路径解析正确 = cross-file 同步成立 ✅
- [⚠ skipped] **spike3 .app 重启实测**(static reasoning,跳过实测 — **user 收口后必须自验证** §Phase F.5):`/Applications/Dev Config Hub.app` 与本会话独立(本 lead session 跑在 Claude Code CLI 进程内不在 .app SDK 子进程中,不撞 dog-fooding 自杀风险);**但**保守起见仍留 user 自验证 spike3 6 步避免 lead 主动 kill 占用资源 / 干扰 user 工作。**user 收口后必走步骤**(详 §Phase F.5):① `pkill -f "Dev Config Hub"`;② `rm -rf "/Applications/Dev Config Hub.app"`;③ `cp -R "src-tauri/target/release/bundle/macos/Dev Config Hub.app" /Applications/`;④(可选 ad-hoc 重签)`codesign --force --deep --sign - "/Applications/Dev Config Hub.app"`;⑤(可选)`xattr -dr com.apple.quarantine "/Applications/Dev Config Hub.app"`;⑥ 双击 .app 验证启动 + UI 渲染正常 / 切 profile / 编辑 config 等核心链路 OK。**接力 agent 警告**:本 spike 状态是「未实测」而非「已 verify」,不要默认信任。
- [⚠ skipped] **spike4 dev mode 实测**(static reasoning,跳过实测 — **user 收口后必须自验证** §Phase F.5):`bun run dev = tauri dev`,内部调 `beforeDevCommand: bun run dev:fe`(自定义 dev server `bun src/client/dev-server.ts`,**不写 outDir**),与本 plan 改 build:fe outDir 0 关系;静态等价证明:① dev:fe 是独立 dev server 不走 bun build;② tauri dev 走 `devUrl: http://localhost:3456` HTTP 拉前端,不读 frontendDist 字段(frontendDist 仅 build mode 用)。**user 收口后建议自验证**:`bun run dev` 启动 Tauri 桌面窗口 + HMR 正常推送。

spike 结论 inline 到 §设计决策 + §已知踩坑;残留风险列表入 §已知踩坑。

### Phase A: bun build outDir + Tauri frontendDist cross-file 改造

- [x] A.1 改 `package.json` L11 `scripts.build:fe`:`--outdir dist` → `--outdir build/fe`
- [x] A.2 改 `src-tauri/tauri.conf.json` L10 `build.frontendDist`:`"../dist"` → `"../build/fe"`
- [x] A.3 `bun run build:fe` verify 产物落 `build/fe/` + 0 残留 `dist/`(spike1 实证 ✅)
- [x] A.4 `bunx tauri build --bundles app` verify 完整 Tauri 链路 + .app 生成成功(spike2 实证 ✅)

### Phase B: .gitignore 改造(**提前到第二步**避免 `build/` 误 commit)

- [x] B.1 删 .gitignore L4 `out` 单数 entry
- [x] B.2 删 .gitignore L5 `dist` 单数 entry
- [x] B.3 加 `/build/` 项目根锚定忽略(R1 codex LOW-1 修法 — 前置 `/` 防 nested `src/build/` 等子目录意外隐藏;详 §不变量 4)
- [x] B.4 `git check-ignore -v build/test.txt` 实测命中 `.gitignore:5:/build/`;`git check-ignore -v src/build/test.txt foo/build/test.txt` 不命中(R1 fix 后实测 ✅,verify nested 不撞);`git status --short build/` 干净无 `?? build/` ✅

### Phase C: src/ 注释扫描(grep 0 命中 verify)

- [x] C.1 grep `\bdist\b|\bout\b` 在 `src/`(scope §不变量 9)
- [x] C.2 verify 0 真正 hardcode `dist/` 路径引用 — `git grep -nE "\bdist\b|\bout\b" -- src/` 0 命中 + substring `git grep -n "dist" -- src/` 5 处全是英文 word `distinct`(secrets-index 注释),非路径引用 ✅
- [x] C.3 0 命中无需 sed 改

### Phase G' (R1 finding fix): tsconfig.json + bunfig.toml scope 补全(**§不变量 9 漏检根因修法**)

- [x] G'.1 grep `\bdist\b|\bout\b` 在 `tsconfig.json + bunfig.toml`(R1 HIGH-1 + LOW-1/LOW-2 修法 — 双方独立 ✅)
- [x] G'.2 verify `tsconfig.json:30 "exclude": [..., "dist"]` 1 处命中 → sed 删 `"dist"` 留 `"exclude": ["node_modules", "src-tauri"]`(本项目 src-tauri/ 是 Rust 后端不参与 TS 编译 + node_modules 标准排除已够,dist/ 永远不存在 exclude 是 noop 但违反 §不变量 6 hard cutover 必删)
- [x] G'.3 verify `bunfig.toml` 0 命中(only `[test] preload = ["./test-setup.ts"]` 与 build 无关)
- [x] G'.4 §不变量 8 enforcement 实测:`bun test` tsconfig 改后 419 pass / 0 fail / 962 expect(无回归)

### Phase D: README/CLAUDE 自描述 doc 同步

- [x] D.1 grep `\bdist\b|\bout\b` 在 `README.md + CLAUDE.md`(scope §不变量 9)
- [x] D.2 verify 0 真正 `dist/` 路径引用 — 全面 substring grep 0 命中。README L58/L60/L330 + CLAUDE L13-15 是 `src-tauri/target/release/bundle/` 路径,不替换;§不变量 3 例外 ✅
- [x] D.3 0 命中无需 sed 改

### Phase E: 全套验证

- [ ] E.0 **§不变量 8 enforcement**(接力会话补 fix 时必跑):Phase A-D 任何后续补 fix → 改完**立即**跑对应 bun / Tauri 命令实测产物落 `build/fe/`(不积累多 fix 一次 batch 跑,单点错误难定位)。改 package.json scripts 跑 `bun run build:fe`;改 src-tauri/tauri.conf.json 跑 `bunx tauri build`;改 src 注释 / doc 跑 `bun test`(narrative-only 无产物)
- [ ] E.1 `bun test` 全 pass(本项目无 typecheck script,bun 自动 type-check 跑 test)
- [ ] E.2 `bun run build:fe` ✅ 产物落 `build/fe/{index.html + 同目录 hash chunk/css 文件 共 13 文件}`(flat 输出无 assets/ 子目录,index.html 用相对路径 `./index-*.css` `./index-*.js` 引用同目录文件;R1 codex INFO-1 修法)
- [ ] E.3 `bunx tauri build --bundles app` ✅ .app 落 `src-tauri/target/release/bundle/macos/Dev Config Hub.app`
- [ ] E.4 grep 0 残留 ✅:`git grep -nE "outdir dist|frontendDist.*\"\\.\\./dist\"|\"dist\"" -- package.json src-tauri/tauri.conf.json tsconfig.json bunfig.toml src/ README.md CLAUDE.md` 输出空(精确 token 匹配,**含 tsconfig.json + bunfig.toml** R1 HIGH-1 修法补全 scan range,不撞 stdout/ 等普通词);**显式排除**(scan range 之外路径不需重复列):`changelog/ reviews/ plans/ node_modules/ build/ dist/ src-tauri/target/ patches/`(`patches/` 含第三方 npm 包内部 dist/ 路径属合法引用,§不变量 9 例外)
- [ ] E.5 **user 收口后自验证 dog-fooding 风险路径**(留 user 自跑,**接力 agent 严禁自跑步骤 ① pkill / ② rm /Applications/.app**):**与 `CLAUDE.md §构建 & 本地安装` 关系**:本 E.5 是 .app dog-fooding verify scope,**假设 E.3 `bunx tauri build` 已跑**(scope 限定不重跑)。**spike3 .app 重装 6 步**(自验证 .app 实际跑新 build/fe)→ ① `pkill -f "Dev Config Hub"`;② `rm -rf "/Applications/Dev Config Hub.app"`;③ `cp -R "src-tauri/target/release/bundle/macos/Dev Config Hub.app" /Applications/`;④(可选 ad-hoc 重签)`codesign --force --deep --sign - "/Applications/Dev Config Hub.app"`;⑤(可选)`xattr -dr com.apple.quarantine "/Applications/Dev Config Hub.app"`;⑥ 双击 .app 验证启动 + UI 渲染正常 / 切 profile / 编辑 config 等核心链路 OK。**spike4 dev mode 实测**:user .app 重装完成后跑 `bun run dev` 验证 dev mode 仍 work(若 fail 按 §已知踩坑 spike 失败回滚分支处理)

### Phase F: Step 1.5 deep-review §plan 评审

- [ ] F.1 invoke deep-review SKILL `kind='plan'` R1,scope = 本 plan 文件 + Phase A-D config 改动 post 实施
- [ ] F.2 处理 finding 按三态裁决纪律(详 user CLAUDE §决策对抗)
- [ ] F.3 R1 finding 高(>5 HIGH)或 0 反驳但跨文件漂移多 → R2;否则 R1 直接进 Phase G

### Phase G: Step 5 deep-review §实施评审(可选,视 F 后情况)

- [ ] G.1 invoke deep-review SKILL `kind='mixed'`,scope = Phase A-D 改动 + 本 plan post finding fix 状态
- [ ] G.2 处理 finding;0 新 HIGH 边界条件 → 直接 Phase H

### Phase H: 收口(G-manual 路径,与 agent-deck ref-layout 同款;**user 已授权接力会话 lead 全权决定 G-manual 路径**,详 §下一会话第一步 user 授权 callout)

- [ ] H.-1 **commit Phase A-G tracked 累积改动**(package.json + src-tauri/tauri.conf.json + .gitignore + src/ doc 注释如有 + README.md/CLAUDE.md 如有)— Phase H.0 worktree clean gate 之前必须把 spike + finding fix 全 commit,否则 H.0 立即 fail。**Plan 文件本身不在 H.-1 commit 范围**:`.claude/plans/` 已被 .gitignore 忽略;plan 文件入库职责在 H.5 mv plan → `plans/<plan_id>.md` + commit(唯一归档入库位置)。.gitignore 已在 Phase B 提前修保证 `build/` 不会被 git add 误纳入。
- [ ] H.0 worktree clean gate(`git status --short` 空,无 M / ?? / A 任何 entry)
- [ ] H.1 ExitWorktree(action: "keep")
- [ ] H.2.0 算 X(`ls changelog/CHANGELOG_*.md | max + 1`,fail-fast;预计 X=23)
- [ ] H.2/3 写 changelog/CHANGELOG_<X>.md + sync changelog/INDEX.md + commit
- [ ] H.4 ff-merge worktree branch → base_branch(main)
- [ ] H.5 mv plan + frontmatter update + sync plans/INDEX.md + commit
- [ ] H.6 git worktree remove + branch -D
- [ ] H.7 shutdown_baton_teammates(若 D5 起 Step 1.5 / Step 5 deep-review reviewer pair,清理 dormant 残留;G-manual 路径绕过 archive_plan tool baton-cleanup phase 1 → 必须手动调 escape hatch)

### Phase I: Post-archive fs 真验证

- [ ] I.1 archive 文件真存在(`ls -la plans/build-dir-migration-20260526.md`)
- [ ] I.2 git commit 含 archive
- [ ] I.3 INDEX append
- [ ] I.3.5 frontmatter status=completed + final_commit + completed_at
- [ ] I.4 git --follow history
- [ ] I.5 worktree + branch 真删
- [ ] I.6 **通知 user 走 §Phase E.5 dog-fooding 自验证步骤**(spike3 .app 重装 6 步 + spike4 dev mode 实测) — **agent 不自跑,告诉 user 收口已完成,请你自验证 .app 重装 + dev 模式**

## 当前进度

- ✅ §Step 0 学样资料读完(2026-05-26 cold-start):agent-deck plan + CHANGELOG_154 + 本项目 package.json + src-tauri/tauri.conf.json + .gitignore + bunfig.toml + CLAUDE.md + README.md + grep 实证 dist/ 命中范围
- ✅ §Step 1 plan v1 outline 写完(2026-05-26 本会话,base_commit `ae8268e`)
- ✅ §Step 2 EnterWorktree 完成(MCP enter_worktree + builtin EnterWorktree(path:) 双步,worktree `worktree-build-dir-migration-20260526` base 在 `ae8268e`)
- ✅ §Phase A 完成(A.1 package.json --outdir build/fe + A.2 src-tauri/tauri.conf.json frontendDist ../build/fe + A.3 bun run build:fe 实证 build/fe/ 13 文件 + A.4 bunx tauri build 实证 .app 生成成功)— commit `8c07286 feat(build-dir): migrate frontend bundle to build/fe (Phase A-D)`
- ✅ §Phase B 完成(.gitignore 删 out / dist 单数 entry + 加 build/ + git check-ignore 实证)— commit `8c07286`(R1 fix 后 build/ → /build/ 锚定,Phase G' 补 commit)
- ✅ §Phase C 完成(src/ grep `\bdist\b|\bout\b` 0 命中;substring `dist` 5 处全是英文 word `distinct`)
- ✅ §Phase D 完成(README + CLAUDE grep 0 命中;`src-tauri/target/release/bundle/...` 路径属 §不变量 3 例外不替换)
- ✅ §Phase E.1 bun test 419 pass / 0 fail ✅(10.66s,962 expect calls;Phase G' tsconfig 改后再跑 419 pass / 0 fail / 962 expect 10.50s 无回归)
- ✅ §Phase E.2 build:fe ✅(spike1 已 verify 13 文件 flat 输出)
- ✅ §Phase E.3 bunx tauri build ✅(spike2 已 verify .app 落 src-tauri/target/release/bundle/macos/Dev Config Hub.app)
- ✅ §Step 1.5 deep-review R1 mixed kind 完成(2026-05-26 本会话):reviewer-claude 7 finding(1 HIGH/3 MED/1 LOW/2 INFO)+ reviewer-codex 4 finding(0 HIGH/1 MED/2 LOW/1 INFO)双 reply,team `build-dir-r1`(`6e609841-...`);三态裁决:双方独立必修 2 + 单方 MED 必修 2 + 单方 LOW 必修 2 + 单方 INFO 必修 1 + 单方 MED followup 1(plan scope 外),**0 反驳 + 0 finding 被反驳 + 100% 真问题**;finding fix 全部完成(详 §Step 1.5 R1 finding fix 摘要 callout)
- ✅ §Phase G' R1 fix 完成(tsconfig.json:30 删 "dist" + .gitignore L5 build/ → /build/ 锚定 + plan §不变量 9 scan range 加 tsconfig.json/bunfig.toml + plan narrative 多处 fix)
- ⏳ §Phase E.4 grep 0 残留 final verify(R1 fix 后再跑一次精确 grep gate)
- ⏳ §Phase H 收口(G-manual 路径)
- ⏳ §Phase I post-archive 真验证

### §Step 1.5 R1 finding fix 摘要(2026-05-26 本会话)

R1 双方独立 ✅ 必修(双方独立异构强冗余即算验证):
- **claude HIGH-1 + codex LOW-2** ✅ fix:`tsconfig.json:30 "exclude": ["node_modules", "src-tauri", "dist"]` 残留 `"dist"` 违反 §不变量 6 hard cutover + §不变量 9 scan range 漏 tsconfig.json(漏检根因)→ tsconfig.json:30 删 `"dist"` 留 `"exclude": ["node_modules", "src-tauri"]` + plan §不变量 9 scan range 加 `tsconfig.json + bunfig.toml` + 明示 `patches/` 例外(第三方 npm 包内部 dist/ 合法引用)。lead 实测 `bun test` tsconfig 改后 419 pass / 0 fail 无回归 ✅
- **claude LOW-1 + codex LOW-2 修法方向相同** ✅ fix:plan §不变量 9 scan range 不完整 → 加 `tsconfig.json + bunfig.toml + patches/` 例外(已包含于 HIGH-1 fix 同 edit)

R1 单方 MED 必修(lead 验证后确认 — 双方视角不同但实质同一问题):
- **claude MED-2 (§当前接力起点 stale)+ codex MED-1 (main plan vs worktree plan 分叉)** ✅ fix:plan §下一会话第一步 §当前接力起点 ⏳ entry 全部 update 反映 R1 完成 + Phase H 待跑;worktree plan 与主仓库 `.claude/plans/` 那份分叉 → 收口前 cp worktree plan → main repo(Phase H.-1 之后 H.5 之前)
- **claude MED-3 (跨项目 reference 失锚)** ✅ fix:plan L21 / L35 / L43 / L117 4 处 "应用 CLAUDE §src/build" / "§新项目工程地基" reference 改 inline 描述 — L21 `对齐 build/<sub>/ canonical 标准跨项目可迁移(详 §设计决策 D1)`;L35 加 callout 说明 canonical 标准源自学样 agent-deck plan inline 资产,本 plan 已自包含,reference 仅作历史出处;L43 删 reference 留 reason `(Tauri CLI 没有标准 config 字段改 bundle outdir;Cargo target/ 是 Rust 全生态共识)`;L117 改 `(canonical .gitignore 必备条目)`。lead 实测 `grep -nE "src/build|新项目工程地基" ~/.claude/CLAUDE.md` 0 命中 verify ✅

R1 单方 LOW 必修(lead 验证后确认):
- **codex LOW-1 (.gitignore `build/` 未锚定)** ✅ fix:`.gitignore:5 build/` → `/build/`(前置 `/` 锚定项目根)防 nested `src/build/` `foo/build/` 任意层级目录意外隐藏。lead 实测 `git check-ignore -v src/build/test.txt foo/build/test.txt` fix 前两 hit / fix 后 0 hit verify ✅;`git check-ignore -v build/test.txt` 命中 `.gitignore:5:/build/` ✅。plan §不变量 4 + §影响面 spike D + Phase B 描述同步 update

R1 单方 INFO 必修(lead 验证后确认):
- **codex INFO-1 (build 产物数量/结构记录与 fs 不一致)** ✅ fix:plan §Phase Spike spike1 "14 文件" → "13 文件" + §Phase E.2 描述 `{index.html, assets/}` → `{index.html + 同目录 hash chunk/css 文件 共 13 文件}` flat 输出(R1 codex 实测 `find build/fe -maxdepth 1 -type f | wc -l` = 13;lead 自跑 `ls build/fe/` 13 文件确认)

R1 单方 MED followup(plan scope 外,**本 plan 不修**仅加 §已知踩坑 INFO note):
- **claude MED-1 (tauri.conf.json:2 `$schema` 指向 nicegram 404)** ✅ followup note:pre-existing bug 与本 plan 改动 0 关系,`bunx tauri build` 不读 $schema 字段(本 plan spike2 实测 build ✅ verify)。**加 §已知踩坑 INFO note** 提及「tauri.conf.json:2 $schema 字段 pre-existing 指向 nicegram URL 404 失效,本 plan 不修,留独立 followup」

R1 INFO verified(无需 fix):
- **claude INFO-1 (.gitignore `build/` glob 边界)** ✅ partial verified:claude 验证 `src-tauri/build.rs` `buildkite.yml` `build-tool/x.js` 不命中正确,但漏测 nested `src/build/` 等场景 — codex LOW-1 补 nested 视角发现 `build/` 不锚定确实忽略任意层级 → 综合走 codex LOW-1 修法 `/build/` 锚定
- **claude INFO-2 (Phase A-D 实施真落地)** ✅ verified:本 plan 主路径完全成立(实测 grep 0 命中 + cross-file 同步 + build/ glob 边界正确)
- **codex 补充验证** ✅:realpath build/fe = realpath src-tauri/../build/fe(cross-file 路径同步成立);.app 存在;git status 干净;HEAD `8c07286`

R1 整体:11 finding(claude 7 + codex 4 — 2 双方独立 overlap)+ 1 followup,**100% 真问题 0 反驳 0 finding 被反驳**。**R2 评估不需**:0 新 HIGH 边界条件(R1 finding 全 ✅ fix + 0 反驳 + 代码 + config + .gitignore 主路径完全正确,所有 finding 集中在 plan narrative 边界 + 1 处真残留 tsconfig.json + 1 处 .gitignore glob 锚定);**直接进 Phase H 收口** + Phase I post-archive。

## 下一会话第一步(cold-start 接力指令)

> ⚠️ 本 plan 由首会话(刚写完 plan v1 outline)写出。新会话 cold-start 时按 §当前进度 接力 — **找最近一个 ⏳ entry 就是接力起点**(不要从头跑)。

> 📜 **2026-05-26 user 授权**(context: user 在 task 描述里明示 lead 全权决定 hand off 时机 + 隐含 G-manual 路径授权 + Tauri build .app 重启留 user 自验证 + user 离开期间允许全自动推进):
> - **接力会话 lead 全权决定 hand off 时机**(不需逐 phase 请求 user 确认)
> - **隐含 G-manual 路径授权**(若 archive_plan tool 撞 precheck fail 走 §Step 4 5 步手工归档兜底,而非 plan in-place dog-fooding)
> - **隐含 spike3 .app 重启 + spike4 dev mode + Phase E.5 .app verify 留 user 自验证**(收口前 lead 不主动 kill 当前 .app / 不重装 /Applications/Dev Config Hub.app)
> - **user 离开期间允许全自动推进**(Phase A-I 整链路自动跑,不必中途 ping user)
> - hand off 后下一会话 cold-start 第一步仍按下面 cold-start 步骤走

### Cold-start 5 步(标准接力流程)

1. `Bash: cat ./.claude/plans/build-dir-migration-20260526.md`(全文)
2. 读 §当前进度,找最近一个 ⏳ entry — 就是接力起点
3. EnterWorktree(builtin) `path: .claude/worktrees/build-dir-migration-20260526`(避 v2.1.112 stale base bug,worktree 已存在不要再 git worktree add)
4. `git log --oneline -3` 自检 HEAD 含本 plan 的 commit 历史 + base_commit `ae8268e`
5. 按 §当前进度 ⏳ 起点对应 §Phase 章节实施,每完成一 Phase / Step 在本 plan 文件 `- [ ]` 打勾 + commit 进度

### 当前接力起点(2026-05-26 R1 fix 完成 + Phase H 开始)

- ✅ §Step 0 学样资料读完
- ✅ §Step 1 plan v1 outline 写完
- ✅ §Step 2 EnterWorktree 完成
- ✅ §Phase A-D 完成(commit `8c07286`)
- ✅ §Phase E.1/E.2/E.3 完成(bun test 419 pass / build:fe / Tauri .app build)
- ✅ §Step 1.5 deep-review R1 mixed 完成(11 finding 100% 真问题 0 反驳;详 §Step 1.5 R1 finding fix 摘要 callout)
- ✅ §Phase G' R1 fix 完成(tsconfig.json:30 删 "dist" + .gitignore /build/ 锚定 + plan narrative 多处 fix)
- ⏳ **§Phase E.4 grep 0 残留 final verify**(R1 fix 后再跑一次精确 grep gate verify 0 残留)
- ⏳ **§Phase H 收口**:H.-1 commit Phase G' tracked 改动(tsconfig.json + .gitignore) + sync worktree plan → main repo `.claude/plans/`(R1 codex MED-1 修法,**注**:.claude/plans/ 被 .gitignore 忽略不进 H.0 worktree clean gate)→ H.0 worktree clean gate → H.1 ExitWorktree(action: "keep")→ H.2.0 算 X(预计 X=23)→ H.2/3 changelog + commit → H.4 ff-merge → H.5 mv plan + frontmatter update + sync INDEX + commit → H.6 worktree remove + branch -D → H.7 shutdown_baton_teammates(escape hatch 补跑 baton-cleanup phase 1)
- ⏳ **§Phase I post-archive 真验证**:I.1-I.5 fs/git verify + I.6 通知 user 走 §Phase E.5 自验证(spike3 .app 重装 + spike4 bun run dev)

## 已知踩坑 / 风险

- **Tauri frontendDist 解析路径容易写错**:`tauri.conf.json` 在 `src-tauri/` 子目录内,`frontendDist` 路径相对该 conf 文件解析(不是项目根),所以 `"../build/fe"` 才能解析到项目根 `build/fe`(如果写 `"build/fe"` 会被 Tauri 解析成 `src-tauri/build/fe` fail-fast)。Phase A.2 严格保留 `"../"` 前缀。
- **Tauri target/ 不动决策**:Tauri CLI 没有标准 config 字段改 bundle outdir(查阅 tauri.conf.json schema 无 `bundle.outDir` 字段;Cargo target dir 走 `~/.cargo/config.toml` `[build] target-dir` 但跨项目共享会引起干扰)。本 plan 不试图改 Tauri target/,Tauri bundle 产物路径保持 `src-tauri/target/release/bundle/macos/Dev Config Hub.app` 完全不变。
- **README/CLAUDE doc 不需改**:本项目 README + CLAUDE 自描述命令全是 `src-tauri/target/release/bundle/...` 路径(Tauri target),0 处 `dist/` 引用;Phase D 预计 grep 0 命中 verify 即可。如有意外命中(spike 阶段 grep 实测有遗漏)按 Phase D 流程 sed 改。
- **bun build --splitting**:本项目用 `--splitting` flag 走 code splitting,产生多个 chunk file 在 `<outdir>/` 内(参 `dist/` 现状有 `index-*.js` + `core-*.js` + `engine-*.js` + `github-dark-*.js` 多个 hash chunk);改 outdir 不影响 splitting 行为(splitting 是 bun bundler 内部逻辑与 outdir 解耦);spike1 实测验证产物结构。
- **.app 重装 dog-fooding 风险**:本项目 `/Applications/Dev Config Hub.app` 与本 lead session 独立(lead 跑在 Claude Code CLI 进程不在 .app SDK 子进程内),理论上不撞自杀风险;**但**保守起见仍按 §不变量 7 留 user 自验证 spike3 6 步,避免 lead 主动 kill 占用资源 / 干扰 user 工作。
- **better-sqlite3 / native deps 风险**(本项目无 — 与 agent-deck 不同):本项目 `package.json` 仅引 react / codemirror / @tauri-apps/api 等 JS-only 依赖,无 native binding;Phase E `bun test` 全 pass 预期 0 native 相关 fail。
- **spike 失败回滚**:每个 spike 改完 config 跑命令,失败 → revert config 改回 `dist/` 默认 + 在 plan §已知踩坑 标注「bun build / Tauri X 行为与预期不符」+ plan 重写设计决策。
- **INFO note: tauri.conf.json:2 `$schema` 字段 pre-existing 失效**(R1 claude MED-1 followup,**本 plan 不修留独立 followup**):`src-tauri/tauri.conf.json:2 "$schema": "https://raw.githubusercontent.com/nicegram/nicegram-web/refs/heads/main/nicegram.json"` 是 pre-existing bug(实测 `curl -sI` 该 URL 返 HTTP/2 404,且这不是 Tauri schema)。**与本 plan 改动 0 关系**:`bunx tauri build` CLI 不读 $schema 字段,本 plan spike2 实测 build ✅ verify;但 IDE / JSON schema validator 用该 URL 拉不到 schema 失去字段校验保护。**修法**(独立 followup 不属本 plan):改成 `"$schema": "../node_modules/@tauri-apps/cli/config.schema.json"`(本地拉)或 Tauri 团队提供的 hosted schema(若有);本 plan 收口后建议另起一份 plan 修。

## 关联

- **触发**:user 指令「agent-deck 项目 build-dir-migration 已收口,你来对 dev-config-hub 项目做适配同款改造」(2026-05-26)
- **学样 plan**:`../agent-deck/ref/plans/build-dir-migration-20260526.md`(已 completed,final_commit `6a6903e9`)
- **学样 changelog**:`../agent-deck/ref/changelogs/CHANGELOG_154.md`
- **changelog 关联**:本 plan 完成后写 `changelog/CHANGELOG_<X>.md`(X 待定,本 plan §Phase H.2.0 步骤算)

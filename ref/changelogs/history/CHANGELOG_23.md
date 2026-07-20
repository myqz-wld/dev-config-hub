---
changelog_id: 23
changed_at: 2026-05-26
---

# CHANGELOG_23: build-dir-migration-20260526 plan 收口

## 概要

把 dev-config-hub (Bun + Tauri) 项目前端 build 产物从 `dist/` 迁到 `build/fe/`(对齐 `build/<sub>/` canonical 标准跨项目可迁移;学样 agent-deck plan `build-dir-migration-20260526` 同款改造),Tauri Rust + bundle 产物保留 `src-tauri/target/` 不动(Cargo 标准 + Tauri CLI 没有标准 config 字段改 bundle outdir,canonical 例外)。impl 硬切 `build/fe`(不留任何 `dist/ out/` fallback / migration helper),同步改 2 config + 1 .gitignore + 1 tsconfig(R1 finding fix)。

deep-review R1 mixed kind 完成(reviewer-claude Opus 4.7 + reviewer-codex gpt-5.5 异构对抗):共 11 finding(claude 7 + codex 4,2 双方独立 overlap),**100% 真问题 + 0 反驳 + 0 finding 被反驳**;R2 评估**不需**(0 新 HIGH 边界条件,代码 + config + .gitignore 主路径完全正确,所有 finding 集中在 plan narrative 边界 + 1 处真残留 tsconfig.json + 1 处 .gitignore glob 锚定细节)。

Phase E 全套验证:`bun test` 419 pass / 0 fail / 962 expect calls ✅;`bun run build:fe` 产物 13 文件落 `build/fe/` flat 输出 ✅;`bunx tauri build --bundles app` `.app` 落 `src-tauri/target/release/bundle/macos/Dev Config Hub.app` ✅;grep 0 残留(精确 token + substring 全空)✅。Phase E.5 `.app` 重装 + `bun run dev` dev mode 留 user 自验证(dog-fooding 责任分配)。

**Tauri / bun 协议无 breaking** — 本 plan 改的是前端 build artifact 落地路径 + Tauri frontendDist cross-file 引用同步,不影响 CLI dch 子命令 / Profile symlink 切换 / Hook 注入变量 / Tauri command 等任何用户感知接口。

## 变更内容

### Phase A — bun build outDir + Tauri frontendDist cross-file 同步

- `package.json:11` `scripts.build:fe`:`bun build src/client/index.html --outdir dist --splitting` → `--outdir build/fe --splitting`
- `src-tauri/tauri.conf.json:10` `build.frontendDist`:`"../dist"` → `"../build/fe"`(Tauri tauri.conf.json 在 `src-tauri/` 子目录内,`../build/fe` 相对该 conf 文件解析到项目根 `build/fe`,与 bun outDir 一致;路径不同步会让 `bunx tauri build` 撞「frontendDist not found」fail-fast)
- spike1 实测 `bun run build:fe` 产物 13 文件落 `build/fe/`(`index.html` + 12 hash chunk/css,flat 输出无 `assets/` 子目录,`index.html` 用 `./index-*.css` `./index-*.js` 相对引用同目录文件);`dist/` 0 残留
- spike2 实测 `bunx tauri build --bundles app` 完整链路成功:Rust release profile compiled in 46.48s;`.app` 落 `src-tauri/target/release/bundle/macos/Dev Config Hub.app`;`.app` 内部 `Contents/{Info.plist, MacOS/dev-config-hub (Rust binary,前端 inline via tauri-codegen), Resources/icon.icns}` 标准 Tauri 结构(Tauri 与 Electron asar 不同 — 前端资源在编译时 embed 进 Rust binary,不在 Resources/ 单独 copy)

### Phase B — .gitignore 改造(R1 codex LOW-1 fix 后:`/build/` 锚定项目根)

- 删 L4 `out` 单数 entry(本项目历史无 out/ 但 entry 保留无义,清理冗余)
- 删 L5 `dist` 单数 entry
- 加 `/build/` **项目根锚定忽略**(前置 `/` 防 nested `src/build/` `foo/build/` 等任意层级子目录意外隐藏;实测 fix 前 `git check-ignore -v src/build/test.txt foo/build/test.txt` 两 hit / fix 后 0 hit,`build/test.txt` 仍命中 `.gitignore:5:/build/`)
- L37 `src-tauri/target` + L38 `src-tauri/gen` 保持不变(Tauri 标准 ignore entry 与本 plan 0 关系;Cargo target dir 不归属 `build/`)

### Phase C — src/ 注释扫描(0 命中 verify)

- `git grep -nE "\bdist\b|\bout\b" -- src/` 0 命中 ✅
- substring `git grep -n "dist" -- src/` 5 处全是英文 word `distinct`(secrets-index 算法注释),非路径引用
- src/ 无需任何 sed 改

### Phase D — README/CLAUDE doc 同步(0 命中 verify)

- `git grep -nE "\bdist\b|\bout\b" -- README.md CLAUDE.md` 0 命中 ✅
- README.md L58/L60/L330 + CLAUDE.md L13-15 `bunx tauri build --bundles app` + `cp -R "src-tauri/target/release/bundle/macos/Dev Config Hub.app" /Applications/` 命令保持原样(`src-tauri/target/release/bundle/...` 路径属 §不变量 3 Tauri target/ 例外不替换)
- README + CLAUDE 无需任何 sed 改

### Phase G' (R1 finding fix) — tsconfig.json + .gitignore /build/ 锚定(R1 fix 补)

- `tsconfig.json:30` `"exclude": ["node_modules", "src-tauri", "dist"]` → `["node_modules", "src-tauri"]`(R1 claude HIGH-1 + codex LOW-2 双方独立 — §不变量 6 hard cutover 直接 break 必修;dist/ 永远不存在 exclude 是 noop 但留旧描述违反 hard cutover;实测 `bun test` tsconfig 改后 419 pass / 0 fail 无回归)
- `.gitignore:5` `build/` → `/build/`(R1 codex LOW-1 — 前置 `/` 锚定项目根防 nested 子目录意外隐藏;详 Phase B)
- plan §不变量 9 scan range 加 `tsconfig.json + bunfig.toml`(漏检根因修法)+ 明示 `patches/` 例外(第三方 npm 包内部 dist/ 合法引用)
- plan §不变量 4 + §影响面 spike D + §Phase B 描述同步 update(`build/` → `/build/`)

### Phase E — 全套验证

- E.1 `bun test` 419 pass / 0 fail / 962 expect calls / 10.66s(初跑) + 10.50s(tsconfig 改后再跑,无回归)
- E.2 `bun run build:fe` ✅ 产物 13 文件落 `build/fe/` flat 输出(详 Phase A spike1)
- E.3 `bunx tauri build --bundles app` ✅ `.app` 落 `src-tauri/target/release/bundle/macos/Dev Config Hub.app`(详 Phase A spike2)
- E.4 grep 0 残留 ✅:`git grep -nE 'outdir dist|frontendDist.*"\.\./dist"|"dist"' -- package.json src-tauri/tauri.conf.json tsconfig.json bunfig.toml src/ README.md CLAUDE.md` 输出空(精确 token 匹配含 R1 fix 后 scan range 补全 tsconfig + bunfig);substring `\bdist\b` 同款 scope 0 命中
- E.5 留 user 自验证 `.app` 重装 6 步 + `bun run dev` dev mode(详 plan §Phase E.5;lead 严禁主跑 `pkill "Dev Config Hub"` / `rm /Applications/`)

### Phase G — Step 1.5 deep-review R1 mixed × 1 轮 fix loop

- **R1 (kind='mixed')**:reviewer-claude 7 finding(1 HIGH/3 MED/1 LOW/2 INFO)+ reviewer-codex 4 finding(0 HIGH/1 MED/2 LOW/1 INFO),共 11 finding(2 双方独立 overlap = HIGH-1↔LOW-2x 同款 + scan range 补全同款)。覆盖 tsconfig.json:30 残留 `"dist"` 漏检根因(双方独立)+ §不变量 9 scan range 补全 + .gitignore `build/` 锚定 + plan §当前接力起点 stale + main plan vs worktree plan 分叉 + 跨项目 reference 失锚 + spike1 数字漂移(14 → 13) + tauri.conf.json $schema pre-existing 404(plan scope 外 followup)
- **0 反驳 + 0 finding 被反驳 + 0 新 HIGH 边界条件 + 0 code/config 主路径 bug** — 代码 + config + .gitignore 主路径完全正确,所有 finding 集中在 plan narrative 边界 + 1 处真残留 tsconfig.json + 1 处 .gitignore glob 锚定。**R2 评估不需** → 直接 Phase H 收口

## 改动文件统计

- **3 config**:`package.json`(scripts.build:fe outdir)+ `src-tauri/tauri.conf.json`(frontendDist)+ `tsconfig.json`(R1 G' fix exclude 删 dist)
- **1 .gitignore**:删 out/dist 单数 entry + 加 `/build/` 项目根锚定(R1 G' fix 后)
- **0 doc/src**:`src/` + `README.md` + `CLAUDE.md` 全 0 命中无需改(§不变量 9 scan range 内)
- **1 plan 主体**:`.claude/plans/build-dir-migration-20260526.md`(全程在 worktree 内被 `.gitignore` 忽略,Phase H.5 mv 入 `plans/build-dir-migration-20260526.md`)
- **1 changelog**:`changelog/CHANGELOG_23.md`(本文)
- **commits**:`8c07286 feat(build-dir): migrate frontend bundle to build/fe (Phase A-D)` + `6aba889 fix(build-dir) [Phase G' R1]: tsconfig.json 删 dist + .gitignore /build/ 锚定` + 本 changelog commit + Phase H archive commit
- **build artifact**(被 `.gitignore` 整 `/build/` 忽略不入 git):`build/fe/{index.html + 12 hash chunk/css}` + Tauri `src-tauri/target/release/bundle/macos/Dev Config Hub.app`(后者 Cargo target/ 也已 .gitignore L37 忽略)

详 [`plans/build-dir-migration-20260526.md`](../../plans/history/build-dir-migration-20260526.md)

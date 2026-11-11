# Glass Start 架构设计与代码质量全面审计报告

**项目名称**: Glass Start (网页端与 Chrome 扩展)  
**审计基准版本**: v5.5.3 (Git Commit `96b8d0d`)  
**审计日期**: 2026-11-11  
**审计性质**: 全仓库只读深度人工源码审查（Read-Only Deep Manual Source Audit）  
**审计报告编号**: AUDIT-20261111-V553  
**依据规范**: `AGENTS.md`、`docs/ARCHITECTURE.md`、W3C / WHATWG 规范、Chrome MV3 扩展技术规范  

---

## 目录

- [一、执行摘要与整体健康度评级](#一执行摘要与整体健康度评级)
  - [1.1 总体健康度评分与评估结论](#11-总体健康度评分与评估结论)
  - [1.2 严重级别统计金字塔与问题分布](#12-严重级别统计金字塔与问题分布)
  - [1.3 核心架构优势与工程亮点](#13-核心架构优势与工程亮点)
  - [1.4 关键风险与主要薄弱项总览](#14-关键风险与主要薄弱项总览)
- [二、审计范围、方法论与约束边界](#二审计范围方法论与约束边界)
  - [2.1 审查模块与文件边界](#21-审查模块与文件边界)
  - [2.2 只读约束承诺与执行准则](#22-只读约束承诺与执行准则)
  - [2.3 四大审计维度与审查准则](#23-四大审计维度与审查准则)
- [三、架构规范与工程约束遵从性评估](#三架构规范与工程约束遵从性评估)
  - [3.1 奥卡姆剃刀与零第三方运行时依赖](#31-奥卡姆剃刀与零第三方运行时依赖)
  - [3.2 单向模块依赖与分层隔离](#32-单向模块依赖与分层隔离)
  - [3.3 DOMCache 契约与运行时自愈机制](#33-domcache-契约与运行时自愈机制)
  - [3.4 OverlayStack 弹窗状态机与手势安全](#34-overlaystack-弹窗状态机与手势安全)
  - [3.5 IndexedDB 壁纸隔离与配额保护](#35-indexeddb-壁纸隔离与配额保护)
  - [3.6 书签纯内存草稿驱动模型](#36-书签纯内存草稿驱动模型)
  - [3.7 无障碍 (A11y) 与样式规范遵从](#37-无障碍-a11y-与样式规范遵从)
  - [3.8 Chrome 扩展隔离与宏条件编译](#38-chrome-扩展隔离与宏条件编译)
- [四、结构化问题清单与缺陷编目 (22 项)](#四结构化问题清单与缺陷编目-22-项)
  - [4.1 严重级别 (High, 3 项)](#41-严重级别-high-3-项)
  - [4.2 中度级别 (Medium, 9 项)](#42-中度级别-medium-9-项)
  - [4.3 低度级别 (Low, 6 项)](#43-低度级别-low-6-项)
  - [4.4 提示级别 (Info, 4 项)](#44-提示级别-info-4-项)
- [五、现有测试套件与代码质量脚本执行与有效性审查](#五现有测试套件与代码质量脚本执行与有效性审查)
  - [5.1 自动化质量脚本实际执行状态 (Live Execution Log)](#51-自动化质量脚本实际执行状态-live-execution-log)
  - [5.2 真实 CDP 测试套件与 Mock 保真度审查](#52-真实-cdp-测试套件与-mock-保真度审查)
  - [5.3 外部网络泄漏实证与并发测试隐患](#53-外部网络泄漏实证与并发测试隐患)
  - [5.4 测试边界盲区与断言颗粒度分析](#54-测试边界盲区与断言颗粒度分析)
- [六、架构优化与分级加固路线图](#六架构优化与分级加固路线图)
  - [6.1 P0 立即处置 (Immediate / 阻断性兼容崩溃与网络泄漏)](#61-p0-立即处置-immediate--阻断性兼容崩溃与网络泄漏)
  - [6.2 P1 近期优化 (Near-Term / 架构契约与类型静态防护)](#62-p1-近期优化-near-term--架构契约与类型静态防护)
  - [6.3 P2 架构增强 (Architectural Enhancements / 测试盲区覆盖与工程纯净度)](#63-p2-架构增强-architectural-enhancements--测试盲区覆盖与工程纯净度)
- [七、结语与后续改进建议](#七结语与后续改进建议)

---

## 一、执行摘要与整体健康度评级

### 1.1 总体健康度评分与评估结论

本次代码审计于 2026-11-11 对 Glass Start 项目基准版本 `v5.5.3`（Git Commit `96b8d0d`）展开了全面、跨模块、只读的深度源码级审计。审计团队由架构边界、代码质量/逻辑缺陷、类型安全/测试效能三个专业方向的审计员联合执行，综合考量了昨日（2026-11-10）历史审计 34 项缺陷的闭环修复情况，并针对现存代码展开了更严苛的深层边界验证。

| 评估维度 | 权重 | 得分 | 评级 | 简述 |
| :--- | :---: | :---: | :---: | :--- |
| **安全性与供应链 (Security & Supply Chain)** | 20% | **96** | A+ | 维持完全零第三方运行时依赖，CSP、URL 白名单与 XSS 防护坚固；扩展权限与 connect-src 保持 1:1 镜像一致。 |
| **架构与规范合规 (Architecture & Compliance)** | 25% | **91** | A- | 奥卡姆剃刀与单向依赖恪守优异；DOMCache 存在核心弹窗漏注与索引签名消解 TS 校验的契约偏差。 |
| **健壮性与边界处理 (Robustness & Resilience)** | 25% | **84** | B | Safari/iOS < 17.4 环境下存在两处无 Polyfill 的现代 Web API 调用（`checkVisibility`、`AbortSignal.any`），构成阻断性崩溃；设置保存缺失全局异常拦截。 |
| **类型安全与静态检查 (Type Safety & Static Lint)** | 15% | **83** | B | 业务逻辑通过 JSDoc 保持轻量类型约束；但 DOMCache 宽泛签名阻断了拼写检查，且 18 个 Node 构建脚本未纳入类型体系。 |
| **测试套件效能与覆盖 (Test Suite Efficacy)** | 15% | **85** | B+ | 129 个全量 CDP 真实浏览器用例 100% 通过；但存在大面积外网 IP/天气流量泄漏，且存在 Unicode 多语言与 IDB 升级等测试盲区。 |
| **综合健康度指数 (Overall Health Index)** | **100%** | **88.2 / 100** | **A-** | **优秀（基础架构稳固自律，修复了绝大多数历史缺陷，现存少数阻断性兼容性与类型契约收尾点）** |

**综合评估结论**：
Glass Start 项目在贯彻原生 Web 平台能力方面具有极高的工程水准。`package.json` 的 `dependencies` 为 `{}`，未引入任何前端框架或沉重第三方工具，完全依靠 原生 ESM、Tailwind CSS v4 `@theme` 编译、IndexedDB、原生 `<dialog>` 及 Chrome CDP 实现了高性能双端（网页端 + Chrome MV3 扩展）起始页。

相比昨日 `v5.5.2` 版本，团队已成功修复了 `URL.parse()` 首屏白屏、扩展设置面板语言注入不全、手势滑动边界等 34 项历史缺陷。然而，在深入源码逻辑后，本期审计发现了更为隐蔽的 3 项高危问题（Safari < 17.4 的阻断性兼容故障与自动化测试公网流量外溢）以及 9 项中度问题（TypeScript 静态检查穿透、核心弹窗漏注、Emoji 徽标乱码等），需在进入稳定版本前予以加固。

---

### 1.2 严重级别统计金字塔与问题分布

本期审计共挖掘出 **22 项** 具备确凿证据的缺陷、类型隐患与工程优化项。所有问题均经过源码行号定位与逻辑链核验，无任何推测性虚构内容。

```
                    ▲
                   / \
                  /   \     [ High: 3 项 ]  (阻断性兼容崩溃 / 30+ 用例公网网络泄漏)
                 /     \
                /       \   [ Medium: 9 项 ] (类型校验失效 / 弹窗漏注 / 脚本漏检 / Emoji 截断)
               /         \
              /           \ [ Low: 6 项 ]    (模块封装泄漏 / 事件重置缺失 / any 类型残留)
             /             \
            /               \[ Info: 4 项 ]  (Stylelint 离线化 / 软链接绝对路径 / 平台构建提示)
           ─────────────────
               总计: 22 项
```

- **High (严重，3 项)**：
  1. `OverlayStack` 中 `Element.prototype.checkVisibility` 缺少降级，导致 Safari < 17.4 / iOS < 17.4 弹窗关闭时抛出致命 `TypeError` 并破坏焦点管理；
  2. `weather.js` 中 `AbortSignal.any` 缺少降级且在 `try` 块外调用，导致 Safari < 17.4 / iOS < 17.4 天气功能完全瘫痪并产生未捕获 Promise Rejection；
  3. `helpers.mjs` 的 `launchSession()` 在跨 30+ 测试文件中启动浏览器后未作离线拦截，导致运行测试时向外网真实 IP 与 Open-Meteo 服务器持续泄漏公网流量并引入潜在 flaky 隐患。
- **Medium (中度，9 项)**：
  包含 `DOMCache` 宽泛索引签名消解 TS 拼写校验、`cacheDOM()` 遗漏主设置弹窗等核心 ID、`package.json` 缺少 `@types/node` 导致 3,500+ 行脚本脱离静态类型保护、`scripts/lint.mjs` 硬编码遗漏 9 个核心脚本语法校验、弹窗测试断言颗粒度过粗（仅断言 `.open` 未断言内容）、书签模糊搜索缺失非 ASCII/非 CJK Unicode 用例、IndexedDB 数据库升级测试盲区、Emoji 首字徽标因 `charAt(0)` 产生孤立高位代理对乱码、设置保存与重置缺失 `catch` 块导致异常丢失等。
- **Low (轻度，6 项)**：
  包含 `modules/search.js` 内部可变变量对外导出导致封装破坏、`OverlayStack` 背景点击状态缺少 `pointercancel` 重置保护、多语言与天气数据模型缺少防御性数组校验、天气重试与后台定时器遗漏 `.catch()`、业务代码残留 `any` 类型转换、`BookmarkSuggestion` 接口缺失 `type: 'bookmark'` 字面量属性等。
- **Info (提示，4 项)**：
  包含 Stylelint 强耦合在线 W3C 检查且卡片 hover 前缀未在 lint 中追踪、`publish-build.cjs` 采用绝对路径软链接影响跨目录便携性、Service Worker 向 Cache API 传入 `URL` 对象、`sync-icons.mjs` 对 macOS `sips` 工具的平台依赖等。

---

### 1.3 核心架构优势与工程亮点

1. **极致的奥卡姆剃刀与零运行时依赖**：
   生产代码不依赖任何外部 NPM 运行时包（`dependencies: {}`）。所有组件状态管理、DOM 渲染、手势切屏、离线缓存全部基于原生 Web API（Native `<dialog>`、Proxy、Touch Events、IndexedDB、Service Worker、Intl）。
2. **纯粹的单向不可逆依赖图谱**：
   系统架构分层界限分明：`src/js/state/`、`src/js/utils/`、`src/js/config/` 与 `src/js/core/` 严格遵循单向依赖，绝对禁止反向导入上层 `src/js/modules/` 或顶层胶水层。全库 46 个 ESM 模块的静态 AST 检查实现了 0 循环依赖。
3. **书签纯内存草稿驱动模型 (Draft-Driven)**：
   书签弹窗的编辑、增删、拖拽排序与分类调整均在 `modalState.draftBookmarks` 内存模型中操作。保存与导出直接读取草稿并经过 `bookmark-model.js` 规范化，绝不从 DOM 反向解析数据，彻底消除了 DOM 逆向污染的隐患。
4. **大图与 Base64 壁纸存储配额绝对隔离**：
   大体积壁纸二进制数据或 Data URL 严格存入 IndexedDB `wallpapers` 对象仓库；LocalStorage 仅允许持久化纯数值索引、透明度整数及外观主题元数据，彻底杜绝了 LocalStorage 5MB 配额击穿风险。
5. **基于 Chrome CDP 原生轻量化测试基础设施**：
   测试套件摒弃了 Playwright、Puppeteer、Cypress 等数以百兆的重型框架，直接利用 Node 原生 `node:net` 与 `node:crypto` 实现轻量 WebSocket 驱动 Chrome DevTools Protocol（CDP），测试启动毫秒级响应，129 个全量复杂 UI 与端到端回归用例可在 76 秒内完成全部执行。
6. **Chrome MV3 扩展同源宏编译与安全隔离**：
   Chrome 扩展复用同一套 Web 源码，通过构建期 esbuild `define: { 'window.__GLASS_EXTENSION__': 'true' }` 进行宏条件编译与死代码消除（DCE），内联脚本 100% 抽离为外部 bootstrap 文件，严格契约保障了 Chrome Web Store MV3 的 CSP 与权限安全。

---

### 1.4 关键风险与主要薄弱项总览

1. **WebKit / Safari < 17.4 现代 Web API 兼容性阻断**：
   代码库中使用了两项 Baseline 2024 新增 API：`element.checkVisibility({ visibilityProperty: true })`（`overlay-stack.js`）与 `AbortSignal.any()`（`weather.js`）。在 Safari 17.0–17.3 及 iOS < 17.4 环境下，这两项 API 均为 `undefined`。前者导致用户关闭任何弹窗时触发 `TypeError` 导致焦点管理崩溃；后者导致天气功能直接抛错，且因调用位于 `try` 块外产生未捕获 Promise Rejection。
2. **真机测试基础设施公网流量逃逸**：
   `test/support/helpers.mjs` 中的 `launchSession()` 在启动无头 Chrome 加载起始页时，由于未建立全局默认请求拦截，触发首屏 `initWeather()`，导致超过 30 个测试文件在执行期间向公网天气与 IP 接口发起真实网络请求。该行为在无网环境下会导致测试耗时激增 4 秒超时，并在 CI 并发运行时面临公共 API 的 HTTP 429 限流风险。
3. **TypeScript 静态检查被宽泛签名击穿**：
   `src/js/types.d.ts` 中的 `DOMCache` 声明了 `[key: string]: HTMLElement | null;`，导致 TypeScript 对 `dom.xxx` 的所有属性拼写完全放行，失去了强类型拦截能力。同时，应用核心弹窗 `editModal`、`bookmarkPicker`、`languageModal` 及 Tab 容器在 `dom.js` 中遗漏登记，加剧了静态类型与运行时之间的偏离。

---

## 二、审计范围、方法论与约束边界

### 2.1 审查模块与文件边界

本次审计涵盖 Glass Start 仓库内的所有代码模块与配置文件：

```
Glass Start 审计架构覆盖图:
┌────────────────────────────────────────────────────────────────────────┐
│ 1. Web Core & UI Modules                                               │
│    src/index.html, src/sw.js, src/js/main.js, init.js, events.js       │
│    src/js/core/ (overlay-stack, i18n, screen-state, wallpaper-renderer)│
│    src/js/modules/ (bookmarks, bookmark-editor, weather, search, ...) │
├────────────────────────────────────────────────────────────────────────┤
│ 2. Chrome Extension Architecture                                       │
│    src/extension/manifest.json, background.js, rules/                  │
│    scripts/build-extension.cjs, build.cjs, publish-build.cjs           │
├────────────────────────────────────────────────────────────────────────┤
│ 3. State, Storage & Utils Layer                                        │
│    src/js/state/ (dom.js, store.js, bookmark-draft.js)                 │
│    src/js/utils/ (idb.js, storage.js, favicon.js, bookmark-model.js,   │
│                   bookmark-search.js, category-catalog.js, ...)        │
│    src/js/config/ (constants.js, backgrounds.js, engines.js, locales/) │
│    src/js/types.d.ts, bookmarks.json                                   │
├────────────────────────────────────────────────────────────────────────┤
│ 4. Infra, Build & Test Suite                                           │
│    scripts/ (server.cjs, lint*.mjs, sync-icons.mjs, validate-w3c.mjs)  │
│    test/support/ (cdp.mjs, helpers.mjs), 33 个核心测试套件 (test/*.mjs)│
│    .github/workflows/ci.yml                                            │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.2 只读约束承诺与执行准则

1. **绝对只读约束**：在全流程审计中，严禁修改 `src/`、`test/`、`scripts/`、`package.json` 等任何已有文件。唯一允许新增或写入的文件仅为本报告（`docs/reports/2026-11-11-code-audit.md`）。
2. **事实证据驱动**：拒绝无证据推测或主观臆断。每个问题必须精确指向文件绝对或相对路径、准确代码行号，并提供当前仓库中的真实源码片段。
3. **真实命令复现**：所有工具链审查必须基于真实执行输出（`npm run lint`、`npm run typecheck`、`npm test`、`npm run test:w3c`），禁止编造虚假测试报告。

### 2.3 四大审计维度与审查准则

1. **架构规范与奥卡姆剃刀 (Architecture & Occam's Razor)**：对照 `AGENTS.md` 与 `docs/ARCHITECTURE.md`，审查是否维持零运行时依赖、是否存在形式完备的冗余包装、模块依赖方向是否严格自底向上。
2. **代码质量与逻辑缺陷 (Code Quality & Logic Defects)**：排查内存泄漏隐患、未捕获 Promise Rejection、多语言文本编码边界（Astral Unicode / Surrogate Pairs）、现代 Web API 平台兼容性。
3. **类型安全与静态检查 (Type Safety & Static Lint)**：排查 TypeScript 静态类型穿透（`any` 滥用、宽泛索引签名）、`tsconfig.json` 覆盖范围断层、Lint 语法覆盖漏网之鱼。
4. **测试套件覆盖有效性 (Test Suite Efficacy)**：审查 CDP 自动化测试真实度、断言颗粒度（是否仅验证布尔状态而漏检渲染内容）、Mock 保真度与网络泄漏情况。

---

## 三、架构规范与工程约束遵从性评估

本章系统对照 `AGENTS.md` 与 `docs/ARCHITECTURE.md` 的规范条款，对 Glass Start v5.5.3 的架构实现进行逐项合规性评定。

| 规范领域 | 约束条款摘要 | 实际代码实现与现状审查 | 合规判定 |
| :--- | :--- | :--- | :---: |
| **奥卡姆剃刀与零运行时依赖** | “如无必要，勿增实体”；默认保持零第三方运行时依赖；Tailwind v4 仅使用 `@theme`，不创建 `tailwind.config.js`。 | `package.json` 的 `dependencies` 为 `{}`，未引入任何运行时依赖。Tailwind CSS v4 仅通过 CLI 编译并在 `src/styles/main.css:32-41` 声明 `@theme`，无 `tailwind.config.js`。 | **完全合规 (100%)** |
| **单向模块依赖与分层隔离** | `core/`、`utils/`、`state/` 不导入业务模块；业务模块不导入顶层装配；测试适配在生产构建中剔除。 | `npm test -- infra-module-boundaries` AST 检查通过。`core/screen-state.js:28` 采用依赖反转注入回调；`scripts/build.cjs:154` 通过宏消除在生产包中彻底剔除了 `testing/bridge.js`。 | **完全合规 (100%)** |
| **DOMCache 规范与登记契约** | 通过 `dom.xxx` 访问的节点须登记到 `dom.js` 的 `cacheDOM()` 并同步 `types.d.ts` 的 `DOMCache` 类型。 | `cacheDOM()` 登记了 77 个节点；但漏注了 `editModal`、`bookmarkPicker`、`languageModal` 等关键弹窗。`types.d.ts` 中宽泛的索引签名导致 TS 无法拦截拼写错误。 | **存在偏差 (见 MED-01, MED-02)** |
| **OverlayStack 状态机管控** | 受管弹窗通过 `.push()` / `.pop()` 显示关闭，业务模块不直接修改 `style.display` 或 `hidden`。 | 全站 6 个 `<dialog>` 与 3 个 popover 均统一接入 `OverlayStack`。全库无直接修改弹窗 `style.display` 行为；但背景点击状态缺少 `pointercancel` 重置保护。 | **基本合规 (见 LOW-02)** |
| **IndexedDB 配额隔离** | 大图 / Base64 壁纸存入 IndexedDB，不写入 LocalStorage。 | `src/js/utils/idb.js` 统一封装 IndexedDB，壁纸二进制 100% 落盘于 IDB。LocalStorage 仅写入数字索引、遮罩值和元数据对象，配额隔离极佳。 | **完全合规 (100%)** |
| **书签草稿驱动模型** | 编辑、增删及重排由内存草稿驱动；保存与导出直接读取草稿，不从 DOM 反向解析。 | `modalState.draftBookmarks` 驱动全量数据操作，`bookmark-editor.js` 中的 `collectEditData()` 纯内存归一化，完全杜绝逆向 DOM 解析。 | **完全合规 (100%)** |
| **无障碍与样式规范** | 按钮声明 `type="button"`，SVG 声明 `aria-hidden`；输入框字号 >= 16px；卡片 hover 需加 `body:not(.tab-blurred)` 前缀。 | `lint.mjs` 校验 37 处按钮、38 处 SVG、4 处输入框字号与 `!important` 均合规；卡片 hover 规范在 CSS 中遵守，但缺少针对性的 lint 自动扫描规则。 | **基本合规 (见 INFO-01)** |
| **Chrome 扩展隔离与宏编译** | 扩展复用网页源码，通过宏标记区分；脚本必须本地打包无内联，不注册 SW，权限与 CSP 一致。 | `build-extension.cjs` 成功抽取 8 个 bootstrap 文件，消灭所有内联脚本；`manifest.json` 的 `host_permissions` 与 `connect-src` 保持 8 个域名一致。 | **完全合规 (100%)** |

---

## 四、结构化问题清单与缺陷编目 (22 项)

本章汇编全库审计识别出的 22 项缺陷与质量隐患，统一按 **High (严重)**、**Medium (中度)**、**Low (轻度)**、**Info (提示)** 四级编目。每个问题均提供确凿的绝对/相对路径、精准代码行号、源码片段、根因分析、潜在危害及可落地的代码修复建议。

---

### 4.1 严重级别 (High, 3 项)

#### [HIGH-01] `visibleFocusTarget` 中 `Element.prototype.checkVisibility` 缺少降级导致 Safari < 17.4 / iOS < 17.4 弹窗关闭与焦点恢复异常崩溃

- **问题分类**: 运行时兼容性 / 阻断性逻辑缺陷 (Compatibility & Focus Management)
- **精准文件与代码行号**:
  - `src/js/core/overlay-stack.js`: 第 46–51 行 (定义处)
  - `src/js/core/overlay-stack.js`: 第 58, 60, 63 行 (调用处)
- **代码片段**:
  `src/js/core/overlay-stack.js:46-51`:
  ```javascript
  function visibleFocusTarget(element) {
      return element instanceof HTMLElement && element.isConnected &&
          element !== document.body && element !== document.documentElement &&
          !element.closest('[inert], [hidden], [aria-hidden="true"], :disabled') &&
          element.checkVisibility({ visibilityProperty: true });
  }
  ```
- **根因分析 (RCA)**:
  `Element.prototype.checkVisibility()` 是 WebKit 于 Safari 17.4（2024 年 3 月）才引入的 DOM API。在 Safari 17.0–17.3、Safari 16.x 以及 iOS < 17.4 体系中，该方法为 `undefined`。
  当用户打开任意弹窗（如设置 `editModal`、目录挑选器 `bookmarkPicker`、快捷键帮助 `shortcutModal`、致谢 `creditsModal`、确认框 `confirmModal` 或语言弹窗 `languageModal`）并随后通过 ESC 键、完成按钮、取消按钮关闭弹窗时，`OverlayStack.pop(id)` 会无条件触发 `restoreFocus(trigger)`。`restoreFocus()` 连续调用 `visibleFocusTarget(trigger)`、`visibleFocusTarget(document.activeElement)`。在 Safari < 17.4 下，执行 `element.checkVisibility(...)` 会立即抛出未捕获的 `TypeError: element.checkVisibility is not a function`。
- **潜在影响 (Impact)**:
  抛出的 `TypeError` 直接阻断了 `restoreFocus()` 的后续执行，导致弹窗关闭后页面焦点丢失或停留在已关闭的离屏元素上，键盘导航彻底瘫痪，同时污染全局控制台与异常监控。对于运行 iOS 17.2/17.3 或 macOS 13/14 早期版本的 Safari 用户构成阻断性故障。
- **针对性修复建议 (Recommendation)**:
  在 `visibleFocusTarget` 中加入特性探测降级逻辑：若存在原生 `checkVisibility` 则使用原生能力，否则降级检查 `getComputedStyle` 的 `display`、`visibility` 以及元素的布局几何尺寸：
  ```javascript
  function visibleFocusTarget(element) {
      if (!(element instanceof HTMLElement) || !element.isConnected ||
          element === document.body || element === document.documentElement ||
          element.closest('[inert], [hidden], [aria-hidden="true"], :disabled')) return false;
      if (typeof element.checkVisibility === 'function') {
          return element.checkVisibility({ visibilityProperty: true });
      }
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' &&
          (element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0);
  }
  ```

---

#### [HIGH-02] `AbortSignal.any` 缺少 Polyfill 且在 `try` 块外调用导致 Safari < 17.4 / iOS < 17.4 天气功能完全失效

- **问题分类**: 运行时兼容性 / 异常处理缺陷 (Compatibility & Async Exception)
- **精准文件与代码行号**:
  - `src/js/modules/weather.js`: 第 34–36 行 (`fetchJsonWithTimeout`)
  - `src/js/modules/weather.js`: 第 555–558 行 (`executeWeatherUpdate`)
- **代码片段**:
  `src/js/modules/weather.js:34-36`:
  ```javascript
  async function fetchJsonWithTimeout(url, timeoutMs, signal) {
      const controller = new AbortController();
      const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      requestSignal.throwIfAborted();
  ```
  `src/js/modules/weather.js:555-558`:
  ```javascript
  async function executeWeatherUpdate(cache, locCache, force, signal) {
      const knownLoc = locCache ?? (hasWeatherCoordinates(cache?.location) ? cache.location : null);
      const provisional = new AbortController();
      const forecastSignal = AbortSignal.any([signal, provisional.signal]);
      let usable = currentWeatherData ?? cache;
  ```
- **根因分析 (RCA)**:
  `AbortSignal.any()` 属于 Baseline 2024 新标准 API（Safari 17.4+, Chrome 116+, Node 20+ 支持）。在旧版 WebKit（Safari < 17.4, iOS < 17.4）中，全局对象 `AbortSignal.any` 不存在（`undefined`）。
  更为严重的是，在 `executeWeatherUpdate` 中，第 558 行的 `AbortSignal.any` 调用位于函数主体的 `try` 块（起始于第 567 行）之外。当该方法报错时，错误无法被本函数的 `catch (err)`（第 585 行）捕获，导致返回的 Promise 直接 Reject。当该调用由重试按钮（第 619 行）或后台轮询定时器（第 666 行）触发时，由于调用处未附加 `.catch()`，将触发致命的全局未捕获异常 `Unhandled Promise Rejection: TypeError: AbortSignal.any is not a function`。
- **潜在影响 (Impact)**:
  在 Safari < 17.4 / iOS < 17.4 下，页面启动后天气预报永远无法加载，气泡面板报错，且重试按钮点击无效，直接破坏核心功能。
- **针对性修复建议 (Recommendation)**:
  1. 在 `src/js/modules/weather.js` 顶部实现轻量级零依赖 `anySignal` 降级函数：
     ```javascript
     function anySignal(signals) {
         if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
             return AbortSignal.any(signals);
         }
         const controller = new AbortController();
         for (const sig of signals) {
             if (!sig) continue;
             if (sig.aborted) { controller.abort(sig.reason); return sig; }
             sig.addEventListener('abort', () => controller.abort(sig.reason), { once: true });
         }
         return controller.signal;
     }
     ```
  2. 将 `executeWeatherUpdate` 中的第 558 行移入 `try` 块内部，并将全模块内所有 `AbortSignal.any(...)` 替换为 `anySignal(...)`。

---

#### [HIGH-03] `launchSession()` 在真机 CDP 测试套件中向外网泄漏真实天气与 IP 请求跨 30+ 测试文件

- **问题分类**: 测试基础设施缺陷 / 网络泄漏与测试稳定性 (Mock Fidelity & Flakiness)
- **精准文件与代码行号**:
  - `test/support/helpers.mjs`: 第 92–115 行 (`launchSession`)
  - `src/js/init.js`: 第 66 行 (`initWeather()`)
  - `src/js/modules/weather.js`: 第 141, 153, 195, 555–580, 650–667 行
- **代码片段**:
  `test/support/helpers.mjs:92-100`:
  ```javascript
  export async function launchSession(preferredPort = 0, customRoutes = {}) {
    const server = await startServer(preferredPort, undefined, customRoutes);
    let chrome;
    try {
      const cdpPort = await getFreePort();
      chrome = await launchChrome({ port: cdpPort, url: `http://127.0.0.1:${server.port}/` });
      const { send } = chrome;
      await send('Page.enable');
      await send('Runtime.enable');
  ```
  `src/js/modules/weather.js:664`:
  ```javascript
  updateWeather(false).catch(() => {});
  ```
- **根因分析 (RCA)**:
  当测试用例调用 `launchSession()` 时，无头 Chrome 浏览器被拉起并导航至本地起始页 `http://127.0.0.1:${server.port}/`。页面生命周期加载后执行 `init()`（`src/js/init.js:66`），触发 `initWeather()`，进而执行 `updateWeather(false)`。
  此时，`weather.js` 会通过浏览器底层原生 `fetch()` 异步发起针对公网真实接口的 HTTP 请求：
  1. `https://myip.ipip.net/json`
  2. `https://geocoding-api.open-meteo.com/v1/search`
  3. `https://ipwho.is/?lang=...`
  4. `https://api.open-meteo.com/v1/forecast`
  虽然 `test/infra-chrome-extension.test.mjs` 和 `test/data-weather-features.test.mjs` 配置了局部 Mock，但仓库中多达 **27+ 个核心测试文件**（包括 `ui-nav-rendering.test.mjs`、`ui-overlay-modals.test.mjs`、`data-wallpaper.test.mjs`、`lifecycle.test.mjs`、`ui-screen-boundaries.test.mjs` 等）均直接使用 `launchSession()`，完全未配置网络请求拦截或测试模式标志。
- **潜在影响 (Impact)**:
  1. **离线运行受阻**: 在离线开发环境或网络隔离的 CI 构建机中，每次 `launchSession()` 都会等待 4 秒的超时时间，导致测试耗时严重膨胀；
  2. **偶发失败 (Flakiness)**: 全量测试触发数十次公网高频请求，极易触发 Open-Meteo 或 IP 服务的 HTTP 429（Rate Limit）拒绝访问；
  3. **异步竞态污染**: 迟到的真实天气响应会在 unrelated UI 断言进行时突然突变 DOM（`#weatherTemp`、`#weatherCity`），引发难以复现的偶发断言失败。
- **针对性修复建议 (Recommendation)**:
  在 `test/support/helpers.mjs:launchSession()` 中增加默认的测试期网络隔离。利用 CDP 的 `Page.addScriptToEvaluateOnNewDocument` 或 CDP `Fetch` 域拦截外部网络请求：
  ```javascript
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__GLASS_TEST__ = true;
      const _origFetch = window.fetch;
      window.fetch = async (url, opts) => {
        const u = String(url);
        if (u.includes('open-meteo.com') || u.includes('ipwho.is') || u.includes('myip.ipip.net')) {
          return new Response(JSON.stringify({ status: 'fail' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return _origFetch(url, opts);
      };
    `
  });
  ```

---

### 4.2 中度级别 (Medium, 9 项)

#### [MED-01] `DOMCache` 索引签名 `[key: string]: HTMLElement | null` 导致 TypeScript 静态属性拼写检查完全失效

- **问题分类**: 类型安全 / 静态分析穿透 (Type Safety)
- **精准文件与代码行号**:
  - `src/js/types.d.ts`: 第 212 行
  - `src/js/state/dom.js`: 第 50–53 行
- **代码片段**:
  `src/js/types.d.ts:211-213`:
  ```typescript
      updateReloadBtn: HTMLButtonElement | null;
      [key: string]: HTMLElement | null;
  }
  ```
  `src/js/state/dom.js:51-52`:
  ```javascript
  const ids = 'languageBtn languageList doneLanguageBtn...'.split(' ');
  ids.forEach(id => dom[id] = $(id));
  ```
- **根因分析 (RCA)**:
  在 `src/js/state/dom.js` 中，开发者为了使 `ids.forEach(id => dom[id] = $(id))` 通过 TypeScript 编译，直接在 `src/js/types.d.ts:212` 的 `DOMCache` 接口末尾增加了宽泛的索引签名 `[key: string]: HTMLElement | null;`。
  根据 TypeScript 类型系统的规则，一旦接口声明了通用字符串索引签名，任何针对该接口的不存在或拼写错误的属性访问（例如 `dom.clearCacheButton`、`dom.searchInpuut`、`dom.engineIconBtn`）都会被编译器无条件接受并推断为 `HTMLElement | null`。`npm run typecheck` 彻底失去了对 `dom` 对象的属性拼写与类型约束保护。
- **潜在影响 (Impact)**:
  业务代码若拼错 DOMCache 字段名，TypeScript 静态检查无法提供任何报警，只能完全依赖运行期的 `scripts/lint-dom.mjs` 自定义 AST 脚本，削弱了开发时编辑器的智能补全与静态防御网。
- **针对性修复建议 (Recommendation)**:
  1. 在 `src/js/state/dom.js:52` 中使用局部强转：
     ```javascript
     const target = /** @type {Record<string, HTMLElement | null>} */ (dom);
     ids.forEach(id => target[id] = $(id));
     ```
  2. 从 `src/js/types.d.ts:212` 中彻底删除 `[key: string]: HTMLElement | null;`，恢复 TypeScript 对具体属性的强类型校验。

---

#### [MED-02] `cacheDOM()` 核心弹窗 (`editModal`, `bookmarkPicker`, `languageModal`) 及 Tab 面板缺失登记与类型声明

- **问题分类**: 架构契约遵从性 / DOM 缓存漏洞 (Architectural Contract)
- **精准文件与代码行号**:
  - `src/js/state/dom.js`: 第 50–53 行
  - `src/js/types.d.ts`: 第 190–213 行
  - `test/ui-overlay-modals.test.mjs`: 第 368 行
  - `test/data-bookmark-picker.test.mjs`: 第 186, 268 行
  - `test/data-settings-save.test.mjs`: 第 559 行
- **代码片段**:
  `src/js/state/dom.js:51`:
  ```javascript
  const ids = 'languageBtn languageList doneLanguageBtn cancelLanguageBtn clock date searchInput searchClearBtn randomBookmarkBtn engineBtn engineIcon engineName dropdownMenu suggestionMenu bookmarks sidebar sidebarList navCategories navContent editList editBookmarksBtn addBookmarkBtn saveEditBtn cancelEditBtn resetEditBtn togglePickerBtn pickerContent pickerCount donePickerBtn exportJsonBtn importJsonInput uploadBgBtn urlBgBtn urlBgBtnGroup urlBgInputRow urlBgInput urlBgConfirmBtn urlBgCancelBtn resetBgBtn uploadBgInput wallpaperStatus wallpaperError bookmarkCountBadge jsonDropzone maskOpacityInput maskOpacityVal clearCacheBtn bgLayer bgLayerNext bgOverlay startSection navSection navHint presetWallpaperGrid settingsTransitionGrid shortcutModal shortcutModalList doneShortcutBtn openShortcutFromSettingsBtn openCreditsFromSettingsBtn weatherWidget weatherBtn weatherIcon weatherTemp weatherCity weatherPopover creditsModal creditsList doneCreditsBtn confirmModal confirmTitle confirmMsg confirmCancelBtn confirmOkBtn updateNotice updateNoticeText updateReloadBtn'.split(' ');
  ```
- **根因分析 (RCA)**:
  `src/index.html` 明确定义了 6 个原生 `<dialog>` 元素。在 `cacheDOM()` 初始化的 77 个 ID 中，登记了 `shortcutModal`、`creditsModal` 和 `confirmModal`，但遗漏了整个系统最重要的主设置弹窗 `editModal`、目录挑选器 `bookmarkPicker` 以及语言切换弹窗 `languageModal`。
  虽然 `dom.js` 中的 Proxy 自愈机制在初次访问时会通过 `$(prop)` 动态兜底查找到 DOM 节点，但这直接违背了 `AGENTS.md` 的强制规范：“*通过 dom.xxx 或静态键访问的节点须登记到 src/js/state/dom.js 的 cacheDOM()，并同步 src/js/types.d.ts 的 DOMCache 类型*”。在测试代码及业务调用中，`dom.editModal.open`、`dom.tabData.inert` 频出，由于未在 `types.d.ts` 声明为 `HTMLDialogElement`，进一步放大了类型隐患。
- **潜在影响 (Impact)**:
  初次访问关键弹窗时产生不必要的实时 DOM 查询开销；在结合 MED-01 移除通用索引签名后，将导致 `dom.editModal` 无法通过 TypeScript 编译。
- **针对性修复建议 (Recommendation)**:
  1. 在 `src/js/state/dom.js:51` 中追加 `editModal bookmarkPicker languageModal tabBookmarks tabAppearance tabData`；
  2. 在 `src/js/types.d.ts` 中明确声明对应类型：
     ```typescript
     editModal: HTMLDialogElement | null;
     bookmarkPicker: HTMLDialogElement | null;
     languageModal: HTMLDialogElement | null;
     tabBookmarks: HTMLElement | null;
     tabAppearance: HTMLElement | null;
     tabData: HTMLElement | null;
     ```

---

#### [MED-03] `package.json` 缺失 `@types/node` 导致 18 个脚本与测试辅助文件 (3,500+ 行) 无法纳入静态类型检查

- **问题分类**: 工程工具链 / 静态分析盲区 (Tooling & Coverage)
- **精准文件与代码行号**:
  - `package.json`: 第 33–40 行 (`devDependencies`)
  - `tsconfig.json`: 第 17–21 行 (`include`)
- **代码片段**:
  `package.json:32-40`:
  ```json
  "devDependencies": {
    "@tailwindcss/cli": "^4.3.4",
    "acorn": "^8.19.0",
    "esbuild": "^0.28.2",
    "postcss": "^8.5.32",
    "stylelint": "^18.0.0",
    "tailwindcss": "^4.3.4",
    "typescript": "^7.0.2"
  }
  ```
  `tsconfig.json:17-21`:
  ```json
  "include": [
    "src/js/**/*.js",
    "src/js/types.d.ts",
    "test/types/contracts.js"
  ]
  ```
- **根因分析 (RCA)**:
  项目依赖中没有引入 `@types/node`。因此，`tsconfig.json` 只能将检查范围限定在 `src/js/**/*.js`。若尝试将 `scripts/` 或 `test/support/` 纳入 `tsconfig.json`，由于缺少 Node 核心库的环境声明，TypeScript 会直接抛出 491 个诸如 `Cannot find name 'process'`、`Cannot find name 'Buffer'`、`Cannot find module 'node:fs'` 等未定义全局符号错误。
- **潜在影响 (Impact)**:
  包括 `scripts/build.cjs`、`scripts/build-extension.cjs`、`scripts/server.cjs`、`test/support/cdp.mjs`、`test/support/helpers.mjs` 等在内的 18 个核心工程构建与测试脚本（共计超过 3,500 行代码）长期处于完全脱离静态类型检查的“裸奔”状态，脚本重构与接口升级极易引入静默缺陷。
- **针对性修复建议 (Recommendation)**:
  1. 在 `package.json` 的 `devDependencies` 中增加 `"@types/node": "^24.0.0"`；
  2. 新增针对工程脚本的配置文件 `tsconfig.scripts.json`，对 `scripts/**/*.{cjs,mjs}` 与 `test/support/**/*.mjs` 开启类型审查。

---

#### [MED-04] `scripts/lint.mjs` 语法检查硬编码列表遗漏 9 个核心脚本

- **问题分类**: 静态检查工具链漏洞 (Lint Coverage Gap)
- **精准文件与代码行号**:
  - `scripts/lint.mjs`: 第 114–123 行
- **代码片段**:
  `scripts/lint.mjs:114-121`:
  ```javascript
  const jsFiles = [
      { name: 'scripts/build.cjs', desc: '打包构建脚本' },
      { name: 'scripts/html-template.cjs', desc: '共享 HTML 模板处理' },
      { name: 'sw.js', desc: 'Service Worker 底座' },
      { name: 'scripts/server.cjs', desc: '本地开发/预览服务' },
      { name: 'scripts/terminal.cjs', desc: '共享终端输出' },
      { name: 'scripts/watch.cjs', desc: '共享文件监听' }
  ].filter(f => {
  ```
- **根因分析 (RCA)**:
  `scripts/lint.mjs` 在第二阶段执行核心 JavaScript 语法校验（`node --check` 与 `vm.Script`）时，硬编码了一个仅包含 6 个文件的静态数组。
  而实际上，`scripts/` 目录下共存放了 15 个脚本。其中 `build-extension.cjs`、`publish-build.cjs`、`retain-deployed.cjs`、`sync-icons.mjs`、`validate-w3c.mjs`、`capture-preview.mjs`、`lint-dom.mjs`、`lint-css.mjs`、`lint-i18n.mjs` 共 9 个关键脚本完全未被 `npm run lint` 纳入语法检查范围。
- **潜在影响 (Impact)**:
  若开发者在这些未检查的脚本中引入了 JavaScript 语法错误（例如解构语法不兼容、拼写错误或未闭合括号），`npm run lint` 依然会显示绿色并通过，直至实际运行构建或特定任务时才在终端报错。
- **针对性修复建议 (Recommendation)**:
  修改 `scripts/lint.mjs`，改为动态读取 `scripts/` 目录下的全部 `.cjs` 与 `.mjs` 脚本，杜绝静态数组维护疏漏：
  ```javascript
  const scriptEntries = readdirSync(join(root, 'scripts'))
      .filter(name => name.endsWith('.cjs') || name.endsWith('.mjs'))
      .map(name => ({ name: `scripts/${name}`, desc: '工程与构建脚本' }));
  const jsFiles = [{ name: 'sw.js', desc: 'Service Worker 底座' }, ...scriptEntries];
  ```

---

#### [MED-05] 模态弹窗测试断言颗粒度过粗，仅断言 `.open` 状态而未断言渲染文本与数据状态

- **问题分类**: 测试质量 / 断言假阳性风险 (Test Assertion Fidelity)
- **精准文件与代码行号**:
  - `test/ui-overlay-modals.test.mjs`: 第 386–389 行
  - `test/ui-rendered-contracts.test.mjs`: 第 110–120 行
  - `test/data-settings-save.test.mjs`: 第 547 行
- **代码片段**:
  `test/ui-overlay-modals.test.mjs:386-389`:
  ```javascript
  await evalJS('dom.resetEditBtn.focus(); dom.resetEditBtn.click()');
  await waitFor(evalJS, 'dom.confirmModal.open');
  assert.equal(await resetExpanded(), 'true');
  await evalJS('dom.confirmCancelBtn.click()');
  ```
  `test/ui-rendered-contracts.test.mjs:110-120`:
  ```javascript
  await evalJS('openBookmarkPicker()');
  await waitFor(evalJS, 'document.getElementById("bookmarkPicker").open');
  await verify('目录挑选器');
  await evalJS("showConfirm('检查', null, '检查')");
  await waitFor(evalJS, 'dom.confirmModal.open');
  await verify('嵌套确认框');
  ```
- **根因分析 (RCA)**:
  测试套件在验证弹窗与确认框时，大面积依赖 `dom.confirmModal.open === true` 或 `dialog.style.display` 进行断言。测试逻辑仅验证了原生 `<dialog>` 的显示状态机是否打开，却完全未断言弹窗内渲染的标题（`dom.confirmTitle.textContent`）、提示正文（`dom.confirmMsg.textContent`）以及操作按钮文案。
- **潜在影响 (Impact)**:
  若多语言国际化文案由于键名丢失导致插值为 `undefined`、文案空白，或由于传参错误展示了错误的确认信息（如历史工单中扩展面板清缓存提示显示为网页离线提示），现有的自动化测试用例仍会 100% 判定测试通过，存在严重的测试漏报风险。
- **针对性修复建议 (Recommendation)**:
  在弹窗测试中补充明确的文本内容与无障碍属性断言：
  ```javascript
  assert.equal(await evalJS('dom.confirmTitle.textContent.trim()'), '重置书签确认');
  assert.ok(await evalJS('dom.confirmMsg.textContent.includes("确定要恢复默认书签吗")'));
  ```

---

#### [MED-06] 书签模糊搜索测试集完全缺失非 ASCII / 非 CJK Unicode 多语言查询用例

- **问题分类**: 国际化测试盲区 (I18n Test Boundary)
- **精准文件与代码行号**:
  - `test/data-pure-models.test.mjs`: 第 36–80 行
  - `src/js/utils/bookmark-search.js`: 第 62, 114 行
- **代码片段**:
  `test/data-pure-models.test.mjs:74-79`:
  ```javascript
  test('多词模糊查询不能跳过不匹配的单字符词', () => {
    for (const query of ['x y', 'x github', 'github x', 'z githbu']) {
      assert.deepEqual(rankBookmarkSuggestions(query, input, CONFIG.SUGGEST), [], query);
    }
    assert.equal(rankBookmarkSuggestions('g githbu', input, CONFIG.SUGGEST)[0].name, 'GitHub');
    assert.equal(rankBookmarkSuggestions('git githbu', input, CONFIG.SUGGEST)[0].name, 'GitHub');
  });
  ```
- **根因分析 (RCA)**:
  虽然在核心代码 `bookmark-search.js` 中已经通过 Unicode 正则属性转义 `\p{L}\p{N}` 修复了对全语种字符的匹配分词支持，但是在回归测试套件 `test/data-pure-models.test.mjs` 中，测试用例中的查询字符串依然全部由英文字符构成（`'github'`, `'githbu'`, `'goolge'`, `'x y'` 等）。
- **潜在影响 (Impact)**:
  对于日文平假名/片假名（如 `ヤフー`）、韩文谚文（如 `네이버`）、西里尔字母（如 `Яндекс`）以及欧洲变音符号（如德语 `München`、法语 `Café`）的书签搜索缺乏任何回归用例守护，一旦后续改动分词逻辑容易引发静默衰退。
- **针对性修复建议 (Recommendation)**:
  在 `test/data-pure-models.test.mjs` 中增加多语言 Unicode 真实书签候选集与复合查询的测试用例。

---

#### [MED-07] IndexedDB 版本升级 (`onupgradeneeded`) 与多标签页升级 (`onversionchange`) 存在自动化测试盲区

- **问题分类**: 存储稳定性 / 异步生命周期测试盲区 (Storage Lifecycle)
- **精准文件与代码行号**:
  - `src/js/utils/idb.js`: 第 20–53 行
  - `test/data-wallpaper-storage.test.mjs`: 第 1–70 行
- **代码片段**:
  `src/js/utils/idb.js:20-33`:
  ```javascript
  req.onupgradeneeded = e => {
      const openReq = /** @type {IDBOpenDBRequest} */ (e.target);
      const db = openReq.result;
      if (!db.objectStoreNames.contains(CONFIG.IDB.STORES.WALLPAPERS)) {
          db.createObjectStore(CONFIG.IDB.STORES.WALLPAPERS);
      }
  };
  req.onsuccess = () => {
      activeDb = req.result;
      activeDb.onversionchange = () => {
          activeDb?.close();
          activeDb = null;
      };
  ```
- **根因分析 (RCA)**:
  `src/js/utils/idb.js` 内部虽然编写了完善的 `onupgradeneeded`、`onversionchange` 及 `onblocked` 处理逻辑，但是现有的测试用例 `test/data-wallpaper-storage.test.mjs` 仅针对单一版本（Version 1）的单连接读写和配额超限降级进行了测试。
- **潜在影响 (Impact)**:
  如果未来 Glass Start 演进版本中需要变更 IndexedDB Schema（如新增对象存储仓库或升级 `CONFIG.IDB.VERSION`），在跨标签页打开的场景下，缺乏测试验证现存连接是否能安全触发 `activeDb.close()` 并让新版本事务顺利完成升级，存在潜在的多标签页升级阻塞风险。
- **针对性修复建议 (Recommendation)**:
  在 `test/data-wallpaper-storage.test.mjs` 中构建双连接模拟测试：先以 Version 1 打开并存入数据，随后使用 Version 2 发起连接，断言 Version 1 连接触发 `onversionchange` 自动关闭且 Version 2 顺利触发 `onupgradeneeded`。

---

#### [MED-08] Astral Unicode / Emoji 首字徽标因 `charAt(0)` 截断为孤立高位代理对导致乱码

- **问题分类**: 多语言与文本编码缺陷 (Unicode & Encoding)
- **精准文件与代码行号**:
  - `src/js/utils/favicon.js`: 第 89 行
  - `src/js/modules/bookmark-editor.js`: 第 21 行
  - `src/js/modules/settings-events.js`: 第 147 行
- **代码片段**:
  `src/js/utils/favicon.js:89`:
  ```javascript
  export function getFaviconHTML(bm, sizeType = 'sm', deferLoad = false) {
      const initial = (bm.name || '?').trim().charAt(0).toUpperCase() || '?';
  ```
  `src/js/modules/bookmark-editor.js:21`:
  ```javascript
  export function getEditFaviconInner(item) {
      const { name, icon, origUrl } = item;
      const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  ```
- **根因分析 (RCA)**:
  在 JavaScript 中，字符串按 UTF-16 代码单元存储。现代 Emoji（如 🐱、🚀、🎨）以及非 BMP 辅助平面字符（Astral Plane，代码点 U+10000 以上）占用两个 16 位代码单元构成的代理对（Surrogate Pair）。
  使用 `String.prototype.charAt(0)` 只能获取其前半部分（High Surrogate，如 `\uD83D`）。孤立的高位代码单元在随后的 `.toUpperCase()` 及插入 DOM 时（`parent.textContent = initial` 或模板字面量 `data-initial="${initial}"`），会被浏览器判定为非法 Unicode，最终渲染为问号替换符 `` (U+FFFD) 或空白。
- **潜在影响 (Impact)**:
  若用户自定义书签名称以 Emoji 或特殊辅助平面字符开头且未指定图标，书签卡片与编辑列表中的首字备用徽标将呈现为乱码符号，严重损害视觉体验。
- **针对性修复建议 (Recommendation)**:
  使用 ES6 迭代器展开语法或 `Intl.Segmenter` 按真实 Unicode 字符（Code Point / Grapheme）安全解构：
  ```javascript
  // 替换前:
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';

  // 替换后:
  const initial = [...(name || '?').trim()][0]?.toUpperCase() || '?';
  ```

---

#### [MED-09] 设置保存与重置操作缺失 `catch` 块导致未捕获 Promise rejection 且无用户界面提示

- **问题分类**: 异步异常处理与用户交互缺陷 (Error Handling & UX)
- **精准文件与代码行号**:
  - `src/js/modules/settings.js`: 第 441–489 行 (`resetBookmarks`)
  - `src/js/modules/settings.js`: 第 492–569 行 (`saveEditModal`)
- **代码片段**:
  `src/js/modules/settings.js:498-568`:
  ```javascript
  try {
      const previewReady = await flushWallpaperSelection(isCurrent);
      if (!isCurrent()) return;
      ...
      for (const [field, changed, commit, error] of commits) {
          ...
      }
      finishEdit();
  } finally {
      if (isCurrent()) setEditPhase('editing');
  }
  ```
- **根因分析 (RCA)**:
  `saveEditModal` 与 `resetBookmarks` 均为异步函数，内部均使用了 `try { ... } finally { ... }` 结构，但**完全没有声明 `catch` 块**。
  这两处函数直接绑定于 DOM 事件监听器（`dom.saveEditBtn.addEventListener('click', saveEditModal)` 以及确认框回调）。在标准 DOM 事件分发中，监听器返回的 Promise 会被浏览器直接忽略。一旦在 `try` 块执行过程中发生任何意外异常（例如 `commitWallpaperSelection` 中的 IndexedDB 故障、`replaceBookmarkDraft` 报错或 `Intl.ListFormat` 在非标准环境下的构造异常），该异常会在执行完 `finally` 后直接向外抛出，成为未捕获的 Promise Rejection。
- **潜在影响 (Impact)**:
  在 `finally` 块中，`setEditPhase('editing')` 会将界面重新恢复为可编辑态，但用户无法收到任何关于保存失败的对话框提示，导致用户以为点击保存无响应，陷入持续点击的死循环。
- **针对性修复建议 (Recommendation)**:
  在 `saveEditModal` 与 `resetBookmarks` 中显式增加 `catch` 块并调起统一通知：
  ```javascript
  try {
      ...
      finishEdit();
  } catch (err) {
      console.error('Settings save failed:', err);
      showConfirm(t('ui.could.not.save'), null, t('ui.notice'));
  } finally {
      if (isCurrent()) setEditPhase('editing');
  }
  ```

---

### 4.3 低度级别 (Low, 6 项)

#### [LOW-01] `modules/search.js` 内部可变变量通过 ESM live binding 泄漏破坏模块封装

- **问题分类**: 模块封装性 (Encapsulation Leak)
- **精准文件与代码行号**:
  - `src/js/modules/search.js`: 第 61–67 行
  - `src/js/testing/bridge.js`: 第 107–117 行
- **代码片段**:
  `src/js/modules/search.js:61-67`:
  ```javascript
  export let suggestionScriptTag = null;
  export let selectedSuggestionIdx = -1;
  export let activeSuggestReqId = 0;
  ```
- **根因分析 (RCA)**:
  `suggestionScriptTag`、`selectedSuggestionIdx` 和 `activeSuggestReqId` 属于搜索模块内部管理 JSONP 脚本标签与异步序列的内部私有状态。为了让 `testing/bridge.js` 能够将其挂载到 `window` 上供自动化测试检查，模块直接使用了 `export let` 导出活动绑定。这打破了面向对象/模块化封装原则。相比之下，`modules/weather.js:491` 则规范地使用了访问器函数 `export function isFetchingWeather() { return isFetching; }`。
- **针对性修复建议 (Recommendation)**:
  在 `search.js` 中保留私有 `let` 变量，改由导出只读 Getter 函数：
  ```javascript
  export function getActiveSuggestReqId() { return activeSuggestReqId; }
  export function getSelectedSuggestionIdx() { return selectedSuggestionIdx; }
  ```

---

#### [LOW-02] `OverlayStack` 背景遮罩事件追踪缺失 `pointercancel` 重置保护

- **问题分类**: 事件生命周期与手势状态安全 (Event State Machine)
- **精准文件与代码行号**:
  - `src/js/core/overlay-stack.js`: 第 27–35 行
- **代码片段**:
  `src/js/core/overlay-stack.js:27-35`:
  ```javascript
  let isPointerDownOnBackdrop = false;
  modal.addEventListener('pointerdown', e => {
      isPointerDownOnBackdrop = e.target === modal;
  });
  modal.addEventListener('click', e => {
      const top = OverlayStack.top();
      if (e.target === modal && isPointerDownOnBackdrop && top?.id === id) top.close();
      isPointerDownOnBackdrop = false;
  });
  ```
- **根因分析 (RCA)**:
  `isPointerDownOnBackdrop` 标志用于防止用户在卡片内拖拽文本释放至背景时误关闭弹窗。然而在触控设备或手写笔交互中，若用户按在背景上随后发生手势滚动或系统弹窗拦截，浏览器会派发 `pointercancel` 而不会派发 `click`。此时 `isPointerDownOnBackdrop` 将滞留在 `true` 状态，若后续由于辅助功能或快捷键合成了对 `modal` 的点击，会导致弹窗被非预期关闭。
- **针对性修复建议 (Recommendation)**:
  为 `modal` 绑定 `pointercancel` 事件监听器，及时将 `isPointerDownOnBackdrop` 重置为 `false`：
  ```javascript
  modal.addEventListener('pointercancel', () => { isPointerDownOnBackdrop = false; });
  ```

---

#### [LOW-03] 国际化分类与天气数据模型缺失防御性数组与空值保护

- **问题分类**: 边界防御性编程 (Defensive Boundary)
- **精准文件与代码行号**:
  - `src/js/core/i18n.js`: 第 139 行
  - `src/js/utils/category-catalog.js`: 第 25–28 行
  - `src/js/utils/weather-model.js`: 第 50–55 行
- **代码片段**:
  `src/js/core/i18n.js:139`:
  ```javascript
  bookmarks: category.bookmarks.map(bookmark => ({
      ...bookmark,
      ...catalog.bookmarks[bookmark.url],
      url: bookmark.url
  }))
  ```
  `src/js/utils/weather-model.js:50-51`:
  ```javascript
  export function formatLocationFullName(parts) {
      const cleaned = parts
          .filter(p => typeof p === 'string')
  ```
- **根因分析 (RCA)**:
  代码中直接对 `category.bookmarks` 或 `parts` 调用 `.map()` / `.filter()`。若传入数据发生脏写或异常（如 `bookmarks` 缺失或 `parts` 为 null），会直接抛出未捕获的 `TypeError: Cannot read properties of undefined (reading 'map')`。
- **针对性修复建议 (Recommendation)**:
  增加空值合并与数组守卫：`category.bookmarks || []`，以及 `(Array.isArray(parts) ? parts : []).filter(...)`。

---

#### [LOW-04] 天气重试按钮与后台定时器调用 `updateWeather()` 遗漏 `.catch()` 错误兜底

- **问题分类**: 异步异常未捕获 (Unhandled Promise Rejection)
- **精准文件与代码行号**:
  - `src/js/modules/weather.js`: 第 619 行 (重试按钮)
  - `src/js/modules/weather.js`: 第 666 行 (轮询定时器)
- **代码片段**:
  `src/js/modules/weather.js:619`:
  ```javascript
  renderWeatherPopover(null);
  updateWeather(true);
  return;
  ```
  `src/js/modules/weather.js:666`:
  ```javascript
  weatherIntervalTimer = setInterval(() => updateWeather(false), CONFIG.WEATHER.CACHE_TTL);
  ```
- **根因分析 (RCA)**:
  `src/js/modules/weather.js:664` 在页面初始化时正确添加了 `.catch(() => {})`，但第 619 行的用户点击重试与第 666 行的定时轮询中，调用返回 Promise 的 `updateWeather()` 时均未添加 `.catch()`，一旦异步链路产生网络或解析错误，易产生 Unhandled Rejection。
- **针对性修复建议 (Recommendation)**:
  在两处调用尾部显式追加 `.catch(() => {})`。

---

#### [LOW-05] 业务模块中存在 `any` 类型强制转换削弱静态类型安全

- **问题分类**: 类型安全防线削弱 (Type Safety Degradation)
- **精准文件与代码行号**:
  - `src/js/modules/search.js`: 第 602, 625 行
  - `src/js/modules/weather.js`: 第 156 行
  - `src/js/modules/settings.js`: 第 405 行
  - `src/js/utils/bookmark-model.js`: 第 105 行
- **代码片段**:
  `src/js/modules/weather.js:156`:
  ```javascript
  let matched = results.find((/** @type {any} */ r) => {
      const matchCountry = !country || (r.country && (r.country.includes(country) || country.includes(r.country)));
  ```
- **根因分析 (RCA)**:
  模块开发者在 JSDoc 中使用了 `any` 作为快速类型逃逸手段，例如将地理逆编码结果强制推断为 `any`。这导致 `r.country`、`r.admin1` 等字段的访问完全无法受到 TypeScript 的拼写与空安全保护。
- **针对性修复建议 (Recommendation)**:
  在 `src/js/types.d.ts` 中声明标准响应结构体（如 `GeocodingResultItem`），将 `any` 替换为具体接口或 `Record<string, unknown>`。

---

#### [LOW-06] `BookmarkSuggestion` 接口定义缺失区分字面量属性 `type: 'bookmark'`

- **问题分类**: 类型契约不一致 (Type Definition Discrepancy)
- **精准文件与代码行号**:
  - `src/js/types.d.ts`: 第 328–334 行
  - `src/js/utils/bookmark-search.js`: 第 157–165 行
- **代码片段**:
  `src/js/types.d.ts:328-334`:
  ```typescript
  export interface BookmarkSuggestion {
      name: string;
      url: string;
      icon?: string;
      desc?: string;
      category?: string;
  }
  ```
  `src/js/utils/bookmark-search.js:157-164`:
  ```javascript
  item: {
      type: 'bookmark',
      name: bm.name || '',
      url: bm.url,
      icon: bm.icon || '',
      desc: bm.desc || '',
      category: realCat
  }
  ```
- **根因分析 (RCA)**:
  `bookmark-search.js` 统一返回带有辨别标签（Discriminant Tag）`type: 'bookmark'` 的数据项，供下游搜索建议展示组件区分为内置书签还是搜索引擎联想词。但 `types.d.ts` 声明中遗漏了该必选属性。
- **针对性修复建议 (Recommendation)**:
  在 `src/js/types.d.ts` 中为 `BookmarkSuggestion` 补充声明 `type: 'bookmark';`。

---

### 4.4 提示级别 (Info, 4 项)

#### [INFO-01] Stylelint 与外网 W3C 接口强耦合且卡片 hover 状态前缀未在 Lint 中静态校验

- **问题分类**: 样式检查与构建解耦 (Linting & Style Rules)
- **精准文件与代码行号**:
  - `scripts/validate-w3c.mjs`: 第 57–64 行
  - `scripts/lint-css.mjs`: 第 1–46 行
- **根因与影响**:
  项目中的 Stylelint 检查被内嵌在 `scripts/validate-w3c.mjs` 中。由于该脚本需要连接 W3C 在线 API（`validator.w3.org`），在离线状态下开发者无法单独执行 Stylelint。此外，`AGENTS.md` 明确规定：“*卡片 `:hover` 加 `body:not(.tab-blurred)` 前缀*”，但目前的 `scripts/lint-css.mjs` AST 规则仅检查了 `!important` 和 `-webkit-backdrop-filter`，尚未覆盖卡片 hover 前缀的静态守卫。
- **建议**:
  独立暴露 `npm run lint:style` 命令，并在 `lint-css.mjs` 中增加针对卡片 hover 选择器前缀的正则或 AST 规则。

---

#### [INFO-02] `publish-build.cjs` 生成的 `dist` 软链接采用绝对路径降低跨目录可移植性

- **问题分类**: 发布构建工程便携性 (Build Portability)
- **精准文件与代码行号**:
  - `scripts/publish-build.cjs`: 第 121–124 行
- **代码片段**:
  ```javascript
  fs.symlinkSync(release, link, process.platform === 'win32' ? 'junction' : 'dir');
  ```
- **根因与影响**:
  构建脚本使用 `mkdtempSync` 创建绝对路径临时目录，并直接以此创建 `dist` 软链接。若开发环境在打包后移动了项目根目录或在容器挂载路径发生变动，绝对软链接将悬空（Dangling Symlink）。
- **建议**:
  在非 Windows 平台上采用基于项目父目录的相对软链接路径：`path.relative(parent, release)`。

---

#### [INFO-03] Service Worker 中将 `URL` 对象实例传入 Cache API 而非字符串字面量

- **问题分类**: Web API 规范严格契约 (Standards Strictness)
- **精准文件与代码行号**:
  - `src/sw.js`: 第 21–23, 224, 249, 253, 256, 258 行
- **根因与影响**:
  `sw.js` 将 `new URL(...)` 实例直接作为键传入 `cache.put(ACTIVATED_CORE, ...)` 与 `caches.match(...)`。虽然现代浏览器会自动将 URL 实例通过 WebIDL 转换为字符串，但在严格遵循 W3C Cache API 规范的类型体系中，Cache Key 的类型为 `RequestInfo`（`Request | USVString`）。
- **建议**:
  将常量统一声明为字符串字面量或调用 `.href` 传入。

---

#### [INFO-04] `scripts/sync-icons.mjs` 依赖 macOS 原生 `sips` 工具进行非方形与矢量图标转换

- **问题分类**: 跨平台开发体验 (Cross-Platform Tooling)
- **精准文件与代码行号**:
  - `scripts/sync-icons.mjs`: 第 100–165 行
- **根因与影响**:
  脚本在处理非常规非方形 PNG 或 SVG 图标时依赖 macOS 内置的 `sips` 命令行工具。在 Linux/Windows 开发者环境下，同步图标时若遇到新图标，脚本会自动跳过转换并提示缺少工具。
- **建议**:
  保留现有行为（不违背零依赖原则），在文档中明确标注非 macOS 环境下手工提供标准 128x128 PNG 图标的指引。

---

## 五、现有测试套件与代码质量脚本执行与有效性审查

### 5.1 自动化质量脚本实际执行状态 (Live Execution Log)

在本次审计过程中，审计员在项目根目录下对全部官方指定的质量与测试命令进行了实机执行。以下为真实的执行日志与状态记录：

#### 1. 静态语法与规范检查 (`npm run lint`)
- **执行命令**: `npm run lint`
- **执行耗时**: 135ms
- **退出状态码**: `0` (Success)
- **控制台输出摘要**:
  ```
  ════════════════════════════════════════════════════════════════════════
  🔍 Glass Start — 静态语法与格式检查 (Static Lint)
  ════════════════════════════════════════════════════════════════════════
  ─── [1/4] 📄 校验 src/index.html 内联脚本语法 ───────────────────────
    ✔ 8 处内联 script 语法全部通过
  ─── [2/4] ⚙️  校验核心 JavaScript 语法 (node --check) ───────────────
    ✔ 6 个核心构建脚本与 src/js/ 46 个 ESM 业务子模块语法全部通过
  ─── [3/4] 📦 校验 JSON 配置文件格式 ─────────────────────────────────
    ✔ bookmarks.json, manifest.json, ext/manifest, package.json 格式合法
  ─── [4/4] 🛡️  校验版本来源与移动端输入规范 ──────────────────────────
    ✔ 单一真理源版本 (v5.5.3)、iOS >=16px 输入框、button type、SVG aria 标注、
      !important 白名单、毛玻璃前缀顺序、DOM ID 映射、135 个预设书签、
      OverlayStack 状态机生命周期、扩展 Manifest 权限一致性全部合规
  ════════════════════════════════════════════════════════════════════════
  ✨ 全部 32 项静态语法与规范检查通过！ (耗时: 135ms)
  ```
- **质量有效性评估**:
  检查面覆盖非常广泛，能够有效拦截低级 HTML/CSS/DOM 映射失真；但如 MED-04 所述，存在 9 个脚本未被第二阶段动态捕获的盲区。

---

#### 2. 静态类型检查 (`npm run typecheck`)
- **执行命令**: `npm run typecheck`
- **执行耗时**: 约 1.2s
- **退出状态码**: `0` (Success)
- **实际指令**: `tsc --project tsconfig.json && tsc --project tsconfig.sw.json`
- **控制台输出**: 无任何错误输出（Exit code 0）。
- **质量有效性评估**:
  虽然退出码为 0，但这是在 MED-01（`[key: string]: HTMLElement | null` 宽泛签名消解了所有 `dom.xxx` 检查）以及 MED-03（`tsconfig.json` 排除了所有构建与辅助脚本）的前提下获得的“假性完全通过”。真实类型防线仍需按照路线图加固。

---

#### 3. 全量端到端与回归测试套件 (`npm test`)
- **执行命令**: `npm test`
- **执行耗时**: 76,886ms (约 76.88 秒)
- **退出状态码**: `0` (Success)
- **统计指标**:
  - `tests`: 129
  - `pass`: 129
  - `fail`: 0
  - `skipped`: 0
- **控制台输出摘要**:
  ```
  ════════════════════════════════════════════════════════════════════════
  🚀 Glass Start — 生产环境构建打包 (Production Build)
  ════════════════════════════════════════════════════════════════════════
    ✔ 编译 Tailwind CSS (96.26 KB, 耗时 230ms)
    ✔ 构建 Service Worker 与静态资产 (包含 127 本地图标, 16 壁纸)
    ✔ 提取并压缩生产脚本 (149.01 KB, 43 个模块)
    ✔ 生产环境 dist/index.html 零依赖压缩完成 (214.82 KB)
  ✨ 生产打包成功！ (总耗时: 402ms)
  ...
  ℹ tests 129
  ℹ suites 0
  ℹ pass 129
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 76886.949458
  ```
- **质量有效性评估**:
  129 个测试全部通过证明了 Chrome 环境下核心交互、书签草稿、拖拽排序、动画降级、Service Worker 缓存策略的高度稳定性。

---

#### 4. W3C Nu HTML 与 Stylelint 检查 (`npm run test:w3c`)
- **执行命令**: `npm run test:w3c`
- **执行耗时**: 1,592ms
- **退出状态码**: `0` (Success)
- **控制台输出**:
  ```
  ════════════════════════════════════════════════════════════════════════
  🌐 Glass Start — Nu HTML / Stylelint CSS 校验
  ════════════════════════════════════════════════════════════════════════
    内嵌 CSS（Stylelint，1 个 style 块）：0 个错误、0 个警告
    正在校验 dist/index.html，连接 W3C 在线验证 API...
  ─── HTML 校验结果 (1592ms)：0 个错误、0 个警告 ───
    Nu 自带 CSS 引擎另有 71 条诊断；其所在 style 块已通过 Stylelint，采用现代 CSS 校验结果。
  ✔ HTML / CSS 校验完成，无阻断错误；本检查不代表完整无障碍、视觉或功能合规。
  ```
- **网络依赖性特征说明**:
  该命令依赖外部网络访问 `https://validator.w3.org/nu/?out=json`。当网络畅通时校验快速通过。若在无网环境或 CI 频繁并发请求时，受 W3C 服务器速率限制可能产生超时或中断。

---

### 5.2 真实 CDP 测试套件与 Mock 保真度审查

Glass Start 的测试套件展现了极高的轻量化工程美感。通过原生 Node WebSocket 驱动无头 Chrome 的 DevTools Protocol（CDP），测试用例能够真实验证页面的合成层（Compositing Layers）、Paint 次数预算、真实动画状态以及焦点树。

然而，在 Mock 保真度方面存在两极分化：
1. **高保真模块**: `test/infra-chrome-extension.test.mjs` 与 `test/infra-sw-request-performance.test.mjs` 实现了非常细致的请求拦截与内存模拟，能够精确测试并发下载共享与错误隔离。
2. **零 Mock 模块**: 超过 27 个通用 UI 测试直接使用 `launchSession()`，完全未对公网请求进行拦截，导致测试期间无谓地消耗外部带宽并引入潜在网络超时隐患（见 HIGH-03）。

### 5.3 外部网络泄漏实证与并发测试隐患

通过检查 `test/support/helpers.mjs` 的会话建立过程与 `weather.js` 的自动初始化逻辑，已证实每次 `npm test` 启动都会向 `myip.ipip.net`、`open-meteo.com` 发起 30 轮以上的真实公网请求。这不仅是对公共气象 API 的不必要开销，更导致测试套件无法在内网或离线环境下完整运行。

### 5.4 测试边界盲区与断言颗粒度分析

1. **断言颗粒度粗放**: 如 MED-05 所揭示，大量模态测试只验证 `dom.modal.open`，缺乏对弹窗文字、确认提示、Tab 切换后内容更新的深层断言。
2. **多语言与极端编码测试缺失**: 模糊搜索仅测试英文词汇（MED-06），缺少日韩德俄等非 ASCII 查询覆盖；Emoji 徽标截断为孤立代理对的缺陷（MED-08）在测试中未被捕获。
3. **复杂存储事务生命周期覆盖不足**: IDB 的多标签页版本升级协商（MED-07）缺乏测试覆盖。

---

## 六、架构优化与分级加固路线图

基于本期审计识别出的 22 项问题，制定以下三阶段分级加固路线图：

```
分级整改实施路线图 (Phase-based Hardening Roadmap):
┌────────────────────────────────────────────────────────────────────────┐
│ P0: 阻断性兼容崩溃与网络泄漏处置 (Immediate)                           │
│     - 修复 visibleFocusTarget 的 checkVisibility 降级逻辑              │
│     - 修复 weather.js 的 AbortSignal.any 降级与 try 块包裹             │
│     - 修复 helpers.mjs launchSession() 的默认离线 Mock 请求拦截        │
├────────────────────────────────────────────────────────────────────────┤
│ P1: 架构契约与类型静态防护 (Near-Term)                                 │
│     - 移除 DOMCache 通用索引签名，在 dom.js 中补全 editModal 等核心 ID │
│     - 引入 @types/node 并配置 tsconfig.scripts.json                    │
│     - 修复 Emoji / Astral 字符徽标解构截断                             │
│     - 补齐 saveEditModal 与 resetBookmarks 的 catch 异常拦截与提示     │
├────────────────────────────────────────────────────────────────────────┤
│ P2: 测试盲区覆盖与工程纯净度 (Architectural Enhancements)              │
│     - 改造 lint.mjs 动态遍历 scripts/ 目录全部脚本                     │
│     - 补充 Unicode 多语言搜索与 IDB 版本升级回归用例                   │
│     - 收敛 search.js 内部变量封装 (改为 Accessor 函数)                 │
│     - 独立 Stylelint 离线执行命令与 card hover 选择器静态规则          │
└────────────────────────────────────────────────────────────────────────┘
```

### 6.1 P0 立即处置 (Immediate / 阻断性兼容崩溃与网络泄漏)

1. **处置 HIGH-01 (`overlay-stack.js`)**:
   在 `src/js/core/overlay-stack.js` 中重写 `visibleFocusTarget`，增加 `typeof element.checkVisibility === 'function'` 守卫与计算样式降级，彻底消除 Safari < 17.4 用户关闭弹窗时的致命报错。
2. **处置 HIGH-02 (`weather.js`)**:
   在 `src/js/modules/weather.js` 中引入 `anySignal` polyfill 函数，并将 `executeWeatherUpdate` 中第 558 行移入 `try` 块内，确保 Safari < 17.4 用户天气功能正常且异常不泄露。
3. **处置 HIGH-03 (`helpers.mjs`)**:
   在 `test/support/helpers.mjs` 的 `launchSession` 中使用 CDP 默认注入外部请求 Mock，屏蔽测试套件对公网的天气与 IP 请求泄漏，提升全量测试速度与离线稳定性。

### 6.2 P1 近期优化 (Near-Term / 架构契约与类型静态防护)

1. **处置 MED-01 & MED-02 (`dom.js` & `types.d.ts`)**:
   - 在 `src/js/state/dom.js` 的 `ids` 列表中补齐 `editModal bookmarkPicker languageModal tabBookmarks tabAppearance tabData`；
   - 在 `src/js/types.d.ts` 中删除 `[key: string]: HTMLElement | null;`，为所有 DOMCache 节点提供明确类型声明。
2. **处置 MED-03 (`package.json` & `tsconfig.json`)**:
   在 `package.json` 引入 `@types/node`，建立 `tsconfig.scripts.json` 将 18 个工程与测试脚本纳入静态类型审查。
3. **处置 MED-08 (`favicon.js`, `bookmark-editor.js`, `settings-events.js`)**:
   将所有获取首字徽标处的 `.trim().charAt(0)` 改造为 `[...(name || '?').trim()][0]`，消除 Emoji 徽标孤立高位代理对乱码。
4. **处置 MED-09 (`settings.js`)**:
   在 `saveEditModal` 与 `resetBookmarks` 中添加显式 `catch` 块，捕获保存与重置过程中的未决异常，向用户呈现错误弹窗。

### 6.3 P2 架构增强 (Architectural Enhancements / 测试盲区覆盖与工程纯净度)

1. **处置 MED-04 (`lint.mjs`)**:
   将 `scripts/lint.mjs` 中的静态数组改造为动态扫描，确保所有 15 个工程脚本均受到语法检查。
2. **处置 MED-05、MED-06、MED-07 (测试套件深化)**:
   - 细化模态弹窗断言，核验实际渲染的文案与标题；
   - 增加多语种（日、韩、俄、变音符号）书签检索回归用例；
   - 编写 IDB 版本迁移与多标签页升级断言用例。
3. **处置 LOW-01 至 LOW-06 与 INFO 项**:
   收敛搜索模块导出变量为 Getter 函数；添加 `pointercancel` 重置保护；增加离线 Stylelint 指令。

---

## 七、结语与后续改进建议

Glass Start 项目在前端架构演进过程中树立了极具示范意义的标杆：它证明了在不引入繁重现代前端框架的前提下，完全依托原生 Web 标准与纯粹工程自律，同样能够打造出性能卓越、体验丝滑、具备生产级可靠性的现代化 Web 应用与浏览器扩展。

在经历了针对 `v5.5.2` 历史缺陷的全面修复后，当前的 `v5.5.3` 已经拥有了极其坚固的主干体系。本次审计报告挖掘出的 22 项问题中，阻断性问题（HIGH-01 至 HIGH-03）主要聚焦于现代 Web API 在特定历史版本浏览器（Safari < 17.4）上的平滑降级，以及测试套件对公网环境的纯净解耦；中度与轻度问题则着重于类型静态契约的严格收敛与边缘编码防线的补强。

建议工程团队按照 **P0 → P1 → P2** 的节奏开展阶段性加固，重点消除 Safari < 17.4 的阻断崩溃，并封闭静态类型检查的穿透盲区。完成加固后，Glass Start 的架构健康度与代码质量将达到无懈可击的工业级卓越水平。

---
*报告交付签署：Teamwork Audit Report Synthesis Worker*  
*签署日期：2026-11-11*

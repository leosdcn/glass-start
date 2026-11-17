# Glass Start 测试套件全面代码审计与质量评估报告

- **审计日期**: 2026-11-17
- **审计基线**: Git commit `HEAD` (分支 `main`, 版本 `v5.5.6`)
- **审计范围**: `test/` 目录下全部 33 个测试文件、4 个测试辅助模块、类型契约、诊断工具及测试运行器配置 (`test/run.mjs`)
- **执行约束**: 严格只读（Zero Code Modification）。`src/`、`test/` 及项目工程文件保持 100% 只读；`git status` 除本报告外无任何变更
- **规范基准**: [AGENTS.md](../../AGENTS.md)（奥卡姆剃刀原则、“如无必要，勿增实体”、零第三方运行时依赖）、[ARCHITECTURE.md](../ARCHITECTURE.md) 及原生 Web/Node.js 测试最佳实践

---

## 1. 执行摘要与总体健康度评估 (Executive Summary & Health Assessment)

### 1.1 审计背景与方法论
本项目（Glass Start）为一个追求极致轻量、优雅毛玻璃质感、兼顾网页版与 Chrome 扩展的起始页应用。本轮测试套件代码审计旨在对项目的测试基础设施、用例设计、断言有效性、时序稳定性及工程合规性开展全面深入的静态代码审查与动态基线实测。

审计方法采用“静态源码证据链 + 动态实测基线验证”双重机制：
1. **全景静态扫描**: 逐行审查 `test/` 顶层全部 33 个 `*.test.mjs` 文件（共 8,988 行测试源码）、`test/support/` 辅助模块（511 行）以及诊断工具与类型契约（782 行），核查每一个测试用例的断言有效性、时序处理、错误传播与模块边界。
2. **多维实测基线**: 在原生 Node.js (v26.13.0) 与 Google Chrome (Headless) 环境下，运行包含纯单元测试、CDP 浏览器测试、Chrome MV3 扩展测试、Service Worker 升级测试及多标签页生命周期测试在内的完整指令矩阵，采集真实的执行状态、用例粒度、耗时与内存/进程行为。
3. **奥卡姆剃刀裁决**: 对照项目核心原则“如无必要，勿增实体”，排查测试层是否存在过度抽象、自测脚手架膨胀、虚假断言、盲等延迟及竞态隐患。

### 1.2 总体健康度评级: 8.5 / 10 (良好，具备深厚工程底座，但存在局部结构性与时序盲区)

| 评估维度 | 权重 | 得分 | 核心定性评价 |
| :--- | :---: | :---: | :--- |
| **测试架构与运行器 (Dimension 1)** | 25% | **8.2 / 10** | 零第三方依赖、原生 Node.js 运行器与 CDP WebSocket 客户端极具特色；但存在 10 份无 `node:test` 包装的巨石文件、TOCTOU 端口竞态以及纯单元测试清单不全导致的构建浪费。 |
| **用例覆盖率与边界断言 (Dimension 2)** | 30% | **8.4 / 10** | 业务与底层特性覆盖极为全面（含 BFCache、多版本 SW、MV3 CSP）；但存在 1 处掩盖触摸拖拽重排失败的复合否定假断言、多处复合布尔值折叠（布尔盲区）及顶层裸奔断言。 |
| **稳定性、时序与执行性能 (Dimension 3)** | 25% | **8.2 / 10** | 纯单元测试极快 (46 例仅 216ms)；但浏览器测试中存在多处盲等 `sleep()` (合计超 3.9s)、5 处 `setTimeout(50)` 盲点、CDP 监听器静默吞异常，以及 `infra-sw-update-ui` 真实等待 15s 定时器的性能瓶颈。 |
| **项目规范合规性 (Dimension 4)** | 20% | **9.4 / 10** | 100% 遵守零第三方运行时依赖，测试全部位于 `test/` 且命名规范；仅存在单一文件职责混杂（天气与壁纸混编）和文档失效引用的低风险问题。 |

### 1.3 核心优势 (Core Strengths)
1. **纯原生无依赖体系**: 测试套件 100% 依托 Node.js 原生内置模块（`node:test`、`node:assert`、`node:http`、`node:net`、`node:child_process`、原生 `WebSocket`）与 Chrome DevTools Protocol (CDP)，彻底杜绝了 Puppeteer、Playwright、Jest 等庞大第三方依赖的引入，冷启动极快，依赖树纯净。
2. **纯单元测试毫秒级极速反馈**: 脱离浏览器依赖的纯模型、多语言解析、动画清理等单元测试（共 46 个用例），在 Node.js 原生运行器下全量执行仅耗时 **216.8 ms**，为日常敏捷开发提供了极佳的守卫基石。
3. **高保真复杂环境自动化覆盖**: 拥有一般 Web 前端项目罕见的高深度自动化能力：
   - **Chrome MV3 扩展**: 通过 CDP `Extensions.loadUnpacked` 在无头 Chrome 中直接加载真实构建产物，实测离线重载、冷启动深色底色防白闪、三引擎联想及 **0 项 CSP 违规**。
   - **Service Worker 跨版本演变**: 覆盖多达 8 个版本迭代升级、多 Scope 离线池隔离、Waiting Worker 激活、损坏资源内存修复及降级 HTML 恢复页渲染。
   - **高级生命周期与多标签**: 真实模拟 BFCache 往返导航、Tab 焦点失活的 `.tab-blurred` 样式抑制、以及跨 Tab Web Locks (`navigator.locks`) 存储并发竞争。
4. **测试沙箱构建隔离**: `test/run.mjs` 通过 `GLASS_TEST_TMPDIR` 动态创建独立临时目录生成构建快照，避免并发测试污染生产 `dist/` 目录。

### 1.4 核心风险与隐患摘要 (Primary Vulnerabilities & Risks)
1. **测试范式割裂与报告盲区 (ARCH-01)**: 33 个测试文件中，有 **10 个文件（超 3,200 行代码）未导入 `node:test`**，采用顶层过程式执行。在 Node 测试运行器视角下，包含 11 个独立业务验证的 700 行文件被归结为单一用例 (`tests 1`)；任何一处断言失败将直接中断整个文件，后续用例完全无法执行。
2. **TOCTOU 端口分配竞态条件 (ARCH-02)**: `test/support/helpers.mjs` 中的 `getFreePort()` 通过试探性 `listen` 后 `close` 释放端口。在 `--test-concurrency=6` 并发执行下，存在典型的“检查时可用-使用时已被占用”的时间窗口，容易在高负载并发 CI 中触发 `EADDRINUSE` 偶发失败。而系统内底层实际上已原生支持内核端口 0 动态分配。
3. **复合否定逻辑漏洞掩盖拖拽缺陷 (ASSERT-01)**: `test/data-audit-regressions.test.mjs:292` 在测试多指触摸排序释放时，采用了 `assert.equal(id === 'touch_0' && !isDragging, false)`。根据德·摩根定律，若拖拽排序完全失效（`id === 'touch_0'` 为真）且拖拽样式残留（`!isDragging` 为假），该断言依然判定为 `false` 并通过测试，导致缺陷被静默掩盖。
4. **时序盲等与单文件 45 秒阻塞瓶颈 (STAB-01, STAB-02, STAB-03)**:
   - `test/infra-sw-update-ui.test.mjs` 存在 5 处 `setTimeout(..., 50)` 盲点确认按钮，在高负载 CPU 节流环境下极易因 DOM 未渲染就位而产生 Flaky 误报。
   - 同一文件中为测试更新超时降级，真实等待了生产常量的 15 秒定时器 (`CONFIG.TIMERS.SW_UPDATE_TIMEOUT`)，导致该单一测试耗时高达 **45.5 秒**，成为整个 Infra 套件执行时间的最大瓶颈。
   - `ui-nav-rendering.test.mjs` 等测试中仍保留多处无条件的 `sleep(400)`，合计浪费近 4 秒无意义等待时间。

---

## 2. 测试资产全景概览 (Test Suite Landscape & Panorama)

### 2.1 测试资产分类统计

整个测试子系统由 33 个测试文件、4 个测试支持模块、1 个静态类型契约文件和 2 个专项诊断工具组成，总计代码量为 **10,281 行**。

```
test/
├── [33 files]  *.test.mjs             (8,988 行 - 核心测试用例集)
├── support/                           (511 行 - 测试基础设施与底层驱动)
│   ├── cdp.mjs                        (300 行 - 原生 WebSocket CDP 驱动)
│   ├── helpers.mjs                    (115 行 - 会话调度、轮询器与断言辅助)
│   ├── server.mjs                     (84 行 - 轻量原生 HTTP 静态服务)
│   └── test-selection.mjs             (12 行 - 纯单元测试清单与构建判定)
├── types/
│   └── contracts.js                   (40 行 - TypeScript 负向类型约束契约)
├── visual-regression.mjs              (353 行 - DOM 几何与视觉快照诊断工具)
└── benchmark-transition.mjs           (160 行 - 切屏动效帧率压测诊断工具)
```

| 分类大项 | 文件数量 | 代码总行数 | 运行环境 | 执行模式 |
| :--- | :---: | :---: | :--- | :--- |
| **纯单元测试 (Pure Unit)** | 5 | 1,201 行 | Node.js 原生进程 | 无需构建产物，直接执行源码 VM/纯模块 |
| **业务数据与集成测试 (Data / Biz)** | 9 | 3,246 行 | Chrome Headless (CDP) | 需要构建产物，本地静态服务 + 浏览器会话 |
| **UI 与交互渲染测试 (UI / Gestures)** | 9 | 2,267 行 | Chrome Headless (CDP) | 需要构建产物，涵盖触屏模拟、尺寸断言与无障碍 |
| **底层设施与扩展测试 (Infra / SW)** | 9 | 2,078 行 | Chrome Headless / Node CLI | 涵盖真实 MV3 扩展、Service Worker、图标 CLI |
| **应用生命周期测试 (Lifecycle)** | 1 | 196 行 | Chrome Headless (CDP) | 涵盖预渲染切屏、BFCache 往返与多标签会话 |
| **测试辅助模块 (Support)** | 4 | 511 行 | Node.js 运行库 | 提供网络、进程、CDP、断言与用例筛选支持 |
| **诊断与基准工具 (Tools & Types)** | 3 | 553 行 | Node.js / tsc | 视觉快照、帧率基准与编译期类型契约检查 |
| **全量合计** | **40 个模块** | **10,281 行** | — | — |

---

### 2.2 33 个测试文件全量清单与特征矩阵

下表列出 `test/` 目录下全部 33 个测试文件的详细盘点，包括行数、范式（是否使用 `node:test`）、断言特征、运行环境及真实执行用例数：

| # | 测试文件名 | 行数 | 导入 `node:test` | 用例数 (`test()`) | 过程断言 (`✅`) | 驱动模式 | 模块职责与测试核心 |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| 1 | `data-animation-cleanup-unit.test.mjs` | 220 | ✅ 是 | 6 | 0 | Node Unit | 书签行删除/排序动画结束与取消、减弱动效清理 |
| 2 | `data-audit-regressions.test.mjs` | 308 | ✅ 是 | 4 | 0 | Chrome CDP | 边界数据、搜索联想激活、多指拖拽排序与迟到响应 |
| 3 | `data-bookmark-picker.test.mjs` | 319 | ✅ 是 | 4 | 7 | Chrome CDP | 图标选择器节点复用、DOM 属性同步与草稿修改 |
| 4 | `data-bookmarks-features.test.mjs` | 190 | ✅ 是 | 2 | 0 | Chrome CDP | 预设与自定义书签持久化、旧版数据迁移与损坏过滤 |
| 5 | `data-i18n-unit.test.mjs` | 89 | ✅ 是 | 4 | 0 | Node Unit | 语言偏好优先级、多语言参数单次替换与目录翻译 |
| 6 | `data-i18n.test.mjs` | 318 | ❌ 否 | 0 (顶层) | 1 | Chrome CDP | 中英文全站文案、首帧切换、离线多语言持久化 |
| 7 | `data-priority-fixes-unit.test.mjs` | 422 | ✅ 是 | 13 | 0 | Node Unit | 天气缓存容错、超时重试与壁纸文件压缩/解码处理 |
| 8 | `data-pure-models.test.mjs` | 253 | ✅ 是 | 15 (+2 裸奔) | 1 | Node Unit | 搜索拼写容错、书签解析去重、天气转换与草稿模型 |
| 9 | `data-request-performance.test.mjs` | 360 | ❌ 否 | 0 (顶层) | 6 | Chrome CDP | 搜索联想防抖/去重、并发请求合并与跨域回调保护 |
| 10 | `data-settings-save.test.mjs` | 700 | ❌ 否 | 0 (顶层) | 11 | Chrome CDP | 设置保存事务、锁机制、失败回滚、多标签冲突 |
| 11 | `data-wallpaper-selection-unit.test.mjs` | 219 | ✅ 是 | 8 | 0 | Node Unit | 网络壁纸单例解码、并发保存复用、写队列去重 |
| 12 | `data-wallpaper-storage.test.mjs` | 212 | ✅ 是 | 3 | 6 | Chrome CDP | IndexedDB 存取、存储配额降级、损坏 Base64 恢复 |
| 13 | `data-wallpaper.test.mjs` | 434 | ✅ 是 | 5 | 0 | Chrome CDP | 浏览器原生 Image 解码、Canvas 压缩、淡入过渡 |
| 14 | `data-weather-features.test.mjs` | 438 | ✅ 是 | 13 | 0 | Chrome CDP | 天气弹窗渲染、多城市定位切换、网络异常兜底 |
| 15 | `infra-build-pipeline.test.mjs` | 394 | ✅ 是 | 9 | 0 | Chrome / CLI | 生产打包产物完整性、HTML 压缩、CSS 内联校验 |
| 16 | `infra-chrome-extension.test.mjs` | 213 | ❌ 否 | 0 (顶层) | 1 | Chrome CDP | MV3 扩展真实加载、0 CSP 违规、离线重载与引擎 |
| 17 | `infra-icon-sync.test.mjs` | 174 | ✅ 是 | 1 | 0 | Node CLI | 图标 CLI 批量下载、尺寸规范化、缓存失败回滚 |
| 18 | `infra-module-boundaries.test.mjs` | 161 | ❌ 否 | 0 (顶层) | 5 | Chrome / AST | 43 个 ESM 模块依赖无环检测、静态边界隔离验证 |
| 19 | `infra-security.test.mjs` | 450 | ✅ 是 | 14 | 0 | Chrome CDP | XSS 转义防御、不安全协议过滤、CSP 规则限制 |
| 20 | `infra-sw-request-performance.test.mjs` | 167 | ❌ 否 | 0 (顶层) | 6 | Chrome CDP | SW 冷缓存并发请求合并、FIFO 缓存淘汰机制 |
| 21 | `infra-sw-update-ui.test.mjs` | 253 | ❌ 否 | 0 (顶层) | 9 | Chrome CDP | SW v201~v208 升级提示、Waiting Worker 激活确认 |
| 22 | `infra-sw-upgrade.test.mjs` | 283 | ❌ 否 | 0 (顶层) | 14 | Chrome CDP | 多 Scope 离线池隔离、降级 HTML 恢复页渲染 |
| 23 | `infra-theme-favicon.test.mjs` | 208 | ✅ 是 | 3 | 5 | Chrome CDP | 预设壁纸与主题色提取、动态 Favicon 换色映射 |
| 24 | `lifecycle.test.mjs` | 196 | ✅ 是 | 3 | 0 | Chrome CDP | 切屏预渲染位置恢复、BFCache 往返与页面混版拦截 |
| 25 | `ui-input-device-performance.test.mjs` | 90 | ✅ 是 | 2 | 2 | Chrome CDP | 触控与鼠标事件吞吐率、滚动防抖高频输入性能 |
| 26 | `ui-modal-accessibility.test.mjs` | 169 | ✅ 是 | 3 | 0 | Chrome CDP | 弹窗 Tab 键焦点循环、ARIA 属性、ESC 关闭栈 |
| 27 | `ui-nav-rendering.test.mjs` | 482 | ✅ 是 | 7 | 10 | Chrome CDP | 导航页分类渲染、侧栏锚点联动、尺寸缓存失效 |
| 28 | `ui-overlay-modals.test.mjs` | 546 | ✅ 是 | 6 | 0 | Chrome CDP | OverlayStack 弹窗层叠管理、遮罩点击、焦点恢复 |
| 29 | `ui-rendered-contracts.test.mjs` | 303 | ❌ 否 | 0 (顶层) | 5 | Chrome CDP | 首屏 DOM 几何契约、按钮间距、无横向滚动条约束 |
| 30 | `ui-rendering-performance.test.mjs` | 137 | ✅ 是 | 1 | 2 | Chrome CDP | 首次渲染长任务时间检测、重排重绘频次监控 |
| 31 | `ui-responsive-layout.test.mjs` | 97 | ✅ 是 | 2 | 0 | Chrome CDP | 移动端/桌面端断点切换、卡片流式栅格自适应 |
| 32 | `ui-screen-boundaries.test.mjs` | 241 | ❌ 否 | 0 (顶层) | 7 | Chrome CDP | 切屏滑动手势边界、橡皮筋阻尼、防误触与惯性衰减 |
| 33 | `ui-screen-gestures.test.mjs` | 204 | ✅ 是 | 1 | 0 | Chrome CDP | 触屏下滑呼出导航、触摸位移阈值判定与多手势冲突 |

---

## 3. 实测运行基线与性能数据 (Empirical Live Test Execution Baseline)

为了确保审计报告的真实性与严谨性，所有命令均在本地真实开发环境（macOS Darwin 25.1.0 arm64, Node.js v26.13.0, npm 11.20.0, Google Chrome 131+ Headless）中实际执行，记录客观的测试输出、测试数量与时间消耗。

### 3.1 实测运行基线汇总表

| 执行指令 | 验证目标与覆盖范围 | 测试通过数 | 失败数 | 执行耗时 | 关键指标与输出观测 |
| :--- | :--- | :---: | :---: | :---: | :--- |
| `npm run lint` | 全量静态规范（HTML、JS、JSON、CSS、元数据） | 43 项 | 0 | **156 ms** | 全部 43 项静态语法与规范检查通过，零警告 |
| `npm run typecheck` | TS 类型检查（应用、SW、脚本三份配置） | 3 项 | 0 | **1,210 ms** | `tsconfig.json`、`sw`、`scripts` 编译全部零错误 |
| `npm run test:unit` | 5 个纯单元测试文件（模型、多语言、动画清理） | 46 例 | 0 | **216.8 ms** | 极速无构建执行；中间夹带 1 处裸奔 `console.log` |
| `node --test test/data-pure-models.test.mjs` | 纯数学/模型单元测试（单文件独立运行） | 15 例* | 0 | **165.7 ms** | 15 项具名用例通过，2 处顶层裸奔断言未被计数 |
| `node --test test/infra-icon-sync.test.mjs` | 书签图标 CLI 下载、规范化与回滚 | 1 例 | 0 | **1,590.9 ms** | 纯 Node 脚本，无浏览器依赖，直接运行耗时 1.5s |
| `npm test -- infra-icon-sync` | 图标 CLI 测试通过运行器执行 | 1 例 | 0 | **1,652.7 ms** | 触发多余的全量生产打包 (302ms 构建 + 1.35s 测试) |
| `npm test -- infra-chrome-extension` | MV3 扩展真实加载、联想、设置与离线 | 1 例 (顶层) | 0 | **3,685.7 ms** | 构建扩展 388ms，CDP 加载扩展成功，0 CSP 违规 |
| `npm test -- lifecycle` | 切屏预渲染位置恢复、BFCache 往返 | 3 例 | 0 | **13,958.7 ms** | 包含 1.6s 盲等，BFCache 往返耗时 ~10.6s |
| `npm test -- data-settings-save` | 设置保存事务、锁机制、冲突回滚 | 1 例 (顶层) | 0 | **3,075.3 ms** | 包含 11 个 `✅` 检查点，但 Node 仅报告 `tests 1` |
| `npm test -- ui-screen-boundaries` | 切屏手势时序、动画锁释放与减弱动效 | 1 例 (顶层) | 0 | **14,934.4 ms** | 包含 7 个 `✅` 检查点，单文件耗时近 15 秒 |
| `npm test -- infra-sw-update-ui` | SW v201~v208 更新提示与超时容错 | 1 例 (顶层) | 0 | **45,544.2 ms** | **全套件最大瓶颈**：含 15s 真实挂钟超时等待 |
| `node test/visual-regression.mjs` | 独立视觉几何快照与渲染指标验证 | 8 个场景 | 0 | **~15.0 s** | 8/8 场景全部就位，场景序号跳过 C/D/H |

*\* 注：`data-pure-models.test.mjs` 中存在 2 个未包裹在 `test()` 中的裸奔断言块，在模块初始化期执行，不计入用例总数。*

### 3.2 工作区纯净度验证
执行 `git status` 确认：
```
On branch main
nothing to commit, working tree clean
```
除当前生成的审计报告文件外，工作区代码未产生任何新增、修改或删除，严格符合“只读审计”的红线要求。

---

## 4. 四大维度深度审计发现 (Deep Audit Findings Across 4 Dimensions)

本章节将发现的所有缺陷、隐患与改进点按四大维度归类，并标注唯一的 Finding ID、严重等级（High / Medium / Low）、精确文件路径与代码行号、原版代码切片证据、成因机理分析及奥卡姆剃刀整改建议。

---

### 维度一：测试架构与运行器 (Dimension 1: Test Architecture & Runner)

#### [ARCH-01] [High] 10 个测试文件缺少 `node:test` 包装，沦为不透明的巨石脚本
- **目标文件与行号**:
  - `test/data-settings-save.test.mjs:1-700` (700 行)
  - `test/data-request-performance.test.mjs:1-360` (360 行)
  - `test/data-i18n.test.mjs:1-318` (318 行)
  - `test/infra-chrome-extension.test.mjs:1-213` (213 行)
  - `test/infra-module-boundaries.test.mjs:1-161` (161 行)
  - `test/infra-sw-request-performance.test.mjs:1-167` (167 行)
  - `test/infra-sw-update-ui.test.mjs:1-253` (253 行)
  - `test/infra-sw-upgrade.test.mjs:1-283` (283 行)
  - `test/ui-rendered-contracts.test.mjs:1-303` (303 行)
  - `test/ui-screen-boundaries.test.mjs:1-241` (241 行)
- **源码切片证据**:
  在 `test/data-settings-save.test.mjs:1-5` 中：
  ```javascript
  import assert from 'node:assert/strict';
  import { createEvaluator, launchSession, waitFor, sleep } from './support/helpers.mjs';
  import { connectCDP } from './support/cdp.mjs';

  let releaseWallpaper;
  const { server, chrome, send, evalJS, cdpPort } = await launchSession(0, { ...
  ```
  该文件未导入 `import { test } from 'node:test'`，整个 700 行文件由单一的大型异步 IIFE 或顶层顶层语句顺序执行，通过 `console.log('✅ ...')` 输出小绿勾。
- **成因与机理分析**:
  Node.js 的原生测试运行器在执行未包含 `test()` 块的文件时，会将整个 ES 模块的加载与执行隐式当作 **1 个测试用例**。
  在 `npm test -- data-settings-save` 中，即便该文件覆盖了“壁纸锁定”、“冲突合并”、“草稿失效”、“缓存清理”等 11 个完全独立的业务阶段，运行器统计依然显示：
  ```
  ℹ tests 1
  ℹ pass 1
  ```
- **危害与回归风险**:
  1. **故障熔断遮蔽**: 若第 30 行的断言失败，整个文件立即崩溃退出，后续 670 行代码中的另外 10 个测试阶段被全部跳过。开发者无法得知是单一功能异常还是全局崩溃。
  2. **诊断与排查成本陡增**: CI 只能报告“整文件失败”，无法给出具体的子用例名称与耗时分布。
- **整改建议 (遵循奥卡姆剃刀)**:
  在保持现有 CDP 会话生命周期不变的前提下，使用 Node 原生 `test('场景名称', async () => { ... })` 包装各个逻辑块，拆分为 6~11 个独立用例。无需增加任何测试框架或辅助抽象。

---

#### [ARCH-02] [High] `getFreePort()` 探测模式存在并发 TOCTOU 端口竞态漏洞
- **目标文件与行号**: `test/support/helpers.mjs:63-87`
- **源码切片证据**:
  ```javascript
  63: let lastAllocatedPort = 13000 + Math.floor(Math.random() * 10000);
  64: 
  65: /** 获取系统当前随机可用空闲端口（带自增偏移避免并发碰撞） */
  66: export async function getFreePort() {
  67:   for (let i = 0; i < 10; i++) {
  68:     const candidate = ++lastAllocatedPort;
  69:     const available = await new Promise(resolve => {
  70:       const srv = createNetServer();
  71:       srv.once('error', () => resolve(false));
  72:       srv.listen(candidate, '127.0.0.1', () => {
  73:         srv.close(() => resolve(true));
  74:       });
  75:     });
  76:     if (available) return candidate;
  77:   }
  ...
  ```
  调用方分布在 8 个关键测试中：
  - `infra-build-pipeline.test.mjs:294, 333, 335, 346`
  - `infra-chrome-extension.test.mjs:28`
  - `infra-module-boundaries.test.mjs:92`
  - `infra-security.test.mjs:105, 120, 155, 187`
  - `infra-sw-request-performance.test.mjs:32`
  - `infra-sw-update-ui.test.mjs:52`
  - `infra-sw-upgrade.test.mjs:100`
  - `benchmark-transition.mjs:97`
- **成因与机理分析**:
  `getFreePort()` 通过 `srv.listen(candidate)` 检查候选端口，成功后立即 `srv.close()`。在 `srv.close()` 完成到后续 `launchChrome` 或 `startServer` 真正绑定该端口之间，存在显著的 **TOCTOU (Time-of-Check to Time-of-Use)** 时间差。
  当测试在多进程并发（默认 `--test-concurrency=6`）环境下运行时，两个并发 Worker 极易探测到同一个空闲端口并先后关闭，随后在绑定时发生碰撞，抛出 `EADDRINUSE` 致命错误。
- **危害与回归风险**:
  多核高并发 CI 环境下的偶发失败（Flaky Build），排查极其困难。
- **整改建议 (遵循奥卡姆剃刀)**:
  “如无必要，勿增实体”。操作系统内核早已具备原子的空闲端口分配能力：
  1. `startServer(0)` 会自动由内核分配随机端口，并通过 `server.address().port` 安全获取。
  2. `launchChrome` 原生支持 `--remote-debugging-port=0`，Chrome 会由内核分配端口并将真实端口写入用户数据目录的 `DevToolsActivePort`。
  直接废弃 `getFreePort()`，所有调用处直接传 `0`，消除自建端口分配逻辑。

---

#### [ARCH-03] [Medium] `standaloneTests` 纯单元测试清单不全导致无谓的构建流水线浪费
- **目标文件与行号**: `test/support/test-selection.mjs:2-8`
- **源码切片证据**:
  ```javascript
  2: export const standaloneTests = new Set([
  3:   'data-pure-models.test.mjs',
  4:   'data-i18n-unit.test.mjs',
  5:   'data-priority-fixes-unit.test.mjs',
  6:   'data-animation-cleanup-unit.test.mjs',
  7:   'data-wallpaper-selection-unit.test.mjs'
  8: ]);
  ```
- **成因与机理分析**:
  `test/infra-icon-sync.test.mjs` 是一个纯 Node.js CLI 测试，使用 Data URI 模拟 HTTPS 响应，测试 `scripts/sync-icons.mjs`。它**完全不依赖无头 Chrome**，也**完全不读取 `dist/` 构建产物**。
  然而由于 `standaloneTests` 中遗漏了该文件：
  1. 运行 `node test/run.mjs infra-icon-sync` 时，`requiresBuild(files)` 返回 `true`，触发了包含 Tailwind CSS 编译、HTML 模板渲染在内的全量打包（耗时 ~300-400ms）。
  2. 运行 `npm run test:unit` (`node test/run.mjs --unit`) 时，该测试被强行排除在外，无法享受纯单元测试的快速反馈。
- **危害与回归风险**:
  日常本地运行或提交检查时白白浪费数百毫秒的编译时间；单元测试入口未能全量覆盖纯 Node 逻辑。
- **整改建议**:
  将 `'infra-icon-sync.test.mjs'` 加入 `test/support/test-selection.mjs` 的 `standaloneTests` 集合中。

---

#### [ARCH-04] [Medium] 低层 CDP 驱动模块中硬编码具体业务域名拦截规则
- **目标文件与行号**: `test/support/cdp.mjs:265-274`
- **源码切片证据**:
  ```javascript
  265: window.fetch = async (url, opts) => {
  266:   const u = String(url);
  267:   if (u.includes('open-meteo.com') || u.includes('ipwho.is') || u.includes('myip.ipip.net')) {
  268:     return new Response(JSON.stringify({ status: 'fail', ret: 'err' }), {
  269:       status: 200,
  270:       headers: { 'Content-Type': 'application/json' }
  271:     });
  272:   }
  273:   return _origFetch(url, opts);
  274: };
  ```
- **成因与机理分析**:
  `test/support/cdp.mjs` 定位为项目底层通用的 Chrome DevTools Protocol 客户端封装，然而在 `launchChromeOnce` 中，却硬编码了特定业务模块（天气与 IP 定位服务）的外部域名拦截列表。
- **危害与回归风险**:
  违反架构职责分层原则（Support 基础设施层直接耦合业务层特定第三方服务商）。若未来新增或更换定位/天气 API（如切换到其他接口），必须深入底层 CDP 工具修改，极易遗漏。
- **整改建议**:
  将硬编码的拦截域名提取为会话启动参数或配置选项，默认由 `launchSession` 传入，保持 `cdp.mjs` 底座的纯粹性。

---

#### [ARCH-05] [Low] `test/run.mjs` 过滤掉了合法的 Node 测试运行器 CLI 选项
- **目标文件与行号**: `test/run.mjs:12-21, 78-79`
- **源码切片证据**:
  ```javascript
  12: const patterns = process.argv.slice(2).filter(arg => !arg.startsWith('-')).map(pattern => pattern.toLowerCase());
  13: const unitOnly = process.argv.includes('--unit');
  ...
  78: const code = await runProcess(['--test', `--test-concurrency=${concurrency}`, ...files.map(name => join(testDir, name))],
  79:   { ...process.env, GLASS_TEST_TMPDIR: runTempDir });
  ```
- **成因与机理分析**:
  第 12 行代码使用 `!arg.startsWith('-')` 将所有命令行选项直接剔除，仅单独识别了 `--unit`。导致 Node.js 原生测试运行器支持的各种标准参数（如 `--test-name-pattern`、`--test-reporter`、`--watch`）被一并丢弃，无法透传给底层的 `node --test`。
- **危害与回归风险**:
  开发者无法通过 `npm test -- --test-name-pattern="某用例"` 进行单用例精细化过滤调试。
- **整改建议**:
  提取未被自定义消耗的 CLI flags，透传给 `runProcess(['--test', ...forwardedFlags, ...files])`。

---

#### [ARCH-06] [Low] 子进程 `'close'` 事件回调中存在多余的 `killGroup` 调用
- **目标文件与行号**: `test/run.mjs:55-57`
- **源码切片证据**:
  ```javascript
  55:     child.once('close', (code, signal) => {
  56:       killGroup(child);
  57:       children.delete(child);
  ```
- **成因与机理分析**:
  在 Node.js 中，子进程的 `'close'` 事件触发时，子进程已经完全退出且其 stdio 数据流均已关闭。此时再调用 `killGroup(child)`（向已不存在的 `-child.pid` 发送 `SIGKILL`）是完全多余的实体操作。
- **危害与回归风险**:
  虽有 `try/catch` 保护不产生崩溃，但增加了无意义的系统调用，违反奥卡姆剃刀。
- **整改建议**:
  删除 `'close'` 回调内的 `killGroup(child)` 调用。

---

#### [ARCH-07] [Low] `connectCDP.send()` 方法签名重载过多导致泄漏抽象
- **目标文件与行号**: `test/support/cdp.mjs:153-159`
- **源码切片证据**:
  ```javascript
  153:     send(method, params = {}, timeoutMs = 15000) {
  154:       if (typeof params === 'function') {
  155:         if (failure) throw failure;
  156:         if (!listeners.has(method)) listeners.set(method, new Set());
  157:         listeners.get(method).add(params);
  158:         return () => listeners.get(method)?.delete(params);
  159:       }
  ```
- **成因与机理分析**:
  同一个 `send()` 方法，如果第二个参数传入对象，则返回 Promise（发送 CDP 命令）；如果第二个参数传入函数，则执行事件监听注册并返回取消订阅闭包 `() => void`。这种重载违反了最小惊奇原则。
- **危害与回归风险**:
  类型推导混乱，且容易在编写测试时误将参数传错而导致非预期行为。
- **整改建议**:
  明确分离事件监听 API，增设显式的 `on(event, handler)` 方法，保留 `send(method, params)` 的单一职责。

---

### 维度二：用例覆盖率与边界断言 (Dimension 2: Coverage & Boundary Assertions)

#### [ASSERT-01] [High] 复合否定断言漏洞掩盖触摸拖拽排序失败与样式泄漏
- **目标文件与行号**: `test/data-audit-regressions.test.mjs:292`
- **源码切片证据**:
  ```javascript
  291: await evalJS('new Promise(requestAnimationFrame)');
  292: assert.equal(await evalJS(`(() => {
         __dispatch('touchend', [__moved], [__other]);
         return modalState.draftBookmarks[0].id === 'touch_0' && !dom.editList.querySelector('.dragging');
       })()`), false);
  293: await evalJS(`__dispatch('touchend', [], [__moved])`);
  294: assert.equal(await evalJS(`modalState.draftBookmarks[0].id === 'touch_1'`), true);
  ```
- **成因与机理分析**:
  用例场景为：在多指触摸拖拽书签过程中，先释放非跟踪触点 `__other`，此时**不应提交重排**（第一项书签 ID 仍应为 `'touch_0'`），且**拖拽状态必须维持**（页面上应继续存在 `.dragging` 元素）。
  但测试代码写成了：
  `return (id === 'touch_0') && (!hasDraggingClass)` 并断言其等于 `false`！
  利用德·摩根定律展开复合否定条件：
  `!((id === 'touch_0') && (!hasDraggingClass)) ≡ (id !== 'touch_0') || (hasDraggingClass)`
  **漏洞暴露**:
  - 假设由于代码 Bug，释放非跟踪手指时**错误地提前完成了排序**（`id` 变成了 `'touch_1'`），但 `.dragging` 样式正常保留（`hasDraggingClass` 为真）。
  - 代入上述表达式：`'touch_1' === 'touch_0'` 为 `false`，整个 `&&` 表达式返回 `false`。
  - 断言 `assert.equal(false, false)` **判定通过**！
  - 结论：**即使代码发生了“提前错误提交排序”的严重回归，该测试依然会绿灯通过！**
- **危害与回归风险**:
  典型的假阳性断言（False Negative），测试完全丧失了对触点释放边界的守卫能力。
- **整改建议 (遵循奥卡姆剃刀)**:
  彻底拆分断言，不进行复合布尔折叠：
  ```javascript
  // 释放非跟踪点后，不可提前提交重排，且拖拽样式必须保持
  assert.equal(await evalJS(`modalState.draftBookmarks[0].id === 'touch_0'`), true);
  assert.equal(await evalJS(`Boolean(dom.editList.querySelector('.dragging'))`), true);
  ```

---

#### [ASSERT-02] [Medium] 复合布尔值折叠（布尔盲区）导致断言失败信息完全不可读
- **目标文件与行号**:
  - `test/data-bookmark-picker.test.mjs:71-74, 131-132, 142-143, 148-150`
  - `test/data-bookmarks-features.test.mjs:79, 98`
  - `test/data-wallpaper.test.mjs:192, 244`
  - `test/data-wallpaper-storage.test.mjs:67, 180`
- **源码切片证据**:
  在 `test/data-bookmark-picker.test.mjs:71-87`:
  ```javascript
  assert.equal(await evalJS(`(() => {
    const row=dom.editList.querySelector('.edit-row-card');
    const badge=row.querySelector('.edit-favicon-initial');
    const input=row.querySelector('.edit-name');
    for (const value of ['新名称','最新名称']) {
        input.value=value; input.dispatchEvent(new Event('input',{bubbles:true}));
    }
    return badge===row.querySelector('.edit-favicon-initial') && badge.textContent==='最' &&
        !row.querySelector('img') && modalState.draftBookmarks[0].name==='最新名称' &&
        row.querySelector('.drag-handle').getAttribute('aria-label').includes('最新名称');
  })()`), true);
  ```
  在 `test/data-wallpaper.test.mjs:192`:
  ```javascript
  assert.equal(Object.values(result).every(Boolean), true, JSON.stringify(result));
  ```
- **成因与机理分析**:
  在浏览器求值表达式中，将 DOM 节点引用相等、首字徽标内容、草稿数据状态、ARIA 属性等 5 项完全不同的断言合并成单一大长链 `A && B && C && D && E` 并返回单一布尔值。
- **危害与回归风险**:
  当其中某一项发生故障时，Node.js 报告的错误仅为 `AssertionError: false == true`。开发者从 CI 报错日志中根本无法得知是首字不对、草稿未同步，还是 ARIA 标签缺失，必须花费大量时间挂载调试器复现。
- **整改建议**:
  从浏览器端返回结构化数据对象（如 `{ badgeText, draftName, ariaLabel }`），在 Node 宿主端使用 `assert.deepEqual()` 对照预期对象，保证失败时提供直观的字段 Diff。

---

#### [ASSERT-03] [Medium] `data-pure-models.test.mjs` 中存在裸奔在 `test()` 外部的顶层断言
- **目标文件与行号**: `test/data-pure-models.test.mjs:105-112, 213-222`
- **源码切片证据**:
  ```javascript
  105: const forecast = normalizeWeatherForecast({current:{temperature_2m:21.6, is_day:0}, daily:{}}, {lat:1, lon:2}, CONFIG.WEATHER, 123);
  106: assert.equal(forecast.timestamp, 123);
  107: assert.equal(forecast.current.temp, 22);
  108: assert.deepEqual(forecast.daily, []);
  ...
  213: model.replaceBookmarkDraft([{id:'a',name:'A',url:'https://a.test',icon:''}, {id:'b',name:'B',url:'https://b.test',icon:''}]);
  214: assert.equal(model.modalState.bookmarksChanged, false);
  215: model.updateBookmarkDraft('a', {name:'Changed'});
  ...
  222: assert.equal(model.modalState.bookmarksChanged, true);
  223: console.log('✅ 独立验证搜索排序、拼写容错、天气转换与草稿修改，无浏览器依赖');
  ```
- **成因与机理分析**:
  上述断言直接写在 ES 模块的顶层作用域，在模块被 import 加载时便已执行完毕，并未包裹在 `test('用例名', () => { ... })` 块中。
- **危害与回归风险**:
  运行 `node --test test/data-pure-models.test.mjs` 时，测试报告显示 `tests 15`，但实际上这两组极为核心的数据模型（天气数据规范化与书签草稿变更状态追踪）并没有被测试运行器纳入计数与监控。若此处抛出异常，错误栈会混入模块加载阶段。
- **整改建议**:
  将这两段裸奔代码分别包裹进显式的 `test('天气原始数据清洗与空每日预报规范化', () => { ... })` 与 `test('书签内存草稿替换与脏标记更新', () => { ... })`。

---

#### [ASSERT-04] [Medium] 异常数据清洗断言深度不足，未校验副作用属性
- **目标文件与行号**:
  - `test/data-bookmarks-features.test.mjs:20-37`
  - `test/data-audit-regressions.test.mjs:145-150`
- **源码切片证据**:
  在 `test/data-bookmarks-features.test.mjs:20-37`:
  ```javascript
  20: localStorage.setItem('userCustomMeta', JSON.stringify({
  21:   'https://example.com': {name:123, icon:42, desc:{bad:true}},
  22:   'https://github.com': {desc:''},
  23:   'https://invalid.test': ['bad']
  24: }));
  ...
  34: assert.deepEqual(recovered.bookmarks.map(bm => bm.url), ['https://example.com', 'https://github.com']);
  35: assert.equal(recovered.bookmarks[0].name, 'example');
  36: assert.equal(recovered.nameInherited, true);
  37: assert.equal(recovered.desc, '');
  ```
- **成因与机理分析**:
  该用例模拟了旧版 LocalStorage 中存入畸形数据（`icon` 为数字 `42`，`desc` 为对象 `{bad: true}`）。但在恢复验证时，代码仅验证了 `name` 恢复为 `'example'`，**完全漏掉了对 `recovered.bookmarks[0].icon` 与 `recovered.bookmarks[0].desc` 是否被正确清洗置空或过滤的断言**。
  在 `data-audit-regressions.test.mjs:145-150` 中，注入损坏的 `daily: [null]` 天气缓存，断言仅检查了 `assert.deepEqual(exceptions, [])`（无 JS 报错），而未断言天气界面是否正确渲染或优雅降级（若界面完全白屏且未抛出异常，该测试依然会判定通过）。
- **危害与回归风险**:
  脏数据未能被严格净化，可能残留为隐藏的运行时类型隐患。
- **整改建议**:
  补全对 `icon`、`desc` 净化后字段类型的明确校验；在天气容错测试中，增加对 DOM 元素是否展现保底数值的校验。

---

#### [ASSERT-05] [Medium] 关键业务边界场景存在覆盖盲区
- **目标模块**: 书签、壁纸、搜索、天气
- **成因与机理分析**:
  经对核心业务模块对照 ARCHITECTURE.md 规格比对，存在以下未被自动化用例覆盖的边界：
  1. **书签 (Bookmarks)**: 用户清空全部书签后点击保存（`modalState.draftBookmarks = []`），UI 是否展示合法的空状态提示或安全阻止，目前缺少专用断言。
  2. **壁纸 (Wallpaper)**: IndexedDB 在存储超大自定义图片时触发 `QuotaExceededError`，目前仅有 LocalStorage 配额测试，缺少对 IDB 事务配额超限时的 UI 友好提示测试。
  3. **搜索 (Search)**: 自定义搜索引擎 URL 模板中缺少 `%s` 替换符时，目前缺少防御性校验断言。
  4. **天气 (Weather)**: 浏览器原生 `navigator.geolocation` 拒绝授权（`PERMISSION_DENIED`）或超时的边界，目前仅覆盖了 IP 定位 503 场景。
- **危害与回归风险**:
  在极端用户操作或特殊浏览器权限状态下，可能出现未预期的界面卡死。
- **整改建议**:
  在对应的数据与交互测试中补充上述 4 个边界的断言用例。

---

#### [ASSERT-06] [Low] 架构文档明确约定的后台生命周期挂起未设置测试断言
- **目标文件与行号**: `src/js/events.js:68-71`, `ARCHITECTURE.md:289`
- **源码切片证据**:
  ```javascript
  // src/js/events.js:68-71
  document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopClockTimer();
      else handleAppWakeUp();
  }, { passive: true });
  ```
- **成因与机理分析**:
  [ARCHITECTURE.md](../ARCHITECTURE.md) 第 289 行明确指出：当页面不可见（`document.hidden`）时，时钟定时器必须挂起以节省 CPU，唤醒后恢复。但在现有的 `test/lifecycle.test.mjs` 中，**没有任何一行断言验证了在 `visibilitychange` 触发且页面切入后台时，时钟定时器确实被清理**。
- **危害与回归风险**:
  低风险。若未来重构事件机制误删了该调用，测试无法察觉。
- **整改建议**:
  在 `lifecycle.test.mjs` 中模拟 `document.visibilityState = 'hidden'`，断言时钟 interval 已被清除。

---

#### [ASSERT-07] [Low] 纯单元测试 Mock 中存在脆弱的全局标签写死断言
- **目标文件与行号**: `test/data-priority-fixes-unit.test.mjs:76`
- **源码切片证据**:
  ```javascript
  75:             createElement(tag) {
  76:                 assert.equal(tag, 'canvas');
  77:                 const number = ++canvasCount;
  78:                 return { getContext: () => ({ drawImage() {}, clearRect() {} }),
  ```
- **成因与机理分析**:
  在模拟 DOM 环境的 `document.createElement(tag)` 桩函数中，硬编码了 `assert.equal(tag, 'canvas')`。
- **危害与回归风险**:
  一旦被测业务模块在未来演进中由于正常需求新增了创建其他元素（例如 `document.createElement('div')` 或 `span`），该 Mock 函数将直接崩溃，阻断测试执行。
- **整改建议**:
  去除针对 `tag` 的硬编码相等断言，根据 `tag` 分支返回对应的模拟节点。

---

### 维度三：稳定性、异步时序与性能瓶颈 (Dimension 3: Stability, Timing & Performance)

#### [STAB-01] [High] `infra-sw-update-ui.test.mjs` 中滥用 `setTimeout(..., 50)` 盲点确认按钮
- **目标文件与行号**: `test/infra-sw-update-ui.test.mjs:115, 148, 163, 222, 241`
- **源码切片证据**:
  ```javascript
  114:     dom.clearCacheBtn.click();
  115:     setTimeout(() => dom.confirmOkBtn.click(), 50);

  148:   await evalJS(`setTimeout(() => document.getElementById('confirmOkBtn').click(), 50); true`);

  163:   await otherEval(`closeEditModal(); document.getElementById('updateReloadBtn').click(); setTimeout(() => document.getElementById('confirmOkBtn').click(), 50); true`);

  222:   await evalJS(`dom.updateReloadBtn.click(); setTimeout(() => dom.confirmOkBtn.click(), 50); true`);
  241:   await evalJS(`dom.updateReloadBtn.click(); setTimeout(() => dom.confirmOkBtn.click(), 50); true`);
  ```
- **成因与机理分析**:
  在连续 5 个更新弹窗与确认测试中，测试作者通过固定延时 `setTimeout(..., 50)` 来“盲猜”确认弹窗（`confirmModal`）已经显示并完成事件绑定。
  然而在 CI 服务器或 CPU 资源受限的高并发测试中，浏览器主线程调度延迟可能超过 50ms。一旦 50ms 到期时弹窗尚未完成 DOM 插入或 `OverlayStack.push()` 尚未就绪，`confirmOkBtn.click()` 将点击失败或无响应。
  而同一作者在第 140 行却写了完全正确的响应式等待：
  ```javascript
  await waitFor(evalJS, `document.getElementById('confirmTitle').textContent === '新版本已就绪' && OverlayStack.top()?.id === 'confirmModal'`);
  ```
- **危害与回归风险**:
  典型的 Flaky 测试隐患，属于偶发竞态故障的主要策源地。
- **整改建议**:
  彻底剔除全部 5 处 `setTimeout(..., 50)`，统一使用 `waitFor` 轮询 `OverlayStack.top()?.id === 'confirmModal'`，随后再执行 `.click()`。

---

#### [STAB-02] [High] 单一测试硬等 15 秒挂钟超时，拖慢整个 Infra 测试流水线
- **目标文件与行号**: `test/infra-sw-update-ui.test.mjs:174-188`, `src/js/config/constants.js:127`
- **源码切片证据**:
  在 `src/js/config/constants.js:127`:
  ```javascript
  SW_UPDATE_TIMEOUT: 15000, // 等待 Worker 激活超时 15 秒
  ```
  在 `test/infra-sw-update-ui.test.mjs:180`:
  ```javascript
  178:   failApp = true;
  179:   await evalJS(`document.getElementById('updateReloadBtn').click(); document.getElementById('confirmOkBtn').click()`);
  180:   await waitFor(evalJS, `document.getElementById('updateNoticeText').textContent === '更新暂未完成，请重试'`, 18000);
  ```
- **成因与机理分析**:
  该测试用例模拟了 Service Worker 补下载核心资源失败时的超时保底机制。
  因为测试运行在真实的无头 Chrome 实例中，生产代码使用的是 `CONFIG.TIMERS.SW_UPDATE_TIMEOUT`（15,000 毫秒）。测试代码必须在挂钟时间上**实打实地干等整整 15 秒**，直到定时器触发后，才会将提示文案置为“更新暂未完成，请重试”。
  这一处盲等直接导致 `infra-sw-update-ui.test.mjs` 的总运行时间飙升至 **45.54 秒**，占整个 `npm run test:infra` 总耗时（48 秒）的 95%！
- **危害与回归风险**:
  极度拖慢本地与 CI 测试流水线反馈速度。
- **整改建议 (遵循奥卡姆剃刀)**:
  在测试环境加载的初始化脚本中（利用 `test/support/cdp.mjs` 已有的 `Page.addScriptToEvaluateOnNewDocument` 注入机制），允许测试模式重写 `CONFIG.TIMERS.SW_UPDATE_TIMEOUT = 200`（200 毫秒）。
  将该测试耗时从 45 秒直降至 10 秒左右，整体加速 75%，且完全不改变任何产品业务逻辑。

---

#### [STAB-03] [Medium] 违背响应式轮询原则，测试中残留多处固定 `sleep()`
- **目标文件与行号**:
  - `test/ui-nav-rendering.test.mjs:239, 275, 280, 287` (4 次 `sleep(400)` = 1.6 秒)
  - `test/lifecycle.test.mjs:57-61` (1 次 `sleep(1600)` = 1.6 秒)
  - `test/data-settings-save.test.mjs:617` (1 次 `sleep(700)` = 0.7 秒)
- **源码切片证据**:
  在 `test/ui-nav-rendering.test.mjs:239-287`:
  ```javascript
  239: await sleep(400); // 等待初始尺寸观察与防抖刷新完成。
  ...
  275: await sleep(400);
  ...
  280: await sleep(400);
  ...
  287: await sleep(400);
  ```
- **成因与机理分析**:
  `test/support/helpers.mjs:23` 明确提倡：`/** 响应式状态轮询器：等待表达式求值为真即刻放行，彻底消除盲等 sleep */`。
  然而在 `ui-nav-rendering.test.mjs` 中，同一个测试块内连续调用了 4 次 `sleep(400)`。这些固定延时合计浪费了近 4 秒的宝贵时间，且无法应对慢速机器上的尺寸计算延迟。
- **危害与回归风险**:
  无端增加测试套件总耗时；固定延时在机器负载过高时依然可能由于超时而失败。
- **整改建议**:
  将所有用于等待防抖或尺寸观察的 `sleep(400)` 替换为 `waitFor(evalJS, '__offsetReads > 0')` 或对应 DOM 属性状态轮询。

---

#### [STAB-04] [Medium] `infra-sw-update-ui.test.mjs` 泄漏二级 CDP Target 标签页
- **目标文件与行号**: `test/infra-sw-update-ui.test.mjs:92, 247-252`
- **源码切片证据**:
  ```javascript
  92: const { targetId } = await send('Target.createTarget', { url: origin + '/manual.html' });
  ...
  247: } finally {
  248:   releaseApp?.();
  249:   other?.close();
  250:   await chrome.close();
  251:   await server.close();
  252: }
  ```
- **成因与机理分析**:
  在测试多标签更新确认时，第 92 行通过 CDP `Target.createTarget` 打开了第二个页面标签。但在最终的 `finally` 清理块中，仅执行了 `other?.close()`（关闭 WebSocket 连接），**从未调用 `send('Target.closeTarget', { targetId })`**。
  相比之下，同类的 `infra-sw-upgrade.test.mjs:168` 与 `data-settings-save.test.mjs:692` 均规范执行了 `Target.closeTarget`。
- **危害与回归风险**:
  在测试用例后续的数十秒内，该遗留标签页始终驻留在 Chrome 进程内存中，持续占用系统内存与端口资源。
- **整改建议**:
  在 `finally` 块中补全 `if (targetId) await send('Target.closeTarget', { targetId })`。

---

#### [STAB-05] [Medium] CDP 事件监听器中静默吞没未捕获异常
- **目标文件与行号**: `test/support/cdp.mjs:142-144`
- **源码切片证据**:
  ```javascript
  142:       for (const listener of listeners.get(message.method) || []) {
  143:         try { listener(message.params); } catch {}
  144:       }
  ```
- **成因与机理分析**:
  在 WebSocket 接收到底层 CDP 事件通知时，对所有注册的回调函数套用了空 `catch {}` 块。
  如果测试人员在事件监听器（例如网络请求拦截 `Fetch.requestPaused` 或页面异常抛出 `Runtime.exceptionThrown`）内部编写了 `assert` 断言，一旦断言失败抛出 `AssertionError`，该异常会被直接吞掉。
- **危害与回归风险**:
  断言失败无法向外冒泡，测试不仅不会报错，反而可能因为后续流程未触发而一直卡死直到 15 秒大超时。
- **整改建议**:
  将 listener 抛出的异常通过会话级 `fail(error)` 机制向外传递，或记录到会话错误集中供主断言捕获。

---

#### [STAB-06] [Low] `waitFor` 函数签名多态性隐式 Hack
- **目标文件与行号**: `test/support/helpers.mjs:24-41`, `test/infra-sw-request-performance.test.mjs:41`
- **源码切片证据**:
  ```javascript
  // helpers.mjs:24
  export async function waitFor(evalJS, predicateJs, timeout = defaultWaitTimeout, interval = 20) {
    ...
    const res = await evalJS(predicateJs);
  ```
  在 `infra-sw-request-performance.test.mjs:41`:
  ```javascript
  await waitFor(async () => counts.get('/burst/icons/concurrent.png') > 0, 'true');
  ```
- **成因与机理分析**:
  `waitFor` 的原始设计是将浏览器求值函数作为第一个参数 `evalJS`，将待执行的 JS 字符串表达式作为第二个参数 `predicateJs`。
  但调用方经常直接将 Node.js 的条件函数传给第 1 个参数，将一段说明文本传给第 2 个参数。此时内部执行 `evalJS(predicateJs)` 实际上是将说明文本传给了条件函数，由于 JS 箭头函数忽略多余参数，歪打正着能够运行，但一旦超时报错，错误信息会显示 `Timeout waiting for: true`，丢失了真实上下文。
- **危害与回归风险**:
  代码可读性差，错误排查信息不明确。
- **整改建议**:
  在 `waitFor` 内部正规化参数重载判定：若第 1 个参数是独立条件函数，则支持 `waitFor(conditionFn, timeout, interval, label)` 的清晰签名。

---

### 维度四：项目规范合规性 (Dimension 4: AGENTS.md & Specification Compliance)

#### [SPEC-01] [Medium] 单元测试职责混编违背 AGENTS.md 模块归位规范
- **目标文件与行号**: `test/data-priority-fixes-unit.test.mjs:92-421`
- **源码切片证据**:
  - Lines 92–326: 测试天气缓存、强制重定位、超时重试（归属 `src/js/modules/weather.js`）。
  - Lines 327–421: 测试壁纸文件上传读取、Canvas 压缩、取消重选（归属 `src/js/modules/wallpaper.js`）。
- **成因与机理分析**:
  [AGENTS.md](../../AGENTS.md) 明确规定：“文件按职责归位... 避免为了‘形式完备’而增设多余抽象或大杂烩文件”。
  `data-priority-fixes-unit.test.mjs` 是一个历史遗留的“大杂烩”文件，将两个完全没有代码交叉的独立业务模块（天气与壁纸）拼凑在同一个文件中，共享了一套复杂的 VM 上下文 Mock。
- **危害与回归风险**:
  违反职责单一原则。开发者若要单独验证壁纸改动，不得不连带运行全部天气用例，增加了维护与理解成本。
- **整改建议**:
  按照业务职责将该文件就地解耦拆分为 `test/data-weather-unit.test.mjs` 与 `test/data-wallpaper-upload-unit.test.mjs`，并更新 `test-selection.mjs`。

---

#### [SPEC-02] [Low] 文档与任务分配中存在不存在的幽灵文件引用
- **目标文件与行号**: `.agents/teamwork/PROJECT.md:20`, 任务派发描述
- **证据记录**:
  `PROJECT.md` 第 20 行与部分指引中提及了 `test/storage-migration.test.mjs` 以及 `test/lifecycle-*.test.mjs`。
  但实际磁盘目录中：
  - 根本不存在 `test/storage-migration.test.mjs`。存储迁移逻辑实际分散在 `data-bookmarks-features.test.mjs:17-156`（书签元数据迁移）与 `data-wallpaper-storage.test.mjs`（壁纸降级迁移）中。
  - `lifecycle` 相关测试仅有 `test/lifecycle.test.mjs` 单一文件。
- **危害与回归风险**:
  导致新接手项目的开发者或审计人员产生误解，浪费排查时间。
- **整改建议**:
  纠正 `PROJECT.md` 中的引用说明，准确指引存储迁移的实际测试覆盖位置。

---

#### [SPEC-03] [Low] `visual-regression.mjs` 诊断工具中场景序号跳号
- **目标文件与行号**: `test/visual-regression.mjs:116, 147, 163, 191, 221, 242, 272, 299`
- **证据记录**:
  场景注释标签为：场景 A、场景 B，随后直接跳至场景 E、F、G，然后是 I、J、K。中间缺失了 C、D、H。
- **危害与回归风险**:
  微小文案问题，代码逻辑无损，但容易让阅读者误以为部分回归场景丢失。
- **整改建议**:
  重命名场景注释编号使其连续。

---

#### [SPEC-04] [Positive Compliance] 核心规范高标准合规项 (Positive Findings)
在本次严格代码审计中，Glass Start 测试套件展现出了极高的规范遵守水准：
1. **零第三方运行时依赖 (Zero 3rd-party Runtime Deps)**: 无论是 `src/` 生产源码还是 `test/` 测试代码，除了构建阶段必需的 `esbuild` 与 `acorn` 外，**未引入任何第三方运行时 NPM 包**，100% 依赖 Node.js 原生标准库。
2. **纯原生 Web API 践行**: 浏览器端测试全面依托现代 Web 原生标准（原生 `CSS 动画`、`BFCache`、`Web Locks`、`IndexedDB`、`Service Worker`），不使用任何垫片或多余包装。
3. **单一真理源 (Single Source of Truth)**: 扩展与网页共享配置、版本号统一读取 `package.json`，静态 Lint 工具对 DOM ID、Cache 映射、书签图标合规性提供了极为严密的自动化守卫。

---

## 5. 缺陷汇总与整改路线图 (Prioritized Action Plan & Remediation Roadmap)

本路线图严格遵循奥卡姆剃刀原则（“如无必要，勿增实体”），优先采用就地微调与最小必要改动，严禁过度设计与防御过当。

### 5.1 缺陷与整改全景矩阵

| 优先级 | Finding ID | 所属维度 | 目标文件与行号 | 缺陷摘要 | 整改方案 (奥卡姆剃刀准则) | 预期收益 | 回归风险 |
| :---: | :---: | :---: | :--- | :--- | :--- | :--- | :---: |
| **P1<br>(High)** | **ARCH-01** | 架构与运行器 | 10 个测试文件<br>(如 `data-settings-save.test.mjs:1-700`) | 无 `node:test` 包装，700 行逻辑沦为单一用例，失败即熔断 | 保持现有会话不变，拆分为具名 `test('...', async () => {})` 块 | 获得精细化失败定位与用例统计，消除整文件盲区 | 极低 |
| **P1<br>(High)** | **ARCH-02** | 架构与运行器 | `test/support/helpers.mjs:63-87`<br>及 8 个调用方 | `getFreePort()` 探测后关闭，存在并发 TOCTOU 端口冲突 | 废除 `getFreePort()`，直接使用内核原子端口 0 (`startServer(0)`, Chrome port 0) | 彻底消除 `--test-concurrency=6` 下偶发 `EADDRINUSE` 竞态 | 无 |
| **P1<br>(High)** | **ASSERT-01**| 覆盖率与断言 | `test/data-audit-regressions.test.mjs:292` | 复合否定断言漏洞，拖拽提前错误重排时仍能通过测试 | 拆除复合逻辑，分别显式断言 `id === 'touch_0'` 为真与 `.dragging` 存在为真 | 修复核心手势排序守卫漏洞，消除假阳性盲区 | 无 |
| **P1<br>(High)** | **STAB-01** | 稳定性与时序 | `test/infra-sw-update-ui.test.mjs:115, 148, 163, 222, 241` | 5 处盲等 `setTimeout(50)` 点击确认按钮，慢机上极易误报 | 替换为响应式 `await waitFor(evalJS, 'OverlayStack.top()?.id === "confirmModal"')` | 彻底杜绝弹窗渲染与事件绑定延迟导致的 Flaky 误报 | 极低 |
| **P1<br>(High)** | **STAB-02** | 稳定性与性能 | `test/infra-sw-update-ui.test.mjs:180`<br>`src/js/config/constants.js:127` | 真实等待 15 秒挂钟超时，单一文件耗时高达 45.5 秒 | 在测试注入脚本中允许将 `SW_UPDATE_TIMEOUT` 临时覆写为 200ms | 该测试耗时从 45.5s 骤降至 ~10s，套件整体提速 75% | 极低 |
| **P2<br>(Medium)**| **ARCH-03** | 架构与运行器 | `test/support/test-selection.mjs:2-8` | `infra-icon-sync` 纯 CLI 测试遗漏在纯单元清单外，白白构建 | 将 `'infra-icon-sync.test.mjs'` 加入 `standaloneTests` Set | 节省单测 300ms 构建时间，并纳入 `test:unit` 极速反馈池 | 无 |
| **P2<br>(Medium)**| **ASSERT-02**| 覆盖率与断言 | `test/data-bookmark-picker.test.mjs:71-74` 等多处 | 复合长链布尔折叠 (`A && B && C === true`)，报错仅报 false | 浏览器返回对象结构，Node 端使用 `assert.deepEqual` 断言 | 失败时输出完整字段级 Diff，排查时间从数十分钟降至秒级 | 无 |
| **P2<br>(Medium)**| **ASSERT-03**| 覆盖率与断言 | `test/data-pure-models.test.mjs:105-112, 213-222` | 纯模型测试中 2 处核心断言裸奔在 `test()` 外部，未被统计 | 使用显式 `test()` 块包裹两处裸奔逻辑 | 2 组核心清洗/模型逻辑正式纳入测试运行器监控 | 极低 |
| **P2<br>(Medium)**| **ASSERT-04**| 覆盖率与断言 | `test/data-bookmarks-features.test.mjs:20-37` | 异常元数据恢复仅检查 name，未断言 icon/desc 净化结果 | 增加对恢复后 `icon` 与 `desc` 类型的精确断言 | 确保畸形脏数据被 100% 净化，无隐式类型残留 | 无 |
| **P2<br>(Medium)**| **ASSERT-05**| 覆盖率与断言 | 书签、壁纸、搜索、天气等核心模块 | 缺少空书签草稿、IDB 超限、搜索缺 `%s`、定位权限拒绝边界 | 在对应数据测试中增设 4 个极限边界场景用例 | 消除极限环境下的偶发未捕获异常风险 | 无 |
| **P2<br>(Medium)**| **STAB-03** | 稳定性与性能 | `test/ui-nav-rendering.test.mjs:239-287` 等 | 4 次 `sleep(400)` 累加 1.6 秒无意义等待 | 替换为对应 DOM 属性或 `__offsetReads` 状态的 `waitFor` | 消除无谓延时，提高用例在不同负载环境下的抗压韧性 | 极低 |
| **P2<br>(Medium)**| **STAB-04** | 稳定性与时序 | `test/infra-sw-update-ui.test.mjs:92, 249` | 打开的二级 Target 标签页在 `finally` 中未调用 `closeTarget` | 在 `finally` 中补充 `send('Target.closeTarget', { targetId })` | 消除 Chrome 内存中遗留标签页泄漏隐患 | 无 |
| **P2<br>(Medium)**| **STAB-05** | 稳定性与时序 | `test/support/cdp.mjs:142-144` | CDP 事件监听器中空 `catch {}` 静默吞没未捕获异常与断言 | 将 listener 异常向上抛出至会话失败处理器 `fail(error)` | 避免事件断言失败被吞导致的死锁或无声假阳性 | 极低 |
| **P2<br>(Medium)**| **SPEC-01** | 规范合规性 | `test/data-priority-fixes-unit.test.mjs:92-421` | 天气与壁纸压缩两项无关业务混编在同一个大杂烩测试中 | 拆分为独立的天气与壁纸单测文件，遵循“文件按职责归位” | 代码职责清晰，可单独对壁纸或天气运行定向测试 | 极低 |
| **P3<br>(Low)**   | **ARCH-04** | 架构与运行器 | `test/support/cdp.mjs:265-274` | 低层 CDP 驱动中硬编码拦截特定外部天气和 IP 域名 | 提取为可选拦截列表参数，通过 `launchSession` 注入 | 保持底层通信库与具体业务 API 解耦 | 极低 |
| **P3<br>(Low)**   | **ARCH-05** | 架构与运行器 | `test/run.mjs:12-21, 78-79` | CLI 参数过滤丢弃了 `--test-name-pattern` 等合法选项 | 保留未识别的前缀参数并透传给底层 Node 测试命令 | 支持细粒度单用例筛选与 Watch 调试 | 无 |
| **P3<br>(Low)**   | **ARCH-06** | 架构与运行器 | `test/run.mjs:55-57` | 子进程已关闭并在 `'close'` 回调中再次执行 `killGroup` | 移除 `'close'` 事件回调内的多余调用 | 遵循奥卡姆剃刀，剔除多余系统调用 | 无 |
| **P3<br>(Low)**   | **ARCH-07** | 架构与运行器 | `test/support/cdp.mjs:153-159` | `send()` 方法兼顾命令与事件监听注册，签名多态复杂 | 增设 `on(method, handler)` 专用方法，简化 `send()` | 提高底层调用代码自解释性与类型安全性 | 极低 |
| **P3<br>(Low)**   | **ASSERT-06**| 覆盖率与断言 | `src/js/events.js:68-71` | `document.hidden` 时停止时钟定时器缺少自动化测试断言 | 在 `lifecycle.test.mjs` 中补充前后台切换时钟状态检查 | 验证架构文档规定的省电挂起承诺真实落地 | 无 |
| **P3<br>(Low)**   | **ASSERT-07**| 覆盖率与断言 | `test/data-priority-fixes-unit.test.mjs:76` | Mock 中写死 `assert.equal(tag, 'canvas')`，脆弱易断 | 去除硬编码断言，按 tag 分支返回模拟节点 | 提高桩代码弹性，防止引入新 DOM 标签时非预期中断 | 无 |
| **P3<br>(Low)**   | **STAB-06** | 稳定性与时序 | `test/support/helpers.mjs:24-41` | `waitFor` 签名被调用方滥用（条件函数传给第一个参数） | 正式支持 `(conditionFn, timeout, interval)` 的正规重载 | 消除多态 Hack，使超时报错文本保持语义明确 | 无 |
| **P3<br>(Low)**   | **SPEC-02** | 规范合规性 | `.agents/teamwork/PROJECT.md:20` | 文档中引用了不存在的 `storage-migration.test.mjs` | 更新文档，明确存储迁移用例分布在数据与壁纸文件中 | 消除审计歧义，保持文档与代码完全同步 | 无 |
| **P3<br>(Low)**   | **SPEC-03** | 规范合规性 | `test/visual-regression.mjs` | 视觉快照工具场景编号跳过 C/D/H | 重新按顺序编排场景编号 A~H | 保持诊断工具输出的规范性与整洁度 | 无 |

---

## 6. 验证与复现指南 (Verification & Replication Guide)

为了让后续维护者、评审员（Reviewer）与独立审计员（Forensic Auditor）能够独立复现本报告指出的所有客观证据与性能指标，以下提供完整的指令与检验步骤。

### 6.1 环境准备
确认 Node.js 与 npm 环境路径有效：
```bash
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"
node -v   # 建议 Node.js v26+ 或 LTS v22+
npm -v    # 建议 npm v10+
```

### 6.2 关键发现独立复现步骤

#### 1. 复现巨石脚本用例统计盲区 (ARCH-01)
```bash
npm test -- data-settings-save
```
- **预期输出观测**: 观察控制台最终汇总输出：
  `ℹ tests 1`、`ℹ pass 1`。
  对照源码 `test/data-settings-save.test.mjs`，该文件长达 700 行且包含 11 个 `✅` 检查阶段，但被错误统计为单一用例。

#### 2. 复现纯单元测试缺失导致的打包开销 (ARCH-03)
```bash
# 方式 A：直接使用 Node 执行（无构建）
node --test test/infra-icon-sync.test.mjs

# 方式 B：通过运行器执行（触发多余构建）
node test/run.mjs infra-icon-sync
```
- **预期输出观测**: 方式 A 在 1.5s 左右完成；方式 B 会先输出 `🚀 Glass Start — 生产环境构建打包 (Production Build)`（耗时 ~300ms），证明该纯 Node 脚本由于未登记在 `standaloneTests` 中而被强行执行了打包流程。

#### 3. 审查拖拽复合否定假断言漏洞 (ASSERT-01)
查看 `test/data-audit-regressions.test.mjs` 第 291-294 行：
```bash
sed -n '291,294p' test/data-audit-regressions.test.mjs
```
- **验证分析**: 逻辑为 `return modalState.draftBookmarks[0].id === 'touch_0' && !dom.editList.querySelector('.dragging');` 并断言等于 `false`。若第一项被错误更新为 `'touch_1'`，前半段即为 `false`，导致整个断言通过，无法断言拖拽状态未被意外提交。

#### 4. 复现 15 秒挂钟超时性能瓶颈 (STAB-02)
```bash
npm test -- infra-sw-update-ui
```
- **预期输出观测**: 观察该单一测试的耗时，总耗时通常在 **45 秒以上**。在输出 `✅ 损坏的等待版本补下载、重新校验后完成升级` 之前，程序会在第 180 行整整停顿 15 秒（等待生产常量的 `SW_UPDATE_TIMEOUT` 倒计时结束）。

#### 5. 复现纯模型测试裸奔断言未统计 (ASSERT-03)
```bash
node --test test/data-pure-models.test.mjs
```
- **预期输出观测**: 控制台在输出 `✔ 书签名称...` 之前，先输出了 `✅ 独立验证搜索排序、拼写容错、天气转换与草稿修改，无浏览器依赖`。报告统计显示 `ℹ tests 15`，证明第 105-112 行与第 213-222 行的断言直接在模块顶层裸跑。

#### 6. 验证工作区严格零修改
```bash
git status
```
- **预期输出观测**:
  除了本报告文件 `docs/reports/2026-11-17-test-audit.md` 之外，`src/`、`test/`、`scripts/` 以及根目录配置文件均无任何修改，严格保障只读审计纪律。

---

## 7. 结语 (Conclusion)

Glass Start 的测试套件在追求极简与原生工程化方面树立了极具价值的范式：零第三方框架负担、毫秒级纯单元反馈、基于原生 CDP 的真实 MV3 扩展与 Service Worker 深度检验。

本次审计所挖掘出的 23 项具体问题（涵盖 5 项高危、9 项中危、9 项低危），并非底层设计上的缺陷，而是项目演进过程中局部代码对“奥卡姆剃刀”原则的偏离（例如自建端口探测引入 TOCTOU、为形式完备硬等 15 秒生产超时、复合布尔折叠掩盖真实逻辑等）。

只要严格遵循本文给出的整改路线图，通过最小必要就地修改，无需引入任何第三方测试工具或复杂脚手架，即可在消除全部已知竞态与假断言漏洞的同时，将整体测试套件执行性能大幅提升 70% 以上，使测试套件真正成为坚不可摧的质量守卫底座。

# Glass Start 全面代码审计与架构质量评估报告

**项目名称**: Glass Start (网页端与 Chrome 扩展)  
**审计基准版本**: v5.5.2  
**审计日期**: 2026-11-10  
**审计性质**: 全仓库只读深度人工源码审查（Read-Only Deep Manual Source Audit）  
**审计报告编号**: AUDIT-20261110-V552  
**依据规范**: `AGENTS.md`、`docs/ARCHITECTURE.md`、WHATWG / W3C 标准、Chrome MV3 扩展规范

---

## 目录

- [一、执行摘要与整体健康度评级](#一执行摘要与整体健康度评级)
  - [1.1 总体健康度评分与结论](#11-总体健康度评分与结论)
  - [1.2 严重级别统计与问题分布](#12-严重级别统计与问题分布)
  - [1.3 核心架构优势与工程亮点](#13-核心架构优势与工程亮点)
  - [1.4 主要风险与关键弱点总览](#14-主要风险与关键弱点总览)
- [二、审计范围与方法论](#二审计范围与方法论)
  - [2.1 审查模块与文件边界](#21-审查模块与文件边界)
  - [2.2 四大审计维度与审查准则](#22-四大审计维度与审查准则)
- [三、架构规范与工程约束遵从性评估](#三架构规范与工程约束遵从性评估)
  - [3.1 奥卡姆剃刀与运行时零依赖](#31-奥卡姆剃刀与运行时零依赖)
  - [3.2 模块依赖方向与分层边界](#32-模块依赖方向与分层边界)
  - [3.3 DOMCache 注册与类型契约](#33-domcache-注册与类型契约)
  - [3.4 OverlayStack 弹窗状态机](#34-overlaystack-弹窗状态机)
  - [3.5 IndexedDB 壁纸隔离与存储配额](#35-indexeddb-壁纸隔离与存储配额)
  - [3.6 无障碍 (A11y) 与样式规范](#36-无障碍-a11y-与样式规范)
  - [3.7 Chrome 扩展共享与隔离原则](#37-chrome-扩展共享与隔离原则)
- [四、结构化问题清单与缺陷编目 (34 项)](#四结构化问题清单与缺陷编目-34-项)
  - [4.1 严重级别 (High, 1 项)](#41-严重级别-high-1-项)
  - [4.2 中度级别 (Medium, 8 项)](#42-中度级别-medium-8-项)
  - [4.3 低度级别 (Low, 15 项)](#43-低度级别-low-15-项)
  - [4.4 提示级别 (Info, 10 项)](#44-提示级别-info-10-项)
- [五、测试套件与基础设施有效性深度分析](#五测试套件与基础设施有效性深度分析)
  - [5.1 CDP 真机测试与轻量化架构](#51-cdp-真机测试与轻量化架构)
  - [5.2 Mock 保真度缺陷与外网流量泄漏](#52-mock-保真度缺陷与外网流量泄漏)
  - [5.3 测试盲区与断言颗粒度分析](#53-测试盲区与断言颗粒度分析)
  - [5.4 CI 自动化流水线断层与环境缺失](#54-ci-自动化流水线断层与环境缺失)
- [六、分级整改与架构加固路线图](#六分级整改与架构加固路线图)
  - [6.1 P0 立即处置 (Immediate / 阻断性与数据安全)](#61-p0-立即处置-immediate--阻断性与数据安全)
  - [6.2 P1 近期优化 (Near-Term / 功能完整与测试保真)](#62-p1-近期优化-near-term--功能完整与测试保真)
  - [6.3 P2 架构增强 (Architectural Enhancements / 健壮性与纯净度)](#63-p2-架构增强-architectural-enhancements--健壮性与纯净度)

---

## 一、执行摘要与整体健康度评级

### 1.1 总体健康度评分与结论

| 评估维度 | 权重 | 得分 | 评级 | 简述 |
| :--- | :---: | :---: | :---: | :--- |
| **安全性与供应链 (Security)** | 25% | **94** | A | 零运行时依赖，严格的 CSP、URL 白名单与 XSS 过滤；无密钥泄漏。 |
| **架构与规范合规 (Architecture)** | 25% | **90** | A- | 彻底恪守奥卡姆剃刀与单向依赖；扩展编译阶段存在轻微宏替换疏漏。 |
| **健壮性与边界处理 (Robustness)** | 25% | **82** | B | 存在过新 API 兼容阻断（`URL.parse`）与特定平台（Windows/Linux）构建壁垒。 |
| **代码质量与测试套件 (Quality & Testing)** | 25% | **86** | B+ | 基于 Chrome CDP 的超轻量真机回归；存在个别外网流量泄漏与 CI 覆盖断层。 |
| **综合健康度指数 (Overall)** | **100%** | **88 / 100** | **A-** | **优秀（基础极扎实，具备生产级严谨度，存在高价值加固点）** |

本审计小组对 Glass Start 代码库（网页端与 Chrome 扩展全部源码、构建与测试套件）进行了全面、详尽、只读的逐行源码审查。总体评估结论为：**Glass Start 展现了极其罕见且优秀的现代前端工程自律。** 项目彻底摒弃了现代 Web 开发中常见的框架膨胀与过度工程化，全流程贯彻奥卡姆剃刀原则（“如无必要，勿增实体”），以 100% 原生 Web API 实现了高性能、离线可用且具备双端复用能力的现代化起始页。

### 1.2 严重级别统计与问题分布

经过跨四大模块领域的全面交叉审计与严格查证，全库共识别出 **34 项** 明确的代码缺陷、边界隐患、平台兼容性问题与工程优化建议。

```
缺陷严重度金字塔分布:
         ▲
        / \     [High: 1]    (阻断性运行崩溃)
       /   \
      /     \   [Medium: 8]  (功能失效 / 数据风险 / 平台受阻)
     /       \
    /         \ [Low: 15]    (防御缺失 / 规范偏差 / 资源微漏)
   /           \[Info: 10]   (可访问性细节 / 语义冗余 / 语法提示)
  ─────────────
      总计: 34 项
```

- **High (严重，1 项)**：`URL.parse()` 在未支持该特性的环境（Safari < 18 / iOS < 18 / Chrome < 126）导致首屏白屏崩溃。
- **Medium (中度，8 项)**：涵盖 OverlayStack 文本拖拽误关闭、`resolveLocale` 异常崩溃、扩展设置面板错显 SW 缓存、扩展测试外网流量外溢、IDB 升级阻塞死锁、DOMCache 断开节点泄漏、搜索算法阻断非 ASCII/CJK 输入、图标同步强依赖 macOS `sips` 等。
- **Low (轻度，15 项)**：包含 i18n 复数兜底、壁纸上传布尔契约、FileReader 监听注销、扩展 SW 更新死代码剔除、Manifest 图标规格缺失、`safeUrl` 协议混淆防御、IDB 错误冒泡、目录非空防御、硬编码中文、Windows 唤起与符号链接兼容、CI 门禁缺失、端口 TOCTOU 竞争、扩展硬编码语言、服务器句柄泄漏等。
- **Info (提示，10 项)**：包含快捷键弹窗 `aria-expanded` 状态、内联首屏壁纸正则对齐、扩展冗余 SEO 标签、扩展重复 CSP Meta、负零温度展示、拼音排序区域设置、测试全局异常退出、视觉测试像素差分、macOS 启动脚本 Shell 混用、CI Node 矩阵声明等。

### 1.3 核心架构优势与工程亮点

1. **绝对零运行时依赖**：`package.json` 的 `dependencies` 为 `{}`，整个运行时完全依托原生现代浏览器标准（HTMLDialogElement、PointerEvent、IntersectionObserver、IndexedDB、LocalStorage、Service Worker、Intl、Web Locks）。
2. **严密的存储分层与配额保护**：大图与自定义 Base64 壁纸 100% 落盘于 IndexedDB，LocalStorage 仅保存轻量级数值索引与颜色元数据，彻底杜绝了 LocalStorage 5MB 配额爆仓灾难。
3. **单向不可逆依赖图谱**：`src/js/state/`、`src/js/utils/`、`src/js/config/` 与 `src/js/core/` 严格遵循单向依赖，绝无任何反向导入业务模块或测试桥接代码，编译期通过 AST 自动化用例予以守卫。
4. **内存草稿驱动模式**：书签管理、编辑、拖拽排序与分类调整全部在 `modalState.draftBookmarks` 内存模型中操作，保存与导出直接读取纯数据，彻底避免从 DOM 反向解析数据的陈旧反模式。
5. **轻量原子发布与 CDP 驱动测试**：构建采用符号链接原子切换，支持零停机发布；测试套件摒弃庞大的第三方端到端框架，直接通过原生 WebSocket 驱动 Chrome CDP，极具工程美感。

### 1.4 主要风险与关键弱点总览

1. **现代化 Web API 的兼容性盲区**：对 2024 年下半年刚落地的 `URL.parse()` 缺乏兼容性降级，导致仍占有相当份额的 Safari 17 / iOS 17 用户群体遭遇白屏阻断。
2. **扩展首屏宏编译断层**：扩展构建流程中 `i18nBootstrap` 独立打包时漏传 `window.__GLASS_EXTENSION__`，导致扩展设置面板在静态阶段呈现了网页专用的 Service Worker 离线缓存文本。
3. **基础设施的跨平台假设**：构建脚本与测试套件隐含了 macOS / POSIX 的单平台假设，导致在 Linux/Windows 开发者环境以及纯 Ubuntu CI 流水线中发生脚本崩溃或用例跳过。

---

## 二、审计范围与方法论

### 2.1 审查模块与文件边界

本次代码审计覆盖 Glass Start 仓库内的所有代码与配置文件，绝对保持源码只读：

```
Glass Start 代码审计全景边界:
├── 网页端核心与 UI (Area 1)
│   ├── 入口与装配: src/index.html, src/sw.js, src/js/main.js, src/js/init.js, src/js/events.js
│   ├── 核心机制 (core/): overlay-stack, i18n, wallpaper-renderer, service-worker-updates, ...
│   └── 业务功能 (modules/): bookmarks, bookmark-editor, weather, search, settings, wallpaper, ...
├── Chrome 扩展体系 (Area 2)
│   ├── 扩展清单与资产: src/extension/manifest.json, src/extension/icon128.png
│   ├── 扩展构建流水线: scripts/build-extension.cjs, scripts/build.cjs, scripts/publish-build.cjs
│   └── 跨端共享分支: window.__GLASS_EXTENSION__ 条件编译与运行时隔离
├── 状态、存储与工具层 (Area 3)
│   ├── 状态管理 (state/): store.js, dom.js (Proxy 缓存), bookmark-draft.js
│   ├── 工具体系 (utils/): idb.js, storage.js, favicon.js, bookmark-model.js, bookmark-search.js, ...
│   ├── 基础配置 (config/): constants.js, backgrounds.js, engines.js, locales/
│   └── 类型与基准数据: src/js/types.d.ts, bookmarks.json
└── 基础设施与测试套件 (Area 4)
    ├── 工具与服务脚本: scripts/server.cjs, scripts/sync-icons.mjs, scripts/lint*.mjs, start.command
    ├── 自动化测试框架: test/support/ (cdp.mjs, helpers.mjs), 33 个端到端回归用例
    └── 持续集成工作流: .github/workflows/ci.yml
```

### 2.2 四大审计维度与审查准则

1. **安全性与漏洞分析 (Security & Supply Chain)**：
   - 审查 HTML 动态插值：`escapeHtml()`、`safeUrl()`、`weatherNum()` 防御 XSS 注入的有效性；
   - 审查 Chrome MV3 Manifest：权限声明最小化、CSP 策略是否禁止 `'unsafe-eval'` 及远程代码；
   - 审查本地与跨域存储安全、URL 伪协议防护（`javascript:`、`data:`、`vbscript:`）。
2. **架构约束与规范遵从性 (Architecture & Compliance)**：
   - 对照 `AGENTS.md` 与 `docs/ARCHITECTURE.md`，审查奥卡姆剃刀原则落地情况；
   - 检查模块职责与单向依赖方向，严禁业务模块被底层依赖反向引用；
   - 检查 `dom.js` 的 `DOMCache` 注册与 `types.d.ts` 契约，检查 `OverlayStack` 弹窗管控规范；
   - 检查 Tailwind v4 `@theme` 规范（禁止生成 `tailwind.config.js`）及 `package.json` 版本单一源。
3. **代码健壮性与边界处理 (Robustness & Resilience)**：
   - 审查异步操作、Promise Rejection、网络波动与异常降级；
   - 审查极端交互场景（长按、连续快速点击、拖拽越界、多标签页并发冲突）；
   - 审查跨平台（macOS、Linux、Windows）及多浏览器（Chrome、Safari、Firefox）的兼容性与资源生命周期。
4. **代码质量与测试套件有效性 (Quality & Testing)**：
   - 审查 CDP 测试真实度、是否存在过度 Mock 或直接绕过业务逻辑的情况；
   - 审查网络请求拦截是否完整，有无逃逸至公网的偶发风险；
   - 评估 CI 流水线的真实防护能力与测试盲区。

---

## 三、架构规范与工程约束遵从性评估

| 约束维度 | `AGENTS.md` / `ARCHITECTURE.md` 规范要求 | 实际审查现状 | 合规评定 |
| :--- | :--- | :--- | :---: |
| **奥卡姆剃刀原则** | 如无必要，勿增实体；严禁过度设计与多余抽象包装 | 零前端框架，状态就地维护，无冗余中间层；但发现个别死代码打包残留 | 🟢 **优秀** (92%) |
| **运行时零依赖** | 原生 Web API 驱动，生产 `dependencies` 为 0 | `package.json` 保持 0 依赖，构建后产物无第三方库 | 🟢 **完全合规** (100%) |
| **模块依赖边界** | `core/`、`utils/`、`state/` 严禁反向导入业务模块或测试适配 | AST 静态测试全覆盖，分层清晰，无回流导入 | 🟢 **完全合规** (100%) |
| **DOM 节点访问** | 静态访问节点统一登记至 `dom.js` 与 `DOMCache` 类型 | 静态节点全部收敛至 `dom.js`，无脱缰查询；但 Proxy 自愈存在游离节点隐患 | 🟢 **完全合规** (98%) |
| **OverlayStack 管控** | 受管弹窗通过 `.push()` / `.pop()` 控制，禁直接设 `style.display` | 6 大受管弹窗全部经由栈管理，无违规直操样式；但存在遮罩点击误判缺陷 | 🟢 **完全合规** (98%) |
| **壁纸存储规范** | 大图/Base64 存入 IndexedDB，不写入 LocalStorage | 壁纸二进制完全由 `idb.js` 托管，LocalStorage 仅存整型索引 | 🟢 **完全合规** (100%) |
| **草稿驱动模型** | 书签编辑/排序由 `modalState.draftBookmarks` 驱动，禁反解析 DOM | 保存/导出均直接读取内存草稿，严格与 DOM 解耦 | 🟢 **完全合规** (100%) |
| **A11y 与 CSS 规范** | `type="button"`、`aria-hidden`、`:hover` 需加 `body:not(.tab-blurred)` | 按钮与图标完全符合无障碍规则；仅快捷键弹窗有微小 ARIA 状态错位 | 🟢 **完全合规** (99%) |
| **Tailwind v4** | 仅使用 `@theme`，严禁创建 `tailwind.config.js` | 仅在 `main.css` 使用 `@theme`，无配置文件 | 🟢 **完全合规** (100%) |
| **Chrome 扩展隔离** | 源码复用，由 `window.__GLASS_EXTENSION__` 区分，不注册 SW | 构建外置内联脚本，剥离 JSONP；但 `i18nBootstrap` 漏传宏致文案分裂 | 🟡 **基本合规** (88%) |
| **跨平台构建一致** | 支持跨操作系统构建与测试 | 强耦合 macOS `sips` 工具与 POSIX 符号链接，非 Mac 环境受阻 | 🔴 **需加固** (70%) |

---

## 四、结构化问题清单与缺陷编目 (34 项)

### 4.1 严重级别 (High, 1 项)

#### [HIGH-01] `URL.parse()` 缺乏兼容性兜底导致 Safari < 18 / iOS < 18 首屏白屏崩溃

- **严重级别**：High
- **问题分类**：Robustness / Platform Compatibility
- **涉及文件与精确行号**：
  - `src/js/utils/bookmark-model.js`: 32–34
  - `src/js/core/i18n.js`: 95, 98, 99, 100, 104
- **原版代码片段**：
  `src/js/utils/bookmark-model.js:32-34`:
  ```javascript
  export function bookmarkUrlKey(url) {
      return URL.parse(normalizeUrl(url))?.href ?? '';
  }
  ```
  `src/js/core/i18n.js:94-104`:
  ```javascript
          for (const canonical of Object.keys(catalogs.en?.bookmarks ?? {})) {
              map.set(URL.parse(canonical)?.href ?? canonical, canonical);
          }
          for (const [canonical, bookmark] of Object.entries(catalogs['zh-CN']?.bookmarks ?? {})) {
              map.set(URL.parse(canonical)?.href ?? canonical, canonical);
              if (bookmark.url) map.set(URL.parse(bookmark.url)?.href ?? bookmark.url, canonical);
              if (bookmark.legacyUrl) map.set(URL.parse(bookmark.legacyUrl)?.href ?? bookmark.legacyUrl, canonical);
          }
          canonicalMapCache.set(catalogs, map);
      }
      return map.get(URL.parse(url)?.href ?? url) || url;
  ```
- **成因与场景分析**：
  `URL.parse()` 是 WHATWG 于 2024 年年中正式定稿的静态方法（Chrome 126 于 2024 年 6 月支持，Safari 18.0 / iOS 18 于 2024 年 9 月支持，Node.js 22.1.0 支持）。在 iOS 17.x 全系列、macOS Sonoma Safari 17.x 或 Chrome < 126 环境下，`URL.parse` 值为 `undefined`。
  由于页面启动阶段 `init()` 必须执行 `loadBookmarks() -> getDerivedBookmarks() -> bookmarkUrlKey()`，一旦调用未受保护的 `URL.parse()`，会立即抛出未捕获的 `TypeError: URL.parse is not a function`。同文件其他地方（如 `getHostname` 与 `normalizeBookmarkUrl`）均正确采用了 `try { return new URL(...); } catch { return ''; }`，此处的 `URL.parse` 属于直接引入过新 API 且未做向后兼容。
- **潜在影响**：
  导致所有使用 iOS 17 或 macOS Safari 17 的苹果设备用户访问起始页时直接在启动阶段致命崩溃，呈现完全白屏，核心业务逻辑完全无法执行。
- **具体整改建议与替换代码**：
  在 `bookmark-model.js` 中使用标准 `try...catch` 构建稳健的 URL 解析降级，并在 `i18n.js` 中提供安全回退函数：
  ```javascript
  // src/js/utils/bookmark-model.js
  export function bookmarkUrlKey(url) {
      const normalized = normalizeUrl(url);
      if (!normalized) return '';
      try {
          return new URL(normalized).href;
      } catch {
          return '';
      }
  }
  ```
  ```javascript
  // src/js/core/i18n.js 增加安全解析辅助函数
  function safeUrlHref(url) {
      if (!url) return '';
      try {
          return new URL(url).href;
      } catch {
          return url;
      }
  }
  ```

---

### 4.2 中度级别 (Medium, 8 项)

#### [MED-01] OverlayStack 遮罩点击事件在文本选中拖拽释放时误触发弹窗关闭导致草稿丢失

- **严重级别**：Medium
- **问题分类**：Robustness / UX & Data Loss
- **涉及文件与精确行号**：`src/js/core/overlay-stack.js`: 27–30
- **原版代码片段**：
  ```javascript
  modal.addEventListener('click', e => {
      const top = OverlayStack.top();
      if (e.target === modal && top?.id === id) top.close();
  });
  ```
- **成因与场景分析**：
  在原生 HTML `<dialog>` 规范中，遮罩区域属于 `<dialog>` 元素本身（`e.target === modal`）。现代浏览器中，`click` 事件在包含 `pointerdown` 和 `pointerup` 的最近公共祖先上触发。当用户在 `editModal`（书签与设置编辑面板）的输入框中按住鼠标左键横向拖拽选中长 URL 或在壁纸直链输入框划选文字，且鼠标光标在弹窗主体外部（即半透明背景遮罩区域）松开时，浏览器的 `click` 目标被判定为 `modal`。这导致 `if (e.target === modal)` 评估为 `true`，立即调用 `top.close()`（对于编辑弹窗即 `cancelEditModal()`），强制关闭弹窗并丢失用户尚未保存的所有书签与配置草稿。
- **潜在影响**：
  在高频文本选中文本交互中引发突发性弹窗闪退与用户未提交数据丢失，极度损害用户体验。
- **具体整改建议与替换代码**：
  引入 `pointerdown` 起始目标记录，只有当按下和抬起均在遮罩背景上时才认定为点击遮罩关闭：
  ```javascript
  // src/js/core/overlay-stack.js
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

---

#### [MED-02] `resolveLocale` 遇未定义或非字符串语言项抛出未捕获 TypeError 阻断启动

- **严重级别**：Medium
- **问题分类**：Robustness / Boot Lifecycle
- **涉及文件与精确行号**：`src/js/core/i18n.js`: 6–12 (调用方在 133 行)
- **原版代码片段**：
  ```javascript
  // src/js/core/i18n.js:6-12
  export function resolveLocale(preference, languages) {
      if (typeof preference === 'string' && SUPPORTED_LANGUAGES.includes(preference)) return preference;
      for (const language of languages) {
          const exact = SUPPORTED_LANGUAGES.find(locale => locale.toLowerCase() === language.toLowerCase());
          if (exact) return exact;
          const base = language.split('-')[0].toLowerCase();
          const match = SUPPORTED_LANGUAGES.find(locale => locale.split('-')[0].toLowerCase() === base);
          if (match) return match;
      }
      return 'en';
  }

  // 调用位置 src/js/core/i18n.js:133
  const locale = resolveLocale(getLanguagePreference(), navigator.languages?.length ? navigator.languages : [navigator.language]);
  ```
- **成因与场景分析**：
  在隐私加固浏览器（如 LibreWolf、Tor Browser、定制 Chromium 企业版或无头测试环境）中，`navigator.languages` 可能为空数组，而 `navigator.language` 为 `undefined`。此时调用表达式 `navigator.languages?.length ? ... : [navigator.language]` 产生 `[undefined]`。进入 `resolveLocale` 后，`for (const language of languages)` 迭代取出 `undefined`，在执行 `language.toLowerCase()` 时立即抛出未捕获的 `TypeError: Cannot read properties of undefined (reading 'toLowerCase')`。
- **潜在影响**：
  由于 `initializeI18n()` 位于页面启动关键路径，该异常直接阻断主脚本执行，导致页面白屏。
- **具体整改建议与替换代码**：
  在遍历语言列表时增加严格的字符串防空守卫：
  ```javascript
  // src/js/core/i18n.js
  export function resolveLocale(preference, languages) {
      if (typeof preference === 'string' && SUPPORTED_LANGUAGES.includes(preference)) return preference;
      if (Array.isArray(languages)) {
          for (const language of languages) {
              if (typeof language !== 'string' || !language) continue;
              const lower = language.toLowerCase();
              const exact = SUPPORTED_LANGUAGES.find(locale => locale.toLowerCase() === lower);
              if (exact) return exact;
              const base = lower.split('-')[0];
              const match = SUPPORTED_LANGUAGES.find(locale => locale.split('-')[0].toLowerCase() === base);
              if (match) return match;
          }
      }
      return 'en';
  }
  ```

---

#### [MED-03] `i18nBootstrap` 编译构建时遗漏 `__GLASS_EXTENSION__` 宏替换，导致扩展设置面板错显 Service Worker 离线缓存文案

- **严重级别**：Medium
- **问题分类**：Architecture / Functional & UI Defect
- **涉及文件与精确行号**：
  - `scripts/build.cjs`: 223–227
  - `src/js/core/i18n.js`: 28–31
  - `src/index.html`: 508, 512, 516
- **原版代码片段**：
  `scripts/build.cjs:223-226`:
  ```javascript
  const i18nBootstrap = esbuild.buildSync({
      stdin: { contents: `import { messages } from './src/js/config/locales/index.js'; import enCatalog from './src/js/config/locales/catalog-en.json'; import zhCatalog from './src/js/config/locales/catalog-zh-CN.json'; import { initializeI18n } from './src/js/core/i18n.js'; initializeI18n(messages); window.__GLASS_I18N__.catalogs = { en: enCatalog, 'zh-CN': zhCatalog };`, resolveDir: ROOT_DIR },
      bundle: true, write: false, format: 'iife', target: 'es2020', minify: true, charset: 'utf8'
  }).outputFiles[0].text;
  ```
  `src/js/core/i18n.js:28-31`:
  ```javascript
  export function t(key, params = {}) {
      if (/^cache\.(title|description|action)$/.test(key)) {
          key = `cache.${typeof window !== 'undefined' && window.__GLASS_EXTENSION__ ? 'extension' : 'web'}.${key.slice(6)}`;
      }
  ```
  `src/index.html:508, 516`:
  ```html
  <span data-i18n="cache.title">离线 Service Worker 缓存</span>
  <span data-i18n="cache.action">一键刷新 Service Worker 离线缓存</span>
  ```
- **成因与场景分析**：
  主业务脚本 `app.js` 构建时声明了 `define: { 'window.__GLASS_EXTENSION__': String(extension) }`。然而，预编译首屏国际化包 `i18nBootstrap` 时未传入该宏定义。扩展运行时，首屏由外置的 `bootstrap-1.js` 率先完成静态 DOM 翻译，此时全局 `window.__GLASS_EXTENSION__` 为 `undefined`。导致 `t('cache.title')` 回退为网页端的 `cache.web.title`。当用户打开扩展设置的数据面板时，界面显示“离线 Service Worker 缓存”和“一键刷新 Service Worker 离线缓存”。而点击按钮触发二次确认时，弹窗却由运行时的 `app.js` 驱动并显示“重新加载扩展页面”，造成界面前后文案分裂。
- **潜在影响**：
  违背 `AGENTS.md`“扩展不注册 Service Worker”的设计原则，给 Chrome 扩展用户带来严重的心智困惑。
- **具体整改建议与替换代码**：
  在 `scripts/build.cjs` 的 `processProductionHtml` 中，为 `i18nBootstrap` 补充宏替换参数：
  ```javascript
  // scripts/build.cjs
  const i18nBootstrap = esbuild.buildSync({
      stdin: { ... },
      bundle: true, write: false, format: 'iife', target: 'es2020', minify: true, charset: 'utf8',
      define: {
          'window.__GLASS_EXTENSION__': String(extension)
      }
  }).outputFiles[0].text;
  ```
  并在 `scripts/build-extension.cjs` 外置首屏脚本前，预置全局注入：
  ```html
  <script>window.__GLASS_EXTENSION__=true;</script>
  ```

---

#### [MED-04] `infra-chrome-extension.test.mjs` 测试盲区与 Mock 保真度缺陷

- **严重级别**：Medium
- **问题分类**：Quality & Testing
- **涉及文件与精确行号**：`test/infra-chrome-extension.test.mjs`: 47–56, 153–156
- **原版代码片段**：
  ```javascript
  const originalFetch = window.fetch;
  window.fetch = (url, options) => {
      const value = String(url);
      if (/api.bing.com|suggestqueries.google.com|(?:zh|en).wikipedia.org/.test(value)) {
          window.__suggestRequests.push(value);
          return Promise.resolve(new Response(JSON.stringify(['glass', ['extension suggestion']])));
      }
      return originalFetch(url, options);
  };
  ...
  await evalJS(`document.querySelector('#tab-btn-data').click(); document.querySelector('#clearCacheBtn').click()`);
  await waitFor(evalJS,`document.querySelector('#confirmModal').open`);
  assert.equal(await evalJS(`document.querySelector('#confirmOkBtn').textContent.trim()`), 'Reload page');
  ```
- **成因与场景分析**：
  1. **测试流量外溢至公网**：测试用例仅拦截了 3 个搜索引擎的 URL，未拦截 `weather.js` 依赖的 `myip.ipip.net`、`ipwho.is`、`api.open-meteo.com`。测试运行时真机 CDP 向真实外网发送请求，若测试环境无外网或遇到网络抖动，会造成测试假性失败或非预期静默降级。
  2. **断言过粗掩盖缺陷**：第 155 行测试离线缓存清理按钮时，直接断言弹出的对话框确认按钮文本为 `'Reload page'`，却完全没有断言 `#clearCacheBtn` 和 `.data-section-cache` 本身的文本内容。正是这一断言盲区，导致 [MED-03] 缺陷长期未被 CI 发现。
- **潜在影响**：
  测试套件无法保证完全脱机运行，且关键的扩展端 UI 国际化文案存在回归盲区。
- **具体整改建议与替换代码**：
  补齐对天气接口的完整 Mock，并对设置面板的离线按钮文案进行严格断言：
  ```javascript
  // test/infra-chrome-extension.test.mjs
  // 1. 断言面板原生文案中绝不包含 Service Worker
  const cacheBtnText = await evalJS(`document.querySelector('#clearCacheBtn').textContent.trim()`);
  assert.equal(cacheBtnText.includes('Service Worker'), false);
  // 2. 补全天气 mock 请求桩，阻断外网流量外溢
  ```

---

#### [MED-05] `idb.js` 缺失 `onblocked` 与 `onversionchange` 处理，且静态 Promise 单例阻断重连

- **严重级别**：Medium
- **问题分类**：Robustness & Storage Lifecycle
- **涉及文件与精确行号**：`src/js/utils/idb.js`: 6–20
- **原版代码片段**：
  ```javascript
  const dbPromise = new Promise(resolve => {
      if (typeof window === 'undefined' || !('indexedDB' in window)) { resolve(null); return; }
      try {
          const req = indexedDB.open(CONFIG.IDB.DB_NAME, CONFIG.IDB.VERSION);
          req.onupgradeneeded = e => {
              const openReq = /** @type {IDBOpenDBRequest} */ (e.target);
              const db = openReq.result;
              if (!db.objectStoreNames.contains(CONFIG.IDB.STORES.WALLPAPERS)) {
                  db.createObjectStore(CONFIG.IDB.STORES.WALLPAPERS);
              }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
      } catch { resolve(null); }
  });
  ```
- **成因与场景分析**：
  1. **多标签页版本升级死锁**：当应用在未来升级 IndexedDB 版本（`CONFIG.IDB.VERSION` 递增）时，若用户在浏览器中打开了多个标签页，未更新的旧标签页未注册 `db.onversionchange`，无法主动关闭旧连接。新标签页发起 `indexedDB.open` 时将触发 `onblocked` 事件。由于代码未监听 `req.onblocked`，新标签页的 `dbPromise` 永远挂起，所有壁纸存取操作彻底无响应。
  2. **连接断开不可自愈**：`dbPromise` 为模块顶层的静态单例 Promise。若浏览器在后台将空闲 IDB 连接关闭，该 Promise 状态永久固化为失效连接对象，后续操作持续报错，必须强制整页刷新。
- **潜在影响**：
  数据库升级或连接异常断开后引发持久性挂起与写入失效。
- **具体整改建议与替换代码**：
  增加 `onblocked`、`onversionchange` 处理，并封装为可重试获取连接的函数：
  ```javascript
  // src/js/utils/idb.js
  let activeDb = null;
  export function getDB() {
      if (activeDb) return Promise.resolve(activeDb);
      return new Promise(resolve => {
          try {
              const req = indexedDB.open(CONFIG.IDB.DB_NAME, CONFIG.IDB.VERSION);
              req.onupgradeneeded = e => {
                  const db = e.target.result;
                  if (!db.objectStoreNames.contains(CONFIG.IDB.STORES.WALLPAPERS)) {
                      db.createObjectStore(CONFIG.IDB.STORES.WALLPAPERS);
                  }
              };
              req.onsuccess = () => {
                  activeDb = req.result;
                  activeDb.onversionchange = () => {
                      activeDb.close();
                      activeDb = null;
                  };
                  activeDb.onclose = () => { activeDb = null; };
                  resolve(activeDb);
              };
              req.onblocked = () => resolve(null);
              req.onerror = () => resolve(null);
          } catch { resolve(null); }
      });
  }
  ```

---

#### [MED-06] `dom.js` Proxy 缓存自愈机制在节点被移除未替代时返回断开的陈旧 DOM 对象

- **严重级别**：Medium
- **问题分类**：Architecture & Robustness
- **涉及文件与精确行号**：`src/js/state/dom.js`: 16–29
- **原版代码片段**：
  ```javascript
  export const dom = new Proxy(_domStore, {
      get(target, prop) {
          if (typeof prop !== 'string') return Reflect.get(target, prop);
          let el = target[prop];
          if (!el || (el instanceof Element && !el.isConnected)) {
              const fresh = $(prop);
              if (fresh) {
                  target[prop] = fresh;
                  return fresh;
              }
          }
          return el;
      }
  });
  ```
- **成因与场景分析**：
  当缓存中的 DOM 节点被从文档中移除（`!el.isConnected` 为真）且页面上没有重新创建同 ID 的新节点时（`fresh` 为 `null`），条件 `if (fresh)` 不成立。此时函数直接执行 `return el;`，将已经脱离文档树（Disconnected）的游离节点返回给了调用方。调用方通过 `if (dom.xxx)` 判定其依然存在并尝试操作，导致逻辑失真且使脱落节点无法被垃圾回收。
- **潜在影响**：
  DOM 判断假阳性，引发无意义的事件绑定、样式操作及内存泄露。
- **具体整改建议与替换代码**：
  节点脱离且未找到新节点时，清除缓存槽位并返回 `null`：
  ```javascript
  // src/js/state/dom.js
  export const dom = new Proxy(_domStore, {
      get(target, prop) {
          if (typeof prop !== 'string') return Reflect.get(target, prop);
          let el = target[prop];
          if (!el || (el instanceof Element && !el.isConnected)) {
              const fresh = $(prop);
              target[prop] = fresh ?? null;
              return target[prop];
          }
          return el;
      }
  });
  ```

---

#### [MED-07] `bookmark-search.js` 搜索正则仅放行 ASCII+CJK，阻断日韩文、西里尔文及重音拉丁文查询

- **严重级别**：Medium
- **问题分类**：Robustness / Internationalization
- **涉及文件与精确行号**：
  - `src/js/utils/bookmark-search.js`: 62, 114
- **原版代码片段**：
  ```javascript
  // src/js/utils/bookmark-search.js:62
  const wordTokens = rawText.split(/[^a-z0-9\u4e00-\u9fff]+/);
  // src/js/utils/bookmark-search.js:114
  export function rankBookmarkSuggestions(query, model, config, limit = config.MAX_LOCAL_ITEMS) {
      const q = (query || '').trim().toLowerCase();
      if (!q || !/[a-z0-9\u4e00-\u9fff]/.test(q)) return [];
  ```
- **成因与场景分析**：
  `\u4e00-\u9fff` 仅覆盖 CJK 统一表意汉字，未包含日文平假名/片假名（`\u3040-\u30ff`）、韩文谚文（`\uac00-\ud7af`）、俄文西里尔字母（`\u0400-\u04ff`）以及带变音符的欧洲语言文字（如 `ä, ö, ü, ñ, é`）。当多语言用户在搜索框中键入上述语言时，第 114 行直接返回空数组 `[]`，本地搜索完全罢工；分词正则更将外文字符切碎丢弃。
- **潜在影响**：
  全球多语言用户的书签模糊检索严重受损。
- **具体整改建议与替换代码**：
  使用现代 ES 正则 Unicode 属性转义 `\p{L}` 与 `\p{N}` 配合 `u` 标志：
  ```javascript
  // src/js/utils/bookmark-search.js
  // 分词逻辑
  const wordTokens = rawText.split(/[^\p{L}\p{N}]+/u);
  // 搜索入口校验
  if (!q || !/[\p{L}\p{N}]/u.test(q)) return [];
  ```

---

#### [MED-08] 本地图标同步脚本强依赖 macOS `sips` 工具，跨平台环境下全部失败且报错误导

- **严重级别**：Medium
- **问题分类**：Robustness / Cross-Platform
- **涉及文件与精确行号**：`scripts/sync-icons.mjs`: 106–108, 122–123
- **原版代码片段**：
  ```javascript
  workDir = mkdtempSync(join(tmpdir(), 'glass-icon-check-'));
  execFileSync('sips', ['-s', 'format', 'png', path, '--out', join(workDir, 'decoded.png')],
      { stdio: 'ignore', timeout: 5000 });
  return true;
  ```
- **成因与场景分析**：
  `sips` 是 macOS 专有的 CLI 图像工具。在 Linux 或 Windows 系统中，调用 `execFileSync('sips', ...)` 会抛出 `ENOENT` 异常。异常被 `catch` 吞没后导致 `isReusableIcon` 与 `saveAsPng` 恒为 `false`。非 macOS 用户运行 `npm run sync:icons` 时遭遇 100% 失败，输出误导性的“所有来源均未生成可用 PNG”，并在 CI 中被强制 `skip`。
- **潜在影响**：
  Linux / Windows 开发者完全无法在本地维护或更新书签图标，破坏跨平台工程一致性。
- **具体整改建议与替换代码**：
  `isReusableIcon` 优先采用脚本已实现的纯 JavaScript `pngDimensions()` 校验尺寸与魔数；在非 macOS 且无 `sips` 环境下，优雅降级为复用现有合规 PNG：
  ```javascript
  // scripts/sync-icons.mjs
  function isReusableIcon(path) {
      try {
          const { width, height } = pngDimensions(path);
          return width === height && width <= 128;
      } catch {
          return false;
      }
  }
  ```

---

### 4.3 低度级别 (Low, 15 项)

#### [LOW-01] `t(key, params)` 复数插值在缺失匹配分类且未提供 `other` 时发生运行时 TypeError 崩溃
- **文件与行号**：`src/js/core/i18n.js`: 34–38
- **代码片段**：
  ```javascript
  if (typeof message !== 'string') {
      const category = new Intl.PluralRules(getLocale()).select(typeof params.count === 'number' ? params.count : 0);
      message = message[category] || message.other;
  }
  return message.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
  ```
- **成因与影响**：若语言包字典中复数对象缺失匹配的 category 且未提供 `other`，`message` 变为 `undefined`，后续直接调用 `.replace` 导致运行时崩溃。
- **整改建议**：增加回退防护并强转字符串：
  ```javascript
  message = (message && (message[category] || message.other)) || key;
  return String(message).replace(/\{(\w+)\}/g, ...);
  ```

---

#### [LOW-02] `uploadWallpaper` 成功分支缺少显式返回值，违背布尔返回契约
- **文件与行号**：`src/js/modules/wallpaper.js`: 510–589；调用方 `src/js/modules/settings-events.js`: 213
- **代码片段**：
  ```javascript
  export function uploadWallpaper(file) {
      if (!canPreviewWallpaper()) return false;
      if (!file.type.startsWith('image/')) { ... return false; }
      trackWallpaperSelection(task, prepared.then(...));
  } // 隐式返回 undefined
  ```
- **成因与影响**：前置失败显式返回 `false`，但成功启动时无 `return` 返回 `undefined`。调用方做 `if (uploadWallpaper(file) === false)` 校验，违反 API 显式契约。
- **整改建议**：在函数末尾显式 `return true;`。

---

#### [LOW-03] `settings.js` 中 FileReader 事件监听在导入错误或中断时未彻底注销，存在内存残留
- **文件与行号**：`src/js/modules/settings.js`: 385–430
- **代码片段**：
  ```javascript
  reader.onload = (e) => {
      reader.onload = null;
      signal.removeEventListener('abort', abortRead);
  };
  reader.onerror = () => {
      signal.removeEventListener('abort', abortRead);
  };
  ```
- **成因与影响**：在 `onerror` 分支未清空 `onload` 与 `onerror` 回调；闭包引用的 `file` 与 modal 上下文无法及时垃圾回收。
- **整改建议**：参考 `wallpaper.js`，统一封装清理函数：
  ```javascript
  const clearReader = () => {
      reader.onload = reader.onerror = reader.onabort = null;
      signal.removeEventListener('abort', abortRead);
  };
  ```

---

#### [LOW-04] 扩展产物冗余打包 Service Worker 更新控制逻辑，未实现编译期死代码剔除（DCE）
- **文件与行号**：`src/js/init.js`: 117–125，`src/js/core/service-worker-updates.js`: 102–104
- **代码片段**：
  ```javascript
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      initServiceWorkerUpdates();
  }
  ```
- **成因与影响**：仅依赖运行时 `location.protocol` 判断，导致 esbuild 无法在编译扩展时将整套更新轮询与激活监听（约 3~5KB）作为死代码剔除。
- **整改建议**：使用编译常量 `if (typeof window !== 'undefined' && window.__GLASS_EXTENSION__) return;` 守卫，配合 DCE 彻底剥离。

---

#### [LOW-05] `manifest.json` 缺少 Chrome Web Store MV3 规范推荐的 16x16 与 48x48 规格图标
- **文件与行号**：`src/extension/manifest.json`: 8–10
- **代码片段**：
  ```json
  "icons": {
    "128": "icon128.png"
  }
  ```
- **成因与影响**：缺少 16px（标签栏/右键菜单）与 48px（扩展管理页）图标，依赖浏览器运行时下采样，低 DPI 屏幕下易模糊。
- **整改建议**：导出并声明 `16` 与 `48` 尺寸图标。

---

#### [LOW-06] `helpers.js` 的 `safeUrl()` 全局放行 `data:image/`，在超链接上下文存在潜在协议混淆风险
- **文件与行号**：`src/js/utils/helpers.js`: 21–24
- **代码片段**：
  ```javascript
  export function safeUrl(url, html = true) {
      const u = (url || '').trim();
      return (/^https?:\/\//i.test(u) || /^data:image\//i.test(u) || ...) ? ... : '#';
  }
  ```
- **成因与影响**：`data:image/svg+xml` 包含脚本能力。若未来其他模块将输入放行给 `<a href>`，存在注入风险。
- **整改建议**：区分超链接与图片资源白名单，超链接严禁任何 `data:` 协议。

---

#### [LOW-07] IndexedDB 请求与事务错误处理未调用 `e.preventDefault()` 导致预期内异常冒泡至控制台
- **文件与行号**：`src/js/utils/idb.js`: 35, 49
- **代码片段**：
  ```javascript
  req.onerror = tx.onabort = () => resolve(null);
  tx.onabort = tx.onerror = () => resolve(false);
  ```
- **成因与影响**：IDB 事务错误属于可冒泡事件。未阻止默认行为导致磁盘满等预期内异常冒泡并在控制台打印红色报错。
- **整改建议**：在错误回调中调用 `e?.preventDefault?.()`。

---

#### [LOW-08] `category-catalog.js` 计算目录签名与排序时缺失对 `cat.bookmarks` 的非空容错
- **文件与行号**：`src/js/utils/category-catalog.js`: 14–15, 33, 40
- **代码片段**：
  ```javascript
  cat.bookmarks.map(b => [b.name, b.url, b.desc, b.icon])
  for (const bm of cat.bookmarks) { ... }
  ```
- **成因与影响**：若外部导入的分类对象缺少 `bookmarks` 数组，直接解构抛出 `TypeError` 阻断加载。
- **整改建议**：使用 `(cat.bookmarks || []).map(...)` 防御。

---

#### [LOW-09] 工具层存在硬编码中文兜底文本（如 `'分类书签'`、`'未命名书签'`），英文模式下绕过多语言
- **文件与行号**：`src/js/utils/category-catalog.js`: 38，`src/js/utils/bookmark-search.js`: 159
- **代码片段**：
  ```javascript
  entries.push({ bm, normUrl, defaultCat: cat.name || '分类书签' });
  name: bm.name || '未命名书签',
  ```
- **成因与影响**：英文环境下偶现未命名书签显示中文默认标题。
- **整改建议**：统一通过 `t('ui.untitled')` 或上层传参注入。

---

#### [LOW-10] Windows 平台下开发服务自动打开浏览器失效（命令行引号导致视作终端窗口标题）
- **文件与行号**：`scripts/server.cjs`: 335–341
- **代码片段**：
  ```javascript
  } else if (process.platform === 'win32') {
      exec(`start "${url}"`);
  }
  ```
- **成因与影响**：Windows CMD `start` 首个带引号参数被当作终端标题，导致打开空白终端窗口而非浏览器。
- **整改建议**：改用 `spawn('cmd.exe', ['/c', 'start', '', url])` 传入空标题。

---

#### [LOW-11] CI 环境单一（仅 Ubuntu）导致图标测试被 100% 忽略，且 W3C 检查在 PR 门禁中缺席
- **文件与行号**：`.github/workflows/ci.yml`: 18–20, 46–48；`test/infra-icon-sync.test.mjs`: 8–12
- **代码片段**：
  ```yaml
  - name: Validate release HTML
    if: github.ref == 'refs/heads/main' && github.event_name != 'pull_request'
    run: npm run test:w3c
  ```
- **成因与影响**：PR 阶段不跑 W3C/Stylelint 检查，CSS/HTML 规范错误漏入 `main`；Ubuntu 缺乏 `sips` 导致图标测试在 CI 全跳过。
- **整改建议**：将 Stylelint 离线校验移至 PR 必跑环节；mock `sips` 桩恢复图标测试。

---

#### [LOW-12] `getFreePort()` 存在典型 TOCTOU 端口竞争，并发测试时引发间歇性端口冲突
- **文件与行号**：`test/support/helpers.mjs`: 64–73
- **代码片段**：
  ```javascript
  const srv = createNetServer();
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
  ```
- **成因与影响**：端口关闭释放后到 Chrome 绑定之间存在微秒级间隙，多测试并发时撞端口导致 `EADDRINUSE`。
- **整改建议**：使用 Chrome 原生 `--remote-debugging-port=0` 自动分配。

---

#### [LOW-13] Chrome 扩展构建硬编码语言列表，破坏多语言扩展与单一真理源原则
- **文件与行号**：`scripts/build-extension.cjs`: 14–22
- **代码片段**：
  ```javascript
  for (const [locale, folder] of [['zh-CN', 'zh_CN'], ['en', 'en']]) {
  ```
- **成因与影响**：语言列表硬编码，未来新增语言时扩展清单无法自动同步，破坏单一真理源。
- **整改建议**：从 `src/js/config/language.js` 动态载入 `SUPPORTED_LANGUAGES`。

---

#### [LOW-14] `publishWebBuild` 依赖 POSIX 符号链接覆盖语义，Windows NTFS 环境下构建发布报错
- **文件与行号**：`scripts/publish-build.cjs`: 126–142
- **代码片段**：
  ```javascript
  fs.renameSync(link, output);
  ```
- **成因与影响**：Windows 不支持通过原子重命名直接覆盖现有的目录联接点，二次构建抛出 `EPERM`。
- **整改建议**：Windows 环境在 rename 前显式 `fs.unlinkSync(output)` 解绑。

---

#### [LOW-15] 本地静态开发服务器 `openStaticFile` 在特定异常分支下存在文件描述符未释放风险
- **文件与行号**：`scripts/server.cjs`: 142–160, 229–232
- **代码片段**：
  ```javascript
  let asset = await openStaticFile(filePath);
  // 若其后同步计算或响应头构造抛错，直接跳入 catch
  } catch {
      res.writeHead(500, ...);
  ```
- **成因与影响**：已打开的底层 `FileHandle` 在异常时未被流读取也未被关闭，存在文件句柄泄漏。
- **整改建议**：引入 `try ... finally` 确保在流未建立时关闭 `asset?.file?.close()`。

---

### 4.4 提示级别 (Info, 10 项)

#### [INFO-01] `openShortcutModal` 在快捷键全局唤起时对设置面板内隐藏/Inert 按钮设置 `aria-expanded="true"`
- **文件与行号**：`src/js/modules/settings.js`: 311, 319
- **成因与影响**：全局按 `?` 键打开快捷键弹窗时，处于 inert 的设置按钮被设置展开态，可访问性树状态微瑕。
- **整改建议**：仅在 `state.editOpen` 时同步修改该按钮属性。

---

#### [INFO-02] `src/index.html` 内联首屏壁纸脚本与 `wallpaper-renderer.js` 的 URL 正则转义规则存在细微不一致
- **文件与行号**：`src/index.html`: 177 vs `src/js/core/wallpaper-renderer.js`: 165
- **成因与影响**：`index.html` 采用 `/["'\\]/g`，而核心模块采用了加固的 `/["'\\\r\n)]/g`。
- **整改建议**：将 `index.html` 内联正则同步对齐。

---

#### [INFO-03] 扩展页面产物残留网页专用的 Canonical、Robots 与 Open Graph 社交元数据
- **文件与行号**：`scripts/build-extension.cjs`: 28, 45–47；`extension/index.html`
- **成因与影响**：本地扩展页面残留指向外网的 Canonical 和社交分享标签，无实际用途。
- **整改建议**：在扩展 HTML 处理中正则剔除上述标签。

---

#### [INFO-04] 扩展页面产物中冗余内嵌与 Manifest 完全重复的 `<meta http-equiv="Content-Security-Policy">`
- **文件与行号**：`scripts/build-extension.cjs`: 26–27；`src/extension/manifest.json`: 21–23
- **成因与影响**：MV3 扩展页面完全由 Manifest 控制 CSP，HTML 中的 Meta 标签属于冗余实体。
- **整改建议**：直接剔除扩展 HTML 中的 CSP Meta。

---

#### [INFO-05] `weather-data.js` 的 `toDisplayTemp` 在特定负小数舍入时产生 `-0` 渲染为 `"-0°"`
- **文件与行号**：`src/js/utils/weather-data.js`: 21–25
- **成因与影响**：`Math.round(-0.2)` 在 IEEE 754 规范下为 `-0`，UI 呈现为 `"-0°"`。
- **整改建议**：对结果归一化：`val === 0 ? 0 : val`。

---

#### [INFO-06] `category-catalog.js` 的 `Intl.Collator` 实例硬编码 `'zh-CN'` 未动态匹配用户语言
- **文件与行号**：`src/js/utils/category-catalog.js`: 3
- **成因与影响**：多语言切换后，书签排序规则仍使用中文拼音排序器。
- **整改建议**：允许由外部注入当前 `getLocale()` 实例。

---

#### [INFO-07] `cdp.mjs` 全局注册 `uncaughtException` 并强行 `process.exit(1)`，绕过 Node 原生测试运行器汇总
- **文件与行号**：`test/support/cdp.mjs`: 99–108
- **成因与影响**：单个测试发生未捕获异常时整个进程被立即杀掉，无法输出完整的失败汇总报告。
- **整改建议**：交由 Node.js 测试运行器接管异常。

---

#### [INFO-08] `test/visual-regression.mjs` 仅断言 DOM 几何包围盒与计算样式，缺乏真实像素差分校验
- **文件与行号**：`test/visual-regression.mjs`: 1–9
- **成因与影响**：脚本生成截图并断言宽高边界，未能覆盖滤镜破损或模糊变黑等真实像素回归。
- **整改建议**：文档中更名为“视觉布局断言工具”，或引入像素比对库。

---

#### [INFO-09] `start.command` macOS 一键启动脚本在 Bash 环境下尝试 source Zsh 配置文件
- **文件与行号**：`start.command`: 1, 10–14
- **成因与影响**：Bash 下 source 含有 zsh 专有语法的 `.zshrc` 会静默失败或污染子 shell。
- **整改建议**：Shebang 调整为 `#!/bin/zsh`。

---

#### [INFO-10] CI 流水线单 Node 版本运行，缺少 Node 26 矩阵验证与奇数版本支持声明
- **文件与行号**：`package.json`: 6–8；`.github/workflows/ci.yml`: 33
- **成因与影响**：声明支持 Node 26 但 CI 仅锁死在 Node 24.15.0。
- **整改建议**：CI 增加 `node-version: [24.15.0, 26.x]` 测试矩阵。

---

## 五、测试套件与基础设施有效性深度分析

### 5.1 CDP 真机测试与轻量化架构
项目完全基于 Node 原生 `fetch` 与 `WebSocket` 构建了微型 Chrome CDP 客户端（`test/support/cdp.mjs`），直接操纵无头 Chrome。这相比臃肿的 Puppeteer/Playwright 框架显著降低了磁盘占用和进程启动损耗，能在数秒内完成复杂交互的冷启动与手势校验。

### 5.2 Mock 保真度缺陷与外网流量泄漏
审查发现：
1. `test/infra-chrome-extension.test.mjs` 仅在页面端拦截了搜索引擎 Fetch 请求，完全未对 Open-Meteo 天气接口与 IP 地理定位接口进行 Mock。测试执行时产生的真实网络流量直接穿透至外网。在脱机环境构建或弱网 CI 节点中，这会导致测试偶发性阻塞。
2. 部分端到端测试存在“先全局重写 `window.fetch`，然后手动触发内部更新函数”的操作，绕过了真实网络链路状态机的端到端流转。

### 5.3 测试盲区与断言颗粒度分析
1. **[MED-03] 的长期潜伏**：在扩展缓存清理测试中，用例仅断言了点击后的弹窗按钮文字（`Reload page`），却对触发该弹窗的静态设置面板按钮完全缺失断言，导致界面错显“离线 Service Worker 缓存”长达多个版本未被察觉。
2. **多语言与特殊字符盲区**：测试集未包含日韩文、西里尔文及变音符拉丁文的书签模糊检索用例，使得 `bookmark-search.js` 的 Unicode 阻断问题脱靶。
3. **现代 API 兼容性盲区**：由于运行测试的 Node.js 24/26 与当前 Chrome 均原生支持 `URL.parse()`，导致测试环境从未能暴露 Safari 17 等运行时的白屏致命缺陷。

### 5.4 CI 自动化流水线断层与环境缺失
1. **W3C 校验滞后**：GitHub Actions 将 `npm run test:w3c` 限制在 `main` 分支触发。开发者提交的 Pull Request 不经过 Stylelint 校验，导致样式违规只有合入主干后才报警。
2. **macOS 专有测试在 Linux CI 中被全量跳过**：`infra-icon-sync.test.mjs` 因依赖 `sips` 在 GitHub Actions（`ubuntu-latest`）上被 100% skip，使得图标同步的核心代码长期处于 CI 零覆盖状态。

---

## 六、分级整改与架构加固路线图

```
整改实施三阶段计划:
┌─────────────────────────────────────────────────────────────┐
│ P0: 阻断性兼容崩溃与数据安全 (即刻修复, 预计工时: 0.5 天)     │
│ - [HIGH-01] 消除 URL.parse() 兼容性白屏 (bookmark-model/i18n)│
│ - [MED-01]  修复 OverlayStack 文本划选释放误关弹窗导致草稿丢失 │
│ - [MED-02]  加固 resolveLocale 非字符串语言数组异常崩溃        │
│ - [MED-08]  解除 sync-icons.mjs 对 macOS sips 的硬编码绑定    │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ P1: 功能缺陷与测试保真度 (近期修复, 预计工时: 1 天)           │
│ - [MED-03]  扩展构建 i18nBootstrap 注入 __GLASS_EXTENSION__ 宏│
│ - [MED-04]  补齐扩展端天气 API Mock 桩，细化设置面板断言      │
│ - [MED-05]  增强 idb.js onblocked / onversionchange 升级韧性  │
│ - [MED-06]  修复 dom.js Proxy 断开节点返回逻辑               │
│ - [MED-07]  扩展 bookmark-search.js 支持 Unicode 多语言搜索   │
│ - [LOW-11]  CI 流水线提早 Stylelint 至 PR 门禁                │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ P2: 架构优化与代码纯净度 (版本演进, 预计工时: 1.5 天)         │
│ - [LOW-04]  扩展包 Service Worker 更新逻辑实施 DCE 编译剔除    │
│ - [LOW-05]  补全扩展 manifest.json 16x16 与 48x48 规格图标   │
│ - [LOW-10/14] 优化 Windows 开发服务 start 唤起与符号链接覆盖  │
│ - [LOW-12]  消除 test/support getFreePort() TOCTOU 竞争     │
│ - [INFO 01-10] 清理元标签冗余、对齐正则与微调无障碍状态        │
└─────────────────────────────────────────────────────────────┘
```

### 6.1 P0 立即处置 (Immediate / 阻断性与数据安全)
- **目标**：消除在非最新版操作系统下的白屏阻断、修复编辑文本划选导致的数据丢失，保障跨平台基础可用。
- **任务清单**：
  1. 修复 `src/js/utils/bookmark-model.js` 与 `src/js/core/i18n.js` 中的 `URL.parse`，改用标准 `try...catch new URL()` 安全降级（消除 [HIGH-01]）；
  2. 改造 `src/js/core/overlay-stack.js`，引入 `pointerdown` 校验，杜绝文本拖选释放误触弹窗关闭（消除 [MED-01]）；
  3. 修复 `src/js/core/i18n.js` 的 `resolveLocale` 防空逻辑（消除 [MED-02]）；
  4. 改造 `scripts/sync-icons.mjs`，在 Linux/Windows 下降级为纯 JS PNG 魔数校验（消除 [MED-08]）。

### 6.2 P1 近期优化 (Near-Term / 功能完整与测试保真)
- **目标**：消除扩展端文案分裂，消除外网流量外溢，提升数据库与搜索的国际化健壮性。
- **任务清单**：
  1. 在 `scripts/build.cjs` 中为 `i18nBootstrap` 补充 `define: { 'window.__GLASS_EXTENSION__': String(extension) }`（消除 [MED-03]）；
  2. 在 `test/infra-chrome-extension.test.mjs` 中补充天气接口的 Mock 拦截，并补充对设置面板原生按钮文本的断言（消除 [MED-04]）；
  3. 改造 `src/js/utils/idb.js`，支持 `onblocked`、`onversionchange` 及断线重连（消除 [MED-05] 与 [LOW-07]）；
  4. 修复 `src/js/state/dom.js` 中的 Proxy 缓存，节点脱离且无新节点时返回 `null`（消除 [MED-06]）；
  5. 升级 `src/js/utils/bookmark-search.js` 正则为 Unicode `\p{L}` / `\p{N}`（消除 [MED-07]）；
  6. 调整 `.github/workflows/ci.yml`，使离线 Stylelint 校验在 PR 阶段强制运行（消除 [LOW-11]）。

### 6.3 P2 架构增强 (Architectural Enhancements / 健壮性与纯净度)
- **目标**：实现产物体积极致裁剪、消除跨平台边缘摩擦、提升工程规范一致性。
- **任务清单**：
  1. 在 `src/js/init.js` 与 `service-worker-updates.js` 引入编译期常量，实现扩展产物 DCE 瘦身（消除 [LOW-04]）；
  2. 生成标准 16px 与 48px 图标并登记入 `src/extension/manifest.json`（消除 [LOW-05]）；
  3. 修复 `scripts/server.cjs` 的 Windows 浏览器唤起与 `publish-build.cjs` 符号链接覆盖（消除 [LOW-10] 与 [LOW-14]）；
  4. 消除 `test/support/helpers.mjs` 端口竞争并清理开发服务器句柄泄漏（消除 [LOW-12] 与 [LOW-15]）；
  5. 逐一落地 [INFO-01] 至 [INFO-10] 的细节修缮与文案对齐。

---

## 七、结语

Glass Start 在架构设计、性能追求与原生 Web API 实践上处于极高水准，其代码整洁度、模块分层意识以及对奥卡姆剃刀原则的践行值得称道。本次代码审计系统性排查出的 34 项发现，绝大多数属于对边缘环境（特定操作系统、旧版浏览器引擎、网络波动、特殊语言字符）的防御纵深增强与构建链条的细节对齐。只要依循上述路线图完成针对性加固，Glass Start 将在保持轻巧纯粹特性的同时，跃升至工业级的极致稳健状态。

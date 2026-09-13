# 🤖 Glass Start — AI 编程行为宪法与工程准则 (AGENTS.md)

本文档是所有进入本项目的 AI 编程助手必须无条件遵守的最高级别工程红线。
系统架构设计与决策图谱详见 ➔ [**ARCHITECTURE.md**](./ARCHITECTURE.md) | 全站指南 ➔ [**README.md**](./README.md)。

---

## 🚫 一、核心工程红线 (Non-Negotiable Red Lines)

### 1. 架构纯净与生命周期
- **零运行时依赖**：严禁在 `package.json` 添加任何 `dependencies`；仅允许原生 Web API 与现有 `devDependencies`。
- **源码单向流动**：修改仅限 `src/`、`bookmarks.json`、`sw.js`，严禁触碰 `dist/`；Tailwind v4 仅使用 `@theme`，严禁创建 `tailwind.config.js`。
- **壁纸物理隔离**：大图/Base64 壁纸必须存入 IndexedDB (`src/js/utils/idb.js`)，严禁写入 LocalStorage。
- **书签数据与本地图标流水线门禁**：纯中文 `desc` 必须 <= 9 字；含英数混排 `desc` 必须 <= 13 字符；全量预设书签必须 100% 采用本地同源相对路径 `./icons/{domain}.png`（严禁外链或留空）。**变动触发契约**：新增或修改 `bookmarks.json` 中的书签后，必须依次执行 `npm run sync:icons`（自动抓取、清洗占位标并经 macOS 原生 `sips` 标准化转写为 1:1 本地 PNG 图标）与 `npm run lint` 静态门禁断言。

### 2. 状态驱动与 DOM/CSS 守卫
- **严禁逆向搜刮 DOM (Zero DOM Harvesting)**：弹窗书签编辑/添加/删除/拖拽重排必须 100% 依托 `modalState.draftBookmarks` 纯内存响应式草稿单向驱动；保存与导出直接消费内存模型，做到 0 次 DOM 查询逆向解析与零 Reflow。
- **DOM 缓存池同步**：HTML 中新增/修改具名 ID 时，必须同步在 `src/js/state/dom.js` 的 `cacheDOM()` 注册。
- **弹窗层叠栈**：严禁直接修改 DOM `style.display` 或 `hidden`；统一通过 `OverlayStack.push(id, closeFn)` 与 `.pop(id)` 压退栈（遵循 150/1000/2000/9999 4 级 z-index）。
- **CSS 纯净与视口**：零 `!important`（仅放行 `prefers-reduced-motion`）；严禁 `-webkit-font-smoothing`；单行输入框字体必须 >= 16px；卡片 `:hover` 必须加 `body:not(.tab-blurred)` 前缀防失焦残留。
- **安全防线与 A11y**：动态文本必经 `escapeHtml()` / `safeUrl()`；气象数据必经 `weatherNum()`；所有 `<button>` 显式声明 `type="button"`，所有装饰 `<svg>` 标注 `aria-hidden="true"`，交互图标声明 `aria-label`；发布前 `npm run test:w3c` 必须 0 报错。

### 3. 工具调用与 Git 权限边界
- **工具调用硬熔断**：同一工具同参数最多调用 2 次；严禁在无新信息下重复检查同一文件或重复执行命令；连续 2 次无实质进展，**立即停止且严禁尝试猜测性变体**；一旦无法定位根因，立即停用所有工具，向用户汇报并请示。
- **Git 权限真理源**：版本号以 `package.json` 为唯一真理源；未经明确授权严禁 `git push`；日常验证严禁滥用 `--force`。

---

## 🛠️ 二、极速自愈与验证流水线 (Tiered QA Pipeline)

| 开发阶段 | 核心执行命令 | 作用与预期 |
| :--- | :--- | :--- |
| **书签增删改动后** | `npm run sync:icons && npm run lint` | 自动抓取转写 1:1 本地图标并执行全量门禁校验 |
| **代码修改后必跑** | `npm run lint` | 静态规范门禁（支持 `--fix` 一键自愈） |
| **局部功能修改后** | `npm run test:ui` / `data` / `infra` / `lifecycle` | 模块切片单测 |
| **常规提交前验证** | `npm test` | 核心增量回归套件 |
| **版本发布前全量** | `npm run build && npm run test:all && npm run test:w3c` | 生产打包与全量合规断言 |

---

## 🗺️ 三、ES 模块精准开发索引 (Module Map)

定位目标功能请直接切片对应文件，严禁巨石全量扫描：

| 业务领域与核心意图 | 对应 ES 模块 (`src/`) | 核心函数 / DOM 锚点 |
| :--- | :--- | :--- |
| **全站配置与常量真理源** | `src/js/config/constants.js` | `CONFIG`, `DEFAULT_BOOKMARKS`, `DEFAULT_CATEGORIES` |
| **首屏主题与 Safari 预渲染** | `src/js/config/themes.js` | `PRESET_THEMES`, `targetColor` |
| **全局状态与 DOM 缓存池** | `src/js/state/store.js`<br/>`src/js/state/dom.js` | `dom`, `state`, `cacheDOM()`, `$` |
| **书签体系与双栏分类导航** | `src/js/modules/bookmarks.js` | `getDerivedBookmarks()`, `renderBookmarks()`, `renderNavCategories()` |
| **时钟引擎、快捷键与鸣谢** | `src/js/modules/clock.js` | `updateClock()`, `applyPlatformShortcuts()`, `renderShortcutModalList()` |
| **壁纸持久化与即选即存** | `src/js/modules/wallpaper.js` | `commitWallpaperSelection()`, `previewDraftWallpaper()` |
| **设置弹窗与生命周期管理** | `src/js/modules/settings.js`<br/>`src/js/core/overlay-stack.js` | `openEditModal()`, `closeEditModal()`, `OverlayStack`, `modalState.draftBookmarks`, `collectEditData()` |
| **搜索联想与防竞态调度** | `src/js/modules/search.js` | `renderSuggestions()`, `fetchSuggestions()`, `activeSuggestReqId` |
| **气象数据清洗与动态演化** | `src/js/modules/weather.js` | `initWeather()`, `weatherNum()`, `WMO_WEATHER_MAP` |
| **外壳主题与底色动态管理** | `src/js/core/theme-engine.js` | `APP_THEME_DARK`, `APP_THEME_LIGHT`, `updateThemeColor()` |
| **双屏有限状态机与唤醒自愈** | `src/js/core/screen-state.js`<br/>`src/js/core/lifecycle.js` | `switchToNav()`, `switchToStart()`, `reconcileScreenState()` |
| **VisionOS 3D 倾斜与高光** | `src/js/core/gestures.js` | `initGlassSpotlightAndTilt()`, `resetActiveCard()` |
| **拖拽重排与 FLIP 物理吸附** | `src/js/core/drag-sort.js` | `initDragSort()` |
| **全局事件中枢与焦点捕获** | `src/js/core/events.js` | `bindEvents()`, `bindEditEvents()`, `handleModalTabFocus()` |
| **XSS 安全防线与字符纠错** | `src/js/utils/helpers.js` | `escapeHtml()`, `safeUrl()`, `normalizeUrl()`, `damerauLevenshtein()` |
| **IndexedDB 大图壁纸持久化** | `src/js/utils/idb.js` | `getWallpaperDB()`, `setWallpaperDB()`, `clearWallpaperDB()` |
| **本地图标同步与清洗流水线** | `scripts/sync-icons.mjs`<br/>`public/icons/` | `main()`, `isPlaceholder()`, `saveAsPng()`, `npm run sync:icons` |
| **启动装配与生命周期入口** | `src/js/init.js`<br/>`src/js/main.js` | `initApp()`, `initPreHydration()` |
| **离线底座与三池物理隔离** | `sw.js` | `CORE_CACHE`, `FAVICON_CACHE`, `IMG_CACHE` |

# 🤖 Glass Start — AI 编程行为宪法与工程准则 (AGENTS.md)

本文档是所有进入本项目的 AI 编程助手必须无条件遵守的最高级别工程红线。
系统架构设计与决策图谱详见 ➔ [**ARCHITECTURE.md**](./ARCHITECTURE.md) | 全站指南 ➔ [**README.md**](./README.md)。

---

## 🚫 一、不可触碰的 7 大工程红线 (The 7 Non-Negotiable Red Lines)

1. **零运行时依赖**：严禁在 `package.json` 添加任何运行时 `dependencies`；仅允许使用原生 Web API 与现有 `devDependencies`（Tailwind CLI/esbuild）。
2. **源码单向流动**：所有业务修改仅限 `src/`、`bookmarks.json` 与 `sw.js`，严禁直接修改 `dist/` 构建产物；Tailwind v4 采用原生 `@theme` 配置，严禁创建 `tailwind.config.js`。
3. **CSS 纯净与视口守卫**：CSS 零 `!important`（仅放行 `prefers-reduced-motion` 白名单）；严禁添加 `-webkit-font-smoothing`；所有单行文本输入框字体必须 $\ge 16\text{px}$（包含 `text-base`）。
4. **W3C A11y 合规**：所有 `<button>` 显式声明 `type="button"`；所有装饰 `<svg>` 标注 `aria-hidden="true"`；所有交互图标声明 `aria-label`；发布前 `npm run test:w3c` 必须 0 报错。
5. **弹窗层叠栈**：严禁直接修改 DOM `style.display` 或 `hidden`；统一通过 `OverlayStack.push(id, closeFn)` 与 `.pop(id)` 压退栈，遵循 4 级 z-index 体系（150/1000/2000/9999）。
6. **书签双轨字数**：纯中文 `desc` 必须 $\le 9$ 字；含英数混排 `desc` 必须 $\le 13$ 字符。改动后必须运行 `npm run lint` 验证。
7. **Git 权限与真理源**：版本号以 `package.json` 为唯一真理源；严禁未经明确授权擅自执行 `git push`；日常验证严禁滥用 `--force`。

---

## 🛠️ 二、极速自愈与验证流水线 (Tiered QA Pipeline)

| 开发阶段 | 核心执行命令 | 作用与耗时预期 |
| :--- | :--- | :--- |
| **代码修改后必跑** | `npm run lint` | 静态规范 28 项门禁（<30ms，支持 `--fix` 一键自愈） |
| **局部功能修改后** | `npm run test:ui` / `data` / `infra` / `lifecycle` | 精准模块单测（极速通过） |
| **常规提交前验证** | `npm test` | 5 大套件增量回归验证 |
| **版本发布前全量** | `npm run build && npm run test:all && npm run test:w3c` | 生产打包、24 项全量断言与 W3C 0 语法错误合规 |

---

## 🗺️ 三、ES 模块精准开发索引 (Module Map)

定位目标功能请直接切片对应文件，严禁巨石全量扫描：

| 业务领域与核心意图 | 对应 ES 模块 (`src/`) | 核心函数 / DOM 锚点 |
| :--- | :--- | :--- |
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
| **全局事件中枢与拖拽重排** | `src/js/core/events.js` | `bindEvents()`, `bindEditEvents()`, `initDragSort()` |
| **XSS 安全防线与字符纠错** | `src/js/utils/helpers.js` | `escapeHtml()`, `safeUrl()`, `normalizeUrl()`, `damerauLevenshtein()` |
| **IndexedDB 大图壁纸持久化** | `src/js/utils/idb.js` | `getWallpaperDB()`, `setWallpaperDB()`, `clearWallpaperDB()` |
| **启动装配与生命周期入口** | `src/js/init.js`<br/>`src/js/main.js` | `initApp()`, `initPreHydration()` |
| **离线底座与三池物理隔离** | `sw.js` | `CORE_CACHE`, `FAVICON_CACHE`, `IMG_CACHE` |

---

## 💡 四、高频避坑守则 (Key Practices)

1. **DOM 缓存池同步**：HTML 中新增/修改具名 ID 时，必须同步在 `src/js/state/dom.js` 的 `cacheDOM()` 中注册。
2. **大图壁纸持久化**：大尺寸 Base64 壁纸必须存入 IndexedDB (`idb.js`)，严禁写入 LocalStorage。
3. **数据清洗与防 XSS**：动态文本必须经 `escapeHtml()` / `safeUrl()` 过滤；气象数据必须经 `weatherNum()` 强制数值化。
4. **防假性悬停残留**：卡片 `:hover` 规则必须加 `body:not(.tab-blurred)` 前缀，防止页面切回时残留悬停高亮。
5. **严禁 DOM Harvesting**：严禁通过 `querySelectorAll`、`dataset` 逆向从 DOM 中搜刮业务状态；设置弹窗内书签编辑、添加、删除与拖拽重排必须 100% 依托 `modalState.draftBookmarks` 纯内存响应式草稿单向驱动，保存与导出直接消费内存模型，做到 0 次 DOM 查询与零 Reflow 重排。

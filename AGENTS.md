# Glass Start — AI 编程工程准则

本文件规定项目内的开发约束；遵循系统、开发者与用户指令的优先级。
架构说明见 [ARCHITECTURE.md](./ARCHITECTURE.md)，使用与部署见 [README.md](./README.md)。

---

## 一、工程约束

### 1. 架构纯净与生命周期
- **零运行时依赖**：严禁在 `package.json` 添加任何 `dependencies`；仅允许原生 Web API 与现有 `devDependencies`。
- **源码单向流动**：应用源码修改仅限 `src/`、`bookmarks.json`、`sw.js`；文档、工具及测试仅在任务明确涉及时修改，图标同步可更新 `public/icons/`。严禁手工修改 `dist/`，构建产物统一由命令生成；Tailwind v4 仅使用 `@theme`，严禁创建 `tailwind.config.js`。
- **壁纸物理隔离**：大图/Base64 壁纸必须存入 IndexedDB (`src/js/utils/idb.js`)，严禁写入 LocalStorage。
- **书签数据与本地图标流水线门禁**：纯中文 `desc` 必须 <= 9 字；含英数混排 `desc` 必须 <= 13 字符；全量预设书签必须 100% 采用本地同源相对路径 `./icons/{domain}.png`（严禁外链或留空）。**变动触发契约**：新增或修改 `bookmarks.json` 中的书签后，必须依次执行 `npm run sync:icons`（自动抓取、清洗占位标并经 macOS 原生 `sips` 标准化转写为 1:1 本地 PNG 图标）与 `npm run lint` 静态门禁断言。

### 2. 状态驱动与 DOM/CSS 守卫
- **严禁逆向搜刮 DOM (Zero DOM Harvesting)**：弹窗书签编辑/添加/删除/拖拽重排必须 100% 依托 `modalState.draftBookmarks` 纯内存草稿单向驱动（普通对象，由事件显式更新与渲染）；保存与导出直接消费内存模型，禁止从 DOM 反向解析书签数据；焦点管理、事件定位与拖拽布局测量不在此禁令内，不承诺零 Reflow。
- **DOM 缓存池同步**：HTML 中新增/修改具名 ID 时，必须同步在 `src/js/state/dom.js` 的 `cacheDOM()` 注册。
- **弹窗层叠栈**：业务模块严禁直接修改弹窗的 `style.display` 或 `hidden`；显示生命周期由层叠栈内部持有，业务统一通过 `OverlayStack.push(id, closeFn)` 与 `.pop(id)` 压退栈（遵循 150/1000/2000/9999 4 级 z-index）。
- **CSS 纯净与视口**：零 `!important`（仅放行 `prefers-reduced-motion`）；严禁 `-webkit-font-smoothing`；单行输入框默认及触屏状态字体必须 >= 16px；仅快捷书签编辑器与网络壁纸直链输入框允许使用 `mouse-desktop:text-xs` 恢复原版桌面字号，该变体必须同时满足宽度 >= 640px、hover、精细指针且无粗指针设备，混合触屏设备仍保持 >= 16px；卡片 `:hover` 必须加 `body:not(.tab-blurred)` 前缀防失焦残留。
- **安全防线与 A11y**：动态文本插入 HTML 时使用 `escapeHtml()`，URL 属性使用 `safeUrl()`；`textContent` 直接接收文本。气象数值使用 `weatherNum()`，时间与地点另行校验、转义；所有 `<button>` 显式声明 `type="button"`，所有装饰 `<svg>` 标注 `aria-hidden="true"`，交互图标声明 `aria-label`；发布前 `npm run test:w3c` 必须 0 报错。

### 3. 工具调用与 Git 权限边界
- **工具调用硬熔断**：同一工具同参数最多调用 2 次；严禁在无新信息下重复检查同一文件或重复执行命令；连续 2 次无实质进展，**立即停止且严禁尝试猜测性变体**；一旦无法定位根因，立即停用所有工具，向用户汇报并请示。
- **Git 权限真理源**：版本号以 `package.json` 为唯一真理源；未经明确授权严禁 `git push`；日常验证严禁滥用 `--force`。

---

## 二、分级验证

| 开发阶段 | 核心执行命令 | 作用与预期 |
| :--- | :--- | :--- |
| **书签增删改动后** | `npm run sync:icons && npm run lint` | 自动抓取转写 1:1 本地图标并执行全量门禁校验 |
| **代码修改后必跑** | `npm run lint && npm run typecheck` | 静态规范门禁（`npm run lint:fix` 修复支持的机械规则） |
| **局部功能修改后** | `npm run test:ui` / `npm run test:data` / `npm run test:infra` / `npm run test:lifecycle` | 按模块筛选的回归测试 |
| **常规提交前验证** | `npm test` | 核心回归套件（每次实际运行） |
| **版本发布前全量** | `npm run build && npm run test:all && npm run test:w3c` | 生产构建、回归测试与在线 HTML 校验 |

---

## 三、模块索引

按功能定位下列模块，避免无目的通读。函数与导出以源码为准；业务配置值不在文档重复维护。

| 功能 | 源码入口 |
| :--- | :--- |
| **全站配置与常量真理源** | `src/js/config/constants.js` |
| **首屏主题与 Safari 预渲染** | `src/js/config/themes.js` |
| **全局状态与 DOM 缓存池** | `src/js/state/store.js`<br/>`src/js/state/dom.js` |
| **书签体系与双栏分类导航** | `src/js/modules/bookmarks.js` |
| **时钟引擎、快捷键与鸣谢** | `src/js/modules/clock.js` |
| **壁纸持久化与即选即存** | `src/js/modules/wallpaper.js` |
| **设置弹窗与生命周期管理** | `src/js/modules/settings.js`<br/>`src/js/core/overlay-stack.js` |
| **搜索联想与匹配** | `src/js/modules/search.js`<br/>`src/js/utils/bookmark-search.js` |
| **气象数据与显示** | `src/js/modules/weather.js`<br/>`src/js/utils/weather-model.js` |
| **外壳主题与底色动态管理** | `src/js/core/theme-engine.js` |
| **双屏有限状态机与唤醒自愈** | `src/js/core/screen-state.js`<br/>`src/js/core/lifecycle.js` |
| **指针 3D 倾斜与高光** | `src/js/core/gestures.js` |
| **拖拽重排与 FLIP 动画** | `src/js/core/drag-sort.js` |
| **全局事件中枢与焦点捕获** | `src/js/core/events.js` |
| **XSS 安全防线与 URL 处理** | `src/js/utils/helpers.js` |
| **IndexedDB 大图壁纸持久化** | `src/js/utils/idb.js` |
| **本地图标同步与清洗流水线** | `scripts/sync-icons.mjs`<br/>`public/icons/` |
| **启动装配与生命周期入口** | `src/js/init.js`<br/>`src/js/main.js` |
| **天气共用数值清洗** | `src/js/utils/weather-data.js` |
| **目录共用索引** | `src/js/utils/category-catalog.js` |
| **书签草稿编辑** | `src/js/modules/bookmark-editor.js`<br/>`src/js/state/bookmark-draft.js` |
| **设置事件装配** | `src/js/core/settings-events.js` |
| **确认框与壁纸渲染** | `src/js/core/dialogs.js`<br/>`src/js/core/wallpaper-renderer.js` |
| **离线底座与三池物理隔离** | `sw.js` |

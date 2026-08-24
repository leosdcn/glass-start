# 🤖 Glass Start — AI 编程行为宪法与工程准则 (AGENTS.md)

本文档是所有进入本项目（**Glass Start — 灵动起始页与分类导航**）的 AI 编程助手与自主代理（AI Coding Agents）必须无条件遵守的**最高级别开发宪法与工程红线**。

在阅读、分析、修改任何源码或执行重构前，AI 必须严格遵守本文档所规定的所有约束。

---

## 🚫 一、不可触碰的 7 大工程红线 (The 7 Non-Negotiable Red Lines)

### 1. 🔴 零运行时 npm 依赖原则 (Zero Runtime Dependency)
- **铁律**：严禁在 `package.json` 的 `dependencies` 中引入任何运行时的外部 npm 依赖包（如 React, Vue, Lodash, Axios, Dayjs, Date-fns, jQuery 等）。
- **执行准则**：
  - 必须使用现代原生 Web API（Native Fetch, DOM API, Canvas 2D, CSS Variables, Service Worker API, CacheStorage, Web Cryptography）；
  - 仅允许使用 `devDependencies` 中现有的 `@tailwindcss/cli`（v4 原子化编译）与 `esbuild`（AST 高性能压缩）作为离线构建工具；
  - 客户端运行时必须保持**单文件纯原生、零依赖秒开**的极简架构。

---

### 2. 🔴 CSS 零非标 `!important` 污染 (Clean CSS Enforcement)
- **铁律**：严禁在 `<style>` 或内联样式中滥用 `!important`。
- **执行准则**：
  - 唯一允许放行的特例为 `@media (prefers-reduced-motion: reduce)` 国际无障碍减弱动效白名单（`lint.mjs` 门禁会自动静态扫描）；
  - 样式覆盖必须通过 **CSS 变量动态绑定**、**组合选择器特异性（Specificity）** 或 **DOM 状态类名切换**（如 `body:not(.tab-blurred)`）解决；
  - 严禁为了“图省事”而使用 `!important` 破坏 CSS 规则级联层。

---

### 3. 🔴 移动端 iOS 16px 防自动放大规范 (iOS Viewport Guard)
- **铁律**：全站所有单行 `<input type="text">` 文本输入框的计算字体大小必须 $\ge 16\text{px}$。
- **执行准则**：
  - 必须包含 Tailwind 类名 `text-base`（或 `text-lg`/`text-xl`），禁止使用小于 16px 的类名（如 `text-xs`/`text-sm`）；
  - 此项用于彻底杜绝 iOS Safari 在聚焦输入框时强行拉近放大视口、破坏全站响应式布局的浏览器顽疾（`lint.mjs` 会进行强制校验）。

---

### 4. 🔴 W3C WAI-ARIA 无障碍全量合规 (A11y Standard)
- **铁律**：全站所有交互与装饰元素必须 100% 符合 W3C WAI-ARIA 无障碍标准。
- **执行准则**：
  - **所有 `<button>` 标签**：必须 100% 显式声明 `type="button"`（防止在 form 上下文中被意外触发为 submit）；
  - **所有装饰性 `<svg>` 图标**：必须显式标注 `aria-hidden="true"`；
  - **所有交互性图标按钮**：必须显式标注 `aria-label` 描述其可访问名称；
  - **焦点环规范**：必须遵循 Apple HIG 规范，键盘导航时呈现 `:focus-visible` 白色半透明描边与外发光，鼠标点击时 `:focus:not(:focus-visible)` 保持干净无圈。

---

### 5. 🔴 弹窗管理必须通过 OverlayStack 压退栈 (Modal Hierarchy)
- **铁律**：严禁通过直接修改 DOM 的 `style.display = 'block'` 或直接移除 `hidden` 属性来弹出/关闭弹窗。
- **执行准则**：
  - 必须统一通过 `OverlayStack.push(id, closeFn)` 进行压栈，通过 `OverlayStack.pop(id)` 进行退栈；
  - 严格遵循 4 级 $z$-index 体系（`z-150` 下拉 ➔ `z-1000` 设置 ➔ `z-2000` 提取/快捷键/鸣谢 ➔ `z-9999` 二次确认）；
  - 确保全局键盘 `Escape` 键能够按照**后进先出（LIFO）**顺序逐层剥离，并自动管理 `document.body` 的 `overflow-hidden touch-none` 滚动穿透锁定。

---

### 6. 🔴 SemVer 版本号 4 处文件强一致性 (Version Alignment)
- **铁律**：发布任何新版本时，必须同步对齐以下 4 处文件中的版本号字符串，严禁只修改单处：
  1. `package.json` 中的 `"version": "x.y.z"`
  2. `package-lock.json` 中的两处 `"version": "x.y.z"`（根节点与 packages 节点）
  3. `index.html` 设置弹窗数据仪表盘中的版本徽章 `<span ...>vx.y.z</span>`
  4. `README.md` 第 6 节依赖清单表格中的 `Glass Start 站点版本`
- **执行准则**：严格遵循 SemVer 语义化版本规则（`主版本(MAJOR).次版本(MINOR).修订号(PATCH)`）。

---

### 7. 🔴 Git 权限边界与安全纪律 (Git Safety Protocol)
- **铁律**：**严禁在未经人类用户明确指令的情况下，擅自向远程仓库执行 `git push`！**
- **执行准则**：
  - AI 可以根据任务进展在本地执行 `git add` 和 `git commit` 保存工作区进度；
  - 所有的远程推送（`git push`）必须由人类用户明确指示后方可执行。

---

## 🛠️ 二、标准开发与质量验证工作流 (Quality Assurance)

任何代码修改或重构完成后，AI 必须依次执行以下闭环校验命令，确保 0 报错后再向用户交付：

```bash
# 1. 静态规范与语法门禁检查 (耗时 < 100ms，必须 22/22 项全绿)
npm run lint

# 2. 生产环境构建打包 (验证 Tailwind v4 编译、CSP 优化与 esbuild AST 压缩)
npm run build

# 3. 全量端到端自动化测试套件 (必须 3 大套件 19 项高密度断言全绿)
node test/run.mjs --force

# 4. 如涉及关键 UI / 动画 / 视口变动，执行多视口全景视觉回归测试 (11 大场景断言)
node test/visual-regression.mjs
```

---

## 🗺️ 三、核心系统架构导读 (System Map)

在着手修改任何业务逻辑前，请务必先查阅 [**ARCHITECTURE.md**](./ARCHITECTURE.md) 系统架构设计白皮书，了解各模块拓扑与生命周期：

| 业务领域 | 核心逻辑位置 (`index.html`) | 关联架构图与核心设计机制 |
| :--- | :--- | :--- |
| **UI 与 3D 光影** | `Lines 1~1460, 7550~7749` | **图 1**：Liquid Glass、Tailwind v4、Pointer Motion Gating 光影守卫、3D 陀螺仪 |
| **双屏切换与 BFCache** | `Lines 4600~5150, 7100~7550` | **图 2**：`switchToNav` / `switchToStart` 状态机、`reconcileScreenState` 纯内存自愈器、滚轮动量吞咽 |
| **弹窗与覆盖层** | `Lines 1460~2000, 3018~3050` | **图 3**：`OverlayStack` LIFO 栈模型、Focus Trap 焦点锁定与归还 |
| **离线与缓存底座** | `sw.js` (全量 337 行) | **图 4**：`CORE_CACHE` / `FAVICON_CACHE` / `IMG_CACHE` 三池物理隔离、FIFO 限额淘汰 |
| **搜索与气象演化** | `Lines 5150~7100` | **图 5**：本地 7 级书签命中算法、零 CLS 骨架混排、湿度/风速/雨伞 9 阶动态形态演化 |

---

## 💡 四、常见陷阱与防御式编程模式 (Defensive Patterns)

1. **防假性悬停残留（Synthetic Hover）**：
   - 普通跳转切出时已挂载 `body.tab-blurred`；
   - 所有卡片 `:hover` 规则均通过 `body:not(.tab-blurred)` 前缀保护；
   - 严禁随意删除 `handleTabBlur` 与 `clearTabBlurOnInteraction` 监听器。
2. **防修饰键后台打开迟滞**：
   - 点击书签时已通过 `e.metaKey || e.ctrlKey || e.button === 1` 精准分流；
   - 后台静默打开严禁添加 `.is-clicked` 惩罚类，交由原生 `:active` 呈现即时按压触感。
3. **防 XSS 注入与网络悬挂**：
   - 所有的动态书签渲染必须经过 `escapeHtml()` 与 `safeUrl()` 白名单过滤；
   - 气象数据入库必须经过 `weatherNum()` 强制数值化清洗；
   - 外部搜索联想必须配备 `activeSuggestReqId` 防竞态乱序。

---

*遵照上述准则，共同维护 Glass Start 的极致纯净、丝滑与工业级稳定性！*

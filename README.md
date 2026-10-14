# Glass Start — 流光起始页

> 极简纯净的毛玻璃浏览器起始页。

[![Version](https://img.shields.io/badge/version-v4.10.2-blue.svg)](package.json)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

---

## 目录

- [✨ 核心特色](#-核心特色)
- [🚀 快速开始与一键部署](#-快速开始与一键部署)
- [📖 用户指南与个性化定制](#-用户指南与个性化定制)
- [🛠️ 开发者与贡献者指南](#️-开发者与贡献者指南)
- [📚 核心技术文档索引](#-核心技术文档索引)

---

## ✨ 核心特色

- 🪐 **Liquid Glass 物理高光与毛玻璃美学**：遵循 Apple HIG 规范的 1px 物理折射微高光、液态微拟物触感与 iOS 18 物理按压微缩放；
- 🎬 **原生双屏无缝联动**：起始页（极简时钟与搜索）与导航页（双栏分类书签）全屏平滑推移，视口底部具备 `mask-image` 72px 真实 Alpha 透光渐隐；
- 🌤️ **免 Key 实时气象与全球预报**：国内高精度 IP 定位 + 国际测站逆解析，首帧 0ms 水合秒开，支持 2×2 动态气象指标与未来 4 天天气预报；
- ⚡ **零运行时依赖与极速首屏**：生产产物 0 npm 运行时依赖；`<head>` 内联极速预渲染消除刷新闪烁 (FOUC)，静态单页毫秒级瞬间呈现；
- 🖼️ **壁纸即选即存与 4K 支持**：精选系列高清内置壁纸在线轮播，支持自定义图片（自动压缩写入 IndexedDB，打破 5MB 限制）与高斯模糊/遮罩调节；
- 🛡️ **企业级安全防护**：内置 A+ 评级 Content Security Policy (CSP)、全面 HTML 实体安全转义与 `safeUrl` 协议白名单拦截；
- 📱 **PWA 离线优先支持**：原生 Service Worker 三池物理隔离缓存，支持断网离线浏览与无缝添加到手机/电脑桌面。

---

## 🚀 快速开始与一键部署

本项目为纯前端静态应用，支持任何静态托管平台，最快 1 分钟即可完成部署上线：

### 1. Cloudflare Pages 自动部署（推荐）
1. Fork 或上传本项目到你的 GitHub 仓库；
2. 登录 **[Cloudflare Dashboard](https://dash.cloudflare.com/)** ➔ 进入 **Workers & Pages** ➔ **Create application** ➔ **Pages** ➔ **Connect to Git**；
3. 选择你的仓库，构建配置如下：
   - **Framework preset**: `None`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. 点击 **Save and Deploy** 即可完成部署，后续每次 `git push` 到 `main` 分支均会自动构建更新。

### 2. Vercel / Netlify / GitHub Pages
- **Vercel / Netlify**：导入 Git 仓库，设置 Build Command 为 `npm run build`，Output Directory 为 `dist` 即可。
- **GitHub Pages**：在仓库 Settings ➔ Pages 中选择部署来源，将构建后的 `dist` 目录分支设为站点源。

### 3. 本地纯静态离线打开
只需在本地运行一次打包命令：
```bash
npm install
npm run build
```
直接用浏览器双击打开 `dist/index.html`，即可全功能离线使用！

---

## 📖 用户指南与个性化定制

### 1. 双屏滚动与屏幕切换
- **滚轮 / 滑动**：在首屏向下滚动或触摸屏上滑即可无缝滑向「导航页」；在导航页顶部向上滚动或下滑即可回到「起始页」。
- **快捷按钮**：导航页顶部 Header 栏及右侧悬浮的「起始页」胶囊按钮随时可一键切回。
- **键盘翻页**：在非输入状态下，按 `PageDown` / `↓` 前往导航页；按 `PageUp` / `Home` / `↑` 返回首屏。

### 2. 智能搜索与快捷跳转
- **盲打即搜**：在首屏任意空白处直接敲击键盘字母或数字，输入框自动获得焦点并输入。
- **混合联想**：输入关键词后，下拉列表同时呈现**搜索引擎联想词**与**本地书签智能匹配**。
- **键盘挑选**：通过 `↑` / `↓` 方向键循环挑选结果，按 `Enter` 立即直达。
- **新标签打开**：按 `Cmd + Enter` (Mac) 或 `Alt + Enter` (Windows) 可在新标签页中打开搜索结果。
- **多引擎切换**：点击搜索框左侧图标，可自由切换 Bing、Google、Wikipedia 等搜索引擎。

### 3. 书签自定义维护（单点真理源）
**修改/添加导航书签只需编辑根目录 `bookmarks.json` 一个文件**：
```json
{
  "bookmarks": [
    {
      "name": "LocalSend",
      "url": "https://web.localsend.org",
      "icon": "./icons/web.localsend.org.png"
    }
  ],
  "categories": [
    {
      "name": "常用工具",
      "icon": "🛠️",
      "bookmarks": [
        {
          "name": "GitHub",
          "url": "https://github.com",
          "desc": "代码托管与协作",
          "icon": "./icons/github.com.png"
        }
      ]
    }
  ]
}
```
- **`bookmarks`**：首屏快捷书签列表（包含 `name`、`url`、`icon`）。
- **`categories`**：导航页分类列表，包含分类名 `name`、Emoji 图标 `icon` 及分类书签 `bookmarks`。
- **`name`**：中文服务使用标准官方中文名，国际服务使用官方英文名。
- **`desc`**：精简的副标题。纯中文 <= 9 字，含英数混排 <= 13 字符。
- **`url`**：直连官方标准主域（避免多重跳转耗时）。
- **`icon`**：全量预设书签统一采用本地同源相对路径 `./icons/<domain>.png`（实现首屏零网络请求与瞬间解码）。新增或编辑书签时，亦可先填写外部 CDN 地址或域名，执行 `npm run sync:icons` 即可自动完成抓取清洗、`sips` 标准化转写并规范回写为本地相对路径。
- **生效方式**：编辑 `bookmarks.json` 后，先执行 `npm run sync:icons` 自动化同步图标，随后通过 `npm run lint` 验证静态门禁；打包时运行 `npm run build`，流水线会自动完成数据双向注入与本地图标静态产物同步。

### 4. 键盘快捷键速查（按 `Cmd/Ctrl + /` 唤起）

| 快捷键 (Mac / Win) | 作用与功能说明 |
| :--- | :--- |
| **`Cmd + /`** / **`Ctrl + /`** | 随时唤起或关闭【快捷键速查面板】 |
| **`Cmd + B`** / **`Ctrl + B`** | 在线一键轮播精选的高清背景壁纸 |
| **`任意按键 (A-Z, 0-9)`** | 首屏盲打自动聚焦搜索框并输入 |
| **`↑` / `↓`** | 循环挑选搜索建议词或匹配的本地快捷书签 |
| **`Enter`** | 当前页打开选中的书签或执行搜索 |
| **`Cmd + Enter`** / **`Alt + Enter`** | 在**新标签页**中打开选中的结果或执行搜索 |
| **`PageDown` / `PageUp`** | 双屏平滑切换（前往导航页 / 返回起始页） |
| **`Esc`** | 逐层退出下拉建议、弹窗面板（依 LIFO 逆序退栈） |

---

## 🛠️ 开发者与贡献者指南

首屏与运行时主题统一维护在 `src/js/config/themes.js`。构建会将配置同步内联到 HTML；`npm run dev` 的增量构建也会重新读取配置。`src/index.html` 是构建模板，请使用开发服务预览或部署 `dist/` 产物。

Tailwind 编译结果在本次构建的内存中传递并内嵌到 HTML，不再共用 `dist/style.css` 中间文件，避免多个构建进程抢占或删除 CSS。空 CSS 会阻断构建。修改 `scripts/build.js` 或其加载的辅助脚本后，请重启开发服务以加载新逻辑。

壁纸内容与预设索引在同一个 IndexedDB 事务中保存，事务提交完成后才更新已保存状态；失败会保留原数据并提示重试。LocalStorage 只保存轻量首屏提示，新选择不再向其中写入 Base64 图片。

Service Worker 更新先校验核心资源和构建指纹；新版保持等待，直到所有受旧版控制的页面退出后才激活。刷新一个仍打开的标签不保证立即升级。弹窗打开后自动移入焦点，并隔离背景交互；嵌套关闭时逐层恢复焦点。

### 本地开发工作流

```bash
# 1. 安装构建开发依赖 (Tailwind CLI & esbuild)
npm install

# 2. 启动本地开发服务 (支持增量编译热重载与局域网调试)
npm run dev

# 3. (若修改/新增书签) 自动化同步全站书签图标至 public/icons/ 目录
npm run sync:icons

# 4. 执行全量静态规范与工程红线校验
npm run lint

# 5. 运行端到端自动化测试验证
npm test

# 6. 生产构建打包 (产物位于 dist/，包含数据校验与 public/ 静态资产同步)
npm run build
```

`npm test` 会按源码和测试指纹复用通过记录；输出会分别列出实际运行与缓存跳过的套件。发布前使用 `npm run build && npm run test:all && npm run test:w3c` 执行完整验证。W3C 校验通过不代表页面样式完整；基础架构测试还会检查 HTML 中包含双屏布局与输入字号样式。

> 💡 **macOS 便捷启动**：macOS 用户可直接双击根目录的 `start.command` 脚本，自动一键装配环境并在浏览器中拉起预览。

---

## 📚 核心技术文档索引

本项目建立了清晰的规范与文档分工体系，深入研究请参阅专项文档：

- 🏛️ **[ARCHITECTURE.md (架构设计与技术白皮书)](./ARCHITECTURE.md)**：系统分层模型、双屏状态机、OverlayStack 弹窗逆序退栈、Service Worker 三池物理隔离缓存、BFCache 唤醒防护等核心技术设计。
- 🤖 **[AGENTS.md (AI 编程宪法与工程准则)](./AGENTS.md)**：不可触碰的核心工程红线、Tiered QA 自愈流水线、全模块精准文件定位索引与避坑守则。

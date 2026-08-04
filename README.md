# Glass Start - 玻璃拟态个人起始页

基于 HTML5、Tailwind CSS 与 Modern JS 构建的高颜值、轻量级玻璃拟态（Glassmorphism）浏览器起始页。

---

## ✨ 核心亮点与安全性能特性

- 🪐 ** Liquid Glass 物理高光与玻璃拟态**：采用 Apple HIG 规范的 1px 物理折射高光、微拟物触感反馈与 iOS 18 物理按压微缩放。
- ⚡ **零开销双模式构建 (Dev vs Prod)**：开发模式使用 Tailwind v4 Browser CDN 随改随看；生产打包（`npm run build`）自动编译精简纯 CSS 并剥离 JS 编译脚本，实现秒开与 100% 离线使用。
- 🛡️ **严格安全防护**：内置严格 Content Security Policy (CSP)、全面 XSS HTML 实体转义、`safeUrl` 协议白名单拦截（防 `javascript:` 注入）、JSONP 超时悬挂防爆防护。
- 🚀 **图标高性能缓存**：内置 Service Worker (v9)，三池隔离（800+200配额）与 IndexedDB 真 LRU 淘汰，结合标准 CORS 模式彻底消除 Chrome 虚拟存储配额膨胀问题。

---

## 📖 用户使用指南手册

### 1. 屏间切换与导航交互
* **滚轮 / 触摸屏滑动**：首屏向下滚动或滑屏可平滑切换至「导航页」；在导航页顶部向上滚动或滑屏可返回「起始页」。
* **顶部 / 右侧快捷按钮**：点击导航页顶部 Header 栏或右侧「向上滚动返回」胶囊按钮，可随时平滑切回首屏。
* **键盘快捷键切换**：
  - 非输入状态下按 `PageDown` 或 `↓` 快速前往导航页。
  - 在导航页顶部按 `PageUp`、`Home` 或 `↑` 快速返回首屏。

### 2. 搜索与搜索引擎操作
* **搜索引擎切换**：点击搜索框左侧引擎图标（支持 Bing、Google、DuckDuckGo、百度），在下拉菜单中快速切换。
* **盲打自动聚焦**：在起始页非输入状态下，直接按下键盘上的任意字母/数字键，搜索框将自动获得焦点并输入。
* **实时联想面板交互**：
  - 输入关键词后自动拉取下拉建议词。
  - 按 `↑` / `↓` 方向键可在联想建议词间上下循环挑选（按上/下超出范围时自动恢复原始输入内容）。
  - 按 `Enter` 回车直接在当前页搜索。
  - 按 `Alt + Enter` (Windows) 或 `Option + Enter` (Mac) 可在**新标签页**中打开搜索结果。
  - 按 `Esc` 键快速收起联想下拉框或取消搜索框焦点。

### 3. 壁纸与外观偏好设置
* **一键轮播壁纸**：在非输入状态下按下快捷键 `Ctrl + B` (Windows) 或 `Cmd + B` (Mac)，可在线轮播内置的高清风光壁纸。
* **自定义壁纸**：
  - 点击右下角齿轮设置按钮 ⚙️ ➔ 切换至「外观壁纸」Tab。
  - 支持 **上传本地图片**（自动转存至浏览器本地存储）。
  - 支持 **输入网络图片 URL 地址**。
  - 支持 **选择预设高清壁纸库**（精选 8 款系统经典壁纸）。
  - 支持 **恢复默认壁纸**。

### 4. 快捷书签管理与拖拽排序
* **编辑管理弹窗**：点击右下角常驻的齿轮设置按钮 ⚙️（Hover 时齿轮平滑旋转 90 度）打开「设置与偏好」面板。
* **拖拽排序 (Drag & Drop)**：在「快捷书签」Tab 中，按住书签条目左侧的 `⋮⋮` 拖拽手柄，即可自由上下拖动调整书签在首屏的排列顺序。
* **手动添加 / 从导航页挑选**：
  - 点击「+ 手动输入」可新增自定义网站名称与 URL（URL 可简写为 `github.com`，系统会自动补充 `https://` 并抓取图标）。
  - 点击「🗂️ 从导航页选择」可打开可视化挑选弹窗，一键将导航页大全中的精选网站添加至首屏快捷书签。

### 5. 数据备份、恢复与重置
* **导出 JSON 备份**：在设置面板 ➔「数据与备份」Tab 中点击「📤 导出 JSON 备份文件」，可将当前所有快捷书签一键导出为 `.json` 备份文件。
* **导入 JSON 备份**：支持点击导入或直接将 `.json` 备份文件**拖入拖拽区 (Dropzone)**，系统将自动解析恢复书签。
* **一键重置系统**：在「危险区域 (Danger Zone)」中点击「⚠️ 重置所有系统设置」，可恢复为网站初始默认状态并清除本地缓存。

---

## 🛠️ 开发者与 Agent 工作流指南

### 1. 本地开发与生产部署 (Dev vs Prod)

#### 本地开发模式 (Development)
- 根目录 `index.html` 内置 **Tailwind v4 Browser CDN** 运行时脚本。
- **无需任何编译命令**，双击 `index.html` 或运行 `npm run dev` 即可预览。AI 或开发者添加任何新 Tailwind 类名立即可见。

#### 生产环境打包上线 (Production)
在需要部署到生产服务器或 GitHub Pages / Cloudflare Pages 时，运行打包命令：
```bash
npm run build
```
构建过程会自动执行：
1. **自动数据双向同步**：解析 `bookmarks.json` 最新数据，自动同步注入更新源码 `index.html` 与 `dist/index.html` 的 `DEFAULT_BOOKMARKS` 与 `DEFAULT_CATEGORIES` 数组（解决本地 `file://` 协议双击打开时因 CORS 拦截导致的降级书签不一致问题）。
2. **Tailwind 静态编译**：调用 Tailwind CLI 扫描 `index.html` 生成精简 CSS。
3. **HTML 脚本处理与 CSS 全量内嵌**：自动处理 `dist/index.html`，移除 v4 Browser CDN 脚本并将编译好的 CSS 全量内嵌为 `<style>` 标签（消除 `style.css` 渲染阻塞与网络 RTT 请求）。
4. **资源复制**：将 `sw.js` 与 `manifest.json` 复制至 `dist/` 目录（实现极简打包部署与零 404 网络请求）。

**上线发布**：只需将生成的 **`dist/` 文件夹下的全部内容** 上传部署至 GitHub Pages、Cloudflare Pages、Vercel、Nginx 或 NAS 即可。

### 2. 书签单点维护与 `desc` 撰写规范
1. **修改/添加书签**：**只需要修改 `bookmarks.json` 一个文件即可**。
   * **`desc` 简介副标题编写规范**（参见 [index.html#L1203](file:///Users/leosdcn/Projects/Code/startpage/index.html#L1203)）：
     - **字数限制**：推荐严格控制在 **6 ~ 10 个中文字符**（或 12 ~ 20 个英文字符）以内。
     - **布局与截断**：展示在导航卡片标题下方，窄屏或超长字符会自动触发单行截断（`truncate`）。
     - **内容准则**：精准概括网站核心定位，避免冗余修饰词（如 `全球领先AI对话模型`、`开源卡片式IP检测`）。
2. **执行自动同步**：修改完成后，运行 `npm run build` 自动同步注入源码与 `dist/` 产物。
3. **修改搜索引擎**：可在 `index.html` 中的 `engines` 引擎配置对象中新增或定制新的搜索引擎（百度、Google、Bing 等）。

### 3. 静态检查、Git 规范与测试指南 (Agent / Dev Guidelines)
- ⚡ **静态代码检查 (`npm run lint`)**：耗时仅 0.03 秒。自动完成 `index.html` 内联 JS、`build.js`/`sw.js` 语法预检及 `bookmarks.json`/`manifest.json`/`package.json` 的 JSON 合法性校验。修改代码后运行此命令做轻量校验。
- 🚀 **生产构建打包 (`npm run build`)**：耗时仅约 0.05 秒（Tailwind v4 Rust 引擎）。编译 Tailwind CSS 并同步书签数据，无需等待任何测试。
- 🌐 **联网信息检索 (Web Search Recommendation)**：在处理复杂的 Web 安全规范（如 CSP / Security Policy 最新细节）、浏览器新特性兼容性或特定技术方案选型时，**鼓励并推荐 Agent / 开发者在必要时主动进行联网搜索**，实时查询最新官方文档与行业最佳实践，确保调优与修补方案的严谨性与前瞻性。
- 🛑 **Git 提交约束 (Git Rule)**：**未收到用户明确指令前，Agent 严禁自动执行 `git add` / `git commit`**；所有改动与编译仅在本地工作区生效，静待用户预览确认并主动指令后再执行提交。
- ⚠️ **全量端到端测试 (`npm test`)**：会启动无头 Chrome 运行 7 个 CDP 端到端测试文件。**Agent 在日常修复小 Bug 或调整功能时严禁自动运行 `npm test`**，避免浪费时间；仅在用户明确发出指令要求“全量测试”时才执行。

---

## 🏗️ 代码结构与全栈架构设计

### 1. 项目目录结构与文件职责

| 文件 / 目录名 | 属性 | 文件作用描述 | 必选性 |
| :--- | :--- | :--- | :--- |
| **`index.html`** | **源码主入口** | 开发模式页面主入口。内置 Tailwind v4 Browser CDN，AI/开发者修改代码立即可见，零编译开销。 | **必须** |
| **`bookmarks.json`** | **唯一数据源** | 唯一数据维护源。修改书签只需编辑此文件，运行 `npm run build` 会自动将书签同步注入 HTML。 | **推荐** |
| **`sw.js`** | 缓存脚本 | Service Worker 独立脚本。专门用于在 HTTPS/localhost 环境下本地缓存 Favicon 网站图标，提升加载速度。 | 推荐（缺失时不影响主流程运行） |
| **`build.js`** | 打包脚本 | 生产构建 Node 脚本。运行 `npm run build` 自动同步书签数据、编译全量内嵌 CSS 并输出至 `dist/`。 | 工具脚本 |
| **`manifest.json`** | Web App 应用配置 | PWA 应用清单文件。配置应用名称、图标、启动 URL、主题颜色，支持添加至手机主屏幕与独立 Web App 运行。 | PWA 必需 |
| **`icon.svg`** | 矢量图标 | 网站 Logo 与 PWA 图标源文件。采用 SVG 格式确保高清高分屏无损缩放。 | 图标资源 |
| **`lint.mjs`** | 检查脚本 | Node 零依赖静态检查脚本。用于校验根目录核心 JS/HTML 语法与 JSON 配置文件合法性。 | 工具脚本 |
| **`test/`** | **测试目录** | 端到端 UI 自动化测试目录。内含 7 个 CDP 浏览器自动化测试套件与 Web 调试服务器。 | 测试框架 |
| **`TEST-REPORT.md`** | 测试文档 | 项目自动化测试覆盖率分析与完整功能验证报告。 | 运维文档 |
| **`package.json`** | 项目配置 | Node 项目配置文件，提供 `npm run dev`、`npm run build`、`npm run lint` 与 `npm test` 命令。 | 配置文件 |
| **`dist/`** | **生产输出** | `npm run build` 自动生成的生产构建目录。包含剥离 v4 Browser CDN 并精简 CSS 后的上线资源。 | 生产部署产物 |
| `.gitignore` | 配置文档 | Git 版本控制忽略配置。 | 运维配置 |
| **`README.md`** | 说明文档 | 本文档，记录项目架构、文件职责、运行机制及部署指南。 | 运维文档 |

---

### 2. 核心运行与数据同步机制

```
[ 开发者维护 bookmarks.json ] ──(运行 npm run build)──> 自动注入更新 index.html 默认数组
                                                                     │
[ 用户访问网页 / 打开 index.html ] <──────────────────────────────────┘
         │
         └── 100% 内存同步加载: 读取 HTML 内置 DEFAULT_* 默认数组 (零 HTTP 额外请求，消除 404 隐患)
```

---

### 3. 项目全栈缓存与存储架构 (Cache & Storage Architecture)

本项目采用了多层级、高可用、离线优先的全栈缓存体系，覆盖 **Service Worker 离线网络拦截**、**浏览器持久化偏好存储**、**IndexedDB 高清大图存储**、**会话状态防闪烁缓存**、**内存级 DOM/UI 节点映射** 以及 **构建期静态数据回退** 6 大核心维度，确保网页秒级加载、零重复开销与 100% 离线可用。

#### ⚙️ 缓存分层架构概览

| 缓存层级 | 技术实现 | 作用目标与缓存对象 | 缓存策略 / 容量限制 | 失效与清理机制 |
| :--- | :--- | :--- | :--- | :--- |
| **Service Worker 离线网络层** | `sw.js` (Cache API + IDB) | `a.favicon.im` 图标、`.ico` 静态图标、`index.html` 等 | 图标: `Cache-First` (三池隔离: Favicon 800条 / 本地图片 200条)<br>核心: `Network-First` | `npm run build` 自动更新版本号 `app-core-v<timestamp>` 强制清除旧缓存，IDB 精准 LRU 淘汰 |
| **持久化偏好存储层** | `LocalStorage` | 默认引擎、遮罩透明度、模糊度、自定义书签、壁纸偏好 | key-value / 容量上限 ~5MB | 用户手动点击「重置系统设置」或浏览器清除 Cookie |
| **高清大图存储层** | `IndexedDB` (`GlassStartDB`) | 4K 高清自定义上传壁纸 (`wallpapers` 表) | 3840x2160 JPEG Base64 / 容量 50MB~数百MB | 彻底打破 LocalStorage 5MB 上限，随重置系统操作清空 |
| **会话状态防闪烁层** | `SessionStorage` + `<head>` 脚本 | 页面屏间位置 (`startpage_section`: `home` / `nav`) | 仅在当前会话生命周期内有效 | 渲染前 Head 内联脚本检测并同步添加 `.nr` 类，防止刷新首屏闪烁 |
| **运行时内存缓存层** | JS 全局变量 (`dom` / 侧边栏 Cache) | 40+ 常用 DOM 节点引用、导航分类与 Section 映射 | 内存映射，零 DOM 树二次查询开销 | 页面卸载或重新载入时自动释放与重新建立 |
| **静态回退与离线数据层** | HTML 内联 `DEFAULT_*` 数组 | `bookmarks.json` 最新镜像数据 | 内存直接加载 / 零 HTTP 请求开销 | `npm run build` 时通过 `build.js` 自动双向同步 `bookmarks.json` 数据 |

#### ⚡ 核心缓存与防闪烁机制详解

* **Service Worker 三池隔离与 IndexedDB LRU (`sw.js`)**：
  - `CORE_CACHE`：存放 HTML/CSS/JSON 等核心程序资源。
  - `FAVICON_CACHE`：`a.favicon.im` 外部图标专用池（配额上限 **800 条**）。
  - `IMG_CACHE`：站内本地图片及 `.ico` 资源池（配额上限 **200 条**）。
  - 核心优势：图标作为导航站核心功能享有独立高额配额，且不会被本地大图挤占。
  - IndexedDB 真时间戳 LRU 淘汰：在独立数据库 `sw-lru-db` 中维护真实访问时间戳，超限时精确淘汰旧图标。
* **IndexedDB 4K 高清壁纸存储**：
  - 针对用户上传的 4K 本地壁纸，系统在 Canvas 中统一优化转换为 3840x2160 @ 95% 高品质 JPEG DataURL。
  - 存入专用 IndexedDB 数据库 `GlassStartDB` 的 `wallpapers` 对象存储，成功避开 LocalStorage 5MB 上限。
* **`<head>` 内联防闪烁状态恢复**：
  - 在 HTML `<head>` 最顶部内联同步脚本：若检测到 `sessionStorage` 记录的 `startpage_section === 'nav'`，立即赋予 `<html>` `nr` 标志类，DOM 挂载前即可完成布局定位。
* **缓存管理与一键清理**：
  - **离线缓存一键刷新**：设置面板「数据与备份」中提供 `[清理离线缓存]` 按钮，直接调用 `caches.delete()` 清空 Service Worker 离线存储。
  - **系统全量重置**：设置面板「危险区域」提供 `[重置所有系统设置]` 按钮，一键清空 LocalStorage 及 IndexedDB 数据库。

---

### 4. HTTP 生产安全响应头最佳实践配置 (Security Headers Guide)

在部署至 Cloudflare Pages、Nginx、Caddy、Vercel 或 NAS Web 服务器时，推荐配置以下 HTTP 安全响应标头（符合 Web Security / Lighthouse 最高安全合规等级）：

```nginx
# 1. 强制 HTTPS 传输 (HSTS, Strict-Transport-Security)
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

# 2. 防点击劫持防护 (Clickjacking Protection / X-Frame-Options)
add_header X-Frame-Options "SAMEORIGIN" always;

# 3. 跨源隔离政策 (COOP - Cross-Origin-Opener-Policy)
add_header Cross-Origin-Opener-Policy "same-origin" always;

# 4. 内容安全策略 (Content-Security-Policy HTTP 标头)
add_header Content-Security-Policy "default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' https://suggestion.baidu.com https://api.bing.com https://suggestqueries.google.com; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; connect-src 'self' https:; worker-src 'self' blob:; frame-ancestors 'self';" always;
```

---

### 5. 框架与依赖版本清单 (Framework & Dependency Versions)

本项目框架依赖极简——**唯一的第三方框架是 Tailwind CSS**，其余全部为原生 HTML5 + Modern JS + 手写 CSS，零其他框架依赖。以下为所有带明确版本号的框架 / 组件清单：

| 名称 | 类型 | 版本号 | 位置 / 说明 |
| :--- | :--- | :--- | :--- |
| **Tailwind CSS** | CSS 框架（第三方） | `4.3.3` | `package.json` `devDependencies`；CSS 编译核心 |
| **@tailwindcss/cli** | Tailwind v4 构建 CLI | `4.3.3` | `package.json` `devDependencies`；由 `build.js` 调用完成生产 CSS 编译 |
| **@tailwindcss/browser** | Tailwind v4 浏览器运行时 | `@4`（对应 4.3.3） | `index.html` dev CDN 脚本，仅开发预览使用；生产构建自动内嵌编译 CSS 并剥离该脚本 |
| **Service Worker** | 项目内组件 | `v9` | `sw.js` 头部注释；三池隔离 + IndexedDB LRU 缓存架构 |
| **CORE_CACHE** | 缓存池版本 | `app-core-v<时间戳>` | `sw.js`；每次 `npm run build` 自动更新，强制客户端刷新旧缓存 |
| **FAVICON_CACHE / IMG_CACHE** | 缓存池版本 | `v1` | `sw.js`；图标 / 本地图片独立缓存池 |
| **Glass Start 站点版本** | 项目发布版本 | `v2.7.2` | `package.json` + `index.html` 页脚徽章 |

**无版本号的外部服务**（非框架，版本由服务商维护，升级无需本项目介入）：
- `a.favicon.im` — Favicon 图标 API
- 百度 / Bing / Google — 搜索联想建议 API
- `images.unsplash.com` — 内置壁纸图片 CDN
- `npx serve` — 开发静态服务器（取最新版，未锁定版本）

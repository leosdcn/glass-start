# Glass Start - 玻璃拟态个人起始页

基于 HTML5、Tailwind CSS 与 Modern JS 构建的高颜值、轻量级玻璃拟态（Glassmorphism）浏览器起始页。

---

## ✨ 核心亮点与安全性能特性

- 🪐 ** Liquid Glass 物理高光与玻璃拟态**：采用 Apple HIG 规范的 1px 物理折射高光、微拟物触感反馈与 iOS 18 物理按压微缩放。
- ⚡ **零开销双模式构建 (Dev vs Prod)**：开发模式使用 Tailwind Play CDN 随改随看；生产打包（`npm run build`）自动编译 21KB 纯 CSS 并剥离 JS 编译脚本，实现秒开与 100% 离线使用。
- 🛡️ **严格安全防护**：内置严格 Content Security Policy (CSP)、全面 XSS HTML 实体转义、`safeUrl` 协议白名单拦截（防 `javascript:` 注入）、JSONP 超时悬挂防爆防护。
- 🚀 **图标高性能缓存**：内置 Service Worker (v5)，精准拦截并缓存 Favicon 图标，采用标准 CORS 模式消除 Chrome 840MB 虚拟存储配额膨胀问题。

---

## 📖 完整用户操作指南手册

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

## 🛠️ 开发与生产部署流程 (Dev vs Prod)

### 1. 本地开发模式 (Development)
- 根目录 `index.html` 内置 **Tailwind Play CDN** 运行时脚本。
- **无需任何编译命令**，双击 `index.html` 或运行 `npm run dev` 即可预览。AI 或开发者添加任何新 Tailwind 类名立即可见。

### 2. 生产环境打包上线 (Production)
在需要部署到生产服务器或 GitHub Pages / Cloudflare Pages 时，运行打包命令：
```bash
npm run build
```
构建过程会自动执行：
1. **自动数据双向同步**：解析 `bookmarks.json` 最新数据，自动同步注入更新源码 `index.html` 与 `dist/index.html` 的 `DEFAULT_BOOKMARKS` 与 `DEFAULT_CATEGORIES` 数组（解决本地 `file://` 协议双击打开时因 CORS 拦截导致的降级书签不一致问题）。
2. **Tailwind 静态编译**：调用 Tailwind CLI 扫描 `index.html`，生成精简压缩版 `dist/style.css`。
3. **HTML 脚本处理**：自动处理 `dist/index.html`，将 Play CDN 脚本替换为 `<link rel="stylesheet" href="style.css">`。
4. **资源复制**：将 `bookmarks.json` 与 `sw.js` 复制至 `dist/` 目录。

**上线发布**：只需将生成的 **`dist/` 文件夹下的全部内容** 上传部署至 GitHub Pages、Cloudflare Pages、Vercel、Nginx 或 NAS 即可。

---

## 📁 项目目录结构与文件作用

| 文件 / 目录名 | 属性 | 文件作用描述 | 必选性 |
| :--- | :--- | :--- | :--- |
| **`index.html`** | **源码主入口** | 开发模式页面主入口。内置 Tailwind Play CDN，AI/开发者修改代码立即可见，零编译开销。 | **必须** |
| **`bookmarks.json`** | **唯一数据源** | 唯一数据维护源。修改书签只需编辑此文件，运行 `npm run build` 会自动将书签同步注入 HTML。 | **推荐** |
| **`sw.js`** | 缓存脚本 | Service Worker 独立脚本。专门用于在 HTTPS/localhost 环境下本地缓存 Favicon 网站图标，提升加载速度。 | 推荐（缺失时不影响主流程运行） |
| **`build.js`** | 打包脚本 | 生产构建 Node 脚本。运行 `npm run build` 自动同步书签数据、编译静态 `style.css` 并输出至 `dist/`。 | 工具脚本 |
| **`manifest.json`** | Web App 应用配置 | PWA 应用清单文件。配置应用名称、图标、启动 URL、主题颜色，支持添加至手机主屏幕与独立 Web App 运行。 | PWA 必需 |
| **`icon.svg`** | 矢量图标 | 网站 Logo 与 PWA 图标源文件。采用 SVG 格式确保高清高分屏无损缩放。 | 图标资源 |
| **`_headers`** | HTTP 头部配置 | Cloudflare Pages / Vercel 静态托管的安全响应头配置 (HSTS, X-Content-Type-Options, Referrer-Policy 等)。 | 部署配置 |
| **`package.json`** | 项目配置 | Node 项目配置文件，提供 `npm run dev` 与 `npm run build` 脚本命令。 | 配置文件 |
| **`dist/`** | **生产输出** | `npm run build` 自动生成的生产构建目录。包含剥离 Play CDN 并精简 CSS 后的上线资源。 | 生产部署产物 |
| `.gitignore` | 配置文档 | Git 版本控制忽略配置。 | 运维配置 |
| **`README.md`** | 说明文档 | 本文档，记录项目架构、文件职责、运行机制及部署指南。 | 运维文档 |

---

## ⚙️ 核心运行与数据同步机制

```
[ 开发者维护 bookmarks.json ] ──(运行 npm run build)──> 自动注入更新 index.html 默认数组
                                                                    │
[ 用户访问网页 / 打开 index.html ]                                    │
         │                                                         │
         ├── 1. HTTP/HTTPS 环境: 异步 fetch("bookmarks.json") ────────┘
         │      ├── 成功: 加载最新 JSON 配置文件数据
         │      └── 失败: 自动平滑降级使用 HTML 内置 DEFAULT_* 默认数组
         │
         └── 2. file:// 本地双击环境: 绕过 CORS 拦截 ─────────────────┘
                └── 直接秒级加载 HTML 内置的 DEFAULT_* 完美镜像数据
```

---

## 💾 项目全栈缓存与存储架构 (Cache & Storage Architecture)

本项目采用了多层级、高可用、离线优先的全栈缓存体系，覆盖 **Service Worker 离线网络拦截**、**浏览器持久化偏好存储**、**IndexedDB 高清大图存储**、**会话状态防闪烁缓存**、**内存级 DOM/UI 节点映射** 以及 **构建期静态数据回退** 6 大核心维度，确保网页秒级加载、零重复开销与 100% 离线可用。

### 1. ⚙️ 缓存分层架构概览

| 缓存层级 | 技术实现 | 作用目标与缓存对象 | 缓存策略 / 容量限制 | 失效与清理机制 |
| :--- | :--- | :--- | :--- | :--- |
| **Service Worker 离线网络层** | `sw.js` (Cache API) | `favicon.im` 图标、`.ico` 静态图标、`style.css` | 图标: `Cache-First` (上限 120 条)<br>CSS: `Stale-While-Revalidate` | `npm run build` 自动更新版本号 `app-cache-v<timestamp>` 强制清除旧缓存 |
| **持久化偏好存储层** | `LocalStorage` | 默认引擎、遮罩透明度、模糊度、自定义书签、壁纸偏好 | key-value / 容量上限 ~5MB | 用户手动点击「重置系统设置」或浏览器清除 Cookie |
| **高清大图存储层** | `IndexedDB` (`GlassStartDB`) | 4K 高清自定义上传壁纸 (`wallpapers` 表) | 3840x2160 JPEG Base64 / 容量 50MB~数百MB | 彻底打破 LocalStorage 5MB 上限，随重置系统操作清空 |
| **会话状态防闪烁层** | `SessionStorage` + `<head>` 脚本 | 页面屏间位置 (`startpage_section`: `home` / `nav`) | 仅在当前会话生命周期内有效 | 渲染前 Head 内联脚本检测并同步添加 `.nr` 类，防止刷新首屏闪烁 |
| **运行时内存缓存层** | JS 全局变量 (`dom` / 侧边栏 Cache) | 40+ 常用 DOM 节点引用、导航分类与 Section 映射 | 内存映射，零 DOM 树二次查询开销 | 页面卸载或重新载入时自动释放与重新建立 |
| **静态回退与离线数据层** | HTML 内联 `DEFAULT_*` 数组 | `bookmarks.json` 最新镜像数据 | 内存直接加载 / 零 HTTP 请求开销 | `npm run build` 时通过 `build.js` 自动双向同步 `bookmarks.json` 数据 |

---

### 2. ⚡ 核心缓存机制详解

#### 🌐 Service Worker 离线与图标拦截 (`sw.js`)
- **图标抓取防重复**: 拦截对 `https://favicon.im/*` 及任意 `.ico` 的 GET 请求。首次抓取后写入 Cache API，再次访问直接命中本地缓存，响应时间提升至 0~2ms。
- **配额防膨胀 (LRU/FIFO 限额)**: 自动维持 Cache 条目上限在 **120 条以内**，超限自动剔除最早的缓存，解决 Chrome 虚拟磁盘配额过度膨胀问题。
- **CSS 资源平滑更新**: 对 `style.css` 采用 **Stale-While-Revalidate** 策略，实现首屏样式秒开，并在后台静默拉取最新 CSS 完成更新。

#### 🖼️ IndexedDB 4K 高清壁纸存储
- 针对用户上传的 4K 本地壁纸，系统会在 Canvas 中统一优化转换为 3840x2160 @ 95% 高品质 JPEG DataURL。
- 存入专用 IndexedDB 数据库 `GlassStartDB` 的 `wallpapers` 对象存储中，成功避开 LocalStorage 的 5MB 磁盘限制与 Safari 无痕模式崩塌隐患。

#### 🛡️ `<head>` 内联防闪烁状态恢复
- 避免传统单页应用在刷新页面时先展示「起始页」再跳动切换回「导航页」的体验断层。
- 在 HTML `<head>` 最顶部内联同步脚本：若检测到 `sessionStorage` 记录的 `startpage_section === 'nav'`，立即赋予 `<html>` `nr` 标志类，DOM 挂载前即可完成布局定位。

#### 🧹 缓存管理与一键清理
- **离线缓存一键刷新**：在设置面板的「数据与备份」中提供 `[清理离线缓存]` 按钮，直接调用 `caches.delete()` 清空 Service Worker 离线存储。
- **系统全量重置**：在「危险区域」提供 `[重置所有系统设置]` 按钮，一键清空 LocalStorage 及 IndexedDB 数据库，恢复纯净默认状态。

---

## 🛠️ 单点维护书签指南

1. **修改/添加书签**：**只需要修改 `bookmarks.json` 一个文件即可**（支持 `"desc"` 简短介绍副标题，推荐控制在 6 ~ 10 个字）。
2. **执行自动同步**：修改完成后，在终端运行打包命令：
   ```bash
   npm run build
   ```
   `build.js` 脚本会自动将 `bookmarks.json` 中的最新书签同步更新至源码 `index.html` 及 `dist/index.html` 中。
3. **修改搜索引擎**：可在 `index.html` 中的 `engines` 引擎配置对象中新增或定制新的搜索引擎（百度、Google、Bing 等）。


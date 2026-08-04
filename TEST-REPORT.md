# Glass Start 测试报告

## 📌 最新：v2.7.7 全量性能深度重构与 2.5K AVIF 升级 (2026-08-04)

版本号提升至 **v2.7.7**，完成以下核心性能与架构优化：

| # | 优化领域 | 改动项说明 | 性能收益 |
|---|---|---|---|
| 1 | **壁纸 AVIF 格式升级** | 从 Unsplash 官方高清母带源导出 2.5K (2560x1440) 10-bit AVIF 格式壁纸 | 首屏壁纸体积从 526 KB 骤降至 192 KB (⬇️ 63.4%) |
| 2 | **Favicon 视口与切屏延迟加载** | 增加隐藏屏防护，仅在用户切屏进入导航页时才激活 `IntersectionObserver` | 首屏 Favicon 请求从 99 个降低至 12 个 (⬇️ 87.9%) |
| 3 | **SW 预缓存与后台拉取精简** | `CORE_ASSETS` 精简为仅保留默认壁纸 `bg1.avif`，移除 35 个分类图标静默 `fetch` | 消除了 SW 安装阶段对 7 张高清壁纸的后台强拉 |
| 4 | **Cloudflare `_headers` 边缘强缓存** | 新增 `_headers` 配置文件，为 `/wallpapers/*` 强制配置 `max-age=31536000, immutable` | 壁纸二次访问 0ms 本地磁盘秒开，传输耗时由 9s 降至 788ms |
| 5 | **构建期 HTML JSON 数据单行压缩** | `build.js` 生产打包时无损紧凑压缩内嵌的 `DEFAULT_BOOKMARKS` 与 `DEFAULT_CATEGORIES` | `dist/index.html` 体积进一步减小 15 KB |

**验证**：`lint` 全过 ✅ · 生产构建成功 (`dist/index.html` 274.58 KB) ✅ · 全量 10 个测试文件 / 61 项断言 100% Pass ✅。

---

## 📌 历史存档：v2.7.2 核心 BUG 修复验证 (2026-08-04)

**修复 6 个高置信度功能缺陷**（详见 PR #1），版本号由 v2.7.1 提升至 v2.7.2：

| # | 缺陷 | 修复 |
|---|------|------|
| 1 | 重置设置后 IndexedDB 自定义壁纸未清除，刷新后复活 | 重置时同步 `removeWallpaperDB()` + `state.customWallpaper = null` |
| 2 | 设置弹窗初始壁纸只读 localStorage（从不写入），取消回滚丢失自定义壁纸 | 初始值优先取 `state.customWallpaper` / IndexedDB |
| 3 | Escape 还原搜索原文的逻辑位于 return 之后，为死代码 | 还原逻辑移入 Overlay 栈顶分支 |
| 4 | 侧边栏分类高亮混用坐标系，滚动切换偏差约 51~57px | 直接使用与 `scrollTop` 同原点的 `s.offsetTop` |
| 5 | SW 预缓存含不存在的 `icon.svg`/`manifest.json`，`addAll` 整批失败 | 清单精简为真实资源 + 逐项 `cache.add` 容错 |
| 6 | `applyWallpaper` 动画分支无守卫复制底图，快速切换闪现陈旧壁纸 | 增加可见性守卫 `opacity > 0.4` |

**验证**：`lint` 全过 ✅ · 生产构建成功 ✅ · 新增回归测试 `escape.test.mjs`（BUG 3，CDP）/ `sw-precache.test.mjs`（BUG 5，静态 8/8 通过）✅。CDP 类测试需在装有 Chrome 的 macOS 环境实跑确认。

以下为历史报告存档（v2.4.x / v2.7.1 记录，保留备查）：

---

## 📌 v2.7.1 Tailwind v4 迁移验证 (2026-08-03)

测试环境：macOS (darwin) · Node v26.5.0 · Tailwind CLI v4 (4.3.3)
测试模式：源码开发服务 (Tailwind v4 Browser CDN) 与生产构建 (`dist/` CSS 全量内嵌)

**PASS，可上线。** 7 个端到端测试文件 / 57 项断言 100% 全部通过。构建产物 `dist/index.html` (279.16 KB) 已内嵌 35.27 KB Tailwind v4 编译 CSS，零外部 `style.css` HTTP RTT。

| 验证项 | 结果 |
|---|---|
| 构建与产物校验 | ✅ `dist/index.html` 内嵌 `<style>`，`dist/style.css` 已清理 |
| 生产 CSP 安全收紧 | ✅ `cdn.jsdelivr.net` / `cdn.tailwindcss.com` 域名安全剥离，`unsafe-inline` 样式策略符合规范 |
| 测试套件 | ✅ 7 个测试文件全过（arrow 6 / cleanup 6 / derive 6 / framebusting 2 / overlay 12 / transform 19 / wheel 6） |
| browserslist 旧数据警告 | ✅ 随 v4 升级消除（v4 改用 Lightning CSS，不再内置 caniuse-lite 快照） |
| 视觉回归 | ✅ `shadow-md/lg/2xl/inner` 与 v3 逐项一致；`shadow-xs` / `backdrop-blur-xs` 由 no-op 转为生效（符合原设计意图）；`3xl:` 断点在 v3/v4 均无效，无变化 |
| v4 preflight 差异修复 | ✅ 补 `button, [role="button"] { cursor: pointer }`（v4 不再默认按钮 pointer 光标） |
| dev CDN | ✅ Play CDN → `@tailwindcss/browser@4`；生产构建自动剥离脚本并内嵌编译 CSS |

以下为历史报告存档（v2.4.x 记录，保留备查）：

---

# Glass Start v2.4.4 上线前测试报告 (CSS 全量内嵌专项)

测试日期：2026-08-01
测试环境：macOS (darwin) · Node v26.5.0 · Tailwind CLI v3
测试模式：源码开发服务 (Play CDN) 与生产构建 (`dist/` CSS 全量内嵌)

## 结论

**PASS，可上线。** 共 30 项自动化测试断言 100% 全部通过 (30/30 ✅)。生产构建实现 CSS 全量内嵌至 `dist/index.html`，删除了独立的 `dist/style.css` 依赖，完全消除了 HTTP 渲染阻塞开销。

| 测试分类 | 评估目标 | 测试结果 |
|---|---|---|
| 构建与产物校验 (7项) | `dist/index.html` 存在且包含内嵌 `<style>`，`dist/style.css` 完全清理 | 7/7 ✅ |
| 生产 CSP 安全收紧 (4项) | `cdn.tailwindcss.com` 域名安全剥离，`unsafe-inline` 样式策略符合规范 | 4/4 ✅ |
| Service Worker 预缓存 (5项) | 剔除 `./style.css` 预缓存与网络判决逻辑，版本号更新 | 5/5 ✅ |
| 默认数据双向同步 (2项) | `bookmarks.json` 最新镜像准确注入 HTML 回退数组 | 2/2 ✅ |
| PWA Schema & 开发解耦 (12项) | PWA Manifest 结构完好，源码保留 Play CDN 不影响 DX | 12/12 ✅ |

## 一、静态与构建审查
- `dist/index.html` (247.93 KB)：已内嵌 20.48 KB 精简 Tailwind CSS 样式表，零外部 `style.css` HTTP RTT。
- `sw.js`：已成功清理对 `./style.css` 的引用，离线匹配机制完好。

- `_headers`：HSTS (`max-age=31536000; includeSubDomains; preload`)、`X-Content-Type-Options: nosniff`、`Referrer-Policy`、`X-Frame-Options` 齐全。
- `manifest.json`：`start_url: "./"`、`display: standalone`、`icon.svg` 存在且可访问。
- `sw.js`（v9）：预缓存 + 运行时缓存 + 图标 LRU 缓存；`CORE_CACHE` 缓存版本由 build.js 自动替换为构建时间戳。
- `bookmarks.json`：8 个顶栏书签 + 8 个分类；经 build.js 校验与 `index.html` 内置 `DEFAULT_BOOKMARKS` / `DEFAULT_CATEGORIES` 100% 同步。
- `npm run build` 幂等，产物 7 个文件，`dist/index.html` 225.70 KB。

## 二、生产构建 CSP 收紧（v2.3.3 新增）

- 生产构建移除 Tailwind Play CDN 脚本后，原 CSP `script-src` 中残留 `https://cdn.tailwindcss.com` 白名单域名已剥离（`grep -c` 为 0）。
- 处理时保留指令间 `;` 分隔符，避免 `style-src` 并入 `script-src` 导致策略损坏。
- 最终生产 CSP：

```html
default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' https://suggestion.baidu.com https://api.bing.com https://suggestqueries.google.com https://ac.duckduckgo.com ; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; connect-src 'self' https:;
```

## 三、发现并修复的问题

| # | 问题 | 根因 | 修复 |
|---|---|---|---|
| 1 | 导航页（第二屏）上齿轮按钮 `#editBookmarksBtn` 点击无响应 | 按钮位于 `#startSection`（`relative z-10`）内，`z-50` 被困在该 section 的层叠上下文中；`#navSection`（同为 `z-10`、DOM 靠后）整体覆盖了按钮的层叠上下文 | 将按钮移出两个 section，置于 `#editModal` 之前 |
| 2 | 生产 CSP 剥离逻辑曾致策略损坏 | 过滤时连同尾部 `;` 一并删除，`style-src` 被并入 `script-src`（浏览器报 `directive 'script-src' contains 'style-src'`） | 改为按前缀剥离域名并保留 `;` 分隔符（见上） |

**设计确认（v2.3.3，v2.4.7 优化）**：齿轮按钮为作者特意设计，仅搜索页显示、导航页隐藏。实现为 `#editBookmarksBtn.hidden-on-nav`（淡出 + `pointer-events: none`），由 `updateGearVisibility()` 依据 `state.currentSection` 统一切换。**过渡动画**：淡出 `opacity` 0.25s（`.hidden-on-nav` 内单独覆盖，滚动到达前约 270ms 即完全消失）、淡入 0.45s ease（基础规则）；**切换时机**：切向导航页时随滚动开始即平滑淡出；切回搜索页时等待切屏动画（520ms）完成后再淡入。sessionStorage 恢复分支（刷新后停留在导航页）则立即隐藏。

## 四、冒烟测试覆盖（38 项）

- 页面渲染：标题、时钟、顶栏 8 个书签
- 搜索：输入触发联想（项数与网络相关）、引擎下拉含 4 个引擎且切换持久化到 UI
- 导航：滚动进入第二屏、分类区块、侧栏分类、链接总数 = bookmarks.json 总数
- 齿轮按钮：导航页隐藏、返回搜索页恢复显示
- 设置弹窗：3 个 Tab 切换、书签编辑列表 8 行
- 书签 E2E：新增空白行 → 填名填 URL → 保存 → 顶栏 9 个 → 删除 → 恢复 8 个 → 下移排序
- 外观：遮罩透明度滑杆联动 overlay 实际透明度
- 数据：书签统计、PWA 状态（就绪）、刷新后持久化
- 可靠性：SW 注册成功、`manifest.json` 有效、`icon.svg` 可访问、无意外失败请求、无 HTTP>=400、无意外 console 错误、无页面 JS 错误

## 五、高级测试覆盖（23 项）

- **移动端** 375×812：无横向溢出、顶栏/导航/侧栏正常、齿轮导航页隐藏/搜索页可打开
- **快捷键**：字母键聚焦搜索框、PageDown/Home 切屏、Cmd+B 循环壁纸
- **离线**：SW 就绪后断网 reload，页面从 SW 缓存正常加载
- **书签选择器 + JSON 导入**：选择器打开、候选列表、导入填充编辑行、localStorage 持久化、顶栏刷新
- **拖拽排序**：HTML5 拖拽改变顺序
- **清缓存 & 重置**：缓存清空为 0、重置清除用户书签并恢复默认 8 个

## 六、已知说明（非阻塞）

- 联想 API / 外链 favicon / Unsplash 壁纸依赖网络，离线或受限网络下失败属预期行为。
- `index.html` 第 1895 行 DOM id 列表含 `importJsonBtn`，但实际 HTML 仅用 `#jsonDropzone` + 隐藏 `#importJsonInput`（dead reference，不影响功能）。
- `bookmarks.json` 顶栏条目无 `id` 字段；代码不依赖书签 `id`（仅使用 DOM 元素 `panel.id`），无影响。

## 七、第三方请求审计与图标服务调研（v2.4.6 专项）

### 1. 外联面审计（B 项结论）

运行时实际外联的第三方域**仅 4 个，全部有明确功能用途**，无任何 analytics/telemetry/pixel/sendBeacon/XHR/WebSocket：

| 域 | 用途 | 触发时机 | 泄露数据 | 评估 |
|---|---|---|---|---|
| `a.favicon.im` | 全部书签图标 | 页面加载即请求 | 完整书签域名集合 | 唯一需知悉的隐私面；SW 已 Cache-First + LRU 缓存（首次后不再外联） |
| `images.unsplash.com` | 默认壁纸 + 8 张预设 | 加载/选壁纸 | 仅 IP | 低 |
| 4 个联想 API（baidu/bing/google/duckduckgo） | 搜索联想 JSONP | 仅用户主动输入 | 键入的搜索词（按所选引擎） | 设计内 |
| `cdn.tailwindcss.com` | Tailwind Play CDN | 仅 dev | — | 生产构建已内嵌移除 |

CSP（`img-src https:` + `connect-src 'self' https:` + script-src 精确白名单）与实际请求面完全一致，无绕过。`goldcoast.dpdns.org` 仅为 `og:url` 元数据，不发请求。

### 2. 图标服务横向实测（四轮 130+ 域名，本机真实网络）

| 服务 | 速度 | 可靠性 | 载荷 | 判定 |
|---|---|---|---|---|
| **a.favicon.im（现役）** | 约六成域名胜 | 0 失败 | 最轻，多站给 SVG/ICO | **维持主服务** |
| icon.horse | 略慢 | 0 失败 | 偏重，偶发超大图（deepl 101KB） | 可作备选 |
| geticon.dev | 慢（89% 域名败） | 3 个返回 HTML（jd.com / chat.deepseek.com / publishmarkdown.com）+ 13 个 301B 通用占位图（npmjs、linux.do、midjourney、pixiv 等） | 部分 SVG 原图 | 排除 |
| favicon.so | 国内站首访慢一倍（实测 5.5s vs 2.7s） | 正常 | 33KB PNG | 一般 |
| Google s2 | （海外）理论最优 | 全网覆盖最佳 | 1-3KB | 本网络全 301 被墙，排除 |

**结论：图标方案保持 `a.favicon.im` 不动，零代码改动。** 该服务速度、载荷、可靠性综合最优，且为首访最轻（多站 SVG/ICO，如 github 959B SVG vs icon.horse 33KB PNG）。其余候选均因可靠性缺陷（geticon.dev）、载荷偏重（icon.horse/favicon.so）或网络不可达（Google s2）不构成替换理由。图标失败已有文字徽章降级兜底。

### 3. 性能量化（Lighthouse 13.4.1 · desktop 预设 · 本地 serve dist/）

**Performance 98 · Accessibility 100 · Best Practices 100 · SEO 100**

| 指标 | 值 |
|---|---|
| FCP | 0.3s |
| LCP | 0.4s |
| CLS | 0 |
| TBT | 0ms |
| Speed Index | 1.5s |
| TTI | 0.4s |

总载荷 884 KiB（首访外联壁纸 + 书签图标，HTML 本体约 250KB），首次后由 SW 缓存。**无需优化，性能健康。**

## 八、两屏切换滚动卡顿分析（v2.4.7 专项）

### 1. 当前实现

两屏通过**窗口滚动**切换：起始页（`#startSection`，min-h-screen）在上、导航页（`#navSection`，h-screen）在下，`switchToNav/switchToStart` 用 `animateScrollTo`（index.html:4102）在 520ms 内以 easeInOutCubic 曲线把 `window.scrollY` 从 0 滚到 `nav.offsetTop`（本机约 801px），每帧 rAF 执行一次 `window.scrollTo`。**实现无逻辑错误，卡顿属渲染时机问题，可根治。**

### 2. 卡顿来源一（主因）：导航内容"首次进入视口才渲染"

`.category-block` 启用了 `content-visibility: auto`（index.html:152），含义是屏幕外的分类块跳过布局与绘制，直到进入视口才补做。后果：

- 向下滚动的 520ms 里，8 个分类块（共 93 个书签）在**滑动途中**被逐个在主线程上执行 layout + paint（网格、边框、阴影、图标），同步开销压在动画的某几帧上 → 掉帧 1~3 帧。
- 第二次切换时块已渲染 → 丝滑，与"有时整体流畅、偶尔掉帧"的体感吻合。
- 浏览器在内存压力下逐出已栅格 tile 缓存时，再滚入会重新补课。

### 3. 卡顿来源二（次因）：导航区移动毛玻璃逐帧重采样

导航页顶栏/侧栏使用 `.glass`（index.html:127，`backdrop-filter: blur(24px)`），随页面滚动移动 → 毛玻璃逐帧重采样背板 → 每帧 GPU 重算模糊。桌面 60Hz 通常廉价，仅在低电量 / GPU 忙 / 高分屏时明显。齿轮按钮（blur 40px）切换后约 250ms 半透明淡出期间也会短暂重采样（量小）。壁纸与 `#bgOverlay` 为 `position: fixed`、背板静止，可被缓存，不是问题。

### 4. 掉帧触发条件

| 触发条件 | 表现 |
|---|---|
| 首次切换 / tile 缓存被逐出 | 明显卡顿（来源一） |
| 已渲染、缓存命中 | 流畅 |
| 低电量 / GPU 忙 / 高分辨率 | 偶发掉帧（来源二） |
| 稳定负载、60Hz 桌面 | 整体流畅 |

### 5. 根治方向（评估结论）

**正确方案 = CSS transform 硬件合成层架构**，分层三步，缺一不可：

| 步骤 | 改动 | 消除 |
|---|---|---|
| ① 必做 | `.category-block { content-visibility: auto }` → `visible`（或删除），导航加载期一次性渲染 | 来源一（首绘补课，硬性消除，不依赖 tile 缓存） |
| ② 可选 | 导航区玻璃元素改纯 rgba 底色，去除移动 `backdrop-filter` | 来源二（逐帧模糊重采样，视觉取舍） |
| ③ 终极 | 窗口停止滚动，导航改为 `position: fixed` 覆盖层 + `transform: translateY(100%→0)` 合成器过渡（`transition: transform 520ms`），动画全程跑在 GPU 合成线程，主线程每帧零工作 | 全部逐帧开销；顺带可删 `animateScrollTo`（4102-4148）、load 校准（4276-4280）、resize/全屏追位（4367-4384）整类错位代码 |

**注意**：③ 必须叠加 ①，否则 `content-visibility` 按 transform 后几何判断视口，仍会在滑动途中补课。Safari 存在"fixed 层 + transform + 内部 backdrop-filter"组合的模糊采样不全风险，过渡期需临时挂 `backdrop-filter: none`，结束后移除。

### 6. 落地实施（v2.4.7 已改造）

采用方法 ③ + ①（CSS transform 硬件合成层架构），具体落地：

- **布局重构**：`#startSection` / `#navSection` 均改 `position: absolute` 全屏层（z-index 10 / 20），`#navSection` 初始 `translateY(100dvh)`，`.screen-pushed-in` 滑至 `translateY(0)`；起始页 `.screen-pushed-up` 反向移出。窗口永远停在 `scrollY=0`，`body` 禁用页面滚动。
- **过渡**：`transition: transform 0.52s cubic-bezier(0.65, 0, 0.35, 1)` 合成器动画，替代原 `animateScrollTo`（已删除）及 load 校准 / resize / fullscreen 追位代码（已删除）。
- **首绘补课根治**：删除 `.category-block` 的 `content-visibility: auto` 与 `contain-intrinsic-block-size`，导航加载期一次性渲染。
- **`.nr` 直达模式**：刷新直达导航页改为两屏预置 transform（`!important` + 关过渡），消除抖动。
- **键盘死键修复**：搜索框聚焦但联想菜单未激活时放行屏间切屏（ArrowDown/PageDown 不再被 `isInputActive` 守卫拦死）。
- **取消自动聚焦**：`switchToStart` 完成后不再 `searchInput.focus()`，焦点回落 BODY，↓ 立即可切屏；字母键盲打聚焦搜索框逻辑保留（输入体验不损）。

### 7. 回归验证（无头 Chrome CDP，1280×800）

**功能回归 20/20 通过**：初始状态（scrollY=0、start 在位、nav 屏下 translateY=713、a11y 隔离、齿轮可见）、滑入单调 713→0 且终点归零、scrollY 恒 0、start 同步移出、刷新恢复直达 nav 无过渡、切回复位、齿轮隐藏/恢复、PageDown 切屏、编辑弹窗可开。

**手势回归通过**：滚轮下滚 120px 切 nav、导航页内部可滚动（内容 2529 > 视口 641）、有内容时上滚不放行、到顶上滚切回 start、触屏上滑切屏；惯性未停时上滚不放行属防误触设计内行为。

**方向键/焦点专项 4/4 通过**：切回后焦点=BODY（未自动聚焦）、立即 ArrowDown 切回导航页、字母键盲打仍聚焦搜索框、联想激活时 ArrowDown 用于联想选中（不误切）。

**构建校验**：`npm run build` 通过，bookmarks 同步 100%；dist 中 `content-visibility` / `animateScrollTo` / `window.scrollTo` 残留均为 0。

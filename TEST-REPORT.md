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

**设计确认（v2.3.3）**：齿轮按钮为作者特意设计，仅搜索页显示、导航页隐藏。实现为 `#editBookmarksBtn.hidden-on-nav`（淡出 + `pointer-events: none`），由 `updateGearVisibility()` 依据 `state.currentSection` 统一切换。**过渡动画**：`opacity` 以 0.45s ease 淡入淡出；**切换时机**：切向导航页时随滚动开始即平滑淡出（约 500ms 内消失，与页面到达同步，避免残留）；切回搜索页时等待切屏动画完成后再淡入。sessionStorage 恢复分支（刷新后停留在导航页）则立即隐藏。

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

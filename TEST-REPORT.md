# Glass Start v2.3.3 上线前测试报告

测试日期：2026-08-01
测试环境：macOS (darwin) · Node v26.5.0 · puppeteer-core v25.4.0 · Google Chrome
测试模式：源码开发服务 (`localhost:3000`) 与生产构建 (`dist/`, `localhost:4000`) 双端

## 结论

**PASS，可上线。** 共 122 项自动化断言全部通过；测试中发现并修复 1 个真实 UI bug、确认齿轮按钮"仅搜索页显示"设计、上线前完成生产 CSP 收紧。

| 套件 | DEV | PROD |
|---|---|---|
| 冒烟测试 smoke.js（38 项） | 38/38 ✅ | 38/38 ✅ |
| 高级测试 advanced.js（23 项） | 23/23 ✅ | 23/23 ✅ |

## 一、静态审查

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

**设计确认（v2.3.3）**：齿轮按钮为作者特意设计，仅搜索页显示、导航页隐藏。实现为 `#editBookmarksBtn.hidden-on-nav`（淡出 + `pointer-events: none`），由 `updateGearVisibility()` 依据 `state.currentSection` 统一切换。**过渡动画**：`opacity` 以 0.45s ease 淡入淡出；**切换时机**：仅在切屏动画完成（`animateScrollTo` 结束回调）后才显示/隐藏，滚动开始时按钮保持可见，避免"一开始滚动就立刻消失"。sessionStorage 恢复分支（刷新后停留在导航页）则立即隐藏。

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

# Bing 与 Google Lens 以图搜图接入记录

记录 2026-11-17 在 `codex/reverse-image-search` 上完成的上传接入（`2e2786e`）与相机入口调整（`012e91d`）。当前入口及引擎回退规则见[架构说明](../ARCHITECTURE.md#搜索与天气)。

## Bing 上传返回 HTTP 400

早期实现提交原图时，约 6.2 MB 的 PNG 可复现 HTTP 400。参照 Bing 图片搜索页面的处理方式，用 `Image.decode()` 解码，超过 100 万像素时按比例缩小，在白底画布上以 `0.7` 的质量编码成 JPEG。原生 multipart 表单向 `www.bing.com/images/search` 提交 `cbir=sbi` 和 `imageBin`。`imageBin` 只包含 JPEG 的 Base64 内容。上传查询参数集中维护在[引擎配置](../../src/js/config/engines.js)。

同一测试 PNG 经转换后，在 Chrome 网页版和扩展中提交均得到 HTTP 200 的 Bing 结果页。100 万像素是本项目的预处理阈值，测试记录的 6.2 MB 是复现样本的大小。

## Google Lens 上传返回 HTTP 403

从主页面直接提交表单时，调试中遇到 HTTP 403。浏览器验证表明，使用 `no-referrer` 后，Chrome 发出的跨站 POST 带 `Origin: null`，Lens 接受上传并重定向到带结果标识的 Google 搜索页。

[页面模板](../../src/index.html)用隐藏的同源 `srcdoc` iframe 承载独立表单，只有这个嵌入文档使用 `no-referrer`。表单以 `target="_top"` 向 `lens.google.com/v3/upload` 提交 multipart POST，以 `encoded_image` 附上原始文件，并带上语言 `hl` 和时间戳 `st`。当文件没有图片 MIME 类型时，先通过浏览器解码确认，再提交同一原始文件。用户实测确认 Google 结果页能显示上传的原图和搜索结果。

## 文件处理与 CSP

- [相机选图与拖放](../../src/js/modules/search-events.js)均进入同一[上传函数](../../src/js/modules/search.js)。浏览器可以解码缺少 MIME 类型的图片，以及只有 `viewBox` 的 SVG。提交后清空文件输入，解码时用到的对象 URL 在处理结束时释放，应用不持久化图片。
- 本地解码失败时，在搜索框下方的绝对定位状态区提示，页面布局保持原位。
- 网页模板、[托管响应头](../../public/_headers)和[扩展清单](../../src/extension/manifest.json)的 `form-action` 均放行两个上传路径以及 `www.google.com/search` 结果路径。浏览器直接向对应提供方提交图片。

## 验证记录

| 基线 | 检查 | 结果 |
| :--- | :--- | :--- |
| `2e2786e` | `npm run lint`、`npm test`、`npm run test:w3c` | lint 通过，测试 139/139 通过。Nu HTML 与 Stylelint 无错误或警告。 |
| `012e91d` | `npm run lint`、`npm test -- ui-overlay-modals`、`npm run build:extension` | lint 与扩展构建通过，专项测试 8/8 通过。 |
| `012e91d` | Chrome 桌面、390 px 移动模拟与解包扩展 | 检查相机入口和引擎菜单，在扩展中打开系统选图并拦截两个引擎的真实浏览器 POST。 |

[Chrome 回归用例](../../test/ui-overlay-modals.test.mjs)通过 CDP 拦截上传请求，验证选图和拖放、Wikipedia 的语言回退、Bing JPEG 像素上限、Lens 原文件与来源策略，以及无 MIME 的图片和无效文件提示。表中的自动化结果覆盖浏览器提交行为。线上响应以接入时的实测和用户复验为准。

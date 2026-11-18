# Bing 与 Google Lens 以图搜图接入记录

记录 2026-11-17 在 `codex/reverse-image-search` 上完成的上传接入（`2e2786e`）与相机入口调整（`012e91d`）。当前入口及引擎回退规则见[架构说明](../ARCHITECTURE.md#搜索与天气)。

## Bing 上传返回 HTTP 400

早期实现提交原图时，约 6.2 MB 的 PNG 可复现 HTTP 400。参照 Bing 图片搜索页面的处理方式，用 `Image.decode()` 解码，超过 100 万像素时按比例缩小，在白底画布上以 `0.7` 的质量编码成 JPEG。原生 multipart 表单向 `www.bing.com/images/search` 提交 `cbir=sbi` 和 `imageBin`。`imageBin` 只包含 JPEG 的 Base64 内容。上传查询参数集中维护在[引擎配置](../../src/js/config/engines.js)。

同一测试 PNG 经转换后，在 Chrome 网页版和扩展中提交均得到 HTTP 200 的 Bing 结果页。100 万像素是接入时采用的预处理阈值，6.2 MB 是复现样本的大小。

### 2026-11-18 上传复测

用 Chrome 将合成图编码成质量为 `0.7` 的 JPEG，跳过本地缩放，沿用项目的 multipart 字段向 Bing 提交。成功以 Bing 返回搜图令牌为准。

| 样本 | 尺寸 | `imageBin` 字节数 | 上传结果 |
| :--- | :--- | ---: | :--- |
| 随机噪声 | 1095 × 1095 | 846,184 | 返回搜图令牌 |
| 随机噪声 | 1500 × 800 | 844,812 | 返回搜图令牌 |
| 随机噪声 | 1216 × 1216 | 1,038,120 | HTTP 400 |
| 简单图案 | 10400 × 10400 | 1,019,112 | 返回搜图令牌 |

结果更符合编码后体积的限制，尚未测得 Bing 的绝对像素上限。项目将单次编码的预处理上限调至 120 万像素，JPEG 质量继续采用 `0.7`。两张约 120 万像素的噪声图都成功，Base64 体积比表中的失败样本低约 18%。

## Google Lens 上传返回 HTTP 403

从主页面直接提交表单时，调试中遇到 HTTP 403。浏览器验证表明，使用 `no-referrer` 后，Chrome 发出的跨站 POST 带 `Origin: null`，Lens 接受上传并重定向到带结果标识的 Google 搜索页。

[页面模板](../../src/index.html)用隐藏的同源 `srcdoc` iframe 承载独立表单，只有这个嵌入文档使用 `no-referrer`。表单以 `target="_top"` 向 `lens.google.com/v3/upload` 提交 multipart POST，以 `encoded_image` 附上原始文件，并带上语言 `hl` 和时间戳 `st`。当文件没有图片 MIME 类型时，先通过浏览器解码确认，再提交同一原始文件。用户实测确认 Google 结果页能显示上传的原图和搜索结果。

## 文件处理与 CSP

- 相机选图、拖放与粘贴共用上传流程。浏览器尝试解码缺少 MIME 类型的图片和仅有 `viewBox` 的 SVG。用原生表单字段提交，提交后移除临时字段并清空文件输入，处理结束时释放解码用的对象 URL。图片由浏览器直接提交给对应服务，应用不持久化图片。[控件事件](../../src/js/modules/search-events.js) · [上传函数](../../src/js/modules/search.js)
- 本地解码失败时，搜索框下方的绝对定位状态区显示提示，页面布局保持原位。输入文字、清空搜索框或切换引擎时清除提示。
- 网页模板、[托管响应头](../../public/_headers)和[扩展清单](../../src/extension/manifest.json)的 `form-action` 均放行两个上传路径以及 `www.google.com/search` 结果路径。浏览器直接向对应提供方提交图片。

## 验证记录

| 基线 | 检查 | 结果 |
| :--- | :--- | :--- |
| `2e2786e` | `npm run lint`、`npm test`、`npm run test:w3c` | lint 通过，测试 139/139 通过。Nu HTML 与 Stylelint 无错误或警告。 |
| `012e91d` | `npm run lint`、`npm test -- ui-overlay-modals`、`npm run build:extension` | lint 与扩展构建通过，专项测试 8/8 通过。 |
| `012e91d` | Chrome 桌面、390 px 移动模拟与解包扩展 | 检查相机入口和引擎菜单，在扩展中打开系统选图并拦截两个引擎的真实浏览器 POST。 |

Chrome 回归用例通过 CDP 拦截上传请求，覆盖选图、拖放和粘贴、Wikipedia 的语言回退、Bing JPEG 像素上限、Lens 原文件与来源策略，以及无 MIME 的图片和无效文件提示。2026-11-18 调整上限后，`npm run lint` 的 43 项检查和 `npm test -- ui-overlay-modals` 的 10 项测试均通过。[Chrome 回归用例](../../test/ui-overlay-modals.test.mjs)

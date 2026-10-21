# Glass Start — 开发约束

架构、状态流及模块索引按需查阅 [ARCHITECTURE.md](./docs/ARCHITECTURE.md)；使用、书签格式及测试环境见 [README.md](./README.md)；WebKit/iOS 兼容性走查见 [docs/SAFARI_SMOKE_CHECKLIST.md](./docs/SAFARI_SMOKE_CHECKLIST.md)。实现以源码为准，业务配置统一维护在 `src/js/config/`：通用常量与运行时配置在 `constants.js`，首屏共享的预设壁纸、引擎元数据/图标、天气图标分别见 `backgrounds.js`、`engines.js` / `engine-icons.js`、`weather-icons.js`。

## 修改边界

- 优先使用原生 Web API，默认保持零第三方运行时依赖。确需引入时，应说明收益，并验证产物体积、首屏性能和离线兼容性。开发依赖可按需增加，避免无关工具扩张。
- 应用源码位于 `src/`、`bookmarks.json`、`sw.js`；允许修改完成当前任务所必需的相关文档、工具及测试，避免无关改动。图标同步可更新 `public/icons/`。
- 不手工修改 `dist/`，产物由构建生成。Tailwind v4 仅使用 `@theme`，不创建 `tailwind.config.js`。
- 版本号以 `package.json` 为准；未经明确授权不执行 `git push`，日常验证不滥用 `--force`。
- 避免无新信息的重复调用。连续尝试无进展时，先总结证据并调整排查方向；确需用户信息或权限时再暂停。

## 实现约束

- 大图 / Base64 壁纸存入 IndexedDB（`src/js/utils/idb.js`），不写入 LocalStorage。
- 书签弹窗的编辑、增删及重排由 `modalState.draftBookmarks` 内存草稿驱动；保存与导出直接消费草稿，不从 DOM 反向解析数据。允许事件定位、焦点管理及拖拽布局测量。
- 通过 `dom.xxx` 或静态键访问的节点须登记到 `src/js/state/dom.js` 的 `cacheDOM()`，并同步 `src/js/types.d.ts` 的 `DOMCache` 类型；仅用于标签关联、无障碍描述或锚点等用途的 ID 无须缓存。
- 受 `OverlayStack` 管理的弹窗通过 `.push(id, closeFn)` / `.pop(id)` 管理显示与关闭，业务模块不直接修改这些弹窗的 `style.display` 或 `hidden`；普通提示区、折叠内容可使用 `hidden`。层级见架构文档。
- 动态 HTML 文本使用 `escapeHtml()`，URL 属性使用 `safeUrl()`；`textContent` 直接接收文本。天气数值使用 `weatherNum()`，时间另行校验，地点等文本转义。
- 保持 lint 约束：按钮声明 `type="button"`，装饰 SVG 标注 `aria-hidden="true"`，交互图标提供 `aria-label`；禁止 `-webkit-font-smoothing` 和非 `prefers-reduced-motion` 内的 `!important`。
- 单行输入框默认及触屏字号 >= 16px；仅书签编辑器和壁纸直链输入允许 `mouse-desktop:text-xs`，其变体须同时满足宽度 >= 640px、hover、精细指针且无粗指针设备。卡片 `:hover` 加 `body:not(.tab-blurred)` 前缀。
- 预设书签图标统一使用 `./icons/{domain}.png`；`desc` 纯中文 <= 9 字、含英数 <= 13 字符，由 lint 校验。
- 首屏共享配置只修改 `src/js/config/` 下的对应模块，由构建注入 `src/index.html` 插槽；不要在 HTML 内联壁纸、引擎图标或天气图标副本。

## 验证

| 触发条件 | 必须执行 |
| :--- | :--- |
| 新增书签或修改 URL、图标来源 | 依次运行 `npm run sync:icons`、`npm run lint` |
| 仅修改书签名称、简介、排序或删除书签 | `npm run lint`，无需同步图标；功能变更仍执行对应模块测试 |
| 代码修改 | `npm run lint && npm run typecheck` |
| 局部功能修改 | 按模块运行 `npm run test:ui` / `npm run test:data` / `npm run test:infra` / `npm run test:lifecycle` |
| 常规提交前 | `npm test` |
| 版本发布前 | `npm test && npm run test:w3c`，W3C 错误阻断发布，警告分类列出并评估；服务不可用时报告校验未完成，恢复后重试，不视为页面错误或校验通过。Safari/iOS 按 `docs/SAFARI_SMOKE_CHECKLIST.md` 手动走查 |

验证失败时修复本次改动引入的问题，并重跑受影响检查；如有环境阻塞或既有失败，明确报告。

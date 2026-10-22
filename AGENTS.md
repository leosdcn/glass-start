# Glass Start — 开发约束

架构与模块索引见 [ARCHITECTURE.md](./docs/ARCHITECTURE.md)；使用、书签格式及测试环境见 [README.md](./README.md)；Safari/iOS 走查见 [docs/SAFARI_SMOKE_CHECKLIST.md](./docs/SAFARI_SMOKE_CHECKLIST.md)。实现以源码为准。业务配置位于 `src/js/config/`，各模块职责见架构文档。

## 修改边界

- 优先使用原生 Web API，默认保持零第三方运行时依赖。确需引入时，应说明收益，并验证产物体积、首屏性能和离线兼容性。开发依赖可按需增加，避免无关工具扩张。
- 应用源码位于 `src/`、`bookmarks.json`、`sw.js`；可按任务需要修改文档、工具及测试，避免无关改动。图标同步可更新 `public/icons/`。
- 不手工修改 `dist/`，产物由构建生成。Tailwind v4 仅使用 `@theme`，不创建 `tailwind.config.js`。
- 版本号以 `package.json` 为准；未经明确授权不执行 `git push`，日常验证不滥用 `--force`。
- 避免无新信息的重复调用。连续尝试无进展时，先总结证据并调整排查方向；确需用户信息或权限时再暂停。

## 实现约束

- 大图 / Base64 壁纸存入 IndexedDB（`src/js/utils/idb.js`），不写入 LocalStorage。
- 书签弹窗的编辑、增删及重排由 `modalState.draftBookmarks` 内存草稿驱动；保存与导出直接读取草稿，不从 DOM 反向解析数据。允许事件定位、焦点管理及拖拽布局测量。
- 通过 `dom.xxx` 或静态键访问的节点须登记到 `src/js/state/dom.js` 的 `cacheDOM()`，并同步 `src/js/types.d.ts` 的 `DOMCache` 类型；仅用于标签关联、无障碍描述或锚点的 ID 无须缓存。
- 受 `OverlayStack` 管理的弹窗通过 `.push(id, closeFn)` / `.pop(id)` 管理显示与关闭，业务模块不直接修改这些弹窗的 `style.display` 或 `hidden`；普通提示区、折叠内容可使用 `hidden`。层级见架构文档。
- 动态 HTML 文本使用 `escapeHtml()`，URL 属性使用 `safeUrl()`；`textContent` 直接接收文本。天气数值使用 `weatherNum()`，时间另行校验，地点等文本转义。
- 保持 lint 约束：按钮声明 `type="button"`，装饰 SVG 标注 `aria-hidden="true"`，交互图标提供 `aria-label`；禁止 `-webkit-font-smoothing`；`!important` 仅允许用于 `prefers-reduced-motion` 规则内。
- 单行输入框默认及触屏字号 >= 16px；仅书签编辑器和壁纸直链输入允许 `mouse-desktop:text-xs`，其变体须同时满足宽度 >= 640px、hover、精细指针且无粗指针设备。卡片 `:hover` 加 `body:not(.tab-blurred)` 前缀。
- 预设书签图标统一使用 `./icons/{domain}.png`；`desc` 纯中文 <= 9 字、含英数 <= 13 字符，由 lint 校验。
- 首屏共享配置只修改 `src/js/config/` 下的对应模块，由构建注入 `src/index.html` 插槽；不要在 HTML 内联壁纸、引擎图标或天气图标副本。

## 验证

按行为影响和风险选择必要检查，不以文件数量决定范围。下表按需选择，不逐行叠加；混合改动覆盖所有受影响行为。

| 改动范围 | 默认验证 | 扩大验证的条件 |
| :--- | :--- | :--- |
| 仅文档、注释或不影响行为的格式调整 | 检查差异、链接和命令是否正确，无需运行测试 | 文档涉及命令或配置时，对照对应源码核实 |
| 仅修改书签名称、简介、排序或删除书签 | `npm run lint` | 同时改动书签逻辑时，再按逻辑影响选择测试 |
| 新增书签或修改 URL、图标来源 | 依次运行 `npm run sync:icons`、`npm run lint` | 图标渲染存在疑问时，先构建再运行 `npm run test:icons` |
| 局部 HTML / CSS / 界面文案调整 | `npm run lint`；布局或视觉变化时预览受影响界面 | 涉及交互、手势或可访问性时，加跑对应测试文件；涉及 Safari 差异时走查相关清单项 |
| 局部 JavaScript / 工具 / 测试逻辑调整 | `npm run lint`，选择直接覆盖改动行为的测试文件；涉及类型检查范围内的 JS、类型声明或类型配置时运行 `npm run typecheck` | 影响多个模块时扩大到相关文件或对应模块套件 |
| 核心状态机、持久化迁移、Service Worker 升级或构建入口的跨模块改造 | `npm run lint` 与 `npm test` | 局部修复仍可先运行直接相关测试；只有影响范围广或无法可靠界定时才要求全量 |
| 版本发布前 | `npm run lint`、`npm test`、`npm run test:w3c`，并按 Safari 清单手动走查 | W3C 错误阻断发布；警告分类评估；服务不可用视为校验未完成，恢复后重试 |

- 局部浏览器回归可用 `npm test -- data-settings-save` 等文件名片段筛选；选择足够具体的片段，避免误匹配无关文件。`test:ui` / `test:data` / `test:infra` / `test:lifecycle` 是更大范围的备选入口，不是局部修改的默认要求。
- 无需浏览器或构建产物的纯单元测试，可直接运行 `node --test test/<对应文件>.test.mjs`。浏览器测试使用上述筛选入口，由运行器先检查类型、构建再执行；无需重复手动运行同一轮 typecheck 或 build。
- 不因准备 Git Commit、修改了源码文件或结束任务而自动执行全量测试。仅在上述高风险改造、版本发布或用户明确要求时运行全量。
- 同一版本的检查通过后不重复运行；后续改动只重跑受影响项。验证失败时先定位原因，不以运行全量测试代替排查。
- 不为文档、文案或简单样式调整新增测试。行为修复优先复用已有测试；存在未覆盖的回归风险时再补充。

交付时列出检查结果，并说明必要但未完成的验证、环境阻塞或既有失败。

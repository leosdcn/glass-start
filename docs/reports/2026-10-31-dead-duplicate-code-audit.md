# 死代码、废弃代码与重复代码检查

日期：2026-10-31。检查版本：`5.4.3`，Git 基线：`b112e40`。

## 结论

初轮项目级静态检查未确认可直接删除的业务死模块或明确废弃的迁移代码，确认 4 处可精简的重复实现和 4 个当前源码不再引用的重复图标。随后逐文件人工审阅补充发现无用局部变量、不可达分支及失效样式，已完成下文列出的精简。旧图标可能仍被历史用户数据引用，继续保留。

初轮仅新增审计报告；随后按“核实并精简”要求完成下述精简，未删除资源。

## 范围与方法

- 检索 348 个 Git 跟踪文件；重点检查 43 个应用 JS 模块、Service Worker、13 个工程脚本、37 个回归测试文件、测试辅助模块、HTML、3 份 CSS、配置及静态资源。
- 使用 Acorn 分析导入、导出及重复函数体，结合全文引用检索复核；动态生成的首屏入口、命名空间成员和测试桥接单独核对。
- 使用 esbuild 在内存编译网页版、扩展版、测试版应用，并检查首屏配置入口依赖，未写入构建产物。43 个应用 JS 模块均位于这些入口的依赖闭包中；模块可达不等于模块内所有分支均已证明可达。
- 检查配置键、状态字段、CSS 类、CSS 变量、翻译键和 SVG 符号引用。Tailwind 主题令牌、动态天气翻译键及 `cache.web.*` / `cache.extension.*` 等动态引用已作排除。
- 对跟踪文件计算 SHA-256，核对完全重复资源。
- `dist/`、`extension/`、`node_modules/` 和忽略的测试产物不作为待清理源码。

## 确认的重复实现

| 位置 | 证据与影响 | 建议 |
| :--- | :--- | :--- |
| `scripts/sync-icons.mjs:40` | 本地重新定义 `isTTY`、`c` 和 `HR_DOUBLE`；与 `scripts/terminal.cjs:2` 的终端配色及分隔线逻辑重叠。其他构建、检查工具已复用该模块。 | 从现有 `terminal.cjs` 导入 `c`、`HR_DOUBLE`，删除本地副本，无需新增工具或抽象。 |
| `scripts/build.cjs:244`、`:267`、`:287` | `injectThemeConfig()`、`injectWeatherNum()`、`injectHeadConfig()` 重复执行相同的 esbuild IIFE 编译、追加绑定、保护 script 结束标签及唯一插槽替换。三者都在使用，不是死函数。 | 让前两个薄封装调用已有 `injectHeadConfig()`；保留 `injectThemeConfig(html, themePath)` 的测试入口和参数语义。 |
| `src/js/modules/search.js:264`、`:274` | `openRandomBookmark()` 分别遍历快捷书签与分类书签，两处回调完全重复 URL 检查、Set 去重和追加列表。 | 如需精简，在函数内复用一个追加回调；保持当前遍历顺序及按原始 URL 去重的语义，不引入全局通用层。 |
| `src/js/modules/bookmarks.js:344`、`:371` | 可见图标与全部图标激活逻辑中，回调均执行 `img.src = img.dataset.navSrc` 后删除 `data-nav-src`。差异在选择器、调度和状态管理。 | 重复仅几行，优先级最低，可以保留。若修改此处，可就地复用回调；不要把两阶段加载和空闲调度合并。 |

这些均为维护性问题，本轮没有据此确认功能故障。

## 当前无引用的重复图标

下列旧图标在当前源码、书签及配置中均无路径或文件名引用；每对文件的 SHA-256 完全相同。

| 当前无引用文件（相对 `public/icons/`） | 当前使用文件 | 大小 |
| :--- | :--- | ---: |
| `msdmanuals.cn.png` | `msdmanuals.com.png` | 773 B |
| `zh.wikihow.com.png` | `wikihow.com.png` | 1,418 B |
| `zh.wikipedia.org.png` | `en.wikipedia.org.png` | 1,568 B |
| `zh.wikivoyage.org.png` | `en.wikivoyage.org.png` | 1,296 B |

合计 5,055 B，约 4.94 KiB。`scripts/build.cjs` 会全量复制 `public/`，所以这些文件仍随网页及扩展发布。图标同步脚本仅规范和补齐当前书签图标，不回收旧文件。

不能仅凭当前源码无引用断言可安全删除：`saveUserBookmarks()`、旧书签迁移和 JSON 导入会保留书签的 `icon` 字段，历史 LocalStorage 或用户备份可能仍指向旧文件。收益很小，建议保留；只有明确处理旧路径兼容后才删除。

## 已复核、不属于废弃代码的项目

- `src/js/config/locales/index.js` 和 `initializeI18n()`：由 `scripts/build.cjs:310` 的生成式入口使用。
- `applyTranslations()`：经 `window.__GLASS_I18N__` 暴露给 HTML 末尾脚本。
- `PRESET_TINTS` 等主题别名：构建注入后供 HTML 首屏预渲染使用，不能依据普通 ESM 导入计数删除。
- `src/js/testing/bridge.js`：测试构建需要。内存编译确认网页版和扩展版生产依赖均不包含该模块，测试版包含。
- 旧书签、壁纸及 Service Worker 缓存迁移：仍有持久化兼容职责，并有对应回归用例；源码中的 `legacy` 不代表废弃。
- `@theme` 下的 `--spacing-*` 和 `--shadow-tab-active`：通过 Tailwind 工具类及 `@apply` 间接使用。
- `svg-sprite`：SVG 容器自身的 ID，不是没有消费者的图标符号。
- 测试中的极小桩函数、字典读取：存在少量重复，保持用例自包含的收益高于提取共享脚手架。

## 验证结果与边界

- `npm run lint`：31 项通过。
- `npm run typecheck`：页面与 Service Worker 两套配置通过。
- 两套类型配置额外启用 `--noUnusedLocals --noUnusedParameters`：均通过。
- 网页、扩展、测试应用的内存编译通过，动态首屏依赖核对完成。
- 未运行完整网页/扩展产物构建、Chrome 行为回归、全量测试或 W3C 在线校验。本轮没有行为修改，这些不属于报告交付的必要验证。
- 结论来自静态引用、构建依赖和重复内容检查，不代表对所有运行时路径的不可达性证明；历史用户数据也无法从仓库静态确定。

建议优先处理终端输出副本；若后续维护构建入口，再合并已有注入逻辑。两处短回调和不足 5 KiB 的历史图标无需为了清理而扩张改造。


## 后续核实与精简

同日按用户要求复核后，实施 3 处最小精简：

- `scripts/sync-icons.mjs` 直接导入既有 `terminal.cjs` 的配色及分隔线，删除本地副本。完整 CLI 回归的临时目录同步复制该依赖。
- `scripts/build.cjs` 让主题注入复用 `injectHeadConfig()`，天气数值注入直接调用同一函数；删除单次使用的 `injectWeatherNum()` 和不必要的立即执行包装。保留主题注入测试入口、编译选项、绑定名称、插槽检查及 script 边界保护。
- `src/js/modules/search.js` 在随机书签函数内部复用追加回调，保持快捷书签先于分类书签、按原始 URL 去重及延迟打开行为。

以上 3 个实现文件及 1 个既有测试文件合计新增 37 行、删除 81 行，净减少 44 行。未引入依赖或新模块。

导航图标的三行重复回调继续保留：分开呈现两个加载阶段更直接。4 个旧图标继续保留，避免历史书签路径失效；迁移逻辑、首屏配置和测试入口也保持不变。

精简后验证：

- `npm run lint`：31 项通过。
- `npm test`：66 项通过、0 失败、0 跳过；包含页面与 Service Worker 类型检查、网页版构建、Chrome 网页回归及扩展构建/实际加载验收。
- 临时内存编译执行随机书签检查：跨列表去重、候选顺序、无效项、空列表、新标签打开和当前页打开均通过；未新增测试脚手架。
- `git diff --check`：通过。
- 本次不是版本发布，未运行 W3C 在线校验。

## 逐文件人工审阅与第二轮精简

用户进一步要求“人工审阅每个文件”。本节独立于初轮静态扫描：以 `git ls-files` 列出的 **348 个跟踪文件**为清单，逐个核对，不把检索命中或模块可达当作已经读完文件。

- **147 个源码、工具、测试、配置、书签/翻译及文档文件**：逐个阅读正文，较长文件分段读取；核对调用、事件、数据流、动态引用、说明与实现的一致性。书签和字典按完整条目成对读取。
- **43 个 SVG**：逐文件核对图形结构、符号/本地资源引用及是否包含脚本、事件属性或外链；不将几何路径数据当作 JavaScript 代码逐行审计。
- **154 个二进制图片**：逐文件核对用途、引用、尺寸、格式与 SHA-256；PNG 额外检查全部 chunk CRC，AVIF / ICO 经系统图像工具读取尺寸。图片核验不等于逐张视觉设计验收。
- **4 个生成式数据文件**：锁文件核对 116 个依赖记录、根依赖与版本一致性；3 份历史性能 JSON 核对元数据、报告引用、全部样本结构、数值有效性及汇总样本数。没有将原始采样数字和完整性散列声称为逐行人工代码阅读。
- 本报告作为新增交付文档另行检查。忽略的依赖源码、构建产物和本地调试产物不计入上述 348 个文件。

### 本轮确认并处理的残留

| 文件 | 证据及处理 |
| :--- | :--- |
| `src/index.html` | 天气首帧脚本计算 `desc` 后未读取，直接删除；描述继续由共用翻译函数生成。 |
| `src/js/core/screen-state.js` | 私有等待函数唯一调用方已同步执行 `prepareScreenTransition()` 移除 `.nr`；删除随后恒假的 `.nr` 检查，并更新注释。首帧恢复仍保留 `.nr`。 |
| `src/styles/glass.css` | 当前 HTML 及动态模板均无 `#editModal .glass-subcard`，删除这一失效悬停覆盖；天气和语言弹窗的共用样式保留。 |
| `src/styles/main.css`、`src/js/modules/bookmarks.js` | 侧栏标签没有任何变换来源，删除移动端悬停 `transform: none` 空操作及其仅供该规则使用的类名。 |
| `scripts/server.cjs` | 自动打开浏览器分支重复计算外层已有的 `isCleanMode`，复用外层值。 |
| `scripts/sync-icons.mjs` | 主机解析重复，裸主机名复用已有原始主机解析；下载入口实际均指定 7000ms，统一默认值并删除从未生效的 8000ms 默认常量。重定向继续传递原超时。 |
| `scripts/build.cjs` | 构建报错仍要求检查已经不存在的旧版 Tailwind CDN 替换逻辑，改为指向当前模板与注入内容。保留 CDN 禁用断言。 |
| `test/data-features.test.mjs`、`test/ui-overlay-modals.test.mjs` | 删除嵌入浏览器脚本中未使用的 `cb2Name`、`sTy`。后者还省去一次无用计算样式读取。 |
| `test/ui-input-device-performance.test.mjs` | 文件开头在 CI 下已退出，后面的 CI 鼠标媒体属性补丁不可达，删除该分支；正常环境继续等待真实媒体能力。 |
| `test/ui-rendering-performance.test.mjs` | 同样在 CI 下已退出，删除后续不可达的 CI 重绘阈值和条件判断，保持实际执行的 Paint ≤ 4 与零 Layout 断言。 |
| `test/verify-local-icons.mjs` | 复用已有终端配色及分隔线，移除不存在的旧卡片选择器；修正将图标检查夸大为整个首屏零网络依赖/瞬间解码的输出文字。 |
| `test/visual-regression.mjs` | 唯一输出目录无需单元素数组与循环，直接写入既有目录；全部截图和 JSON 输出文件名不变。 |
| `README.en.md` | 移除“设置壁纸立即保存且取消不恢复”的过期说明，对齐中文版与当前草稿/保存、缓存隔离、Worker 类型检查实现。 |

没有发现应整文件删除的应用模块、工具或回归用例。6 个直接开发依赖均有构建、解析或类型检查用途；锁文件中的跨平台可选依赖不能按本机安装平台删除。Logo 与 favicon 共享图形但裁切视框不同，且各有入口，保留。历史性能数据被历史报告引用，保留；历史报告中的旧文件名与旧模式属于版本证据，不当作当前死代码处理。

仍保留书签、壁纸及 SW 历史迁移、测试桥接、首帧注入接口、短小测试桩和两阶段图标激活回调。人工审阅未新增为去重而建立的通用抽象、依赖、状态或测试脚手架。

### 本轮验证

- `npm run lint`：31 项通过。
- `npm test`：**66 项通过、0 失败、0 跳过**，约 61.2 秒；包含页面与 Worker 类型检查、网页构建、Chrome 网页回归及扩展构建/实际加载。
- `npm run test:icons`：**15/15 通过**；135 个书签图标节点均为本地路径且成功解码，无图标回退或外部 favicon 请求。
- `npm run test:visual`：**11/11 布局场景通过**，桌面/移动、刷新恢复、联想及弹窗均通过；截图与 `visual_test_summary.json` 正常写入既有 `test/artifacts/`。这是布局断言及截图生成，不是像素基准差分。
- 3 份历史性能 JSON 的逐组统计由原始样本重新计算，与保存的汇总字段一致；没有重跑历史性能基准。
- `node --check scripts/server.cjs`、`bash -n start.command`、清单完整性及 `git diff --check`：通过。
- 累计前后两轮，17 个实现、测试及 README 文件新增 64 行、删除 155 行，净减少 **91 行**；不含本报告。第二轮在前轮基础上再减少 47 行。
- 本轮没有必要但未完成的验证；不是版本发布，未运行 W3C 在线发布校验，也未将本地回归当作第三方线上服务可用性验收。

本地日志：`/tmp/glass-manual-lint.log`、`/tmp/glass-manual-test.log`、`/tmp/glass-manual-icons.log`、`/tmp/glass-manual-visual.log`。未更新版本号或推送代码。

### 完整文件清单

方法：**R** = 已逐个阅读正文；**S** = SVG 结构与引用核验；**B** = 二进制格式、尺寸、散列与引用核验；**G** = 生成式数据结构、依赖/样本与引用核验。下表覆盖原有 348 个跟踪文件，不包含本报告本身。

| 文件 | 方法 | 结果 |
| :--- | :---: | :--- |
| `.github/ISSUE_TEMPLATE/bookmark.yml` | R | 工作流或贡献模板入口有效；保留 |
| `.github/ISSUE_TEMPLATE/bug.yml` | R | 工作流或贡献模板入口有效；保留 |
| `.github/ISSUE_TEMPLATE/feature.yml` | R | 工作流或贡献模板入口有效；保留 |
| `.github/PULL_REQUEST_TEMPLATE.md` | R | 工作流或贡献模板入口有效；保留 |
| `.github/workflows/ci.yml` | R | 工作流或贡献模板入口有效；保留 |
| `.github/workflows/deploy.yml` | R | 工作流或贡献模板入口有效；保留 |
| `.gitignore` | R | 源码、产物及本地数据边界有效；保留 |
| `AGENTS.md` | R | 开发边界及验证规则；保留 |
| `CONTRIBUTING.en.md` | R | 双语贡献约束与入口有效；保留 |
| `CONTRIBUTING.md` | R | 贡献约束与入口有效；保留 |
| `LICENSE` | R | 项目许可原文及构建复制用途；保留 |
| `README.en.md` | R | 修正已过期的保存、缓存与类型检查说明 |
| `README.md` | R | 使用、部署及命令与源码核对；保留 |
| `bookmarks.json` | R | 8 个快捷书签、13 分类与 127 个不同 URL；保留 |
| `docs/ARCHITECTURE.md` | R | 维护中的说明及引用有效；保留 |
| `docs/SAFARI_SMOKE_CHECKLIST.md` | R | 维护中的说明及引用有效；保留 |
| `docs/TRANSITION_BENCHMARK.md` | R | 维护中的说明及引用有效；保留 |
| `docs/assets/preview-nav-en.png` | B | 1440x900；文档截图引用，保留 |
| `docs/assets/preview-nav.png` | B | 1440x900；文档截图引用，保留 |
| `docs/assets/preview-start-en.png` | B | 1440x900；文档截图引用，保留 |
| `docs/assets/preview-start.png` | B | 1440x900；文档截图引用，保留 |
| `docs/performance/2026-10-23-safari.json` | G | 历史报告引用，元数据、全部样本结构和汇总数量有效；保留 |
| `docs/performance/2026-10-25-transition-benchmark.json` | G | 历史报告引用，元数据、全部样本结构和汇总数量有效；保留 |
| `docs/performance/2026-10-28-structure-benchmark.json` | G | 历史报告引用，元数据、全部样本结构和汇总数量有效；保留 |
| `docs/reports/2026-10-23-safari-performance.md` | R | 历史版本修复或测量证据；保留 |
| `docs/reports/2026-10-24-audit.md` | R | 历史版本修复或测量证据；保留 |
| `docs/reports/2026-10-25-transition-performance.md` | R | 历史版本修复或测量证据；保留 |
| `docs/reports/2026-10-28-english-localization.md` | R | 历史版本修复或测量证据；保留 |
| `docs/reports/2026-10-28-structure-verification.md` | R | 历史版本修复或测量证据；保留 |
| `docs/reports/2026-10-29-module-review.md` | R | 历史版本修复或测量证据；保留 |
| `docs/reports/2026-10-29-transition-audit.md` | R | 历史版本修复或测量证据；保留 |
| `package-lock.json` | G | 116 个依赖记录与根依赖/版本一致；保留 |
| `package.json` | R | 6 个直接开发依赖及各命令均有用途；保留 |
| `public/SOURCE.txt` | R | 构建分发所需源码说明；保留 |
| `public/_headers` | R | 托管缓存与安全响应头配置；保留 |
| `public/apple-touch-icon.png` | B | 180x180；存在配置/源码引用，保留 |
| `public/favicon.ico` | B | 48x48；存在配置/源码引用，保留 |
| `public/icons/16personalities.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/aistudio.google.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/amap.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/app.diagrams.net.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/app/favicon.svg` | S | 页面与 PWA 图标，裁切视框区别于 Logo；保留 |
| `public/icons/app/github.svg` | S | 仓库链接图标；保留 |
| `public/icons/app/logo.svg` | S | README 与界面 Logo，裁切视框区别于 favicon；保留 |
| `public/icons/archive.org.png` | B | 48x48；存在配置/源码引用，保留 |
| `public/icons/arena.ai.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/artificialanalysis.ai.png` | B | 48x48；存在配置/源码引用，保留 |
| `public/icons/artsandculture.google.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/bandcamp.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/behance.net.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/bgsub.cn.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/bilibili.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/browserleaks.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/canva.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/chat.deepseek.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/chat.mistral.ai.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/chatgpt.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/civitai.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/claude.ai.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/colab.research.google.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/cook.yunyoujun.cn.png` | B | 32x32；存在配置/源码引用，保留 |
| `public/icons/coolors.co.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/dash.cloudflare.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/deepl.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/desmos.com.png` | B | 48x48；存在配置/源码引用，保留 |
| `public/icons/discord.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/distrosea.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/douban.com.png` | B | 32x32；存在配置/源码引用，保留 |
| `public/icons/doubao.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/douyin.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/drive.google.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/duck.ai.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/duolingo.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/earth.google.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/emoji/arrows_counterclockwise.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/books.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/cactus.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/carp_streamer.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/clapper.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/closed_umbrella.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/cloud.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/cloud_with_lightning_rain.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/cloud_with_rain.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/cloud_with_snow.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/crescent_moon.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/droplet.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/fog.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/framed_picture.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/gamepad.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/grinning.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/jigsaw.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/leaf_fluttering.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/memo.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/palette.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/robot.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/round_pushpin.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/satellite_antenna.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/satellite_orbital.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/snowflake.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/speech_balloon.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/sun.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/sun_behind_cloud.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/sun_behind_rain_cloud.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/sun_behind_small_cloud.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/sunrise_over_mountains.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/sunset.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/sweat_drops.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/test_tube.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/tornado.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/umbrella.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/umbrella_rain_drops.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/world_map.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emoji/zap.svg` | S | 纯图形 SVG；分类/天气/共用图标映射引用，保留 |
| `public/icons/emojiall.com.png` | B | 120x120；存在配置/源码引用，保留 |
| `public/icons/en.wikipedia.org.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/en.wikivoyage.org.png` | B | 48x48；存在配置/源码引用，保留 |
| `public/icons/excalidraw.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/ezgif.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/facebook.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/filehelper.weixin.qq.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/flightradar24.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/gamma.app.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/gemini.google.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/github.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/grok.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/huggingface.co.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/icloud.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/imdb.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/instagram.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/ip.skk.moe.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/ipcheck.ing.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/it-tools.tech.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/itdog.cn.png` | B | 48x48；存在配置/源码引用，保留 |
| `public/icons/jsfiddle.net.png` | B | 32x32；存在配置/源码引用，保留 |
| `public/icons/kenney.nl.png` | B | 48x48；存在配置/源码引用，保留 |
| `public/icons/kimi.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/lichess.org.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/linkedin.com.png` | B | 64x64；存在配置/源码引用，保留 |
| `public/icons/linux.do.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/linux.vbird.org.png` | B | 16x16；存在配置/源码引用，保留 |
| `public/icons/mail.google.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/maps.google.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/mega.nz.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/mixkit.co.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/msdmanuals.cn.png` | B | 旧书签图标兼容路径，与当前图标同散列；保留 |
| `public/icons/msdmanuals.com.png` | B | 16x16；存在配置/源码引用，保留 |
| `public/icons/music.163.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/music.youtube.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/neal.fun.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/netflix.com.png` | B | 64x64；存在配置/源码引用，保留 |
| `public/icons/notion.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/omgubuntu.co.uk.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/onedrive.live.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/open.spotify.com.png` | B | 48x48；存在配置/源码引用，保留 |
| `public/icons/perplexity.ai.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/personality-database.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/pexels.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/photopea.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/pinterest.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/pixabay.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/pixiv.net.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/playok.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/poki.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/polyhaven.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/publishmarkdown.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/pychess.org.png` | B | 16x16；存在配置/源码引用，保留 |
| `public/icons/qianwen.com.png` | B | 80x80；存在配置/源码引用，保留 |
| `public/icons/quickdraw.withgoogle.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/qwerty.kaiyi.cool.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/radio.garden.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/rateyourmusic.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/reddit.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/roadmap.sh.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/saucenao.com.png` | B | 16x16；存在配置/源码引用，保留 |
| `public/icons/shogiwars.heroz.jp.png` | B | 48x48；存在配置/源码引用，保留 |
| `public/icons/socpk.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/soundcloud.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/soundeffect-lab.info.png` | B | 48x48；存在配置/源码引用，保留 |
| `public/icons/speedtest.net.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/squoosh.app.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/sspai.com.png` | B | 64x64；存在配置/源码引用，保留 |
| `public/icons/steamdb.info.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/stellarium-web.org.png` | B | 30x30；存在配置/源码引用，保留 |
| `public/icons/store.steampowered.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/suno.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/tenor.com.png` | B | 72x72；存在配置/源码引用，保留 |
| `public/icons/time.is.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/tools.pdf24.org.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/trace.moe.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/translate.google.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/twitch.tv.png` | B | 32x32；存在配置/源码引用，保留 |
| `public/icons/unsplash.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/v2ex.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/vercel.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/virustotal.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/vocalremover.org.png` | B | 32x32；存在配置/源码引用，保留 |
| `public/icons/waifu2x.net.png` | B | 16x16；存在配置/源码引用，保留 |
| `public/icons/wallhaven.cc.png` | B | 19x19；存在配置/源码引用，保留 |
| `public/icons/weather.com.cn.png` | B | 32x32；存在配置/源码引用，保留 |
| `public/icons/web.localsend.org.png` | B | 48x48；存在配置/源码引用，保留 |
| `public/icons/web.telegram.org.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/weibo.com.png` | B | 32x32；存在配置/源码引用，保留 |
| `public/icons/wikihow.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/windy.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/x.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/yesicon.app.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/youtube.com.png` | B | 128x128；存在配置/源码引用，保留 |
| `public/icons/zh.wikihow.com.png` | B | 旧书签图标兼容路径，与当前图标同散列；保留 |
| `public/icons/zh.wikipedia.org.png` | B | 旧书签图标兼容路径，与当前图标同散列；保留 |
| `public/icons/zh.wikivoyage.org.png` | B | 旧书签图标兼容路径，与当前图标同散列；保留 |
| `public/licenses/heroicons-MIT.txt` | R | 界面图标许可及产物分发用途；保留 |
| `public/manifest.json` | R | 网页 PWA 入口；保留 |
| `public/robots.txt` | R | 爬虫规则；保留 |
| `public/wallpapers/bg1-thumb.avif` | B | 320x213；存在配置/源码引用，保留 |
| `public/wallpapers/bg1.avif` | B | 2560x1708；存在配置/源码引用，保留 |
| `public/wallpapers/bg2-thumb.avif` | B | 320x214；存在配置/源码引用，保留 |
| `public/wallpapers/bg2.avif` | B | 2560x1709；存在配置/源码引用，保留 |
| `public/wallpapers/bg3-thumb.avif` | B | 320x214；存在配置/源码引用，保留 |
| `public/wallpapers/bg3.avif` | B | 2560x1708；存在配置/源码引用，保留 |
| `public/wallpapers/bg4-thumb.avif` | B | 320x213；存在配置/源码引用，保留 |
| `public/wallpapers/bg4.avif` | B | 2560x1701；存在配置/源码引用，保留 |
| `public/wallpapers/bg5-thumb.avif` | B | 320x213；存在配置/源码引用，保留 |
| `public/wallpapers/bg5.avif` | B | 2560x1707；存在配置/源码引用，保留 |
| `public/wallpapers/bg6-thumb.avif` | B | 320x214；存在配置/源码引用，保留 |
| `public/wallpapers/bg6.avif` | B | 2301x1536；存在配置/源码引用，保留 |
| `public/wallpapers/bg7-thumb.avif` | B | 320x243；存在配置/源码引用，保留 |
| `public/wallpapers/bg7.avif` | B | 2560x1945；存在配置/源码引用，保留 |
| `public/wallpapers/bg8-thumb.avif` | B | 320x213；存在配置/源码引用，保留 |
| `public/wallpapers/bg8.avif` | B | 2560x1707；存在配置/源码引用，保留 |
| `scripts/build-extension.cjs` | R | 网页编译复用、MV3 外置脚本及资源复制；保留 |
| `scripts/build.cjs` | R | 复用首帧注入实现并修正过期错误提示 |
| `scripts/capture-preview.mjs` | R | 双语 README 截图入口；保留 |
| `scripts/html-template.cjs` | R | 唯一插槽检查与替换；保留 |
| `scripts/lint-css.mjs` | R | CSS AST 规则；保留 |
| `scripts/lint-dom.mjs` | R | DOM/类型契约与静态 AST 规则；保留 |
| `scripts/lint-i18n.mjs` | R | 翻译及目录数据契约；保留 |
| `scripts/lint.mjs` | R | 31 项检查入口；保留 |
| `scripts/server.cjs` | R | 复用外层清理模式变量 |
| `scripts/sync-icons.mjs` | R | 复用终端与主机解析、统一实际超时 |
| `scripts/terminal.cjs` | R | 共用终端格式；新增调用方复用，保留 |
| `scripts/validate-w3c.mjs` | R | 发布在线 HTML 校验入口；保留 |
| `scripts/watch.cjs` | R | 开发增量重建；保留 |
| `src/extension/icon128.png` | B | 128×128 PNG；扩展构建复制且 manifest 引用，保留 |
| `src/extension/manifest.json` | R | 扩展新标签页、权限与 CSP 入口；保留 |
| `src/index.html` | R | 删除首帧脚本无用变量 |
| `src/js/config/backgrounds.js` | R | 共享业务或首帧配置，动态引用已核对；保留 |
| `src/js/config/constants.js` | R | 共享业务或首帧配置，动态引用已核对；保留 |
| `src/js/config/engine-head.js` | R | 共享业务或首帧配置，动态引用已核对；保留 |
| `src/js/config/engine-icons.js` | R | 共享业务或首帧配置，动态引用已核对；保留 |
| `src/js/config/engines.js` | R | 共享业务或首帧配置，动态引用已核对；保留 |
| `src/js/config/language.js` | R | 共享业务或首帧配置，动态引用已核对；保留 |
| `src/js/config/locales/catalog-en.json` | R | 127 个书签英文覆盖、13 分类和英文默认入口；保留 |
| `src/js/config/locales/catalog-zh-CN.json` | R | 中文入口覆盖与 legacyUrl 兼容职责；保留 |
| `src/js/config/locales/en.json` | R | 247 个消息，含动态天气/缓存键；保留 |
| `src/js/config/locales/index.js` | R | 由构建生成入口导入；保留 |
| `src/js/config/locales/zh-CN.json` | R | 247 个消息与英文键/参数对应；保留 |
| `src/js/config/themes.js` | R | 共享业务或首帧配置，动态引用已核对；保留 |
| `src/js/config/weather-icons.js` | R | 共享业务或首帧配置，动态引用已核对；保留 |
| `src/js/core/app-wake.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/core/dialogs.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/core/drag-sort.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/core/gestures.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/core/i18n.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/core/lifecycle.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/core/overlay-stack.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/core/screen-input.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/core/screen-state.js` | R | 删除同步准备后恒假的 nr 分支 |
| `src/js/core/service-worker-updates.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/core/theme-engine.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/core/wallpaper-renderer.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/events.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/init.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/main.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/modules/bookmark-editor.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/modules/bookmarks.js` | R | 删除仅供失效样式使用的类名 |
| `src/js/modules/clock.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/modules/search.js` | R | 前轮合并随机书签重复回调；人工复核 |
| `src/js/modules/settings-events.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/modules/settings.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/modules/wallpaper.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/modules/weather.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/state/bookmark-draft.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/state/dom.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/state/store.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/testing/bridge.js` | R | 测试构建专用接口，生产裁除；保留 |
| `src/js/types.d.ts` | R | 页面模型与 DOM 缓存类型契约；保留 |
| `src/js/utils/bookmark-search.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/utils/category-catalog.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/utils/helpers.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/utils/idb.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/utils/transition-cleanup.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/utils/weather-data.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/js/utils/weather-model.js` | R | 模块调用、事件及数据职责有效；保留 |
| `src/styles/animations.css` | R | 动效、减弱动效及动态类均有用途；保留 |
| `src/styles/glass.css` | R | 删除无匹配节点的弹窗悬停覆盖 |
| `src/styles/main.css` | R | 删除侧栏标签无效变换规则 |
| `src/svg/sprite.svg` | S | 13 个符号均有消费者；容器 ID 用于标识，保留 |
| `start.command` | R | macOS 构建及清理预览入口；保留 |
| `sw.js` | R | 缓存、更新、迁移和恢复各路径有职责；保留 |
| `test/benchmark-transition.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/data-animation-cleanup-unit.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/data-audit-fixes.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/data-audit-regressions.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/data-bookmark-catalog.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/data-bookmark-picker.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/data-features.test.mjs` | R | 删除嵌入脚本无用 cb2Name |
| `test/data-i18n-unit.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/data-i18n.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/data-priority-fixes-unit.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/data-pure-models.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/data-request-performance.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/data-settings-save.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/data-wallpaper-rendering.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/data-wallpaper-selection-unit.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/data-wallpaper-storage.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/data-wallpaper-theme.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/data-weather-hydration.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/infra-chrome-extension.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/infra-icon-normalization.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/infra-icon-sync.test.mjs` | R | 前轮补齐临时 CLI 的共用依赖；人工复核 |
| `test/infra-module-boundaries.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/infra-security.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/infra-sw-request-performance.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/infra-sw-update-ui.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/infra-sw-upgrade.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/infra-theme-favicon.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/lifecycle-behavior.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/lifecycle-fingerprint.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/run.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/support/cdp.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/support/helpers.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/support/server.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/support/test-selection.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/types/contracts.js` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/ui-input-device-performance.test.mjs` | R | 删除 CI 已退出后不可达的媒体属性补丁 |
| `test/ui-modal-accessibility.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/ui-nav-rendering.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/ui-overlay-modals.test.mjs` | R | 删除无用 sTy 及计算样式读取 |
| `test/ui-rendered-contracts.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/ui-rendering-performance.test.mjs` | R | 删除不可达 CI 阈值与守卫，保留实际门禁 |
| `test/ui-responsive-layout.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/ui-screen-boundaries.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/ui-screen-gestures.test.mjs` | R | 现有回归/辅助职责及调用有效；保留 |
| `test/verify-local-icons.mjs` | R | 复用终端、删除失效选择器及过期夸大输出 |
| `test/visual-regression.mjs` | R | 移除单目录数组与循环 |
| `tsconfig.json` | R | 页面/Worker 类型检查范围及继承有效；保留 |
| `tsconfig.sw.json` | R | 页面/Worker 类型检查范围及继承有效；保留 |
| `wrangler.jsonc` | R | dist 静态部署入口；保留 |

# 67 项测试的重复与过时契约审查

日期：2026-11-01。基线：`6e8a4b5`，包含工作区待提交的 5.4.6 版本号更新。本轮只调整测试与本报告，不修改应用实现。

## 计数与审查方法

逐份阅读 `test/` 顶层 37 个 `.test.mjs` 文件，按触发入口、执行环境、故障阶段和断言结果比较，而非只按名称判断重复。运行器报告的 67 项由具名 `test()` 和整文件入口共同组成；`makeTester().pass()` 以及部分顶层断言不会分别增加这个数字。下表编号按文件名和文件内声明顺序生成，用于完整映射，非并发完成顺序。

结论：没有确认可整份废弃的测试文件。保留 67 个运行入口；精简重复或无效检查，撤除指纹裁决测试的 HTTP/Chrome 会话。七份测试/辅助文件合计净减少 67 行，不将版本号和本报告计入精简数字。

## 已完成的精简

| 位置 | 证据 | 处理与剩余覆盖 |
| :--- | :--- | :--- |
| `data-features` 的 JSONP 防竞态块 | 新查询已删除旧回调时，`if (typeof oldCallback === 'function')` 跳过执行，结果仍判成功；请求序号递增属于内部实现 | 删除该弱块。`data-request-performance` 保留真实旧函数引用并调用；`data-audit-regressions` 还执行旧错误处理并验证新脚本和回调未被清除。天气胶囊点击/关闭/ARIA 保留。 |
| `data-features` 的预设主题块 | 重复在综合会话收集主题，专项已逐张验证冷/暖启动与运行时 | 将固定八张、交替深浅及固定颜色断言集中到 `infra-theme-favicon`；配置变化与首帧一致性检查同时保留。不是将固定映射断言直接丢弃。 |
| `data-features` 的 `xssFired` | 输入只交给 `escapeHtml()`，并未插入页面；检查未设置的全局标志不能证明阻止了脚本执行 | 删除无效标志。保留转义输出、URL 过滤断言和其他文件的真实 DOM 数据边界测试，不将纯字符串检查描述为真实注入攻击验证。 |
| `ui-screen-boundaries` 默认时长断言 | 紧随其后的循环已验证 `classic` 与 `sheet` 的两屏时长、曲线及 JS 兜底上限 | 删除只检查默认 `sheet` 的第二份断言，保留循环。 |
| `infra-security` 防嵌套检查 | 原测试维护一份正则和一份手抄 JS，执行的是手抄副本 | 提取并执行源码及构建 HTML 的实际脚本，分别断言允许跳出和跨域受限隐藏，减少实现副本。VM 验证脚本分支，不声称是真实 iframe 浏览器验证。 |
| `lifecycle-fingerprint` | 浏览器启动后只调用指纹函数，函数仅使用会话存储和时间 | esbuild 编译真实模块，在 VM 中提供存储边界；保留同版、跨版、写冷却标记、再次阻止刷新与缺省跳过。实际应用/worker 升级由浏览器专项覆盖。 |
| `test-selection` | `data-i18n-unit` 已完全不依赖 DOM/产物；指纹测试改造后同样如此 | 两者加入已有纯单元清单，单独筛选时跳过产物构建，并纳入 `test:unit`；混合选择仍要求构建。 |
| `data-audit-fixes` 与旧说明 | 一个草稿 JSON 快照没有任何消费者；部分说明仍描述旧状态缓存或旧回填行为 | 删除无用快照，修正文案及非迁移用例中的旧日落字段；明确缺少日期的旧预报标签是兼容性测试，继续保留。 |

## 逐项映射与处理依据

链接维护（2026-11-06）：下表保留审计当日的文件名和用例描述，链接指向后来合并后的现有测试。原 `data-features` 已按书签与天气拆至 `data-bookmarks-features` 和 `data-weather-features`；其表格链接指向书签部分。

每项“保留”均表示本轮未找到可无损删除的重复项，不表示不存在任何交叉断言。综合入口的说明覆盖其内部主要场景。

| 编号 | 文件 / 用例 | 处理及依据 |
| :--- | :--- | :--- |
| 1 | [data-animation-cleanup-unit.test.mjs](../../test/data-animation-cleanup-unit.test.mjs)：删除只消费自身 opacity 事件；取消、减弱动效或事件缺失均删除占位行 | 保留；可控事件、计时器与 rAF 验证收尾所有权，真实浏览器难以稳定制造这些顺序。 |
| 2 | [data-animation-cleanup-unit.test.mjs](../../test/data-animation-cleanup-unit.test.mjs)：排序忽略子元素和其他属性的事件，取消时清除样式及待执行 rAF | 保留；可控事件、计时器与 rAF 验证收尾所有权，真实浏览器难以稳定制造这些顺序。 |
| 3 | [data-animation-cleanup-unit.test.mjs](../../test/data-animation-cleanup-unit.test.mjs)：新排序和删除接管旧 FLIP，旧收尾不能清除新动效 | 保留；可控事件、计时器与 rAF 验证收尾所有权，真实浏览器难以稳定制造这些顺序。 |
| 4 | [data-animation-cleanup-unit.test.mjs](../../test/data-animation-cleanup-unit.test.mjs)：新图片加载或解码失败不阻断旧淡入的 rAF、计时器及图层收尾 | 保留；可控事件、计时器与 rAF 验证收尾所有权，真实浏览器难以稳定制造这些顺序。 |
| 5 | [data-animation-cleanup-unit.test.mjs](../../test/data-animation-cleanup-unit.test.mjs)：较新壁纸完成后，旧淡入回调不能覆盖它 | 保留；可控事件、计时器与 rAF 验证收尾所有权，真实浏览器难以稳定制造这些顺序。 |
| 6 | [data-audit-fixes.test.mjs](../../test/data-audit-regressions.test.mjs)：迁移、导入、保存故障和触摸排序集成（整文件入口） | 精简一个未消费快照；保留迁移两键失败、导入会话隔离、部分重置、真实离线与多指拖拽。 |
| 7 | [data-audit-regressions.test.mjs](../../test/data-audit-regressions.test.mjs)：数据边界、建议激活、空草稿和迟到响应集成（整文件入口） | 保留；存储读取、DOM 篡改不影响模型激活、空草稿、键盘排序、JSONP/CORS 迟到回调及损坏缓存启动。 |
| 8 | [data-bookmark-catalog.test.mjs](../../test/data-bookmark-picker.test.mjs)：目录索引与简介继承/清空集成（整文件入口） | 保留；目录完整 URL 与搜索身份不同，缺省简介和显式空串经导入、导出、重载后仍不同。 |
| 9 | [data-bookmark-picker.test.mjs](../../test/data-bookmark-picker.test.mjs)：目录图标复用与过期预览请求 | 保留；目录索引单元验证不能代替真实图片节点、焦点控件、防抖取消与挑选器禁用状态。 |
| 10 | [data-bookmark-picker.test.mjs](../../test/data-bookmark-picker.test.mjs)：挑选器节点复用与目录失效 | 保留；目录索引单元验证不能代替真实图片节点、焦点控件、防抖取消与挑选器禁用状态。 |
| 11 | [data-features.test.mjs](../../test/data-bookmarks-features.test.mjs)：搜索、书签持久化、天气交互与唤醒综合（整文件入口） | 精简重复主题采样与弱 JSONP 检查、无效 XSS 标志；保留搜索集成、成功迁移、天气控件、旧标签和唤醒装配。 |
| 12 | [data-i18n-unit.test.mjs](../../test/data-i18n-unit.test.mjs)：explicit language, browser priority, Chinese variants and invalid preferences | 保留并纳入纯单元清单；语言解析、参数替换、日期与目录身份不需要构建产物或浏览器。 |
| 13 | [data-i18n-unit.test.mjs](../../test/data-i18n-unit.test.mjs)：complete messages, singular/plural, one-pass parameters and fallback | 保留并纳入纯单元清单；语言解析、参数替换、日期与目录身份不需要构建产物或浏览器。 |
| 14 | [data-i18n-unit.test.mjs](../../test/data-i18n-unit.test.mjs)：Chinese date separates weekday while English and forecast labels keep native formatting | 保留并纳入纯单元清单；语言解析、参数替换、日期与目录身份不需要构建产物或浏览器。 |
| 15 | [data-i18n-unit.test.mjs](../../test/data-i18n-unit.test.mjs)：catalog translation uses stable identity without mutating original defaults | 保留并纳入纯单元清单；语言解析、参数替换、日期与目录身份不需要构建产物或浏览器。 |
| 16 | [data-i18n.test.mjs](../../test/data-i18n.test.mjs)：中英文全站、首帧、持久化与离线综合（整文件入口） | 保留；实际语言保存/取消、首帧翻译、用户文字继承、不同语言目标 URL、英文布局和离线切换。 |
| 17 | [data-priority-fixes-unit.test.mjs](../../test/data-priority-fixes-unit.test.mjs)：首次定位失败不请求默认城市天气，旧版兜底缓存也不能复用 | 保留；网络正文超时、旧缓存转换、上传读取/压缩/解码各故障与取消时机分别覆盖独立边界。 |
| 18 | [data-priority-fixes-unit.test.mjs](../../test/data-priority-fixes-unit.test.mjs)：强制重新定位失败后沿用成功位置，仍可获取新天气，包括真实定位到上海 | 保留；网络正文超时、旧缓存转换、上传读取/压缩/解码各故障与取消时机分别覆盖独立边界。 |
| 19 | [data-priority-fixes-unit.test.mjs](../../test/data-priority-fixes-unit.test.mjs)：天气正文超时结束共享刷新任务，随后可重新刷新 | 保留；网络正文超时、旧缓存转换、上传读取/压缩/解码各故障与取消时机分别覆盖独立边界。 |
| 20 | [data-priority-fixes-unit.test.mjs](../../test/data-priority-fixes-unit.test.mjs)：旧缓存时间字段在读取边界转换，渲染沿用统一字段 | 保留；网络正文超时、旧缓存转换、上传读取/压缩/解码各故障与取消时机分别覆盖独立边界。 |
| 21 | [data-priority-fixes-unit.test.mjs](../../test/data-priority-fixes-unit.test.mjs)：预报图标或描述独立变化更新界面，相同内容仍复用 | 保留；网络正文超时、旧缓存转换、上传读取/压缩/解码各故障与取消时机分别覆盖独立边界。 |
| 22 | [data-priority-fixes-unit.test.mjs](../../test/data-priority-fixes-unit.test.mjs)：读取中的旧上传不能覆盖后选预设，保存等待新上传处理和落盘 | 保留；网络正文超时、旧缓存转换、上传读取/压缩/解码各故障与取消时机分别覆盖独立边界。 |
| 23 | [data-priority-fixes-unit.test.mjs](../../test/data-priority-fixes-unit.test.mjs)：解码中的旧上传、旧错误回调不能覆盖新上传或重置 | 保留；网络正文超时、旧缓存转换、上传读取/压缩/解码各故障与取消时机分别覆盖独立边界。 |
| 24 | [data-priority-fixes-unit.test.mjs](../../test/data-priority-fixes-unit.test.mjs)：读取或压缩失败结束保存等待，重新选择可恢复 | 保留；网络正文超时、旧缓存转换、上传读取/压缩/解码各故障与取消时机分别覆盖独立边界。 |
| 25 | [data-priority-fixes-unit.test.mjs](../../test/data-priority-fixes-unit.test.mjs)：取消设置终止读取或处理中的上传，迟到回调不渲染或保存 | 保留；网络正文超时、旧缓存转换、上传读取/压缩/解码各故障与取消时机分别覆盖独立边界。 |
| 26 | [data-pure-models.test.mjs](../../test/data-pure-models.test.mjs)：低降水概率且当前无雨时平滑预报，高降水概率保留雨天预报 | 保留；真实纯函数与草稿模型。部分断言在 test() 外执行，运行器数字不能表示全部断言量。 |
| 27 | [data-pure-models.test.mjs](../../test/data-pure-models.test.mjs)：昼夜及未知天气代码保留原有图标回退 | 保留；真实纯函数与草稿模型。部分断言在 test() 外执行，运行器数字不能表示全部断言量。 |
| 28 | [data-pure-models.test.mjs](../../test/data-pure-models.test.mjs)：地名合并重复行政区，保留同名省市并消除前缀重复 | 保留；真实纯函数与草稿模型。部分断言在 test() 外执行，运行器数字不能表示全部断言量。 |
| 29 | [data-request-performance.test.mjs](../../test/data-request-performance.test.mjs)：搜索与天气请求去重和竞态集成（整文件入口） | 保留；请求合并、空缓存、防抖窗口和重新定位共享任务；真正持有并调用旧 JSONP 回调。 |
| 30 | [data-settings-save.test.mjs](../../test/data-settings-save.test.mjs)：保存事务、失败回滚、取消和缓存清理集成（整文件入口） | 保留；设置保存总流程、读/写/中止期间锁定、两键回滚、取消重开、带参数 URL 节点复用与 scope 清理。 |
| 31 | [data-wallpaper-rendering.test.mjs](../../test/data-wallpaper.test.mjs)：解码、迟到结果隔离与上传压缩 | 保留；浏览器实际 Image.decode、canvas JPEG 压缩、图片复用和淡入，区别于选择层的可控边界桩。 |
| 32 | [data-wallpaper-rendering.test.mjs](../../test/data-wallpaper.test.mjs)：共享加载、图片复用与失败重试 | 保留；浏览器实际 Image.decode、canvas JPEG 压缩、图片复用和淡入，区别于选择层的可控边界桩。 |
| 33 | [data-wallpaper-selection-unit.test.mjs](../../test/data-wallpaper-selection-unit.test.mjs)：同一网络壁纸只创建和解码一张图片，预览、渲染及并发保存共用结果 | 保留；选择任务/写队列去重、首次默认保存、其他标签改写、故障重试及迟到解码可被精确调度。 |
| 34 | [data-wallpaper-selection-unit.test.mjs](../../test/data-wallpaper-selection-unit.test.mjs)：重复预设选择跳过 IDB 与轻量提示写入，首次默认选择仍会落盘 | 保留；选择任务/写队列去重、首次默认保存、其他标签改写、故障重试及迟到解码可被精确调度。 |
| 35 | [data-wallpaper-selection-unit.test.mjs](../../test/data-wallpaper-selection-unit.test.mjs)：其他标签改写后再次选择会重新保存，不错误命中内存去重 | 保留；选择任务/写队列去重、首次默认保存、其他标签改写、故障重试及迟到解码可被精确调度。 |
| 36 | [data-wallpaper-selection-unit.test.mjs](../../test/data-wallpaper-selection-unit.test.mjs)：网络或解码失败释放任务，重试能重新准备并保存 | 保留；选择任务/写队列去重、首次默认保存、其他标签改写、故障重试及迟到解码可被精确调度。 |
| 37 | [data-wallpaper-selection-unit.test.mjs](../../test/data-wallpaper-selection-unit.test.mjs)：存储失败可重试；重试复用已准备的网络图片 | 保留；选择任务/写队列去重、首次默认保存、其他标签改写、故障重试及迟到解码可被精确调度。 |
| 38 | [data-wallpaper-selection-unit.test.mjs](../../test/data-wallpaper-selection-unit.test.mjs)：旧网络图片解码迟到或被重置，不触发渲染或持久化 | 保留；选择任务/写队列去重、首次默认保存、其他标签改写、故障重试及迟到解码可被精确调度。 |
| 39 | [data-wallpaper-selection-unit.test.mjs](../../test/data-wallpaper-selection-unit.test.mjs)：预设加载失败保留此前记录，恢复后可以重试 | 保留；选择任务/写队列去重、首次默认保存、其他标签改写、故障重试及迟到解码可被精确调度。 |
| 40 | [data-wallpaper-storage.test.mjs](../../test/data-wallpaper-storage.test.mjs)：选择提交、事务失败与会话隔离 | 保留；原生 IDB 请求成功后事务中止、IDB 禁用、延迟恢复及旧 LS/IDB 迁移，不可用内存桩代替。 |
| 41 | [data-wallpaper-storage.test.mjs](../../test/data-wallpaper-storage.test.mjs)：历史壁纸迁移与新选择优先级 | 保留；原生 IDB 请求成功后事务中止、IDB 禁用、延迟恢复及旧 LS/IDB 迁移，不可用内存桩代替。 |
| 42 | [data-wallpaper-theme.test.mjs](../../test/data-wallpaper.test.mjs)：自定义壁纸采样与裁切（整文件入口） | 保留；真实图片顶栏/环境色采样和 cover 裁切，预设主题配置测试不覆盖此转换。 |
| 43 | [data-weather-hydration.test.mjs](../../test/data-weather-features.test.mjs)：首帧与运行时天气数值呈现一致（整文件入口） | 保留；同一坏数值在首帧 VM 与 Chrome 运行时呈现一致。features 中的 weatherTime 等其他边界仍独有。 |
| 44 | [infra-chrome-extension.test.mjs](../../test/infra-chrome-extension.test.mjs)：Chrome 扩展构建与真实加载（整文件入口） | 保留；真实 MV3 构建、加载及 CSP、无 SW、不同搜索传输和扩展离线存储，网页版不能代替。 |
| 45 | [infra-icon-normalization.test.mjs](../../test/infra-icon-sync.test.mjs)：图标规范化工具（整文件入口） | 保留；实际 sips 等比缩放与填充、坏输入和转换失败；CLI 同步测试不逐项断言这些尺寸。 |
| 46 | [infra-icon-sync.test.mjs](../../test/infra-icon-sync.test.mjs)：图标同步 CLI（整文件入口） | 保留；完整 CLI 的复用、修复、refresh、官方源、下载失败及临时文件清理。 |
| 47 | [infra-module-boundaries.test.mjs](../../test/infra-module-boundaries.test.mjs)：模块依赖、生产隔离与测试桥接（整文件入口） | 保留；静态依赖图、生产无测试桥接、篡改测试标记、实时访问器与跨月同日时钟修复。 |
| 48 | [infra-security.test.mjs](../../test/infra-security.test.mjs)：构建产物、安全、FIFO 和安装边界（整文件入口） | 精简手抄实现与精确正则；改执行源码和产物中的防嵌套脚本。其余产物/响应头/FIFO/安装资源检查保留。 |
| 49 | [infra-sw-request-performance.test.mjs](../../test/infra-sw-request-performance.test.mjs)：Worker 并发下载与缓存写入窗口（整文件入口） | 保留；实际 worker 并发响应、单消费者取消与头差异，另用 VM 控制响应后/写缓存前窗口。 |
| 50 | [infra-sw-update-ui.test.mjs](../../test/infra-sw-update-ui.test.mjs)：应用更新通知与用户确认（整文件入口） | 保留；应用通知、用户确认、草稿保护、多标签各自升级与 waiting 修补失败重试。 |
| 51 | [infra-sw-upgrade.test.mjs](../../test/infra-sw-upgrade.test.mjs)：Worker 升级、scope 隔离与离线恢复（整文件入口） | 保留；worker 安装完整性、指纹校验、ETag、自然激活、scope 归属、离线恢复；不是通知 UI 测试。 |
| 52 | [infra-theme-favicon.test.mjs](../../test/infra-theme-favicon.test.mjs)：主题配置、图标回退与缓存驱逐 | 集中预设数量、交替深浅和固定颜色断言；保留首帧/运行时、图标回退/驱逐及 worker 图像导航。 |
| 53 | [infra-theme-favicon.test.mjs](../../test/infra-theme-favicon.test.mjs)：Service Worker 下直接导航到应用图标 | 集中预设数量、交替深浅和固定颜色断言；保留首帧/运行时、图标回退/驱逐及 worker 图像导航。 |
| 54 | [lifecycle-behavior.test.mjs](../../test/lifecycle.test.mjs)：唤醒与真实 BFCache 恢复（整文件入口） | 保留；两种 CSS 策略下真实 BFCache 历史往返与两屏恢复；合成 pageshow 不足以代替。 |
| 55 | [lifecycle-fingerprint.test.mjs](../../test/lifecycle.test.mjs)：构建指纹裁决与刷新冷却（整文件入口） | 改为执行真实模块的无浏览器验证，保留原有裁决与存储冷却断言，纳入纯单元清单。 |
| 56 | [ui-input-device-performance.test.mjs](../../test/ui-input-device-performance.test.mjs)：原生触摸与鼠标能力切换（整文件入口） | 保留；CDP 原生触屏默认滚动、临时阻塞监听和媒体能力切换，合成 TouchEvent 无原生默认行为。 |
| 57 | [ui-modal-accessibility.test.mjs](../../test/ui-modal-accessibility.test.mjs)：焦点循环、嵌套弹窗与背景隔离 | 保留；真实 AX 树、三层焦点恢复、快速开关、动画阶段、inert 写入去重与基础状态更新。 |
| 58 | [ui-modal-accessibility.test.mjs](../../test/ui-modal-accessibility.test.mjs)：隔离增量更新与基础状态恢复 | 保留；真实 AX 树、三层焦点恢复、快速开关、动画阶段、inert 写入去重与基础状态更新。 |
| 59 | [ui-nav-rendering.test.mjs](../../test/ui-nav-rendering.test.mjs)：图标空闲准备与延迟加载 | 保留；空闲预加载、位置缓存失效、原生滚动的合成层阻塞区及切屏清理，非静态图标存在性检查。 |
| 60 | [ui-nav-rendering.test.mjs](../../test/ui-nav-rendering.test.mjs)：分类位置缓存与侧栏高亮 | 保留；空闲预加载、位置缓存失效、原生滚动的合成层阻塞区及切屏清理，非静态图标存在性检查。 |
| 61 | [ui-nav-rendering.test.mjs](../../test/ui-nav-rendering.test.mjs)：原生滚动与事件阻塞区域 | 保留；空闲预加载、位置缓存失效、原生滚动的合成层阻塞区及切屏清理，非静态图标存在性检查。 |
| 62 | [ui-overlay-modals.test.mjs](../../test/ui-overlay-modals.test.mjs)：浮层、焦点、联想、唤醒和移动侧栏综合（整文件入口） | 保留；Tab/Shift+Tab 回绕、多个实际按钮的 ARIA、引擎白名单、点击反馈/失焦悬停与移动侧栏。 |
| 63 | [ui-rendered-contracts.test.mjs](../../test/ui-rendered-contracts.test.mjs)：动态 DOM、几何布局与材质降级（整文件入口） | 保留；真实布局几何、动态按钮类型、弹窗栈一致性、外观页和两种玻璃降级下的文字对比度。 |
| 64 | [ui-rendering-performance.test.mjs](../../test/ui-rendering-performance.test.mjs)：光斑绘制和拖拽节点更新（整文件入口） | 保留；Chrome trace Paint/Layout、光斑合成与拖拽零写入，常规交互测试不测绘制开销。 |
| 65 | [ui-responsive-layout.test.mjs](../../test/ui-responsive-layout.test.mjs)：跨分辨率布局动画限制（整文件入口） | 保留；十场景十二次断点切换检查实际动画属性，区别于布局是否对齐/溢出的几何检查。 |
| 66 | [ui-screen-boundaries.test.mjs](../../test/ui-screen-boundaries.test.mjs)：双屏手势与状态机边界（整文件入口） | 删除仅检查默认 sheet 时长的重复断言，保留两种模式遍历；保留惯性/到顶/互斥/兜底等边界。 |
| 67 | [ui-screen-gestures.test.mjs](../../test/ui-screen-gestures.test.mjs)：基本切屏、键盘与触屏手势（整文件入口） | 保留；基本状态、盲打、原生键盘连续滚动、输入保护、flick 与两屏横向手势，区别于到顶惯性边界。 |

## 保留的重叠及验证边界

- **单元与浏览器**：可控读取/解码/存储故障，不能替代原生 IDB 事务、真实 canvas、AX 树、原生滚动或扩展 CSP。未因为它们都提到“取消”或“重试”而删除。
- **浮层的两组测试**：`ui-overlay-modals` 独有 Tab/Shift+Tab 回绕、多个业务按钮 ARIA 和触发事件装配；`ui-modal-accessibility` 独有 AX 树、动画阶段、三层逐级恢复和 inert 增量写入，两者保留。
- **生命周期**：合成 pageshow 用于在同一任务内打断过渡；`lifecycle-behavior` 实际导航离开再历史返回并验证 BFCache 文档身份；不能互相取代。
- **Service Worker**：安装完整性/自然激活、应用通知/用户确认、并发传输/缓存窗口、缺缓存恢复分别有消费者与故障窗口，继续分开。
- **旧格式**：旧书签、旧 LS/IDB 壁纸、旧天气时间及缺代码/日期预报仍被读取边界兼容；当前应用支持这些数据，因此测试并未废弃。
- **环境限制**：两个输入/绘制性能文件在 `CI` 环境直接退出，两个图标工具在无 `sips` 时直接退出。这会被 Node 计为文件通过，不能从“0 skipped”推断这些场景在所有平台执行。本轮为本地 macOS/Chrome，相关用例确实运行；未扩大本次精简范围去重写跨平台跳过协议。
- **综合用例粒度**：仍有长文件将多个功能汇总为一个运行入口，不能以减少“67”这个数为目标删文件。若未来需要更细的失败定位，可在实际维护对应模块时调整；本轮不引入统一测试框架或拆分脚手架。

## 本轮验证

- `npm run lint`：31 项通过。
- `npm test`：包含页面/Worker 类型检查及网页、扩展构建；首轮 66/67 通过，唯一失败为本轮 `infra-security` 改写漏导入 `assert`。补齐后，复用本轮构建运行 `node --test test/infra-security.test.mjs test/infra-theme-favicon.test.mjs`，3/3 通过（security 内部 9 项亦通过）。其余通过项未重复执行。
- 直接检查测试选择函数：两份新增纯单元文件不要求构建；浏览器测试和混合选择仍要求构建，通过。
- `git diff --check` 与报告本地文件链接检查通过。
- 没有应用行为改动，不重复执行 W3C、图标渲染或视觉专项；无必要但未完成的验证、环境阻塞或遗留失败。本次未提交或推送。

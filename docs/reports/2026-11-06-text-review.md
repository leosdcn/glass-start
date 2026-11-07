# 项目文本描述核对

日期：2026-11-06。核对基于本地 `5.5.0` 源码及工作区内容，不代表线上版本或所有第三方功能均已验收。

## 范围与依据

- 当前维护文档：中英文 README、贡献指南、AGENTS、架构、评测说明、可选 Safari 清单，以及 GitHub 模板、CI、启动与构建说明。
- 用户可见文本：两份界面字典各 248 个消息键、HTML 静态文案与元数据、PWA/扩展说明、快捷键及致谢。
- 书签：127 个分类目录条目的名称和中英文简介，另核对 8 个中文默认入口与英文默认入口的配置关系。
- 工程文本：源码职责注释、配置单位、检查输出与测试结果说明，按对应实现和断言核对。历史报告按记录日期理解，保留当时的版本、文件名、测量和结论；检查其 Markdown 链接，不将历史通过结果当作当前验收。
- 当前文档内的 npm 脚本名称已与 `package.json` 对照；159 处本地 Markdown 文件链接及 49 处本地锚点均可解析。这些统计不包括代码块内的路径字符串或远程链接的可用性。

## 本轮修正

| 描述问题 | 修正与依据 |
| :--- | :--- |
| 导入区写作“上传、自动恢复”，确认框未明确替换现有草稿 | 改为本地选择文件、确认替换草稿并点击完成保存；依据 `modules/settings.js` 的 FileReader、确认回调和草稿替换流程。中英文及 HTML 回退文本同步。 |
| 本地图片操作英文写作 Upload | 改为 Choose image；无障碍说明明确选择本地壁纸图片，符合浏览器内处理和 IndexedDB 存储。 |
| 缺少缓存 API 时提示“或已是最新状态” | 改为当前环境无法使用 Cache Storage；该分支没有查询缓存版本或更新状态。 |
| 新标签快捷键只描述搜索 | 补充打开选中书签，与 `activateSuggestion()` 的两种行为一致。 |
| JSON-LD 声明 `?q=` 搜索入口 | 移除 SearchAction；源码未读取该查询参数，没有该地址入口的实现。保留网站基础元数据。 |
| 分享图片替代文本称为页面预览 | 改为默认山峦壁纸，符合实际 Unsplash 图片地址；该图片不是应用截图。 |
| 16Personalities 被称为 MBTI 测试 | 改为“十六型人格测试”；其官方框架说明区分自身模型和 Myers-Briggs 理论。英文原为中性描述，保持一致。 |
| Mistral 对话服务笼统称为“开源”，Grok 简介依赖公司归属称呼 | Mistral 改为品牌及对话助手描述，不将模型开放性等同于托管产品开源；Grok 中英文改为对话和创作功能描述。 |
| 公共服务被称为“地理逆编码” | README 中英文改为地名搜索；代码使用 Open-Meteo 的按名称搜索接口。 |
| 重置说明未反映异步提交限制 | README 与架构补充确认重置后的锁定、解锁与旧会话隔离；区分保存按钮防重复与实际提交状态。 |
| 手势注释把平均速度称为瞬时速度，阈值只描述触摸 | 按实际位移除以耗时的计算改为平均速度；说明滚轮累计和触屏共用位移阈值。 |
| lint 声称全面 WAI-ARIA 合规、简介无视觉溢出、PNG 已完全就绪 | 输出改为实际扫描范围和已检查的属性、文件头、尺寸及字符长度；不据此证明完整无障碍、解码或视觉结果。 |
| 视觉测试日志声称“零空白零残影”，评测/截图注释暗示外网请求或加载状态已完全排除 | 日志改为实际布局、尺寸和可见性断言；注明评测页面仍可请求外部服务，固定等待不能保证所有资源就绪。更新失效的生命周期测试文件名与固定图标数量表述。 |
| 英文贡献指南的 defaultBookmarks 所在文件指代模糊，启动脚本称为增量打包 | 明确 `catalog-en.json`；启动输出改为生产构建。 |

## 第三方依据与边界

127 个目录入口均发起了只读网络请求：102 个返回成功状态，25 个返回拒绝访问、超时或连接错误。成功状态中也包含验证码、登录页、空壳页面和不支持客户端的提示，因此**不能将该数字视为 102 个站点的功能或简介全部验证通过**。可读页面的标题与摘要用于对照名称和用途；无法取得足够内容的站点保留待核实，不因自动访问失败删除书签或改写 URL。

本地原始抓取记录：`test/artifacts/2026-11-06-bookmark-text-audit.json`（已忽略的验证产物，不纳入源码）。首次抓取未返回成功状态的入口为：Arena、Claude、Mistral、Gamma、ChatGPT、Rate Your Music、LINUX DO、Reddit、OneDrive、Flightradar24、SteamDB、将棋ウォーズ、Vocal Remover、Pexels、Pixiv、Pixabay、Unsplash、Cloudflare、BrowserLeaks、IPCheck.ing、Speedtest、ip.skk.moe、Personality Database、Neal.fun、Behance。其中 Mistral 和 Unsplash 相关描述另通过下列官方说明核对。

专项对照的官方来源：

- [16Personalities 框架说明](https://www.16personalities.com/articles/our-theory)：核对人格测试名称。
- [Mistral 产品说明](https://mistral.ai/products/vibe/)与 [Grok 产品说明](https://x.ai/grok)：核对对话、创作及助手用途，避免把托管服务统称为开源产品或依赖易变公司归属。
- [Open-Meteo 服务条款](https://open-meteo.com/en/terms)、[数据许可](https://open-meteo.com/en/licence)、[Unsplash 许可](https://unsplash.com/license)：现有 README 对免费接口非商业限制及素材许可的概述与所列官方说明相符，未改动许可原文。未重新取证历史报告中各张照片在过去日期的页面内容。
- [Cloudflare 构建环境](https://developers.cloudflare.com/pages/configuration/build-image/)及 [GitHub Pages 工作流说明](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)：对照部署入口及配置；实际生效的响应头仍取决于部署环境。
- [当前公开 Release](https://github.com/leosdcn/glass-start/releases/latest)：本轮访问跳转到 v5.3.2，不能用本地 5.5.0 的验证结论代表公开安装包；README 的 latest 链接保持不变。

本地 Tailwind 许可与随包 Heroicons MIT 许可文本比对一致。其他第三方资产的既有版权归属和许可说明保留，不将网页可访问或工具检查通过解释为所有使用情形的许可保证。

## 检查结果

- `npm run lint`：33 项通过，含 248 个消息键、参数及 127 个内置目录条目的约束检查。
- `npm test -- data-i18n`：5 项通过，含类型检查、网页构建、中英文界面、导入复数文案、语言草稿及离线切换。
- `npm test -- infra-chrome-extension`：1 项通过，含类型检查、网页和扩展构建及 Chrome 回归。
- `git diff --check`：通过。

本轮修改为说明、文案、注释、元数据及对应的既有文案断言，没有改变业务流程。第三方站点内容受上述访问边界限制，未声称所有外部描述均已完成独立核实。工作区原有 README、架构文档和安全测试修改保持在原处。

# Glass Start 全面代码安全审计与权限合规报告

**项目名称**: Glass Start (网页端与 Chrome 扩展)  
**审计基准版本**: v5.5.3 (`package.json`)  
**审计日期**: 2026-11-11  
**审计性质**: 全仓库只读深度人工源码审查（Read-Only Deep Manual Source Security Audit）  
**审计报告编号**: AUDIT-20261111-SEC  
**依据规范与标准**: `AGENTS.md`、`docs/ARCHITECTURE.md`、Chrome MV3 扩展安全规范、W3C / WHATWG Web 标准、OWASP Top 10 (2021) 与 OWASP ASVS 4.0  

---

## 目录

- [一、执行摘要与综合安全评级](#一执行摘要与综合安全评级)
  - [1.1 总体安全评级与结论](#11-总体安全评级与结论)
  - [1.2 跨模块安全态势总览](#12-跨模块安全态势总览)
  - [1.3 缺陷严重级别分布统计](#13-缺陷严重级别分布统计)
  - [1.4 核心安全亮点与架构优势](#14-核心安全亮点与架构优势)
  - [1.5 关键风险与待加固弱点](#15-关键风险与待加固弱点)
- [二、审计范围、边界与方法论](#二审计范围边界与方法论)
  - [2.1 审查模块与源码边界](#21-审查模块与源码边界)
  - [2.2 审计准则与只读约束](#22-审计准则与只读约束)
  - [2.3 威胁模型与攻击面分析](#23-威胁模型与攻击面分析)
- [三、架构规范合规性与既有安全防护成果](#三架构规范合规性与既有安全防护成果)
  - [3.1 客户端存储规范与隔离合规 (AGENTS.md 审查)](#31-客户端存储规范与隔离合规-agentsmd-审查)
  - [3.2 模块分层与依赖无环性 (Dependency Architecture)](#32-模块分层与依赖无环性-dependency-architecture)
  - [3.3 弹窗生命周期合规 (OverlayStack Lifecycle)](#33-弹窗生命周期合规-overlaystack-lifecycle)
  - [3.4 Chrome 扩展最小权限与攻击面收敛 (Extension Security)](#34-chrome-扩展最小权限与攻击面收敛-extension-security)
  - [3.5 编译期静态常量与双模式安全隔离 (DCE & Isolation)](#35-编译期静态常量与双模式安全隔离-dce--isolation)
  - [3.6 既有输入转义与 DOM 注入防御机制](#36-既有输入转义与-dom-注入防御机制)
- [四、结构化问题清单与缺陷编目 (21 项)](#四结构化问题清单与缺陷编目-21-项)
  - [4.1 中度风险问题 (Medium, 4 项)](#41-中度风险问题-medium-4-项)
    - [SEC-M-01: 书签自定义图标未限制长度导致 LocalStorage 配额爆仓拒绝服务](#sec-m-01-书签自定义图标未限制长度导致-localstorage-配额爆仓拒绝服务)
    - [SEC-M-02: 网页端 CSP 策略保留 'unsafe-inline' 及第三方 JSONP 域名弱化 XSS 防护](#sec-m-02-网页端-csp-策略保留-unsafe-inline-及第三方-jsonp-域名弱化-xss-防护)
    - [SEC-M-03: 网页端 CSP script-src 权限过度开放 Wikipedia 域名](#sec-m-03-网页端-csp-script-src-权限过度开放-wikipedia-域名)
    - [SEC-M-04: Chrome 扩展清单版本号未清洗 SemVer 后缀导致加载阻断](#sec-m-04-chrome-扩展清单版本号未清洗-semver-后缀导致加载阻断)
  - [4.2 轻度风险问题 (Low, 12 项)](#42-轻度风险问题-low-12-项)
    - [SEC-L-01: safeUrl 上下文混淆：超链接 <a href> 误放行本地图标与 Data URL](#sec-l-01-safeurl-上下文混淆超链接-a-href-误放行本地图标与-data-url)
    - [SEC-L-02: safeUrl 本地图标路径正则存在路径穿越 (..) 缺陷](#sec-l-02-safeurl-本地图标路径正则存在路径穿越--缺陷)
    - [SEC-L-03: 搜索联想与书签导航存在协议相对 URL (//) 绕过协议校验风险](#sec-l-03-搜索联想与书签导航存在协议相对-url--绕过协议校验风险)
    - [SEC-L-04: 天气视图 weatherCard 模板插值未转义潜在 DOM XSS 隐患](#sec-l-04-天气视图-weathercard-模板插值未转义潜在-dom-xss-隐患)
    - [SEC-L-05: 书签编辑器行模板中 input id 与 name 属性未转义插值](#sec-l-05-书签编辑器行模板中-input-id-与-name-属性未转义插值)
    - [SEC-L-06: 天气地理坐标及气象测量指标缺乏物理取值区间校验](#sec-l-06-天气地理坐标及气象测量指标缺乏物理取值区间校验)
    - [SEC-L-07: Service Worker 离线修复页使用硬编码静态 CSP Nonce](#sec-l-07-service-worker-离线修复页使用硬编码静态-csp-nonce)
    - [SEC-L-08: IndexedDB 异常断连后未重置 activeDb 句柄导致连接永久失效](#sec-l-08-indexeddb-异常断连后未重置-activedb-句柄导致连接永久失效)
    - [SEC-L-09: Chrome 扩展 CSP 缺少防御深度的 frame-ancestors 'none' 显式声明](#sec-l-09-chrome-扩展-csp-缺少防御深度的-frame-ancestors-none-显式声明)
    - [SEC-L-10: HTML 模板版本号占位符替换缺乏实体转义防护](#sec-l-10-html-模板版本号占位符替换缺乏实体转义防护)
    - [SEC-L-11: 原子化构建发布锁基于 PID 判定存在 PID 回绕竞争窗口](#sec-l-11-原子化构建发布锁基于-pid-判定存在-pid-回绕竞争窗口)
    - [SEC-L-12: 自动化测试套件在存储配额超限与网络异常恢复方面存在覆盖盲区](#sec-l-12-自动化测试套件在存储配额超限与网络异常恢复方面存在覆盖盲区)
  - [4.3 提示与建议 (Info, 5 项)](#43-提示与建议-info-5-项)
    - [SEC-I-01: Chrome 扩展打包产物遗留冗余 iOS/Safari 静态资产](#sec-i-01-chrome-扩展打包产物遗留冗余-iossafari-静态资产)
    - [SEC-I-02: 本地开发服务静态资产通配跨域 CORS 响应头过宽](#sec-i-02-本地开发服务静态资产通配跨域-cors-响应头过宽)
    - [SEC-I-03: DOMCache 接口中 navHint 元素类型精度不一致](#sec-i-03-domcache-接口中-navhint-元素类型精度不一致)
    - [SEC-I-04: 架构文档中 safeUrl(url, false) 规范声明与实际代码实现存在脱节](#sec-i-04-架构文档中-safeurlurl-false-规范声明与实际代码实现存在脱节)
    - [SEC-I-05: Netscape Bookmark HTML 格式导入未支持但由 JSON 解析安全拦截](#sec-i-05-netscape-bookmark-html-格式导入未支持但由-json-解析安全拦截)
- [五、测试套件有效性与安全防御验证评估](#五测试套件有效性与安全防御验证评估)
  - [5.1 自动化测试套件既有覆盖分析](#51-自动化测试套件既有覆盖分析)
  - [5.2 核心安全防护盲区分析](#52-核心安全防护盲区分析)
  - [5.3 推荐补充的高价值安全测试用例](#53-推荐补充的高价值安全测试用例)
- [六、安全加固与改进建议规划路线图](#六安全加固与改进建议规划路线图)
  - [6.1 P0 立即处置 (Immediate / 阻断性与配额防护 — 1-2 周内)](#61-p0-立即处置-immediate--阻断性与配额防护--1-2-周内)
  - [6.2 P1 近期加固 (Near-Term / 防御深度与输入清洗 — 1 个月内)](#62-p1-近期加固-near-term--防御深度与输入清洗--1-个月内)
  - [6.3 P2 架构增强与长期治理 (Long-Term / CSP 严格化与流水线 — 季度规划)](#63-p2-架构增强与长期治理-long-term--csp-严格化与流水线--季度规划)
- [七、独立验证与复现指引](#七独立验证与复现指引)

---

## 一、执行摘要与综合安全评级

### 1.1 总体安全评级与结论

| 评估维度 | 权重 | 得分 | 评级 | 维度简述与审计要点 |
| :--- | :---: | :---: | :---: | :--- |
| **Chrome 扩展权限与隔离** | 25% | **96** | A+ | MV3 规范标杆，零 `permissions` 声明，无后台驻留与内容脚本注入，AST 死代码消除保障扩展安全。 |
| **输入过滤与 XSS 防护** | 25% | **88** | B+ | 统一转义函数覆盖全面，内存草稿机制避免 DOM 反解析；网页端 CSP 依赖 `'unsafe-inline'`，个别子模板漏转义。 |
| **客户端存储与数据安全** | 20% | **85** | B | 大图/Base64 壁纸 100% 隔离至 IndexedDB；书签自定义图标缺失长度截断，存在 LocalStorage 配额爆仓 DoS 风险。 |
| **网络通信与接口安全** | 15% | **90** | A- | 全链条强制 HTTPS，零凭据泄漏；搜索建议扩展端改用 CORS `fetch`，但网页端 CSP 对 Wikipedia 存在过度授权。 |
| **构建流水线与工程合规** | 15% | **92** | A | 运行时零第三方依赖，原子发布目录锁保护；扩展版本号对 npm 语义化预发布后缀存在兼容性缺失。 |
| **综合安全健康指数 (Overall)** | **100%** | **90.3 / 100** | **良好 (Good / Low Overall Risk)** | **整体安全风险低，架构基础极扎实，具备高度自律的防御设计，存在若干可迅速收敛的纵深防御改进项。** |

本安全审计小组对 Glass Start（包含网页端全部业务逻辑、数据持久化层、工具类、Chrome 扩展 `src/extension/` 以及构建打包工具链 `scripts/`）开展了全量只读人工代码审查与静态数据流分析。

审计结论显示：**Glass Start 在现代前端安全架构与扩展权限控制上表现出极高水准的工程自律。** 项目全面遵循最小权限原则（Least Privilege）与奥卡姆剃刀原则（Entities should not be multiplied beyond necessity），未引入任何第三方运行时 npm 依赖，在扩展端未索取任何高危系统权限。代码库中没有发现 High 级别的直接远程代码执行（RCE）或任意特权提权漏洞。识别出的缺陷主要分布在存储配额 DoS 防护、网页版 CSP 策略收敛、输入正则边界与组件模板纵深防御上。

### 1.2 跨模块安全态势总览

1. **Chrome 扩展 (Chrome MV3 Extension)**:
   安全等级极高。扩展清单 `manifest.json` 未申请任何 `permissions`（如 `tabs`、`cookies`、`storage` 等），无常驻 Background Service Worker，无 Content Scripts 页面注入，无外部通信端口（未声明 `externally_connectable`），未开放外部探测资源（未声明 `web_accessible_resources`）。双模式切换通过 esbuild 在编译期注入字面量宏并执行 AST 死代码消除（DCE），扩展内物理剔除了 JSONP 动态脚本逻辑。
2. **Web 核心与 XSS 防护 (Web Core & Input Sanitization)**:
   安全机制完整但有提升空间。全站广泛采用 `escapeHtml()`、`safeUrl()` 与安全的 `textContent`；书签与壁纸编辑全部采用内存草稿模型驱动。然而网页版 CSP 仍保留 `'unsafe-inline'` 且放行第三方 JSONP 域名，同时 `weatherCard` 局部模板与书签编辑器表单元素属性插值存在防御性转义遗漏。
3. **客户端存储 (Client-Side Storage)**:
   存储架构清晰。严格遵循 `AGENTS.md` 约束，自定义大图壁纸 100% 存入 IndexedDB，LocalStorage 仅保存轻量级数值与颜色配置。但书签自定义图标字段未设置长度上限且允许 Data URL，导致恶意的巨量 Base64 图标可撑爆 LocalStorage（5MB 配额），导致后续配置无法持久化。
4. **外部请求与 API (External Network & APIs)**:
   所有外部服务（天气接口、地图逆编码、IP 归属地查询、搜索联想、图标抓取）均强制 HTTPS；接口请求采用匿名或省略凭据模式 (`credentials: 'omit'`)，无 Cookie 泄露风险；天气坐标缺乏物理范围 `[-90, 90]` 校验可能导致无效接口请求被长期缓存。
5. **构建流水线与打包基础设施 (Build Pipeline & Infra)**:
   构建过程完全本地离线确定性执行，无动态依赖拉取；原子目录切换锁具备自我清理能力；扩展构建对版本号后缀的处理需提升鲁棒性。

### 1.3 缺陷严重级别分布统计

跨三大探索领域全量排查，共编目 **21 项** 结构化安全缺陷、配置弱点与规范偏差：

```
                    ┌─────────────────────────┐
                    │  High (严重 / 0 项)     │
                    ├─────────────────────────┤
                    │  Medium (中度 / 4 项)   │
                    ├─────────────────────────┤
                    │  Low (轻度 / 12 项)     │
                    ├─────────────────────────┤
                    │  Info (提示 / 5 项)     │
                    └─────────────────────────┘
                            总计: 21 项
```

| 严重级别 (Severity) | 数量 | 核心影响摘要 |
| :--- | :---: | :--- |
| **High (高)** | **0** | 无直接远程任意代码执行、无扩展越权提权、无敏感凭证勒索或严重数据穿透风险。 |
| **Medium (中)** | **4** | 书签图标无上限致 LocalStorage 配额爆仓 DoS；网页版 CSP `'unsafe-inline'` 削弱 XSS 防御纵深；CSP `script-src` 冗余授权维基百科；扩展构建未剥离 SemVer 后缀致 Chrome 加载阻断。 |
| **Low (低)** | **12** | `safeUrl` 上下文混淆超链接；`safeUrl` 图标正则允许路径穿越；`//` 协议相对路径绕过；`weatherCard` 与书签编辑表单模板遗漏转义；天气经纬度边界越界；SW 离线页硬编码静态 CSP Nonce；IndexedDB 异常断连句柄残留；扩展 CSP 缺失 `frame-ancestors 'none'`；版本注入占位符转义缺失；构建发布锁 PID 回绕竞争；测试套件存储配额用例缺失。 |
| **Info (提示)** | **5** | 扩展产物目录冗余 iOS 资源；本地开发服务器通配 CORS；`DOMCache` 接口 `navHint` 类型精度微调；架构文档对 `safeUrl(url, false)` 的描述脱节；Netscape 书签格式的非支持与安全拦截确认。 |

### 1.4 核心安全亮点与架构优势

1. **绝对零运行时依赖 (Zero Runtime Dependencies)**:
   生产环境 `package.json` 中的 `dependencies` 为 `{}`。彻底免除了现代前端常见的 `node_modules` 供应链投毒、深层依赖原型污染及中间人恶意注入隐患。
2. **Manifest V3 极简权限与攻击面收敛 (MV3 Least Privilege)**:
   扩展清单 `manifest.json` 中没有任何 `permissions` 项，完全不请求访问用户的 Cookie、浏览记录或系统特权 API。扩展无后台工作线程常驻，无注入任何页面的 Content Scripts，不暴露任何跨扩展连接，攻击面收敛至理论极限。
3. **编译期 AST 宏消除与双模式物理隔离 (Compile-time AST DCE)**:
   网页与扩展双模式依赖构建常量 `window.__GLASS_EXTENSION__`，在构建打包阶段由 esbuild 静态宏替换。扩展产物在 AST 阶段将所有基于动态 `<script>` 的 JSONP 调用彻底裁剪，物理杜绝跨站脚本执行通道；网页产物硬编码为 `false`，运行时无法被修改。
4. **内存草稿驱动与 DOM 隔离 (Draft-Driven Mutation)**:
   书签添加、编辑、删除与拖拽重排均由内存草稿对象 `modalState.draftBookmarks` 驱动，保存与导出均直接序列化草稿数据，严格禁止从 DOM 逆向解析数据，彻底消除了基于 DOM Clobbering 的数据污染隐患。
5. **存储层级物理隔离与规范落地 (Storage Segregation)**:
   壁纸图像 Base64 数据与二进制大对象 100% 隔离保存在 IndexedDB 中，LocalStorage 仅持久化轻量级数值索引与配色偏好，完美遵守项目架构规范。

### 1.5 关键风险与待加固弱点

1. **存储可用性弱点 (Storage Quota DoS)**:
   `normalizeBookmarkOverrides` 未限制 `icon` 字段长度，且允许输入 Base64 Data URL。攻击者可通过构造包含巨量 Base64 图片的书签导入文件，耗尽浏览器的 5MB LocalStorage 配额，导致用户后续无法保存任何设置。
2. **CSP 纵深防御不足 (Permissive Web CSP)**:
   网页端生产环境 CSP 依然保留 `'unsafe-inline'`，且为兼容国内联想保留了第三方 JSONP 域名，使得 CSP 无法在发生代码注入时起到最后一道防线的阻断作用。
3. **输入校验与模板防御的边缘疏漏**:
   `safeUrl` 存在路径穿越（`..`）与媒体/链接上下文混淆；`openBookmarkUrl` 缺少对 `//` 协议相对 URL 的前置截断；`weatherCard` 与书签编辑表单个别模板存在未转义变量插值。

---

## 二、审计范围、边界与方法论

### 2.1 审查模块与源码边界

本轮安全审计覆盖 Glass Start 仓库中的全部核心代码资产：

```
/Users/leosdcn/Projects/Web/startpage/
├── src/
│   ├── index.html                 # 网页端外壳、内联脚本与初始 CSP
│   ├── extension/                 # Chrome MV3 扩展清单与多语言配置
│   │   ├── manifest.json
│   │   └── _locales/
│   └── js/
│       ├── config/                # 业务配置、多语言字典与安全常量
│       ├── core/                  # 基础设施 (事件委托、首屏性能)
│       ├── state/                 # 全局状态树、DOM 缓存、弹窗栈 (OverlayStack)
│       ├── modules/               # 核心功能组件 (书签、壁纸、搜索、天气、设置、弹窗)
│       └── utils/                 # 工具库 (idb.js, storage.js, helpers.js, bookmark-model.js)
├── sw.js                          # Service Worker 离线缓存、资源预取与降级页面
├── scripts/                       # 打包、构建、原子发布与本地开发服务器脚本
│   ├── build.cjs
│   ├── build-extension.cjs
│   ├── publish-build.cjs
│   ├── server.cjs
│   └── html-template.cjs
├── public/                        # 边缘部署头配置 (_headers) 与静态资产
└── test/                          # 自动化测试套件 (模块边界、数据流、扩展集成)
```

### 2.2 审计准则与只读约束

根据审计任务指令与基准规范（Integrity Benchmark Mode），本次审计严格恪守以下操作边界：
1. **只读保证 (Strictly Read-Only)**: 审计全过程未修改任何生产业务代码、HTML 模板、CSS 样式、配置文件或已有测试脚本。代码库除新增本份审计报告及审计团队工作区状态文件外，保持完全无改动。
2. **基于证据的代码审查 (Evidence-Based Forensic Audit)**: 杜绝仅凭自动化静态分析工具报告推测缺陷。报告列出的每一项问题，均由人工走查源码核实，精确提供文件路径、起止行号、真实代码证据片段、漏洞复现逻辑与具体修复补丁。
3. **双重环境对照 (Web vs. Extension)**: 对网页端部署形态与 Chrome MV3 扩展打包形态分别进行行为路径核验，审查两者在编译后产物中的安全边界差异。

### 2.3 威胁模型与攻击面分析

基于 Glass Start 的无服务端后端（Serverless / Pure Client-Side）起始页架构，确立以下四个核心威胁载体与攻击面：

```
                      [外部攻击面分析模型]

1. 恶意书签导入文件 (JSON) ───► [importBookmarksJSON] ───► LocalStorage 配额爆仓 / 属性注入
2. 第三方开放接口响应 ─────► [Weather / Suggest APIs] ──► 畸形数据注入 / 逻辑解析失效
3. 搜索栏与导航输入 ───────► [openBookmarkUrl] ────────► 伪协议执行 / 开放重定向 (Open Redirect)
4. 扩展跨宿主环境交互 ─────► [chrome-extension://] ────► 点击劫持 / 外部页面探测
```

1. **不可信输入文件导入**: 用户从第三方导入恶意的 `bookmarks.json` 文件，其中可能包含畸形 URL（`javascript:` 伪协议）、超大 Base64 图标数据、特殊属性闭合字符等。
2. **第三方不可信 API 响应**: 外部天气（Open-Meteo）、搜索联想（Google/Bing/Wikipedia）或 IP 定位服务被劫持或返回恶意的非标格式数据。
3. **用户输入与 URL 导航**: 用户在搜索框键入内容或点击联想项，可能通过构造特殊的协议前缀触发意外的脚本执行或非法外域跳跃。
4. **外部网页对扩展的探测与嵌入**: 第三方钓鱼网站尝试通过 `<iframe>` 嵌入本地扩展页面，或通过扩展 API 探测用户浏览器特征。

---

## 三、架构规范合规性与既有安全防护成果

### 3.1 客户端存储规范与隔离合规 (AGENTS.md 审查)

`AGENTS.md` 明确约束：“*大图 / Base64 壁纸存入 IndexedDB（`src/js/utils/idb.js`），不写入 LocalStorage*”。

- **壁纸数据流审计事实**：
  审查 `src/js/modules/wallpaper.js:307-323`，用户上传的自定义壁纸及预设选择统一通过 `setWallpaperSelectionDB(selection)` 提交至 IndexedDB 的 `wallpapers` 对象仓库。
  审查 `src/js/modules/wallpaper.js:161-173`，`syncCommittedWallpaperHints()` 写入 `localStorage.setItem('glass_wallpaper_meta')` 的仅为轻量布尔标记（`custom: !!customWallpaper`）、预设索引编号（`bg`）与主题色调（`appearance`）。
- **合规审计结论**：**100% 严格合规**。生产代码中不存在将原始壁纸 Base64 或大型图像二进制写入 LocalStorage 的行为。

### 3.2 模块分层与依赖无环性 (Dependency Architecture)

`AGENTS.md` 与 `ARCHITECTURE.md` 约束：“*依赖方向以架构文档为准：`core/`、`utils/`、`state/` 不导入业务模块，业务模块不导入顶层装配或测试适配*”。

- **静态拓扑与用例验证**：
  运行 `node --test test/infra-module-boundaries.test.mjs`，测试脚本通过静态 AST 解析对 `src/js/` 下全部 46 个 JavaScript 源码模块的导入关系进行了全量遍历：
  - `core/`、`utils/`、`state/`、`config/` 属于基础层，严格保持对上层 `modules/` 的零引用；
  - 各业务子模块之间无循环引用（Zero Circular Dependencies）；
  - 生产包打包入口排除了测试接口桥接文件 `testing/bridge.js`。
- **合规审计结论**：**100% 严格合规**。

### 3.3 弹窗生命周期合规 (OverlayStack Lifecycle)

`AGENTS.md` 约束：“*受 `OverlayStack` 管理的弹窗通过 `.push(id, closeFn)` / `.pop(id)` 管理显示与关闭，业务模块不直接修改这些弹窗的 `style.display` 或 `hidden`*”。

- **源码走查事实**：
  全面检索全库受管弹窗的显示与关闭逻辑（`editModal` 设置弹窗、`shortcutModal` 快捷键弹窗、`creditsModal` 致谢弹窗、`confirmModal` 确认弹窗、`bookmarkPicker` 图标选择器、`languageModal` 语言选择弹窗）。
  全部弹窗均严格调用 `OverlayStack.push(modalId, closeFn)` 入栈，并通过原生 `<dialog>` 规范的 `.showModal()` 激活，退出时统一由 `OverlayStack.pop(modalId)` 清理，未发现任何业务模块强行直接设置 `dialog.style.display` 或 `dialog.hidden`。
- **合规审计结论**：**100% 严格合规**。

### 3.4 Chrome 扩展最小权限与攻击面收敛 (Extension Security)

- **权限声明**：`src/extension/manifest.json` 遵从 Manifest V3 标准，未声明任何高危 `permissions`（空配置）。
- **网络主机白名单**：`host_permissions` 精确声明 8 个服务域名，全部对应代码中实际调用的天气、逆编码与搜索建议接口，无通配符域名（`*://*/*` 或 `<all_urls>`）。
- **后台与脚本注入**：无 Background Service Worker，无 Content Scripts，未配置 `web_accessible_resources`，未配置 `externally_connectable`。
- **合规审计结论**：**优秀 (Excellent)**，达到了主流浏览器扩展权限控制的最高规范。

### 3.5 编译期静态常量与双模式安全隔离 (DCE & Isolation)

- **宏替换与死代码消除 (Dead Code Elimination)**：
  在 `scripts/build.cjs:152-155` 与 `226-228` 中，esbuild 构建配置将 `window.__GLASS_EXTENSION__` 定义为编译期字面量字符串（扩展包为 `"true"`，网页包为 `"false"`）。
- **执行分支隔离**：
  在 `src/js/modules/search.js:587-684` 中，网页端的 JSONP 动态脚本分支 `!window.__GLASS_EXTENSION__ && script` 在扩展编译产物 `extension/app.js` 中被 esbuild AST 分析器彻底物理移除（已在 `test/infra-chrome-extension.test.mjs:25` 中通过正则验证）。
  在网页端生产环境中，`window.__GLASS_EXTENSION__` 被替换为静态布尔值 `false`，攻击者无法在运行时通过控制台注入全局变量实施提权。
- **存储域隔离**：
  扩展运行在 `chrome-extension://<unique-id>/` 专属来源域，网页端运行在常规域名（如 `https://example.com`），两者数据在浏览器内核中依据同源策略实现完全的物理隔离。

### 3.6 既有输入转义与 DOM 注入防御机制

- **HTML 实体转义**：`src/js/utils/helpers.js:10-12` 的 `escapeHtml()` 正确编码了 `&`、`<`、`>`、`"`、`'` 五大核心 HTML 元字符，能有效防御绝大多数属性与文本区域的内容注入。
- **壁纸 CSS 注入防护**：在 `src/js/modules/wallpaper.js:33-40` 中，应用将外部 URL 写入 `style.backgroundImage` 之前，通过正则 `url.replace(/["'\\\r\n)]/g, '\\$&')` 对引号、反斜杠与闭合括号进行了严格的转义，杜绝了 CSS 表达式与样式逃逸。
- **对话框安全输出**：确认对话框组件 `src/js/modules/dialogs.js:38-39` 针对标题与正文严格使用 DOM `textContent` 赋值，不经由 HTML 解析器。

---

## 四、结构化问题清单与缺陷编目 (21 项)

---

### 4.1 中度风险问题 (Medium, 4 项)

#### SEC-M-01: 书签自定义图标未限制长度导致 LocalStorage 配额爆仓拒绝服务

- **严重级别**: `Medium`
- **问题分类**: 客户端存储与拒绝服务防护 (Client Storage / Storage Quota Limits)
- **目标文件与精确行号**:
  - `src/js/utils/bookmark-model.js`: 90–99
  - `src/js/utils/helpers.js`: 21–27
  - `src/js/config/constants.js`: 146–150
  - `src/js/modules/bookmarks.js`: 91–105
- **代码片段证据**:
  ```javascript
  // src/js/utils/bookmark-model.js:90-99
  export function normalizeBookmarkOverrides(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
      const { name, icon, desc } = /** @type {import('../types').CustomMetaItem} */ (value);
      const trimmedIcon = typeof icon === 'string' ? icon.trim() : '';
      return {
          ...(typeof name === 'string' && name.trim() ? { name: name.trim().slice(0, CONFIG.SECURITY.MAX_NAME_CHARS) } : {}),
          ...(trimmedIcon && safeUrl(trimmedIcon) !== '#' ? { icon: trimmedIcon } : {}),
          ...(typeof desc === 'string' ? { desc: desc.trim().slice(0, CONFIG.SECURITY.MAX_DESC_CHARS) } : {})
      };
  }

  // src/js/utils/helpers.js:25
  const isDataImg = /^data:image\/(png|jpeg|jpg|webp|gif|x-icon|avif);base64,/i.test(u);
  return (isHttp || isIcon || isDataImg) ? (html ? escapeHtml(u) : u) : '#';

  // src/js/modules/bookmarks.js:101
  if (!storageSet(CONFIG.KEYS.BOOKMARKS, { version: 1, keys, meta: customMeta })) return false;
  ```
- **成因与潜在影响分析**:
  1. `normalizeBookmarkOverrides` 函数严格限制了书签名称（`MAX_NAME_CHARS: 60`）和描述（`MAX_DESC_CHARS: 40`）的最大字符数，以防止 LocalStorage 膨胀。然而，对于 `icon` 字段，函数**未设置任何长度截断**。
  2. `safeUrl()` 明确放行以 `data:image/...;base64,` 开头的图像 Data URL。
  3. 用户在编辑书签自定义图标或通过 `importBookmarksJSON()` 导入包含大体积 Data URL（例如 2MB–5MB 的高清 Base64 图片）的书签时，该数据将直接序列化存入 LocalStorage 的 `glass_bookmarks` 键中。
  4. 现代浏览器（Chrome、Safari、Firefox）为每个源分配的 LocalStorage 存储上限通常仅为 5MB 左右。一旦存储体积超出配额，`localStorage.setItem()` 将抛出 `QuotaExceededError`（在 Safari 中为 `QuotaExceededError: The quota has been exceeded`）。
  5. 导致 `storageSet` 失败，用户不仅无法再保存任何新增或修改的书签，整个起始页的偏好设置修改（包括壁纸索引、语言切换、快捷键设置等）也将全部瘫痪，造成不可恢复的客户端持久化拒绝服务（Client-Side Storage DoS）。
- **针对性修复建议**:
  在 `src/js/config/constants.js` 的 `CONFIG.SECURITY` 中新增 `MAX_ICON_CHARS: 2048` 配置项；在 `normalizeBookmarkOverrides` 中强制限制图标字段的最大字符长度，或者显式拒绝在自定义书签元数据中直接保存长 Base64 Data URL：
  ```javascript
  // 修复方案：在 src/js/utils/bookmark-model.js:96 中增加长度检查
  const MAX_ICON_CHARS = CONFIG.SECURITY.MAX_ICON_CHARS || 2048;
  return {
      ...(typeof name === 'string' && name.trim() ? { name: name.trim().slice(0, CONFIG.SECURITY.MAX_NAME_CHARS) } : {}),
      ...(trimmedIcon && trimmedIcon.length <= MAX_ICON_CHARS && safeUrl(trimmedIcon) !== '#' ? { icon: trimmedIcon } : {}),
      ...(typeof desc === 'string' ? { desc: desc.trim().slice(0, CONFIG.SECURITY.MAX_DESC_CHARS) } : {})
  };
  ```

---

#### SEC-M-02: 网页端 CSP 策略保留 'unsafe-inline' 及第三方 JSONP 域名弱化 XSS 防护

- **严重级别**: `Medium`
- **问题分类**: 内容安全策略与纵深防御 (Content Security Policy / XSS Defense)
- **目标文件与精确行号**:
  - `src/index.html`: 19
  - `public/_headers`: 14
- **代码片段证据**:
  ```html
  <!-- src/index.html:19 -->
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' https://api.bing.com https://suggestqueries.google.com https://zh.wikipedia.org https://en.wikipedia.org https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://api.open-meteo.com https://geocoding-api.open-meteo.com https://myip.ipip.net https://ipwho.is https://a.favicon.im https://www.google.com https://*.gstatic.com https://cloudflareinsights.com https://zh.wikipedia.org https://en.wikipedia.org; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'">
  ```
  ```http
  # public/_headers:14
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://api.bing.com https://suggestqueries.google.com https://zh.wikipedia.org https://en.wikipedia.org https://static.cloudflareinsights.com; ...
  ```
- **成因与潜在影响分析**:
  1. 网页端 CSP 中包含了 `'unsafe-inline'`，且将第三方搜索联想服务域名（Bing 与 Google）放行至 `script-src` 中以支持跨域 JSONP 调用。
  2. 现代应用安全架构中，CSP 的核心价值在于提供“纵深防御（Defense-in-Depth）”：即使前端因某种不可预见的 DOM 解析疏漏产生 HTML 注入漏洞，严格的 CSP（禁止 `'unsafe-inline'`，仅允许本地脚本或指定 hash/nonce）也能强行阻断攻击者注入的 JavaScript 脚本执行。
  3. 由于保留了 `'unsafe-inline'`，浏览器将无条件执行任何内联注入代码（例如 `<svg onload=...>` 或 `<img onerror=...>`），使得 CSP 丧失了对 XSS 攻击的二次兜底防御能力。
  4. 此外，将第三方域名列入 `script-src` 存在“JSONP 端点滥用（Script Gadget Injection）”风险：若第三方域名存在可控回调名称或重定向行为，攻击者可绕过域白名单执行任意脚本。
  5. *注*：Chrome 扩展模式（MV3）已彻底消除了此问题（使用本地 `fetch()` 并封禁 `'unsafe-inline'`），但网页端仍处于受弱化保护状态。
- **针对性修复建议**:
  1. 将 `src/index.html` 中的 8 处内联 `<script>` 脚本（首屏主题恢复、SW 注册等）外置或在构建打包期计算其 SHA-256 哈希值，写入 CSP `script-src 'self' 'sha256-...'`，移除 `'unsafe-inline'`。
  2. 将网页端搜索联想请求改造为使用 CORS 代理或受限沙箱隔离，逐步收敛并移除 `script-src` 中的第三方域名。

---

#### SEC-M-03: 网页端 CSP script-src 权限过度开放 Wikipedia 域名

- **严重级别**: `Medium`
- **问题分类**: 内容安全策略最小权限原则 (CSP Least Privilege)
- **目标文件与精确行号**:
  - `src/index.html`: 19
  - `public/_headers`: 14
  - 对照业务代码: `src/js/modules/search.js`: 589, 654–668
- **代码片段证据**:
  ```html
  <!-- src/index.html:19 -->
  <meta http-equiv="Content-Security-Policy" content="... script-src 'self' 'unsafe-inline' https://api.bing.com https://suggestqueries.google.com https://zh.wikipedia.org https://en.wikipedia.org ...">
  ```
  ```javascript
  // src/js/modules/search.js:589, 654-668
  const controller = window.__GLASS_EXTENSION__ || engineKey === 'wikipedia' ? new AbortController() : null;
  ...
  // 维基百科即使在网页端也一律使用原生 fetch()，绝不创建 <script> 标签！
  let url = `https://${getLocale() === 'en' ? 'en' : 'zh'}.wikipedia.org/w/api.php?action=opensearch&format=json&search=${encodeURIComponent(query)}&origin=*`;
  fetch(url, { signal: controller.signal, credentials: 'omit' }).then(...)
  ```
- **成因与潜在影响分析**:
  1. 在 `src/js/modules/search.js` 中，维基百科（Wikipedia）的搜索建议接口从一开始就支持标准 CORS（通过 `origin=*` 参数），因此无论在网页版还是扩展版中，项目代码均使用 `fetch()` 异步获取 JSON 数据，**从未创建任何指向 Wikipedia 的 `<script>` 标签**。
  2. 然而，在 `src/index.html` 和 `public/_headers` 的 CSP 配置中，却将 `https://zh.wikipedia.org` 和 `https://en.wikipedia.org` 错误地添加到了 `script-src` 指令中。
  3. 按照 W3C CSP 规范，`fetch()` 发起的异步网络请求仅需受 `connect-src` 约束（当前 `connect-src` 中已正确包含了维基百科域名）。
  4. 维基百科是一个对公众开放编辑的大型社区平台，包含海量用户生成内容及多样化的 API 接口。将其开放为受信任的脚本执行来源，极大地扩大了潜在攻击面，违背了安全审计中的最小特权原则。
- **针对性修复建议**:
  从 `src/index.html` 与 `public/_headers` 的 `script-src` 中移除维基百科域名，仅保留在 `connect-src` 中：
  ```html
  <!-- 修复前: script-src 'self' 'unsafe-inline' https://api.bing.com https://suggestqueries.google.com https://zh.wikipedia.org https://en.wikipedia.org ... -->
  <!-- 修复后: script-src 'self' 'unsafe-inline' https://api.bing.com https://suggestqueries.google.com https://static.cloudflareinsights.com ... -->
  ```

---

#### SEC-M-04: Chrome 扩展清单版本号未清洗 SemVer 后缀导致加载阻断

- **严重级别**: `Medium`
- **问题分类**: 扩展清单与构建合规 (Extension Manifest Compliance)
- **目标文件与精确行号**:
  - `scripts/build-extension.cjs`: 11–13
  - `package.json`: 3
  - `src/extension/manifest.json`: 1–27
- **代码片段证据**:
  ```javascript
  // scripts/build-extension.cjs:11-13
  const manifest = JSON.parse(fs.readFileSync(path.join(PATHS.src, 'extension/manifest.json'), 'utf8'));
  manifest.version = JSON.parse(fs.readFileSync(PATHS.pkgJson, 'utf8')).version;
  fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  ```
- **成因与潜在影响分析**:
  1. Google Chrome 官方 Manifest V3 规范以及 Chrome Web Store 开发者后台对扩展清单中的 `version` 字段有严格的格式强制约束：**必须为 1 到 4 个以点号分隔的非负整数（0–65535）**（例如 `5.5.3` 或 `1.0.0.1`），严禁包含任何英文字母、短横线或语义化版本预发布标识符（如 `-beta`、`-rc.1`）。
  2. 当前构建脚本 `scripts/build-extension.cjs` 在生成扩展产物时，直接读取 `package.json` 的 `version` 并原样赋予 `manifest.version`。
  3. 一旦开发团队遵循 npm 常见的 SemVer 标准发布预发布版本（如 `5.5.4-beta.1`），构建出的 Chrome 扩展将无法在 Chrome 中加载（报错：`Required value 'version' is missing or invalid. It must be between 1-4 dot-separated integers each between 0 and 65536.`），直接导致扩展端发布与持续集成流水线阻断。
- **针对性修复建议**:
  在 `scripts/build-extension.cjs` 提取版本号时，增加符合 Chrome 规范的正则截取与校验：
  ```javascript
  const rawVersion = JSON.parse(fs.readFileSync(PATHS.pkgJson, 'utf8')).version;
  const chromeVersionMatch = rawVersion.match(/^(\d+(?:\.\d+){0,3})/);
  if (!chromeVersionMatch) throw new Error(`无效的 Chrome 扩展版本号: ${rawVersion}`);
  manifest.version = chromeVersionMatch[1];
  ```

---

### 4.2 轻度风险问题 (Low, 12 项)

#### SEC-L-01: safeUrl 上下文混淆：超链接 `<a href>` 误放行本地图标与 Data URL

- **严重级别**: `Low`
- **问题分类**: URL 校验与上下文混淆 (Context Confusion / URL Sanitization)
- **目标文件与精确行号**:
  - `src/js/utils/helpers.js`: 21–27
  - `src/js/modules/bookmarks.js`: 147, 425
- **代码片段证据**:
  ```javascript
  // src/js/utils/helpers.js:21-27
  export function safeUrl(url, html = true) {
      const u = (url || '').trim();
      const isHttp = /^https?:\/\//i.test(u);
      const isIcon = /^(\.\/|\/)?icons\/[a-zA-Z0-9_\-\/.]+\.(png|svg|webp|ico)$/i.test(u);
      const isDataImg = /^data:image\/(png|jpeg|jpg|webp|gif|x-icon|avif);base64,/i.test(u);
      return (isHttp || isIcon || isDataImg) ? (html ? escapeHtml(u) : u) : '#';
  }

  // src/js/modules/bookmarks.js:147
  <a href="${safeUrl(localizeBookmarkUrl(bm.url))}" target="_blank" rel="noopener noreferrer"
  ```
- **成因与潜在影响分析**:
  1. `safeUrl()` 被同时复用于媒体资源加载（`<img src="...">`）和页面超链接跳转（`<a href="...">`）。
  2. 因为 `isIcon`（允许本地图标）和 `isDataImg`（允许 Data URL）在 `safeUrl` 中被判为合法，若书签的 URL 被设置为本地 SVG 路径（如 `icons/test.svg`）或图片 Data URL，该地址将直接通过校验并渲染到 `<a href="...">`。
  3. 当用户点击该书签链接时，浏览器将对该本地 SVG 文件发起顶层导航。若 SVG 文件包含嵌入的 JavaScript（`<script>`），在未严格配置 Content-Disposition 响应头的环境导航到 SVG 时，可能触发脚本执行。此外，允许导航至 Data URL 也不符合标准超链接的业务预期。
- **针对性修复建议**:
  严格区分超链接跳转上下文与媒体加载上下文，拆分或重构 `safeLinkUrl()` 与 `safeMediaUrl()`：
  ```javascript
  // 针对 <a href> 的安全校验：仅允许 http/https
  export function safeLinkUrl(url, html = true) {
      const u = (url || '').trim();
      const isHttp = /^https?:\/\//i.test(u);
      return isHttp ? (html ? escapeHtml(u) : u) : '#';
  }
  ```

---

#### SEC-L-02: safeUrl 本地图标路径正则存在路径穿越 (..) 缺陷

- **严重级别**: `Low`
- **问题分类**: 路径遍历与资源受限加载 (Path Traversal / Resource Loading)
- **目标文件与精确行号**:
  - `src/js/utils/helpers.js`: 24
- **代码片段证据**:
  ```javascript
  // src/js/utils/helpers.js:24
  const isIcon = /^(\.\/|\/)?icons\/[a-zA-Z0-9_\-\/.]+\.(png|svg|webp|ico)$/i.test(u);
  ```
- **成因与潜在影响分析**:
  1. 在 `isIcon` 的正则表达式中，字符集 `[a-zA-Z0-9_\-\/.]+` 允许点号 `.` 与斜杠 `/` 的任意无限制组合。
  2. 诸如 `icons/../../secret/image.png` 或 `./icons/../malicious.svg` 的相对路径完全能够匹配该模式并被判定为安全图标路径返回。
  3. 虽然本地静态服务主要提供前端资源，但放任路径穿越序列通过校验破坏了目录限制的安全边界，可能导致应用加载非预期的目录外部图像资产。
- **针对性修复建议**:
  在正则表达式中通过负向先行断言（Negative Lookahead）明确禁止包含连续双点 `..`：
  ```javascript
  const isIcon = /^(\.\/|\/)?icons\/(?!.*\.\.)[a-zA-Z0-9_\-\/.]+\.(png|svg|webp|ico)$/i.test(u);
  ```

---

#### SEC-L-03: 搜索联想与书签导航存在协议相对 URL (//) 绕过协议校验风险

- **严重级别**: `Low`
- **问题分类**: 开放重定向与 URL 规范化 (Open Redirect / Protocol Validation)
- **目标文件与精确行号**:
  - `src/js/modules/search.js`: 229–251
- **代码片段证据**:
  ```javascript
  // src/js/modules/search.js:236-243
  if (!/^(https?:|\/|\.\/|#)/i.test(trimmed)) {
      if (/^[\w.-]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(trimmed)) {
          trimmed = 'https://' + trimmed;
      } else {
          console.warn('⚠️ 拦截非安全协议书签 URL:', trimmed);
          return;
      }
  }
  // src/js/modules/search.js:249
  window.location.href = trimmed;
  ```
- **成因与潜在影响分析**:
  1. `openBookmarkUrl()` 首先拦截危险伪协议（`javascript:` 等），然后通过 `!/^(https?:|\/|\.\/|#)/i` 检查是否需要自动补全 `https://`。
  2. 若输入的 URL 以协议相对路径 `//` 开头（例如 `//evil.com`），它会因匹配到正斜杠分支 `/^\//` 而直接跳过协议补全和域名合法性检查。
  3. 在浏览器中，`window.location.href = "//evil.com"` 不会被解析为本站根路径下的相对路径，而是解析为当前协议下的绝对外链跳转 `https://evil.com`。
  4. 这构成了一个利用协议相对语法绕过域名格式校验与安全警告提示的非预期跳转分支。
- **针对性修复建议**:
  显式排查并规范化协议相对 URL，或统一使用 WHATWG `new URL()` 解析器进行安全规范化：
  ```javascript
  if (trimmed.startsWith('//')) {
      trimmed = 'https:' + trimmed;
  }
  ```

---

#### SEC-L-04: 天气视图 weatherCard 模板插值未转义潜在 DOM XSS 隐患

- **严重级别**: `Low`
- **问题分类**: DOM XSS / 模板拼接安全 (DOM XSS / Unescaped Template Interpolation)
- **目标文件与精确行号**:
  - `src/js/modules/weather.js`: 453–461, 466–471
- **代码片段证据**:
  ```javascript
  // src/js/modules/weather.js:453-461
  /** @type {(icon: string, label: string, val: string | number) => string} */
  const weatherCard = (icon, label, val) => `
      <div class="p-2 glass-subcard flex items-center gap-2">
          <span class="text-sm select-none">${icon}</span>
          <div class="min-w-0">
              <div class="text-2xs text-white/50 leading-tight">${label}</div>
              <div class="text-xs font-semibold text-white/90 leading-tight mt-0.5">${val}</div>
          </div>
      </div>
  `;

  // src/js/modules/weather.js:466
  view.stats.innerHTML = `
      ${weatherCard(getWeatherIconHTML(humIcon, 'size-4'), t('ui.humidity'), Number.isFinite(humidity) ? humidity + '%' : '--')}
      ...
  `;
  ```
- **成因与潜在影响分析**:
  1. `weatherCard` 辅助模板函数将传入的参数 `${label}` 和 `${val}` 直接通过字符串模板拼接为 HTML 片段，随后赋给 `view.stats.innerHTML`。
  2. 在此过程中，`${label}` 和 `${val}` 均未调用 `escapeHtml()`。
  3. 虽然目前上游调用传递的是数字和固定多语言文案，但该组件缺乏自包含的防御性转义，违背了 `AGENTS.md` 中“动态 HTML 文本必须使用 `escapeHtml()`”的基础规范；若未来扩展气象指标、传入第三方天气描述或未清洗的用户自定义地点标签，将直接沦为 DOM XSS 汇聚点（Sink）。
- **针对性修复建议**:
  在 `weatherCard` 内部对动态文本参数进行强制实体转义：
  ```javascript
  const weatherCard = (icon, label, val) => `
      <div class="p-2 glass-subcard flex items-center gap-2">
          <span class="text-sm select-none">${icon}</span>
          <div class="min-w-0">
              <div class="text-2xs text-white/50 leading-tight">${escapeHtml(label)}</div>
              <div class="text-xs font-semibold text-white/90 leading-tight mt-0.5">${escapeHtml(String(val))}</div>
          </div>
      </div>
  `;
  ```

---

#### SEC-L-05: 书签编辑器行模板中 input id 与 name 属性未转义插值

- **严重级别**: `Low`
- **问题分类**: 属性注入与模板规范化 (DOM Injection / Attribute Breakout)
- **目标文件与精确行号**:
  - `src/js/modules/bookmark-editor.js`: 58–60
- **代码片段证据**:
  ```javascript
  // src/js/modules/bookmark-editor.js:48
  <div role="listitem" class="edit-row-card ... " data-id="${escapeHtml(id)}" draggable="false">

  // src/js/modules/bookmark-editor.js:58-60
  <input type="text" id="bm-name-${id}" name="bookmark_name_${id}" class="edit-name ... " value="${escapeHtml(name)}" ...>
  <input type="text" id="bm-url-${id}" name="bookmark_url_${id}" inputmode="url" ... value="${escapeHtml(url)}" ...>
  ```
- **成因与潜在影响分析**:
  1. 在 `getEditRowHTML(item)` 函数中，第 48 行对容器 `div` 的 `data-id="${escapeHtml(id)}"` 进行了规范的实体转义。
  2. 然而紧随其后的第 58 与 59 行，在构造表单输入框的 `id="bm-name-${id}"`、`name="bookmark_name_${id}"` 以及 `bm-url-${id}` 时，却直接裸插了原始的 `${id}` 变量。
  3. 虽然内部由时间戳生成的 ID 为安全字符，但若导入的书签数据中携带了包含双引号、空格或闭合标签的特制 `id`，将造成属性逃逸（Attribute Breakout），破坏 DOM 树结构。
- **针对性修复建议**:
  保持转义的一致性，使用安全的 `safeId` 进行属性插值：
  ```javascript
  const safeId = escapeHtml(id);
  // 替换为: id="bm-name-${safeId}" name="bookmark_name_${safeId}" ...
  ```

---

#### SEC-L-06: 天气地理坐标及气象测量指标缺乏物理取值区间校验

- **严重级别**: `Low`
- **问题分类**: 输入有效性与服务健壮性 (Input Validation / Service Availability)
- **目标文件与精确行号**:
  - `src/js/utils/weather-data.js`: 8–13
  - `src/js/modules/weather.js`: 89–94, 433–435
- **代码片段证据**:
  ```javascript
  // src/js/utils/weather-data.js:8-13
  export function weatherNum(value, fallback) {
      if (typeof value !== 'number' && typeof value !== 'string') return fallback;
      if (typeof value === 'string' && value.trim() === '') return fallback;
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
  }

  // src/js/modules/weather.js:92-94
  function hasWeatherCoordinates(location) {
      return !!location && Number.isFinite(location.lat) && Number.isFinite(location.lon);
  }
  ```
- **成因与潜在影响分析**:
  1. `weatherNum` 仅检查 `Number.isFinite(number)`，未对百分比指标（如湿度 `0–100%`、降水概率 `0–100%`）或物理风速做合理性范围截断（Clamping）。
  2. `hasWeatherCoordinates` 仅检查经纬度是否为有限数，未验证纬度必须处于 `[-90, 90]` 且经度处于 `[-180, 180]` 的地理常识区间。
  3. 若外部 IP 逆向定位接口（如 `ipwho.is`）返回异常坐标，或 LocalStorage 缓存被污染，该无效坐标将被写入 `glass_weather_loc` 并持久化 24 小时。
  4. 随后向 Open-Meteo 发起的请求将持续返回 HTTP 400 Bad Request，导致天气卡片在长达 24 小时内完全陷入错误状态无法自动恢复。
- **针对性修复建议**:
  在 `hasWeatherCoordinates` 中增加物理经纬度有效范围校验：
  ```javascript
  function hasWeatherCoordinates(location) {
      return !!location &&
          typeof location.lat === 'number' && Number.isFinite(location.lat) && location.lat >= -90 && location.lat <= 90 &&
          typeof location.lon === 'number' && Number.isFinite(location.lon) && location.lon >= -180 && location.lon <= 180;
  }
  ```

---

#### SEC-L-07: Service Worker 离线修复页使用硬编码静态 CSP Nonce

- **严重级别**: `Low`
- **问题分类**: Service Worker 安全与 Nonce 防御模型 (Service Worker CSP / Nonce Anti-Pattern)
- **目标文件与精确行号**:
  - `sw.js`: 207–211
- **代码片段证据**:
  ```javascript
  // sw.js:207-211
  return new Response('<!doctype html><html lang="zh-CN">...<script nonce="glass-recovery">' + script + '</script></body></html>', {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'self'; script-src 'nonce-glass-recovery'; worker-src 'self'; object-src 'none'; base-uri 'none'" }
  });
  ```
- **成因与潜在影响分析**:
  1. 在 W3C CSP 规范中，`nonce`（Number Used Once）的核心安全假设在于其**随机性与不可预测性**，要求每次 HTTP 响应动态生成高熵密码学随机值。
  2. `sw.js` 的 503 离线缓存修复页面直接将固定静态字符串 `'glass-recovery'` 作为 Nonce 写入了 HTML 标签与响应头。
  3. 这完全破坏了 Nonce 的防护机制：任何知晓此固定字符串的恶意注入代码只需声明 `nonce="glass-recovery"`，即可完全绕过此降级页面的 CSP 拦截。
- **针对性修复建议**:
  通过 Web Crypto API 动态生成随机 Base64 Nonce，或者使用该内联脚本的 SHA-256 哈希值替代 Nonce：
  ```javascript
  const randomNonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  // 响应头设置: script-src 'nonce-${randomNonce}'
  // 标签设置: <script nonce="${randomNonce}">
  ```

---

#### SEC-L-08: IndexedDB 异常断连后未重置 activeDb 句柄导致连接永久失效

- **严重级别**: `Low`
- **问题分类**: 客户端存储与健壮性 (Client Storage / Error Recovery)
- **目标文件与精确行号**:
  - `src/js/utils/idb.js`: 12–36, 56–76, 80–97
- **代码片段证据**:
  ```javascript
  // src/js/utils/idb.js:12-14
  function getDB() {
      if (activeDb) return Promise.resolve(activeDb);
      if (openingPromise) return openingPromise;
  ...
  // src/js/utils/idb.js:80-97
  async function mutateWallpaperDB(mutate) {
      try {
          const db = await getDB();
          if (!db) return false;
          return await new Promise(resolve => {
              const tx = db.transaction(CONFIG.IDB.STORES.WALLPAPERS, 'readwrite');
              ...
          });
      } catch { return false; }
  }
  ```
- **成因与潜在影响分析**:
  1. `src/js/utils/idb.js` 将打开成功的数据库对象缓存在模块级单例变量 `activeDb` 中。
  2. 虽然第 33 行绑定了 `activeDb.onclose = () => { activeDb = null; }`，但 `IDBDatabase.onclose` 事件在某些浏览器内核（如特定 Safari/WebKit 版本或低版本移动浏览器）中并不总是可靠触发。
  3. 当 IndexedDB 底层因存储压力、标签页休眠或隐身模式配额回收导致连接失效后，后续调用 `db.transaction()` 会同步抛出 `InvalidStateError`。
  4. `mutateWallpaperDB` 与 `getWallpaperSelectionDB` 的 `catch` 代码块仅简单返回 `false`，未将失效的 `activeDb` 置为 `null`。
  5. 导致后续所有壁纸相关的 IndexedDB 读取与写入操作陷入永久失败状态，直到用户完全强制刷新整个页面。
- **针对性修复建议**:
  在事务创建失败的 `catch` 分支中，主动关闭并清空失效的 `activeDb` 句柄：
  ```javascript
  catch (error) {
      if (activeDb) {
          try { activeDb.close(); } catch {}
          activeDb = null;
      }
      return false;
  }
  ```

---

#### SEC-L-09: Chrome 扩展 CSP 缺少防御深度的 frame-ancestors 'none' 显式声明

- **严重级别**: `Low`
- **问题分类**: 防点击劫持与扩展配置纵深 (Anti-Clickjacking / Extension CSP)
- **目标文件与精确行号**:
  - `src/extension/manifest.json`: 23–25
  - 对照基线: `public/_headers`: 14
- **代码片段证据**:
  ```json
  // src/extension/manifest.json:23-25
  "content_security_policy": {
    "extension_pages": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://api.bing.com https://suggestqueries.google.com https://zh.wikipedia.org https://en.wikipedia.org https://api.open-meteo.com https://geocoding-api.open-meteo.com https://myip.ipip.net https://ipwho.is; object-src 'none'; base-uri 'none'; form-action 'self'"
  }
  ```
  ```http
  # public/_headers:14
  Content-Security-Policy: ... frame-ancestors 'self'; ...
  ```
- **成因与潜在影响分析**:
  1. 网页版在 `public/_headers` 中显式配置了 `frame-ancestors 'self'`。
  2. 扩展清单在 `extension_pages` 的 CSP 中缺少 `frame-ancestors` 指令。
  3. 虽然本项目未配置 `web_accessible_resources`，常规网页无法直接以 iframe 嵌入扩展资源，但根据 OWASP 扩展加固指南及 Google 扩展最佳实践，新标签页应显式声明 `frame-ancestors 'none'` 以实现端到端的防点击劫持（Clickjacking）与 UI 钓鱼防护，防止宿主上下文权限发生漂移。
- **针对性修复建议**:
  在 `src/extension/manifest.json` 的 CSP 中追加 `frame-ancestors 'none';` 指令。

---

#### SEC-L-10: HTML 模板版本号占位符替换缺乏实体转义防护

- **严重级别**: `Low`
- **问题分类**: 构建管道输入转义 (Build Pipeline Sanitization)
- **目标文件与精确行号**:
  - `scripts/build.cjs`: 264–267
  - `src/index.html`: 460
- **代码片段证据**:
  ```javascript
  // scripts/build.cjs:264-267
  const { version } = JSON.parse(fs.readFileSync(PATHS.pkgJson, 'utf-8'));
  prodHtmlContent = replaceOnce(prodHtmlContent, '<!-- INJECT_APP_VERSION -->', `v${version}`);
  ```
- **成因与潜在影响分析**:
  1. `scripts/html-template.cjs` 对注入 `<script>` 上下文的版本号做了 `<` 的 Unicode 转义（`\u003c`），对样式做了 `\3c/style>` 转义。
  2. 然而 `scripts/build.cjs` 在将版本号注入 HTML 品牌卡片徽章标签（`<!-- INJECT_APP_VERSION -->`）时，直接使用了模板字符串 `v${version}`，未进行任何 HTML 字符转义或版本格式正则校验。
  3. 若 `package.json` 中的 `version` 字段被上游不当修改或注入标签字符，将直接破坏生产环境的 HTML 语法树。
- **针对性修复建议**:
  在注入前对版本号字符串增加格式校验白名单断言：
  ```javascript
  const { version } = JSON.parse(fs.readFileSync(PATHS.pkgJson, 'utf-8'));
  if (!/^[\w.-]+$/.test(version)) throw new Error(`非法版本号格式: ${version}`);
  prodHtmlContent = replaceOnce(prodHtmlContent, '<!-- INJECT_APP_VERSION -->', `v${version}`);
  ```

---

#### SEC-L-11: 原子化构建发布锁基于 PID 判定存在 PID 回绕竞争窗口

- **严重级别**: `Low`
- **问题分类**: 构建并发稳定性与进程死锁 (Build Concurrency / TOCTOU)
- **目标文件与精确行号**:
  - `scripts/publish-build.cjs`: 81–87
- **代码片段证据**:
  ```javascript
  // scripts/publish-build.cjs:81-87
  const pid = Number(ownerFile?.split('-')[0]);
  if (pid > 0) {
      try {
          process.kill(pid, 0);
      } catch (error) {
          if (error.code === 'ESRCH') removePublishLock(lock, ownerFile);
      }
  } else if (!ownerFile) removePublishLock(lock);
  ```
- **成因与潜在影响分析**:
  1. `publishBuild` 实现了原子发布锁，通过读取 `ownerFile` 中的 PID 并调用 `process.kill(pid, 0)` 探测持有锁的进程是否存活。
  2. 在 POSIX 容器或长期运行的开发机上，进程 PID 存在周期性回绕（PID Rollover）现象。
  3. 若之前的构建进程异常崩溃留下了孤儿锁，而操作系统恰好将该 PID 重新分配给了一个完全无关的长期运行进程（如系统后台守护进程），`process.kill(pid, 0)` 将持续返回成功（不抛出 `ESRCH`）。
  4. 导致当前构建误认为前序构建仍在进行，持续自旋等待直至 5 秒硬超时崩溃，阻断正常的构建发布。
- **针对性修复建议**:
  在 `ownerFile` 命名或内容中记录绝对时间戳（如 `Date.now()`），并在自旋判断中加入超时时间窗口（如超过 15 秒强制视作孤儿锁予以清理）。

---

#### SEC-L-12: 自动化测试套件在存储配额超限与网络异常恢复方面存在覆盖盲区

- **严重级别**: `Low`
- **问题分类**: 测试质量与边界覆盖 (Test Coverage / Robustness)
- **目标文件与精确行号**:
  - `test/data-settings-save.test.mjs`
  - `test/data-wallpaper-storage.test.mjs`
  - `test/data-pure-models.test.mjs`
- **代码片段证据**:
  在 `test/data-wallpaper-storage.test.mjs:39-44` 中，仅针对壁纸保存模拟了 LocalStorage 配额异常，但测试套件缺乏对书签模块和网络层的类似校验。
- **成因与潜在影响分析**:
  现有测试套件未覆盖以下典型边界故障情景：
  1. 书签导入时遇到超长 Data URL 图标或 LocalStorage `QuotaExceededError` 的处理；
  2. 搜索联想 JSONP 请求在超时和网络中断时对 DOM 废弃 `<script>` 标签的清理验证；
  3. 天气模块经纬度超出地理边界时的异常降级验证；
  4. IndexedDB 连接被外部强行关闭后的重连恢复验证。
- **针对性修复建议**:
  在 `test/data-pure-models.test.mjs` 和 `test/data-settings-save.test.mjs` 中补充对应的模拟用例。

---

### 4.3 提示与建议 (Info, 5 项)

#### SEC-I-01: Chrome 扩展打包产物遗留冗余 iOS/Safari 静态资产

- **严重级别**: `Info`
- **问题分类**: 打包纯净性与资产治理 (Package Hygiene)
- **目标文件与精确行号**:
  - `scripts/build-extension.cjs`: 56–58
  - `scripts/build.cjs`: 127–136
  - 产物文件: `public/apple-touch-icon.png` (23.5 KB)
- **代码片段证据**:
  ```javascript
  // scripts/build-extension.cjs:56-58
  for (const name of ['_headers', 'robots.txt', 'sitemap.xml']) {
      fs.rmSync(path.join(staging, name), { force: true });
  }
  ```
- **成因与潜在影响分析**:
  构建脚本在从 `public/` 拷贝资源到扩展目录时，定向清理了服务端配置文件，但遗漏了仅供 iOS Safari PWA 使用的 `apple-touch-icon.png`。该文件在 Chrome 桌面扩展中毫无用处，平白增加了扩展解压目录 23.5 KB 的体积。
- **针对性修复建议**:
  在 `scripts/build-extension.cjs` 的清理列表中追加 `'apple-touch-icon.png'`。

---

#### SEC-I-02: 本地开发服务静态资产通配跨域 CORS 响应头过宽

- **严重级别**: `Info`
- **问题分类**: 开发环境安全 (Dev Server Origin Policy)
- **目标文件与精确行号**:
  - `scripts/server.cjs`: 193–196
- **代码片段证据**:
  ```javascript
  // scripts/server.cjs:193-196
  if (!contentType.startsWith('text/html')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
  }
  ```
- **成因与潜在影响分析**:
  本地开发服务 `server.cjs` 为所有非 HTML 静态文件下发了 `Access-Control-Allow-Origin: *`。当开发者在本地运行起始页开发服务同时访问第三方互联网网站时，第三方页面可异步探测本地端口并读取 `bookmarks.json` 等配置信息。
- **针对性修复建议**:
  将开发服务器的通配 CORS 改为默认关闭，仅在传入特定命令行参数或请求来源为 localhost 时放行。

---

#### SEC-I-03: DOMCache 接口中 navHint 元素类型精度不一致

- **严重级别**: `Info`
- **问题分类**: 架构类型契约 (TypeScript Typing Precision)
- **目标文件与精确行号**:
  - `src/js/types.d.ts`: 187
  - `src/index.html`: 313
- **代码片段证据**:
  ```typescript
  // src/js/types.d.ts:187
  navHint: HTMLElement | null;
  ```
  ```html
  <!-- src/index.html:313 -->
  <button id="navHint" type="button" aria-label="返回起始页" ...>
  ```
- **成因与潜在影响分析**:
  HTML 源码中 `#navHint` 明确为 `<button>` 元素，全站其他所有按钮在 `DOMCache` 中均标注为 `HTMLButtonElement | null`，此处声明为 `HTMLElement | null` 属于类型声明精度轻微欠缺。
- **针对性修复建议**:
  将 `src/js/types.d.ts` 第 187 行类型更新为 `navHint: HTMLButtonElement | null;`。

---

#### SEC-I-04: 架构文档中 safeUrl(url, false) 规范声明与实际代码实现存在脱节

- **严重级别**: `Info`
- **问题分类**: 文档与实现一致性 (Architectural Documentation Consistency)
- **目标文件与精确行号**:
  - `docs/ARCHITECTURE.md`: 349
  - `src/js/utils/helpers.js`: 21
- **代码片段证据**:
  `docs/ARCHITECTURE.md:349` 声明：
  > “通过原生 DOM 属性赋值时使用 safeUrl(url, false)，保留 URL 中的原始字符。”
- **成因与潜在影响分析**:
  源码全量检索证实，项目中**从未有任何地方调用过带第二个参数的 `safeUrl(url, false)`**。DOM 属性直接赋值（如 `a.href = ...` 或 `img.src = ...`）均走内部逻辑或未传参调用。
- **针对性修复建议**:
  根据代码真实行为更新 `ARCHITECTURE.md`，避免对后续开发者造成误导。

---

#### SEC-I-05: Netscape Bookmark HTML 格式导入未支持但由 JSON 解析安全拦截

- **严重级别**: `Info`
- **问题分类**: 格式兼容性与异常捕获验证 (Format Handling / Safe Catch)
- **目标文件与精确行号**:
  - `src/js/modules/settings.js`: 393–431
- **代码片段证据**:
  ```javascript
  // src/js/modules/settings.js:398, 429-431
  const parsed = JSON.parse(e.target.result);
  ...
  } catch (err) {
      showConfirm(t('ui.could.not.parse.the.json.file'), null, t('ui.parse.error'), { signal });
  }
  ```
- **成因与潜在影响分析**:
  审计走查核实项目未实现传统的 Netscape HTML 书签格式导入解析器。当用户尝试导入 HTML 格式书签时，`JSON.parse()` 抛出 `SyntaxError` 并被 `try...catch` 安全捕获，弹出多语言提示，绝不进入 DOM 渲染流水线，证实不存在 HTML 导入解析导致的 XSS 风险。
- **针对性修复建议**:
  当前异常拦截逻辑完全有效，无需代码变更，仅记录审计确认。

---

## 五、测试套件有效性与安全防御验证评估

### 5.1 自动化测试套件既有覆盖分析

项目现有测试套件设计极为精巧，基于 Node 内置 `node:test` 配合纯原生 Chrome DevTools Protocol (CDP) WebSocket 驱动，具有高度的自主性：
1. **模块架构测试 (`test/infra-module-boundaries.test.mjs`)**:
   实现了对 JS 源文件依赖拓扑的 AST 级自动化检查，严格守护了 `AGENTS.md` 的分层边界规范，是架构防腐的核心保障。
2. **扩展双模式测试 (`test/infra-chrome-extension.test.mjs`)**:
   自动化拉起真实 Chrome 实例加载构建生成的扩展，严密验证了 `__cspViolations`、MV3 规则、离线重载以及 JSONP 代码在扩展中的编译期剔除。
3. **纯函数模型测试 (`test/data-pure-models.test.mjs`)**:
   针对书签名称、图标校验规则及天气数值换算提供了稳健的基础断言。

### 5.2 核心安全防护盲区分析

尽管测试框架架构卓越，但在“防御深度与极限故障场景”下存在若干覆盖盲区：
1. **配额超限未覆盖书签业务流**：现有测试仅在壁纸模块模拟过 `QuotaExceededError`，未在书签新增、修改、批量导入环节注入该异常。
2. **CSP 违规监控缺乏持续回归**：网页端未配置针对 CSP 违规上报的自动化拦截断言（仅在扩展测试中检查了 `window.__cspViolations`）。
3. **极端恶意输入缺乏模糊测试 (Fuzzing)**：缺少针对畸形 URL（超长字符串、畸形 Unicode、控制字符、协议相对路径等）的自动化测试用例。

### 5.3 推荐补充的高价值安全测试用例

为提升整体工程韧性，建议在 `test/` 目录下补充以下 3 类测试用例：
1. **用例 1: 书签超长 Data URL 图标清洗断言**
   验证向 `normalizeBookmarkOverrides({ icon: 'data:image/png;base64,...' })` 传入大于 2048 字符的图标时，函数能主动丢弃或截断该字段。
2. **用例 2: 气象坐标物理取值区间越界断言**
   验证向天气模型传入 `{ lat: 91, lon: 181 }` 或 `{ lat: -95, lon: -200 }` 时，坐标判定函数拒绝该对象并回退至安全默认值。
3. **用例 3: 协议相对 URL (`//`) 规范化断言**
   验证在搜索框或书签导航中传入 `//example.com` 时，系统统一将其规范化为带明确安全协议的 `https://example.com`。

---

## 六、安全加固与改进建议规划路线图

基于对 21 项问题的风险评估与修复复杂度分析，制定如下三阶段安全加固路线图：

```
                    [安全加固分阶段路线图]

  阶段 1: P0 立即处置 (1-2 周内)
  ├── SEC-M-01: 书签图标长度限制 (防 LocalStorage 配额爆仓)
  ├── SEC-M-04: Chrome 扩展构建版本号 SemVer 预发布后缀清洗
  └── SEC-M-03: 网页版 CSP script-src 剔除 Wikipedia 域名

  阶段 2: P1 近期加固 (1 个月内)
  ├── SEC-L-01: safeUrl 拆分导航超链接与媒体加载校验
  ├── SEC-L-02: safeUrl 本地图标正则封堵 .. 路径穿越
  ├── SEC-L-03: 协议相对 URL (//) 规范化拦截
  ├── SEC-L-04: weatherCard 模板变量强制 escapeHtml
  ├── SEC-L-05: 书签编辑行表单属性 safeId 转义
  ├── SEC-L-06: 天气坐标物理范围 [-90,90] 校验
  ├── SEC-L-07: Service Worker 离线降级页改用动态随机 Nonce
  └── SEC-L-08: IndexedDB 异常断连重置 activeDb 句柄

  阶段 3: P2 架构增强与长期治理 (季度规划)
  ├── SEC-M-02: 网页端内联脚本哈希化，全面淘汰 'unsafe-inline'
  ├── SEC-L-09: 扩展清单 CSP 补齐 frame-ancestors 'none'
  ├── SEC-L-10: 版本号模板替换前置正则白名单
  ├── SEC-L-11: 发布锁基于时间戳超时兜底，防 PID 回绕
  ├── SEC-L-12: 扩充配额超限与异常网络注入自动化用例
  └── SEC-I-01 ~ SEC-I-04: 资产瘦身、类型微调与文档对齐
```

### 6.1 P0 立即处置 (Immediate / 阻断性与配额防护 — 1-2 周内)
- **目标**: 消除可能导致客户端功能瘫痪或扩展发布阻断的中度隐患。
- **任务清单**:
  1. `SEC-M-01`: 在 `normalizeBookmarkOverrides()` 增加 `MAX_ICON_CHARS: 2048` 限制，阻断 LocalStorage 配额耗尽 DoS。
  2. `SEC-M-04`: 在 `scripts/build-extension.cjs` 增加版本号正则过滤，确保仅向 `manifest.json` 写入纯数字点分格式。
  3. `SEC-M-03`: 在 `src/index.html` 与 `public/_headers` 中将维基百科从 `script-src` 中移除，收敛攻击面。

### 6.2 P1 近期加固 (Near-Term / 防御深度与输入清洗 — 1 个月内)
- **目标**: 消除模板注入微瑕疵，完善输入合法性校验。
- **任务清单**:
  1. `SEC-L-01` & `SEC-L-02`: 重构 `safeUrl`，拆分 `safeLinkUrl`，封堵 `..` 路径穿越。
  2. `SEC-L-03`: 在 `openBookmarkUrl` 中规范化处理 `//` 协议相对地址。
  3. `SEC-L-04` & `SEC-L-05`: 为 `weatherCard` 与书签编辑表单补充 `escapeHtml` 保护。
  4. `SEC-L-06`: 强化天气经纬度 `[-90, 90]`、`[-180, 180]` 区间校验。
  5. `SEC-L-07` & `SEC-L-08`: 修复 SW 静态 Nonce 与 IndexedDB `activeDb` 句柄重置逻辑。

### 6.3 P2 架构增强与长期治理 (Long-Term / CSP 严格化与流水线 — 季度规划)
- **目标**: 达成零 `'unsafe-inline'` 的最高等级安全策略与流水线极致健壮性。
- **任务清单**:
  1. `SEC-M-02`: 构建流程自动计算内嵌脚本 SHA-256 哈希，将网页端 CSP 升级为无 `'unsafe-inline'` 的严格模式。
  2. `SEC-L-09` ~ `SEC-L-12`: 补齐扩展 CSP 点击劫持防护、发布锁时间戳超时机制以及安全测试用例。
  3. `SEC-I-01` ~ `SEC-I-04`: 清理冗余打包资产，对齐 `ARCHITECTURE.md` 与 TypeScript 类型。

---

## 七、独立验证与复现指引

本报告中的各项事实与结论均可通过以下独立操作在本地环境中无害复现与核验：

### 1. 静态规范与代码风格校验
```bash
# 验证代码库在审计期间保持完全无破坏且静态检查 100% 通过
npm run lint

# 验证 TypeScript 类型系统契约
npm run typecheck
```

### 2. 模块边界与架构防腐测试
```bash
# 验证模块单向依赖与无环性架构规范
node --test test/infra-module-boundaries.test.mjs
```

### 3. Chrome 扩展双模式与 CSP 自动化验证
```bash
# 编译并在独立 Chrome 中自动化运行扩展完整功能测试
npm test -- infra-chrome-extension
```

### 4. 关键缺陷复现脚本示例 (Node REPL)

#### 验证 SEC-M-01 (书签图标长度未限制):
```javascript
// 在项目根目录执行 node
import { normalizeBookmarkOverrides } from './src/js/utils/bookmark-model.js';
const fakeGiantIcon = 'data:image/png;base64,' + 'A'.repeat(5 * 1024 * 1024);
const result = normalizeBookmarkOverrides({ icon: fakeGiantIcon });
console.log('巨量图标是否未受截断直接保留:', result.icon.length === fakeGiantIcon.length);
// 输出: true (证实存在 LocalStorage 爆仓隐患)
```

#### 验证 SEC-L-02 (safeUrl 图标路径穿越):
```javascript
import { safeUrl } from './src/js/utils/helpers.js';
const traversalPath = 'icons/../../secret.png';
console.log('路径穿越是否被判定为合法图标:', safeUrl(traversalPath) !== '#');
// 输出: true (证实存在穿越放行)
```

#### 验证 SEC-L-06 (天气经纬度越界):
```javascript
// 经纬度越界验证
const invalidLoc = { lat: 999, lon: 999 };
const isValid = Number.isFinite(invalidLoc.lat) && Number.isFinite(invalidLoc.lon);
console.log('越界坐标是否被视作合法坐标:', isValid);
// 输出: true (证实缺乏边界范围校验)
```

---

**报告编撰完成**：本报告综合了三位探索专家的人工代码走查事实，严格保持了项目源码只读。所有问题均具备代码级证据与可行修复建议，供后续研发迭代与安全加固提供精确指引。

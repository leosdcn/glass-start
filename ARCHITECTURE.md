# Glass Start 架构设计与核心技术白皮书 (Architecture Whitepaper)

本文档系统性剖析 **Glass Start（玻璃拟态极简起始页与分类导航）** 的底层软件工程架构、有限状态机、弹窗优先级层叠栈、Service Worker 离线网络底座以及搜索与气象智能演化引擎。

> 🤖 **AI 编程行为准则**：关于 AI 编程助手的 7 大工程红线与分级自愈流水线，请参阅 ➔ [**AI 编程行为宪法 (AGENTS.md)**](./AGENTS.md)。
> 
> 📖 **全站功能与部署指南**：关于全站使用指南、书签规范、命令清单与依赖版本，请参阅 ➔ [**项目主说明文档 (README.md)**](./README.md)。

---

## 目录
- [1. 🏗️ 系统全景分层与模块拓扑架构 (High-Level Layer Architecture)](#1-️-系统全景分层与模块拓扑架构-high-level-layer-architecture)
- [2. 🔄 双屏切屏状态机、手势与 BFCache 全生命周期流转 (Screen State & BFCache Lifecycle)](#2--双屏切屏状态机手势与-bfcache-全生命周期流转-screen-state--bfcache-lifecycle)
- [3. 📚 OverlayStack 多层弹窗层叠栈与 Escape 统一退栈决策 (OverlayStack & Modal Flow)](#3--overlaystack-多层弹窗层叠栈与-escape-统一退栈决策-overlaystack--modal-flow)
- [4. 📴 Service Worker 三池隔离与离线数据流向 (Storage & Cache Topology)](#4--service-worker-三池隔离与离线数据流向-storage--cache-topology)
- [5. 🔍 智能搜索三级模糊匹配与气象 9 阶动态演化决策 (Search & Weather Decision Engine)](#5--智能搜索三级模糊匹配与气象-9-阶动态演化决策-search--weather-decision-engine)

---

### 1. 🏗️ 系统全景分层与模块拓扑架构 (High-Level Layer Architecture)

```mermaid
flowchart TB
    %% ======================= LAYER 1: UI & HARDWARE RENDERING =======================
    subgraph L1 [" 1. UI 表现与硬件渲染层 (Presentation & Hardware Rendering) "]
        direction TB
        TW4["Tailwind CSS v4 编译管道<br/>@theme 原生 CSS 变量"]
        LG["Liquid Glass 毛玻璃拟态引擎<br/>backdrop-blur / glass-strong / CSS Mask"]
        PMG["Pointer Motion Gating 光影守卫<br/>--mouse-x / --mouse-y / RAF 帧合并"]
        T3D["3D Perspective 陀螺仪矩阵<br/>perspective(800px) rotateX/Y scale(1.025)"]
        A11Y_MOT["动态感知降级门控<br/>prefers-reduced-motion / (hover: hover)"]
    end

    %% ======================= LAYER 2: STATE MACHINE & INTERACTION =======================
    subgraph L2 [" 2. 状态机与交互路由层 (State Machine & Interaction Routing) "]
        direction TB
        SM["双屏状态机 (Dual-Screen SM)<br/>state.currentSection: 'start' ↔ 'nav'"]
        WHEEL["滚轮动量吞咽器 (Momentum Swallower)<br/>normDelta / 速度门控 / 反向手势即时熔断"]
        TOUCH["触屏手势处理器 (Touch Engine)<br/>40px 阈值 / 25px+0.25px/ms 快速轻扫 (Flick)"]
        ROUTER["修饰键分流器 (Modifier Dispatcher)<br/>Cmd / Ctrl / 鼠标中键 (button: 1) 新标签分流"]
        FOCUS_TRAP["无障碍焦点循环陷阱 (Focus Trap)<br/>Tab / Shift+Tab 循环锁定"]
    end

    %% ======================= LAYER 3: DATA MANAGEMENT & STORAGE =======================
    subgraph L3 [" 3. 数据管理与本地持久化层 (Data Management & Local Persistence) "]
        direction TB
        RUNTIME["pageData 响应式内存模型<br/>{ bookmarks, categories, customMeta }"]
        MIGRATION["LocalStorage 迁移与写入<br/>SCHEMA_VERSION 校验 / 脏数据收敛清洗"]
        ASSET_STORE["自定义壁纸与图标持久化<br/>DataURL Base64 / LocalStorage / 预设壁纸"]
        FALLBACK_JSON["静态数据库默认回退<br/>bookmarks.json 派生式元数据生成 (Derived BM)"]
    end

    %% ======================= LAYER 4: SERVICE WORKER & SECURITY =======================
    subgraph L4 [" 4. 离线运行与网络服务底座 (Offline Runtime & Service Worker Base) "]
        direction TB
        SW_THREAD["Service Worker 独立线程 (sw.js)<br/>skipWaiting / clients.claim"]
        THREE_CACHE["三池隔离缓存模型 (Three-Pool Isolation)<br/>CORE_CACHE | FAVICON_CACHE | IMG_CACHE"]
        FIFO_PRUNE["FIFO 自动容量淘汰引擎<br/>MAX_FAVICON(800) | MAX_IMG(200)"]
        CSP_SEC["Edge / CSP 安全隔离标头<br/>connect-src / img-src 通配 / Strict-Transport-Security"]
    end

    %% ======================= RELATIONSHIPS =======================
    L1 <-->|"DOM 事件监听 / CSS 变量绑定"| L2
    L2 <-->|"状态同步 / 派生数据驱动"| L3
    L3 <-->|"静态资源与数据预存"| L4

    TW4 -.-> LG
    LG -.-> PMG
    PMG -.-> T3D
    A11Y_MOT ==>|禁用动效| T3D

    SM <--> WHEEL
    SM <--> TOUCH
    SM --- ROUTER
    L2 --- FOCUS_TRAP

    RUNTIME <--> MIGRATION
    RUNTIME <--> ASSET_STORE
    MIGRATION -.->|缺省回退| FALLBACK_JSON

    SW_THREAD --> THREE_CACHE
    THREE_CACHE --> FIFO_PRUNE
    SW_THREAD --- CSP_SEC

    %% ======================= STYLES =======================
    classDef layerBox fill:#1e293b,stroke:#3b82f6,stroke-width:2px,color:#f8fafc,rx:8px
    classDef nodeBox fill:#0f172a,stroke:#64748b,stroke-width:1px,color:#e2e8f0,rx:5px
    classDef activeBox fill:#1e3a8a,stroke:#60a5fa,stroke-width:1px,color:#ffffff,rx:5px

    class L1,L2,L3,L4 layerBox
    class TW4,LG,PMG,T3D,A11Y_MOT,SM,WHEEL,TOUCH,ROUTER,FOCUS_TRAP,RUNTIME,MIGRATION,ASSET_STORE,FALLBACK_JSON,SW_THREAD,THREE_CACHE,FIFO_PRUNE,CSP_SEC nodeBox
    class SM,THREE_CACHE,RUNTIME,LG activeBox
```

#### 💡 技术原理解析
1. **表现层与 GPU 硬件加速**：系统采用 Tailwind CSS v4 原子化引擎配合 CSS 变量进行纯 GPU 复合图层渲染。通过 Pointer Motion Gating 与 `requestAnimationFrame` 合并帧计算，仅在指针接近卡片边界（$\pm 4\text{px}$）时激活 3D 矩阵视差变换；搜索框仅应用光斑高光而不做 3D 倾斜，避免输入打字时光标抖动。
2. **状态与交互路由层**：通过双屏有限状态机解耦第一屏（Start）与第二屏（Nav），辅以滚轮动量吞咽器与触屏滑动引擎。针对 Mac 触控板高频惯性与跨屏误触，设立速度门控与反向打断机制。
3. **数据管理与派生架构**：采用单向数据流与派生式架构（Derived Bookmark Architecture），快捷书签仅存储 URL 索引，其标题、图标与分类均由 `bookmarks.json` 全量数据库动态派生，兼顾了用户自定义灵活性与全局数据实时同步能力。
4. **离线基座与安全屏障**：Service Worker 实施三池物理隔离，配合 `_headers` 的严格 CSP 与 HSTS，既保证离线可用性，又防范跨域数据投毒与 CSS/JS 缓存穿透。

---

### 2. 🔄 双屏切屏状态机、手势与 BFCache 全生命周期流转 (Screen State & BFCache Lifecycle)

```mermaid
flowchart TD
    %% ======================= NODES & STATES =======================
    START_STATE(["🟢 首屏态 (Start Section)<br/>-- Section: 'start' / #startSection 居中展示 --"]):::stateNode
    NAV_STATE(["🔵 导航页态 (Nav Section)<br/>-- Section: 'nav' / #navSection 激活展示 --"]):::stateNode
    TRANS_STATE{"🟡 过渡互斥态 (isTransitioning)<br/>-- 动画耗时 580ms 锁定操作 --"}:::transNode

    %% ======================= TRIGGERS START -> NAV =======================
    subgraph T_DOWN [" ⬇️ 切换至导航页触发条件 (To Nav Triggers) "]
        W1["滚轮向下 Wheel Down<br/>(单步 >= 100px 或 velocity > 1.2 ➔ 阈值降至 60px<br/>常规累积 >= 120px)"]
        T1["触屏向上滑动 Touch Move / End<br/>(deltaY >= 40px 或 Flick 快速轻扫)"]
        K1["键盘操作 Keyboard<br/>(ArrowDown / PageDown 且非输入态)"]
    end

    %% ======================= TRIGGERS NAV -> START =======================
    subgraph T_UP [" ⬆️ 切换回首屏触发条件 (To Start Triggers) "]
        W2["滚轮向上 Wheel Up<br/>(navContent.scrollTop <= 0 且累积 >= 阈值)"]
        T2["触屏向下滑动 Touch Move / End<br/>(navContent.scrollTop <= 0 且 deltaY <= -40px)"]
        K2["键盘操作 Keyboard<br/>(ArrowUp / PageUp / Home 且 scrollTop <= 0)"]
        H2["点击返回 Header / Hint<br/>(点击顶栏 navHeader 或 顶部提示图标)"]
    end

    %% ======================= BFCACHE & LIFECYCLE =======================
    subgraph BF_CYCLE [" 🛡️ BFCache 与全生命周期自愈闭环 (Lifecycle Healing) "]
        PAGEHIDE["页面挂起 pagehide / blur<br/>(跳转外链 / 切换标签页)"]
        TAB_BLUR["设置 body.tab-blurred 状态<br/>(失焦并解除一切 hover / active 伪类)"]
        PAGESHOW["页面唤醒 pageshow / focus<br/>(浏览器后退 / 重新聚焦)"]
        RECONCILE["纯内存瞬时自愈 reconcileScreenState()<br/>1. 清空 transitionTimer 定时器<br/>2. 强置 isTransitioning = false<br/>3. 重置 swallowMomentum / swallowDir<br/>4. 移除所有 .is-clicked / nr 标志<br/>5. 对齐 scrollTop = 0 与 transform 矩阵"]
    end

    %% ======================= FLOW PATHS =======================
    START_STATE --> T_DOWN
    T_DOWN -->|触发切屏 switchToNav| TRANS_STATE
    TRANS_STATE -->|动画就绪 / 延后 RAF 执行| NAV_STATE

    NAV_STATE --> T_UP
    T_UP -->|触发切屏 switchToStart| TRANS_STATE
    TRANS_STATE -->|动画结束 / 移除 nav-visible| START_STATE

    NAV_STATE -.->|"外链跳转"| PAGEHIDE
    START_STATE -.->|"外链跳转"| PAGEHIDE
    PAGEHIDE --> TAB_BLUR
    TAB_BLUR --> PAGESHOW
    PAGESHOW --> RECONCILE
    RECONCILE ==>|"瞬时对齐状态 (immediate=true)"| START_STATE
    RECONCILE ==>|"瞬时对齐状态 (immediate=true)"| NAV_STATE

    %% ======================= STYLES =======================
    classDef stateNode fill:#0f172a,stroke:#3b82f6,stroke-width:2px,color:#ffffff,rx:8px
    classDef transNode fill:#1e293b,stroke:#eab308,stroke-width:2px,color:#fef08a,rx:8px
    classDef triggerBox fill:#1e293b,stroke:#64748b,stroke-width:1px,color:#cbd5e1,rx:6px

    class T_DOWN,T_UP,BF_CYCLE triggerBox
```

#### 💡 技术原理解析
1. **滚轮动量吞咽与反向熔断**：在从 Start 屏快速滑动进入 Nav 屏后，触控板产生的物理动量会持续 1~3 秒。系统开启 `swallowMomentum = true`，吞掉持续的同向事件，防止动量直接穿透导致导航页书签被意外跳滚；一旦检测到用户反向滚动（`curDir !== swallowDir`）或静默间隔超过 140ms（`MOMENTUM_QUIET_MS`），吞咽器立即熔断放行。
2. **零 Reflow 触屏手势引擎**：触摸事件通过对比 $X/Y$ 轴位移比率（`deltaX > absDeltaY` 则判定为侧边栏横滑并放行原生滚动），在垂直滑动达到 40px 阈值或满足 Flick 轻扫（位移 $\ge 25\text{px}$ 且速度 $> 0.25\text{px/ms}$）时瞬间触发切换。
3. **BFCache 与多标签唤醒幂等自愈**：当用户点击书签跳转后退或在多标签页之间切回时，页面经 BFCache 或后台唤醒恢复。双通道捕获（`pageshow` + `visibilitychange`）后调用 `reconcileScreenState(undefined, true)`，无视过渡动画直接在单帧内清空互斥锁、消除定时器、校准 `scrollTop` 与 DOM 类名，并无条件通过 `display` 瞬态重置（`display: none` ➔ `void offsetHeight` ➔ `display: ''`）强制 WebKit 重新分配 GPU Backing Store 磁贴，根绝离屏图层白屏。
4. **构建指纹黑匣子与三级自愈阶梯**：`window.__GLASS_DIAG__`（verify/probe/dump/log）在启动时校验 HTML 内联指纹 `__GLASS_BUILD_HTML__` 与 app.js 头部指纹 `__GLASS_BUILD_APP__` 的同版契约（不一致 → 60s 冷却期守卫单次刷新）；双屏 transform 过渡结束后执行健全性探测（当前在位屏变换矩阵 ≈ 单位阵 + 哨兵元素可见，支持 `window.state` 与 DOM 类名双重校验），连续异常按 L1 幂等校准 → L2 合成层磁贴强制重栅格化 → L3 冷却守卫刷新升级。全过程记录于**纯内存环形日志**（≤40 条，零存储写入；BFCache 恢复不重置 JS 堆，天然覆盖偶发白屏的被动取证窗口）；无任何 UI 诊断面板，现场经控制台 `dump()` 导出，L3 自刷新瞬间一次性落 `gs_last_heal` 面包屑跨刷新留痕。

#### 🛡️ BFCache 与页面生命周期失步 5 大暗坑防线 (Lifecycle Anti-Patterns & Defenses)

| 经典陷阱类别 | 错误本质与致命代价 | 工业级避坑标准与 Glass Start 防御实现 |
| :--- | :--- | :--- |
| **1. 语义污染与隐式副作用**<br>*(Class Name Semantic Pollution)* | 将具有强破坏性推屏布局的类名（`.nr` 强推首屏至 `-100dvh`）误当通用禁用动画类；若在首屏唤醒未剥离，JS 以为在首屏，CSS 却将首屏推飞，导致两屏错乱。 | **严格入口剥离**：`reconcileScreenState`、`switchToNav`、`switchToStart` 入口首行均同步执行 `document.documentElement.classList.remove('nr')`，配合自动化断言守门。 |
| **2. 异步跨帧竞态反模式**<br>*(Async Inter-Frame Race Condition)* | 采用 `el.style.transition = 'none'` + `rAF` 异步清除；后台标签页被浏览器完全冻结 `rAF` 时，残留内联样式在唤醒瞬间破坏 CSS 动画，导致屏幕卡死。 | **纯声明式状态类**：绝不常驻内联样式修改，100% 依托 `.screen-pushed-up` 等状态类驱动，唤醒自愈时同步清空 `startSection` / `nav` 内联脏样式。 |
| **3. 生命周期事件模型割裂**<br>*(Lifecycle Fragmentation)* | 混淆 BFCache 唤醒（仅触发 `pageshow`）与多标签页切回（仅触发 `visibilitychange`）；若仅监听单边事件，另一侧唤醒即成为无监管死锁盲区。 | **双保险全量收敛**：统一提炼 `handleAppWakeUp()`，同时向 `visibilitychange` (`!document.hidden`) 与 `pageshow` 注册，单点实现多标签与 BFCache 统一自愈。 |
| **4. CSS 动画时间穿越隐患**<br>*(CSS Animation Rewind Issue)* | 让带有 `animation-fill-mode: backwards` 的入场动画类（`.fade-in`、`.animate-item-in`）常驻 DOM；WebKit 从 BFCache 解冻唤醒时重估动画并回滚至 `opacity:0` 造成页面不可见。 | **入场后主动脱壳卸载**：页面首屏入场后 800ms 自动卸载 `.fade-in`，新增条目通过 `animationend` 同步卸载 `.animate-item-in`，唤醒时全局扫除动画类，保持静态 DOM。 |
| **5. 离屏图层磁贴失栅格化**<br>*(Stale Tile Rasterization)* | 长期离屏或后台挂起的 `fixed` 双屏图层（`-100dvh` 推移 + `will-change: transform`）在多标签页切回 (`visibilitychange`) 或 BFCache 唤醒时，WebKit 会主动丢弃 GPU 离屏磁贴，导致首屏或导航屏整片空白。单纯修改 `willChange` 无法触发重绘。 | **双通道瞬态重排重栅格化 + 探针双断言闭环**：`handleAppWakeUp()` 彻底移除单边 `wasPersisted` 限制，全量覆盖 `visibilitychange` 与 `pageshow`，通过 `display: none` ➔ `void offsetHeight` ➔ `display: ''` 瞬态重置强制 WebKit 重新分配 GPU Backing Store 磁贴；黑匣子挂载 `window.state` 并联动 `.screen-pushed-in` 物理 DOM 双断言，异常时由 L2 自动触发重栅格化。 |

---

### 3. 📚 OverlayStack 多层弹窗层叠栈与 Escape 统一退栈决策 (OverlayStack & Modal Flow)

```mermaid
flowchart TD
    %% ======================= LAYERS STACK =======================
    subgraph Z_INDEX [" 📐 严格 z-index 层叠模型体系 (Layer Hierarchy) "]
        direction TB
        L4["Layer 4 (z-9999 / var(--z-alert))<br/>• confirmModal (高危操作二次确认对话框)"]:::l4
        L3["Layer 3 (z-2000 / var(--z-picker))<br/>• bookmarkPicker (从导航页提取快捷书签)<br/>• shortcutModal (快捷键速查面板)<br/>• creditsModal (开源与数据鸣谢面板)"]:::l3
        L2["Layer 2 (z-1000 / var(--z-modal))<br/>• editModal (全功能设置与书签管理弹窗)"]:::l2
        L1["Layer 1 (z-150 / var(--z-dropdown))<br/>• dropdownMenu (搜索引擎切换菜单)<br/>• suggestionMenu (实时搜索联想面板)<br/>• weatherPopover (实时气象预报详情卡片)"]:::l1
    end

    %% ======================= EVENT ENTRY =======================
    EVT_ENTRY{"🔘 捕获用户退栈触发动作<br/>(按下 Escape 键 或 点击 Modal 遮罩暗色背景)"}:::eventNode

    %% ======================= STACK DECISION TREE =======================
    STACK_CHECK{"OverlayStack.isEmpty() ?<br/>(当前栈内是否存在打开的浮层)"}:::decisionNode
    GET_TOP["获取栈顶元素<br/>topOverlay = OverlayStack.top()"]:::actionNode

    IS_SUGGEST{"topOverlay.id === 'suggestions' ?"}:::decisionNode
    RESTORE_QUERY["还原输入框内容为原始 query<br/>(撤销键盘 ↑↓ 选中的联想词)"]:::actionNode
    EXEC_SUGGEST_CLOSE["执行 hideSuggestions()<br/>作废未决 JSONP 请求并出栈"]:::actionNode

    IS_MODAL{"topOverlay.id 属于 MODAL_OVERLAY_IDS ?<br/>(editModal / picker / shortcut 等)"}:::decisionNode
    EXEC_MODAL_CLOSE["调用注册的 closeFn()<br/>触发淡出动画并从栈顶移除"]:::actionNode
    RESTORE_FOCUS["归还键盘焦点至 opener 触发源元素<br/>(避免焦点丢失到 body)"]:::actionNode

    CHECK_REMAINING{"栈内是否仍有其余 Modal ?<br/>stack.some(MODAL_OVERLAY_IDS.has)"}:::decisionNode
    UNLOCK_BODY["移除 body 锁定类名<br/>classList.remove('overflow-hidden', 'touch-none')"]:::actionNode
    KEEP_BODY["保持 body 滚动锁定状态"]:::actionNode

    NO_STACK["栈为空保底分支<br/>主动关闭 dropdown / suggestions 并使输入框失焦"]:::actionNode

    %% ======================= FLOW WIRES =======================
    Z_INDEX -.->|"运行态压栈托管"| STACK_CHECK
    EVT_ENTRY --> STACK_CHECK

    STACK_CHECK -- "否 (栈非空)" --> GET_TOP
    STACK_CHECK -- "是 (栈空)" --> NO_STACK

    GET_TOP --> IS_SUGGEST
    IS_SUGGEST -- "是" --> RESTORE_QUERY --> EXEC_SUGGEST_CLOSE
    IS_SUGGEST -- "否" --> IS_MODAL

    IS_MODAL -- "是" --> EXEC_MODAL_CLOSE --> RESTORE_FOCUS --> CHECK_REMAINING
    IS_MODAL -- "否 (如 dropdown/weather)" --> EXEC_OTHER["直接执行 topOverlay.close() 出栈"]:::actionNode

    CHECK_REMAINING -- "无剩余 Modal" --> UNLOCK_BODY
    CHECK_REMAINING -- "仍有上层 Modal" --> KEEP_BODY

    %% ======================= STYLES =======================
    classDef l4 fill:#7f1d1d,stroke:#f87171,stroke-width:1px,color:#ffffff,rx:4px
    classDef l3 fill:#7c2d12,stroke:#fb923c,stroke-width:1px,color:#ffffff,rx:4px
    classDef l2 fill:#1e3a8a,stroke:#60a5fa,stroke-width:1px,color:#ffffff,rx:4px
    classDef l1 fill:#14532d,stroke:#4ade80,stroke-width:1px,color:#ffffff,rx:4px

    classDef eventNode fill:#581c87,stroke:#c084fc,stroke-width:2px,color:#ffffff,rx:8px
    classDef decisionNode fill:#1e293b,stroke:#facc15,stroke-width:1.5px,color:#fef08a,rx:6px
    classDef actionNode fill:#0f172a,stroke:#94a3b8,stroke-width:1px,color:#f1f5f9,rx:4px
```

#### 💡 技术原理解析
1. **LIFO 后进先出退栈模型**：`OverlayStack` 维护一个响应优先级栈。当用户在“设置弹窗”之上唤起“书签提取器”并进一步触发“删除确认对话框”时，弹窗依次压栈。按 `Escape` 键或点击遮罩将严格按照后进先出顺序逐层剥离，绝不发生跨层全关的穿透现象。
2. **滚动穿透锁定与引用计数**：栈内通过 `MODAL_OVERLAY_IDS` 集合监测活动弹窗。当第一个 Modal 入栈时，立即向 `document.body` 注入 `overflow-hidden touch-none`；退栈时仅当所有 Modal 全部出栈后才释放锁定，避免底层页面意外发生滚动穿透。
3. **焦点归还与 Focus Trap**：弹窗展开时记录 `editModalTriggerEl = document.activeElement`，并在弹窗内使用 `handleModalTabFocus` 拦截 `Tab` / `Shift+Tab` 键实现焦点循环锁定；弹窗销毁后平滑归还焦点到触发按钮，保证键盘纯盲操的无障碍闭环。

---

### 4. 📴 Service Worker 三池隔离与离线数据流向 (Storage & Cache Topology)

```mermaid
flowchart LR
    %% ======================= REQUEST INTERCEPT =======================
    subgraph REQ [" 🌐 请求拦截判定 (Fetch Interceptor) "]
        direction TB
        METHOD{"Request Method === 'GET' ?"}
        ROUTER{"URL 路由与特征分类"}
    end

    %% ======================= THREE POOLS =======================
    subgraph THREE_POOLS [" 📦 Service Worker 三池物理隔离架构 "]
        direction TB
        
        subgraph P1 [" 1. CORE_CACHE (app-core-v*) "]
            C_HTML["主文档 HTML (原子化 SWR)<br/>index.html / '/'"]
            C_DATA["静态数据 (Stale-While-Revalidate)<br/>manifest.json / bookmarks.json"]
            C_STATIC["核心静态脚本 (原子化 SWR)<br/>app.js / 本地壁纸 (排除 sw.js)"]
        end

        subgraph P2 [" 2. FAVICON_CACHE (app-favicons-v1) "]
            F_CACHE["跨域图标池 (a.favicon.im)<br/>Bing / Google / Wikipedia 核心预缓存<br/>+ SWR 防污染重验 (4s 超时截断)"]
            F_FIFO["FIFO 容量淘汰限制: MAX = 800 条"]
        end

        subgraph P3 [" 3. IMG_CACHE (app-images-v1) "]
            I_CACHE["同源站内图片池 (Cache-First)<br/>ico / png / jpg / webp / avif"]
            I_FIFO["FIFO 容量淘汰限制: MAX = 200 条"]
        end
    end

    %% ======================= FALLBACK & ERROR HANDLERS =======================
    subgraph ERR_HANDLER [" 🚨 异常捕获与终极降级 (Fallback Pipeline) "]
        direction TB
        E_503["HTTP 503 离线纯文本兜底<br/>('离线且无本地缓存')"]
        E_404["HTTP 404 图标缺失响应"]
        E_BADGE["前端 <img> onerror 自动降级<br/>(提取站点首字母生成彩色矢量徽标)"]
    end

    %% ======================= FLOW WIRES =======================
    METHOD -- "是" --> ROUTER
    METHOD -- "否 (POST等)" --> PASS_NET["放行原生网络请求"]:::actionNode

    ROUTER -- "主文档 HTML" --> C_HTML
    ROUTER -- "JSON 数据" --> C_DATA
    ROUTER -- "同源 JS/CSS/壁纸" --> C_STATIC
    ROUTER -- "a.favicon.im 跨域图标" --> F_CACHE
    ROUTER -- "同源静态图片" --> I_CACHE
    ROUTER -- "跨域用户自定义壁纸" --> PASS_NET

    F_CACHE --> F_FIFO
    I_CACHE --> I_FIFO

    C_HTML -.->|"离线且无缓存"| E_503
    C_DATA -.->|"离线且无缓存"| E_503
    C_STATIC -.->|"离线且无缓存"| E_503
    F_CACHE -.->|"网络超时/离线/404"| E_404
    E_404 --> E_BADGE

    %% ======================= STYLES =======================
    classDef poolBox fill:#0f172a,stroke:#38bdf8,stroke-width:1.5px,color:#f0f9ff,rx:6px
    classDef actionNode fill:#1e293b,stroke:#64748b,stroke-width:1px,color:#e2e8f0,rx:4px
    classDef errNode fill:#450a0a,stroke:#f87171,stroke-width:1px,color:#fef2f2,rx:4px

    class P1,P2,P3 poolBox
    class E_503,E_404,E_BADGE errNode
    class METHOD,ROUTER actionNode
```

#### 💡 技术原理解析
1. **三池物理隔离与版本强同调 (Version Lockstep)**：
   - `CORE_CACHE`：打包时基于构建时间戳命名（如 `app-core-v1786255428688`），主文档 `index.html` 与同源脚本 `app.js` 统一采用 **原子化 SWR 锁步** 策略，本地 0ms 瞬出秒开（彻底消除 Safari 冷启动网络阻塞与 TTFB 延迟）；由构建管线自动在 HTML 注入 `app.js?v=app-core-v<timestamp>` 版本查询参数，配合 `window.__GLASS_BUILD_HTML__` 与 `__GLASS_BUILD_APP__` 双端构建指纹契约对，确保 HTML 结构与 JS 逻辑 100% 同池直出，彻底杜绝“旧 JS 执行于新 HTML”导致的切屏/BFCache 白屏死锁；版本换代由 SW 差量更新原子接管。
   - `FAVICON_CACHE`：独立存储 `a.favicon.im` 外部图标，与核心脚本完全隔离，防止外部网络动荡影响核心预缓存。
   - `IMG_CACHE`：独立存储站内高分辨率壁纸与图片，通过 Cache-First 策略减少重复带宽消耗。
2. **防透明响应污染 (Anti-Opaque Poisoning)**：请求跨域图标时产生 `status = 0` 的 `opaque` 响应。若直接缓存可能存入被 DNS 劫持或损坏的数据。系统引入二次网络校验与 4 秒超时熔断（`AbortController`），确保仅有合法的 `opaque` 或 `200 OK` 响应才被允许写入，并由轻量 `pruneCache` 原生实现先进先出（FIFO）淘汰，杜绝 IndexedDB 膨胀与崩溃隐患。
3. **同源/跨域壁纸的 CSP 与缓存解耦**：同源静态图片进 `IMG_CACHE`；用户填写的任意跨域自定义壁纸直连网络，由页面的 CSP `img-src 'self' data: blob: https:` 进行安全管辖，避免因 Service Worker 上下文受 `connect-src` 严格白名单限制而拦截合法的用户壁纸主机。

---

### 5. 🔍 智能搜索三级模糊匹配与气象 9 阶动态演化决策 (Search & Weather Decision Engine)

```mermaid
flowchart TD
    %% ======================= SEARCH SYSTEM =======================
    subgraph ENGINE_SEARCH [" 🔍 A. 本地书签检索与网络联想决策引擎 (Search & Suggestion Engine) "]
        direction TB
        Q_IN["用户输入 Query 词条<br/>(过滤纯标点与空字符)"]
        
        subgraph LOCAL_MATCH [" 本地书签 7 级优先级决策管道 (Local Priority Pipeline) "]
            T10["Tier 10: 书签名完全匹配 (bmName === q)"]:::tTier
            T20["Tier 20: 书签名以关键词开头 (bmName.startsWith(q))"]:::tTier
            T30["Tier 30: 书签名包含关键词 (bmName.includes(q))"]:::tTier
            T40["Tier 40: URL 域名/路径匹配 (bmUrl.includes(q))"]:::tTier
            T50["Tier 50: 书签简介描述命中 (bmDesc.includes(q))"]:::tTier
            T60["Tier 60+: 关键词模糊拼写纠错 (Damerau-Levenshtein 距离 <= 2)"]:::tTier
            T70["Tier 70+: URL/简介模糊纠错 (Fuzzy Other Match)"]:::tTier
        end

        SORT_LOCAL["排序并截取 Top 2 本地书签<br/>matches.sort((a,b) => a.tier - b.tier)"]
        RENDER_0MS["⚡ 0ms 瞬间渲染本地书签 + 骨架屏占位<br/>(消除 Cumulative Layout Shift 布局抖动)"]
        
        JSONP_DISPATCH{"分配唯一回调 __glassSuggestCb_[id]<br/>并发调度对应引擎 JSONP 接口"}
        ENG_BING["Bing JSONP API<br/>api.bing.com"]
        ENG_GOOGLE["Google JSONP API<br/>suggestqueries.google.com"]
        ENG_WIKI["Wikipedia OpenSearch<br/>zh.wikipedia.org"]

        MERGE_LIST["动态容量混排与渲染<br/>(本地书签数 + 网络建议数 <= 4 条)"]
    end

    %% ======================= WEATHER SYSTEM =======================
    subgraph ENGINE_WEATHER [" 🌤️ B. 气象 9 阶动态感知演化决策引擎 (Weather 9-Stage Evolution Engine) "]
        direction TB
        W_DATA["摄取 Open-Meteo 气象数据<br/>(经过 weatherNum 信任边界净化)"]

        subgraph HUMIDITY_STAGE [" 💧 相对湿度 (Humidity) 3 阶形态演化 "]
            H1["🌵 干燥 (Desert Dry)<br/>humidity < 35%"]:::wDry
            H2["💧 舒适 (Comfortable)<br/>35% <= humidity <= 75%"]:::wComfort
            H3["💦 潮湿 (Humid)<br/>humidity > 75%"]:::wWet
        end

        subgraph WIND_STAGE [" 🍃 实时风速 (Wind Speed) 3 阶形态演化 "]
            W1_S["🍃 微风拂面 (Light Breeze)<br/>windSpeed < 15 km/h"]:::wLight
            W2_S["🎏 清风疾风 (Moderate Wind)<br/>15 km/h <= windSpeed < 35 km/h"]:::wMod
            W3_S["🌪️ 强风狂风 (Gale / Strong Wind)<br/>windSpeed >= 35 km/h"]:::wGale
        end

        subgraph POP_STAGE [" ☂️ 降水概率与雨具 (Precipitation) 3 阶形态演化 "]
            P1["🌂 折叠收伞 (Safe / No Rain)<br/>pop < 30%"]:::pSafe
            P2["☂️ 撑开备伞 (Standby / Moderate)<br/>30% <= pop < 70%"]:::pWarn
            P3["☔️ 暴雨倾盆 (Heavy Rain / Warning)<br/>pop >= 70%"]:::pAlert
        end

        W_RENDER["渲染气象胶囊卡片与动态日出/日落时间<br/>(🌅 今日日落 vs 🌄 明日日出 智能切换)"]
    end

    %% ======================= CONNECTIONS =======================
    Q_IN --> T10 --> T20 --> T30 --> T40 --> T50 --> T60 --> T70 --> SORT_LOCAL
    SORT_LOCAL --> RENDER_0MS
    RENDER_0MS --> JSONP_DISPATCH

    JSONP_DISPATCH --> ENG_BING --> MERGE_LIST
    JSONP_DISPATCH --> ENG_GOOGLE --> MERGE_LIST
    JSONP_DISPATCH --> ENG_WIKI --> MERGE_LIST

    W_DATA --> HUMIDITY_STAGE
    W_DATA --> WIND_STAGE
    W_DATA --> POP_STAGE
    HUMIDITY_STAGE --> W_RENDER
    WIND_STAGE --> W_RENDER
    POP_STAGE --> W_RENDER

    %% ======================= STYLES =======================
    classDef tTier fill:#1e293b,stroke:#64748b,stroke-width:1px,color:#f8fafc,rx:4px
    classDef wDry fill:#451a03,stroke:#f59e0b,stroke-width:1px,color:#fef3c7,rx:4px
    classDef wComfort fill:#064e3b,stroke:#10b981,stroke-width:1px,color:#d1fae5,rx:4px
    classDef wWet fill:#1e3a8a,stroke:#3b82f6,stroke-width:1px,color:#dbeafe,rx:4px

    classDef wLight fill:#064e3b,stroke:#34d399,stroke-width:1px,color:#d1fae5,rx:4px
    classDef wMod fill:#78350f,stroke:#fbbf24,stroke-width:1px,color:#fef3c7,rx:4px
    classDef wGale fill:#4c0519,stroke:#f43f5e,stroke-width:1px,color:#ffe4e6,rx:4px

    classDef pSafe fill:#1e293b,stroke:#94a3b8,stroke-width:1px,color:#f1f5f9,rx:4px
    classDef pWarn fill:#713f12,stroke:#eab308,stroke-width:1px,color:#fef08a,rx:4px
    classDef pAlert fill:#450a0a,stroke:#ef4444,stroke-width:1px,color:#fee2e2,rx:4px
```

#### 💡 技术原理解析
1. **本地多阶精准/容错匹配引擎**：
   - 匹配管道分为 7 个优先级梯队：书签名完全相等（Tier 10） $\to$ 前缀匹配（Tier 20） $\to$ 包含匹配（Tier 30） $\to$ URL 包含（Tier 40） $\to$ 描述命中（Tier 50） $\to$ Damerau-Levenshtein 拼写容错（Tier 60/70）。
   - 模糊容错支持字符邻近对调与单字符增删改，在用户敲错 1~2 个字母时仍能精准命中目标书签。
2. **零 CLS 混排与防竞态调度**：
   - 输入瞬间以 0ms 延迟渲染本地书签，同时为网络建议词预留带动画的骨架屏槽位（Skeleton Pulse），彻底杜绝网络返回时下拉框高度突变引起的视觉抖动（CLS）。
   - 每次网络请求分配递增的 `activeSuggestReqId` 与独立 `<script>` 节点，废弃过期的慢网络响应，彻底解决网络竞态乱序（Race Condition）。
3. **气象 9 阶动态感知演化算法**：
   - **湿度感知**：划分为 $<35\%$（沙漠干燥 🌵）、$35\%\sim 75\%$（适宜舒适 💧）、$>75\%$（潮湿多水 💦）。
   - **风速感知**：划分为 $<15\text{km/h}$（微风 🍃）、$15\sim 35\text{km/h}$（清风 🎏）、$\ge 35\text{km/h}$（大风狂风 🌪️）。
   - **降水与雨具演化**：划分为 $<30\%$（折叠收伞 🌂）、$30\%\sim 69\%$（撑开备伞 ☂️）、$\ge 70\%$（暴雨必带 ☔️）。
   - **时间与日照感知**：动态比对当前系统时间与日出/日落时间，白昼展示“今日日落 🌅”，日落后自适应切换为“明日日出 🌄”，全部气象字段均经过 `weatherNum` 强制数值化清洗，杜绝来自本地缓存的 XSS/HTML 注入风险。

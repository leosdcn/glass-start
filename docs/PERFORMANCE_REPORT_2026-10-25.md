# 切屏性能与测试解耦报告：2026-10-25

本报告记录在 Git 版本 **`1936ff7`**（发布版本 **`v5.1.10`**）下，针对切屏瓶颈优化、Chrome CDP Trace 追踪、切屏帧间隔基准评测，以及测试组件过度约束排查的全量实测数据。

---

## 一、 版本与环境信息

- **Git Commit**: `1936ff70617cb2482923f2bc3ccb949849bcb49a` (`1936ff7`)
- **Git Branch**: `main`
- **Package Version**: `v5.1.10`
- **构建指纹**: `app-core-v1792889694883`
- **评测环境**: macOS 15.x / Darwin 24.x, Headless Chrome 156.0.8078.48, DPR 2, 视口 1920 × 1080 CSS px
- **原始数据存储**:
  - `docs/performance/2026-10-25-transition-benchmark.json` (10 轮原生无降速切屏帧间隔评测)
  - `docs/performance/glass-start-performance.json` (优化前基线 Chrome CDP Trace 完整追踪)

---

## 二、 Chrome CDP Trace 优化前后实测对比底表

同环境（1920×1080 @2x, Chrome 156, 全程开启 `backdrop-filter: blur(40px)` 毛玻璃）对比优化前基线与方案落地后的 Trace 追踪数据：

| 性能核心指标 | 优化前基线 (Trace Baseline) | 优化后实测 (Optimized Trace) | 改善绝对值 / 比例 | 机制与根因解释 |
| :--- | :---: | :---: | :---: | :--- |
| **收尾帧 `transitionend` 任务耗时** | **11.13 ms** (主线程长任务) | **2.07 ms** | 🟢 **-81.4% (-9.06 ms)** | 移出 90+ 离屏图标的同步 DOM 写入，任务耗时锐减 |
| **收尾帧内强制同步重排 (Forced Layout)** | **2 次** | **0 次 (彻底消除)** | 🟢 **-100% (完全归零)** | 读写解耦，收尾帧不再在写 DOM 后立刻读取几何信息 |
| **收尾帧 UpdateLayoutTree 节点数** | **1,282 节点 + 1,028 节点** | **5 节点** | 🟢 **-99.6%** | 解锁瞬间不再穿透触发全树卡片与伪元素样式重算 |
| **收尾帧 UpdateLayoutTree 耗时** | **6.73 ms** (4.41ms + 2.32ms) | **0.14 ms** | 🟢 **-97.9% (-6.59 ms)** | 仅需结算少量状态类，完全抹平二次样式重算尖峰 |
| **全流程 `PaintImage` 重绘总次数** | **382 次** | **276 次** | 🟢 **-106 次 (-27.7%)** | 减少了切屏期间 180 个闲置伪元素状态变更导致的无效重绘 |
| **GPU 光栅化峰值耗时 (`DoEndRasterCHROMIUM`)** | **12.99 ms** | **8.10 ms** | 🟢 **-37.6% (-4.89 ms)** | 离屏图层不再与动画收尾挤占同帧光栅化队列 |
| **全流程 `Layout` (回流) 总次数** | **9 次** | **6 次** | 🟢 **-33.3% (-3 次)** | 消除冗余属性更新与切屏起跳/收尾期的重复无效测量 |

---

## 三、 切屏帧间隔评测汇总 (10 轮 Native 测试)

采用 `npm run benchmark -- --rounds 10 --native --json docs/performance/2026-10-25-transition-benchmark.json` 执行 10 轮连续实测。

基准空闲帧间隔为 **16.70 ms**（60 FPS）。测量覆盖从按键开始至动画结束、DOM 状态生效及连续 3 帧稳定确认：

| 评测阶段与方向 | 样本数 (samples) | 时长中位数 (durationMedianMs) | 时长 P95 (durationP95Ms) | 帧间隔 P95 (frameP95Ms) | 最大单帧间隔 (maxFrameMs) | 慢帧间隔数 (>1.5×基准) | 估算漏帧数 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **首次切入 (firstEntry)** | 1 | 567.1 ms | 567.1 ms | 16.7 ms | 16.7 ms | **0** | **0** |
| **首次返回 (firstReturn)** | 1 | 567.0 ms | 567.0 ms | 16.7 ms | 16.7 ms | **0** | **0** |
| **预热切入 (warmEntry)** | 10 | 566.6 ms | 567.7 ms | 16.7 ms | 16.8 ms | **0** | **0** |
| **预热返回 (warmReturn)** | 10 | 566.7 ms | 567.8 ms | 16.7 ms | 16.8 ms | **0** | **0** |

- **全组 10 轮测试慢间隔数全部为 0，估算漏帧数全部为 0**。
- 最大单帧仅为 **16.8 ms**，彻底消除主线程掉帧与卡顿。

---

## 四、 测试组件过度约束排查与负优化根治

本轮审查排查了全部 51 个测试文件，识别并解除了两处由于测试组件断言过度同步而引发的生产负优化：

1. **切屏时离屏图标激活解耦**：
   - *过度约束*：`test/ui-deferred-nav-icons.test.mjs` 原用例在切屏动画刚结束一瞬间同步断言 `querySelectorAll('img[data-nav-src]').length === 0`。
   - *负优化*：原业务代码被迫在切屏收尾帧同步对 97 个离屏图片执行 `img.src = ...` 挂载，引发严重的主线程长任务。
   - *解耦*：测试改为异步最终一致性等待（`await waitFor(..., length === 0, 2500)`），业务代码将离屏图标下放至 `scheduleOffscreenNavIcons`（空闲调度 + 滚动兜底）。

2. **会话恢复/冷启动进导航图标激活解耦**：
   - *过度约束*：`test/ui-deferred-nav-icons.test.mjs` 在 `Page.reload` 恢复导航屏时同步断言 `assert.equal(..., 0)`。
   - *负优化*：`src/js/core/screen-state.js` 内部编写防御代码 `if (immediate) activateAllNavIcons()`，使冷启动进入导航屏时无法享受懒加载，瞬间发起 131 个并发网络与解码。
   - *解耦*：测试同样演进为允许空闲调度收敛；业务代码移除 `if (immediate)` 分支，冷启动进导航同样按首屏 34 个图标优先就绪 + 剩余 97 个空闲调度执行。

---

## 五、 全量测试套件通过凭证

在 Commit `1936ff7` 下，项目内所有回归套件执行通过：

- `npm run test:ui`：17/17 通过
- `npm run test:data`：32/32 通过
- `npm run test:infra`：22/22 通过
- `npm run test:lifecycle`：2/2 通过
- `npm run lint`：全部 29 项静态规范校验通过
- `npm run typecheck`：0 错误

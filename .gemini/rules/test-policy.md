# AI 测试与自愈规范 (Test & Self-Healing Policy)

为提高开发效率并避免重复运行测试耗时，AI Agent 在本项目中须严格遵循以下双层测试流水线：

## 1. ⚡ 日常敏捷自愈流（代码修改后必跑，耗时 < 150ms）
- **第 1 步**：运行静态规范检查 `npm run lint`（耗时 90ms，必须 22/22 全绿）。
- **第 2 步**：运行受影响模块的免构建单测（耗时 < 50ms）：
  - 修改 UI 交互 / 切屏 / 弹窗：`node test/run.mjs ui --no-build`
  - 修改 数据存储 / 搜索 / 气象：`node test/run.mjs data --no-build`
  - 修改 Service Worker / 安全标头：`node test/run.mjs infra --no-build`

## 2. 🚀 发布级全量验证（提交前 / 重大重构执行）
- **第 1 步**：执行生产编译 `npm run build`
- **第 2 步**：强制重跑全部端到端套件 `node test/run.mjs --force`
- **第 3 步**：视觉回归比对 `node test/visual-regression.mjs`

## 3. 🎯 缓存与命令行参考
- 项目自带 MD5 增量缓存（`test/.cache.json`），未改动的套件会自动跳过（<10ms）。
- 发现报错时，AI 须读取 Terminal 报错在当前轮次内自动修复，直到测试全绿再向用户交付。

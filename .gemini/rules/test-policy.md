# AI 测试规范 (Test Policy)

为提高开发效率并避免重复运行测试耗时，AI Agent 在本项目中须遵循以下测试原则：

1. **缓存优先与精准测试**：
   - 调试或修改特定功能时，优先指定单个模块进行测试（例如修改了 overlay 功能，使用 `node test/run.mjs overlay`）。
   - 项目自带 MD5 增量缓存（`test/.cache.json`），末改动的测试会自动跳过。

2. **命令行选项参考**：
   - 指定单测试：`node test/run.mjs <name>`
   - 跳过构建过程（极速测试）：`node test/run.mjs <name> --no-build`
   - 强制重跑全部测试：`node test/run.mjs --force`

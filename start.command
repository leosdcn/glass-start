#!/bin/bash

# 自动切换至当前脚本所在目录
cd "$(dirname "$0")"

# 自动补充 macOS 常见的 Node / NVM / Homebrew / FNM 环境变量路径（解决从 Finder 双击启动时 PATH 缺失问题）
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -n 1)/bin:$HOME/.fnm/current/bin:$HOME/.volta/bin:$PATH"

# 如果存在用户 profile / zshrc，尝试静默读取以补全环境
if [ -f "$HOME/.zshrc" ]; then
    source "$HOME/.zshrc" >/dev/null 2>&1
elif [ -f "$HOME/.bash_profile" ]; then
    source "$HOME/.bash_profile" >/dev/null 2>&1
fi

# 设置终端窗口标题
echo -ne "\033]0;Glass Start - 本地局域网服务\007"

clear
echo "======================================================="
echo "  🌟 Glass Start — 本地局域网网页服务"
echo "======================================================="
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ [错误] 未检测到 Node.js 环境，请先安装 Node.js (https://nodejs.org)"
    echo ""
    read -n 1 -s -r -p "按任意键退出..."
    exit 1
fi

# 自动构建 dist 目录产物（确保书签与样式已同步更新）
echo "📦 正在检查并同步构建 dist/ 产物..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ 构建失败，请检查上方错误输出。"
    read -n 1 -s -r -p "按任意键退出..."
    exit 1
fi

# 启动静态服务器（原生 Node.js 零依赖快速启动，服务就绪后自动打开浏览器）
node server.js

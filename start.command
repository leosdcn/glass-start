#!/bin/bash

# 自动切换至项目根目录
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
echo -ne "\033]0;Glass Start - 本地服务 (深度净化启动)\007"

clear
echo -e "\033[36m════════════════════════════════════════════════════════════════════════\033[0m"
echo -e "\033[1;36m🌟 Glass Start — 本地开发与测试一键启动 (One-Click Launcher)\033[0m"
echo -e "\033[36m════════════════════════════════════════════════════════════════════════\033[0m"
echo -e "\033[35m🧹 默认开启深度净化模式：自动清理 Safari / Chrome 历史缓存与 Service Worker\033[0m"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo -e "\033[31m❌ [错误] 未检测到 Node.js 环境，请先安装 Node.js (https://nodejs.org)\033[0m"
    echo ""
    read -n 1 -s -r -p "按任意键退出..."
    exit 1
fi

# 自动构建 dist 目录产物（确保书签与样式已同步更新）
echo -e "\033[36m📦 正在执行增量同步与生产打包...\033[0m"
npm run build
if [ $? -ne 0 ]; then
    echo -e "\n\033[31m❌ 构建失败，请检查上方错误输出。\033[0m"
    read -n 1 -s -r -p "按任意键退出..."
    exit 1
fi

# 启动静态服务器（默认开启深度清缓存模式，彻底抹除旧 SW/缓存碎片后自动唤醒纯净首页）
CLEAR_CACHE=1 node scripts/server.js --clear-cache

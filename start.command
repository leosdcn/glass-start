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
echo -ne "\033]0;Glass Start - 本地服务\007"

clear
echo -e "\033[36m════════════════════════════════════════════════════════════════════════\033[0m"
echo -e "\033[1;36m🌟 Glass Start — 本地开发与服务一键启动 (One-Click Launcher)\033[0m"
echo -e "\033[36m════════════════════════════════════════════════════════════════════════\033[0m"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo -e "\033[31m❌ [错误] 未检测到 Node.js 环境，请先安装 Node.js (https://nodejs.org)\033[0m"
    echo ""
    read -n 1 -s -r -p "按任意键退出..."
    exit 1
fi

# 构建 dist 产物；首次运行前需自行执行 npm ci。
echo -e "\033[36m📦 正在执行生产构建...\033[0m"
npm run build
if [ $? -ne 0 ]; then
    echo -e "\n\033[31m❌ 构建失败，请检查上方错误输出。\033[0m"
    read -n 1 -s -r -p "按任意键退出..."
    exit 1
fi

# 智能检测本地证书：若环境装有 mkcert 但未生成证书，自动静默生成；若已有证书则自动启用 HTTPS
if [ ! -f "localhost.pem" ] && command -v mkcert &>/dev/null; then
    mkcert localhost 127.0.0.1 ::1 >/dev/null 2>&1
fi

HTTPS_OPT=""
if [ -f "localhost.pem" ] && [ -f "localhost-key.pem" ]; then
    HTTPS_OPT="--https"
elif [ -f "localhost+2.pem" ] && [ -f "localhost+2-key.pem" ]; then
    HTTPS_OPT="--https"
elif [ -f "cert.pem" ] && [ -f "key.pem" ]; then
    HTTPS_OPT="--https"
elif [ -f ".cert/localhost.pem" ] && [ -f ".cert/localhost-key.pem" ]; then
    HTTPS_OPT="--https"
fi

# 用临时 Chrome 配置预览，保留平时使用的浏览器数据。
exec node scripts/server.cjs --isolated $HTTPS_OPT

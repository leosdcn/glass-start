// CommonJS 可同时供构建脚本与 ESM 校验、测试入口复用。
const isTTY = process.stdout.isTTY && !process.env.NO_COLOR;
const codes = { reset: 0, bold: 1, dim: 2, cyan: 36, green: 32, yellow: 33, red: 31, blue: 34, magenta: 35, gray: 90 };
const c = Object.fromEntries(Object.entries(codes).map(([name, code]) => [name, isTTY ? `\x1b[${code}m` : '']));
const LINE_WIDTH = 72;
const HR_DOUBLE = '═'.repeat(LINE_WIDTH);

function getVisualWidth(str) {
    let width = 0;
    for (const ch of str.replace(/\x1b\[[0-9;]*m/g, '')) {
        const code = ch.codePointAt(0);
        if ((code >= 0xFE00 && code <= 0xFE0F) || code === 0x200D) continue;
        width += code > 0x7f ? 2 : 1;
    }
    return width;
}

function logSection(step, title) {
    const trailingLine = '─'.repeat(Math.max(4, LINE_WIDTH - getVisualWidth(`─── [${step}] ${title} `)));
    console.log(`\n${c.cyan}─── [${step}] ${title} ${c.gray}${trailingLine}${c.reset}`);
}

function logItem(msg, status = 'ok') {
    const icons = { ok: `${c.green}✔`, warn: `${c.yellow}⚠`, info: `${c.cyan}ℹ`, error: `${c.red}❌` };
    console.log(`  ${icons[status] || icons.error}${c.reset} ${msg}`);
}

module.exports = { c, LINE_WIDTH, HR_DOUBLE, logSection, logItem };

const { writeFile } = require('node:fs/promises');
const { join } = require('node:path');

/** 将当前线上 HTML 引用的脚本带入下一次静态发布，供仍持有该 HTML 的浏览器使用。 */
async function retainDeployedScript(baseUrl, output = join(__dirname, '..', 'dist')) {
    const base = new URL(baseUrl);
    base.pathname = base.pathname.replace(/\/?$/, '/');
    base.search = base.hash = '';
    /** @type {RequestInit} */
    const options = { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) };
    const page = await fetch(base, options);
    if (page.status === 404) return; // 尚未部署。
    if (!page.ok) throw new Error(`无法读取当前部署的 HTML（HTTP ${page.status}）`);
    const html = await page.text();
    const build = html.match(/__GLASS_BUILD_HTML__\s*=\s*["'](app-core-v\d+(?:-[a-f0-9]{16})?)["']/)?.[1];
    const asset = `app-builds/${build}.js`;
    if (!build || !html.includes(`src="./${asset}"`)) {
        throw new Error('当前部署未提供可核对的版本脚本');
    }
    const response = await fetch(new URL(asset, base), options);
    if (!response.ok || !/^(text|application)\/(java|ecma)script(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
        throw new Error(`无法读取当前部署的脚本 ${asset}（HTTP ${response.status}）`);
    }
    const script = await response.text();
    if (script.match(/^window\.__GLASS_BUILD_APP__\s*=\s*["']([^"']+)["']/)?.[1] !== build) {
        throw new Error(`当前部署的脚本指纹与 HTML 不一致（${build}）`);
    }
    await writeFile(join(output, asset), script);
    return asset;
}

if (require.main === module && process.env.GLASS_PREVIOUS_DEPLOY_URL) {
    retainDeployedScript(process.env.GLASS_PREVIOUS_DEPLOY_URL).then(asset => {
        if (asset) console.log(`已保留当前部署的脚本 ${asset}`);
    }).catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

module.exports = { retainDeployedScript };

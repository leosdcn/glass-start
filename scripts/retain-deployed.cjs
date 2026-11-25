const { referencedWebBuild, scriptFingerprint } = require('../src/js/utils/build-identity.js');
const { mkdir, writeFile } = require('node:fs/promises');
const { dirname, join } = require('node:path');

const MAX_RETAIN_BYTES = 2 * 1024 * 1024;

/** 将当前线上 HTML 引用的脚本带入下一次静态发布，供仍持有该 HTML 的浏览器使用。 */
async function retainDeployedScript(baseUrl, output = join(__dirname, '..', 'dist')) {
    const base = new URL(baseUrl);
    if (base.protocol !== 'https:' && base.protocol !== 'http:') {
        throw new Error(`不支持的部署协议：${base.protocol}`);
    }
    base.pathname = base.pathname.replace(/\/?$/, '/');
    base.search = base.hash = '';
    /** @type {RequestInit} */
    const options = { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) };
    const page = await fetch(base, options);
    if (page.status === 404) return; // 尚未部署。
    if (!page.ok) throw new Error(`无法读取当前部署的 HTML（HTTP ${page.status}）`);
    const pageContentLength = Number(page.headers.get('content-length') || 0);
    if (pageContentLength > MAX_RETAIN_BYTES) throw new Error('当前部署的 HTML 体积超出上限');
    const html = await page.text();
    if (Buffer.byteLength(html, 'utf8') > MAX_RETAIN_BYTES) throw new Error('当前部署的 HTML 体积超出上限');
    const previous = referencedWebBuild(html);
    if (!previous) throw new Error('当前部署未提供可核对的版本脚本');
    const { version, asset } = previous;
    const response = await fetch(new URL(asset, base), options);
    if (!response.ok || !/^(text|application)\/(java|ecma)script(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
        throw new Error(`无法读取当前部署的脚本 ${asset}（HTTP ${response.status}）`);
    }
    const scriptLength = Number(response.headers.get('content-length') || 0);
    if (scriptLength > MAX_RETAIN_BYTES) throw new Error('当前部署的脚本体积超出上限');
    const script = await response.text();
    if (Buffer.byteLength(script, 'utf8') > MAX_RETAIN_BYTES) throw new Error('当前部署的脚本体积超出上限');
    if (scriptFingerprint(script) !== version) {
        throw new Error(`当前部署的脚本指纹与 HTML 不一致（${version}）`);
    }
    const targetPath = join(output, asset);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, script);
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

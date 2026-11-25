// 公共指令来自同一份配置，平台补充各自的脚本、请求和嵌入限制。
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const suggestions = ['https://api.bing.com', 'https://suggestqueries.google.com'];
const sharedConnections = [
    'https://api.open-meteo.com', 'https://geocoding-api.open-meteo.com',
    'https://myip.ipip.net', 'https://ipwho.is', 'https://zh.wikipedia.org', 'https://en.wikipedia.org'
];
const extensionConnections = [...suggestions, ...sharedConnections];
const common = {
    'default-src': "'self'",
    'style-src': "'self' 'unsafe-inline'",
    'img-src': "'self' data: blob: https:",
    'object-src': "'none'",
    'base-uri': "'none'"
};

/** @param {Record<string, string>} directives */
function serialize(directives) {
    return Object.entries(directives).map(([name, value]) => value ? name + ' ' + value : name).join('; ');
}

/** @returns {typeof import('../src/js/config/image-search-uploads.json')} */
function readImageSearchUploads() {
    return JSON.parse(readFileSync(join(__dirname, '../src/js/config/image-search-uploads.json'), 'utf8'));
}

/**
 * @param {ReturnType<typeof readImageSearchUploads>} [uploads]
 * @param {string[]} [scriptHashes]
 */
function getContentSecurityPolicy(uploads = readImageSearchUploads(), scriptHashes = []) {
    const uploadPaths = Object.values(uploads).map(({ url }) => {
        const endpoint = new URL(url);
        return endpoint.origin + endpoint.pathname;
    });
    const shared = { ...common, 'form-action': ["'self'", ...uploadPaths, 'https://www.google.com/search'].join(' ') };
    const inlineScriptPolicy = scriptHashes.length ? scriptHashes : ["'unsafe-inline'"];
    const web = {
        ...shared,
        'script-src': ["'self'", ...inlineScriptPolicy, ...suggestions, 'https://static.cloudflareinsights.com'].join(' '),
        'connect-src': ["'self'", ...sharedConnections, 'https://a.favicon.im', 'https://www.google.com',
            'https://*.gstatic.com', 'https://cloudflareinsights.com'].join(' '),
        'worker-src': "'self' blob:"
    };
    return {
        webMeta: serialize(web),
        webHeader: serialize({ ...web, 'frame-ancestors': "'self'", 'upgrade-insecure-requests': '' }),
        extensionPolicy: {
            host_permissions: extensionConnections.map(origin => origin + '/*'),
            content_security_policy: {
                extension_pages: serialize({
                    ...shared,
                    'script-src': "'self'",
                    'connect-src': ["'self'", ...extensionConnections].join(' '),
                    'frame-ancestors': "'none'"
                })
            }
        }
    };
}

module.exports = { getContentSecurityPolicy, readImageSearchUploads };

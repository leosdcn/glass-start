/** 网页、发布保留脚本和 Service Worker 共用的版本化资源契约。 */
const buildPattern = 'app-core-v(\\d+)(?:-[0-9a-f]{16})?';
const buildId = new RegExp('^' + buildPattern + '$');
const buildSuffix = new RegExp(buildPattern + '$');
const scriptPath = new RegExp('^app-builds/(' + buildPattern + ')\\.js$');

export const BUILD_FINGERPRINT_PREFIX_BYTES = 256;

/** @param {string} version */
export function appScriptPath(version) {
    return `app-builds/${version}.js`;
}

/** @param {string | null} path */
export function buildFromScriptPath(path) {
    return scriptPath.exec(path ?? '')?.[1];
}

/** @param {string | null} version */
export function legacyBuildId(version) {
    return version && buildId.test(version) && !version.slice('app-core-v'.length).includes('-') ? version : undefined;
}

/** @param {string} key */
export function cacheBuildTime(key) {
    return Number(buildSuffix.exec(key)?.[1] || 0);
}

/** @param {string} html */
export function htmlFingerprint(html) {
    return /__GLASS_BUILD_HTML__\s*=\s*["']([^"']+)["']/.exec(html)?.[1];
}

/** @param {string} script */
export function scriptFingerprint(script) {
    return /^window\.__GLASS_BUILD_APP__\s*=\s*["']([^"']+)["']/.exec(script)?.[1];
}

/** @param {string} html */
export function referencedWebBuild(html) {
    const version = htmlFingerprint(html);
    if (!version || !buildId.test(version)) return null;
    const asset = appScriptPath(version);
    return html.includes(`src="./${asset}"`) ? { version, asset } : null;
}

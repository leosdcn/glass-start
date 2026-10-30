/** 启动时校验 HTML 与脚本构建指纹，限制版本混用时的自动刷新频率。 */
const RELOAD_GUARD_KEY = 'gs_build_reload_at';
const RELOAD_COOLDOWN_MS = 60000;

/**
 * 指纹不一致时返回刷新许可；SessionStorage 可用时按配置的冷却期限制。
 * @param {string} [htmlBuild]
 * @param {string} [jsBuild]
 */
export function verifyFingerprint(htmlBuild, jsBuild) {
    if (!htmlBuild || !jsBuild) return { mismatch: false, mayReload: false };
    if (htmlBuild === jsBuild) return { mismatch: false, mayReload: false };
    let lastReloadAt = 0;
    try { lastReloadAt = Number(sessionStorage.getItem(RELOAD_GUARD_KEY)) || 0; } catch {}
    const mayReload = Date.now() - lastReloadAt > RELOAD_COOLDOWN_MS;
    if (mayReload) {
        try { sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now())); } catch {}
    }
    return { mismatch: true, mayReload };
}

export function checkBuildFingerprint() {
    const verdict = verifyFingerprint(window.__GLASS_BUILD_HTML__, window.__GLASS_BUILD_APP__);
    if (verdict.mismatch && verdict.mayReload) location.reload();
}

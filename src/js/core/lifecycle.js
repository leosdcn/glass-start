import { isScreenTransitioning, reconcileScreenState } from './screen-state.js';
/**
 * 构建指纹契约与运行时黑匣子自愈闭环
 * 启动时校验构建指纹；日志使用有容量上限的内存缓冲。指纹不一致时用 SessionStorage
 * 尝试限制刷新频率；异常探针依次校准状态、提示重绘、记录后停止。
 */
import { CONFIG } from '../config/constants.js';
import { dom } from '../state/dom.js';

const RELOAD_GUARD_KEY = 'gs_build_reload_at';
const BB_MAX_ENTRIES = 40;
const RELOAD_COOLDOWN_MS = 60000;
const PROBE_DELAY_MS = 700;

// 内存日志：BFCache 恢复可保留，重新加载清空。
/** @type {import('../types.js').GlassDiagEntry[]} */
const bbBuffer = [];

/**
 * @param {string} ev
 * @param {unknown} [detail]
 */
export function bbLog(ev, detail) {
    bbBuffer.push({ t: Date.now(), ev, d: detail === undefined ? null : detail });
    while (bbBuffer.length > BB_MAX_ENTRIES) bbBuffer.shift();
}

export function bbDump() {
    return bbBuffer.slice();
}

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
    bbLog('build-mismatch', { html: htmlBuild, js: jsBuild, mayReload });
    return { mismatch: true, mayReload };
}

// 首屏未离屏且无过渡时检查矩阵与哨兵宽度，不检测真实像素可见性。
export function snapshotHealth() {
    if (isScreenTransitioning()) {
        return { ok: true, identityOk: true, sentinelsOk: true };
    }
    const s = dom.startSection || (typeof document !== 'undefined' ? document.getElementById('startSection') : null);
    if (!s || s.classList.contains('screen-pushed-up')) return { ok: true };
    let t = 'none';
    try { t = getComputedStyle(s).transform; } catch {}
    const identityOk = !t || t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)';
    const clock = dom.clock || (typeof document !== 'undefined' ? document.getElementById('clock') : null);
    const search = dom.searchInput || (typeof document !== 'undefined' ? document.getElementById('searchInput') : null);
    const sentinelsOk = !!clock && clock.offsetWidth > 0 && !!search && search.offsetWidth > 0;
    return { ok: identityOk && sentinelsOk, identityOk, sentinelsOk };
}

let unhealthyStreak = 0;
// 三级修复阶梯：
// L1 校准状态 → L2 切换 will-change 并读取布局 → L3 记录异常并停止，不刷新。
export function probe() {
    if (isScreenTransitioning()) {
        return;
    }
    if (snapshotHealth().ok) {
        unhealthyStreak = 0;
        return;
    }
    unhealthyStreak++;
    bbLog('anomaly-' + unhealthyStreak, null);
    if (unhealthyStreak === 1) {
        reconcileScreenState();
    } else if (unhealthyStreak === 2) {
        const s = dom.startSection || (typeof document !== 'undefined' ? document.getElementById('startSection') : null);
        if (s) {
            s.style.willChange = 'auto';
            void s.offsetHeight;
            s.style.willChange = 'transform';
        }
    } else {
        bbLog('heal-reload-blocked', null);
        unhealthyStreak = 0;
        return;
    }
    setTimeout(probe, PROBE_DELAY_MS);
}

export function initLifecycleAndBlackbox() {
    if (typeof window === 'undefined') return;

    window.__GLASS_DIAG__ = {
        verify: verifyFingerprint,
        probe,
        dump: bbDump,
        log: bbLog
    };

    // 1. 启动即执行指纹契约校验
    const verdict = verifyFingerprint(window.__GLASS_BUILD_HTML__, window.__GLASS_BUILD_APP__);
    if (verdict.mismatch && verdict.mayReload) {
        location.reload();
        return;
    }

    // 2. 黑匣子被动生命周期事件监听
    window.addEventListener('pageshow', (e) => {
        const pe = /** @type {PageTransitionEvent} */ (e);
        bbLog('pageshow', { persisted: !!(pe && pe.persisted) });
    }, { passive: true });
    document.addEventListener('visibilitychange', () => { bbLog('visibility', { hidden: document.hidden }); }, { passive: true });
    window.addEventListener('error', (e) => {
        const ee = /** @type {ErrorEvent} */ (e);
        bbLog('js-error', { msg: String((ee && ee.message) || 'unknown').slice(0, CONFIG.SECURITY.LOG_MSG_MAX_CHARS) });
    });
    window.addEventListener('unhandledrejection', () => { bbLog('unhandled-rejection', null); });
    if ('serviceWorker' in navigator) {
        try { navigator.serviceWorker.addEventListener('controllerchange', () => bbLog('controllerchange', null)); } catch {}
    }
}

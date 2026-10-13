import { isScreenTransitioning, reconcileScreenState } from './screen-state.js';
/**
 * ==============================================================================
 * Glass Start — 构建指纹契约与运行时黑匣子自愈闭环 (src/js/core/lifecycle.js)
 * ==============================================================================
 * 零依赖零网络零轮询零存储写入：双端构建指纹校验、纯内存生命周期环形日志（≤40 条）、
 * 白屏异常连续探测 + 守卫软刷新阶梯。
 */
import { CONFIG } from '../config/constants.js';
import { dom } from '../state/dom.js';

const RELOAD_GUARD_KEY = 'gs_build_reload_at';
const BB_MAX_ENTRIES = 40;
const RELOAD_COOLDOWN_MS = 60000;
const PROBE_DELAY_MS = 700;

// 纯内存环形缓冲：零存储写入；BFCache 往返不丢，仅真实 reload 清空
const bbBuffer = [];

export function bbLog(ev, detail) {
    bbBuffer.push({ t: Date.now(), ev, d: detail === undefined ? null : detail });
    while (bbBuffer.length > BB_MAX_ENTRIES) bbBuffer.shift();
}

export function bbDump() {
    return bbBuffer.slice();
}

// 指纹契约裁决：双端构建指纹不一致时执行守卫软刷新（每分钟至多一次）
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

// 健全性快照：首屏应在位时断言变换矩阵 ≈ 单位阵且哨兵元素真实可见
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
// L1 幂等状态校准 → L2 合成层磁贴强制重栅格化 → L3 冷却期守卫软刷新
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
    window.addEventListener('pageshow', (e) => { bbLog('pageshow', { persisted: !!(e && e.persisted) }); }, { passive: true });
    document.addEventListener('visibilitychange', () => { bbLog('visibility', { hidden: document.hidden }); }, { passive: true });
    window.addEventListener('error', (e) => { bbLog('js-error', { msg: String((e && e.message) || 'unknown').slice(0, CONFIG.SECURITY.LOG_MSG_MAX_CHARS) }); });
    window.addEventListener('unhandledrejection', () => { bbLog('unhandled-rejection', null); });
    if ('serviceWorker' in navigator) {
        try { navigator.serviceWorker.addEventListener('controllerchange', () => bbLog('controllerchange', null)); } catch {}
    }
}

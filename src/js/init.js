/**
 * 应用初始化与生命周期挂载
 */
import { CONFIG, engines } from './config/constants.js';
import { storageGet, evictFaviconCache } from './utils/helpers.js';
import { cacheDOM } from './state/dom.js';
import { updateClock } from './modules/clock.js';
import { renderEngineDropdown, setEngine } from './modules/search.js';
import { restoreWallpaper, preloadNextBg } from './modules/wallpaper.js';
import { initWeather } from './modules/weather.js';
import {
    loadBookmarks,
    renderNavCategories,
    preloadFavicons,
    refreshSidebarNavCache,
    initFaviconObserver,
    handleIconError
} from './modules/bookmarks.js';
import { applyBgEffects } from './modules/settings.js';
import { handleEditIconError } from './modules/bookmark-editor.js';
import { reconcileScreenState, isScreenTransitioning, initTransitionSwitcher } from './core/screen-state.js';
import { initScreenGestures } from './core/screen-input.js';
import { initAppWakeEvents } from './core/app-wake.js';
import { initGlassSpotlightAndTilt } from './core/gestures.js';
import { bindEvents } from './core/events.js';
import { bindEditEvents } from './core/settings-events.js';
import { initServiceWorkerUpdates } from './core/service-worker-updates.js';

let isAppInitialized = false;

export function init() {
    if (isAppInitialized) return;
    isAppInitialized = true;
    cacheDOM();
    renderEngineDropdown();
    try {
        initWeather();
    } catch (err) {
        console.warn('天气组件初始化失败', err);
    }

    // 在捕获阶段处理图片加载失败，避免模板行内 onerror。
    document.addEventListener('error', (e) => {
        const target = /** @type {HTMLImageElement | null} */ (e.target instanceof HTMLImageElement ? e.target : null);
        if (target) {
            if (target.classList.contains('edit-favicon-img')) {
                handleEditIconError(target);
            } else if (target.dataset.initial !== undefined || target.closest('.icon-box')) {
                handleIconError(target);
            } else if (target.classList.contains('engine-icon') || target.dataset.hideOnError === '1') {
                evictFaviconCache(target.src);
                target.style.display = 'none';
            }
        }
    }, true);

    // 在捕获阶段处理图片加载成功，避免模板行内 onload。
    document.addEventListener('load', (e) => {
        const target = /** @type {HTMLImageElement | null} */ (e.target instanceof HTMLImageElement ? e.target : null);
        if (target && (target.classList.contains('lazy-icon') || target.classList.contains('edit-favicon-img'))) {
            target.classList.add('loaded');
        }
    }, true);

    updateClock();
    loadBookmarks();
    const wallpaperRestored = restoreWallpaper().then(() => true, () => false);
    renderNavCategories();
    reconcileScreenState();
    initScreenGestures();
    initAppWakeEvents();
    initGlassSpotlightAndTilt();
    initTransitionSwitcher();

    const saved = storageGet(CONFIG.KEYS.PREFERRED_ENGINE);
    if (saved && engines[saved]) setEngine(saved, false);

    bindEvents();
    bindEditEvents();

    const savedOpacity = storageGet(CONFIG.KEYS.MASK_OPACITY, CONFIG.APPEARANCE.DEFAULT_MASK_OPACITY);
    applyBgEffects(savedOpacity);

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
        initServiceWorkerUpdates();
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (isScreenTransitioning()) {
                return;
            }
            reconcileScreenState();
        });
    }

    /** @type {(fn: () => void, fallbackDelay?: number) => void} */
    const scheduleIdleTask = (fn, fallbackDelay = CONFIG.TIMERS.FALLBACK_IDLE_DELAY) => {
        if ('requestIdleCallback' in window) {
            requestIdleCallback(fn, { timeout: CONFIG.TIMERS.IDLE_TIMEOUT });
        } else {
            setTimeout(fn, fallbackDelay);
        }
    };

    scheduleIdleTask(() => {
        refreshSidebarNavCache();
        initFaviconObserver();
        preloadFavicons();
        // 恢复后再判断当前选择，避免在 IDB 返回前预加载默认预设。
        wallpaperRestored.then(restored => { if (restored) preloadNextBg(); });
    });

    setTimeout(() => {
        document.querySelectorAll('.fade-in').forEach(el => el.classList.remove('fade-in'));
    }, CONFIG.TIMERS.FADE_IN_UNLOAD);
}

/**
 * ==============================================================================
 * Glass Start — 应用初始化与生命周期挂载 (src/js/init.js)
 * ==============================================================================
 */
import { CONFIG, engines } from './config/constants.js';
import { storageGet } from './utils/helpers.js';
import { cacheDOM, dom } from './state/dom.js';
import { renderShortcutModalList, updateClock } from './modules/clock.js';
import { renderEngineDropdown, setEngine } from './modules/search.js';
import { renderPresetWallpapers } from './modules/wallpaper.js';
import { initWeather } from './modules/weather.js';
import {
    loadUserData,
    renderBookmarks,
    renderNavCategories,
    preloadFavicons,
    refreshSidebarNavCache,
    initFaviconObserver,
    handleIconError
} from './modules/bookmarks.js';
import { applyBgEffects, handleEditIconError } from './modules/settings.js';
import { preloadNextBg } from './modules/wallpaper.js';
import { initScreenGestures, reconcileScreenState } from './core/screen-state.js';
import { initGlassSpotlightAndTilt } from './core/gestures.js';
import { bindEvents, bindEditEvents } from './core/events.js';

let isAppInitialized = false;

export function init() {
    if (isAppInitialized) return;
    isAppInitialized = true;
    cacheDOM();
    renderShortcutModalList();
    renderEngineDropdown();
    renderPresetWallpapers();
    initWeather();

    // 全局捕获阶段图片加载错误处理器，彻底代替 HTML 模板行内 onerror 绑定
    document.addEventListener('error', (e) => {
        const target = e.target;
        if (target && target.tagName === 'IMG') {
            if (target.classList.contains('edit-favicon-img')) {
                handleEditIconError(target);
            } else if (target.dataset.initial !== undefined || target.closest('.icon-box')) {
                handleIconError(target);
            } else if (target.classList.contains('engine-icon') || target.dataset.hideOnError === '1') {
                const failedSrc = target.src;
                if (failedSrc && typeof caches !== 'undefined') {
                    try {
                        caches.open('app-favicons-v1').then(cache => cache.delete(failedSrc)).catch(() => {});
                    } catch {}
                }
                target.style.display = 'none';
            }
        }
    }, true);

    // 全局捕获阶段图片加载成功处理器，代替 HTML 模板行内 onload 绑定（为 CSP 收紧铺路）
    document.addEventListener('load', (e) => {
        const target = e.target;
        if (target && target.tagName === 'IMG' && (target.classList.contains('lazy-icon') || target.classList.contains('edit-favicon-img'))) {
            target.classList.add('loaded');
        }
    }, true);

    updateClock();
    loadUserData().catch(() => {});
    renderBookmarks();
    renderNavCategories();
    initScreenGestures();
    initGlassSpotlightAndTilt();

    const saved = storageGet(CONFIG.KEYS.PREFERRED_ENGINE);
    if (saved && engines[saved]) setEngine(saved, false);
    setInterval(updateClock, 1000);

    bindEvents();
    bindEditEvents();

    const savedOpacity = storageGet(CONFIG.KEYS.MASK_OPACITY, 15);
    const savedBlur = storageGet(CONFIG.KEYS.BG_BLUR, 0);
    applyBgEffects(savedOpacity, savedBlur);

    preloadNextBg();
    preloadFavicons();

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (typeof window.isScreenTransitioning === 'function' && window.isScreenTransitioning()) {
                return;
            }
            if (typeof window.reconcileScreenState === 'function') {
                window.reconcileScreenState();
            }
        });
    }

    const scheduleIdleTask = (fn, fallbackDelay = 1500) => {
        if ('requestIdleCallback' in window) {
            requestIdleCallback(fn, { timeout: 3000 });
        } else {
            setTimeout(fn, fallbackDelay);
        }
    };

    scheduleIdleTask(() => {
        refreshSidebarNavCache();
        initFaviconObserver(true);
    });

    setTimeout(() => {
        document.querySelectorAll('.fade-in').forEach(el => el.classList.remove('fade-in'));
    }, 800);
}

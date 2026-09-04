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
    initFaviconObserver
} from './modules/bookmarks.js';
import { applyBgEffects } from './modules/settings.js';
import { preloadNextBg } from './modules/wallpaper.js';
import { initScreenGestures, reconcileScreenState } from './core/screen-state.js';
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

    document.addEventListener('error', e => {
        if (e.target && e.target.tagName === 'IMG' && e.target.classList.contains('engine-icon')) {
            e.target.style.display = 'none';
        }
    }, true);

    updateClock();
    loadUserData().catch(() => {});
    renderBookmarks();
    renderNavCategories();
    initScreenGestures();

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

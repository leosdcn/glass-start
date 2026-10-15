/**
 * ==============================================================================
 * Glass Start — 应用初始化与生命周期挂载 (src/js/init.js)
 * ==============================================================================
 */
import { CONFIG, engines } from './config/constants.js';
import { storageGet, evictFaviconCache } from './utils/helpers.js';
import { cacheDOM, dom } from './state/dom.js';
import { renderShortcutModalList, updateClock } from './modules/clock.js';
import { renderEngineDropdown, setEngine } from './modules/search.js';
import { renderPresetWallpapers, restoreWallpaper } from './modules/wallpaper.js';
import { initWeather } from './modules/weather.js';
import {
    loadBookmarks,
    renderBookmarks,
    renderNavCategories,
    preloadFavicons,
    refreshSidebarNavCache,
    initFaviconObserver,
    handleIconError
} from './modules/bookmarks.js';
import { applyBgEffects } from './modules/settings.js';
import { handleEditIconError } from './modules/bookmark-editor.js';
import { preloadNextBg } from './modules/wallpaper.js';
import { initScreenGestures, reconcileScreenState, isScreenTransitioning } from './core/screen-state.js';
import { initGlassSpotlightAndTilt } from './core/gestures.js';
import { bindEvents } from './core/events.js';
import { bindEditEvents } from './core/settings-events.js';

let isAppInitialized = false;

export function init() {
    if (isAppInitialized) return;
    isAppInitialized = true;
    cacheDOM();
    renderShortcutModalList();
    renderEngineDropdown();
    renderPresetWallpapers();
    try {
        initWeather();
    } catch (err) {
        console.warn('天气组件初始化失败', err);
    }

    // 全局捕获阶段图片加载错误处理器，彻底代替 HTML 模板行内 onerror 绑定
    document.addEventListener('error', (e) => {
        const target = e.target;
        if (target && target.tagName === 'IMG') {
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

    // 全局捕获阶段图片加载成功处理器，代替 HTML 模板行内 onload 绑定（为 CSP 收紧铺路）
    document.addEventListener('load', (e) => {
        const target = e.target;
        if (target && target.tagName === 'IMG' && (target.classList.contains('lazy-icon') || target.classList.contains('edit-favicon-img'))) {
            target.classList.add('loaded');
        }
    }, true);

    updateClock();
    loadBookmarks();
    const wallpaperRestored = restoreWallpaper().then(() => true, () => false);
    renderBookmarks();
    renderNavCategories();
    initScreenGestures();
    initGlassSpotlightAndTilt();

    const saved = storageGet(CONFIG.KEYS.PREFERRED_ENGINE);
    if (saved && engines[saved]) setEngine(saved, false);

    bindEvents();
    bindEditEvents();

    const savedOpacity = storageGet(CONFIG.KEYS.MASK_OPACITY, CONFIG.APPEARANCE.DEFAULT_MASK_OPACITY);
    applyBgEffects(savedOpacity);

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (isScreenTransitioning()) {
                return;
            }
            reconcileScreenState();
        });
    }

    const scheduleIdleTask = (fn, fallbackDelay = CONFIG.TIMERS.FALLBACK_IDLE_DELAY) => {
        if ('requestIdleCallback' in window) {
            requestIdleCallback(fn, { timeout: CONFIG.TIMERS.IDLE_TIMEOUT });
        } else {
            setTimeout(fn, fallbackDelay);
        }
    };

    scheduleIdleTask(() => {
        refreshSidebarNavCache();
        initFaviconObserver(true);
        preloadFavicons();
        // 恢复后再判断当前选择，避免在 IDB 返回前预加载默认预设。
        wallpaperRestored.then(restored => { if (restored) preloadNextBg(); });
    });

    setTimeout(() => {
        document.querySelectorAll('.fade-in').forEach(el => el.classList.remove('fade-in'));
    }, CONFIG.TIMERS.FADE_IN_UNLOAD);
}

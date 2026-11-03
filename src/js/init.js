/**
 * 应用初始化与生命周期挂载
 */
import { CONFIG, engines } from './config/constants.js';
import { DEFAULT_ENGINE } from './config/engines.js';
import { storageGet, evictFaviconCache } from './utils/helpers.js';
import { state } from './state/store.js';
import { cacheDOM } from './state/dom.js';
import { updateClock } from './modules/clock.js';
import { renderEngineDropdown, setEngine, closeDropdown, hideSuggestions } from './modules/search.js';
import { restoreWallpaper, preloadNextBg } from './modules/wallpaper.js';
import { initWeather } from './modules/weather.js';
import {
    loadBookmarks,
    renderNavCategories,
    preloadFavicons,
    preloadVisibleNavIcons,
    refreshSidebarNavCache,
    updateSidebarActive,
    initFaviconObserver,
    activateVisibleNavIcons,
    scheduleOffscreenNavIcons,
    handleIconError
} from './modules/bookmarks.js';
import { applyBgEffects } from './modules/settings.js';
import { handleEditIconError } from './modules/bookmark-editor.js';
import { reconcileScreenState, isScreenTransitioning, initTransitionSwitcher, setScreenNavHandlers } from './core/screen-state.js';
import { initScreenGestures } from './core/screen-input.js';
import { initAppWakeEvents } from './core/app-wake.js';
import { initGlassSpotlightAndTilt } from './core/gestures.js';
import { bindEvents } from './events.js';
import { bindEditEvents } from './modules/settings-events.js';
import { initServiceWorkerUpdates } from './core/service-worker-updates.js';

let isAppInitialized = false;

/**
 * 在捕获阶段处理图片加载失败，按元素类型路由到对应处理逻辑
 * @param {Event} e
 */
function handleImageErrorCapture(e) {
    const target = /** @type {HTMLImageElement | null} */ (e.target instanceof HTMLImageElement ? e.target : null);
    if (!target) return;
    if (target.classList.contains('edit-favicon-img')) {
        handleEditIconError(target);
    } else if (target.dataset.initial !== undefined || target.closest('.icon-box')) {
        handleIconError(target);
    } else if (target.classList.contains('engine-icon') || target.dataset.hideOnError === '1') {
        evictFaviconCache(target.src);
        target.style.display = 'none';
    }
}

/**
 * 在捕获阶段处理图片加载成功，激活淡入类名
 * @param {Event} e
 */
function handleImageLoadCapture(e) {
    const target = /** @type {HTMLImageElement | null} */ (e.target instanceof HTMLImageElement ? e.target : null);
    if (target && (target.classList.contains('lazy-icon') || target.classList.contains('edit-favicon-img'))) {
        target.classList.add('loaded');
    }
}

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

    // 在捕获阶段处理图片加载失败与成功，避免模板行内 onerror/onload。
    document.addEventListener('error', handleImageErrorCapture, true);
    document.addEventListener('load', handleImageLoadCapture, true);

    updateClock();
    loadBookmarks();
    const wallpaperRestored = restoreWallpaper().then(() => true, () => false);
    setScreenNavHandlers({
        onPrepareNav: () => {
            renderNavCategories();
            activateVisibleNavIcons();
        },
        onRefreshNav: () => {
            refreshSidebarNavCache();
            updateSidebarActive();
            initFaviconObserver();
            scheduleOffscreenNavIcons();
        },
        onBeforeNavTransition: () => {
            closeDropdown();
            hideSuggestions();
        }
    });
    reconcileScreenState();
    initScreenGestures();
    initAppWakeEvents();
    initGlassSpotlightAndTilt();
    initTransitionSwitcher();

    const saved = storageGet(CONFIG.KEYS.PREFERRED_ENGINE);
    setEngine(saved && engines[saved] ? saved : DEFAULT_ENGINE, false);

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
        // 启动预热：若已处于导航屏（reconcileScreenState 恢复时已触发钩子构建），跳过重复渲染；
        // 起始屏时提前预热导航区，用户首次切屏时即可直接呈现。
        if (state.currentSection !== 'nav') {
            renderNavCategories();
        }
        refreshSidebarNavCache();
        initFaviconObserver();
        preloadFavicons();
        // 恢复后再判断当前选择，避免在 IDB 返回前预加载默认预设。
        wallpaperRestored.then(restored => { if (restored) preloadNextBg(); });
    });

    // 壁纸恢复后再申请独立空闲任务；快速切屏照常进入，不等待图标准备。
    wallpaperRestored.then(() => scheduleIdleTask(() => {
        if (!isScreenTransitioning()) preloadVisibleNavIcons();
    }));

    setTimeout(() => {
        document.querySelectorAll('.fade-in').forEach(el => el.classList.remove('fade-in'));
    }, CONFIG.TIMERS.FADE_IN_UNLOAD);
}

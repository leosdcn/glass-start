/**
 * ==============================================================================
 * Glass Start — 主应用入口 (src/js/main.js)
 * ==============================================================================
 */

// 1. 配置与常量
import {
    DEFAULT_BOOKMARKS,
    DEFAULT_CATEGORIES,
    CONFIG,
    engines,
    backgrounds,
    IS_MAC
} from './config/constants.js';
import {
    APP_THEME_DARK,
    APP_THEME_LIGHT,
    PRESET_WALLPAPER_THEMES,
    PRESET_THEMES
} from './config/themes.js';

// 2. 工具函数与存储
import {
    escapeHtml,
    safeUrl,
    normalizeUrl,
    getHostname,
    deriveNameFromUrl,
    faviconFromUrl,
    createLetterBadgeHtml,
    clamp,
    debounce,
    storageGet,
    storageSet,
    storageRemove
} from './utils/helpers.js';
import {
    dbPromise,
    getWallpaperDB,
    setWallpaperDB,
    removeWallpaperDB
} from './utils/idb.js';

// 3. 状态与 DOM
import { state, modalState, pageData } from './state/store.js';
import { dom, cacheDOM, $ } from './state/dom.js';

// 4. 多层弹窗层叠栈
import { OverlayStack, MODAL_OVERLAY_IDS } from './core/overlay-stack.js';

// 5. 挂载关键接口至全局 window，满足 CDP 自动化测试与运行时全局调用
Object.assign(window, {
    CONFIG,
    engines,
    backgrounds,
    IS_MAC,
    APP_THEME_DARK,
    APP_THEME_LIGHT,
    PRESET_WALLPAPER_THEMES,
    PRESET_THEMES,
    escapeHtml,
    safeUrl,
    normalizeUrl,
    getHostname,
    deriveNameFromUrl,
    faviconFromUrl,
    createLetterBadgeHtml,
    clamp,
    debounce,
    storageGet,
    storageSet,
    storageRemove,
    dbPromise,
    getWallpaperDB,
    setWallpaperDB,
    removeWallpaperDB,
    state,
    modalState,
    pageData,
    dom,
    cacheDOM,
    $,
    OverlayStack,
    MODAL_OVERLAY_IDS
});

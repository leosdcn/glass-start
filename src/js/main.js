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
    PRESET_WALLPAPER_TINTS,
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
    evictFaviconCache,
    checkImageReady,
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
    PRESET_WALLPAPER_TINTS,
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
    evictFaviconCache,
    checkImageReady,
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

// 6. 双屏切屏有限状态机与手势调度
import {
    updateSectionAccessibility,
    getSavedSection,
    saveSection,
    updateGearVisibility,
    isScreenTransitioning,
    reconcileScreenState,
    switchToNav,
    switchToStart,
    normDelta,
    handleAppWakeUp,
    initScreenGestures
} from './core/screen-state.js';

// 7. 3D 倾斜手势与黑匣子生命周期
import { initGlassSpotlightAndTilt } from './core/gestures.js';
import {
    bbLog,
    bbDump,
    verifyFingerprint,
    snapshotHealth,
    probe,
    initLifecycleAndBlackbox
} from './core/lifecycle.js';

// 8. 外壳主题与壁纸模块
import {
    updateThemeColor,
    syncThemeForSection,
    setWallpaperTheme,
    sampleCustomWallpaperTheme,
    applyWallpaper
} from './core/theme-engine.js';
import {
    getEffectiveCustomWallpaper,
    findPresetBgIndex,
    clearCustomWallpaper,
    updateWallpaperStatusUI,
    updatePresetBgCardsUI,
    commitWallpaperSelection,
    previewDraftWallpaper,
    resetDraftWallpaper,
    switchBg,
    preloadNextBg
} from './modules/wallpaper.js';

// 挂载核心方法至 window
Object.assign(window, {
    updateSectionAccessibility,
    getSavedSection,
    saveSection,
    updateGearVisibility,
    isScreenTransitioning,
    reconcileScreenState,
    switchToNav,
    switchToStart,
    normDelta,
    handleAppWakeUp,
    initScreenGestures,
    initGlassSpotlightAndTilt,
    bbLog,
    bbDump,
    verifyFingerprint,
    snapshotHealth,
    probe,
    initLifecycleAndBlackbox,
    updateThemeColor,
    syncThemeForSection,
    setWallpaperTheme,
    sampleCustomWallpaperTheme,
    applyWallpaper,
    getEffectiveCustomWallpaper,
    findPresetBgIndex,
    clearCustomWallpaper,
    updateWallpaperStatusUI,
    updatePresetBgCardsUI,
    commitWallpaperSelection,
    previewDraftWallpaper,
    resetDraftWallpaper,
    switchBg,
    preloadNextBg
});

// 9. 搜索模块
import {
    suggestionScriptTag,
    selectedSuggestionIdx,
    setSelectedSuggestionIdx,
    originalQuery,
    setOriginalQuery,
    suggestDebounceTimer,
    activeSuggestReqId,
    setActiveSuggestReqId,
    renderEngineDropdown,
    toggleDropdown,
    closeDropdown,
    setEngine,
    doSearch,
    openBookmarkUrl,
    openRandomBookmark,
    damerauLevenshteinDistance,
    getFuzzyScore,
    getSearchCandidates,
    getLocalBookmarkSuggestions,
    renderSuggestions,
    hideSuggestions,
    fetchSuggestions
} from './modules/search.js';

// 10. 气象模块
import {
    WMO_WEATHER_MAP,
    getWeatherInfo,
    weatherNum,
    weatherTime,
    fetchWithTimeout,
    openWeatherPopover,
    closeWeatherPopover,
    toggleWeatherPopover,
    formatLocationFullName,
    stripAdminSuffix,
    resolveWeatherLocation,
    fetchWeatherForecast,
    renderWeatherCapsule,
    renderWeatherError,
    renderWeatherPopover,
    isFetchingWeather,
    updateWeather,
    initWeather
} from './modules/weather.js';

// 11. 书签与导航模块
import {
    zhCollator,
    getDerivedBookmarks,
    migrateBookmarksStorage,
    saveUserBookmarks,
    loadUserData,
    handleIconError,
    getFaviconHTML,
    initFaviconObserver,
    initPickerFaviconObserver,
    renderBookmarks,
    getSortedCategories,
    refreshSidebarNavCache,
    scrollTabIntoView,
    updateSidebarActive,
    renderNavCategories,
    initSidebarNav,
    preloadFavicons
} from './modules/bookmarks.js';

// 12. 时钟与平台快捷键
import {
    KBD,
    applyPlatformShortcuts,
    renderShortcutModalList,
    renderCreditsModalList,
    updateClock,
    lastTimeStr,
    setLastTimeStr
} from './modules/clock.js';

// 13. 设置与弹窗
import {
    animateShowModal,
    animateHideModal,
    getDraftBookmarkCount,
    updateBookmarkCountBadge,
    updatePickerCount,
    updateAllBookmarkCounters,
    loadPresetBgCardImages,
    switchSettingsTab,
    applyBgEffects,
    getEditFaviconInner,
    handleEditIconError,
    getEditRowHTML,
    renderEditList,
    collectEditData,
    openEditModal,
    cancelEditModal,
    closeEditModal,
    openShortcutModal,
    closeShortcutModal,
    openCreditsModal,
    closeCreditsModal,
    showConfirm,
    openBookmarkPicker,
    closeBookmarkPicker,
    exportBookmarksJSON,
    importBookmarksJSON,
    resetBookmarks,
    getExistingUrls,
    appendDraftBookmarkRow,
    renderPickerCategories
} from './modules/settings.js';

// 14. 预设壁纸渲染
import { renderPresetWallpapers } from './modules/wallpaper.js';

// 15. 全局事件与初始化
import {
    handleModalTabFocus,
    bindEvents,
    initDragSort,
    bindEditEvents
} from './core/events.js';
import { init } from './init.js';

// 全量挂载全部模块导出至 window
Object.assign(window, {
    DEFAULT_BOOKMARKS,
    DEFAULT_CATEGORIES,
    suggestionScriptTag,
    selectedSuggestionIdx,
    originalQuery,
    suggestDebounceTimer,
    renderEngineDropdown,
    toggleDropdown,
    closeDropdown,
    setEngine,
    doSearch,
    openBookmarkUrl,
    openRandomBookmark,
    damerauLevenshteinDistance,
    getFuzzyScore,
    getSearchCandidates,
    getLocalBookmarkSuggestions,
    renderSuggestions,
    hideSuggestions,
    fetchSuggestions,
    WMO_WEATHER_MAP,
    getWeatherInfo,
    weatherNum,
    weatherTime,
    fetchWithTimeout,
    openWeatherPopover,
    closeWeatherPopover,
    toggleWeatherPopover,
    formatLocationFullName,
    stripAdminSuffix,
    resolveWeatherLocation,
    fetchWeatherForecast,
    renderWeatherCapsule,
    renderWeatherError,
    renderWeatherPopover,
    isFetchingWeather,
    updateWeather,
    initWeather,
    zhCollator,
    getDerivedBookmarks,
    migrateBookmarksStorage,
    saveUserBookmarks,
    loadUserData,
    handleIconError,
    getFaviconHTML,
    initFaviconObserver,
    initPickerFaviconObserver,
    renderBookmarks,
    getSortedCategories,
    refreshSidebarNavCache,
    scrollTabIntoView,
    updateSidebarActive,
    renderNavCategories,
    initSidebarNav,
    preloadFavicons,
    KBD,
    applyPlatformShortcuts,
    renderShortcutModalList,
    renderCreditsModalList,
    updateClock,
    animateShowModal,
    animateHideModal,
    getDraftBookmarkCount,
    updateBookmarkCountBadge,
    updatePickerCount,
    updateAllBookmarkCounters,
    loadPresetBgCardImages,
    switchSettingsTab,
    applyBgEffects,
    getEditFaviconInner,
    handleEditIconError,
    getEditRowHTML,
    renderEditList,
    collectEditData,
    openEditModal,
    cancelEditModal,
    closeEditModal,
    openShortcutModal,
    closeShortcutModal,
    openCreditsModal,
    closeCreditsModal,
    showConfirm,
    openBookmarkPicker,
    closeBookmarkPicker,
    exportBookmarksJSON,
    importBookmarksJSON,
    resetBookmarks,
    updatePickerCount,
    getExistingUrls,
    appendDraftBookmarkRow,
    renderPickerCategories,
    renderPresetWallpapers,
    handleModalTabFocus,
    bindEvents,
    initDragSort,
    bindEditEvents,
    init
});

// 动态响应式属性绑定（确保 CDP 单测脚本与模块内部状态双向互通）
if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'activeSuggestReqId', {
        get: () => activeSuggestReqId,
        set: (v) => { setActiveSuggestReqId(v); },
        configurable: true
    });
    Object.defineProperty(window, 'lastTimeStr', {
        get: () => lastTimeStr,
        set: (v) => { setLastTimeStr(v); },
        configurable: true
    });
    Object.defineProperty(window, 'selectedSuggestionIdx', {
        get: () => selectedSuggestionIdx,
        set: (v) => { setSelectedSuggestionIdx(v); },
        configurable: true
    });
    Object.defineProperty(window, 'originalQuery', {
        get: () => originalQuery,
        set: (v) => { setOriginalQuery(v); },
        configurable: true
    });
}

// DOMContentLoaded 自动初始化启动
if (typeof window !== 'undefined') {
    initLifecycleAndBlackbox();
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}


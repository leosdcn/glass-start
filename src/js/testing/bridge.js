/** 测试兼容接口：名单仅声明一次，正常页面不挂载。 */
import * as wallpaper_renderer from '../core/wallpaper-renderer.js';
import * as clock from '../modules/clock.js';
import * as gestures from '../core/gestures.js';
import * as constants from '../config/constants.js';
import * as themes from '../config/themes.js';
import * as helpers from '../utils/helpers.js';
import * as idb from '../utils/idb.js';
import * as store from '../state/store.js';
import * as domState from '../state/dom.js';
import * as overlay_stack from '../core/overlay-stack.js';
import * as screen_state from '../core/screen-state.js';
import * as lifecycle from '../core/lifecycle.js';
import * as theme_engine from '../core/theme-engine.js';
import * as wallpaper from '../modules/wallpaper.js';
import * as search from '../modules/search.js';
import * as weather from '../modules/weather.js';
import * as bookmarks from '../modules/bookmarks.js';
import * as settings from '../modules/settings.js';
import * as events from '../core/events.js';
import * as app from '../init.js';

// 只暴露现有测试接口，不自动展开模块的其他导出。
Object.assign(window, {
    CONFIG: constants.CONFIG,
    engines: constants.engines,
    backgrounds: constants.backgrounds,
    IS_MAC: constants.IS_MAC,
    APP_THEME_DARK: themes.APP_THEME_DARK,
    APP_THEME_LIGHT: themes.APP_THEME_LIGHT,
    PRESET_WALLPAPER_THEMES: themes.PRESET_WALLPAPER_THEMES,
    PRESET_WALLPAPER_TINTS: themes.PRESET_WALLPAPER_TINTS,
    PRESET_THEMES: themes.PRESET_THEMES,
    escapeHtml: helpers.escapeHtml,
    safeUrl: helpers.safeUrl,
    normalizeUrl: helpers.normalizeUrl,
    getHostname: helpers.getHostname,
    deriveNameFromUrl: helpers.deriveNameFromUrl,
    faviconFromUrl: helpers.faviconFromUrl,
    faviconFallbackFromUrl: helpers.faviconFallbackFromUrl,
    createLetterBadgeHtml: helpers.createLetterBadgeHtml,
    clamp: helpers.clamp,
    debounce: helpers.debounce,
    evictFaviconCache: helpers.evictFaviconCache,
    checkImageReady: helpers.checkImageReady,
    storageGet: helpers.storageGet,
    storageSet: helpers.storageSet,
    storageRemove: helpers.storageRemove,
    dbPromise: idb.dbPromise,
    getWallpaperDB: idb.getWallpaperDB,
    setWallpaperDB: idb.setWallpaperDB,
    removeWallpaperDB: idb.removeWallpaperDB,
    state: store.state,
    modalState: store.modalState,
    pageData: store.pageData,
    dom: domState.dom,
    cacheDOM: domState.cacheDOM,
    $: domState.$,
    OverlayStack: overlay_stack.OverlayStack,
    MODAL_OVERLAY_IDS: overlay_stack.MODAL_OVERLAY_IDS,
    updateSectionAccessibility: screen_state.updateSectionAccessibility,
    getSavedSection: screen_state.getSavedSection,
    saveSection: screen_state.saveSection,
    updateGearVisibility: screen_state.updateGearVisibility,
    isScreenTransitioning: screen_state.isScreenTransitioning,
    reconcileScreenState: screen_state.reconcileScreenState,
    switchToNav: screen_state.switchToNav,
    switchToStart: screen_state.switchToStart,
    normDelta: screen_state.normDelta,
    handleAppWakeUp: screen_state.handleAppWakeUp,
    initScreenGestures: screen_state.initScreenGestures,
    initGlassSpotlightAndTilt: gestures.initGlassSpotlightAndTilt,
    bbLog: lifecycle.bbLog,
    bbDump: lifecycle.bbDump,
    verifyFingerprint: lifecycle.verifyFingerprint,
    snapshotHealth: lifecycle.snapshotHealth,
    probe: lifecycle.probe,
    initLifecycleAndBlackbox: lifecycle.initLifecycleAndBlackbox,
    updateThemeColor: theme_engine.updateThemeColor,
    syncThemeForSection: theme_engine.syncThemeForSection,
    setWallpaperTheme: theme_engine.setWallpaperTheme,
    sampleCustomWallpaperTheme: theme_engine.sampleCustomWallpaperTheme,
    applyWallpaper: wallpaper_renderer.applyWallpaper,
    getEffectiveCustomWallpaper: wallpaper.getEffectiveCustomWallpaper,
    findPresetBgIndex: wallpaper.findPresetBgIndex,
    clearCustomWallpaper: wallpaper.clearCustomWallpaper,
    updateWallpaperStatusUI: wallpaper.updateWallpaperStatusUI,
    updatePresetBgCardsUI: wallpaper.updatePresetBgCardsUI,
    commitWallpaperSelection: wallpaper.commitWallpaperSelection,
    previewDraftWallpaper: wallpaper.previewDraftWallpaper,
    resetDraftWallpaper: wallpaper.resetDraftWallpaper,
    switchBg: wallpaper.switchBg,
    preloadNextBg: wallpaper.preloadNextBg,
    DEFAULT_BOOKMARKS: constants.DEFAULT_BOOKMARKS,
    DEFAULT_CATEGORIES: constants.DEFAULT_CATEGORIES,
    suggestionScriptTag: search.suggestionScriptTag,
    selectedSuggestionIdx: search.selectedSuggestionIdx,
    originalQuery: search.originalQuery,
    suggestDebounceTimer: search.suggestDebounceTimer,
    renderEngineDropdown: search.renderEngineDropdown,
    toggleDropdown: search.toggleDropdown,
    closeDropdown: search.closeDropdown,
    setEngine: search.setEngine,
    doSearch: search.doSearch,
    openBookmarkUrl: search.openBookmarkUrl,
    openRandomBookmark: search.openRandomBookmark,
    damerauLevenshteinDistance: search.damerauLevenshteinDistance,
    getFuzzyScore: search.getFuzzyScore,
    getSearchCandidates: search.getSearchCandidates,
    getLocalBookmarkSuggestions: search.getLocalBookmarkSuggestions,
    renderSuggestions: search.renderSuggestions,
    hideSuggestions: search.hideSuggestions,
    fetchSuggestions: search.fetchSuggestions,
    WMO_WEATHER_MAP: weather.WMO_WEATHER_MAP,
    getWeatherInfo: weather.getWeatherInfo,
    weatherNum: weather.weatherNum,
    weatherTime: weather.weatherTime,
    fetchWithTimeout: weather.fetchWithTimeout,
    openWeatherPopover: weather.openWeatherPopover,
    closeWeatherPopover: weather.closeWeatherPopover,
    toggleWeatherPopover: weather.toggleWeatherPopover,
    formatLocationFullName: weather.formatLocationFullName,
    stripAdminSuffix: weather.stripAdminSuffix,
    resolveWeatherLocation: weather.resolveWeatherLocation,
    fetchWeatherForecast: weather.fetchWeatherForecast,
    renderWeatherCapsule: weather.renderWeatherCapsule,
    renderWeatherError: weather.renderWeatherError,
    renderWeatherPopover: weather.renderWeatherPopover,
    isFetchingWeather: weather.isFetchingWeather,
    updateWeather: weather.updateWeather,
    initWeather: weather.initWeather,
    zhCollator: bookmarks.zhCollator,
    getDerivedBookmarks: bookmarks.getDerivedBookmarks,
    migrateBookmarksStorage: bookmarks.migrateBookmarksStorage,
    saveUserBookmarks: bookmarks.saveUserBookmarks,
    loadUserData: bookmarks.loadUserData,
    handleIconError: bookmarks.handleIconError,
    getFaviconHTML: bookmarks.getFaviconHTML,
    initFaviconObserver: bookmarks.initFaviconObserver,
    initPickerFaviconObserver: bookmarks.initPickerFaviconObserver,
    renderBookmarks: bookmarks.renderBookmarks,
    getSortedCategories: bookmarks.getSortedCategories,
    refreshSidebarNavCache: bookmarks.refreshSidebarNavCache,
    scrollTabIntoView: bookmarks.scrollTabIntoView,
    updateSidebarActive: bookmarks.updateSidebarActive,
    renderNavCategories: bookmarks.renderNavCategories,
    initSidebarNav: bookmarks.initSidebarNav,
    preloadFavicons: bookmarks.preloadFavicons,
    KBD: clock.KBD,
    applyPlatformShortcuts: clock.applyPlatformShortcuts,
    renderShortcutModalList: clock.renderShortcutModalList,
    renderCreditsModalList: clock.renderCreditsModalList,
    updateClock: clock.updateClock,
    scheduleClockTick: clock.scheduleClockTick,
    stopClockTimer: clock.stopClockTimer,
    getDraftBookmarkCount: settings.getDraftBookmarkCount,
    updateAllBookmarkCounters: settings.updateAllBookmarkCounters,
    loadPresetBgCardImages: settings.loadPresetBgCardImages,
    switchSettingsTab: settings.switchSettingsTab,
    applyBgEffects: settings.applyBgEffects,
    getEditFaviconInner: settings.getEditFaviconInner,
    handleEditIconError: settings.handleEditIconError,
    getEditRowHTML: settings.getEditRowHTML,
    renderEditList: settings.renderEditList,
    collectEditData: settings.collectEditData,
    openEditModal: settings.openEditModal,
    cancelEditModal: settings.cancelEditModal,
    closeEditModal: settings.closeEditModal,
    openShortcutModal: settings.openShortcutModal,
    closeShortcutModal: settings.closeShortcutModal,
    openCreditsModal: settings.openCreditsModal,
    closeCreditsModal: settings.closeCreditsModal,
    showConfirm: settings.showConfirm,
    openBookmarkPicker: settings.openBookmarkPicker,
    closeBookmarkPicker: settings.closeBookmarkPicker,
    exportBookmarksJSON: settings.exportBookmarksJSON,
    importBookmarksJSON: settings.importBookmarksJSON,
    resetBookmarks: settings.resetBookmarks,
    getExistingUrls: settings.getExistingUrls,
    appendDraftBookmarkRow: settings.appendDraftBookmarkRow,
    renderPickerCategories: settings.renderPickerCategories,
    renderPresetWallpapers: wallpaper.renderPresetWallpapers,
    handleModalTabFocus: events.handleModalTabFocus,
    bindEvents: events.bindEvents,
    initDragSort: events.initDragSort,
    bindEditEvents: events.bindEditEvents,
    init: app.init,
});

// 可变导出通过访问器实时读取，保留原有可写接口和属性描述符。
Object.defineProperties(window, {
    activeSuggestReqId: {
        get: () => search.activeSuggestReqId,
        set: value => search.setActiveSuggestReqId(value),
        configurable: true
    },
    lastTimeStr: {
        get: () => clock.lastTimeStr,
        set: value => clock.setLastTimeStr(value),
        configurable: true
    },
    selectedSuggestionIdx: {
        get: () => search.selectedSuggestionIdx,
        set: value => search.setSelectedSuggestionIdx(value),
        configurable: true
    },
    originalQuery: {
        get: () => search.originalQuery,
        set: value => search.setOriginalQuery(value),
        configurable: true
    },
    suggestionScriptTag: {
        get: () => search.suggestionScriptTag,
        configurable: true
    },
    suggestDebounceTimer: {
        get: () => search.suggestDebounceTimer,
        configurable: true
    },
    isFetchingWeather: {
        get: () => weather.isFetchingWeather,
        configurable: true
    },
    lastDateDay: {
        get: () => clock.lastDateDay,
        set: value => clock.setLastDateDay(value),
        configurable: true
    },
});
window.resetActiveTiltCard = gestures.resetActiveCard;

/** 仅暴露当前回归测试使用的接口，正常页面不挂载。 */
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
import { handleAppWakeUp } from '../core/app-wake.js';
import * as lifecycle from '../core/lifecycle.js';
import * as wallpaper from '../modules/wallpaper.js';
import * as search from '../modules/search.js';
import * as weather from '../modules/weather.js';
import * as bookmarks from '../modules/bookmarks.js';
import * as settings from '../modules/settings.js';
import * as editor from '../modules/bookmark-editor.js';
import { replaceBookmarkDraft } from '../state/bookmark-draft.js';
import * as dialogs from '../core/dialogs.js';
import * as settingsEvents from '../core/settings-events.js';
import * as app from '../init.js';

// 只暴露现有测试接口，不自动展开模块的其他导出。
Object.assign(window, {
    replaceBookmarkDraft,
    resetUserBookmarks: bookmarks.resetUserBookmarks,
    reconcileScreenState: screen_state.reconcileScreenState,
    setTransitionMode: screen_state.setTransitionMode,
    getTransitionMode: screen_state.getTransitionMode,
    getWallpaperSelectionDB: idb.getWallpaperSelectionDB,
    importBookmarksJSON: settings.importBookmarksJSON,
    previewDraftMaskOpacity: settings.previewDraftMaskOpacity,
    saveEditModal: settings.saveEditModal,
    uploadWallpaper: wallpaper.uploadWallpaper,
    flushWallpaperSelection: wallpaper.flushWallpaperSelection,
    CONFIG: constants.CONFIG,
    backgrounds: constants.backgrounds,
    PRESET_WALLPAPER_THEMES: themes.PRESET_WALLPAPER_THEMES,
    PRESET_WALLPAPER_TINTS: themes.PRESET_WALLPAPER_TINTS,
    PRESET_THEMES: themes.PRESET_THEMES,
    escapeHtml: helpers.escapeHtml,
    safeUrl: helpers.safeUrl,
    normalizeUrl: helpers.normalizeUrl,
    faviconFallbackFromUrl: helpers.faviconFallbackFromUrl,
    storageGet: helpers.storageGet,
    storageSet: helpers.storageSet,
    storageRemove: helpers.storageRemove,
    getWallpaperDB: idb.getWallpaperDB,
    setWallpaperDB: idb.setWallpaperDB,
    removeWallpaperDB: idb.removeWallpaperDB,
    state: store.state,
    modalState: store.modalState,
    pageData: store.pageData,
    dom: domState.dom,
    $: domState.$,
    OverlayStack: overlay_stack.OverlayStack,
    isScreenTransitioning: screen_state.isScreenTransitioning,
    switchToNav: screen_state.switchToNav,
    switchToStart: screen_state.switchToStart,
    handleAppWakeUp,
    verifyFingerprint: lifecycle.verifyFingerprint,
    probe: lifecycle.probe,
    applyWallpaper: wallpaper_renderer.applyWallpaper,
    getPreparedWallpaperImage: wallpaper_renderer.getPreparedWallpaperImage,
    getEffectiveCustomWallpaper: wallpaper.getEffectiveCustomWallpaper,
    clearCustomWallpaper: wallpaper.clearCustomWallpaper,
    commitWallpaperSelection: wallpaper.commitWallpaperSelection,
    previewDraftWallpaper: wallpaper.previewDraftWallpaper,
    resetDraftWallpaper: wallpaper.resetDraftWallpaper,
    DEFAULT_BOOKMARKS: constants.DEFAULT_BOOKMARKS,
    DEFAULT_CATEGORIES: constants.DEFAULT_CATEGORIES,
    getLocalBookmarkSuggestions: search.getLocalBookmarkSuggestions,
    invalidateSearchCandidates: search.invalidateSearchCandidates,
    hideSuggestions: search.hideSuggestions,
    fetchSuggestions: search.fetchSuggestions,
    weatherNum: weather.weatherNum,
    weatherTime: weather.weatherTime,
    openWeatherPopover: weather.openWeatherPopover,
    formatLocationFullName: weather.formatLocationFullName,
    fetchWeatherForecast: weather.fetchWeatherForecast,
    updateWeather: weather.updateWeather,
    renderWeatherCapsule: weather.renderWeatherCapsule,
    renderWeatherPopover: weather.renderWeatherPopover,
    getDerivedBookmarks: bookmarks.getDerivedBookmarks,
    saveUserBookmarks: bookmarks.saveUserBookmarks,
    loadBookmarks: bookmarks.loadBookmarks,
    restoreWallpaper: wallpaper.restoreWallpaper,
    handleIconError: bookmarks.handleIconError,
    renderBookmarks: bookmarks.renderBookmarks,
    renderNavCategories: bookmarks.renderNavCategories,
    preloadVisibleNavIcons: bookmarks.preloadVisibleNavIcons,
    updateSidebarActive: bookmarks.updateSidebarActive,
    updateClock: clock.updateClock,
    handleEditIconError: editor.handleEditIconError,
    renderEditList: editor.renderEditList,
    collectEditData: editor.collectEditData,
    openEditModal: settings.openEditModal,
    cancelEditModal: settings.cancelEditModal,
    closeEditModal: settings.closeEditModal,
    openShortcutModal: settings.openShortcutModal,
    closeShortcutModal: settings.closeShortcutModal,
    openCreditsModal: settings.openCreditsModal,
    closeCreditsModal: settings.closeCreditsModal,
    showConfirm: dialogs.showConfirm,
    openBookmarkPicker: settings.openBookmarkPicker,
    exportBookmarksJSON: settings.exportBookmarksJSON,
    resetBookmarks: settings.resetBookmarks,
    getExistingUrls: editor.getExistingUrls,
    bindEditEvents: settingsEvents.bindEditEvents,
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

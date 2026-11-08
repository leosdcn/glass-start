/** 仅暴露当前回归测试使用的接口，正常页面不挂载。 */
import * as wallpaper_renderer from '../core/wallpaper-renderer.js';
import * as clock from '../modules/clock.js';
import * as gestures from '../core/gestures.js';
import * as constants from '../config/constants.js';
import * as themes from '../config/themes.js';
import * as helpers from '../utils/helpers.js';
import * as bookmarkModel from '../utils/bookmark-model.js';
import * as storage from '../utils/storage.js';
import * as favicon from '../utils/favicon.js';
import * as idb from '../utils/idb.js';
import * as store from '../state/store.js';
import * as domState from '../state/dom.js';
import * as overlay_stack from '../core/overlay-stack.js';
import * as screen_state from '../core/screen-state.js';
import { handleAppWakeUp } from '../events.js';
import * as wallpaper from '../modules/wallpaper.js';
import * as search from '../modules/search.js';
import * as weather from '../modules/weather.js';
import * as bookmarks from '../modules/bookmarks.js';
import * as settings from '../modules/settings.js';
import * as bookmarkPicker from '../modules/bookmark-picker.js';
import * as editor from '../modules/bookmark-editor.js';
import { replaceBookmarkDraft } from '../state/bookmark-draft.js';
import * as dialogs from '../core/dialogs.js';
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
    PRESET_TINTS: themes.PRESET_TINTS,
    PRESET_THEMES: themes.PRESET_THEMES,
    safeUrl: helpers.safeUrl,
    normalizeUrl: bookmarkModel.normalizeUrl,
    storageGet: storage.storageGet,
    storageSet: storage.storageSet,
    storageRemove: storage.storageRemove,
    setWallpaperSelectionDB: idb.setWallpaperSelectionDB,
    removeWallpaperDB: idb.removeWallpaperDB,
    state: store.state,
    modalState: store.modalState,
    pageData: store.pageData,
    dom: domState.dom,
    OverlayStack: overlay_stack.OverlayStack,
    isScreenTransitioning: screen_state.isScreenTransitioning,
    switchToNav: screen_state.switchToNav,
    switchToStart: screen_state.switchToStart,
    handleAppWakeUp,
    applyWallpaper: wallpaper_renderer.applyWallpaper,
    getPreparedWallpaperImage: wallpaper_renderer.getPreparedWallpaperImage,
    getCommittedWallpaperUrl: wallpaper.getCommittedWallpaperUrl,
    selectWallpaper: wallpaper.selectWallpaper,
    clearCustomWallpaper: wallpaper.clearCustomWallpaper,
    commitWallpaperSelection: wallpaper.commitWallpaperSelection,
    previewDraftWallpaper: wallpaper.previewDraftWallpaper,
    resetDraftWallpaper: wallpaper.resetDraftWallpaper,
    DEFAULT_BOOKMARKS: constants.DEFAULT_BOOKMARKS,
    DEFAULT_CATEGORIES: constants.DEFAULT_CATEGORIES,
    hideSuggestions: search.hideSuggestions,
    fetchSuggestions: search.fetchSuggestions,
    openWeatherPopover: weather.openWeatherPopover,
    fetchWeatherForecast: weather.fetchWeatherForecast,
    updateWeather: weather.updateWeather,
    renderWeatherCapsule: weather.renderWeatherCapsule,
    renderWeatherPopover: weather.renderWeatherPopover,
    getDerivedBookmarks: bookmarks.getDerivedBookmarks,
    saveUserBookmarks: bookmarks.saveUserBookmarks,
    loadBookmarks: bookmarks.loadBookmarks,
    restoreWallpaper: wallpaper.restoreWallpaper,
    handleIconError: favicon.handleIconError,
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
    openBookmarkPicker: bookmarkPicker.openBookmarkPicker,
    exportBookmarksJSON: settings.exportBookmarksJSON,
    resetBookmarks: settings.resetBookmarks,
    init: app.init,
});

// 可变导出通过只读访问器实时读取，不允许测试直接改写业务状态。
Object.defineProperties(window, {
    activeSuggestReqId: {
        get: () => search.activeSuggestReqId,
        configurable: true
    },
    selectedSuggestionIdx: {
        get: () => search.selectedSuggestionIdx,
        configurable: true
    },
    suggestionScriptTag: {
        get: () => search.suggestionScriptTag,
        configurable: true
    },
    isFetchingWeather: {
        get: () => weather.isFetchingWeather(),
        configurable: true
    },
});
window.resetActiveTiltCard = gestures.resetActiveCard;

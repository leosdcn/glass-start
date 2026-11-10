/**
 * 高频 DOM 节点缓存池与选择器
 */

/** @param {string} id */
const $ = id => document.getElementById(id);

// 高频 DOM 节点底层存储表
/** @type {Partial<import('../types').DOMCache>} */
const _domStore = {};

/**
 * 高频 DOM 节点全局缓存映射表（带 Proxy 动态自愈机制）
 * 节点尚未挂载或被替换时，通过 ID 重新查找并回填缓存。
 */
export const dom = new Proxy(_domStore, {
    get(target, prop) {
        if (typeof prop !== 'string') return Reflect.get(target, prop);
        let el = target[prop];
        if (!el || (el instanceof Element && !el.isConnected)) {
            const fresh = $(prop);
            if (fresh) {
                target[prop] = fresh;
                return fresh;
            }
        }
        return el;
    }
});

/**
 * 缓存常用的 DOM 节点对象至 dom 全局映射表中
 * 避免高频交互时反复查询 DOM 节点导致的性能损耗
 *
 * 节点覆盖区域分组：
 * - 语言弹窗: languageBtn, languageList, doneLanguageBtn, cancelLanguageBtn
 * - 时钟与搜索: clock, date, searchInput, searchClearBtn, randomBookmarkBtn, engineBtn, engineIcon, engineName, dropdownMenu, suggestionMenu
 * - 导航与侧边栏: bookmarks, sidebar, sidebarList, navCategories, navContent, navSection, navHint, startSection
 * - 书签编辑与挑选: editList, editBookmarksBtn, addBookmarkBtn, saveEditBtn, cancelEditBtn, resetEditBtn, togglePickerBtn, pickerContent, pickerCount, donePickerBtn, exportJsonBtn, importJsonInput, bookmarkCountBadge, jsonDropzone
 * - 外观与壁纸: uploadBgBtn, urlBgBtn, urlBgBtnGroup, urlBgInputRow, urlBgInput, urlBgConfirmBtn, urlBgCancelBtn, resetBgBtn, uploadBgInput, wallpaperStatus, wallpaperError, maskOpacityInput, maskOpacityVal, clearCacheBtn, bgLayer, bgLayerNext, bgOverlay, presetWallpaperGrid, settingsTransitionGrid
 * - 天气组件: weatherWidget, weatherBtn, weatherIcon, weatherTemp, weatherCity, weatherPopover
 * - 快捷键与致谢: shortcutModal, shortcutModalList, doneShortcutBtn, openShortcutFromSettingsBtn, openCreditsFromSettingsBtn, creditsModal, creditsList, doneCreditsBtn
 * - 确认框与更新提示: confirmModal, confirmTitle, confirmMsg, confirmCancelBtn, confirmOkBtn, updateNotice, updateNoticeText, updateReloadBtn
 * @returns {void}
 */
export function cacheDOM() {
    const ids = 'languageBtn languageList doneLanguageBtn cancelLanguageBtn clock date searchInput searchClearBtn randomBookmarkBtn engineBtn engineIcon engineName dropdownMenu suggestionMenu bookmarks sidebar sidebarList navCategories navContent editList editBookmarksBtn addBookmarkBtn saveEditBtn cancelEditBtn resetEditBtn togglePickerBtn pickerContent pickerCount donePickerBtn exportJsonBtn importJsonInput uploadBgBtn urlBgBtn urlBgBtnGroup urlBgInputRow urlBgInput urlBgConfirmBtn urlBgCancelBtn resetBgBtn uploadBgInput wallpaperStatus wallpaperError bookmarkCountBadge jsonDropzone maskOpacityInput maskOpacityVal clearCacheBtn bgLayer bgLayerNext bgOverlay startSection navSection navHint presetWallpaperGrid settingsTransitionGrid shortcutModal shortcutModalList doneShortcutBtn openShortcutFromSettingsBtn openCreditsFromSettingsBtn weatherWidget weatherBtn weatherIcon weatherTemp weatherCity weatherPopover creditsModal creditsList doneCreditsBtn confirmModal confirmTitle confirmMsg confirmCancelBtn confirmOkBtn updateNotice updateNoticeText updateReloadBtn'.split(' ');
    ids.forEach(id => dom[id] = $(id));
}

/**
 * 高频 DOM 节点缓存池与选择器
 */

/**
 * DOM 快速查找助手函数 (document.getElementById 封装)
 * @param {string} id - 目标 DOM 元素的 ID 字符串
 * @returns {HTMLElement|null} 返回匹配的 DOM 元素节点，未找到时返回 null
 */
export function $(id) {
    return document.getElementById(id);
}

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
 * @returns {void}
 */
export function cacheDOM() {
    const ids = 'languageSelect tab-btn-bookmarks tab-btn-appearance tab-btn-data tabBookmarks tabAppearance tabData clock date searchInput searchClearBtn randomBookmarkBtn engineBtn engineIcon engineName dropdownMenu suggestionMenu bookmarks sidebar sidebarList navCategories navContent editModal editList editBookmarksBtn addBookmarkBtn saveEditBtn cancelEditBtn resetEditBtn togglePickerBtn bookmarkPicker pickerContent pickerCount donePickerBtn exportJsonBtn importJsonInput uploadBgBtn urlBgBtn urlBgBtnGroup urlBgInputRow urlBgInput urlBgConfirmBtn urlBgCancelBtn resetBgBtn uploadBgInput wallpaperStatus bookmarkCountBadge jsonDropzone maskOpacityInput maskOpacityVal clearCacheBtn bgLayer bgLayerNext bgOverlay startSection navSection navHint navHeader presetWallpaperGrid settingsTransitionGrid shortcutModal shortcutModalList doneShortcutBtn openShortcutFromSettingsBtn openCreditsFromSettingsBtn scrollDownHint weatherWidget weatherBtn weatherIcon weatherTemp weatherCity weatherPopover creditsModal creditsList doneCreditsBtn confirmModal confirmTitle confirmMsg confirmCancelBtn confirmOkBtn updateNotice updateNoticeText updateReloadBtn'.split(' ');
    ids.forEach(id => dom[id] = $(id));
}

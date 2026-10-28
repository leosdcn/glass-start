/**
 * 全局内存状态与数据存储
 */
import { CONFIG, DEFAULT_BOOKMARKS, DEFAULT_CATEGORIES } from '../config/constants.js';
import { localizeCategories } from '../core/i18n.js';
import { DEFAULT_ENGINE } from '../config/engines.js';

// 运行时状态：由调用方显式更新并触发渲染
/** @type {import('../types').AppState} */
export const state = {
    engine: DEFAULT_ENGINE, // 当前激活的搜索引擎 key，对应 engines 对象的键名
    bg: 0,                   // 当前壁纸在 backgrounds 数组中的索引
    open: false,             // 搜索引擎下拉菜单是否展开
    editOpen: false,         // 编辑书签弹窗是否打开（用于屏蔽滚轮切屏与键盘快捷键）
    currentSection: 'start', // 当前可见屏：'start'（起始页）或 'nav'（导航页）
    customWallpaper: null    // 当前生效的自定义壁纸 Data URL 或图片 URL
};

/** @type {import('../types').ModalState} 设置弹窗草稿与快照备份 */
export const modalState = {
    initialWallpaper: null,
    initialMaskOpacity: CONFIG.APPEARANCE.DEFAULT_MASK_OPACITY,

    draftWallpaper: undefined,
    draftMaskOpacity: null,
    draftBookmarks: [],
    wallpaperSaveFailed: false,
    bookmarksChanged: false,
    draftLanguage: 'auto'
};

// 当前运行时的书签与分类数据集
/** @type {import('../types').PageData} */
export const pageData = {
    bookmarks: DEFAULT_BOOKMARKS.map(bm => ({ ...bm })),
    categories: localizeCategories(DEFAULT_CATEGORIES)
};

/**
 * ==============================================================================
 * Glass Start — 全局响应式状态与数据存储 (src/js/state/store.js)
 * ==============================================================================
 */
import { DEFAULT_BOOKMARKS, DEFAULT_CATEGORIES } from '../config/constants.js';

// 全局响应式运行时状态
export const state = {
    engine: 'bing',          // 当前激活的搜索引擎 key，对应 engines 对象的键名
    bg: 0,                   // 当前壁纸在 backgrounds 数组中的索引
    open: false,             // 搜索引擎下拉菜单是否展开
    editOpen: false,         // 编辑书签弹窗是否打开（用于屏蔽滚轮切屏与键盘快捷键）
    currentSection: 'start', // 当前可见屏：'start'（起始页）或 'nav'（导航页）
    customWallpaper: null    // 当前生效的自定义壁纸 DataURL
};

// 设置弹窗内部草稿状态机与快照备份
export const modalState = {
    initialWallpaper: null,
    initialMaskOpacity: 15,
    initialBgBlur: 0,

    draftWallpaper: undefined,
    draftMaskOpacity: null,
    draftBgBlur: null,
    draftBookmarks: [],
    wallpaperChanged: false,
    bookmarksChanged: false
};

// 当前运行时的书签与分类数据集
export const pageData = {
    bookmarks: DEFAULT_BOOKMARKS.map(bm => ({ ...bm })),
    categories: DEFAULT_CATEGORIES
};

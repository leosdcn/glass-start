/**
 * 全局内存状态与数据存储
 */
import { DEFAULT_ENGINE } from '../config/engines.js';

// 运行时状态：由调用方显式更新并触发渲染（按偏好、路由、UI 控制与壁纸分组）
/** @type {import('../types').AppState} */
export const state = {
    // 用户偏好
    engine: DEFAULT_ENGINE,  // 当前激活的搜索引擎 key，对应 engines 对象的键名
    // 路由与可见视图
    currentSection: 'start',  // 当前可见屏：'start'（起始页）或 'nav'（导航页）
    // UI 交互与弹窗
    editOpen: false,          // 编辑书签弹窗是否打开（用于屏蔽滚轮切屏与键盘快捷键）
    // 壁纸运行时
    bg: 0,                    // 当前壁纸在 backgrounds 数组中的索引
    customWallpaper: null     // 当前生效的自定义壁纸 Data URL 或图片 URL
};

/**
 * 设置弹窗草稿与快照备份状态
 * 采用内存草稿隔离模式：设置面板内的修改均在此操作，取消则丢弃草稿，保存时统一清洗并持久化。
 * @type {import('../types').ModalState}
 */
export const modalState = {
    // — 1. 快照备份（打开设置弹窗时快照记录，取消时原样回滚）—
    initialWallpaper: null,       // 打开弹窗前生效的壁纸路径或自定义图片字符串

    // — 2. 内存草稿值（面板内编辑中的暂存值，点击“完成”时按序提交至 LocalStorage / IndexedDB）—
    draftWallpaper: undefined,    // 草稿壁纸选择：预设路径或自定义图片字符串，null 恢复默认，undefined 未修改
    draftMaskOpacity: null,       // 背景遮罩暗度百分比草稿（0-80），null 表示未修改
    draftBookmarks: [],           // 书签编辑草稿列表（内存数组驱动，由 bookmark-draft 模块封装维护）
    draftLanguage: 'auto',        // 界面语言草稿（'auto' / 'zh-CN' / 'en'）
    draftTransitionMode: 'sheet', // 切屏模式草稿（'sheet' / 'classic'）

    // — 3. UI 交互与脏检查标记（仅在弹窗生命周期内有效，不持久化）—
    committing: false,            // 正在提交设置；由业务状态驱动取消与编辑限制
    wallpaperSaveFailed: false,   // 壁纸准备或保存失败标记（保存设置前需重新选择）
    bookmarksChanged: false       // 书签列表是否存在未保存的脏变更标记
};

// 当前运行时的书签与分类数据集，由 init() 初始化目录，loadBookmarks() 加载用户偏好
/** @type {import('../types').PageData} */
export const pageData = {
    bookmarks: [],
    categories: []
};

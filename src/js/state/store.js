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
    get editOpen() { return modalState.phase !== 'closed'; },
    // 壁纸运行时
    bg: 0,                    // 当前壁纸在 backgrounds 数组中的索引
    customWallpaper: null     // 当前生效的自定义壁纸 Data URL 或图片 URL
};

/**
 * 设置会话阶段与草稿
 * 采用内存草稿隔离模式：取消丢弃未提交草稿，保存按项清洗并持久化，已保存项目不回滚。
 * @type {import('../types').ModalState}
 */
export const modalState = {
    phase: 'closed',
    draftWallpaper: null,        // 成功准备的预设路径或自定义图片字符串
    draftMaskOpacity: null,       // 背景遮罩暗度百分比草稿（0-80），null 表示未修改
    draftBookmarks: [],           // 书签编辑草稿列表（内存数组驱动，由 bookmark-draft 模块封装维护）
    draftLanguage: 'auto',        // 界面语言草稿（'auto' / 'zh-CN' / 'en'）
    draftTransitionMode: 'sheet', // 切屏模式草稿（'sheet' / 'classic'）

    bookmarksChanged: false       // 书签列表是否存在未保存的脏变更标记
};

// 当前运行时的书签与分类数据集，由 init() 初始化目录，loadBookmarks() 加载用户偏好
/** @type {import('../types').PageData} */
export const pageData = {
    bookmarks: [],
    categories: []
};

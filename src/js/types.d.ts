/**
 * ==============================================================================
 * Glass Start — 全局 TypeScript 纯类型声明文件 (src/js/types.d.ts)
 * ==============================================================================
 * 仅用于编辑器与语言服务的类型提示，不引入运行时依赖。
 * 声明需通过 JSDoc 引用；此文件本身不提供全项目静态类型检查。
 */

/** 书签条目结构定义 */
export interface BookmarkItem {
    name: string;
    url: string;
    icon: string;
    desc?: string;
    /** Transient import marker; never written into bookmark backups. */
    customText?: boolean;
}

/** 设置弹窗中的书签草稿，包含排序标识与原始 URL */
export interface DraftBookmarkItem extends BookmarkItem {
    id: string;
    origUrl: string;
}

/** 分类目录结构定义 */
export interface BookmarkCategory {
    id?: string;
    name: string;
    icon: string;
    bookmarks: BookmarkItem[];
}

/** 目录共用索引条目 */
export interface CategoryCatalogEntry {
    bm: BookmarkItem;
    normUrl: string;
    defaultCat: string;
}

/** 附带排序书签列表的分类结构 */
export interface SortedBookmarkCategory extends BookmarkCategory {
    sortedBookmarks: BookmarkItem[];
}

/** 目录共用索引数据视图 */
export interface CategoryCatalog {
    byUrl: Map<string, BookmarkItem>;
    searchCategories: Map<string, string>;
    entries: CategoryCatalogEntry[];
    sorted: SortedBookmarkCategory[];
}

/** 用户自定义书签元数据结构 */
export interface CustomMetaItem {
    name?: string;
    desc?: string;
    icon?: string;
}

/** 运行时核心数据集 */
export interface PageData {
    bookmarks: BookmarkItem[];
    categories: BookmarkCategory[];
}

/** 运行时状态；由调用方显式更新并触发渲染。 */
export interface AppState {
    /** 当前激活的搜索引擎 key，对应 engines 对象的键名 */
    engine: string;
    /** 当前壁纸在 backgrounds 数组中的索引 */
    bg: number;
    /** 搜索引擎下拉菜单是否展开 */
    open: boolean;
    /** 编辑书签弹窗是否打开（用于屏蔽滚轮切屏与键盘快捷键） */
    editOpen: boolean;
    /** 当前可见屏：'start'（起始页）或 'nav'（导航页） */
    currentSection: 'start' | 'nav';
    /** 当前生效的自定义壁纸 DataURL 或 URL */
    customWallpaper: string | null;
}

/** 设置弹窗内部草稿状态机与快照备份 */
export interface ModalState {
    initialWallpaper: string | null;
    initialMaskOpacity: number;
    initialTransitionMode: string;

    draftWallpaper: string | null | undefined;
    draftMaskOpacity: number | null;
    draftBookmarks: DraftBookmarkItem[];
    wallpaperSaveFailed: boolean;
    bookmarksChanged: boolean;
    draftLanguage: string;
    draftTransitionMode: string;
}

/** 壁纸深浅主题契约 */
export interface WallpaperTheme {
    color: string;
    isLight: boolean;
    themeColor?: string;
}

/** OverlayStack 栈内单层元素 */
export interface OverlayItem {
    id: string;
    close: () => void;
    trigger?: Element | null;
}

/** 多层弹窗层叠栈管理器 */
export interface IOverlayStack {
    stack: OverlayItem[];
    push(id: string, closeFn: () => void, trigger?: Element | null): void;
    pop(id?: string): OverlayItem | null;
    topModal(): HTMLElement | null;
    focusTop(): void;
    restoreFocus(trigger?: Element | null): void;
    syncModalAccessibility(): void;
    setBaseInert(element: HTMLElement, value: boolean): void;
    top(): OverlayItem | null;
    isEmpty(): boolean;
}

/** 高频 DOM 节点缓存池映射 */
export interface DOMCache {
    clock: HTMLElement | null;
    date: HTMLElement | null;
    searchInput: HTMLInputElement | null;
    searchClearBtn: HTMLButtonElement | null;
    randomBookmarkBtn: HTMLButtonElement | null;
    engineBtn: HTMLButtonElement | null;
    engineIcon: HTMLElement | null;
    engineName: HTMLElement | null;
    dropdownMenu: HTMLElement | null;
    suggestionMenu: HTMLElement | null;
    bookmarks: HTMLElement | null;
    sidebar: HTMLElement | null;
    sidebarList: HTMLElement | null;
    navCategories: HTMLElement | null;
    navContent: HTMLElement | null;
    editModal: HTMLElement | null;
    tabAppearance: HTMLElement | null;
    editList: HTMLElement | null;
    editBookmarksBtn: HTMLButtonElement | null;
    addBookmarkBtn: HTMLButtonElement | null;
    saveEditBtn: HTMLButtonElement | null;
    languageBtn: HTMLButtonElement | null;
    languageModal: HTMLElement | null;
    languageList: HTMLElement | null;
    doneLanguageBtn: HTMLButtonElement | null;
    cancelLanguageBtn: HTMLButtonElement | null;
    languageSelect: HTMLSelectElement | null;
    cancelEditBtn: HTMLButtonElement | null;
    resetEditBtn: HTMLButtonElement | null;
    togglePickerBtn: HTMLButtonElement | null;
    bookmarkPicker: HTMLElement | null;
    pickerContent: HTMLElement | null;
    pickerCount: HTMLElement | null;
    donePickerBtn: HTMLButtonElement | null;
    exportJsonBtn: HTMLButtonElement | null;
    importJsonInput: HTMLInputElement | null;
    uploadBgBtn: HTMLButtonElement | null;
    urlBgBtn: HTMLButtonElement | null;
    urlBgBtnGroup: HTMLElement | null;
    urlBgInputRow: HTMLElement | null;
    urlBgInput: HTMLInputElement | null;
    urlBgConfirmBtn: HTMLButtonElement | null;
    urlBgCancelBtn: HTMLButtonElement | null;
    resetBgBtn: HTMLButtonElement | null;
    uploadBgInput: HTMLInputElement | null;
    wallpaperStatus: HTMLElement | null;
    bookmarkCountBadge: HTMLElement | null;
    jsonDropzone: HTMLElement | null;
    maskOpacityInput: HTMLInputElement | null;
    maskOpacityVal: HTMLElement | null;
    clearCacheBtn: HTMLButtonElement | null;
    bgLayer: HTMLElement | null;
    bgLayerNext: HTMLElement | null;
    bgOverlay: HTMLElement | null;
    startSection: HTMLElement | null;
    navSection: HTMLElement | null;
    navHint: HTMLElement | null;
    navHeader: HTMLElement | null;
    presetWallpaperGrid: HTMLElement | null;
    settingsTransitionGrid: HTMLElement | null;
    shortcutModal: HTMLElement | null;
    shortcutModalList: HTMLElement | null;
    doneShortcutBtn: HTMLButtonElement | null;
    openShortcutFromSettingsBtn: HTMLButtonElement | null;
    openCreditsFromSettingsBtn: HTMLButtonElement | null;
    scrollDownHint: HTMLElement | null;
    weatherWidget: HTMLElement | null;
    weatherBtn: HTMLButtonElement | null;
    weatherIcon: HTMLElement | null;
    weatherTemp: HTMLElement | null;
    weatherCity: HTMLElement | null;
    weatherPopover: HTMLElement | null;
    creditsModal: HTMLElement | null;
    creditsList: HTMLElement | null;
    doneCreditsBtn: HTMLButtonElement | null;
    confirmModal: HTMLElement | null;
    confirmTitle: HTMLElement | null;
    confirmMsg: HTMLElement | null;
    confirmCancelBtn: HTMLButtonElement | null;
    confirmOkBtn: HTMLButtonElement | null;
    updateNotice: HTMLElement | null;
    updateNoticeText: HTMLElement | null;
    updateReloadBtn: HTMLButtonElement | null;
    [key: string]: HTMLElement | null;
}

export type TranslationMessage = string | Record<string, string>;

declare global {
    interface Navigator {
        readonly userAgentData?: { readonly platform: string };
        readonly connection?: { readonly saveData?: boolean; readonly effectiveType?: string };
    }
    interface Window {
        __GLASS_I18N__?: {
            locale: string;
            messages: Record<string, Record<string, TranslationMessage>>;
            catalogs?: Record<string, { defaultBookmarks?: string[]; categories?: Record<string, string>; bookmarks: Record<string, {name?: string; desc?: string; url?: string; legacyUrl?: string}> }>;
            t: (key: string, params?: Record<string, string | number>) => string;
            applyTranslations: (root?: ParentNode) => void;
            formatDate: (date: Date, options?: Intl.DateTimeFormatOptions) => string;
            weatherDescription: (code: unknown) => string;
            pendingTimer?: ReturnType<typeof setTimeout>;
        };
        /** 仅测试适配层挂载，生产页面不提供。 */
        state?: AppState;
        __ENGINE_SVGS__?: Record<string, string>;
        __BACKGROUNDS__?: string[];
        __INITIAL_THEME__?: { color: string; isLight: boolean; themeColor?: string };
        __GLASS_BUILD_HTML__?: string;
        __GLASS_BUILD_APP__?: string;
        __GLASS_TEST__?: boolean;
        /** 构建时替换，扩展包不包含 JSONP 请求分支。 */
        __GLASS_EXTENSION__?: boolean;
        resetActiveTiltCard?: () => void;
    }
}

/** 搜索算法只接收候选模型和配置，不依赖页面状态。 */
export interface FuzzyOptions {
    MIN_QUERY_LEN: number;
    SHORT_QUERY_LEN: number;
    MAX_DIST_SHORT: number;
    MAX_DIST_LONG: number;
}
export interface SearchOptions {
    MAX_LOCAL_ITEMS: number;
    FUZZY: FuzzyOptions;
    TIERS: Record<string, number>;
}
export interface SearchCandidateItem {
    bm: BookmarkItem;
    normUrl: string;
    defaultCat: string;
    nameLower?: string;
    descLower?: string;
    urlLower?: string;
}
export interface SearchCandidateModel {
    candidates: SearchCandidateItem[];
    urlToCategoryMap: Map<string, string>;
}
export interface WeatherLocation {
    language?: string;
    lat: number;
    lon: number;
    name?: string;
    fullName?: string;
    isAuto?: boolean;
    isFallback?: boolean;
    timestamp?: number;
}
export interface WeatherCurrent {
    temp: number;
    apparent?: number;
    weatherCode?: number;
    weatherText?: string;
    icon?: string;
    isDay?: boolean;
    humidity?: number;
    windSpeed?: number;
    precipitation?: number;
    pop?: number;
    sunrise?: string;
    sunset?: string;
    sunriseToday?: string;
    sunsetToday?: string;
    sunriseTomorrow?: string;
    sunsetTomorrow?: string;
}
export interface WeatherDailyItem {
    weatherCode?: number;
    date?: string;
    label?: string;
    icon?: string;
    text?: string;
    tempMax?: number;
    tempMin?: number;
}
export interface WeatherData {
    current: WeatherCurrent;
    daily?: WeatherDailyItem[];
    location?: WeatherLocation;
    timestamp?: number;
}
export interface ForecastOptions {
    FORECAST_FETCH_DAYS: number;
    PRECIP_CODE_START: number;
    POP_CLEAR_CONFLICT_THRESHOLD: number;
    DEFAULT_TEMPERATURE: number;
    DEFAULT_HUMIDITY: number;
}

export interface SuggestionBookmarkItem {
    type: 'bookmark';
    text: string;
    url: string;
}
export interface SuggestionQueryItem {
    type: 'query';
    text: string;
}
export type SuggestionItem = SuggestionBookmarkItem | SuggestionQueryItem;

export interface BookmarkSuggestion {
    name: string;
    url: string;
    icon?: string;
    desc?: string;
    category?: string;
}

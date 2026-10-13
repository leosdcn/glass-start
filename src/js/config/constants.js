import bookmarksData from '../../../bookmarks.json';

// ==================== 默认书签（根目录 bookmarks.json 单一真理源）====================
export const DEFAULT_BOOKMARKS = bookmarksData.bookmarks || [];
export const DEFAULT_CATEGORIES = bookmarksData.categories || [];

// ==================== 配置与全局常量 ====================
export const CONFIG = Object.freeze({
            KEYS: Object.freeze({
                BOOKMARK_KEYS: 'userBookmarkKeys',
                LEGACY_BOOKMARKS: 'userBookmarks',
                CUSTOM_META: 'userCustomMeta',
                BG: 'bg',
                USER_WALLPAPER: 'userWallpaper',
                WALLPAPER_META: 'glass_wallpaper_meta',
                MASK_OPACITY: 'maskOpacity',
                BG_BLUR: 'bgBlur',
                PREFERRED_ENGINE: 'preferredEngine',
                NAV_DISCOVERED: 'hasDiscoveredNav',
                WEATHER_CACHE: 'glass_weather_cache',
                WEATHER_LOC: 'glass_weather_loc_cache',
                WEATHER_SETTINGS: 'glass_weather_settings'
            }),
            CACHE: Object.freeze({
                FAVICON: 'app-favicons-v1'
            }),
            IDB: Object.freeze({
                DB_NAME: 'GlassStartDB',
                VERSION: 1,
                STORES: Object.freeze({ WALLPAPERS: 'wallpapers' }),
                KEYS: Object.freeze({ CUSTOM_WALLPAPER: 'customWallpaper', SELECTION: 'wallpaperSelection' })
            }),
            GESTURE: Object.freeze({
                TRANSITION_MS: 580,          // 双屏推移过渡动画时长 (ms)
                TIMEOUT_BUFFER_MS: 150,      // 双屏推移超时保护冗余缓冲 (ms)
                SWIPE_THRESHOLD: 40,         // 触屏轻扫与滚轮触发切屏阈值 (px)
                FLICK_MIN_DISTANCE: 25,      // 快速轻扫最小触发位移 (px)
                FLICK_MIN_VELOCITY: 0.25     // 快速轻扫最小瞬时速度 (px/ms)
            }),
            PHYSICS: Object.freeze({
                TILT_MAX_ROTATION_DEG: 2.5,  // 3D 陀螺仪最大倾角 (deg)
                TILT_PERSPECTIVE_PX: 800,    // 3D 透视视距 (px)
                TILT_HOVER_SCALE: 1.025,     // 悬停缩放比
                TILT_PRESSED_SCALE: 0.975,   // 按压缩放比
                DRAG_HYSTERESIS_HIGH: 0.58,  // 拖拽排序迟滞阻尼上限 (50% + 8%)
                DRAG_HYSTERESIS_LOW: 0.42,   // 拖拽排序迟滞阻尼下限 (50% - 8%)
                DRAG_INDICATOR_OFFSET_TOP: -4.5, // 放置指示线上边界偏移 (px)
                DRAG_INDICATOR_OFFSET_BOTTOM: 1.5, // 放置指示线下边界偏移 (px)
                SORT_FALLBACK_INDEX: 9999,   // 拖拽排序未匹配到 DOM 时的极大回退序号
                DICE_ROTATION_STEP: 180,     // 随机书签按钮旋转角度步长 (deg)
                BOOKMARK_DELETE_SCALE: 0.92, // 书签删除动效缩放比
                BOOKMARK_DELETE_OFFSET_Y: -6 // 书签删除动效垂直位移 (px)
            }),
            WEATHER: Object.freeze({
                CACHE_TTL: 15 * 60 * 1000,    // 气象数据本地缓存有效期 (15分钟)
                LOC_TTL: 24 * 60 * 60 * 1000, // 地理定位本地缓存有效期 (24小时)
                TIMEOUT_IP: 3000,             // IP 定位接口超时限制 (ms)
                TIMEOUT_WEATHER: 6000,        // Open-Meteo 预报接口超时限制 (ms)
                POP_MID_THRESHOLD: 30,        // 降水概率备伞阈值 (30%)
                POP_HIGH_THRESHOLD: 70,       // 降水概率必带伞阈值 (70%)
                HUMIDITY_LOW_THRESHOLD: 35,   // 相对湿度干燥阈值 (35%)
                HUMIDITY_HIGH_THRESHOLD: 75,  // 相对湿度高湿阈值 (75%)
                WIND_MID_THRESHOLD: 15,       // 实时风速清风/疾风阈值 (15 km/h)
                WIND_HIGH_THRESHOLD: 35,      // 实时风速大风/龙卷阈值 (35 km/h)
                MIN_SPIN_DURATION: 200,       // 气象刷新防闪最小视觉动效门槛 (ms)
                PRECIP_CODE_START: 51,        // WMO 降水天气代码起点阈值
                POP_CLEAR_CONFLICT_THRESHOLD: 40, // 降水概率与晴天冲突纠偏阈值 (%)
                DEFAULT_TEMPERATURE: 25,      // 兜底室温 (°C)
                DEFAULT_HUMIDITY: 50,         // 兜底相对湿度 (%)
                LOCATION_DRIFT_THRESHOLD: 0.08, // 静默定位更新漂移容差 (经纬度度数, 约8.8km)
                FORECAST_FETCH_DAYS: 5,       // 气象接口拉取预报最大天数
                FORECAST_DISPLAY_DAYS: 4,     // 弹窗实际呈现预报天数
                FALLBACK_LOCATION: Object.freeze({
                    name: '上海',
                    fullName: '中国 · 上海市',
                    lat: 31.230,
                    lon: 121.473
                }),
                LABEL_MAX_CHARS: 12           // 预报日期标签截断字符上限
            }),
            SUGGEST: Object.freeze({
                DEBOUNCE_MS: 180,             // 搜索输入防抖延时 (ms)
                JSONP_TIMEOUT: 4000,          // 建议词 JSONP 请求熔断超时 (ms)
                MAX_LOCAL_ITEMS: 2,           // 混排时最多呈现的本地书签数
                MAX_TOTAL_ITEMS: 4,           // 下拉菜单最大呈现总行数
                TIERS: Object.freeze({
                    EXACT_NAME: 10,
                    PREFIX_NAME: 20,
                    SUBSTRING_NAME: 30,
                    URL_MATCH: 40,
                    DESC_MATCH: 50,
                    FUZZY_NAME_BASE: 60,
                    FUZZY_OTHER_BASE: 70
                }),
                FUZZY: Object.freeze({
                    MIN_QUERY_LEN: 3,
                    SHORT_QUERY_LEN: 5,
                    MAX_DIST_SHORT: 1,
                    MAX_DIST_LONG: 2
                })
            }),
            NAV: Object.freeze({
                TOP_THRESHOLD: 15,            // 顶部激活首项判定阈值 (px)
                HEADER_OFFSET: 100,           // 滚动监听分类标题吸顶判定线 (px)
                BOTTOM_TOLERANCE: 32,         // 触底判定容差 (px)
                BOTTOM_VISIBILITY_RATIO: 0.6, // 触底时末尾分类可见度占比判定线
                SCROLL_END_DEBOUNCE: 120,     // 滚动静止解锁防抖延时 (ms)
                MANUAL_LOCK_MAX_MS: 800,      // 点击跳转平滑滚动最大锁定硬上限 (ms)
                RESIZE_DEBOUNCE: 120,         // 视口尺寸变化防抖延时 (ms)
                MOBILE_BREAKPOINT: 640,       // 移动端/桌面端分界断点 (px)
                TABLET_BREAKPOINT: 768,       // 平板端分界断点 (px)
                TAB_SCROLL_MARGIN: 8          // 侧边栏横向/纵向对齐边界安全内距 (px)
            }),
            APPEARANCE: Object.freeze({
                DEFAULT_MASK_OPACITY: 20,     // 默认遮罩暗度百分比 (%)
                MIN_MASK_OPACITY: 5,          // 遮罩透明度最小百分比 (%)
                MAX_MASK_OPACITY: 80,         // 遮罩透明度最大百分比 (%)
                DEFAULT_BG_BLUR: 0,           // 默认背景高斯模糊 (px)
                MAX_BG_BLUR: 20,              // 背景高斯模糊最大像素值 (px)
                MAX_UPLOAD_WIDTH: 3840,       // 自定义壁纸最大宽度 (4K UHD)
                MAX_UPLOAD_HEIGHT: 2160,      // 自定义壁纸最大高度
                JPEG_QUALITY: 0.95,           // Canvas 壁纸压缩质量
                MAX_LS_WALLPAPER_BYTES: 2000000, // 自定义壁纸双写 localStorage 的体积上限（超出仅存 IndexedDB）
                THEME_SAMPLE_WIDTH: 16,       // 壁纸取色采样宽度 (px)
                THEME_SAMPLE_HEIGHT: 4,       // 壁纸取色采样高度 (px)
                THEME_SAMPLE_AREA_RATIO: 0.15, // 仅采样壁纸顶部高度比例 (15%)
                LUMINANCE_THRESHOLD: 128,     // 深浅主题亮度判别门限
                TINT_CLAMP: Object.freeze({   // 环境光折射动态区间与提亮保护
                    MIN: 60,
                    MAX: 245,
                    BOOST_THRESHOLD: 140
                })
            }),
            TIMERS: Object.freeze({
                STAGGER_OPEN: 260,            // 随机书签跳转延时 (ms) - 0.24s 灵动翻转 + 20ms 从容停靠
                SCROLL_RESET: 400,            // 滚轮累积阈值重置延时 (ms)
                MODAL_HIDE_DELAY: 220,        // 弹窗退出隐藏延迟 (ms)
                BG_CROSSFADE: 450,            // 壁纸跨图层淡入时长 (ms)
                HINT_FADE: 600,               // 下滑提示淡出延时 (ms)
                CLICK_FEEDBACK_CLEAR: 600,    // 触感反馈类清除延时 (ms)
                FADE_IN_UNLOAD: 800,          // 入场动画自动脱壳延时 (ms)
                OBJECT_REVOKE: 1000,          // 临时 Blob/URL 释放安全延时 (ms)
                PWA_SCHEDULE: 5000,           // 后台静默调度延时 (ms)
                FALLBACK_IDLE_DELAY: 1500,    // 空闲调度降级回退延时 (ms)
                IDLE_TIMEOUT: 3000,           // 空闲调度最大超时上限 (ms)
                COMPOSITION_END_RESET: 100,   // 输入法组合结束复位延迟 (ms)
                FLIP_DURATION_MS: 350,        // FLIP 物理吸附动效时长 (ms)
                BOOKMARK_DELETE_DURATION: 180, // 书签删除动效时长 (ms)
                BG_OVERLAY_TRANSITION: 200,   // 遮罩滑块平滑过渡时长 (ms)
                PRESET_CARD_STAGGER: 20,      // 壁纸缩略图交错渐入步长延时 (ms)
                NR_PREHYDRATION_TIMEOUT: 1500, // HEAD 预水合防闪类安全卸载延时 (ms)
                TILT_TRANSITION_MS: 80,       // 3D 悬停倾斜过渡时长 (ms)
                TILT_BG_TRANSITION_MS: 320    // 3D 悬停背景过渡时长 (ms)
            }),
            UI: Object.freeze({
                ICON_SIZE_SM: 24,             // 导航卡片小图标渲染基准尺寸 (px)
                ICON_SIZE_MD: 32,             // 首屏快捷书签图标渲染基准尺寸 (px)
                FAVICON_FALLBACK_SIZE: 128,   // Google S2 备用图标切片分辨率 (px)
                WALLPAPER_CARD_WIDTH: 160,    // 壁纸网格卡片基准宽度 (px)
                WALLPAPER_CARD_HEIGHT: 100    // 壁纸网格卡片基准高度 (px)
            }),
            SECURITY: Object.freeze({
                MAX_NAME_CHARS: 60,           // 导入书签名称截断字符上限
                MAX_DESC_CHARS: 40,           // 导入书签描述截断字符上限
                LOG_MSG_MAX_CHARS: 120,       // 黑匣子日志单条错误信息截断上限
                IME_COMPOSITION_KEY_CODE: 229 // Android Chrome 虚拟键盘 IME 组合态 keyCode 兼容防护
            }),
            SHORTCUTS: Object.freeze([
                {
                    group: '导航与控制',
                    items: [
                        { desc: '唤起 / 关闭快捷键速查', kbdId: 'kbd-slash', fallback: '⌘ /' },
                        { desc: '轮播内置高清壁纸', kbdId: 'kbd-bg', fallback: '⌘ B' },
                        { desc: '滚动至书签导航页', rawHtml: '<kbd>↓</kbd> / <kbd>PageDown</kbd>' },
                        { desc: '返回顶部起始页', rawHtml: '<kbd>↑</kbd> / <kbd>PageUp</kbd> / <kbd>Home</kbd>' },
                        { desc: '关闭弹窗 / 取消聚焦', rawHtml: '<kbd>Esc</kbd>' }
                    ]
                },
                {
                    group: '搜索与操作',
                    items: [
                        { desc: '首屏盲打自动聚焦', rawHtml: '<kbd>任意字符键</kbd>' },
                        { desc: '选择搜索建议 / 书签', rawHtml: '<kbd>↑</kbd> <kbd>↓</kbd>' },
                        { desc: '执行搜索 / 打开选中书签', rawHtml: '<kbd>Enter</kbd>' },
                        { desc: '在新标签页中打开搜索', kbdId: 'kbd-newtab', fallback: '⌘ ↵' },
                        { desc: '弹窗内焦点循环', kbdId: 'kbd-tab', fallback: 'Tab / ⇧ Tab' }
                    ]
                }
            ]),
            CREDITS: Object.freeze([
                { icon: '🌤️', name: '气象数据底座', desc: 'Open-Meteo 全球气象与逆地理编码', url: 'https://open-meteo.com', license: 'CC-BY 4.0' },
                { icon: '🖼️', name: '预设高清壁纸', desc: 'Unsplash 精选 2.5K 摄影作品', url: 'https://unsplash.com', license: '免版税授权' },
                { icon: '🎨', name: '样式与设计系统', desc: 'Tailwind CSS 现代化原子工具集', url: 'https://tailwindcss.com', license: 'MIT 协议' },
                { icon: '⚡', name: '极速构建内核', desc: 'esbuild AST 高效压缩与编译器', url: 'https://esbuild.github.io', license: 'MIT 协议' }
            ])
        });

export const engines = {
    bing: { name: 'Bing', isSvg: true, svg: (typeof window !== 'undefined' && window.__ENGINE_SVGS__?.bing) || '', url: 'https://www.bing.com/search?q=' },
    google: { name: 'Google', isSvg: true, svg: (typeof window !== 'undefined' && window.__ENGINE_SVGS__?.google) || '', url: 'https://www.google.com/search?q=' },
    wikipedia: { name: 'Wikipedia', isSvg: true, svg: (typeof window !== 'undefined' && window.__ENGINE_SVGS__?.wikipedia) || '', url: 'https://zh.wikipedia.org/w/index.php?search=' }
};

export const backgrounds = (typeof window !== 'undefined' && Array.isArray(window.__BACKGROUNDS__) && window.__BACKGROUNDS__.length)
    ? window.__BACKGROUNDS__
    : ['./wallpapers/bg1.avif'];

// ==================== 平台按键与快捷键适配 ====================
export const IS_MAC = (() => {
            if (typeof navigator === 'undefined') return true;
            if (navigator.userAgentData?.platform) {
                return /mac|ios|iphone|ipad|ipod/i.test(navigator.userAgentData.platform);
            }
            const p = (navigator.platform || navigator.userAgent || '').toLowerCase();
            return /mac|iphone|ipad|ipod/.test(p);
        })();

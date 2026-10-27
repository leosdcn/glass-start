// 首屏构建注入与运行时共用的预设主题及色调配置
export const APP_THEME_DARK = Object.freeze({ color: '#0b0f19', isLight: false });
export const APP_THEME_LIGHT = Object.freeze({ color: '#ffffff', isLight: true });

export const PRESET_WALLPAPER_THEMES = Object.freeze([
    APP_THEME_DARK,  // bg1: 暮色山峦 (自然深 · 默认深色)
    APP_THEME_LIGHT, // bg2: 溪谷晨曦 (自然浅 · 浅色)
    APP_THEME_DARK,  // bg3: 星空雪山 (自然深 · 深色)
    APP_THEME_LIGHT, // bg4: 峰峦破晓 (自然浅 · 浅色)
    APP_THEME_DARK,  // bg5: 天际立面 (建筑深 · 深色)
    APP_THEME_LIGHT, // bg6: 极简回廊 (建筑浅 · 浅色)
    APP_THEME_DARK,  // bg7: 紫韵流光 (艺术深 · 深色)
    APP_THEME_LIGHT  // bg8: 梦幻流彩 (艺术浅 · 浅色)
]);

// 8 张预设壁纸原图顶部 15% 采样之专属外壳氛围色 (按 20% 暗度遮罩采样，作为固定预设色)
export const PRESET_WALLPAPER_THEME_COLORS = Object.freeze([
    '#546272', // bg1: 暮色山峦 (原图顶部吸色 · 冷钢青灰)
    '#d7e0e2', // bg2: 溪谷晨曦 (原图顶部吸色 · 晨光天青)
    '#0a1e3a', // bg3: 星空雪山 (原图顶部吸色 · 冰夜深蓝)
    '#89856a', // bg4: 峰峦破晓 (原图顶部吸色 · 晨雾金褐)
    '#869aa8', // bg5: 天际立面 (原图顶部吸色 · 建筑冷青)
    '#d8d8da', // bg6: 极简回廊 (原图顶部吸色 · 极简灰白)
    '#603a96', // bg7: 紫韵流光 (原图顶部吸色 · 优雅暗紫)
    '#c58fba'  // bg8: 梦幻流彩 (原图顶部吸色 · 柔光粉紫)
]);

export const PRESET_WALLPAPER_TINTS = Object.freeze([
    '125, 140, 165', // bg1: 暮色山峦 (深邃冷蓝灰)
    '230, 215, 185', // bg2: 溪谷晨曦 (晨光暖米金)
    '95, 120, 155',  // bg3: 星空雪山 (静谧冰晶蓝)
    '225, 195, 165', // bg4: 峰峦破晓 (破晓金橙霞)
    '130, 145, 160', // bg5: 天际立面 (建筑冷钢青)
    '215, 218, 222', // bg6: 极简回廊 (极简柔白灰)
    '150, 115, 175', // bg7: 紫韵流光 (微醺幻夜紫)
    '205, 160, 195'  // bg8: 梦幻流彩 (柔光暖粉紫)
]);

export const PRESET_THEMES = PRESET_WALLPAPER_THEMES;
export const PRESET_TINTS = PRESET_WALLPAPER_TINTS;
export const PRESET_THEME_COLORS = PRESET_WALLPAPER_THEME_COLORS;

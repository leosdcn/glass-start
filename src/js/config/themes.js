// @region [HEAD_THEME_HYDRATION] 预设壁纸与自适应主题色 0ms 闪电对齐：纯净黑白二元流
export const APP_THEME_DARK = Object.freeze({ color: '#0b0f19', isLight: false });
export const APP_THEME_LIGHT = Object.freeze({ color: '#ffffff', isLight: true });

export const PRESET_WALLPAPER_THEMES = Object.freeze([
    APP_THEME_DARK,  // bg1: 山峦夜空 (自然深 · 默认深色)
    APP_THEME_LIGHT, // bg2: 湖光山色 (自然浅 · 浅色)
    APP_THEME_DARK,  // bg3: 星空雪山 (自然深 · 深色)
    APP_THEME_LIGHT, // bg4: 壮丽旷野 (自然浅 · 浅色)
    APP_THEME_DARK,  // bg5: 天际立面 (建筑深 · 深色)
    APP_THEME_LIGHT, // bg6: 极简回廊 (建筑浅 · 浅色)
    APP_THEME_DARK,  // bg7: 暗夜流体 (艺术深 · 深色)
    APP_THEME_LIGHT  // bg8: 梦幻流彩 (艺术浅 · 浅色)
]);

export const PRESET_THEMES = PRESET_WALLPAPER_THEMES;

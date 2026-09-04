// @region [HEAD_THEME_HYDRATION] 预设壁纸与自适应主题色 0ms 闪电对齐：纯净黑白二元流
export const APP_THEME_DARK = Object.freeze({ color: '#0b0f19', isLight: false });
export const APP_THEME_LIGHT = Object.freeze({ color: '#ffffff', isLight: true });

export const PRESET_WALLPAPER_THEMES = Object.freeze([
    APP_THEME_DARK,  // bg1: 山峦夜空 (默认深色)
    APP_THEME_LIGHT, // bg2: 湖光山色 (浅色)
    APP_THEME_DARK,  // bg3: 森林瀑布 (深色)
    APP_THEME_DARK,  // bg4: 星空雪山 (深色)
    APP_THEME_DARK,  // bg5: 壮丽旷野 (深色)
    APP_THEME_LIGHT, // bg6: 静谧海岸 (浅色)
    APP_THEME_LIGHT, // bg7: 迷雾古堡 (浅色)
    APP_THEME_LIGHT  // bg8: 梦幻流彩 (浅色)
]);

export const PRESET_THEMES = PRESET_WALLPAPER_THEMES;

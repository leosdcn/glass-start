/**
 * ==============================================================================
 * Glass Start — 浏览器外壳主题管理引擎 (src/js/core/theme-engine.js)
 * ==============================================================================
 * 遵循黑白二元流、Safari 顶栏自适应与 --bg-base 底色动态同步规范。
 */
import { CONFIG, backgrounds } from '../config/constants.js';
import {
    APP_THEME_DARK,
    APP_THEME_LIGHT,
    PRESET_WALLPAPER_THEMES,
    PRESET_WALLPAPER_TINTS
} from '../config/themes.js';
import { storageGet, storageSet, storageRemove } from '../utils/helpers.js';
import { state } from '../state/store.js';
import { dom, $ } from '../state/dom.js';
import {
    getEffectiveCustomWallpaper,
    findPresetBgIndex,
    clearCustomWallpaper,
    updateWallpaperStatusUI
} from '../modules/wallpaper.js';

let currentWallpaperTheme = (typeof window !== 'undefined' && window.__INITIAL_THEME__) || APP_THEME_DARK;
let cachedThemeColorMeta = null;
let activeWallpaperReqId = 0;
let bgSwitchTimer = null;

export function updateThemeColor(color, isLight) {
    if (!color || typeof document === 'undefined') return;
    if (!cachedThemeColorMeta || !cachedThemeColorMeta.parentNode) {
        cachedThemeColorMeta = document.querySelector('meta[name="theme-color"]');
        if (!cachedThemeColorMeta) {
            cachedThemeColorMeta = document.createElement('meta');
            cachedThemeColorMeta.name = 'theme-color';
            document.head.appendChild(cachedThemeColorMeta);
        }
    }
    if (cachedThemeColorMeta.content !== color) {
        cachedThemeColorMeta.content = color;
    }
    if (typeof isLight === 'boolean') {
        const scheme = isLight ? 'light' : 'dark';
        if (document.documentElement.style.colorScheme !== scheme) {
            document.documentElement.style.colorScheme = scheme;
        }
    }
    if (document.documentElement) {
        document.documentElement.style.backgroundColor = color;
        document.documentElement.style.setProperty('--bg-base', color);
        document.documentElement.style.setProperty('--bg-start', color);
    }
    if (document.body) {
        document.body.style.backgroundColor = color;
    }
    const bgBase = dom.bgLayer || $('bgLayer');
    const bgNext = dom.bgLayerNext || $('bgLayerNext');
    if (bgBase) bgBase.style.backgroundColor = color;
    if (bgNext) bgNext.style.backgroundColor = color;
}

export function updateGlassTint(tintRgbStr) {
    if (!tintRgbStr || typeof document === 'undefined' || !document.documentElement) return;
    document.documentElement.style.setProperty('--glass-tint', tintRgbStr);
}

export function syncThemeForSection() {
    if (currentWallpaperTheme && currentWallpaperTheme.color) {
        updateThemeColor(currentWallpaperTheme.color, currentWallpaperTheme.isLight);
    } else {
        updateThemeColor(APP_THEME_DARK.color, false);
    }
}

export function setWallpaperTheme(theme) {
    if (!theme || !theme.color) return;
    currentWallpaperTheme = theme;
    syncThemeForSection();
}

export function sampleCustomWallpaperTheme(img) {
    if (typeof document === 'undefined') return;
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 4;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        const srcH = Math.max(1, Math.floor(img.naturalHeight * 0.15));
        ctx.drawImage(img, 0, 0, img.naturalWidth, srcH, 0, 0, 16, 4);
        const data = ctx.getImageData(0, 0, 16, 4).data;
        let rTotal = 0, gTotal = 0, bTotal = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
            rTotal += data[i];
            gTotal += data[i + 1];
            bTotal += data[i + 2];
            count++;
        }
        if (count === 0) return;
        const maskOp = (storageGet(CONFIG.KEYS.MASK_OPACITY, 15) || 15) / 100;
        const r = Math.round((rTotal / count) * (1 - maskOp));
        const g = Math.round((gTotal / count) * (1 - maskOp));
        const b = Math.round((bTotal / count) * (1 - maskOp));
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const isLight = lum > 128;
        const theme = isLight ? APP_THEME_LIGHT : APP_THEME_DARK;
        storageSet('glass_theme_cache', theme);
        setWallpaperTheme(theme);

        // 动态环境光 Specular Tint：对采样色彩进行适度提亮与区间保护，避免暗色壁纸造成暗沉
        const maxVal = Math.max(r, g, b);
        const boost = maxVal > 0 && maxVal < 140 ? 140 / maxVal : 1;
        const tintR = Math.min(245, Math.round(Math.max(60, r * boost)));
        const tintG = Math.min(245, Math.round(Math.max(60, g * boost)));
        const tintB = Math.min(245, Math.round(Math.max(60, b * boost)));
        const tintStr = `${tintR}, ${tintG}, ${tintB}`;
        storageSet('glass_tint_cache', tintStr);
        updateGlassTint(tintStr);
    } catch {
        setWallpaperTheme(APP_THEME_DARK);
    }
}

export function applyWallpaper(urlStr, animate = true) {
    const bgBase = dom.bgLayer || $('bgLayer');
    const bgNext = dom.bgLayerNext || $('bgLayerNext');
    if (!bgBase || !bgNext || !urlStr || typeof urlStr !== 'string') return;

    activeWallpaperReqId++;
    const reqId = activeWallpaperReqId;

    // 匹配预设或离线采样壁纸主题色，动态自适应 Safari 顶栏外观与环境光折射
    const presetIdx = backgrounds.indexOf(urlStr);
    if (presetIdx >= 0 && PRESET_WALLPAPER_THEMES[presetIdx]) {
        setWallpaperTheme(PRESET_WALLPAPER_THEMES[presetIdx]);
        if (PRESET_WALLPAPER_TINTS && PRESET_WALLPAPER_TINTS[presetIdx]) {
            updateGlassTint(PRESET_WALLPAPER_TINTS[presetIdx]);
        }
    }

    // 过滤 URL 中可能破坏 CSS url() 语法的引号、反斜杠、右括号与换行符
    const safeCssUrl = urlStr.replace(/["'\\\r\n)]/g, '\\$&');
    const newStyleUrl = `url("${safeCssUrl}")`;

    const img = new Image();

    const executeTransition = () => {
        img.onload = null;
        img.onerror = null;
        if (reqId !== activeWallpaperReqId) return;
        if (bgSwitchTimer) {
            clearTimeout(bgSwitchTimer);
            bgSwitchTimer = null;
        }

        if (presetIdx < 0 && img.naturalWidth > 0) {
            sampleCustomWallpaperTheme(img);
        }

        if (animate) {
            if (bgNext.style.backgroundImage) {
                bgBase.style.backgroundImage = bgNext.style.backgroundImage;
                bgBase.style.opacity = '1';
            }
            bgNext.style.transition = 'none';
            bgNext.style.opacity = '0';
            bgNext.style.backgroundImage = newStyleUrl;

            void bgNext.offsetHeight;

            requestAnimationFrame(() => {
                bgNext.style.transition = 'opacity 0.45s var(--ease-exit)';
                bgNext.style.opacity = '1';
                bgSwitchTimer = setTimeout(() => {
                    bgBase.style.backgroundImage = newStyleUrl;
                    bgBase.style.opacity = '1';
                    bgNext.style.transition = 'none';
                    bgNext.style.opacity = '0';
                    bgSwitchTimer = null;
                }, CONFIG.TIMERS.BG_CROSSFADE);
            });
        } else {
            bgNext.style.transition = 'none';
            bgNext.style.opacity = '0';
            bgBase.style.backgroundImage = newStyleUrl;
            bgBase.style.opacity = '1';
        }
    };

    img.src = urlStr;
    if (img.complete && img.naturalWidth > 0) {
        executeTransition();
    } else {
        img.onload = executeTransition;
        img.onerror = () => { img.onload = img.onerror = null; };
    }
    if (typeof updateWallpaperStatusUI === 'function') {
        updateWallpaperStatusUI().catch(() => {});
    }
}

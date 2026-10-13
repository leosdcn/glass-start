/**
 * ==============================================================================
 * Glass Start — 浏览器外壳主题管理引擎 (src/js/core/theme-engine.js)
 * ==============================================================================
 * 遵循黑白二元流、Safari 顶栏自适应与 --bg-base 底色动态同步规范。
 */
import { CONFIG } from '../config/constants.js';
import { APP_THEME_DARK, APP_THEME_LIGHT } from '../config/themes.js';
import { storageGet, storageSet } from '../utils/helpers.js';

import { dom, $ } from '../state/dom.js';

let currentWallpaperTheme = (typeof window !== 'undefined' && window.__INITIAL_THEME__) || APP_THEME_DARK;

export function updateThemeColor(color, isLight) {
    if (!color || typeof document === 'undefined') return;
    const themeMetas = document.querySelectorAll('meta[name="theme-color"]');
    if (themeMetas.length > 0) {
        themeMetas.forEach(meta => {
            if (meta.content !== color) meta.content = color;
        });
    } else {
        const meta = document.createElement('meta');
        meta.name = 'theme-color';
        meta.content = color;
        document.head.appendChild(meta);
    }
    if (typeof isLight === 'boolean') {
        const scheme = isLight ? 'light' : 'dark';
        if (document.documentElement.style.colorScheme !== scheme) {
            document.documentElement.style.colorScheme = scheme;
        }
        if (isLight) {
            document.documentElement.classList.add('wallpaper-bright');
        } else {
            document.documentElement.classList.remove('wallpaper-bright');
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
        canvas.width = CONFIG.APPEARANCE.THEME_SAMPLE_WIDTH;
        canvas.height = CONFIG.APPEARANCE.THEME_SAMPLE_HEIGHT;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        const srcH = Math.max(1, Math.floor(img.naturalHeight * CONFIG.APPEARANCE.THEME_SAMPLE_AREA_RATIO));
        ctx.drawImage(img, 0, 0, img.naturalWidth, srcH, 0, 0, CONFIG.APPEARANCE.THEME_SAMPLE_WIDTH, CONFIG.APPEARANCE.THEME_SAMPLE_HEIGHT);
        const data = ctx.getImageData(0, 0, CONFIG.APPEARANCE.THEME_SAMPLE_WIDTH, CONFIG.APPEARANCE.THEME_SAMPLE_HEIGHT).data;
        let rTotal = 0, gTotal = 0, bTotal = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
            rTotal += data[i];
            gTotal += data[i + 1];
            bTotal += data[i + 2];
            count++;
        }
        if (count === 0) return;
        const maskOp = (storageGet(CONFIG.KEYS.MASK_OPACITY, CONFIG.APPEARANCE.DEFAULT_MASK_OPACITY) || CONFIG.APPEARANCE.DEFAULT_MASK_OPACITY) / 100;
        const r = Math.round((rTotal / count) * (1 - maskOp));
        const g = Math.round((gTotal / count) * (1 - maskOp));
        const b = Math.round((bTotal / count) * (1 - maskOp));
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const isLight = lum > CONFIG.APPEARANCE.LUMINANCE_THRESHOLD;
        const theme = isLight ? APP_THEME_LIGHT : APP_THEME_DARK;
        storageSet('glass_theme_cache', theme);
        setWallpaperTheme(theme);

        // 动态环境光 Specular Tint：对采样色彩进行适度提亮与区间保护，避免暗色壁纸造成暗沉
        const clamp = CONFIG.APPEARANCE.TINT_CLAMP;
        const maxVal = Math.max(r, g, b);
        const boost = maxVal > 0 && maxVal < clamp.BOOST_THRESHOLD ? clamp.BOOST_THRESHOLD / maxVal : 1;
        const tintR = Math.min(clamp.MAX, Math.round(Math.max(clamp.MIN, r * boost)));
        const tintG = Math.min(clamp.MAX, Math.round(Math.max(clamp.MIN, g * boost)));
        const tintB = Math.min(clamp.MAX, Math.round(Math.max(clamp.MIN, b * boost)));
        const tintStr = `${tintR}, ${tintG}, ${tintB}`;
        storageSet('glass_tint_cache', tintStr);
        updateGlassTint(tintStr);
    } catch {
        setWallpaperTheme(APP_THEME_DARK);
    }
}

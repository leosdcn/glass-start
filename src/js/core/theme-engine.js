/**
 * 浏览器外壳主题管理引擎
 * 同步深浅主题、浏览器顶栏与 --bg-base 底色。
 */
import { CONFIG } from '../config/constants.js';
import { APP_THEME_DARK, APP_THEME_LIGHT } from '../config/themes.js';

import { dom } from '../state/dom.js';

/** @type {import('../types.js').WallpaperTheme} */
let currentWallpaperTheme = (typeof window !== 'undefined' && window.__INITIAL_THEME__) || APP_THEME_DARK;

export function getWallpaperTheme() {
    return currentWallpaperTheme;
}

let currentCommittedColor = '';
let currentCommittedIsLight = /** @type {boolean | null} */ (null);
let currentCommittedThemeColor = '';

/**
 * @param {string} color
 * @param {boolean} [isLight]
 * @param {string} [themeColor]
 */
function updateThemeColor(color, isLight, themeColor) {
    if (!color || typeof document === 'undefined') return;
    const isLightBool = typeof isLight === 'boolean' ? isLight : null;
    const effectiveThemeColor = themeColor || color;
    if (color === currentCommittedColor && (isLightBool === null || isLightBool === currentCommittedIsLight) && effectiveThemeColor === currentCommittedThemeColor) {
        return;
    }
    currentCommittedColor = color;
    currentCommittedThemeColor = effectiveThemeColor;
    /** @type {NodeListOf<HTMLMetaElement>} */
    const themeMetas = document.querySelectorAll('meta[name="theme-color"]');
    if (themeMetas.length > 0) {
        themeMetas.forEach(meta => {
            if (meta.content !== effectiveThemeColor) meta.content = effectiveThemeColor;
            if (meta.hasAttribute('media')) meta.removeAttribute('media');
        });
    } else {
        const meta = document.createElement('meta');
        meta.name = 'theme-color';
        meta.content = effectiveThemeColor;
        document.head.appendChild(meta);
    }
    if (isLightBool !== null) {
        currentCommittedIsLight = isLightBool;
        const scheme = isLightBool ? 'light' : 'dark';
        if (document.documentElement.style.colorScheme !== scheme) {
            document.documentElement.style.colorScheme = scheme;
        }
        if (isLightBool) {
            document.documentElement.classList.add('wallpaper-bright');
        } else {
            document.documentElement.classList.remove('wallpaper-bright');
        }
    }
    if (document.documentElement) {
        document.documentElement.style.backgroundColor = color;
        document.documentElement.style.setProperty('--bg-base', color);
        document.documentElement.style.setProperty('--bg-start', effectiveThemeColor);
    }
    if (document.body) {
        document.body.style.backgroundColor = effectiveThemeColor;
    }
    const bgBase = dom.bgLayer;
    const bgNext = dom.bgLayerNext;
    if (bgBase) bgBase.style.backgroundColor = effectiveThemeColor;
    if (bgNext) bgNext.style.backgroundColor = effectiveThemeColor;
}

let currentGlassTint = '';

/**
 * @param {string} tintRgbStr
 */
export function updateGlassTint(tintRgbStr) {
    if (!tintRgbStr || typeof document === 'undefined' || !document.documentElement) return;
    if (tintRgbStr === currentGlassTint) return;
    currentGlassTint = tintRgbStr;
    document.documentElement.style.setProperty('--glass-tint', tintRgbStr);
}

export function syncWallpaperTheme() {
    if (currentWallpaperTheme && currentWallpaperTheme.color) {
        updateThemeColor(currentWallpaperTheme.color, currentWallpaperTheme.isLight, currentWallpaperTheme.themeColor);
    } else {
        updateThemeColor(APP_THEME_DARK.color, false, '#546272');
    }
}

/**
 * @param {import('../types.js').WallpaperTheme} theme
 * @param {string} [themeColor]
 */
export function setWallpaperTheme(theme, themeColor) {
    if (!theme || !theme.color) return;
    currentWallpaperTheme = { ...theme, themeColor: themeColor ?? theme.themeColor };
    syncWallpaperTheme();
}

/** @type {WeakMap<HTMLImageElement, { key: string, topRaw: number[], fullRaw: number[] }>} */
const rawSamples = new WeakMap();

/**
 * @param {HTMLImageElement} img
 * @param {number} opacity
 */
export function sampleCustomWallpaperTheme(img, opacity) {
    if (typeof document === 'undefined') return;
    try {
        if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) return;
        // 对齐壁纸的 background-size: cover / background-position: center，仅在加载时采样。
        const bgLayer = dom.bgLayer;
        const width = bgLayer?.clientWidth || window.innerWidth || img.naturalWidth;
        const height = bgLayer?.clientHeight || window.innerHeight || img.naturalHeight;
        const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
        const srcW = width / scale, srcH = height / scale;
        const srcX = (img.naturalWidth - srcW) / 2, srcY = (img.naturalHeight - srcH) / 2;

        const sampleKey = `${Math.round(srcX)}_${Math.round(srcY)}_${Math.round(srcW)}_${Math.round(srcH)}`;
        const cachedRawSample = rawSamples.get(img);
        let topRaw, fullRaw;

        if (cachedRawSample && cachedRawSample.key === sampleKey) {
            topRaw = cachedRawSample.topRaw;
            fullRaw = cachedRawSample.fullRaw;
        } else {
            const canvas = document.createElement('canvas');
            canvas.width = CONFIG.APPEARANCE.THEME_SAMPLE_WIDTH;
            canvas.height = CONFIG.APPEARANCE.THEME_SAMPLE_HEIGHT;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return;

            /** @param {number} areaHeight */
            const sampleRaw = areaHeight => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, srcX, srcY, srcW, areaHeight, 0, 0, canvas.width, canvas.height);
                const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                const totals = [0, 0, 0];
                for (let i = 0; i < data.length; i += 4) {
                    for (let c = 0; c < 3; c++) totals[c] += data[i + c];
                }
                const count = data.length / 4;
                return totals.map(total => total / count);
            };

            topRaw = sampleRaw(srcH * CONFIG.APPEARANCE.THEME_SAMPLE_AREA_RATIO);
            fullRaw = sampleRaw(srcH);
            rawSamples.set(img, { key: sampleKey, topRaw, fullRaw });
        }

        const maskOp = opacity / 100;
        const [topR, topG, topB] = topRaw.map(v => Math.round(v * (1 - maskOp)));
        const lum = 0.2126 * topR + 0.7152 * topG + 0.0722 * topB;
        const isLight = lum > CONFIG.APPEARANCE.LUMINANCE_THRESHOLD;
        const topHex = '#' + [topR, topG, topB].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
        const baseTheme = isLight ? APP_THEME_LIGHT : APP_THEME_DARK;
        const theme = { color: baseTheme.color, isLight: baseTheme.isLight, themeColor: topHex };
        // 动态环境光 Specular Tint：对采样色彩进行适度提亮与区间保护，避免暗色壁纸造成暗沉
        const [r, g, b] = fullRaw.map(v => Math.round(v * (1 - maskOp)));
        const clamp = CONFIG.APPEARANCE.TINT_CLAMP;
        const maxVal = Math.max(r, g, b);
        const boost = maxVal > 0 && maxVal < clamp.BOOST_THRESHOLD ? clamp.BOOST_THRESHOLD / maxVal : 1;
        const tintR = Math.min(clamp.MAX, Math.round(Math.max(clamp.MIN, r * boost)));
        const tintG = Math.min(clamp.MAX, Math.round(Math.max(clamp.MIN, g * boost)));
        const tintB = Math.min(clamp.MAX, Math.round(Math.max(clamp.MIN, b * boost)));
        return { theme, tint: `${tintR}, ${tintG}, ${tintB}` };
    } catch {
        return { theme: APP_THEME_DARK, tint: '255, 255, 255' };
    }
}

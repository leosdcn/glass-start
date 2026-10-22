/**
 * 浏览器外壳主题管理引擎
 * 同步深浅主题、浏览器顶栏与 --bg-base 底色。
 */
import { CONFIG } from '../config/constants.js';
import { APP_THEME_DARK, APP_THEME_LIGHT } from '../config/themes.js';
import { storageGet, storageSet } from '../utils/helpers.js';

import { dom } from '../state/dom.js';

let currentWallpaperTheme = (typeof window !== 'undefined' && window.__INITIAL_THEME__) || APP_THEME_DARK;

let currentCommittedColor = '';
let currentCommittedIsLight = /** @type {boolean | null} */ (null);

/**
 * @param {string} color
 * @param {boolean} [isLight]
 */
function updateThemeColor(color, isLight) {
    if (!color || typeof document === 'undefined') return;
    const isLightBool = typeof isLight === 'boolean' ? isLight : null;
    if (color === currentCommittedColor && (isLightBool === null || isLightBool === currentCommittedIsLight)) {
        return;
    }
    currentCommittedColor = color;
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
        document.documentElement.style.setProperty('--bg-start', color);
    }
    if (document.body) {
        document.body.style.backgroundColor = color;
    }
    const bgBase = dom.bgLayer;
    const bgNext = dom.bgLayerNext;
    if (bgBase) bgBase.style.backgroundColor = color;
    if (bgNext) bgNext.style.backgroundColor = color;
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
        updateThemeColor(currentWallpaperTheme.color, currentWallpaperTheme.isLight);
    } else {
        updateThemeColor(APP_THEME_DARK.color, false);
    }
}

/**
 * @param {import('../types.js').WallpaperTheme} theme
 */
export function setWallpaperTheme(theme) {
    if (!theme || !theme.color) return;
    currentWallpaperTheme = theme;
    syncWallpaperTheme();
}

/** @type {{ key: string, topRaw: number[], fullRaw: number[] } | null} */
let cachedRawSample = null;

/**
 * @param {HTMLImageElement} img
 */
export function sampleCustomWallpaperTheme(img) {
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

        const sampleKey = `${img.src || img.currentSrc}_${Math.round(srcX)}_${Math.round(srcY)}_${Math.round(srcW)}_${Math.round(srcH)}`;
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
            cachedRawSample = { key: sampleKey, topRaw, fullRaw };
        }

        const savedMask = Number(storageGet(CONFIG.KEYS.MASK_OPACITY, CONFIG.APPEARANCE.DEFAULT_MASK_OPACITY));
        const maskOp = (Number.isFinite(savedMask)
            ? Math.max(0, Math.min(CONFIG.APPEARANCE.MAX_MASK_OPACITY, savedMask))
            : CONFIG.APPEARANCE.DEFAULT_MASK_OPACITY) / 100;

        const [topR, topG, topB] = topRaw.map(v => Math.round(v * (1 - maskOp)));
        const lum = 0.2126 * topR + 0.7152 * topG + 0.0722 * topB;
        const isLight = lum > CONFIG.APPEARANCE.LUMINANCE_THRESHOLD;
        const theme = isLight ? APP_THEME_LIGHT : APP_THEME_DARK;
        const cachedTheme = storageGet(CONFIG.KEYS.THEME_CACHE);
        if (!cachedTheme || cachedTheme.color !== theme.color || cachedTheme.isLight !== theme.isLight) {
            storageSet(CONFIG.KEYS.THEME_CACHE, theme);
        }
        setWallpaperTheme(theme);

        // 动态环境光 Specular Tint：对采样色彩进行适度提亮与区间保护，避免暗色壁纸造成暗沉
        const [r, g, b] = fullRaw.map(v => Math.round(v * (1 - maskOp)));
        const clamp = CONFIG.APPEARANCE.TINT_CLAMP;
        const maxVal = Math.max(r, g, b);
        const boost = maxVal > 0 && maxVal < clamp.BOOST_THRESHOLD ? clamp.BOOST_THRESHOLD / maxVal : 1;
        const tintR = Math.min(clamp.MAX, Math.round(Math.max(clamp.MIN, r * boost)));
        const tintG = Math.min(clamp.MAX, Math.round(Math.max(clamp.MIN, g * boost)));
        const tintB = Math.min(clamp.MAX, Math.round(Math.max(clamp.MIN, b * boost)));
        const tintStr = `${tintR}, ${tintG}, ${tintB}`;
        if (storageGet(CONFIG.KEYS.TINT_CACHE) !== tintStr) {
            storageSet(CONFIG.KEYS.TINT_CACHE, tintStr);
        }
        updateGlassTint(tintStr);
    } catch {
        setWallpaperTheme(APP_THEME_DARK);
    }
}

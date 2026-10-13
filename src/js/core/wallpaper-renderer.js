import { CONFIG, backgrounds } from '../config/constants.js';
import { PRESET_WALLPAPER_THEMES, PRESET_WALLPAPER_TINTS } from '../config/themes.js';
import { dom, $ } from '../state/dom.js';
import { setWallpaperTheme, updateGlassTint, sampleCustomWallpaperTheme } from './theme-engine.js';

let activeWallpaperReqId = 0;
let bgSwitchTimer = null;

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
                bgNext.style.transition = `opacity ${CONFIG.TIMERS.BG_CROSSFADE / 1000}s var(--ease-exit)`;
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
}

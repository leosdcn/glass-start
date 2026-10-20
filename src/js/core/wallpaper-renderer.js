import { CONFIG, backgrounds } from '../config/constants.js';
import { PRESET_WALLPAPER_THEMES, PRESET_WALLPAPER_TINTS } from '../config/themes.js';
import { dom } from '../state/dom.js';
import { setWallpaperTheme, updateGlassTint, sampleCustomWallpaperTheme } from './theme-engine.js';

let activeWallpaperReqId = 0;
/** @type {ReturnType<typeof setTimeout>|null} */
let bgSwitchTimer = null;

/**
 * @param {string} urlStr
 * @param {boolean} [animate]
 */
export function applyWallpaper(urlStr, animate = true) {
    const bgBase = dom.bgLayer;
    const bgNext = dom.bgLayerNext;
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
            bgNext.classList.remove('is-crossfading');
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
            bgNext.classList.add('is-crossfading');

            requestAnimationFrame(() => {
                if (reqId !== activeWallpaperReqId) return;
                bgNext.style.transition = `opacity ${CONFIG.TIMERS.BG_CROSSFADE / 1000}s var(--ease-exit)`;
                bgNext.style.opacity = '1';
                bgSwitchTimer = setTimeout(() => {
                    bgSwitchTimer = null;
                    if (reqId !== activeWallpaperReqId) return;
                    bgBase.style.backgroundImage = newStyleUrl;
                    bgBase.style.opacity = '1';
                    bgNext.style.transition = 'none';
                    bgNext.style.opacity = '0';
                    bgNext.classList.remove('is-crossfading');
                }, CONFIG.TIMERS.BG_CROSSFADE);
            });
        } else {
            bgNext.classList.remove('is-crossfading');
            bgNext.style.transition = 'none';
            bgNext.style.opacity = '0';
            bgBase.style.backgroundImage = newStyleUrl;
            bgBase.style.opacity = '1';
        }
    };

    const prepareTransition = async () => {
        img.onload = img.onerror = null;
        if (reqId !== activeWallpaperReqId || !img.naturalWidth) return;
        if (typeof img.decode === 'function') {
            try {
                await img.decode();
            } catch {
                // 解码失败保留当前壁纸，不启动不完整图片的交叉淡入。
                return;
            }
        }
        executeTransition();
    };

    img.onload = prepareTransition;
    img.onerror = () => { img.onload = img.onerror = null; };
    img.src = urlStr;
    if (img.complete && img.naturalWidth > 0) {
        prepareTransition();
    }
}

import { CONFIG, backgrounds } from '../config/constants.js';
import { PRESET_THEMES, PRESET_TINTS, PRESET_THEME_COLORS } from '../config/themes.js';
import { dom } from '../state/dom.js';
import { setWallpaperTheme, updateGlassTint, sampleCustomWallpaperTheme } from './theme-engine.js';
import { afterScreenTransition, isScreenTransitioning } from './screen-state.js';

/** @type {{ url: string, styleUrl: string, base: HTMLElement, next: HTMLElement, animate: boolean, image: HTMLImageElement | null } | null} */
let activeWallpaperRequest = null;
/** 只保留最近一张成功解码的图片，避免积累大图内存。 */
/** @type {{ url: string, image: HTMLImageElement, themeSamplePending: boolean } | null} */
let decodedWallpaper = null;
/** @type {ReturnType<typeof setTimeout>|null} */
let bgSwitchTimer = null;
// 图片请求可以更换或失败，已开始的淡入仍须独立完成收尾。
let wallpaperTransitionId = 0;

/** 预览复用渲染器最近一次成功准备的图片，不额外保留大图缓存。 @param {string} url */
export function getPreparedWallpaperImage(url) {
    return decodedWallpaper?.url === url ? decodedWallpaper.image : null;
}

function schedulePendingThemeSample() {
    if (!decodedWallpaper?.themeSamplePending) return;
    const sample = () => {
        if (decodedWallpaper?.themeSamplePending) updateCustomWallpaperTheme(false);
    };
    if ('requestIdleCallback' in window) {
        window.requestIdleCallback(sample, { timeout: 300 });
    } else {
        setTimeout(sample, 300);
    }
}

/** @param {boolean} animate */
function updateCustomWallpaperTheme(animate) {
    if (!decodedWallpaper?.image.naturalWidth) return;
    // 启动恢复的图片照常显示，像素读取等切屏结束；快速往返时继续等下一次收尾。
    decodedWallpaper.themeSamplePending = !animate && isScreenTransitioning();
    if (decodedWallpaper.themeSamplePending) {
        afterScreenTransition(schedulePendingThemeSample);
        return;
    }
    sampleCustomWallpaperTheme(decodedWallpaper.image);
}

/**
 * @param {string} urlStr
 * @param {boolean} [animate]
 * @param {HTMLImageElement | null} [preparedImage] - 调用方已完成加载和解码的图片
 */
export function applyWallpaper(urlStr, animate = true, preparedImage = null) {
    const bgBase = dom.bgLayer;
    const bgNext = dom.bgLayerNext;
    if (!bgBase || !bgNext || !urlStr || typeof urlStr !== 'string') return;

    // 匹配预设或离线采样壁纸主题色，动态自适应 Safari 顶栏外观与环境光折射
    const presetIdx = backgrounds.indexOf(urlStr);
    if (presetIdx >= 0 && PRESET_THEMES[presetIdx]) {
        if (decodedWallpaper) decodedWallpaper.themeSamplePending = false;
        const themeColor = PRESET_THEME_COLORS && PRESET_THEME_COLORS[presetIdx];
        setWallpaperTheme(PRESET_THEMES[presetIdx], themeColor);
        if (PRESET_TINTS && PRESET_TINTS[presetIdx]) {
            updateGlassTint(PRESET_TINTS[presetIdx]);
        }
    }

    // 过滤 URL 中可能破坏 CSS url() 语法的引号、反斜杠、右括号与换行符
    const safeCssUrl = urlStr.replace(/["'\\\r\n)]/g, '\\$&');
    const newStyleUrl = `url("${safeCssUrl}")`;

    const previous = activeWallpaperRequest;
    if (previous?.url === urlStr && previous.base === bgBase && previous.next === bgNext) {
        previous.animate = animate;
        // 同一加载／解码只保留一个任务；后一次调用可更新其入场方式。
        if (!previous.image && !preparedImage) return;
        const crossfading = bgNext.classList.contains('is-crossfading');
        const showing = (crossfading ? bgNext : bgBase).style.backgroundImage === previous.styleUrl;
        if (previous.image && showing && (animate || !crossfading)) {
            // 相同图片仍须响应遮罩和视口变化，但不重解码或重播淡入。
            if (presetIdx < 0) updateCustomWallpaperTheme(animate);
            return;
        }
    }
    const request = { url: urlStr, styleUrl: newStyleUrl, base: bgBase, next: bgNext, animate, image: /** @type {HTMLImageElement | null} */ (null) };
    activeWallpaperRequest = request;
    const cachedImage = preparedImage || getPreparedWallpaperImage(urlStr);
    const img = cachedImage || new Image();

    const executeTransition = () => {
        img.onload = null;
        img.onerror = null;
        if (activeWallpaperRequest !== request) return;
        const transitionId = ++wallpaperTransitionId;
        request.image = img;
        decodedWallpaper = { url: urlStr, image: img, themeSamplePending: false };
        if (bgSwitchTimer) {
            clearTimeout(bgSwitchTimer);
            bgSwitchTimer = null;
            bgNext.classList.remove('is-crossfading');
        }

        if (presetIdx < 0) updateCustomWallpaperTheme(request.animate);

        if (request.animate) {
            if (bgNext.style.backgroundImage) {
                bgBase.style.backgroundImage = bgNext.style.backgroundImage;
                bgBase.style.opacity = '1';
            }
            bgNext.style.transition = 'none';
            bgNext.style.opacity = '0';
            bgNext.style.backgroundImage = newStyleUrl;
            request.styleUrl = bgNext.style.backgroundImage;
            bgNext.classList.add('is-crossfading');

            requestAnimationFrame(() => {
                if (wallpaperTransitionId !== transitionId) return;
                bgNext.style.transition = `opacity ${CONFIG.TIMERS.BG_CROSSFADE / 1000}s var(--ease-exit)`;
                bgNext.style.opacity = '1';
                bgSwitchTimer = setTimeout(() => {
                    if (wallpaperTransitionId !== transitionId) return;
                    bgSwitchTimer = null;
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
            request.styleUrl = bgBase.style.backgroundImage;
            bgBase.style.opacity = '1';
        }
    };

    const fail = () => {
        img.onload = img.onerror = null;
        if (activeWallpaperRequest === request) activeWallpaperRequest = null;
    };
    let preparing = false;
    const prepareTransition = async () => {
        if (preparing) return;
        preparing = true;
        img.onload = img.onerror = null;
        if (activeWallpaperRequest !== request) return;
        if (!img.naturalWidth) { fail(); return; }
        if (typeof img.decode === 'function') {
            try {
                await img.decode();
            } catch {
                // 解码失败保留当前壁纸，不启动不完整图片的交叉淡入。
                fail();
                return;
            }
        }
        executeTransition();
    };

    if (cachedImage) {
        executeTransition();
        return;
    }
    img.onload = prepareTransition;
    img.onerror = fail;
    img.src = urlStr;
    if (img.complete && img.naturalWidth > 0) {
        prepareTransition();
    }
}

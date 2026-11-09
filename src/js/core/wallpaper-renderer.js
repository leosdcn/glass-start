import { CONFIG, backgrounds } from '../config/constants.js';
import { PRESET_THEMES, PRESET_TINTS, PRESET_THEME_COLORS } from '../config/themes.js';
import { dom } from '../state/dom.js';
import { setWallpaperTheme, updateGlassTint, sampleCustomWallpaperTheme } from './theme-engine.js';
import { afterScreenTransition, isScreenTransitioning } from './screen-state.js';

/** @typedef {(image: HTMLImageElement) => void} ThemeSampleListener */
/** @type {{ url: string, base: HTMLElement, next: HTMLElement, animate: boolean, image: HTMLImageElement | null, onSample?: ThemeSampleListener } | null} */
let activeWallpaperRequest = null;
/** 只保留最近一张成功解码的图片，避免积累大图内存。 */
/** @type {{ url: string, image: HTMLImageElement, themeSamplePending: boolean } | null} */
let decodedWallpaper = null;
/** @type {number} */
let wallpaperOpacity = CONFIG.APPEARANCE.DEFAULT_MASK_OPACITY;
/** @type {string | null} */
let baseWallpaperUrl = null;
// 图片请求可以更换或失败，正在进行的淡入独立收尾。
/** @typedef {{ url: string, finish: (show: boolean) => void }} WallpaperFade */
/** @type {WallpaperFade | null} */
let wallpaperFade = null;

/** 预览复用渲染器最近一次成功准备的图片，不额外保留大图缓存。 @param {string} url */
export function getPreparedWallpaperImage(url) {
    return decodedWallpaper?.url === url ? decodedWallpaper.image : null;
}

function schedulePendingThemeSample() {
    const pending = decodedWallpaper;
    if (!pending?.themeSamplePending) return;
    const sample = () => {
        if (decodedWallpaper === pending && pending.themeSamplePending) updateCustomWallpaperTheme(false);
    };
    if ('requestIdleCallback' in window) {
        window.requestIdleCallback(sample, { timeout: 300 });
    } else {
        setTimeout(sample, 300);
    }
}

/** @param {boolean} animate */
function updateCustomWallpaperTheme(animate) {
    const request = activeWallpaperRequest;
    if (!decodedWallpaper?.image.naturalWidth || request?.url !== decodedWallpaper.url || backgrounds.includes(decodedWallpaper.url)) return;
    // 启动恢复的图片照常显示，像素读取等切屏结束；快速往返时继续等下一次收尾。
    decodedWallpaper.themeSamplePending = !animate && isScreenTransitioning();
    if (decodedWallpaper.themeSamplePending) {
        afterScreenTransition(schedulePendingThemeSample);
        return;
    }
    const sample = sampleCustomWallpaperTheme(decodedWallpaper.image, wallpaperOpacity);
    if (sample) {
        setWallpaperTheme(sample.theme);
        updateGlassTint(sample.tint);
    }
    const onSample = request.onSample;
    request.onSample = undefined;
    onSample?.(decodedWallpaper.image);
}

/** @param {number} opacity */
export function setWallpaperDimming(opacity) {
    if (wallpaperOpacity === opacity) return;
    wallpaperOpacity = opacity;
    updateCustomWallpaperTheme(activeWallpaperRequest?.animate ?? false);
}

/**
 * @param {string} urlStr
 * @param {boolean} [animate]
 * @param {HTMLImageElement | null} [preparedImage] - 调用方已完成加载和解码的图片
 * @param {ThemeSampleListener} [onSample] - 自定义图已取色，交给持久化拥有者处理
 */
export function applyWallpaper(urlStr, animate = true, preparedImage = null, onSample) {
    const bgBase = dom.bgLayer;
    const bgNext = dom.bgLayerNext;
    if (!bgBase || !bgNext || !urlStr || typeof urlStr !== 'string') return;

    // 匹配预设或离线采样壁纸主题色，动态自适应 Safari 顶栏外观与环境光折射
    const presetIdx = backgrounds.indexOf(urlStr);
    if (presetIdx >= 0 && PRESET_THEMES[presetIdx]) {
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
        previous.onSample = onSample;
        // 同一加载／解码只保留一个任务；后一次调用可更新其入场方式。
        if (!previous.image && !preparedImage) return;
        if (previous.image && (wallpaperFade ? animate && wallpaperFade.url === urlStr : baseWallpaperUrl === urlStr)) {
            // 相同图片仍须响应遮罩和视口变化，但不重解码或重播淡入。
            if (presetIdx < 0) updateCustomWallpaperTheme(animate);
            return;
        }
    }
    if (decodedWallpaper) decodedWallpaper.themeSamplePending = false;
    const request = { url: urlStr, base: bgBase, next: bgNext, animate, image: /** @type {HTMLImageElement | null} */ (null), onSample };
    activeWallpaperRequest = request;
    const cachedImage = preparedImage || getPreparedWallpaperImage(urlStr);
    const img = cachedImage || new Image();

    /** @param {string} url @param {string} styleUrl */
    const showBase = (url, styleUrl) => {
        baseWallpaperUrl = url;
        bgBase.style.backgroundImage = styleUrl;
        bgBase.style.opacity = '1';
    };
    const resetNextLayer = () => {
        bgNext.classList.remove('is-crossfading');
        bgNext.style.opacity = '0';
        bgNext.style.backgroundImage = '';
    };

    const executeTransition = () => {
        img.onload = null;
        img.onerror = null;
        if (activeWallpaperRequest !== request) return;
        request.image = img;
        decodedWallpaper = { url: urlStr, image: img, themeSamplePending: false };
        const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const shouldAnimate = request.animate && !motion.matches;
        wallpaperFade?.finish(shouldAnimate);

        if (presetIdx < 0) updateCustomWallpaperTheme(request.animate);

        if (!shouldAnimate) {
            showBase(urlStr, newStyleUrl);
            resetNextLayer();
            return;
        }

        bgNext.style.opacity = '0';
        bgNext.style.backgroundImage = newStyleUrl;
        bgNext.classList.add('is-crossfading');
        const animation = bgNext.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: CONFIG.TIMERS.BG_CROSSFADE,
            easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
            fill: 'forwards'
        });
        /** @type {WallpaperFade} */
        const fade = {
            url: urlStr,
            finish(show) {
                if (wallpaperFade !== fade) return;
                wallpaperFade = null;
                motion.removeEventListener('change', onMotion);
                if (show) showBase(urlStr, newStyleUrl);
                animation.cancel();
                resetNextLayer();
            }
        };
        const settle = () => fade.finish(true);
        const onMotion = () => { if (motion.matches) settle(); };
        wallpaperFade = fade;
        motion.addEventListener('change', onMotion);
        animation.finished.then(settle, settle);
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

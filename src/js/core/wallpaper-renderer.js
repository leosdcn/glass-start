import { CONFIG, backgrounds } from '../config/constants.js';
import { PRESET_THEMES, PRESET_TINTS, PRESET_THEME_COLORS } from '../config/themes.js';
import { dom } from '../state/dom.js';
import { getWallpaperTheme, setWallpaperTheme, updateGlassTint, sampleCustomWallpaperTheme } from './theme-engine.js';
import { afterScreenTransition, isScreenTransitioning } from './screen-state.js';

/** @typedef {(image: HTMLImageElement) => void} ThemeSampleListener */
/** @typedef {{ theme: import('../types').WallpaperTheme, tint: string }} WallpaperAppearance */
/** @typedef {{ url: string | null, image: HTMLImageElement | null, backgroundImage: string, appearance?: WallpaperAppearance, onSample?: ThemeSampleListener, samplePending?: boolean }} WallpaperFrame */
/** @type {{ url: string, animate: boolean, onSample?: ThemeSampleListener } | null} */
let pendingWallpaper = null;
/** @type {WallpaperFrame | null} */
let displayedWallpaper = null;
/** @type {((show: boolean) => void) | null} */
let finishWallpaperFade = null;
/** @type {number} */
let wallpaperOpacity = CONFIG.APPEARANCE.DEFAULT_MASK_OPACITY;

/** @param {string} url */
export function getPreparedWallpaperImage(url) {
    return displayedWallpaper?.url === url ? displayedWallpaper.image : null;
}

/** 保留实际显示的图片，启动解码未完成时保留模板已绘制的底图。 */
export function captureWallpaperFrame() {
    return displayedWallpaper ?? /** @type {WallpaperFrame} */ ({
        url: null, image: null,
        backgroundImage: dom.bgLayer?.style.backgroundImage ?? '',
        appearance: {
            theme: getWallpaperTheme(),
            tint: document.documentElement.style.getPropertyValue('--glass-tint') || '255, 255, 255'
        }
    });
}

/** @param {WallpaperFrame} frame @param {boolean} defer */
function sampleWallpaperFrame(frame, defer) {
    if (!frame.image || frame !== displayedWallpaper || backgrounds.includes(frame.url ?? '')) return;
    if (defer && isScreenTransitioning()) {
        if (frame.samplePending) return;
        frame.samplePending = true;
        afterScreenTransition(() => {
            const sample = () => {
                if (!frame.samplePending) return;
                frame.samplePending = false;
                sampleWallpaperFrame(frame, true);
            };
            if ('requestIdleCallback' in window) window.requestIdleCallback(sample, { timeout: 300 });
            else setTimeout(sample, 300);
        });
        return;
    }
    frame.samplePending = false;
    const sample = sampleCustomWallpaperTheme(frame.image, wallpaperOpacity);
    if (sample) {
        frame.appearance = sample;
        applyFrameAppearance(sample);
    }
    const onSample = frame.onSample;
    frame.onSample = undefined;
    onSample?.(frame.image);
}

/** @param {WallpaperAppearance} appearance */
function applyFrameAppearance({ theme, tint }) {
    setWallpaperTheme(theme);
    updateGlassTint(tint);
}

/** @param {number} opacity */
export function setWallpaperDimming(opacity) {
    if (wallpaperOpacity === opacity) return;
    wallpaperOpacity = opacity;
    if (displayedWallpaper) sampleWallpaperFrame(displayedWallpaper, true);
}

/** @param {WallpaperFrame} frame @param {boolean} animate */
function presentWallpaperFrame(frame, animate) {
    const base = dom.bgLayer;
    const next = dom.bgLayerNext;
    if (!base || !next) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const shouldAnimate = animate && !motion.matches;
    finishWallpaperFade?.(shouldAnimate);
    if (displayedWallpaper) displayedWallpaper.samplePending = false;
    displayedWallpaper = frame;
    const showBase = () => {
        base.style.backgroundImage = frame.backgroundImage;
        base.style.opacity = '1';
    };

    if (!shouldAnimate) {
        showBase();
    } else {
        next.style.opacity = '0';
        next.style.backgroundImage = frame.backgroundImage;
        next.classList.add('is-crossfading');
        const animation = next.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: CONFIG.TIMERS.BG_CROSSFADE,
            easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
            fill: 'forwards'
        });
        /** @param {boolean} show */
        const finish = show => {
            if (finishWallpaperFade !== finish) return;
            finishWallpaperFade = null;
            motion.removeEventListener('change', onMotion);
            if (show) showBase();
            animation.cancel();
            next.classList.remove('is-crossfading');
            next.style.opacity = '0';
            next.style.backgroundImage = '';
        };
        const settle = () => finish(true);
        const onMotion = () => { if (motion.matches) settle(); };
        finishWallpaperFade = finish;
        motion.addEventListener('change', onMotion);
        animation.finished.then(settle, settle);
    }

    if (frame.appearance) applyFrameAppearance(frame.appearance);
    sampleWallpaperFrame(frame, !animate);
}

/** @param {WallpaperFrame} frame */
export function restoreWallpaperFrame(frame) {
    pendingWallpaper = null;
    presentWallpaperFrame(frame, false);
}

/**
 * @param {string} url
 * @param {boolean} [animate]
 * @param {HTMLImageElement | null} [preparedImage]
 * @param {ThemeSampleListener} [onSample]
 */
export function applyWallpaper(url, animate = true, preparedImage = null, onSample) {
    if (!dom.bgLayer || !dom.bgLayerNext || !url || typeof url !== 'string') return;
    if (pendingWallpaper?.url === url && !preparedImage) {
        pendingWallpaper.animate = animate;
        pendingWallpaper.onSample = onSample;
        return;
    }

    if (displayedWallpaper?.url === url) {
        pendingWallpaper = null;
        if (!animate) finishWallpaperFade?.(true);
        displayedWallpaper.onSample = onSample;
        sampleWallpaperFrame(displayedWallpaper, !animate);
        return;
    }

    const request = { url, animate, onSample };
    pendingWallpaper = request;
    const image = preparedImage ?? new Image();
    const present = () => {
        if (pendingWallpaper !== request) return;
        pendingWallpaper = null;
        const preset = backgrounds.indexOf(url);
        const appearance = preset < 0 ? undefined : {
            theme: { ...PRESET_THEMES[preset], themeColor: PRESET_THEME_COLORS[preset] },
            tint: PRESET_TINTS[preset]
        };
        // 避免 URL 中的特殊字符破坏 CSS url() 语法。
        const backgroundImage = `url("${url.replace(/["'\\\r\n)]/g, '\\$&')}")`;
        presentWallpaperFrame({ url, image, backgroundImage, appearance, onSample: request.onSample }, request.animate);
    };
    if (preparedImage) {
        present();
        return;
    }

    const clearListeners = () => { image.onload = image.onerror = null; };
    const fail = () => {
        clearListeners();
        if (pendingWallpaper === request) pendingWallpaper = null;
    };
    const decode = async () => {
        if (!image.onload) return;
        clearListeners();
        if (pendingWallpaper !== request) return;
        try {
            if (!image.naturalWidth) { fail(); return; }
            await image.decode?.();
            present();
        } catch {
            fail();
        }
    };
    image.onload = decode;
    image.onerror = fail;
    image.src = url;
    if (image.complete && image.naturalWidth > 0) decode();
}

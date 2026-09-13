/**
 * ==============================================================================
 * Glass Start — 壁纸状态管理与即选即存持久化 (src/js/modules/wallpaper.js)
 * ==============================================================================
 */
import { CONFIG, backgrounds } from '../config/constants.js';
import { storageGet, storageSet, storageRemove } from '../utils/helpers.js';
import { getWallpaperDB, setWallpaperDB, removeWallpaperDB } from '../utils/idb.js';
import { state, modalState } from '../state/store.js';
import { dom, $ } from '../state/dom.js';
import { applyWallpaper } from '../core/theme-engine.js';

/**
 * 获取当前生效的自定义壁纸（三通道回退：内存缓存 -> IndexedDB -> localStorage）
 * @returns {Promise<string|null>}
 */
export async function getEffectiveCustomWallpaper() {
    return state.customWallpaper || await getWallpaperDB() || storageGet(CONFIG.KEYS.USER_WALLPAPER, null);
}

/**
 * 判断给定 URL 是否命中预设壁纸 backgrounds[] 数组；返回索引，未命中返回 -1。
 * @param {string|null|undefined} url
 * @returns {number}
 */
export function findPresetBgIndex(url) {
    if (!url || typeof url !== 'string') return -1;
    if (/^(data:|https?:)/i.test(url)) return -1;
    return backgrounds.indexOf(url);
}

/**
 * 彻底清除"自定义壁纸"三通道（内存 / IDB / localStorage），不触碰 state.bg。
 * @returns {Promise<void>}
 */
export async function clearCustomWallpaper() {
    state.customWallpaper = null;
    storageRemove(CONFIG.KEYS.USER_WALLPAPER);
    await removeWallpaperDB();
}

/**
 * 刷新外观壁纸 Tab 中的壁纸来源文字提示与「恢复默认」按钮显隐状态
 * @param {string|null} [customWallpaperOverride]
 * @returns {Promise<void>}
 */
export async function updateWallpaperStatusUI(customWallpaperOverride) {
    const resolveBg = customWallpaperOverride !== undefined
        ? customWallpaperOverride
        : (modalState.draftWallpaper !== undefined
            ? modalState.draftWallpaper
            : (await getEffectiveCustomWallpaper()));
    const isCustom = !!resolveBg && findPresetBgIndex(resolveBg) === -1;
    if (!dom.wallpaperStatus || !dom.resetBgBtn) return;
    if (isCustom) {
        dom.wallpaperStatus.textContent = '已使用自定义壁纸';
        dom.wallpaperStatus.className = 'text-2xs text-emerald-400/90 font-medium';
        dom.resetBgBtn.classList.remove('hidden');
    } else {
        dom.wallpaperStatus.textContent = '';
        dom.wallpaperStatus.className = 'hidden';
        dom.resetBgBtn.classList.add('hidden');
    }
}

/**
 * 刷新预设壁纸库卡片的激活（Active）高亮选中状态
 * @param {string} [customWallpaperOverride]
 * @returns {void}
 */
export function updatePresetBgCardsUI(customWallpaperOverride) {
    const currentBg = customWallpaperOverride !== undefined
        ? (customWallpaperOverride || backgrounds[state.bg] || '')
        : (storageGet(CONFIG.KEYS.USER_WALLPAPER) || backgrounds[state.bg] || '');
    const container = dom.presetWallpaperGrid;
    if (!container) return;
    container.querySelectorAll('.preset-bg-card').forEach(card => {
        const bg = card.dataset.bg;
        card.classList.toggle('active', bg === currentBg);
    });
}

/**
 * 立即持久化选中的壁纸（无需按「保存并关闭」即刻生效并存储）
 * @param {string|null} targetWallpaper
 * @returns {Promise<void>}
 */
export async function commitWallpaperSelection(targetWallpaper) {
    const presetIdx = findPresetBgIndex(targetWallpaper);
    if (presetIdx >= 0) {
        await clearCustomWallpaper();
        state.bg = presetIdx;
        storageSet(CONFIG.KEYS.BG, presetIdx);
    } else if (targetWallpaper) {
        state.customWallpaper = targetWallpaper;
        await setWallpaperDB(targetWallpaper);
        if (targetWallpaper.length <= CONFIG.APPEARANCE.MAX_LS_WALLPAPER_BYTES) {
            storageSet(CONFIG.KEYS.USER_WALLPAPER, targetWallpaper);
        } else {
            storageRemove(CONFIG.KEYS.USER_WALLPAPER);
        }
        state.bg = 0;
        storageSet(CONFIG.KEYS.BG, 0);
    } else {
        await clearCustomWallpaper();
        state.bg = 0;
        storageSet(CONFIG.KEYS.BG, 0);
    }
    modalState.initialWallpaper = targetWallpaper;
}

/**
 * 切换壁纸并自动持久化保存（无需点击「保存并关闭」）
 * @param {string} urlStr
 * @returns {void}
 */
export function previewDraftWallpaper(urlStr) {
    modalState.draftWallpaper = urlStr;
    if (urlStr && /^https?:\/\//i.test(urlStr)) {
        const testImg = new Image();
        testImg.onload = () => {
            applyWallpaper(urlStr, true);
            commitWallpaperSelection(urlStr);
            testImg.onload = testImg.onerror = null;
        };
        testImg.onerror = () => {
            if (typeof window.showConfirm === 'function') {
                window.showConfirm('无法加载该网络图片，请检查图片 URL 是否有效。', null, '图片无法加载');
            }
            testImg.onload = testImg.onerror = null;
        };
        testImg.src = urlStr;
    } else {
        applyWallpaper(urlStr || backgrounds[state.bg], true);
        commitWallpaperSelection(urlStr);
    }
    updateWallpaperStatusUI(urlStr);
    updatePresetBgCardsUI(urlStr);
}

/**
 * 重置为默认系统壁纸并自动持久化保存
 * @returns {void}
 */
export async function resetDraftWallpaper() {
    modalState.draftWallpaper = null;
    await commitWallpaperSelection(null);
    applyWallpaper(backgrounds[0], true);
    await updateWallpaperStatusUI(null);
    updatePresetBgCardsUI(backgrounds[0]);
}

/**
 * 切换轮播到下一张壁纸 (Ctrl+B / ⌘+B 快捷键)
 * @returns {Promise<void>}
 */
export async function switchBg() {
    let customBg = await getEffectiveCustomWallpaper();
    const legacyPresetIdx = findPresetBgIndex(customBg);
    if (legacyPresetIdx >= 0) {
        await clearCustomWallpaper();
        state.bg = legacyPresetIdx;
        customBg = null;
    }
    if (customBg) {
        await removeWallpaperDB();
        storageRemove(CONFIG.KEYS.USER_WALLPAPER);
        state.customWallpaper = null;
        state.bg = 0;
    } else {
        state.bg = (state.bg + 1) % backgrounds.length;
    }
    storageSet(CONFIG.KEYS.BG, state.bg);
    applyWallpaper(backgrounds[state.bg], true);
    preloadNextBg();
}

/**
 * 预加载下一张壁纸以实现零延迟秒切
 * @returns {void}
 */
export function preloadNextBg() {
    if (typeof navigator !== 'undefined' && (navigator.connection?.saveData || navigator.connection?.effectiveType === '2g')) {
        return;
    }
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
        return;
    }
    const nextIdx = (state.bg + 1) % backgrounds.length;
    const nextBgUrl = backgrounds[nextIdx];
    if (nextBgUrl) {
        const img = new Image();
        img.src = nextBgUrl;
    }
}

/**
 * 渲染设置面板中预设高清壁纸缩略图网格卡片
 * @returns {void}
 */
export function renderPresetWallpapers() {
    const grid = dom.presetWallpaperGrid || $('presetWallpaperGrid');
    if (!grid) return;
    const titles = ['暮色山峦', '溪谷晨曦', '星空雪山', '峰峦破晓', '天际立面', '极简回廊', '紫韵流光', '梦幻流彩'];
    grid.innerHTML = titles.map((title, i) => {
        const bg = `./wallpapers/bg${i + 1}.avif`;
        const thumb = `./wallpapers/bg${i + 1}-thumb.avif`;
        const fullTitle = i === 0 ? `${title}（系统默认）` : title;
        return `<button type="button" class="preset-bg-card group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-bg="${bg}" data-title="${title}" title="${fullTitle}">
            <img data-src="${thumb}" src="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2010'%3E%3C/svg%3E" width="160" height="100" alt="${title}" class="w-full h-full object-cover pointer-events-none" loading="lazy" decoding="async" draggable="false">
            <span class="absolute inset-x-0 bottom-0 py-1.5 px-1 bg-black/65 backdrop-blur-sm border-t border-white/10 text-xs text-white/90 text-center font-medium tracking-tight pointer-events-none flex items-center justify-center">${title}</span>
        </button>`;
    }).join('');
}

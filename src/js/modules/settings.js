import { updateAllBookmarkCounters, renderEditList, collectEditData, getExistingUrls } from './bookmark-editor.js';
import { showConfirm } from '../core/dialogs.js';
/**
 * 设置面板与弹窗管理系统
 */
import { CONFIG, backgrounds } from '../config/constants.js';
import { escapeHtml, safeUrl, normalizeBookmark, storageGet, storageSet, storageRemove } from '../utils/helpers.js';
import { state, modalState, pageData } from '../state/store.js';
import { replaceBookmarkDraft } from '../state/bookmark-draft.js';
import { dom } from '../state/dom.js';
import { OverlayStack } from '../core/overlay-stack.js';
import { applyWallpaper } from '../core/wallpaper-renderer.js';
import { flushWallpaperSelection, getEffectiveCustomWallpaper, updateWallpaperStatusUI, updatePresetBgCardsUI, clearCustomWallpaper } from './wallpaper.js';
import { saveUserBookmarks, resetUserBookmarks, getSortedCategories, getFaviconHTML, getCategoryIconHTML, initPickerFaviconObserver } from './bookmarks.js';
import { closeDropdown, hideSuggestions, setEngine } from './search.js';
import { renderCreditsModalList } from './clock.js';

let editOpenRequestId = 0;
let cachedSettingsTabs = null;
let cachedSettingsPanels = null;
let isPresetBgImagesLoaded = false;

export function loadPresetBgCardImages() {
    if (isPresetBgImagesLoaded) return;
    isPresetBgImagesLoaded = true;
    const container = dom.presetWallpaperGrid;
    if (!container) return;
    container.querySelectorAll('img[data-src]').forEach((img, idx) => {
        const src = img.dataset.src;
        if (!src) return;
        delete img.dataset.src;
        let handled = false;
        const handleLoaded = () => {
            if (handled) return;
            handled = true;
            img.onload = null;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        img.classList.add('loaded');
                    }, idx * CONFIG.TIMERS.PRESET_CARD_STAGGER);
                });
            });
        };
        img.onload = handleLoaded;
        img.src = src;
        if (img.complete && img.naturalWidth > 0) {
            handleLoaded();
        }
    });
}

export function switchSettingsTab(targetTabId) {
    if (!cachedSettingsTabs) cachedSettingsTabs = document.querySelectorAll('.settings-tab-btn');
    if (!cachedSettingsPanels) cachedSettingsPanels = document.querySelectorAll('.settings-tab-panel');
    cachedSettingsTabs.forEach(tab => {
        const isTarget = tab.dataset.tab === targetTabId;
        tab.classList.toggle('active', isTarget);
        tab.setAttribute('aria-selected', isTarget ? 'true' : 'false');
        tab.tabIndex = isTarget ? 0 : -1;
    });
    cachedSettingsPanels.forEach(panel => {
        panel.classList.toggle('hidden', panel.id !== targetTabId);
    });
    if (targetTabId === 'tabAppearance') {
        loadPresetBgCardImages();
    }
}

let bgEffectsRafId = null;
let pendingBgEffects = null;
let lastBgEffects = null;

function renderBgEffects(op) {
    const bgOverlay = dom.bgOverlay;
    if (!bgOverlay) return;
    const sameOverlay = lastBgEffects?.element === bgOverlay;
    if (!sameOverlay) {
        const trSec = `${CONFIG.TIMERS.BG_OVERLAY_TRANSITION / 1000}s`;
        bgOverlay.style.transition = `background-color ${trSec} ease, opacity ${trSec} ease`;
    }
    if (!sameOverlay || lastBgEffects.opacity !== op) {
        bgOverlay.style.backgroundColor = `rgba(0,0,0,${op / 100})`;
    }
    lastBgEffects = { element: bgOverlay, opacity: op };
}

export function applyBgEffects(opacity, save = false) {
    updateBgEffects(opacity, save, false);
}

/** 滑块草稿与无障碍读数即时更新，全屏视觉每帧只消费最后一次输入。 */
export function scheduleBgEffects(opacity) {
    updateBgEffects(opacity, false, true);
}

export function previewDraftMaskOpacity(value) {
    modalState.draftMaskOpacity = parseInt(value, 10) || 0;
    scheduleBgEffects(modalState.draftMaskOpacity);
}

function updateBgEffects(opacity, save, defer) {
    const op = Math.max(0, Math.min(CONFIG.APPEARANCE.MAX_MASK_OPACITY, parseInt(opacity, 10) || 0));
    if (defer) {
        pendingBgEffects = { opacity: op };
        if (bgEffectsRafId === null) {
            bgEffectsRafId = requestAnimationFrame(() => {
                bgEffectsRafId = null;
                const effects = pendingBgEffects;
                pendingBgEffects = null;
                if (effects) renderBgEffects(effects.opacity);
            });
        }
    } else {
        if (bgEffectsRafId !== null) cancelAnimationFrame(bgEffectsRafId);
        bgEffectsRafId = null;
        pendingBgEffects = null;
        renderBgEffects(op);
    }
    const maskOpacityVal = dom.maskOpacityVal;
    const maskOpacityInput = dom.maskOpacityInput;

    if (maskOpacityVal) maskOpacityVal.textContent = `${op}%`;
    if (maskOpacityInput) {
        if (maskOpacityInput.value != op) maskOpacityInput.value = op;
        maskOpacityInput.setAttribute('aria-valuenow', op);
        maskOpacityInput.setAttribute('aria-valuetext', `${op}%`);
    }
    if (save) {
        storageSet(CONFIG.KEYS.MASK_OPACITY, op);
    }
}

export async function openEditModal() {
    if (state.editOpen) return;
    closeDropdown();
    hideSuggestions();
    const editBtn = dom.editBookmarksBtn;
    editBtn?.setAttribute('aria-expanded', 'true');
    state.editOpen = true;
    const requestId = ++editOpenRequestId;
    const trigger = document.activeElement;
    const initialWallpaper = await getEffectiveCustomWallpaper();
    if (!state.editOpen || requestId !== editOpenRequestId) return;
    modalState.initialWallpaper = initialWallpaper;
    modalState.initialMaskOpacity = storageGet(CONFIG.KEYS.MASK_OPACITY, CONFIG.APPEARANCE.DEFAULT_MASK_OPACITY);

    modalState.draftWallpaper = modalState.initialWallpaper;
    modalState.draftMaskOpacity = modalState.initialMaskOpacity;
    modalState.wallpaperSaveFailed = false;

    // 初始化内存草稿真理源
    replaceBookmarkDraft(pageData.bookmarks.map((bm, i) => ({ ...bm, id: `bm_${i}`, desc: bm.desc || '' })));


    switchSettingsTab('tabBookmarks');
    renderEditList();
    updateWallpaperStatusUI(modalState.draftWallpaper);
    updatePresetBgCardsUI(modalState.draftWallpaper);
    applyBgEffects(modalState.draftMaskOpacity);
    OverlayStack.push('editModal', cancelEditModal, trigger);
}

export function cancelEditModal() {
    applyBgEffects(modalState.initialMaskOpacity);
    closeEditModal();
}

export function closeEditModal() {
    // 保存关闭时即使后台暂停了 rAF，也同步落定最后的预览；取消已先覆盖并清队列。
    if (pendingBgEffects) applyBgEffects(pendingBgEffects.opacity);
    state.editOpen = false;
    editOpenRequestId++;
    OverlayStack.pop('editModal');
    const editBtn = dom.editBookmarksBtn;
    editBtn?.setAttribute('aria-expanded', 'false');

    const inputRow = dom.urlBgInputRow;
    if (inputRow && !inputRow.classList.contains('hidden')) {
        inputRow.classList.add('hidden');
        const btnGroup = dom.urlBgBtnGroup;
        btnGroup?.classList.remove('hidden');
        const urlInput = dom.urlBgInput;
        if (urlInput) urlInput.value = '';
    }
}

export function openShortcutModal() {
    const modal = dom.shortcutModal;
    if (!modal) return;
    closeDropdown();
    hideSuggestions();
    dom.openShortcutFromSettingsBtn?.setAttribute('aria-expanded', 'true');
    OverlayStack.push('shortcutModal', closeShortcutModal);
}

export function closeShortcutModal() {
    const modal = dom.shortcutModal;
    if (!modal) return;
    OverlayStack.pop('shortcutModal');
    dom.openShortcutFromSettingsBtn?.setAttribute('aria-expanded', 'false');
}

export function openCreditsModal() {
    const modal = dom.creditsModal;
    if (!modal) return;
    renderCreditsModalList();
    dom.openCreditsFromSettingsBtn?.setAttribute('aria-expanded', 'true');
    OverlayStack.push('creditsModal', closeCreditsModal);
}

export function closeCreditsModal() {
    const modal = dom.creditsModal;
    if (!modal) return;
    OverlayStack.pop('creditsModal');
    dom.openCreditsFromSettingsBtn?.setAttribute('aria-expanded', 'false');
}

export function openBookmarkPicker(triggerEl = null) {
    const opener = triggerEl || document.activeElement || dom.togglePickerBtn;
    dom.togglePickerBtn?.setAttribute('aria-expanded', 'true');
    OverlayStack.push('bookmarkPicker', closeBookmarkPicker, opener);
    renderPickerCategories();
}

export function closeBookmarkPicker() {
    OverlayStack.pop('bookmarkPicker');
    dom.togglePickerBtn?.setAttribute('aria-expanded', 'false');
}

/**
 * 导出当前快捷书签草稿，不包含壁纸和偏好设置。
 * @returns {void}
 */
export function exportBookmarksJSON() {
    const data = collectEditData();
    const exportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        bookmarks: data
    };
    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    a.href = url;
    a.download = `startpage_bookmarks_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), CONFIG.TIMERS.OBJECT_REVOKE);
}

/**
 * 读取并解析用户选择/拖入的 JSON 备份文件
 * @param {File} file
 * @returns {void}
 */
export function importBookmarksJSON(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const parsed = JSON.parse(e.target.result);
            let importedList = [];
            if (Array.isArray(parsed)) {
                importedList = parsed;
            } else if (parsed && Array.isArray(parsed.bookmarks)) {
                importedList = parsed.bookmarks;
            } else if (parsed && Array.isArray(parsed.categories)) {
                parsed.categories.forEach(cat => {
                    if (cat && Array.isArray(cat.bookmarks)) importedList.push(...cat.bookmarks);
                });
            } else {
                showConfirm('上传的配置文件结构不匹配，未包含有效的书签数组。', null, '格式错误');
                return;
            }

            const validBookmarks = importedList.map(item => normalizeBookmark(item, '未命名')).filter(Boolean);

            if (validBookmarks.length === 0) {
                showConfirm('配置文件中没有提取到有效的书签条目。', null, '导入失败');
                return;
            }

            showConfirm(`检测到合规书签 ${validBookmarks.length} 项，确定导入并填入草稿列表中吗？需点击『完成』后生效。`, () => {
                replaceBookmarkDraft(validBookmarks, true);
                renderEditList();
                closeBookmarkPicker();
            }, '导入草稿确认');
        } catch (err) {
            showConfirm('解析 JSON 配置文件失败，请检查文件格式。', null, '解析错误');
        } finally {
            reader.onload = null;
        }
    };
    reader.readAsText(file, 'UTF-8');
}

/**
 * 恢复系统初始默认状态
 * @returns {void}
 */
export function resetBookmarks() {
    showConfirm('确定要恢复系统初始默认状态吗？此操作将立即清除您自定义的所有快捷书签、背景壁纸与偏好设置。', async () => {
        if (!await clearCustomWallpaper(0)) {
            showConfirm('无法清除壁纸存储，原有设置已保留。', null, '重置失败');
            return;
        }
        storageRemove(CONFIG.KEYS.PREFERRED_ENGINE);
        storageRemove(CONFIG.KEYS.USER_WALLPAPER);
        storageRemove(CONFIG.KEYS.MASK_OPACITY);
        storageRemove(CONFIG.KEYS.BG);
        storageRemove(CONFIG.KEYS.NAV_DISCOVERED);
        storageRemove(CONFIG.KEYS.WEATHER_CACHE);
        storageRemove(CONFIG.KEYS.WEATHER_LOC);
        storageRemove(CONFIG.KEYS.WEATHER_SETTINGS);

        if (dom.scrollDownHint) {
            dom.scrollDownHint.style.display = '';
            dom.scrollDownHint.style.opacity = '';
        }


        modalState.draftWallpaper = undefined;
        modalState.draftMaskOpacity = null;
        replaceBookmarkDraft([]);

        setEngine('bing', false);
        applyWallpaper(backgrounds[0], false);
        applyBgEffects(CONFIG.APPEARANCE.DEFAULT_MASK_OPACITY);
        resetUserBookmarks();
        closeBookmarkPicker();
        closeEditModal();
    }, '重置所有系统设置');
}

/**
 * 获取当前已存在于编辑列表或已添加的 URL 集合
 * @returns {Set<string>}
 */
export function renderPickerCategories() {
    const pickerContent = dom.pickerContent;
    if (!pickerContent) return;
    const urls = getExistingUrls();
    const sortedCats = getSortedCategories();

    pickerContent.innerHTML = sortedCats.map(cat => {
        const sortedBookmarks = cat.sortedBookmarks || [];
        return `
        <div>
            <div class="flex items-center gap-1.5 mb-1.5 pb-1 border-b border-white/5">
                <span class="text-sm shrink-0 flex items-center justify-center">${getCategoryIconHTML(cat.icon, 'size-3.5')}</span>
                <h4 class="text-xs font-medium text-white/70">${escapeHtml(cat.name)}</h4>
                <span class="ml-auto text-2xs text-white/20">${cat.bookmarks.length}</span>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-1">
                ${sortedBookmarks.map(bm => {
                    const exists = urls.has(bm.url);
                    const faviconHtml = getFaviconHTML(bm, 'sm');
                    return `
                        <button type="button" class="w-full flex items-center gap-2 px-2 py-1.5 apple-radius picker-item text-left select-none ${exists ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}" ${exists ? 'disabled aria-disabled="true"' : ''} aria-label="${exists ? `${escapeHtml(bm.name)}（已添加）` : `添加快捷书签：${escapeHtml(bm.name)}`}" ${!exists ? `data-name="${escapeHtml(bm.name)}" data-url="${escapeHtml(bm.url)}"` : ''}>
                            ${faviconHtml}
                            <span class="text-xs text-white/70 truncate flex-1 min-w-0">${escapeHtml(bm.name)}</span>
                            ${exists
                                ? '<span class="text-2xs text-white/20 shrink-0">已存在</span>'
                                : '<span class="text-white/40 shrink-0 text-sm">+</span>'
                            }
                        </button>
                    `;
                }).join('')}
            </div>
        </div>
    `;
    }).join('');
    updateAllBookmarkCounters();
    initPickerFaviconObserver();
}

export async function saveEditModal() {
    if (dom.saveEditBtn.disabled) return;
    dom.saveEditBtn.disabled = true;
    dom.saveEditBtn.setAttribute('aria-busy', 'true');
    try {
        const data = collectEditData();
        if (data.length === 0) {
            showConfirm('至少需要保留一个名称和 URL 均已填写的书签才能保存。', null, '无法保存');
            return;
        }

        if (!await flushWallpaperSelection()) {
            showConfirm('壁纸尚未保存成功，请重新选择后再保存。', null, '无法保存');
            return;
        }

        // 1. 提交书签
        if (modalState.bookmarksChanged) {
            saveUserBookmarks(data);
        }

        // 2. 提交背景暗度（壁纸已于用户选择时即选即存，无需重复落盘）
        if (modalState.draftMaskOpacity !== null) {
            storageSet(CONFIG.KEYS.MASK_OPACITY, modalState.draftMaskOpacity);
        }

        closeEditModal();
    } finally {
        dom.saveEditBtn.disabled = false;
        dom.saveEditBtn.removeAttribute('aria-busy');
    }
}

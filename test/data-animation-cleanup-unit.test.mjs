/** 无浏览器：通过真实删除／键盘排序入口和壁纸渲染器验证取消与迟到回调。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const messages = JSON.parse(readFileSync(new URL('../src/js/config/locales/zh-CN.json', import.meta.url), 'utf8'));

const { outputFiles } = await build({
    stdin: { contents: `export {bindEditEvents} from './src/js/modules/settings-events.js';
        export {applyWallpaper} from './src/js/core/wallpaper-renderer.js';
        export {modalState} from './src/js/state/store.js';`, resolveDir: process.cwd() },
    bundle: true, write: false, format: 'cjs', platform: 'node',
    plugins: [{ name: 'unrelated-boundaries', setup(b) {
        b.onLoad({ filter: /modules\/settings\.js$/ }, () => ({ contents:
            'export const ' + ['openEditModal', 'saveEditModal', 'cancelEditModal', 'openShortcutModal',
                'closeShortcutModal', 'openCreditsModal', 'closeCreditsModal', 'switchSettingsTab', 'previewDraftMaskOpacity',
                'resetBookmarks', 'importBookmarksJSON', 'exportBookmarksJSON',
                'openLanguageModal', 'saveLanguageModal', 'cancelLanguageModal',
                'selectLanguage', 'selectDraftTransitionMode', 'closeWallpaperUrlInput',
                'openWallpaperUrlInput', 'submitWallpaperUrlInput', 'clearOfflineCache'].map(name => `${name}=()=>{}`).join(',') + ';export const getSettingsTabs=()=>[];'
        }));
        b.onLoad({ filter: /modules\/bookmark-picker\.js$/ }, () => ({ contents:
            'export const openBookmarkPicker=()=>{},closeBookmarkPicker=()=>{},addBookmarkFromPicker=()=>{};' }));
        b.onLoad({ filter: /modules\/wallpaper\.js$/ }, () => ({ contents:
            'export const uploadWallpaper=()=>{},previewDraftWallpaper=()=>{},resetDraftWallpaper=()=>{},showWallpaperError=()=>{};' }));
        b.onLoad({ filter: /core\/dialogs\.js$/ }, () => ({ contents: 'export function showConfirm(){}' }));
        b.onLoad({ filter: /core\/theme-engine\.js$/ }, () => ({ contents:
            'export function getWallpaperTheme(){};export function setWallpaperTheme(){};export function updateGlassTint(){};export function sampleCustomWallpaperTheme(){};export function syncWallpaperTheme(){};' }));
    } }]
});

function fixture() {
    class Target {
        listeners = new Map();
        addEventListener(type, fn) {
            if (!this.listeners.has(type)) this.listeners.set(type, new Set());
            this.listeners.get(type).add(fn);
        }
        removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
        emit(type, details = {}) {
            const event = { target: this, preventDefault() {}, stopPropagation() {}, ...details };
            for (const fn of [...(this.listeners.get(type) || [])]) fn(event);
        }
    }
    const motion = new Target(); motion.matches = false;
    class Element extends Target {
        style = {}; dataset = {}; isConnected = true; textContent = '';
        animations = [];
        constructor(kind) {
            super(); this.kind = kind;
            const names = new Set();
            this.classList = { add: (...args) => args.forEach(x => names.add(x)),
                remove: (...args) => args.forEach(x => names.delete(x)), contains: x => names.has(x) };
        }
        closest(selector) {
            if (selector === `.${this.kind}`) return this;
            return this.parentNode?.closest(selector) ?? null;
        }
        focus() {}
        remove() { this.isConnected = false; rows.splice(rows.indexOf(this), 1); }
        getBoundingClientRect() { return { top: rows.indexOf(this) * 40, left: 0 }; }
        get nextSibling() { return rows[rows.indexOf(this) + 1] ?? null; }
        animate(keyframes) {
            const { promise, resolve, reject } = Promise.withResolvers();
            const animation = { keyframes, finished: promise, finish: resolve, cancelled: false,
                cancel() { this.cancelled = true; reject(new Error('cancelled')); } };
            this.animations.push(animation);
            return animation;
        }
    }
    const rows = ['a', 'b', 'c'].map(id => {
        const row = new Element('edit-row-card'); row.dataset.id = id; return row;
    });
    const list = new Element('editList');
    rows.forEach(row => row.parentNode = list);
    list.querySelectorAll = () => rows.slice();
    list.querySelector = selector => rows.find(row => selector.includes(`data-id="${row.dataset.id}"`)) ?? null;
    list.insertBefore = (src, target) => {
        rows.splice(rows.indexOf(src), 1);
        rows.splice(target ? rows.indexOf(target) : rows.length, 0, src);
    };
    const base = new Element('bgLayer'), next = new Element('bgLayerNext'), badge = new Element('badge');
    const document = new Target();
    document.querySelectorAll = () => [];
    document.getElementById = id => ({ editList: list, bgLayer: base, bgLayerNext: next, bookmarkCountBadge: badge })[id] ?? null;
    document.body = new Element('body');
    const timers = new Map(), images = [], fades = []; let id = 0;
    next.animate = () => {
        const { promise, resolve, reject } = Promise.withResolvers();
        const fade = { finished: promise, finish: resolve, cancel: () => reject(new Error('cancelled')) };
        fades.push(fade);
        return fade;
    };
    const context = vm.createContext({ module: { exports: {} }, console, document, Element,
        window: { matchMedia: () => motion, __GLASS_I18N__: { locale: 'zh-CN', messages: { 'zh-CN': messages } } }, CSS: { escape: value => value },
        getComputedStyle: () => ({ getPropertyValue: () => 'ease' }),
        setTimeout: fn => { timers.set(++id, fn); return id; }, clearTimeout: key => timers.delete(key),
        Image: class { constructor() { images.push(this); this.naturalWidth = 100; this.complete = false; } }
    });
    vm.runInContext(outputFiles[0].text, context);
    const app = context.module.exports;
    app.modalState.draftBookmarks = rows.map(row => ({ id: row.dataset.id, name: row.dataset.id, url: 'https://example.test', icon: '' }));
    app.bindEditEvents();
    const child = (row, kind) => { const el = new Element(kind); el.parentNode = row; return el; };
    return { app, rows, list, base, next, badge, motion, images, timers, fades,
        remove: row => list.emit('click', { target: child(row, 'del-btn') }),
        reorder: row => list.emit('keydown', { target: child(row, 'drag-handle'), altKey: true, key: 'ArrowDown' })
    };
}

test('删除行的动画结束、取消或启用减弱动效时移除占位行', async () => {
    for (const mode of ['end', 'cancel', 'motion']) {
        const f = fixture(), row = f.rows[0];
        f.remove(row);
        const exit = row.animations[0];
        assert.equal(f.app.modalState.draftBookmarks.length, 2);
        assert.equal(row.isConnected, true);
        if (mode === 'end') exit.finish();
        if (mode === 'cancel') exit.cancel();
        if (mode === 'motion') { f.motion.matches = true; f.motion.emit('change'); }
        await exit.finished.catch(() => {});
        assert.equal(row.isConnected, false, mode);
        assert.equal(f.badge.textContent, '已添加 2 项');
        if (mode === 'end') {
            const shifts = f.rows.map(item => item.animations[0]);
            assert.ok(shifts.every(shift => shift.keyframes[0].transform === 'translate3d(0px, 40px, 0)'));
            f.motion.matches = true;
            f.motion.emit('change');
            assert.ok(shifts.every(shift => shift.cancelled));
            assert.ok(f.rows.every(item => !item.style.transform && !item.style.transition));
        }
        assert.equal(f.motion.listeners.get('change').size, 0);
    }
});

test('排序由动画对象收尾，减弱动效可取消位移', async () => {
    for (const mode of ['motion', 'end']) {
        const f = fixture(), row = f.rows[0];
        f.reorder(row);
        assert.equal(f.rows.map(x => x.dataset.id).join(), 'b,a,c');
        assert.equal(f.app.modalState.draftBookmarks.map(x => x.id).join(), 'b,a,c');
        const shifts = f.rows.flatMap(item => item.animations);
        assert.equal(shifts.length, 2);
        if (mode === 'motion') { f.motion.matches = true; f.motion.emit('change'); }
        else shifts.forEach(shift => shift.finish());
        await Promise.allSettled(shifts.map(shift => shift.finished));
        assert.ok(shifts.every(shift => shift.cancelled));
        assert.equal(f.motion.listeners.get('change').size, 0);
    }
});

test('新排序和删除接管旧位移，旧收尾不能取消新动画', async () => {
    const f = fixture(), row = f.rows[0];
    f.reorder(row);
    const first = row.animations.at(-1);
    first.finish();
    f.reorder(row);
    const second = row.animations.at(-1);
    await first.finished;
    assert.equal(first.cancelled, true);
    assert.equal(second.cancelled, false);
    f.remove(row);
    const exit = row.animations.at(-1);
    assert.equal(second.cancelled, true);
    assert.equal(exit.keyframes[1].opacity, 0);
    exit.cancel();
    await exit.finished.catch(() => {});
    assert.equal(row.isConnected, false);
    assert.equal(f.motion.listeners.get('change').size, 0);
});

test('新图片失败后，旧淡入仍由动画对象完成换层', async () => {
    for (const decodeFailure of [true, false]) {
        const f = fixture();
        f.app.applyWallpaper('./wallpapers/bg1.avif', true);
        await f.images[0].onload();
        f.app.applyWallpaper('./wallpapers/bg2.avif', true);
        if (decodeFailure) {
            f.images[1].decode = async () => { throw new Error('broken'); };
            await f.images[1].onload();
        } else f.images[1].onerror();
        f.fades[0].finish();
        await f.fades[0].finished;
        assert.equal(f.base.style.backgroundImage, 'url("./wallpapers/bg1.avif")');
        assert.equal(f.next.style.opacity, '0');
        assert.equal(f.next.classList.contains('is-crossfading'), false);
        assert.equal(f.timers.size, 0);
    }
});

test('较新壁纸完成后，旧淡入回调不能覆盖它', async () => {
    const f = fixture();
    f.app.applyWallpaper('./wallpapers/bg1.avif', true);
    await f.images[0].onload();
    const oldFade = f.fades[0];
    f.app.applyWallpaper('./wallpapers/bg2.avif', false);
    await f.images[1].onload();
    await assert.rejects(oldFade.finished);
    assert.equal(f.base.style.backgroundImage, 'url("./wallpapers/bg2.avif")');
    assert.equal(f.next.classList.contains('is-crossfading'), false);
});

test('减弱动效直接提交壁纸，切换偏好会结束已开始的淡入', async () => {
    const f = fixture();
    f.motion.matches = true;
    f.app.applyWallpaper('./wallpapers/bg1.avif', true);
    await f.images[0].onload();
    assert.equal(f.fades.length, 0);
    assert.equal(f.base.style.backgroundImage, 'url("./wallpapers/bg1.avif")');
    f.motion.matches = false;
    f.app.applyWallpaper('./wallpapers/bg2.avif', true);
    await f.images[1].onload();
    assert.equal(f.fades.length, 1);
    f.motion.matches = true;
    f.motion.emit('change');
    assert.equal(f.base.style.backgroundImage, 'url("./wallpapers/bg2.avif")');
    assert.equal(f.next.classList.contains('is-crossfading'), false);
});

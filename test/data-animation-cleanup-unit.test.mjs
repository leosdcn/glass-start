/** 无浏览器：通过真实删除／键盘排序入口和壁纸渲染器验证取消与迟到回调。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import vm from 'node:vm';

const { outputFiles } = await build({
    stdin: { contents: `export {bindEditEvents} from './src/js/modules/settings-events.js';
        export {applyWallpaper} from './src/js/core/wallpaper-renderer.js';
        export {modalState} from './src/js/state/store.js';`, resolveDir: process.cwd() },
    bundle: true, write: false, format: 'cjs', platform: 'node',
    plugins: [{ name: 'unrelated-boundaries', setup(b) {
        b.onLoad({ filter: /modules\/settings\.js$/ }, () => ({ contents:
            'export const ' + ['openEditModal', 'saveEditModal', 'cancelEditModal', 'openShortcutModal',
                'closeShortcutModal', 'openCreditsModal', 'closeCreditsModal', 'openBookmarkPicker',
                'closeBookmarkPicker', 'updatePickerAvailability', 'switchSettingsTab', 'previewDraftMaskOpacity',
                'resetBookmarks', 'importBookmarksJSON', 'exportBookmarksJSON'].map(name => `${name}=()=>{}`).join(',')
        }));
        b.onLoad({ filter: /modules\/wallpaper\.js$/ }, () => ({ contents:
            'export const uploadWallpaper=()=>{},previewDraftWallpaper=()=>{},resetDraftWallpaper=()=>{};' }));
        b.onLoad({ filter: /core\/dialogs\.js$/ }, () => ({ contents: 'export function showConfirm(){}' }));
        b.onLoad({ filter: /core\/theme-engine\.js$/ }, () => ({ contents:
            'export function setWallpaperTheme(){};export function updateGlassTint(){};export function sampleCustomWallpaperTheme(){};' }));
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
    const timers = new Map(), frames = new Map(), images = []; let id = 0;
    const context = vm.createContext({ module: { exports: {} }, console, document, Element,
        window: { matchMedia: () => motion }, CSS: { escape: value => value },
        setTimeout: fn => { timers.set(++id, fn); return id; }, clearTimeout: key => timers.delete(key),
        requestAnimationFrame: fn => { frames.set(++id, fn); return id; }, cancelAnimationFrame: key => frames.delete(key),
        Image: class { constructor() { images.push(this); this.naturalWidth = 100; this.complete = false; } }
    });
    vm.runInContext(outputFiles[0].text, context);
    const app = context.module.exports;
    app.modalState.draftBookmarks = rows.map(row => ({ id: row.dataset.id, name: row.dataset.id, url: 'https://example.test', icon: '' }));
    app.bindEditEvents();
    const child = (row, kind) => { const el = new Element(kind); el.parentNode = row; return el; };
    return { app, rows, list, base, next, badge, motion, images, timers, frames,
        remove: row => list.emit('click', { target: child(row, 'del-btn') }),
        reorder: row => list.emit('keydown', { target: child(row, 'drag-handle'), altKey: true, key: 'ArrowDown' }),
        flushFrames() { for (const [key, fn] of [...frames]) { frames.delete(key); fn(); } },
        flushTimers() { for (const [key, fn] of [...timers]) { timers.delete(key); fn(); } }
    };
}

test('删除只消费自身 opacity 事件；取消、减弱动效或事件缺失均删除占位行', () => {
    for (const mode of ['end', 'cancel', 'motion', 'timeout']) {
        const f = fixture(), row = f.rows[0];
        f.remove(row);
        assert.equal(f.app.modalState.draftBookmarks.length, 2);
        row.emit('transitionend', { propertyName: 'opacity', target: {} });
        row.emit('transitionend', { propertyName: 'color' });
        assert.equal(row.isConnected, true);
        if (mode === 'end') row.emit('transitionend', { propertyName: 'opacity' });
        if (mode === 'cancel') row.emit('transitioncancel', { propertyName: 'opacity' });
        if (mode === 'motion') { f.motion.matches = true; f.motion.emit('change'); }
        if (mode === 'timeout') f.flushTimers();
        assert.equal(row.isConnected, false, mode);
        assert.equal(f.badge.textContent, '已添加 2 项');
        assert.equal(f.timers.size, 0);
        assert.equal(f.motion.listeners.get('change').size, 0);
        assert.equal(row.listeners.get('transitionend').size, 0);
    }
});

test('排序忽略子元素和其他属性的事件，取消时清除样式及待执行 rAF', () => {
    for (const mode of ['cancel', 'motion', 'timeout', 'end']) {
        const f = fixture(), row = f.rows[0];
        f.reorder(row);
        assert.equal(f.rows.map(x => x.dataset.id).join(), 'b,a,c');
        assert.equal(f.app.modalState.draftBookmarks.map(x => x.id).join(), 'b,a,c');
        row.emit('transitionend', { propertyName: 'transform', target: {} });
        row.emit('transitionend', { propertyName: 'background-color' });
        assert.match(row.style.transform, /translate3d/);
        if (mode === 'motion') { f.motion.matches = true; f.motion.emit('change'); }
        if (mode === 'cancel') row.emit('transitioncancel', { propertyName: 'transform' });
        if (mode === 'end') row.emit('transitionend', { propertyName: 'transform' });
        if (mode === 'timeout') f.flushTimers();
        f.flushFrames();
        assert.equal(row.style.transform, '', mode);
        assert.equal(row.style.transition, '', mode);
        f.flushTimers();
        assert.equal(f.motion.listeners.get('change').size, 0);
    }
});

test('新排序和删除接管旧 FLIP，旧收尾不能清除新动效', () => {
    const f = fixture(), row = f.rows[0];
    f.reorder(row);
    const oldTimers = [...f.timers.values()];
    f.reorder(row);
    f.flushFrames();
    oldTimers.forEach(fn => fn());
    assert.match(row.style.transition, /transform/);
    f.remove(row);
    f.flushFrames();
    assert.equal(row.style.opacity, '0');
    assert.match(row.style.transform, /scale/);
    row.emit('transitioncancel', { propertyName: 'opacity' });
    assert.equal(row.isConnected, false);
    f.flushTimers();
    assert.equal(f.frames.size, 0);
    assert.equal(f.motion.listeners.get('change').size, 0);
});

test('新图片加载或解码失败不阻断旧淡入的 rAF、计时器及图层收尾', async () => {
    for (const beforeFrame of [true, false]) {
        for (const decodeFailure of [true, false]) {
            const f = fixture();
            f.app.applyWallpaper('./wallpapers/bg1.avif', true);
            await f.images[0].onload();
            if (!beforeFrame) f.flushFrames();
            f.app.applyWallpaper('./wallpapers/bg2.avif', true);
            if (decodeFailure) {
                f.images[1].decode = async () => { throw new Error('broken'); };
                await f.images[1].onload();
            } else f.images[1].onerror();
            f.flushFrames(); f.flushTimers();
            assert.equal(f.base.style.backgroundImage, 'url("./wallpapers/bg1.avif")');
            assert.equal(f.next.style.opacity, '0');
            assert.equal(f.next.classList.contains('is-crossfading'), false);
            assert.equal(f.timers.size, 0);
        }
    }
});

test('较新壁纸完成后，旧淡入回调不能覆盖它', async () => {
    const f = fixture();
    f.app.applyWallpaper('./wallpapers/bg1.avif', true);
    await f.images[0].onload(); f.flushFrames();
    const oldTimer = [...f.timers.values()][0];
    f.app.applyWallpaper('./wallpapers/bg2.avif', false);
    await f.images[1].onload();
    oldTimer(); f.flushFrames(); f.flushTimers();
    assert.equal(f.base.style.backgroundImage, 'url("./wallpapers/bg2.avif")');
    assert.equal(f.next.classList.contains('is-crossfading'), false);
});

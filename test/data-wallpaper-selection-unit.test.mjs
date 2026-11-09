/** 无浏览器：真实选择与渲染链路，仅替换图片、IDB、外壳主题和 DOM 边界。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import vm from 'node:vm';

const { outputFiles } = await build({
    stdin: { contents: `export * from './src/js/modules/wallpaper.js';
        export {state,modalState} from './src/js/state/store.js';
        export {backgrounds} from './src/js/config/constants.js';`, resolveDir: process.cwd() },
    bundle: true, write: false, format: 'cjs', platform: 'node',
    plugins: [{ name: 'browser-boundaries', setup(b) {
        b.onLoad({ filter: /utils\/idb\.js$/ }, () => ({ contents: `
            export async function getWallpaperSelectionDB(){if(db.readGate) await db.readGate;return db.value}
            export async function setWallpaperSelectionDB(selection){
                db.attempts++; if(db.gate) await db.gate;
                if(db.fail) return false;
                db.value=selection; db.writes++; return true;
            }` }));
        b.onLoad({ filter: /core\/theme-engine\.js$/ }, () => ({ contents:
            'export function setWallpaperTheme(){};export function updateGlassTint(){};export function sampleCustomWallpaperTheme(){};export function syncWallpaperTheme(){};' }));
        b.onLoad({ filter: /core\/dialogs\.js$/ }, () => ({ contents:
            'export function showConfirm(message){messages.push(message)}' }));
    } }]
});

function fixture() {
    class Element {
        isConnected = true; style = {};
        constructor() {
            const values = new Set();
            this.classList = { add: x => values.add(x), remove: x => values.delete(x), contains: x => values.has(x) };
        }
    }
    const base = new Element(), next = new Element(), images = [], messages = [];
    const storage = new Map(), metrics = { storageWrites: 0, decodes: 0 };
    const db = { value: null, writes: 0, attempts: 0, fail: false, gate: null };
    const fades = [];
    next.animate = () => {
        const { promise, resolve, reject } = Promise.withResolvers();
        fades.push(resolve);
        return { finished: promise, cancel: () => reject(new Error('cancelled')) };
    };
    const context = vm.createContext({
        module: { exports: {} }, console, Element, db, messages,
        window: { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
        document: { getElementById: key => ({ bgLayer: base, bgLayerNext: next })[key] ?? null },
        localStorage: { getItem: key => storage.get(key) ?? null,
            setItem(key, value) { metrics.storageWrites++; storage.set(key, value); },
            removeItem(key) { metrics.storageWrites++; storage.delete(key); } },
        Image: class {
            naturalWidth = 100; complete = false;
            constructor() { images.push(this); }
            async decode() {
                metrics.decodes++;
                if (this.decodeGate) await this.decodeGate;
                if (this.broken) throw new Error('Decode failed');
            }
        }
    });
    vm.runInContext(outputFiles[0].text, context);
    return { app: context.module.exports, images, db, metrics, messages, base, next,
        async selectPreset(url) {
            const before = images.length;
            const pending = context.module.exports.selectWallpaper(url);
            if (images.length > before) await images.at(-1).onload();
            return pending;
        },
        async settleFade() {
            fades.splice(0).forEach(finish => finish());
            await Promise.resolve();
        }
    };
}
const url = 'https://wallpaper.example/image.png';
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('同一网络壁纸只创建和解码一张图片，预览、渲染及并发保存共用结果', async () => {
    const f = fixture();
    let release;
    f.db.gate = new Promise(resolve => { release = resolve; });
    const first = f.app.selectWallpaper(url);
    assert.equal(f.app.selectWallpaper(url), first);
    assert.equal(f.images.length, 1);
    await f.images[0].onload();
    await drain();
    assert.equal(f.app.selectWallpaper(url), first, '落盘期间也应复用原任务');
    assert.equal(f.metrics.decodes, 1);
    assert.equal(f.images.length, 1, '正式渲染不得重新创建图片');
    release();
    assert.equal(await first, true);
    await f.settleFade();
    const storageWrites = f.metrics.storageWrites;
    assert.equal(await f.app.selectWallpaper(url), true);
    assert.equal(f.images.length, 1);
    assert.equal(f.metrics.decodes, 1);
    assert.equal(f.db.attempts, 1);
    assert.equal(f.metrics.storageWrites, storageWrites);
    assert.equal(f.next.classList.contains('is-crossfading'), false, '已显示的图片不重播淡入');
});

test('重复预设选择跳过 IDB 与轻量提示写入，首次默认选择仍会落盘', async () => {
    const f = fixture();
    assert.equal(await f.selectPreset(f.app.backgrounds[0]), true);
    assert.equal(f.db.writes, 1, '内存默认值不能冒充已保存记录');
    const storageWrites = f.metrics.storageWrites;
    assert.equal(await f.selectPreset(f.app.backgrounds[0]), true);
    assert.equal(await f.selectPreset(null), true);
    assert.equal(f.db.attempts, 1);
    assert.equal(f.metrics.storageWrites, storageWrites);
    await f.selectPreset(f.app.backgrounds[3]);
    assert.equal(f.db.writes, 2);
    assert.equal(f.db.value.bg, 3);
});

test('其他标签改写后再次选择会重新保存，不错误命中内存去重', async () => {
    const f = fixture();
    await f.selectPreset(f.app.backgrounds[2]);
    f.db.value = { wallpaper: null, bg: 4 };
    await f.selectPreset(f.app.backgrounds[2]);
    assert.equal(f.db.writes, 2);
    assert.equal(f.db.value.bg, 2);
});

test('网络或解码失败释放任务，重试能重新准备并保存', async () => {
    for (const decodeFailure of [false, true]) {
        const f = fixture();
        const failed = f.app.selectWallpaper(url);
        if (decodeFailure) { f.images[0].broken = true; await f.images[0].onload(); }
        else f.images[0].onerror();
        assert.equal(await failed, false);
        assert.equal(f.db.attempts, 0);
        const retry = f.app.selectWallpaper(url);
        assert.equal(f.images.length, 2);
        await f.images[1].onload();
        assert.equal(await retry, true);
        assert.equal(f.db.writes, 1);
        assert.equal(await f.app.flushWallpaperSelection(), true);
    }
});

test('存储失败可重试；重试复用已准备的网络图片', async () => {
    const f = fixture(); f.db.fail = true;
    const first = f.app.selectWallpaper(url);
    await f.images[0].onload();
    assert.equal(await first, false);
    assert.equal(f.db.writes, 0);
    f.db.fail = false;
    assert.equal(await f.app.selectWallpaper(url), true);
    assert.equal(f.images.filter(img => img.src === url).length, 1);
    assert.equal(f.db.attempts, 2);
    assert.equal(f.db.writes, 1);
});

test('旧网络图片解码迟到或被重置，不触发渲染或持久化', async () => {
    const f = fixture(); let release;
    const first = f.app.selectWallpaper(url);
    f.images[0].decodeGate = new Promise(resolve => { release = resolve; });
    const loading = f.images[0].onload();
    await f.selectPreset(f.app.backgrounds[2]);
    assert.equal(await first, false);
    release(); await loading; await drain();
    await f.settleFade();
    assert.equal(f.db.value.bg, 2);
    assert.equal(f.db.writes, 1);
    assert.match(f.base.style.backgroundImage, /bg3\.avif/);
    const cancelled = f.app.selectWallpaper(url);
    await f.app.clearCustomWallpaper();
    assert.equal(await cancelled, false);
    assert.equal(f.messages.length, 0);
});

test('预设加载失败保留此前记录，恢复后可以重试', async () => {
    const f = fixture();
    await f.selectPreset(f.app.backgrounds[1]);
    const before = JSON.stringify(f.db.value);
    const failed = f.app.selectWallpaper(f.app.backgrounds[7]);
    f.images.at(-1).onerror();
    assert.equal(await failed, false);
    assert.equal(JSON.stringify(f.db.value), before);
    assert.equal(f.app.state.bg, 1);
    assert.equal(await f.selectPreset(f.app.backgrounds[7]), true);
    assert.equal(f.db.value.bg, 7);
});

test('设置打开取消仍在准备的快捷键选择，并等待已开始的写入', async () => {
    for (const phase of ['reading', 'loading', 'writing']) {
        const f = fixture();
        let release;
        f.db[phase === 'reading' ? 'readGate' : 'gate'] = new Promise(resolve => { release = resolve; });
        const live = f.app.switchBg();
        await drain();
        const load = f.images[0]?.onload;
        if (phase === 'writing') {
            await load();
            await drain();
            assert.equal(f.db.attempts, 1);
        }

        f.app.modalState.phase = 'opening';
        let opened = false;
        const draft = f.app.prepareWallpaperDraft(() => true).then(url => {
            opened = true;
            return url;
        });
        await drain();
        if (phase === 'writing') assert.equal(opened, false);
        release();
        const expected = f.app.backgrounds[phase === 'writing' ? 1 : 0];
        assert.equal(await draft, expected);
        assert.equal(await live, phase === 'writing');
        if (phase === 'loading') await load();
        if (phase === 'reading') assert.equal(f.images.length, 0);
        assert.equal(f.app.modalState.draftWallpaper, null);
        assert.equal(f.app.getCommittedWallpaperUrl(), expected);
        assert.equal(f.db.writes, phase === 'writing' ? 1 : 0);
    }
});

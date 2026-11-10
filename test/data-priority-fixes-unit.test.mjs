/** 无浏览器：执行真实业务模块，仅替换网络、DOM、文件读取与 IDB 边界。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';

const { outputFiles } = await build({
    stdin: { contents: `export * from './src/js/modules/weather.js';
        export * from './src/js/modules/wallpaper.js';
        export {state, modalState} from './src/js/state/store.js';
        export {CONFIG, backgrounds} from './src/js/config/constants.js';`, resolveDir: process.cwd() },
    bundle: true, write: false, format: 'cjs', platform: 'node',
    plugins: [{ name: 'browser-boundaries', setup(builder) {
        builder.onLoad({ filter: /utils\/idb\.js$/ }, () => ({ contents: `
            export async function getWallpaperSelectionDB(){return writes.at(-1) || null}
            export async function setWallpaperSelectionDB(selection){writes.push(selection);return true}
        ` }));
        builder.onLoad({ filter: /core\/wallpaper-renderer\.js$/ }, () => ({
            contents: `export function applyWallpaper(url){rendered.push(url)}
                export function getPreparedWallpaperImage(){return null}
                export function setWallpaperDimming(){}
                export function captureWallpaperFrame(){return null}
                export function restoreWallpaperFrame(){}`
        }));
        builder.onLoad({ filter: /core\/dialogs\.js$/ }, () => ({
            contents: 'export function showConfirm(message){messages.push(message)}'
        }));
    } }]
});

function fixture() {
    const timers = new Map(), readers = [], images = [], writes = [], rendered = [], messages = [];
    let timerId = 0, htmlWrites = 0, canvasCount = 0;
    const weatherParts = new Map();
    const popover = {
        innerHTML: '',
        querySelector(selector) {
            if (!weatherParts.has(selector)) {
                let html = '';
                weatherParts.set(selector, {
                    get innerHTML() { return html; },
                    set innerHTML(value) {
                        html = value;
                        if (selector === '[data-weather-forecast]') htmlWrites++;
                    }
                });
            }
            return weatherParts.get(selector);
        }
    };
    const storage = new Map(), wallpaperError = { textContent: '' };
    class Reader {
        static LOADING = 1;
        constructor() { readers.push(this); this.readyState = 0; }
        readAsDataURL() { this.readyState = Reader.LOADING; }
        abort() { this.readyState = 2; this.onabort?.(); }
        complete(value) { this.readyState = 2; this.onload?.({ target: { result: value } }); }
    }
    const context = vm.createContext({
        module: { exports: {} }, console, URL, AbortController, AbortSignal, DOMException,
        Element: class {}, FileReader: Reader,
        Image: class {
            constructor() { this.width = 100; this.height = 80; }
            set src(value) {
                if (value.startsWith('./') || value.startsWith('data:image/jpeg')) {
                    Promise.resolve().then(() => this.onload?.());
                } else if (value) images.push(this);
            }
        },
        localStorage: { getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
        document: {
            hidden: false,
            getElementById: key => ({ weatherPopover: popover, wallpaperError })[key] ?? null,
            createElement(tag) {
                assert.equal(tag, 'canvas');
                const number = ++canvasCount;
                return { getContext: () => ({ drawImage() {}, clearRect() {} }),
                    toDataURL: () => `data:image/jpeg;base64,upload${number}` };
            }
        },
        setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; },
        clearTimeout: id => timers.delete(id), writes, rendered, messages
    });
    vm.runInContext(outputFiles[0].text, context);
    const app = context.module.exports;
    return { context, app, timers, readers, images, writes, rendered, messages, wallpaperError,
        get html() { return Array.from(weatherParts.values(), part => part.innerHTML + (part.textContent ?? '')).join(''); }, get htmlWrites() { return htmlWrites; } };
}
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('首次定位失败不请求默认城市天气，旧版兜底缓存也不能复用', async () => {
    for (const legacyFallback of [false, true]) {
        const f = fixture(), { app } = f;
        if (legacyFallback) {
            const location = { name: '上海', lat: 31.230, lon: 121.473, isFallback: true, timestamp: Date.now() };
            f.context.localStorage.setItem(app.CONFIG.KEYS.WEATHER_LOC, JSON.stringify(location));
            f.context.localStorage.setItem(app.CONFIG.KEYS.WEATHER_CACHE,
                JSON.stringify({ location, timestamp: Date.now(), current: { temp: 20 }, daily: [] }));
        }
        const requests = [];
        f.context.fetch = async url => {
            requests.push(url);
            return { ok: false, status: 503 };
        };
        await app.updateWeather(false);
        assert.equal(requests.length, 2, '尝试两个定位服务');
        assert.ok(requests.every(url => !url.includes('/forecast?')));
        assert.equal(f.context.localStorage.getItem(app.CONFIG.KEYS.WEATHER_LOC), null);
        assert.equal(f.context.localStorage.getItem(app.CONFIG.KEYS.WEATHER_CACHE), null);
        assert.match(f.html, /weatherErrorRetryBtn/);
        assert.equal(app.isFetchingWeather(), false);
    }
});

test('强制重新定位失败后沿用成功位置，仍可获取新天气，包括真实定位到上海', async () => {
    for (const source of ['location', 'weather']) {
        const f = fixture(), { app } = f;
        const location = { name: '上海', lat: 31.230, lon: 121.473, timestamp: 1 };
        const key = source === 'location' ? app.CONFIG.KEYS.WEATHER_LOC : app.CONFIG.KEYS.WEATHER_CACHE;
        f.context.localStorage.setItem(key, JSON.stringify(source === 'location' ? location :
            { location, timestamp: 1, current: { temp: 20 }, daily: [] }));
        const requests = [];
        f.context.fetch = async url => {
            requests.push(url);
            return url.includes('/forecast?')
                ? { ok: true, json: async () => ({ current: { temperature_2m: 25, weather_code: 0 }, daily: {} }) }
                : { ok: false, status: 503 };
        };
        await app.updateWeather(true);
        const cache = JSON.parse(f.context.localStorage.getItem(app.CONFIG.KEYS.WEATHER_CACHE));
        assert.equal(requests.filter(url => url.includes('/forecast?')).length, 1);
        assert.equal(cache.location.lat, location.lat);
        assert.equal(cache.location.name, '上海');
        assert.equal(cache.current.temp, 25);
        assert.equal(app.isFetchingWeather(), false);
    }
});

test('旧地点预报失败时继续等待重新定位，并发布新地点预报', async () => {
    const f = fixture();
    const { app, context } = f;
    const old = { name: '旧地点', lat: 1, lon: 2, timestamp: 1 };
    context.localStorage.setItem(app.CONFIG.KEYS.WEATHER_LOC, JSON.stringify(old));
    context.localStorage.setItem(app.CONFIG.KEYS.WEATHER_CACHE, JSON.stringify({ location: old, timestamp: 1, current: { temp: 12 }, daily: [] }));
    let locate;
    const forecasts = [];
    context.fetch = async url => {
        if (url.includes('myip.ipip.net')) return { ok: false, status: 503 };
        if (url.includes('ipwho.is')) return new Promise(resolve => { locate = resolve; });
        const latitude = new URL(url).searchParams.get('latitude');
        forecasts.push(latitude);
        return latitude === '1' ? { ok: false, status: 503 }
            : { ok: true, json: async () => ({ current: { temperature_2m: 26, weather_code: 0 }, daily: {} }) };
    };
    const task = app.updateWeather();
    await drain();
    assert.equal(app.updateWeather(true), task);
    assert.deepEqual(forecasts, ['1']);
    locate({ ok: true, json: async () => ({ success: true, city: '新地点', latitude: 40, longitude: 50 }) });
    await task;
    assert.deepEqual(forecasts, ['1', '40']);
    const saved = JSON.parse(context.localStorage.getItem(app.CONFIG.KEYS.WEATHER_CACHE));
    assert.equal(saved.location.name, '新地点');
    assert.equal(saved.current.temp, 26);
    assert.equal(JSON.parse(context.localStorage.getItem(app.CONFIG.KEYS.WEATHER_LOC)).name, '新地点');
    assert.match(f.html, /新地点/);
});

test('新地点预报不等旧请求，失败后旧结果不更新缓存且唤醒会重试', async () => {
    const { app, context } = fixture();
    const { WEATHER_LOC, WEATHER_CACHE } = app.CONFIG.KEYS;
    const old = { name: '旧地点', lat: 1, lon: 2, timestamp: 1 };
    const cache = { location: old, timestamp: 1, current: { temp: 12 }, daily: [] };
    const read = key => JSON.parse(context.localStorage.getItem(key));
    const write = (key, value) => context.localStorage.setItem(key, JSON.stringify(value));
    const forecast = temp => ({ ok: true, json: async () => ({ current: { temperature_2m: temp }, daily: {} }) });
    write(WEATHER_LOC, old);
    write(WEATHER_CACHE, cache);
    const requests = [];
    let finishOld, oldSignal;
    context.fetch = async (url, { signal }) => {
        if (url.includes('myip.ipip.net')) return { ok: false, status: 503 };
        if (url.includes('ipwho.is')) {
            return { ok: true, json: async () => ({ success: true, city: '新地点', latitude: 40, longitude: 50 }) };
        }
        const latitude = new URL(url).searchParams.get('latitude');
        requests.push(latitude);
        if (latitude === '1') {
            oldSignal = signal;
            return new Promise(resolve => { finishOld = resolve; });
        }
        return requests.length === 2 ? { ok: false, status: 503 } : forecast(26);
    };

    const first = app.updateWeather();
    await new Promise(setImmediate);
    assert.deepEqual(requests, ['1', '40']);
    assert.equal(oldSignal.aborted, true);
    await first;
    finishOld(forecast(18));
    await drain();
    assert.deepEqual(read(WEATHER_CACHE), cache);
    assert.equal(read(WEATHER_LOC).name, '新地点');

    // 兼容旧版本曾写出的新鲜时间戳与错误地点组合。
    write(WEATHER_CACHE, { ...cache, timestamp: Date.now() });
    await app.updateWeather();
    assert.deepEqual(requests, ['1', '40', '40']);
    assert.equal(read(WEATHER_CACHE).location.name, '新地点');
    assert.equal(read(WEATHER_CACHE).current.temp, 26);
});

test('空天气响应保留上一次预报，下一次刷新仍能更新', async () => {
    const f = fixture(), { app, context } = f;
    const key = app.CONFIG.KEYS.WEATHER_CACHE;
    const location = { name: '测试地点', lat: 1, lon: 2, timestamp: Date.now() };
    const previous = JSON.stringify({ location, timestamp: 1, current: { temp: 21 }, daily: [] });
    context.localStorage.setItem(key, previous);
    let forecast = {};
    context.fetch = async url => url.includes('/forecast?')
        ? { ok: true, json: async () => forecast } : { ok: false, status: 503 };

    for (const invalid of [{}, { current: { is_day: 1 }, daily: { time: ['2026-11-10'] } }]) {
        forecast = invalid;
        await app.updateWeather(true);
        assert.equal(context.localStorage.getItem(key), previous);
        assert.match(f.html, /21/);
    }
    forecast = { current: { temperature_2m: 0 } };
    await app.updateWeather(true);
    assert.equal(JSON.parse(context.localStorage.getItem(key)).current.temp, 0);
});

test('已落盘的空天气缓存即使在有效期内也会重新请求', async () => {
    const { app, context } = fixture();
    const { WEATHER_CACHE, WEATHER_LOC } = app.CONFIG.KEYS;
    const timestamp = Date.now();
    const location = { name: '测试地点', lat: 0, lon: 2, timestamp };
    context.localStorage.setItem(WEATHER_LOC, JSON.stringify(location));
    context.localStorage.setItem(WEATHER_CACHE, JSON.stringify({ location, timestamp, current: { icon: '🌡️' }, daily: [] }));
    let calls = 0;
    context.fetch = async () => {
        calls++;
        return { ok: true, json: async () => ({current:{temperature_2m:0}}) };
    };
    await app.updateWeather();
    assert.equal(calls, 1);
    assert.equal(JSON.parse(context.localStorage.getItem(WEATHER_CACHE)).current.temp, 0);
});

test('天气正文超时结束共享刷新任务，随后可重新刷新', async () => {
    const f = fixture(), { app } = f;
    const location = { lat: 31, lon: 121, name: '测试', timestamp: Date.now() };
    f.context.localStorage.setItem(app.CONFIG.KEYS.WEATHER_LOC, JSON.stringify(location));
    f.context.localStorage.setItem(app.CONFIG.KEYS.WEATHER_CACHE,
        JSON.stringify({ timestamp: 1, current: { temp: 20 }, location, daily: [] }));
    let calls = 0, signal;
    f.context.fetch = async (url, options) => {
        calls++; signal = options.signal;
        return { ok: true, json: () => new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        }) };
    };
    const pending = app.updateWeather();
    assert.equal(app.updateWeather(true), pending);
    await drain();
    assert.equal(f.timers.size, 1, '收到响应头后仍须保留正文读取的超时');
    [...f.timers.values()][0].fn();
    await pending;
    assert.equal(signal.aborted, true);
    assert.equal(f.timers.size, 0);
    assert.equal(app.isFetchingWeather(), false);
    f.context.fetch = async () => { calls++; return { ok: true, json: async () => ({ current: { temperature_2m: 27 } }) }; };
    await app.updateWeather();
    assert.equal(calls, 2);
    assert.equal(app.isFetchingWeather(), false);
    assert.equal(JSON.parse(f.context.localStorage.getItem(app.CONFIG.KEYS.WEATHER_CACHE)).current.temp, 27);
    assert.equal(f.timers.size, 0);
    f.context.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(app.fetchWeatherForecast(location), /HTTP 503/);
    assert.equal(f.timers.size, 0);
});

test('有效天气缓存时间字段直接渲染，不发起网络请求', async () => {
    const f = fixture(), { app } = f;
    const midday = new Date(2026, 9, 31, 12).getTime();
    f.context.Date = class extends Date {
        constructor(...args) { super(...(args.length ? args : [midday])); }
        static now() { return midday; }
    };
    f.context.localStorage.setItem(app.CONFIG.KEYS.WEATHER_CACHE, JSON.stringify({
        timestamp: midday, location: { name: '测试' },
        current: { temp: 20, sunriseToday: '05:35', sunsetToday: '18:59' }, daily: []
    }));
    f.context.fetch = () => { throw new Error('有效缓存不应联网'); };
    await app.updateWeather();
    assert.match(f.html, /18:59/);
    assert.equal(app.isFetchingWeather(), false);
});

test('预报图标或描述独立变化更新界面，相同内容仍复用', () => {
    const f = fixture();
    const data = { current: { temp: 20, icon: '☀️' }, location: { name: '测试' },
        daily: [{ label: '明天', icon: '☀️', text: '晴', tempMin: 10, tempMax: 20 }] };
    f.app.renderWeatherPopover(data);
    data.daily[0].icon = '🌧️';
    f.app.renderWeatherPopover(data);
    assert.equal(f.htmlWrites, 2);
    assert.match(f.html, /rain\.svg/);
    data.daily[0].text = '小雨';
    f.app.renderWeatherPopover(data);
    assert.equal(f.htmlWrites, 3);
    assert.match(f.html, /小雨/);
    f.app.renderWeatherPopover(structuredClone(data));
    assert.equal(f.htmlWrites, 3);
});

test('读取中的旧上传不能覆盖后选预设，保存等待新上传处理', async () => {
    const f = fixture(), { app } = f;
    app.modalState.phase = 'editing';
    app.uploadWallpaper({ type: 'image/png' });
    const lateRead = f.readers[0].onload;
    await app.previewDraftWallpaper(app.backgrounds[2]);
    lateRead({ target: { result: 'data:image/png;base64,old' } });
    await drain();
    assert.equal(f.readers[0].readyState, 2);
    assert.equal(f.images.length, 0);
    assert.equal(app.modalState.draftWallpaper, app.backgrounds[2]);
    assert.equal(f.writes.length, 0);
    app.uploadWallpaper({ type: 'image/png' });
    let saved = false;
    const saving = app.flushWallpaperSelection().then(result => { saved = result; });
    await drain();
    assert.equal(saved, false);
    f.readers[1].complete('data:image/png;base64,new');
    f.images[0].onload();
    await saving;
    assert.equal(saved, true);
    assert.equal(app.modalState.draftWallpaper, 'data:image/jpeg;base64,upload1');
    assert.equal(f.writes.length, 0);
});

test('解码中的旧上传、旧错误回调不能覆盖新上传或重置', async () => {
    const f = fixture(), { app } = f;
    app.modalState.phase = 'editing';
    app.uploadWallpaper({ type: 'image/png' });
    f.readers[0].complete('data:image/png;base64,old');
    const oldLoad = f.images[0].onload, oldError = f.images[0].onerror;
    app.uploadWallpaper({ type: 'image/png' });
    f.readers[1].complete('data:image/png;base64,new');
    f.images[1].onload();
    await app.flushWallpaperSelection();
    oldLoad(); oldError();
    await drain();
    assert.equal(f.writes.length, 0);
    assert.equal(app.modalState.draftWallpaper, 'data:image/jpeg;base64,upload1');
    app.uploadWallpaper({ type: 'image/png' });
    const lateRead = f.readers[2].onload;
    await app.clearCustomWallpaper();
    app.revertDraftWallpaper();
    lateRead({ target: { result: 'data:image/png;base64,late' } });
    assert.equal(await app.flushWallpaperSelection(), true);
    assert.equal(app.state.customWallpaper, null);
    assert.equal(f.messages.length, 0);
});

test('读取或压缩失败结束保存等待，重新选择可恢复', async () => {
    const f = fixture(), { app } = f;
    app.modalState.phase = 'editing';
    app.uploadWallpaper({ type: 'image/png' });
    f.readers[0].onerror();
    assert.equal(await app.flushWallpaperSelection(), false);
    assert.equal(f.writes.length, 0);
    assert.notEqual(f.wallpaperError.textContent, '');
    assert.equal(f.messages.length, 0);
    app.uploadWallpaper({ type: 'image/png' });
    f.readers[1].complete('data:image/png;base64,new');
    const create = f.context.document.createElement;
    f.context.document.createElement = () => { throw new Error('canvas unavailable'); };
    f.images[0].onload();
    assert.equal(await app.flushWallpaperSelection(), false);
    assert.equal(f.writes.length, 0);
    f.context.document.createElement = create;
    await app.previewDraftWallpaper(app.backgrounds[1]);
    assert.equal(await app.flushWallpaperSelection(), true);
    assert.equal(app.modalState.draftWallpaper, app.backgrounds[1]);
});

test('取消设置终止读取或处理中的上传，迟到回调不渲染或保存', async () => {
    for (const phase of ['read', 'image']) {
        const f = fixture(), { app } = f;
        app.modalState.phase = 'editing';
        app.state.bg = 2;
        app.uploadWallpaper({ type:'image/png' });
        let late;
        if (phase === 'read') {
            const callback = f.readers[0].onload;
            late = () => callback({target:{result:'data:image/png;base64,late'}});
        } else {
            f.readers[0].complete('data:image/png;base64,late');
            late = f.images[0].onload;
        }
        app.revertDraftWallpaper();
        app.modalState.phase = 'closed';
        late();
        await app.flushWallpaperSelection();
        assert.equal(f.writes.length, 0, phase);
        assert.equal(f.rendered.at(-1), app.backgrounds[2], phase);
        assert.equal(f.messages.length, 0, phase);
        assert.equal(f.readers[0].readyState, 2, phase);
    }
});

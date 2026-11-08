import assert from 'node:assert/strict';
import { test } from 'node:test';
import { launchSession, waitFor } from './support/helpers.mjs';

test('壁纸主题采样与暗度处理', async () => {
  const { server, chrome, send, evalJS } = await launchSession();
  async function sample({ width, height, viewportWidth = width, viewportHeight = height, bands, mask = 0 }) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: false
    });
    await evalJS(`(() => {
      const canvas = document.createElement('canvas');
      canvas.width = ${width}; canvas.height = ${height};
      const ctx = canvas.getContext('2d');
      for (const band of ${JSON.stringify(bands)}) {
        ctx.fillStyle = band.color;
        ctx.fillRect(band.x, band.y, band.width, band.height);
      }
      ${mask === null ? "localStorage.removeItem('maskOpacity');" : `localStorage.setItem('maskOpacity', ${JSON.stringify(JSON.stringify(mask))});`}
      localStorage.removeItem('glass_tint_cache');
      applyWallpaper(canvas.toDataURL(), false);
    })()`);
    await waitFor(evalJS, "localStorage.getItem('glass_tint_cache') !== null");
    return evalJS(`({
      bright: document.documentElement.classList.contains('wallpaper-bright'),
      tint: document.documentElement.style.getPropertyValue('--glass-tint').split(',').map(Number)
    })`);
  }

  try {
    // 等初始壁纸解码完成，避免覆盖测试采样
    await waitFor(evalJS, 'getPreparedWallpaperImage(backgrounds[state.bg]) !== null');
    const gray = { width: 800, height: 800, bands: [{ x: 0, y: 0, width: 800, height: 800, color: 'rgb(150, 150, 150)' }] };
    assert.deepEqual(await sample(gray), { bright: true, tint: [150, 150, 150] }, '零遮罩不应误用默认暗度');
    for (const mask of [20, null, 'invalid']) {
      assert.deepEqual(await sample({ ...gray, mask }), { bright: false, tint: [140, 140, 140] }, '显式、缺省及非法暗度均正确处理');
    }
    const split = await sample({ width: 800, height: 800, bands: [
      { x: 0, y: 0, width: 800, height: 800, color: 'rgb(60, 80, 200)' },
      { x: 0, y: 0, width: 800, height: 200, color: 'white' }
    ] });
    assert.equal(split.bright, true, '顶栏保留顶部亮度采样');
    assert.ok(split.tint[2] > split.tint[0] + 70, '环境色应包含中央及下方蓝色区域');
    for (const portrait of [true, false]) {
      const width = portrait ? 1200 : 800, height = portrait ? 800 : 1200;
      const cropped = await sample({ width, height, viewportWidth: portrait ? 400 : 800, viewportHeight: portrait ? 800 : 400, bands: [
        { x: 0, y: 0, width, height, color: 'white' },
        { x: portrait ? 400 : 0, y: portrait ? 0 : 400, width: portrait ? 400 : 800, height: portrait ? 800 : 400, color: 'rgb(60, 100, 200)' }
      ] });
      assert.equal(cropped.bright, false, '顶部主题采样应排除被裁掉的白色区域');
      assert.ok(cropped.tint.every((value, i) => Math.abs(value - [60, 100, 200][i]) <= 2),
        '横纵向 cover 裁切均应排除不可见白色区域：' + cropped.tint);
    }
  } finally {
    await chrome.close();
    await server.close();
  }
});

test('启动壁纸撞上切屏时先显示，取色等待空闲且不会覆盖新壁纸', async () => {
  const { server, chrome, send, evalJS } = await launchSession();
  try {
    await waitFor(evalJS, 'getPreparedWallpaperImage(backgrounds[state.bg]) !== null');
    await evalJS(`(() => {
      const idle = window.requestIdleCallback;
      const decode = HTMLImageElement.prototype.decode;
      const reads = CanvasRenderingContext2D.prototype.getImageData;
      const probe = window.wallpaperProbe = { idle: [], reads: 0 };
      window.requestIdleCallback = (callback, options) => {
        if (options?.timeout !== 300) return idle.call(window, callback, options);
        return probe.idle.push(callback);
      };
      HTMLImageElement.prototype.decode = function() {
        if (this.src !== probe.url) return decode.call(this);
        return new Promise(resolve => { probe.releaseDecode = resolve; });
      };
      CanvasRenderingContext2D.prototype.getImageData = function(...args) {
        probe.reads++;
        return reads.apply(this, args);
      };
      probe.restore = async color => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        probe.url = canvas.toDataURL();
        probe.releaseDecode = null;
        await setWallpaperSelectionDB({ wallpaper: probe.url, bg: 0 });
        await restoreWallpaper();
      };
      localStorage.setItem('maskOpacity', '0');
    })()`);
    const finishDecodeDuringEntry = async color => {
      await evalJS(`wallpaperProbe.restore(${JSON.stringify(color)})`);
      await waitFor(evalJS, '!!wallpaperProbe.releaseDecode');
      assert.equal(await evalJS(`(async () => {
        switchToNav();
        wallpaperProbe.releaseDecode();
        await Promise.resolve();
        return isScreenTransitioning() && dom.bgLayer.style.backgroundImage.includes(wallpaperProbe.url);
      })()`), true);
    };
    await finishDecodeDuringEntry('rgb(80, 100, 160)');
    assert.deepEqual(await evalJS('[wallpaperProbe.reads, wallpaperProbe.idle.length]'), [0, 0]);
    await waitFor(evalJS, 'wallpaperProbe.idle.length === 1');
    assert.deepEqual(await evalJS(`(() => {
      switchToStart();
      wallpaperProbe.idle.shift()();
      return [isScreenTransitioning(), wallpaperProbe.reads];
    })()`), [true, 0]);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await waitFor(evalJS, 'wallpaperProbe.idle.length === 1');
    assert.deepEqual(await evalJS(`(() => {
      wallpaperProbe.idle.shift()();
      return [isScreenTransitioning(), wallpaperProbe.reads, JSON.parse(localStorage.getItem('glass_tint_cache'))];
    })()`), [false, 2, '80, 100, 160']);

    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await finishDecodeDuringEntry('rgb(180, 80, 120)');
    await evalJS("reconcileScreenState('nav', true)");
    await waitFor(evalJS, 'wallpaperProbe.idle.length === 1');
    assert.deepEqual(await evalJS(`(() => {
      applyWallpaper(backgrounds[1], false);
      wallpaperProbe.idle.shift()();
      return [wallpaperProbe.reads, document.documentElement.style.getPropertyValue('--glass-tint') === PRESET_TINTS[1]];
    })()`), [2, true]);
  } finally {
    await chrome.close();
    await server.close();
  }
});

test('壁纸解码、迟到结果隔离与上传压缩', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64');
  const { server, chrome, evalJS } = await launchSession(0, {
    '/decode.png': (req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(png);
    }
  });
  try {
    await waitFor(evalJS, 'typeof applyWallpaper === "function"');
    const result = await evalJS(`(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');
      const pending = new Map();
      const wait = async predicate => {
        const deadline = Date.now() + 3000;
        while (!predicate()) {
          if (Date.now() > deadline) throw new Error('Decode regression timed out');
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      };
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      const url = tag => location.origin + '/decode.png?' + tag;
      const showing = tag => dom.bgLayer.style.backgroundImage.includes('/decode.png?' + tag);
      try {
        Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: function() {
          return new Promise((resolve, reject) => pending.set(this.src, { resolve, reject }));
        } });
        const before = dom.bgLayer.style.backgroundImage;
        applyWallpaper(url('old'), false);
        await wait(() => pending.has(url('old')));
        const waitsForDecode = dom.bgLayer.style.backgroundImage === before;
        applyWallpaper(url('new'), false);
        await wait(() => pending.has(url('new')));
        pending.get(url('new')).resolve();
        await wait(() => showing('new'));
        pending.get(url('old')).resolve();
        await frame();
        const staleIgnored = showing('new');
        applyWallpaper(url('broken'), false);
        await wait(() => pending.has(url('broken')));
        pending.get(url('broken')).reject(new DOMException('Decode failed', 'EncodingError'));
        await frame();
        const failedKeepsCurrent = showing('new');
        delete HTMLImageElement.prototype.decode;
        applyWallpaper(url('fallback'), false);
        await wait(() => showing('fallback'));
        return { waitsForDecode, staleIgnored, failedKeepsCurrent, unsupportedFallback: showing('fallback') };
      } finally {
        Object.defineProperty(HTMLImageElement.prototype, 'decode', descriptor);
      }
    })()`);
    assert.equal(Object.values(result).every(Boolean), true, JSON.stringify(result));

    const uploadResult = await evalJS(`(async () => {
      const wait = async predicate => {
        const deadline = Date.now() + 5000;
        while (!predicate()) {
          if (Date.now() > deadline) throw new Error('Upload timeout');
          await new Promise(r => setTimeout(r, 20));
        }
      };
      await openEditModal();
      document.getElementById('tab-btn-appearance').click();
      const input = dom.uploadBgInput;
      const put = file => {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      put(new File(['x'], 'bad.txt', { type: 'text/plain' }));
      const invalidBlocked = OverlayStack.top()?.id === 'confirmModal';
      dom.confirmOkBtn.click();
      const source = document.createElement('canvas');
      source.width = 3000;
      source.height = 2000;
      source.getContext('2d').fillRect(0, 0, 3000, 2000);
      const blob = await new Promise(resolve => source.toBlob(resolve, 'image/png'));
      const original = HTMLCanvasElement.prototype.toDataURL;
      let compressed;
      HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
        compressed = { width: this.width, height: this.height, type, quality };
        return original.call(this, type, quality);
      };
      const before = state.customWallpaper;
      try {
        put(new File([blob], 'large.png', { type: 'image/png' }));
        await wait(() => modalState.draftWallpaper?.startsWith('data:image/jpeg'));
        const previewOnly = state.customWallpaper === before;
        await saveEditModal();
        const fit = compressed.width <= CONFIG.APPEARANCE.MAX_UPLOAD_WIDTH
          && compressed.height <= CONFIG.APPEARANCE.MAX_UPLOAD_HEIGHT
          && Math.abs(compressed.width / compressed.height - 1.5) < 0.01;
        return {
          invalidBlocked, previewOnly, fit, jpeg: compressed.type === 'image/jpeg',
          quality: compressed.quality === CONFIG.APPEARANCE.JPEG_QUALITY,
          persisted: state.customWallpaper?.startsWith('data:image/jpeg') &&
            (await getWallpaperSelectionDB())?.wallpaper === state.customWallpaper,
          inputCleared: input.value === ''
        };
      } finally {
        HTMLCanvasElement.prototype.toDataURL = original;
      }
    })()`);
    assert.equal(Object.values(uploadResult).every(Boolean), true, JSON.stringify(uploadResult));
  } finally {
    await chrome.close();
    await server.close();
  }
});

test('壁纸共享加载、图片复用与失败重试', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64');
  const { server, chrome, evalJS } = await launchSession(0, {
    '/reuse-wallpaper.png': (req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      res.end(png);
    }
  });
  try {
    await evalJS(`(() => {
      window.reuseDecodeDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');
      window.reuseSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      window.reuseLoads = [];
      window.reuseDecodes = [];
      window.reusePending = new Map();
      Object.defineProperty(HTMLImageElement.prototype, 'src', { ...reuseSrcDescriptor, set: function(value) {
        if (String(value).includes('/reuse-wallpaper.png')) reuseLoads.push(value);
        return reuseSrcDescriptor.set.call(this, value);
      } });
      Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: function() {
        if (!this.src.includes('/reuse-wallpaper.png')) return reuseDecodeDescriptor.value.call(this);
        reuseDecodes.push(this.src);
        return new Promise((resolve, reject) => reusePending.set(this.src, { resolve, reject }));
      } });
      window.reuseUrl = tag => location.origin + '/reuse-wallpaper.png?' + tag;
      applyWallpaper(reuseUrl('shared'), true);
      applyWallpaper(reuseUrl('shared'), false);
    })()`);
    await waitFor(evalJS, 'reusePending.has(reuseUrl("shared"))');
    assert.deepEqual(await evalJS('[reuseLoads.length, reuseDecodes.length]'), [1, 1]);
    await evalJS('reusePending.get(reuseUrl("shared")).resolve()');
    await waitFor(evalJS, 'dom.bgLayer.style.backgroundImage.includes("?shared")');
    assert.equal(await evalJS('dom.bgLayerNext.classList.contains("is-crossfading")'), false);
    assert.equal(await evalJS(`(() => {
      applyWallpaper(reuseUrl('shared'), true);
      applyWallpaper(reuseUrl('shared'), true);
      return reuseLoads.length === 1 && reuseDecodes.length === 1 && !dom.bgLayerNext.classList.contains('is-crossfading');
    })()`), true);

    await evalJS('applyWallpaper(reuseUrl("fade"), true)');
    await waitFor(evalJS, 'reusePending.has(reuseUrl("fade"))');
    await evalJS('reusePending.get(reuseUrl("fade")).resolve()');
    await waitFor(evalJS, 'dom.bgLayerNext.classList.contains("is-crossfading") && dom.bgLayerNext.style.opacity === "1"');
    await evalJS('applyWallpaper(reuseUrl("fade"), true)');
    await waitFor(evalJS, '!dom.bgLayerNext.classList.contains("is-crossfading")');
    assert.equal(await evalJS('dom.bgLayer.style.backgroundImage.includes("?fade")'), true);
    assert.equal(await evalJS('reuseDecodes.filter(url => url === reuseUrl("fade")).length'), 1);

    await evalJS('applyWallpaper(reuseUrl("retry"), false)');
    await waitFor(evalJS, 'reusePending.has(reuseUrl("retry"))');
    await evalJS('reusePending.get(reuseUrl("retry")).reject(new Error("decode failed"))');
    await waitFor(evalJS, 'dom.bgLayer.style.backgroundImage.includes("?fade")');
    await evalJS('new Promise(resolve => setTimeout(resolve, 0))');
    await evalJS('applyWallpaper(reuseUrl("retry"), false)');
    await waitFor(evalJS, 'reuseDecodes.filter(url => url === reuseUrl("retry")).length === 2');
    await evalJS('reusePending.get(reuseUrl("retry")).resolve()');
    await waitFor(evalJS, 'dom.bgLayer.style.backgroundImage.includes("?retry")');

    const fadeStart = await evalJS(`(async () => {
      const prepare = async url => {
        const image = new Image(); image.src = url; await image.decode(); return image;
      };
      const [base, next] = await Promise.all(backgrounds.slice(0, 2).map(prepare));
      applyWallpaper(backgrounds[0], false, base);
      applyWallpaper(backgrounds[1], true, next);
      return { base: dom.bgLayer.style.backgroundImage, opacity: dom.bgLayerNext.style.opacity };
    })()`);
    assert.match(fadeStart.base, /bg1\.avif/);
    assert.equal(fadeStart.opacity, '0');

    assert.equal(await evalJS(`(async () => {
      await commitWallpaperSelection(backgrounds[2]);
      const get = IDBObjectStore.prototype.get;
      let reads = 0;
      IDBObjectStore.prototype.get = function(key) {
        if (key === CONFIG.IDB.KEYS.SELECTION) reads++;
        return get.call(this, key);
      };
      try {
        await restoreWallpaper();
        return reads === 1 && state.bg === 2;
      } finally {
        IDBObjectStore.prototype.get = get;
      }
    })()`), true);
  } finally {
    try {
      await evalJS(`(() => {
        Object.defineProperty(HTMLImageElement.prototype, 'decode', reuseDecodeDescriptor);
        Object.defineProperty(HTMLImageElement.prototype, 'src', reuseSrcDescriptor);
      })()`);
    } finally {
      await chrome.close();
      await server.close();
    }
  }
});

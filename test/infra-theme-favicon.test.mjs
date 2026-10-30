import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { launchSession, waitFor, navigateAndWait } from './support/helpers.mjs';
import { test } from 'node:test';

await test("主题配置、图标回退与缓存驱逐", async () => {
    const require = createRequire(import.meta.url);
    const { injectThemeConfig } = require('../scripts/build.cjs');
    const template = '/* INJECT_THEME_CONFIG */\nglobalThis.result = { themes: PRESET_THEMES, tints: PRESET_TINTS };';
    const readConfig = path => {
      const context = {};
      vm.runInNewContext(injectThemeConfig(template, path), context);
      return JSON.parse(JSON.stringify(context.result));
    };
    const expected = readConfig();
    const fixtureDir = mkdtempSync(join(tmpdir(), 'glass-theme-config-'));
    try {
      const source = readFileSync(new URL('../src/js/config/themes.js', import.meta.url), 'utf8');
      const fixture = join(fixtureDir, 'themes.js');
      writeFileSync(fixture, source.replace('#ffffff', '#fefefe'));
      assert.equal(readConfig(fixture).themes[1].color, '#fefefe');
      writeFileSync(fixture, source.replace('#ffffff', '#ededed'));
      assert.equal(readConfig(fixture).themes[1].color, '#ededed');
      writeFileSync(fixture, source.replace('125, 140, 165', '</script><script>'));
      const safe = injectThemeConfig(template, fixture);
      assert.equal(safe.includes('</script>'), false);
      assert.equal(readConfig(fixture).tints[0], '</script><script>');
      assert.throws(() => injectThemeConfig(''), /必须出现一次/);
      assert.throws(() => injectThemeConfig(template + template), /必须出现一次/);
      console.log('✅ 配置变更立即进入首屏生成结果，重复调用不读旧缓存，script 边界安全');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }

    // 在 defer 应用执行前采样，避免运行时修正掩盖首屏配色错误。
    const built = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
    const probe = `<script>window.__headThemeProbe = {
  theme: window.__INITIAL_THEME__, tint: document.documentElement.style.getPropertyValue('--glass-tint'),
  color: document.documentElement.style.backgroundColor,
  bright: document.documentElement.classList.contains('wallpaper-bright')
};</script>`;
    const { server, chrome, send, evalJS } = await launchSession(0, { '/theme-probe.html': built.replace('</head>', probe + '</head>') });
    try {
      // 首屏探针使用独立 HTML 路由；绕过 SW 导航回退，确保每次读取探针页面。
      await send('Network.enable');
      await send('Network.setBypassServiceWorker', { bypass: true });
      for (const warm of [false, true]) {
        for (let index = 0; index < expected.themes.length; index++) {
          const token = `${warm}-${index}`;
          const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: `
        localStorage.clear(); localStorage.setItem('bg', '${index}');
        ${warm ? "localStorage.setItem('glass_theme_cache', JSON.stringify({isLight:false})); localStorage.setItem('glass_tint_cache', '1, 2, 3');" : ''}
      ` });
          await navigateAndWait(send, evalJS, `http://127.0.0.1:${server.port}/theme-probe.html?probe=${token}`,
            "!!window.__headThemeProbe && typeof window.handleIconError === 'function'");
          const actual = await evalJS(`({ head: __headThemeProbe, runtimeTheme: PRESET_THEMES[${index}], runtimeTint: PRESET_WALLPAPER_TINTS[${index}] })`);
          assert.deepEqual(actual.head.theme, expected.themes[index]);
          assert.deepEqual(actual.runtimeTheme, expected.themes[index]);
          assert.equal(actual.head.tint, expected.tints[index]);
          assert.equal(actual.runtimeTint, expected.tints[index]);
          assert.equal(actual.head.bright, expected.themes[index].isLight);
          assert.equal(actual.head.color, expected.themes[index].isLight ? 'rgb(255, 255, 255)' : 'rgb(11, 15, 25)');
          await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
        }
      }
      console.log('✅ 八张预设冷启动及有历史缓存启动，应用执行前底色、色调与运行时一致');

      const { identifier: customProbe } = await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.clear();
    localStorage.setItem('glass_wallpaper_meta', JSON.stringify({custom:true,bg:0}));
    localStorage.setItem('glass_theme_cache', JSON.stringify({isLight:true}));
    localStorage.setItem('glass_tint_cache', '1, 2, 3');
  ` });
      await navigateAndWait(send, evalJS, `http://127.0.0.1:${server.port}/theme-probe.html?probe=custom-meta`,
        "!!window.__headThemeProbe && typeof window.handleIconError === 'function'");
      const custom = await evalJS('({head:__headThemeProbe, preload:__PRELOADED_BG__, hasLink:!!document.getElementById("preloadWallpaper")})');
      assert.equal(custom.head.theme.isLight, true);
      assert.equal(custom.head.color, 'rgb(255, 255, 255)');
      assert.equal(custom.head.tint, '1, 2, 3');
      assert.equal(custom.preload, '');
      assert.equal(custom.hasLink, false);
      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier:customProbe });
      await waitFor(evalJS, 'typeof handleIconError === "function"');
      console.log('✅ IDB 自定义壁纸首屏恢复主题提示，不预加载默认壁纸或空 URL');

      const icons = await evalJS(`(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'caches');
    const deleted = [];
    Object.defineProperty(window, 'caches', { configurable:true, value:{open:async () => ({delete:async url => deleted.push(url)})} });
    try {
      const results = [];
      for (const edit of [false, true]) {
        const handler = edit ? handleEditIconError : handleIconError;
        const box = document.createElement('div'); box.className = 'edit-favicon-box';
        const img = document.createElement('img');
        img.src = location.origin + '/missing-primary.png'; img.dataset.url = 'https://example.com';
        img.dataset.initial = '<'; img.dataset.md = '1'; box.appendChild(img);
        handler(img); const fallback = img.src;
        const retried = img.dataset.fallback === '1' && box.contains(img) && fallback.includes('domain=example.com&sz=128');
        handler(img); const finalHTML = box.innerHTML;
        handler(img);
        results.push({ retried, failed:img.dataset.failed === '1', badge:box.textContent === '<',
          stable:box.innerHTML === finalHTML, escaped:!box.querySelector('script'),
          style:edit ? !!box.querySelector('.edit-favicon-initial') : box.classList.contains('text-xs') });
        const noRetry = document.createElement('img'); noRetry.src = location.origin + '/broken.png'; noRetry.dataset.url = '#';
        box.replaceChildren(noRetry); handler(noRetry);
        results.at(-1).noFallback = noRetry.dataset.failed === '1' && !noRetry.dataset.fallback;
        const already = document.createElement('img'); already.src = fallback; already.dataset.url = 'https://example.com';
        box.replaceChildren(already); handler(already);
        results.at(-1).alreadyFallback = already.dataset.failed === '1' && !already.dataset.fallback;
        handler(null);
      }
      await Promise.resolve(); await Promise.resolve();
      return {results, deleted};
    } finally {
      if (descriptor) Object.defineProperty(window, 'caches', descriptor); else delete window.caches;
    }
  })()`);
      for (const result of icons.results) assert.equal(Object.values(result).every(Boolean), true, JSON.stringify(result));
      assert.equal(icons.deleted.length, 8);
      assert.equal(icons.deleted.filter(url => url.endsWith('/missing-primary.png')).length, 2);
      console.log('✅ 两类图标一次重试、最终徽章、重复回调、无备用地址及缓存驱逐符合契约');
    } finally {
      await chrome.close();
      await server.close();
    }
});

await test("Service Worker 下直接导航到应用图标", async () => {
    const { server, chrome, send, evalJS } = await launchSession();
    const origin = `http://127.0.0.1:${server.port}`;
    try {
      await evalJS('navigator.serviceWorker.ready.then(() => true)');
      await send('Page.reload');
      await waitFor(evalJS, '!!navigator.serviceWorker.controller && typeof openEditModal === "function"');
      for (const suffix of ['', '?v=icon-navigation']) {
        await navigateAndWait(send, evalJS, `${origin}/apple-touch-icon.png${suffix}`,
          'document.contentType === "image/png" && document.images[0]?.complete');
        const icon = await evalJS('({type:document.contentType,width:document.images[0].naturalWidth,height:document.images[0].naturalHeight})');
        assert.deepEqual(icon, { type: 'image/png', width: 180, height: 180 });
        await navigateAndWait(send, evalJS, origin + '/', 'typeof openEditModal === "function"');
      }
      await navigateAndWait(send, evalJS, `${origin}/icons/app/favicon.svg?v=icon-navigation`,
        'document.contentType === "image/svg+xml"');
      assert.equal(await evalJS('document.documentElement.localName'), 'svg');
      await navigateAndWait(send, evalJS, origin + '/offline-entry', 'typeof openEditModal === "function"');
      console.log('✅ SW 控制下直接导航到 PNG/SVG（含版本参数）返回图像，普通页面导航仍可回退主文档');
    } finally {
      await chrome.close();
      await server.close();
    }
});

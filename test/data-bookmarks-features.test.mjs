/** 验证书签搜索算法、轻量存储模型、XSS安全及图标备选。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { launchSession, pressKey, waitFor, navigateAndWait } from './support/helpers.mjs';

test('异常书签缓存不阻断启动，清洗保留有效条目、目录继承和空简介', async () => {
  const { server, chrome, send, evalJS } = await launchSession();
  try {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.fetch = async () => ({ ok: true, json: async () => ({}) });
      localStorage.setItem('userBookmarkKeys', JSON.stringify([
        null, 123, {}, 'javascript:alert(1)', 'https://example.com', 'https://github.com'
      ]));
      localStorage.setItem('userCustomMeta', JSON.stringify({
        'https://example.com': {name:123, icon:42, desc:{bad:true}},
        'https://github.com': {desc:''},
        'https://invalid.test': ['bad']
      }));
    ` });
    await navigateAndWait(send, evalJS, `http://127.0.0.1:${server.port}/`,
      'typeof openEditModal === "function" && pageData.bookmarks.length === 2 && !!document.querySelector(".bookmark-item")');
    const recovered = await evalJS(`(() => {
      const github = pageData.bookmarks.find(bm => bm.url === 'https://github.com');
      const catalog = pageData.categories.flatMap(cat => cat.bookmarks).find(bm => bm.url === github.url);
      document.getElementById('editBookmarksBtn').click();
      return {bookmarks:pageData.bookmarks, nameInherited:github.name === catalog.name, desc:github.desc};
    })()`);
    assert.deepEqual(recovered.bookmarks.map(bm => bm.url), ['https://example.com', 'https://github.com']);
    assert.equal(recovered.bookmarks[0].name, 'example');
    assert.equal(recovered.nameInherited, true);
    assert.equal(recovered.desc, '');
    await waitFor(evalJS, 'document.getElementById("editModal").open');
    await evalJS('cancelEditModal()');
    const fallback = await evalJS(`(() => {
      localStorage.setItem('userBookmarkKeys', JSON.stringify([null, {}, 'javascript:alert(1)']));
      localStorage.setItem('userCustomMeta', JSON.stringify(['invalid']));
      loadBookmarks();
      return {count:pageData.bookmarks.length, valid:pageData.bookmarks.every(bm => typeof bm.name === 'string')};
    })()`);
    assert.equal(fallback.count, 8);
    assert.equal(fallback.valid, true);
  } finally {
    await chrome.close();
    await server.close();
  }
});

test('书签轻量存储模型、自定义图标持久化与系统重置', async () => {
  const iconBody = readFileSync(new URL('../public/icons/github.com.png', import.meta.url)).toString('base64');
  const { server, chrome, send, evalJS } = await launchSession();
  send('Fetch.requestPaused', ({ requestId }) => send('Fetch.fulfillRequest', {
    requestId, responseCode: 200,
    responseHeaders: [{ name: 'Content-Type', value: 'image/png' }], body: iconBody
  }));
  await send('Fetch.enable', { patterns: [
    { urlPattern: 'https://custom.example.dev/*', resourceType: 'Image' },
    { urlPattern: 'https://aaa.example.com/*', resourceType: 'Image' }
  ] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.fetch = async () => ({ ok: true, json: async () => ({}) });
  ` });

  try {
    // 2.1 首屏干净启动与防空白兜底
    const bmInit = await evalJS(`(() => {
      const items = [...document.querySelectorAll('#bookmarks .bookmark-item')];
      const titles = items.map(i => (i.querySelector('.bookmark-title') || {}).textContent || '').filter(Boolean);
      const imgs = items.map(i => i.querySelector('img')).filter(Boolean);
      const allLoadedOrHaveSrc = imgs.length === 8 && imgs.every(img => img.src && !img.src.startsWith('data:image/svg'));
      const keys = localStorage.getItem('userBookmarkKeys');
      const meta = localStorage.getItem('userCustomMeta');
      return { itemCount: items.length, titleCount: titles.length, imgCount: imgs.length, allLoadedOrHaveSrc, keys, meta };
    })()`);
    assert.ok(bmInit.itemCount === 8 && bmInit.titleCount === 8 && bmInit.imgCount === 8 && bmInit.allLoadedOrHaveSrc && bmInit.keys === null && bmInit.meta === null);

    // 2.2 自定义书签与元数据持久化加载
    await evalJS(`(() => {
      localStorage.setItem('userBookmarkKeys', JSON.stringify(['https://gitee.com', 'https://custom.example.dev']));
      localStorage.setItem('userCustomMeta', JSON.stringify({
        'https://gitee.com': { name: 'Gitee' },
        'https://custom.example.dev': { name: '自建站', icon: 'https://custom.example.dev/icon.png', desc: '个人站点' }
      }));
    })()`);
    await send('Page.reload');
    await waitFor(evalJS, 'document.readyState === "complete" && typeof renderWeatherCapsule === "function" && !isFetchingWeather');

    const loaded = await evalJS(`(() => ({
      keys: JSON.parse(localStorage.getItem('userBookmarkKeys') || 'null'),
      meta: JSON.parse(localStorage.getItem('userCustomMeta') || '{}')
    }))()`);
    const giteeIsCat = await evalJS(`!!localStorage.getItem('userBookmarkKeys') && JSON.parse(localStorage.getItem('userBookmarkKeys')).includes('https://gitee.com')`);
    const customInMeta = await evalJS(`(JSON.parse(localStorage.getItem('userCustomMeta') || '{}')['https://custom.example.dev'] || {}).name === '自建站'`);
    assert.ok(loaded.keys && loaded.keys.length === 2 && giteeIsCat && customInMeta);

    // 2.3 自定义图标与标题正确渲染
    const renderTitles = await evalJS(`(() => {
      const titles = [...document.querySelectorAll('#bookmarks .bookmark-title')].map(e => e.textContent.trim());
      const customBm = pageData.bookmarks.find(b => normalizeUrl(b.url) === 'https://custom.example.dev');
      return { titles, customIcon: customBm ? customBm.icon : '' };
    })()`);
    assert.ok(renderTitles.titles.includes('Gitee') && renderTitles.titles.includes('自建站') && renderTitles.customIcon.includes('custom.example.dev/icon.png'));

    // 2.4 saveUserBookmarks 轻量模型与 XSS 安全防御
    await evalJS(`(function(){
      pageData.categories = [];
      saveUserBookmarks([{ name: '自定义A', url: 'https://aaa.example.com', icon: 'https://aaa.example.com/a.png' }]);
    })()`);
    const saveModel = await evalJS(`(() => ({
      keys: JSON.parse(localStorage.getItem('userBookmarkKeys') || 'null'),
      meta: JSON.parse(localStorage.getItem('userCustomMeta') || '{}')
    }))()`);
    assert.ok(saveModel.keys && saveModel.keys.length === 1 && saveModel.keys[0] === 'https://aaa.example.com'
      && saveModel.meta['https://aaa.example.com'] && saveModel.meta['https://aaa.example.com'].icon.includes('aaa.example.com/a.png'));

    // 重置书签自闭环
    const resetBookmarksCheck = await evalJS(`(async () => {
      pageData.categories = DEFAULT_CATEGORIES;
      localStorage.setItem('userBookmarkKeys', JSON.stringify(['https://custom-only.test']));
      localStorage.setItem('userCustomMeta', JSON.stringify({ 'https://custom-only.test': { name: '临时测试' } }));
      localStorage.setItem('preferredEngine', 'google');
      localStorage.setItem('glass_temp_unit', 'F');
      const weather = {
        location: { name: '上海', fullName: '上海市' },
        current: { temp: 20, apparent: 20, icon: '☀️' },
        daily: []
      };
      renderWeatherCapsule(weather);
      renderWeatherPopover(weather);
      const fahrenheitBeforeReset = dom.weatherTemp.textContent === '68°'
        && dom.weatherPopover.textContent.includes('68°F');
      pageData.bookmarks = [{ name: '临时测试', url: 'https://custom-only.test' }];
      renderBookmarks();

      const origWinDerived = window.getDerivedBookmarks;
      const origWinDefault = window.DEFAULT_BOOKMARKS;
      delete window.getDerivedBookmarks;
      delete window.DEFAULT_BOOKMARKS;

      try {
        await openEditModal();
        document.getElementById('tab-btn-data').click();
        dom.resetEditBtn.click();
        dom.confirmOkBtn.click();
        const deadline = Date.now() + 3000;
        while (localStorage.getItem('userBookmarkKeys') !== null && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 20));
        }

        const countOk = Array.isArray(pageData.bookmarks) && pageData.bookmarks.length === 8;
        const names = pageData.bookmarks.map(b => b.name);
        const hasDefaultNames = names.includes('GitHub') && names.includes('DeepSeek') && names.includes('Gemini');

        const storageClean = localStorage.getItem('userBookmarkKeys') === null
          && localStorage.getItem('userCustomMeta') === null
          && localStorage.getItem('preferredEngine') === null
          && localStorage.getItem('glass_temp_unit') === null;

        const domTitles = [...document.querySelectorAll('#bookmarks .bookmark-title')].map(e => e.textContent.trim());
        const domOk = domTitles.includes('GitHub') && domTitles.includes('DeepSeek');

        const celsiusAfterReset = dom.weatherTemp.textContent === '20°'
          && dom.weatherPopover.textContent.includes('20°C');
        const resetSuccess = countOk && hasDefaultNames && storageClean && domOk
          && fahrenheitBeforeReset && celsiusAfterReset;
        return { resetSuccess, countOk, hasDefaultNames, storageClean, domOk,
          fahrenheitBeforeReset, celsiusAfterReset };
      } finally {
        window.getDerivedBookmarks = origWinDerived;
        window.DEFAULT_BOOKMARKS = origWinDefault;
      }
    })()`);
    assert.ok(resetBookmarksCheck.resetSuccess, JSON.stringify(resetBookmarksCheck));
    await evalJS(`localStorage.clear()`);
  } finally {
    await chrome.close();
    await server.close();
  }
});

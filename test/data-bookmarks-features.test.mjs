/** 验证书签搜索算法、轻量存储模型、XSS安全及图标备选。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { launchSession, pressKey, waitFor, navigateAndWait } from './support/helpers.mjs';

test('书签分级模糊搜索算法 (精确/包含/三级梯队/简介降级/Damerau-Levenshtein纠错)', async () => {
  const { server, chrome, send, evalJS } = await launchSession();
  try {
    const searchAlgoCheck = await evalJS(`(() => {
      const originalBookmarks = pageData.bookmarks;
      const originalCategories = pageData.categories;
      try {
        // 1.1 精确匹配优先于简介匹配
        pageData.bookmarks = [
          { name: "代码托管平台", url: "https://hub.example.com", desc: "全球最大的 GitHub 开源平台" }
        ];
        pageData.categories = [
          { name: "开发编程", bookmarks: [{ name: "GitHub", url: "https://github.com", desc: "开源项目托管" }] }
        ];
        const res1 = getLocalBookmarkSuggestions("GitHub", 2);
        const exactNameOk = res1[0]?.name === 'GitHub' && res1[1]?.name === '代码托管平台';

        // 1.2 包含/前缀匹配优先于仅简介匹配
        pageData.bookmarks = [
          { name: "开源资讯网", url: "https://news.example.com", desc: "汇聚各类开源项目动态" },
          { name: "ChatGPT", url: "https://chatgpt.com", desc: "OpenAI 开发的人工智能对话模型" }
        ];
        pageData.categories = [
          { name: "AI 工具", bookmarks: [{ name: "AI 绘画助手", url: "https://ai-art.example.com", desc: "智能生图工具" }] }
        ];
        const res2 = getLocalBookmarkSuggestions("AI", 2);
        const subNameOk = res2[0]?.name === 'AI 绘画助手' && res2[1]?.name === 'ChatGPT';

        // 1.3 三级优先级梯队 (书签名 > URL > 简介)
        pageData.bookmarks = [
          { name: "资讯聚合", url: "https://info.example.com", desc: "收录各类 react 生态资源" },
          { name: "前端导航", url: "https://react-community.example.com", desc: "前端社区" },
          { name: "React 官方文档", url: "https://react.dev", desc: "用于构建 Web 界面" }
        ];
        pageData.categories = [];
        const res3 = getLocalBookmarkSuggestions("react", 3);
        const tierOk = res3[0]?.name === 'React 官方文档' && res3[1]?.name === '前端导航' && res3[2]?.name === '资讯聚合';

        // 1.4 简介中包含查询词兜底匹配
        pageData.bookmarks = [
          { name: "开发者门户", url: "https://dev.example.com", desc: "包含各种实用工具与开源技术" }
        ];
        const res4 = getLocalBookmarkSuggestions("技术", 1);
        const fallbackOk = res4[0]?.name === '开发者门户';

        // 1.5 Damerau-Levenshtein 拼写容错纠错匹配
        pageData.bookmarks = [
          { name: "GitHub", url: "https://github.com", desc: "全球最大的代码托管与开源协作平台" },
          { name: "Google", url: "https://google.com", desc: "全球领先的搜索引擎" }
        ];
        pageData.categories = [];
        const resFuzzy1 = getLocalBookmarkSuggestions("githbu", 2);
        const fuzzyNameOk = resFuzzy1[0]?.name === 'GitHub';

        const resFuzzy2 = getLocalBookmarkSuggestions("goolge", 2);
        const fuzzyPrefixOk = resFuzzy2[0]?.name === 'Google';

        // 1.6 纯符号/标点输入过滤拦截
        const resEmpty1 = getLocalBookmarkSuggestions("/", 5);
        const resEmpty2 = getLocalBookmarkSuggestions("///", 5);
        const punctFilterOk = resEmpty1.length === 0 && resEmpty2.length === 0;

        return { exactNameOk, subNameOk, tierOk, fallbackOk, fuzzyNameOk, fuzzyPrefixOk, punctFilterOk };
      } finally {
        pageData.bookmarks = originalBookmarks;
        pageData.categories = originalCategories;
      }
    })()`);

    assert.ok(searchAlgoCheck.exactNameOk);
    assert.ok(searchAlgoCheck.subNameOk);
    assert.ok(searchAlgoCheck.tierOk);
    assert.ok(searchAlgoCheck.fallbackOk);
    assert.ok(searchAlgoCheck.fuzzyNameOk);
    assert.ok(searchAlgoCheck.fuzzyPrefixOk);
    assert.ok(searchAlgoCheck.punctFilterOk);
  } finally {
    await chrome.close();
    await server.close();
  }
});

test('书签轻量存储模型、自定义图标持久化、XSS清洗与系统重置', async () => {
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
    await waitFor(evalJS, 'document.readyState === "complete" && typeof weatherNum === "function" && !isFetchingWeather');

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

    // 2.5 恶意 XSS 注入与转义安全防护
    const xssCheck = await evalJS(`(() => {
      const dirtyName = '<img src=x onerror="window.__xss_fired=true">测试XSS';
      const sanitizedName = escapeHtml(dirtyName);
      const dirtyUrl = 'javascript:alert(1)';
      const normalized = normalizeUrl(dirtyUrl);
      return {
        escaped: sanitizedName.includes('&lt;img') && !sanitizedName.includes('<img'),
        safeUrl: normalized.startsWith('https://')
      };
    })()`);
    assert.ok(xssCheck && xssCheck.escaped && xssCheck.safeUrl);

    // 2.6 重置书签自闭环
    const resetBookmarksCheck = await evalJS(`(async () => {
      pageData.categories = DEFAULT_CATEGORIES;
      localStorage.setItem('userBookmarkKeys', JSON.stringify(['https://custom-only.test']));
      localStorage.setItem('userCustomMeta', JSON.stringify({ 'https://custom-only.test': { name: '临时测试' } }));
      localStorage.setItem('preferredEngine', 'google');
      pageData.bookmarks = [{ name: '临时测试', url: 'https://custom-only.test' }];
      renderBookmarks();

      const origWinDerived = window.getDerivedBookmarks;
      const origWinDefault = window.DEFAULT_BOOKMARKS;
      delete window.getDerivedBookmarks;
      delete window.DEFAULT_BOOKMARKS;

      try {
        resetBookmarks();
        const okBtn = dom.confirmOkBtn;
        if (okBtn) okBtn.click();
        const deadline = Date.now() + 3000;
        while (localStorage.getItem('userBookmarkKeys') !== null && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 20));
        }

        const countOk = Array.isArray(pageData.bookmarks) && pageData.bookmarks.length === 8;
        const names = pageData.bookmarks.map(b => b.name);
        const hasDefaultNames = names.includes('GitHub') && names.includes('DeepSeek') && names.includes('Gemini');

        const storageClean = localStorage.getItem('userBookmarkKeys') === null
          && localStorage.getItem('userCustomMeta') === null
          && localStorage.getItem('preferredEngine') === null;

        const domTitles = [...document.querySelectorAll('#bookmarks .bookmark-title')].map(e => e.textContent.trim());
        const domOk = domTitles.includes('GitHub') && domTitles.includes('DeepSeek');

        const resetSuccess = countOk && hasDefaultNames && storageClean && domOk;
        return { resetSuccess, countOk, hasDefaultNames, storageClean, domOk };
      } finally {
        window.getDerivedBookmarks = origWinDerived;
        window.DEFAULT_BOOKMARKS = origWinDefault;
      }
    })()`);
    assert.ok(resetBookmarksCheck.resetSuccess);
    await evalJS(`localStorage.clear()`);
  } finally {
    await chrome.close();
    await server.close();
  }
});

test('Favicon 备用地址提取算法', async () => {
  const { server, chrome, evalJS } = await launchSession();
  try {
    const faviconFallbackCheck = await evalJS(`(() => {
      const urlFallback = faviconFallbackFromUrl('https://github.com');
      const wwwFallback = faviconFallbackFromUrl('https://www.google.com');
      const imFallback = faviconFallbackFromUrl('https://a.favicon.im/bilibili.com');
      const emptyFallback = faviconFallbackFromUrl('');
      return {
        urlFallbackOk: urlFallback === 'https://www.google.com/s2/favicons?domain=github.com&sz=128',
        wwwFallbackOk: wwwFallback === 'https://www.google.com/s2/favicons?domain=google.com&sz=128',
        imFallbackOk: imFallback === 'https://www.google.com/s2/favicons?domain=bilibili.com&sz=128',
        emptyFallbackOk: emptyFallback === ''
      };
    })()`);
    assert.ok(Object.values(faviconFallbackCheck).every(Boolean));
  } finally {
    await chrome.close();
    await server.close();
  }
});

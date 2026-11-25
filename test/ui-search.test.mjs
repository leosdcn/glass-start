/** 验证搜索联想、输入法组合、网址/图片分流及以图搜图交互。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { launchSession, pressKey, waitFor } from './support/helpers.mjs';
test('从天气切回搜索、更新候选和输入法确认', async () => {
  const { server, chrome, send, evalJS } = await launchSession();
  const press = (key) => pressKey(evalJS, key);
  try {
    await evalJS('window.switchToStart()');
    await waitFor(evalJS, 'state.currentSection === "start" && !isScreenTransitioning()');
    await evalJS('dom.weatherBtn.focus(); dom.weatherBtn.click()');
    assert.equal(await evalJS('OverlayStack.top()?.id'), 'weatherPopover');
    await evalJS('dom.searchInput.focus()');
    await send('Input.insertText', { text:'git' });
    await waitFor(evalJS, 'document.querySelectorAll("#suggestionMenu .suggestion-item").length > 0');
    assert.deepEqual(await evalJS('OverlayStack.stack.map(entry => entry.id)'), ['suggestions']);
    await press('ArrowDown');
    await waitFor(evalJS, 'document.querySelector("#suggestionMenu .suggestion-item.active") !== null');
    assert.equal(await evalJS('selectedSuggestionIdx'), 0);
    await press('ArrowDown');
    assert.equal(await evalJS('selectedSuggestionIdx'), 1);
    await press('ArrowUp');
    assert.equal(await evalJS('selectedSuggestionIdx'), 0);
    const suggestSelectionCheck = await evalJS(`(() => {
      const menu = document.getElementById('suggestionMenu');
      const items = menu ? menu.querySelectorAll('.suggestion-item') : [];
      const selected = menu ? menu.querySelector('.suggestion-item.active') : null;
      return { hasItems: items.length > 0, isSelected: selected !== null };
    })()`);
    assert.ok(suggestSelectionCheck.hasItems && suggestSelectionCheck.isSelected);

    await press('Escape');
    await waitFor(evalJS, '!document.getElementById("suggestionMenu").classList.contains("active") && OverlayStack.isEmpty()');
    const escResult = await evalJS(`({
      val: document.getElementById('searchInput').value,
      menuActive: document.getElementById('suggestionMenu').classList.contains('active'),
      idx: selectedSuggestionIdx,
      top: OverlayStack.top() ? OverlayStack.top().id : null
    })`);
    assert.equal(escResult.val, 'git');
    assert.equal(escResult.menuActive, false);
    assert.equal(escResult.idx, -1);
    assert.equal(escResult.top, null);

    for (const modifiers of [0, 8]) {
      await evalJS(`dom.searchInput.focus(); fetchSuggestions(state.engine, dom.searchInput.value)`);
      await waitFor(evalJS, 'dom.suggestionMenu.querySelector(".suggestion-item") !== null');
      for (const type of ['rawKeyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', {type, key:'Tab', code:'Tab', windowsVirtualKeyCode:9, modifiers});
      }
      assert.equal(await evalJS(`document.activeElement !== dom.searchInput &&
        dom.searchInput.getAttribute('aria-expanded') === 'false' && OverlayStack.isEmpty()`), true);
    }

    const revisedQuery = await evalJS(`(() => {
      const input = dom.searchInput;
      const open = window.open;
      let destination = '';
      window.open = url => { destination = url; };
      try {
        dom.engineBtn.click();
        dom.dropdownMenu.querySelector('[data-engine="bing"]').click();
        input.focus();
        input.value = 'github';
        fetchSuggestions('bing', input.value);
        const hadBookmark = dom.suggestionMenu.classList.contains('active') &&
          dom.suggestionMenu.querySelector('.suggestion-item[data-url]')?.textContent.includes('GitHub');
        input.value = 'glass-regression-new-query';
        input.dispatchEvent(new Event('input', {bubbles:true}));
        const loadingMenuStayedOpen = dom.suggestionMenu.classList.contains('active') &&
          !dom.suggestionMenu.querySelector('[role="option"]');
        const tabUnclaimed = input.dispatchEvent(new KeyboardEvent('keydown', {key:'Tab',bubbles:true,cancelable:true}));
        input.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown',bubbles:true,cancelable:true}));
        const value = input.value;
        input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}));
        return {hadBookmark, loadingMenuStayedOpen, tabUnclaimed, value, section:state.currentSection, query:destination && new URL(destination).searchParams.get('q')};
      } finally { window.open = open; }
    })()`);
    assert.deepEqual(revisedQuery, {
      hadBookmark:true, loadingMenuStayedOpen:true, tabUnclaimed:true, value:'glass-regression-new-query', section:'start', query:'glass-regression-new-query'
    });

    const searchActions = await evalJS(`(() => {
      const input = dom.searchInput;
      const open = window.open;
      const append = document.body.appendChild;
      const opened = [];
      window.open = url => opened.push(url);
      document.body.appendChild = function(node) {
        if (node.tagName === 'SCRIPT') node.type = 'application/x-test';
        return append.call(this, node);
      };
      const enter = isComposing => input.dispatchEvent(new KeyboardEvent('keydown',
        {key:'Enter',ctrlKey:true,isComposing,bubbles:true,cancelable:true}));
      try {
        input.focus();
        input.value = 'githu';
        fetchSuggestions('bing', input.value);
        const bookmark = dom.suggestionMenu.querySelector('.suggestion-item[data-url]');
        const getSuggestScript = () => document.body.querySelector('script[src*="__glassSuggestCb_"]');
        const lateResponse = window['__glassSuggestCb_' + activeSuggestReqId];
        input.dispatchEvent(new CompositionEvent('compositionstart'));
        input.value = 'githu aa';
        input.dispatchEvent(new InputEvent('input', {bubbles:true,isComposing:true}));
        lateResponse(['githu',['stale during composition']]);
        const keptOldResults = dom.suggestionMenu.classList.contains('active') && bookmark.isConnected &&
          !getSuggestScript() && !dom.suggestionMenu.textContent.includes('stale during composition');
        bookmark.dispatchEvent(new MouseEvent('mouseover', {bubbles:true}));
        bookmark.dispatchEvent(new MouseEvent('click', {bubbles:true,ctrlKey:true}));
        const arrowUnclaimed = input.dispatchEvent(new KeyboardEvent('keydown',
          {key:'ArrowDown',bubbles:true,cancelable:true}));
        const imeDidNotSearch = enter(true) && enter(false) && opened.length === 0 && selectedSuggestionIdx === -1;
        input.value = '维基百科';
        input.dispatchEvent(new CompositionEvent('compositionend'));
        input.dispatchEvent(new InputEvent('input', {bubbles:true}));
        const committedBookmark = dom.suggestionMenu.querySelector('.suggestion-item[data-url]')?.dataset.url;
        const committedScript = getSuggestScript();
        const committedRequest = committedScript && new URL(committedScript.src).searchParams.get('query');
        enter(false);
        const independentEnterSearched = opened.length === 1 && new URL(opened[0]).searchParams.get('q') === '维基百科';
        const tabUnclaimed = input.dispatchEvent(new KeyboardEvent('keydown', {key:'Tab',bubbles:true,cancelable:true}));

        input.value = '';
        input.dispatchEvent(new Event('input', {bubbles:true}));
        const cameraForEmpty = !dom.imageSearchBtn.inert && dom.searchClearBtn.inert;
        input.value = 'github';
        input.dispatchEvent(new Event('input', {bubbles:true}));
        const clearForText = dom.imageSearchBtn.inert && !dom.searchClearBtn.inert;
        const localResultImmediate = dom.suggestionMenu.classList.contains('active') &&
          dom.suggestionMenu.querySelector('.suggestion-item')?.textContent.includes('GitHub') &&
          !getSuggestScript();
        return { keptOldResults, arrowUnclaimed, imeDidNotSearch, committedBookmark, committedRequest, independentEnterSearched,
          tabUnclaimed, cameraForEmpty, clearForText, localResultImmediate };
      } finally {
        window.open = open;
        document.body.appendChild = append;
        hideSuggestions();
      }
    })()`);
    assert.deepEqual(searchActions, { keptOldResults:true, arrowUnclaimed:true, imeDidNotSearch:true,
      committedBookmark:'https://en.wikipedia.org/wiki/Main_Page', committedRequest:'维基百科',
      independentEnterSearched:true, tabUnclaimed:true, cameraForEmpty:true, clearForText:true, localResultImmediate:true });
  } finally {
    await chrome.close();
    await server.close();
  }
});

test('新标签页打开候选时保留列表，当前页打开时收起', async () => {
  const { server, chrome, send, evalJS } = await launchSession();
  try {
    await evalJS(`(() => {
      const url = new URL('#same-tab-bookmark', location.href).href;
      pageData.bookmarks = [...pageData.bookmarks, {name:'Glass tab fixture', url}];
      window.openedSuggestions = [];
      window.open = (...args) => {
        openedSuggestions.push(args);
        window.dispatchEvent(new Event('blur'));
      };
      window.fetch = async () => ({ok:true,json:async()=>['glass tab fixture',['glass tab docs']]});
      dom.engineBtn.click();
      dom.dropdownMenu.querySelector('[data-engine="wikipedia"]').click();
      dom.searchInput.focus();
      dom.searchInput.value = 'glass tab fixture';
      dom.searchInput.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    const bookmark = '.suggestion-item[data-url]';
    const network = '.suggestion-item:not([data-url])';
    const showSuggestions = async () => {
      await evalJS("fetchSuggestions('wikipedia', 'glass tab fixture')");
      await waitFor(evalJS, `dom.suggestionMenu.classList.contains('active')
        && dom.suggestionMenu.querySelector('${network}') && dom.suggestionMenu.getAnimations().length === 0`);
    };
    const clickSuggestion = async (selector, button, modifiers = 0) => {
      const point = await evalJS(`(() => {
        const {left,top,width,height} = dom.suggestionMenu.querySelector('${selector}').getBoundingClientRect();
        return {x:left+width/2,y:top+height/2};
      })()`);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', {type,button,modifiers,clickCount:1,...point});
      }
    };
    await showSuggestions();
    await pressKey(evalJS, 'ArrowDown');
    await evalJS("window.initialSuggestion = dom.suggestionMenu.querySelector('.suggestion-item'); dom.searchInput.setSelectionRange(0, 1)");
    await send('Input.insertText', { text: 'G' });
    assert.equal(await evalJS(`initialSuggestion === dom.suggestionMenu.querySelector('.suggestion-item')
      && initialSuggestion.getAttribute('aria-selected') === 'false'
      && !initialSuggestion.classList.contains('active')
      && !dom.searchInput.hasAttribute('aria-activedescendant')`), true);
    await send('Input.imeSetComposition', {text:'搜',selectionStart:1,selectionEnd:1});
    for (const type of ['rawKeyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    }
    await waitFor(evalJS, `document.activeElement === dom.searchClearBtn && dom.searchInput.getAttribute('aria-expanded') === 'false'`);
    await evalJS("dom.searchInput.focus(); dom.searchInput.value = 'glass tab fixture'");
    await showSuggestions();
    await evalJS('dom.searchInput.setSelectionRange(5, 5)');
    for (const [key, keyCode, caret] of [['ArrowLeft', 37, 4], ['ArrowRight', 39, 5]]) {
      await pressKey(evalJS, 'ArrowDown');
      assert.equal(await evalJS("dom.searchInput.getAttribute('aria-activedescendant')"), 'sug-opt-0');
      for (const type of ['rawKeyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', {type,key,code:key,windowsVirtualKeyCode:keyCode});
      }
      assert.equal(await evalJS('dom.searchInput.selectionStart'), caret);
      assert.equal(await evalJS(`dom.suggestionMenu.classList.contains('active')
        && !dom.searchInput.hasAttribute('aria-activedescendant')
        && !dom.suggestionMenu.querySelector('[aria-selected="true"]')`), true);
    }
    await evalJS(`dom.searchInput.dispatchEvent(new KeyboardEvent('keydown',
      {key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}))`);
    assert.equal(new URL(await evalJS('openedSuggestions.pop()[0]')).searchParams.get('search'), 'glass tab fixture');

    await evalJS("window.firstSuggestion = dom.suggestionMenu.querySelector('.suggestion-item')");
    for (const selector of [bookmark, network]) {
      assert.equal(await evalJS(`dom.suggestionMenu.querySelector('${selector}').dispatchEvent(
        new MouseEvent('auxclick', {button:2,bubbles:true,cancelable:true}))`), true);
      await clickSuggestion(selector, 'middle');
      assert.equal(await evalJS(`dom.suggestionMenu.classList.contains('active')
        && firstSuggestion.isConnected && dom.searchInput.value === 'glass tab fixture'`), true);
    }
    // Ctrl/Cmd 左键与中键共用候选激活入口。
    await clickSuggestion(network, 'left', process.platform === 'darwin' ? 4 : 2);
    assert.equal(await evalJS("dom.suggestionMenu.classList.contains('active') && firstSuggestion.isConnected"), true);
    const opened = await evalJS('openedSuggestions');
    assert.equal(opened.length, 3);
    assert.equal(new URL(opened[0][0]).hash, '#same-tab-bookmark');
    assert.equal(new URL(opened[1][0]).searchParams.get('search'), 'glass tab docs');
    assert.equal(opened[2][0], opened[1][0]);
    for (const [, target, features] of opened) assert.deepEqual([target, features], ['_blank', 'noopener,noreferrer']);

    await evalJS('dom.clock.click()');
    assert.equal(await evalJS("dom.suggestionMenu.classList.contains('active')"), false);
    await showSuggestions();
    await pressKey(evalJS, 'Escape');
    assert.equal(await evalJS(`!dom.suggestionMenu.classList.contains('active')
      && dom.searchInput.value === 'glass tab fixture'`), true);
    await showSuggestions();
    await clickSuggestion(bookmark, 'left');
    await waitFor(evalJS, "location.hash === '#same-tab-bookmark' && !dom.suggestionMenu.classList.contains('active')");
  } finally {
    await chrome.close();
    await server.close();
  }
});

test('搜索框按图片链接、网页地址和关键词分流', async () => {
  const image = readFileSync(new URL('../src/extension/icon16.png', import.meta.url));
  let stalledProbes = 0;
  const { server, chrome, send, evalJS, port } = await launchSession(0, {
    '/image-link': (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(image);
    },
    '/ordinary-page': '<title>网页直达</title>',
    '/slow-page': (req, res) => {
      if (req.headers['sec-fetch-dest'] === 'image') {
        stalledProbes++;
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>探测超时后打开网页</title>');
    }
  });
  try {
    const origin = 'http://127.0.0.1:' + port;
    const photo = 'https://images.example.test/photo.JPG?size=800&token=a%2Fb';
    const cdnImage = origin + '/image-link?width=320';
    const webpage = origin + '/ordinary-page?next=photo.png';
    const locale = await evalJS('document.documentElement.lang');
    await evalJS('window.openedLinks = []; window.open = (...args) => openedLinks.push(args);');
    const fill = async (engine, query) => evalJS(`(() => {
      dom.searchInput.value = '';
      dom.engineBtn.click();
      dom.dropdownMenu.querySelector('[data-engine="${engine}"]').click();
      dom.searchInput.focus();
      dom.searchInput.value = ${JSON.stringify(query)};
    })()`);
    const enter = async (modifiers = 0) => {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers });
    };
    const cases = [
      ['bing', photo, 'https://www.bing.com/images/search', 'q', 'imgurl:' + photo],
      ['google', cdnImage, 'https://lens.google.com/uploadbyurl', 'url', cdnImage],
      ['google', '//images.example.test/sticker.png?v=1', 'https://lens.google.com/uploadbyurl', 'url',
        'https://images.example.test/sticker.png?v=1'],
      locale === 'en'
        ? ['wikipedia', photo, 'https://lens.google.com/uploadbyurl', 'url', photo]
        : ['wikipedia', photo, 'https://www.bing.com/images/search', 'q', 'imgurl:' + photo],
      ['google', '查找 https://example.test/page', 'https://www.google.com/search', 'q', '查找 https://example.test/page'],
      ['google', 'Node.js', 'https://www.google.com/search', 'q', 'Node.js'],
      ['bing', 'style.css', 'https://www.bing.com/search', 'q', 'style.css'],
      ['bing', 'javascript:alert(1)', 'https://www.bing.com/search', 'q', 'javascript:alert(1)']
    ];
    for (const [index, [engine, query, destination, param, value]] of cases.entries()) {
      await fill(engine, query);
      await enter(2);
      await waitFor(evalJS, 'openedLinks.length === ' + (index + 1));
      const [href, target, features] = await evalJS('openedLinks.at(-1)');
      const url = new URL(href);
      assert.equal(url.origin + url.pathname, destination);
      assert.equal(url.searchParams.get(param), value);
      assert.deepEqual([target, features], ['_blank', 'noopener,noreferrer']);
      assert.equal(await evalJS('state.engine'), engine);
    }
    await fill('google', webpage);
    await evalJS("dom.searchInput.dispatchEvent(new Event('input', { bubbles: true }))");
    assert.equal(await evalJS("dom.searchInput.getAttribute('aria-expanded')"), 'false');
    await enter();
    await waitFor(evalJS, 'document.title === "网页直达" && location.href === ' + JSON.stringify(webpage));
    await evalJS('history.back()');
    await waitFor(evalJS, '!!window.dom?.searchInput');
    const slowPage = origin + '/slow-page';
    await fill('google', slowPage);
    await evalJS(`dom.searchInput.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true
    })); dom.searchInput.blur();`);
    await waitFor(evalJS, 'document.title === "探测超时后打开网页" && location.href === ' + JSON.stringify(slowPage));
    assert.equal(stalledProbes, 1);
  } finally {
    await chrome.close();
    await server.close();
  }
});

test('新图片提交作废旧网址探测，打开设置作废尚未完成的搜图', async () => {
  const { server, chrome, send, evalJS } = await launchSession();
  const requests = [];
  try {
    send('Fetch.requestPaused', event => requests.push(event));
    await send('Fetch.enable', { patterns: [{ urlPattern: 'https://www.bing.com/images/search?*', resourceType: 'Document' }] });
    const image = readFileSync(new URL('../src/extension/icon16.png', import.meta.url)).toString('base64');
    await evalJS(`(async () => {
      dom.engineBtn.click();
      dom.dropdownMenu.querySelector('[data-engine="bing"]').click();
      window.openedSearchUrls = [];
      window.open = href => openedSearchUrls.push(href);
      window.imageFormSubmissions = 0;
      const submit = HTMLFormElement.prototype.submit;
      HTMLFormElement.prototype.submit = function() {
        imageFormSubmissions++;
        return submit.call(this);
      };

      const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      const decode = HTMLImageElement.prototype.decode;
      const pendingUrl = location.origin + '/pending-link';
      let finishProbe;
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        ...descriptor, set(value) {
          if (value === pendingUrl) finishProbe = () => this.onerror();
          else descriptor.set.call(this, value);
        }
      });
      HTMLImageElement.prototype.decode = function() {
        const result = decode.call(this);
        return this.src.startsWith('blob:')
          ? result.then(() => new Promise(resolve => { window.finishSearchDecode = resolve; }))
          : result;
      };
      window.pasteSearchImage = () => {
        window.finishSearchDecode = null;
        const clipboardData = new DataTransfer();
        clipboardData.items.add(new File([Uint8Array.from(atob('${image}'), c => c.charCodeAt(0))], 'pending.png', { type: 'image/png' }));
        dom.searchInput.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
      };
      dom.searchInput.focus();
      dom.searchInput.value = pendingUrl;
      dom.searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
      pasteSearchImage();
      finishProbe();
      await Promise.resolve();
    })()`);
    assert.deepEqual(await evalJS('openedSearchUrls'), []);
    await waitFor(evalJS, '!!window.finishSearchDecode');
    await evalJS('window.finishSearchDecode()');
    await waitFor(async () => requests.length === 1, '较新的图片提交');
    await send('Fetch.fulfillRequest', { requestId: requests[0].requestId, responseCode: 204 });
    assert.equal(requests[0].request.method, 'POST');

    await evalJS('pasteSearchImage()');
    await waitFor(evalJS, '!!window.finishSearchDecode');
    await evalJS('openEditModal()');
    assert.equal(await evalJS('dom.editModal.open'), true);
    await evalJS(`(async () => {
      cancelEditModal();
      window.finishSearchDecode();
      await new Promise(resolve => requestAnimationFrame(resolve));
    })()`);
    assert.equal(await evalJS('imageFormSubmissions'), 1);
  } finally {
    await chrome.close();
    await server.close();
  }
});

test('相机打开本地选图并提交给当前引擎', async () => {
  const { server, chrome, send, evalJS } = await launchSession();
  try {
    const imagePath = fileURLToPath(new URL('../src/extension/icon16.png', import.meta.url));
    const image = readFileSync(imagePath);
    const largePngPath = fileURLToPath(new URL('../docs/assets/preview-start.png', import.meta.url));
    const destinations = [
      ['bing', 'https://www.bing.com/images/search'],
      ['google', 'https://lens.google.com/v3/upload']
    ];
    const choosers = [];
    send('Page.fileChooserOpened', event => choosers.push(event));
    await send('Page.setInterceptFileChooserDialog', { enabled: true });
    await waitFor(evalJS, '!!dom.lensUploadFrame.contentDocument.forms[0]');
    await evalJS(`window.imageUploads = [];
      const recordUpload = event => {
        const parts = Array.from(event.formData, async ([name, value]) => [name, typeof value === 'string' ? value : {
          filename: value.name, type: value.type, base64: btoa(String.fromCharCode(...new Uint8Array(await value.arrayBuffer())))
        }]);
        if (!parts.length) return;
        imageUploads.push(Promise.all(parts).then(Object.fromEntries));
      };
      document.addEventListener('formdata', recordUpload);
      dom.lensUploadFrame.contentDocument.addEventListener('formdata', recordUpload);`);

    const requests = [];
    send('Fetch.requestPaused', request => requests.push(request));
    await send('Fetch.enable', {
      patterns: destinations.map(([, url]) => ({ urlPattern: `${url}?*`, resourceType: 'Document' }))
    });
    const locale = await evalJS('document.documentElement.lang');
    const [defaultEngine, defaultDestination] = destinations[locale === 'en' ? 1 : 0];
    const cases = [
      ...destinations.map(([engine, destination]) => ({ engine, destination, preferred: engine })),
      { engine: defaultEngine, destination: defaultDestination, preferred: 'wikipedia' }
    ];
    assert.deepEqual(await evalJS(`Array.from(dom.dropdownMenu.children, item => [item.dataset.engine, item.getAttribute('role')])`),
      [['bing', 'menuitemradio'], ['google', 'menuitemradio'], ['wikipedia', 'menuitemradio']]);
    for (const [index, { engine, destination, preferred }] of cases.entries()) {
      await evalJS(`dom.engineBtn.click(); dom.dropdownMenu.querySelector('[data-engine="${preferred}"]').click()`);
      assert.equal(await evalJS(`!dom.imageSearchBtn.inert && dom.engineBtn.getAttribute('aria-expanded') === 'false'`), true);
      await evalJS('dom.imageSearchBtn.focus()');
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await waitFor(async () => choosers.length === index + 1, '系统文件选择器');
      assert.equal(await evalJS('document.activeElement === dom.imageSearchBtn'), true);
      await send('DOM.setFileInputFiles', {
        backendNodeId: choosers[index].backendNodeId, files: [engine === 'bing' ? largePngPath : imagePath]
      });
      await waitFor(async () => requests.length === index + 1, '图片上传导航');
      const { request, requestId } = requests[index];
      await send('Fetch.fulfillRequest', { requestId, responseCode: 204 });
      const url = new URL(request.url);
      assert.equal(url.origin + url.pathname, destination);
      assert.equal(request.method, 'POST');
      assert.match(request.headers['Content-Type'], /^multipart\/form-data;/);
      if (engine === 'bing') {
        const prepared = await evalJS(`(async () => {
          const { cbir, imageBin } = await imageUploads[${index}];
          const image = new Image();
          image.src = 'data:image/jpeg;base64,' + imageBin;
          await image.decode();
          return { cbir, signature: imageBin.slice(0, 4), width: image.naturalWidth, height: image.naturalHeight };
        })()`);
        assert.equal(prepared.cbir, 'sbi');
        assert.equal(prepared.signature, '/9j/');
        const pixels = prepared.width * prepared.height;
        assert.ok(pixels > 1_190_000 && pixels <= 1_200_000);
      } else {
        assert.equal(request.referrerPolicy, 'no-referrer');
        assert.deepEqual(await evalJS(`imageUploads[${index}]`), {
          encoded_image: { filename: 'icon16.png', type: 'image/png', base64: image.toString('base64') }
        });
      }
      assert.equal(await evalJS('state.engine'), preferred);
      assert.equal(await evalJS('dom.imageSearchInput.files.length'), 0);
      assert.deepEqual(await evalJS(`[dom.imageSearchInput.form.elements.length,
        dom.lensUploadFrame.contentDocument.forms[0].elements.length]`), [1, 0]);
    }
  } finally {
    await chrome.close();
    await server.close();
  }
});

test('拖入本地图片后用当前引擎搜图', async () => {
  const { server, chrome, send, evalJS } = await launchSession();
  try {
    const imagePath = fileURLToPath(new URL('../src/extension/icon16.png', import.meta.url));
    const bing = 'https://www.bing.com/images/search';
    const google = 'https://lens.google.com/v3/upload';
    const requests = [];
    send('Fetch.requestPaused', event => requests.push(event));
    await send('Fetch.enable', {
      patterns: [bing, google].map(url => ({ urlPattern: `${url}?*`, resourceType: 'Document' }))
    });
    const locale = await evalJS('document.documentElement.lang');
    const dragData = { items: [], files: [imagePath], dragOperationsMask: 1 };
    const overSearch = 'dom.searchInput.closest(".search-box-wrapper").classList.contains("image-dragover")';

    const engines = [['bing', bing], ['google', google], ['wikipedia', locale === 'en' ? google : bing]];
    for (const [index, [engine, destination]] of engines.entries()) {
      await evalJS(`dom.engineBtn.click(); dom.dropdownMenu.querySelector('[data-engine="${engine}"]').click()`);
      const point = await evalJS(`(() => {
        const { x, y, width, height } = dom.searchInput.getBoundingClientRect();
        return { x: x + width / 2, y: y + height / 2 };
      })()`);
      for (const type of ['dragEnter', 'dragOver']) {
        await send('Input.dispatchDragEvent', { type, ...point, data: dragData });
      }
      await waitFor(evalJS, overSearch);
      if (index === 0) {
        await send('Input.dispatchDragEvent', { type: 'dragOver', x: 1, y: 1, data: dragData });
        await waitFor(evalJS, `!${overSearch}`);
        await send('Input.dispatchDragEvent', { type: 'dragOver', ...point, data: dragData });
        await waitFor(evalJS, overSearch);
      }
      await send('Input.dispatchDragEvent', { type: 'drop', ...point, data: dragData });
      await waitFor(async () => requests.length === index + 1, '拖图上传导航');
      const { request, requestId } = requests[index];
      await send('Fetch.fulfillRequest', { requestId, responseCode: 204 });
      assert.equal(request.method, 'POST');
      const url = new URL(request.url);
      assert.equal(url.origin + url.pathname, destination);
      assert.equal(await evalJS(overSearch), false);
      assert.equal(await evalJS('state.engine'), engine);
    }

    const png = readFileSync(imagePath, 'base64');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16"/></svg>';
    const examples = [
      ['bing', bing, `new File([Uint8Array.from(atob('${png}'), c => c.charCodeAt(0))], 'image.png')`],
      ['google', google, `new File([Uint8Array.from(atob('${png}'), c => c.charCodeAt(0))], 'image.png', { type: 'application/octet-stream' })`],
      ['bing', bing, `new File([${JSON.stringify(svg)}], 'image.svg', { type: 'image/svg+xml' })`]
    ];
    const dropFile = async source => evalJS(`(() => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(${source});
      dom.searchInput.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
      const highlighted = ${overSearch};
      dom.searchInput.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
      return highlighted;
    })()`);
    for (const [engine, destination, source] of examples) {
      await evalJS(`dom.engineBtn.click(); dom.dropdownMenu.querySelector('[data-engine="${engine}"]').click()`);
      const index = requests.length;
      assert.equal(await dropFile(source), true);
      await waitFor(async () => requests.length === index + 1, '浏览器解码有效图片后提交');
      const { request, requestId } = requests[index];
      await send('Fetch.fulfillRequest', { requestId, responseCode: 204 });
      const url = new URL(request.url);
      assert.equal(url.origin + url.pathname, destination);
    }

    const layout = '[dom.searchInput.form.offsetTop, dom.searchInput.form.offsetHeight, dom.bookmarks.parentElement.offsetTop]';
    const before = await evalJS(layout);
    const requestCount = requests.length;
    const broken = `new File(['not an image'], 'broken.png', { type: 'image/png' })`;
    const nextActions = [
      `dom.searchInput.value = 'test'; dom.searchInput.dispatchEvent(new Event('input', { bubbles: true }))`,
      'dom.searchClearBtn.click()',
      `dom.engineBtn.click(); dom.dropdownMenu.querySelector('[data-engine="google"]').click()`
    ];
    for (const action of nextActions) {
      await dropFile(broken);
      await waitFor(evalJS, '!!dom.imageSearchStatus.textContent');
      assert.deepEqual(await evalJS(layout), before);
      await evalJS(action);
      assert.equal(await evalJS('dom.imageSearchStatus.textContent'), '');
    }
    assert.equal(requests.length, requestCount);
  } finally {
    await chrome.close();
    await server.close();
  }
});

test('粘贴图片用当前引擎搜图，文字和网址保留默认粘贴', async () => {
  const { server, chrome, send, evalJS } = await launchSession();
  try {
    const image = readFileSync(new URL('../src/extension/icon16.png', import.meta.url)).toString('base64');
    const destinations = [
      ['bing', 'https://www.bing.com/images/search'],
      ['google', 'https://lens.google.com/v3/upload']
    ];
    const requests = [];
    send('Fetch.requestPaused', event => requests.push(event));
    await send('Fetch.enable', {
      patterns: destinations.map(([, url]) => ({ urlPattern: `${url}?*`, resourceType: 'Document' }))
    });
    await waitFor(evalJS, '!!dom.lensUploadFrame.contentDocument.forms[0]');
    const paste = async contents => evalJS(`(() => {
      dom.searchInput.focus();
      const clipboardData = new DataTransfer();
      ${contents}
      return dom.searchInput.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    })()`);
    for (const text of ['玻璃起始页', 'https://example.test/image.png']) {
      assert.equal(await paste(`clipboardData.setData('text/plain', ${JSON.stringify(text)});`), true);
    }
    assert.equal(requests.length, 0);

    for (const [index, [engine, destination]] of destinations.entries()) {
      await evalJS(`dom.engineBtn.click(); dom.dropdownMenu.querySelector('[data-engine="${engine}"]').click()`);
      assert.equal(await paste(`clipboardData.items.add(new File(
        [Uint8Array.from(atob('${image}'), c => c.charCodeAt(0))], 'pasted.png', { type: 'image/png' }));`), false);
      await waitFor(async () => requests.length === index + 1, '粘贴图片上传导航');
      const { request, requestId } = requests[index];
      await send('Fetch.fulfillRequest', { requestId, responseCode: 204 });
      assert.equal(request.method, 'POST');
      assert.equal(request.url.split('?')[0], destination);
      assert.equal(await evalJS('dom.imageSearchInput.files.length'), 0);
    }
  } finally {
    await chrome.close();
    await server.close();
  }
});

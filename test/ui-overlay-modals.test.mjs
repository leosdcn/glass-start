/** 验证弹窗栈、唤醒恢复、联想交互及移动视口可访问性。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { launchSession, pressKey, waitFor } from './support/helpers.mjs';

test('页面刷新状态保持、跳出返回防白屏与触觉倾斜恢复', async () => {
  const { server, chrome, send, evalJS } = await launchSession();
  try {
    await waitFor(evalJS, 'document.readyState === "complete" && !!window.OverlayStack && !!window.state');

    await evalJS('window.__pre_reload_nav = true; sessionStorage.setItem("startpage_section", "nav"); setTimeout(() => location.reload(), 10);');
    await waitFor(evalJS, `document.readyState === "complete" && !window.__pre_reload_nav && !!window.state && state.currentSection === "nav" && (() => {
      const n = document.getElementById("navSection");
      return n && document.documentElement.dataset.screen === "nav" && !n.className.includes("nav-hidden");
    })()`);
    const restored = await evalJS(`(() => {
      const n = document.getElementById('navSection');
      return document.documentElement.dataset.screen === 'nav' && !n.className.includes('nav-hidden');
    })()`);
    assert.equal(restored, true);

    await evalJS('window.switchToStart()');
    await waitFor(evalJS, 'state.currentSection === "start" && !isScreenTransitioning() && document.getElementById("startSection").getAnimations().length === 0 && Math.abs(document.getElementById("startSection").getBoundingClientRect().top) < 0.05');
    const backFromReloadedNav = await evalJS(`(() => {
      const s = document.getElementById('startSection');
      const clock = document.getElementById('clock');
      const search = document.getElementById('searchInput');
      const weather = document.getElementById('weatherWidget');
      const gear = document.getElementById('editBookmarksBtn');
      const sRect = s ? s.getBoundingClientRect() : null;
      const restoring = document.documentElement.classList.contains('screen-restoring');
      const gearHidden = gear ? getComputedStyle(gear).pointerEvents === 'none' : false;
      return {
        sTop: sRect ? sRect.top : -999,
        sHeight: sRect ? sRect.height : 0,
        hasClock: !!clock && clock.offsetWidth > 0,
        hasSearch: !!search && search.offsetWidth > 0,
        hasWeather: !!weather,
        restoring,
        gearHidden,
        startAria: s.getAttribute('aria-hidden')
      };
    })()`);
    const startRestoredValid = Math.abs(backFromReloadedNav.sTop) < 0.05 && backFromReloadedNav.sHeight > 0
      && backFromReloadedNav.hasClock && backFromReloadedNav.hasSearch && backFromReloadedNav.hasWeather
      && !backFromReloadedNav.restoring && !backFromReloadedNav.gearHidden && backFromReloadedNav.startAria !== 'true';
    assert.ok(startRestoredValid, JSON.stringify(backFromReloadedNav));

    // 首次 pageshow 保留正在进行的切屏，BFCache 恢复立即校准。
    const pageshowTransition = await evalJS(`(() => {
      switchToNav();
      const active = isScreenTransitioning();
      window.dispatchEvent(new PageTransitionEvent('pageshow'));
      const afterInitialShow = isScreenTransitioning();
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      return [active, afterInitialShow, isScreenTransitioning()];
    })()`);
    assert.deepEqual(pageshowTransition, [true, true, false]);
    await waitFor(evalJS, `!isScreenTransitioning() && (() => {
      const n = document.getElementById("navSection");
      return n && document.documentElement.dataset.screen === "nav" && !n.classList.contains("nav-hidden");
    })()`);
    const bfCacheHealed = await evalJS(`(() => {
      const n = document.getElementById('navSection');
      return !isScreenTransitioning() && state.currentSection === 'nav' && document.documentElement.dataset.screen === 'nav' && !n.classList.contains('nav-hidden');
    })()`);
    assert.equal(bfCacheHealed, true);

    // 触觉与悬停门控
    await evalJS('window.switchToStart()');
    await waitFor(evalJS, 'state.currentSection === "start" && !isScreenTransitioning() && document.getElementById("startSection").getAnimations().length === 0 && Math.abs(document.getElementById("startSection").getBoundingClientRect().top) < 0.05');
    const bookmarkClickTest = await evalJS(`(() => {
      const bm = document.querySelector('.bookmark-item');
      if (!bm) return { hasBm: false };
      bm.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
      const cmdHasIsClicked = bm.classList.contains('is-clicked');
      bm.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
      const midHasIsClicked = bm.classList.contains('is-clicked');
      bm.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
      const normalHasIsClicked = bm.classList.contains('is-clicked');
      return { hasBm: true, cmdHasIsClicked, midHasIsClicked, normalHasIsClicked };
    })()`);
    const bookmarkTactileOk = bookmarkClickTest.hasBm && !bookmarkClickTest.cmdHasIsClicked && !bookmarkClickTest.midHasIsClicked && bookmarkClickTest.normalHasIsClicked;
    assert.ok(bookmarkTactileOk, '书签触觉点击反馈合规');

    const hoverGatingTest = await evalJS(`(() => {
      const bm = document.querySelector('.bookmark-item');
      if (!bm) return { ok: false, reason: 'no-bookmark-found' };
      bm.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 100, clientY: 100 }));
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      document.dispatchEvent(new Event('visibilitychange'));
      const bodyHasTabBlurredOnReturn = document.body.classList.contains('tab-blurred');
      const style = window.getComputedStyle(bm);
      const isScaleNormal = !style.transform || style.transform === 'none' || style.transform.includes('matrix(1, 0, 0, 1');
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 200 }));
      const bodyClearedTabBlurred = !document.body.classList.contains('tab-blurred');
      return { ok: bodyHasTabBlurredOnReturn && isScaleNormal && bodyClearedTabBlurred };
    })()`);
    assert.ok(hoverGatingTest.ok, '跳出切回 tab-blurred 门控有效');

    // 导航页书签 3D 倾斜与 VisionOS 折射光斑
    await evalJS('window.switchToNav()');
    await waitFor(evalJS, 'state.currentSection === "nav" && !isScreenTransitioning()');
    const tiltTest = await evalJS(`(async () => {
      const navBm = document.querySelector('.nav-bookmark');
      if (!navBm) return { ok: false, reason: 'no-nav-bm' };
      if (typeof window.resetActiveTiltCard !== 'function') return { ok: false, reason: 'no-reset-fn' };

      const rect = navBm.getBoundingClientRect();
      const clientX = rect.left + rect.width * 0.8;
      const clientY = rect.top + rect.height * 0.8;

      navBm.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX, clientY }));
      await new Promise(r => requestAnimationFrame(r));
      await new Promise(r => requestAnimationFrame(r));

      const transform = navBm.style.transform;
      const mouseX = navBm.style.getPropertyValue('--mouse-x');
      const mouseY = navBm.style.getPropertyValue('--mouse-y');
      const hasTilt = transform.includes('perspective(') && transform.includes('rotateX(') && transform.includes('rotateY(');
      const hasSpotlight = !!mouseX && !!mouseY;

      window.resetActiveTiltCard();
      const resetOk = navBm.style.transform === '';

      return {
        ok: hasTilt && hasSpotlight && resetOk,
        hasTilt,
        hasSpotlight,
        resetOk
      };
    })()`);
    assert.ok(tiltTest.ok, `3D 倾斜触觉正确响应与复位: ${JSON.stringify(tiltTest)}`);
  } finally {
    await chrome.close();
    await server.close();
  }
});

test('快捷书签缩小整张卡片后仍可在原边缘松手打开', async () => {
  const { server, chrome, send, evalJS } = await launchSession();
  try {
    await waitFor(evalJS, "!dom.bookmarks.parentElement.classList.contains('fade-in')");
    const point = await evalJS(`(() => {
      window.pressedBookmark = dom.bookmarks.querySelector('.bookmark-item');
      window.bookmarkClicks = 0;
      pressedBookmark.addEventListener('click', event => {
        event.preventDefault();
        bookmarkClicks++;
      });
      const {left,top,height} = pressedBookmark.getBoundingClientRect();
      return {x:left+1,y:top+height/2};
    })()`);
    const surfaceStyle = "getComputedStyle(pressedBookmark.querySelector('.bookmark-surface'))";
    await send('Input.dispatchMouseEvent', {type:'mouseMoved',...point});
    await waitFor(evalJS, `${surfaceStyle}.transform.startsWith('matrix(1.025,')`);
    await send('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',clickCount:1,...point});
    await waitFor(evalJS, `${surfaceStyle}.transform.startsWith('matrix(0.975,')
      && ${surfaceStyle}.backgroundColor === 'rgba(255, 255, 255, 0.14)'`);
    assert.equal(await evalJS("getComputedStyle(pressedBookmark).transform"), 'none');
    await send('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',clickCount:1,...point});
    assert.equal(await evalJS('bookmarkClicks'), 1);
  } finally {
    await chrome.close();
    await server.close();
  }
});

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
        const lateResponse = window['__glassSuggestCb_' + activeSuggestReqId];
        input.dispatchEvent(new CompositionEvent('compositionstart'));
        input.value = 'githu aa';
        input.dispatchEvent(new InputEvent('input', {bubbles:true,isComposing:true}));
        lateResponse(['githu',['stale during composition']]);
        const keptOldResults = dom.suggestionMenu.classList.contains('active') && bookmark.isConnected &&
          !suggestionScriptTag && !dom.suggestionMenu.textContent.includes('stale during composition');
        bookmark.dispatchEvent(new MouseEvent('mouseover', {bubbles:true}));
        bookmark.dispatchEvent(new MouseEvent('click', {bubbles:true,ctrlKey:true}));
        const arrowUnclaimed = input.dispatchEvent(new KeyboardEvent('keydown',
          {key:'ArrowDown',bubbles:true,cancelable:true}));
        const imeDidNotSearch = enter(true) && enter(false) && opened.length === 0 && selectedSuggestionIdx === -1;
        input.value = '维基百科';
        input.dispatchEvent(new CompositionEvent('compositionend'));
        input.dispatchEvent(new InputEvent('input', {bubbles:true}));
        const committedBookmark = dom.suggestionMenu.querySelector('.suggestion-item[data-url]')?.dataset.url;
        const committedRequest = suggestionScriptTag && new URL(suggestionScriptTag.src).searchParams.get('query');
        enter(false);
        const independentEnterSearched = opened.length === 1 && new URL(opened[0]).searchParams.get('q') === '维基百科';
        const tabUnclaimed = input.dispatchEvent(new KeyboardEvent('keydown', {key:'Tab',bubbles:true,cancelable:true}));

        input.value = '';
        input.dispatchEvent(new Event('input', {bubbles:true}));
        dom.randomBookmarkBtn.click();
        const diceOpenedImmediately = opened.length === 2;
        input.value = 'github';
        input.dispatchEvent(new Event('input', {bubbles:true}));
        const localResultImmediate = dom.suggestionMenu.classList.contains('active') &&
          dom.suggestionMenu.querySelector('.suggestion-item')?.textContent.includes('GitHub') &&
          !suggestionScriptTag;
        return { keptOldResults, arrowUnclaimed, imeDidNotSearch, committedBookmark, committedRequest, independentEnterSearched,
          tabUnclaimed, diceOpenedImmediately, localResultImmediate };
      } finally {
        window.open = open;
        document.body.appendChild = append;
        hideSuggestions();
      }
    })()`);
    assert.deepEqual(searchActions, { keptOldResults:true, arrowUnclaimed:true, imeDidNotSearch:true,
      committedBookmark:'https://en.wikipedia.org/wiki/Main_Page', committedRequest:'维基百科',
      independentEnterSearched:true, tabUnclaimed:true, diceOpenedImmediately:true, localResultImmediate:true });
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

test('OverlayStack 多层弹窗嵌套压退栈、安全白名单与焦点归还', async () => {
  const { server, chrome, evalJS } = await launchSession();
  const press = (key) => pressKey(evalJS, key);
  try {
    assert.equal(await evalJS(`document.getElementById('clock').style.willChange`), '');

    // 引擎下拉框
    await evalJS(`document.getElementById('engineBtn').click()`); await waitFor(evalJS, `OverlayStack.top()?.id === "dropdown"`);
    await press('Escape'); await waitFor(evalJS, `OverlayStack.isEmpty()`);

    // 同一次设置会话验证背景输入隔离、导入入口和重置确认。
    assert.equal(await evalJS("dom.editBookmarksBtn.getAttribute('aria-expanded')"), 'false');
    await evalJS('dom.editBookmarksBtn.focus(); dom.editBookmarksBtn.click()');
    await waitFor(evalJS, 'dom.editModal.open');
    assert.equal(await evalJS("dom.editBookmarksBtn.getAttribute('aria-expanded')"), 'true');
    await evalJS(`window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))`);
    await press('PageDown');
    assert.equal(await evalJS('state.currentSection === "start" && !isScreenTransitioning()'), true);

    await evalJS("document.getElementById('tab-btn-data').click()");
    const dropzoneFired = await evalJS(`(() => {
      let fired = false;
      const input = document.getElementById('importJsonInput');
      input.addEventListener('click', () => { fired = true; }, { once: true });
      document.getElementById('jsonDropzone').click();
      return fired;
    })()`);
    assert.equal(dropzoneFired, true);

    const resetExpanded = () => evalJS("dom.resetEditBtn.getAttribute('aria-expanded')");
    assert.equal(await resetExpanded(), 'false');
    await evalJS('dom.resetEditBtn.focus(); dom.resetEditBtn.click()');
    await waitFor(evalJS, 'dom.confirmModal.open');
    assert.equal(await resetExpanded(), 'true');
    const confirmInfo = await evalJS(`({
      title: dom.confirmTitle.textContent.trim(),
      msg: dom.confirmMsg.textContent.trim()
    })`);
    assert.ok(confirmInfo.title.length > 0 && !confirmInfo.title.includes('undefined'));
    assert.ok(confirmInfo.msg.length > 0 && !confirmInfo.msg.includes('undefined'));
    await evalJS('dom.confirmCancelBtn.click()');
    await waitFor(evalJS, 'document.activeElement === dom.resetEditBtn');
    assert.equal(await resetExpanded(), 'false');

    await evalJS('dom.cancelEditBtn.click()');
    await waitFor(evalJS, 'document.activeElement === dom.editBookmarksBtn');
    assert.equal(await evalJS("dom.editBookmarksBtn.getAttribute('aria-expanded')"), 'false');
    assert.equal(await evalJS('!document.body.matches(".overflow-hidden, .touch-none")'), true);

    // 遮罩透明度设置记忆
    await evalJS(`localStorage.setItem('maskOpacity', 50)`);
    await evalJS('window.__pre_reload_mask = true; setTimeout(() => location.reload(), 10);');
    await waitFor(evalJS, 'document.readyState === "complete" && !window.__pre_reload_mask && !!window.OverlayStack && window.__PRE_BG_EFFECTS__?.op === 50');
    const beforeOverlay = await evalJS(`getComputedStyle(document.getElementById('bgOverlay')).backgroundColor`);
    await press('Escape');
    await waitFor(evalJS, 'OverlayStack.isEmpty()');
    const afterOverlay = await evalJS(`getComputedStyle(document.getElementById('bgOverlay')).backgroundColor`);
    assert.equal(beforeOverlay, afterOverlay);
    await evalJS(`localStorage.removeItem('maskOpacity')`);

    // 搜索引擎白名单
    const engineDropdownCheck = await evalJS(`(() => {
      const buttons = [...document.querySelectorAll('#dropdownMenu button[data-engine]')];
      const engineKeys = buttons.map(b => b.dataset.engine);
      return {
        isClean: engineKeys.length === 3 && engineKeys.includes('bing') && engineKeys.includes('google') && engineKeys.includes('wikipedia') && !engineKeys.includes('baidu') && !engineKeys.includes('duckduckgo')
      };
    })()`);
    assert.equal(engineDropdownCheck.isClean, true);
  } finally {
    await chrome.close();
    await server.close();
  }
});

test('移动端视口与侧边栏 Tab 滚动联动及触控规范', async () => {
  const { server, chrome, send, evalJS } = await launchSession();
  try {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 402,
      height: 874,
      deviceScaleFactor: 3,
      mobile: true
    });
    await waitFor(evalJS, 'window.innerWidth === 402');

    await evalJS('window.switchToNav()');
    await waitFor(evalJS, 'state.currentSection === "nav" && !isScreenTransitioning()');

    const tab0Info = await evalJS(`(() => {
      const tab0 = document.getElementById('cat-tab-0'), sidebar = document.getElementById('sidebar');
      if (!tab0 || !sidebar) return null;
      const tRect = tab0.getBoundingClientRect(), sRect = sidebar.getBoundingClientRect();
      return {
        text: tab0.textContent.trim(),
        active: tab0.classList.contains('active'),
        visible: tRect.left >= sRect.left && tRect.right <= sRect.right,
        scrollLeft: sidebar.scrollLeft,
        tabHeight: tRect.height
      };
    })()`);
    assert.ok(tab0Info?.active && tab0Info?.visible && tab0Info?.scrollLeft === 0);
    assert.ok((tab0Info?.tabHeight || 0) >= 35);

    await evalJS('(() => { const n = document.getElementById("navContent"); n.scrollTop = 800; n.dispatchEvent(new Event("scroll")); })()');
    await waitFor(evalJS, `(() => {
      const activeTab = document.getElementById("sidebar")?.querySelector(".sidebar-item.active");
      return activeTab && activeTab.id !== "cat-tab-0";
    })()`);
    const scrolledInfo = await evalJS(`(() => {
      const activeTab = document.getElementById('sidebar').querySelector('.sidebar-item.active');
      return activeTab ? activeTab.id : null;
    })()`);
    assert.notEqual(scrolledInfo, 'cat-tab-0');

    await evalJS('(() => { const n = document.getElementById("navContent"); n.scrollTop = 0; n.dispatchEvent(new Event("scroll")); })()');
    await waitFor(evalJS, `(() => {
      const activeTab = document.getElementById("sidebar")?.querySelector(".sidebar-item.active");
      return activeTab && activeTab.id === "cat-tab-0";
    })()`);
    const restoredInfo = await evalJS(`(() => {
      const tab0 = document.getElementById('cat-tab-0'), sidebar = document.getElementById('sidebar');
      if (!tab0 || !sidebar) return null;
      const tRect = tab0.getBoundingClientRect(), sRect = sidebar.getBoundingClientRect();
      return {
        active: tab0.classList.contains('active'),
        scrollLeft: sidebar.scrollLeft,
        visible: tRect.left >= sRect.left && tRect.right <= sRect.right
      };
    })()`);
    assert.ok(restoredInfo.active && restoredInfo.scrollLeft === 0 && restoredInfo.visible);
  } finally {
    await chrome.close();
    await server.close();
  }
});

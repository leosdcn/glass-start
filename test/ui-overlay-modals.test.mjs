/** 验证弹窗栈、唤醒恢复与焦点无障碍交互。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { launchSession, navigateAndWait, pressKey, waitFor } from './support/helpers.mjs';

test('页面刷新状态保持、跳出返回防白屏与触觉倾斜恢复', async () => {
  const { server, chrome, evalJS } = await launchSession();
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

test('重新加载与唤醒后导航保留书签焦点并可继续用 PageDown 滚动', async () => {
  const { server, chrome, send, evalJS, port } = await launchSession();
  try {
    await evalJS('sessionStorage.setItem("startpage_section", "nav")');
    await navigateAndWait(send, evalJS, `http://127.0.0.1:${port}/?restore=nav`, 'window.state?.currentSection === "nav"');
    assert.equal(await evalJS('document.activeElement === dom.navContent'), true);
    for (const type of ['rawKeyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', { type, key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 });
    }
    await waitFor(evalJS, 'dom.navContent.scrollTop > 0');
    await evalJS(`dom.navContent.querySelector('.nav-bookmark').focus({ preventScroll: true });
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));`);
    assert.equal(await evalJS("document.activeElement.matches('.nav-bookmark')"), true);
    await evalJS(`document.activeElement.blur();
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));`);
    assert.equal(await evalJS('document.activeElement === dom.navContent'), true);
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

test('天气与引擎菜单退场仍可见，关闭后立即退出键盘焦点顺序', async () => {
  const { server, chrome, send, evalJS } = await launchSession();
  try {
    await evalJS(`renderWeatherPopover({ location: { name: '上海' }, current: { temp: 25, weatherText: '晴' }, daily: [] })`);
    for (const [id, triggerId, tabCount] of [['weatherPopover', 'weatherBtn', 1], ['dropdownMenu', 'engineBtn', 3]]) {
      await evalJS(`document.getElementById('${triggerId}').click()`);
      await waitFor(evalJS, `getComputedStyle(document.getElementById('${id}')).opacity === '1'`);
      assert.equal(await evalJS(`(() => {
        const panel = document.getElementById('${id}');
        panel.click();
        return !panel.inert;
      })()`), true);
      await evalJS(`(() => {
        const panel = document.getElementById('${id}');
        panel.querySelector('button').focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        panel.getAnimations().forEach(animation => animation.pause());
      })()`);
      const state = await evalJS(`(() => {
        const panel = document.getElementById('${id}');
        return [panel.inert, panel.getAttribute('aria-hidden'), getComputedStyle(panel).visibility, document.activeElement.id];
      })()`);
      assert.deepEqual(state, [true, 'true', 'visible', triggerId]);
      for (let step = 0; step < Number(tabCount); step++) {
        for (const type of ['rawKeyDown', 'keyUp']) {
          await send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        }
        assert.equal(await evalJS(`document.getElementById('${id}').contains(document.activeElement)`), false);
      }
      await evalJS(`document.getElementById('${id}').getAnimations().forEach(animation => animation.finish())`);
      assert.equal(await evalJS(`(() => {
        const panel = document.getElementById('${id}');
        document.getElementById('${triggerId}').click();
        document.body.click();
        return panel.inert;
      })()`), true);
    }
  } finally {
    await chrome.close();
    await server.close();
  }
});

test('减弱动效切换时结束搜索图标动画，旧书签行不补播入场', async () => {
  const { server, chrome, send, evalJS } = await launchSession();
  const motion = value => send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value }]
  });
  try {
    assert.equal(await evalJS(`(() => {
      dom.engineBtn.click();
      dom.dropdownMenu.querySelector('[data-engine]:not([aria-checked="true"])').click();
      const animations = dom.engineIcon.getAnimations({ subtree: true });
      animations.forEach(animation => animation.pause());
      return animations.length;
    })()`), 2);
    await motion('reduce');
    await waitFor(evalJS, '!dom.engineIcon.querySelector("[data-leaving]") && dom.engineIcon.getAnimations({subtree: true}).length === 0');
    const scrollBehavior = await evalJS(`(() => {
      const input = dom.searchInput;
      input.focus();
      input.value = 'github';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const item = dom.suggestionMenu.querySelector('.suggestion-item');
      if (!item) return null;
      let behavior;
      item.scrollIntoView = options => { behavior = options.behavior; };
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      hideSuggestions();
      return behavior;
    })()`);
    assert.equal(scrollBehavior, 'instant', '减弱动效时键盘选择联想项立即滚动');
    await evalJS('openEditModal()');
    await evalJS('dom.addBookmarkBtn.click()');
    await motion('no-preference');
    assert.equal(await evalJS("dom.editList.querySelector('.edit-row-card:last-child').getAnimations().length"), 0);
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
    assert.deepEqual(await evalJS(`(() => {
      dom.editBookmarksBtn.focus();
      dom.editBookmarksBtn.click();
      return [dom.editModal.open, dom.editBookmarksBtn.getAttribute('aria-expanded')];
    })()`), [false, 'false']);
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

    await evalJS(`(() => {
      dom.jsonDropzone.focus();
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File(['invalid json'], 'bookmarks.json', { type: 'application/json' }));
      dom.jsonDropzone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    })()`);
    await waitFor(evalJS, 'dom.confirmModal.open');
    assert.equal(await evalJS("dom.jsonDropzone.getAttribute('aria-expanded')"), null);
    await evalJS('dom.confirmOkBtn.click()');
    await waitFor(evalJS, 'document.activeElement === dom.jsonDropzone');

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

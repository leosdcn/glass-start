/** 验证双屏切换、输入保护、滚轮与触屏手势。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { launchSession, tyOf, pressKey, waitFor } from './support/helpers.mjs';

test('双屏手势与键盘切屏交互套件', async () => {
  const { server, chrome, send, evalJS } = await launchSession();
  try {
    await waitFor(evalJS, 'typeof isScreenTransitioning === "function"');

    const press = (key) => pressKey(evalJS, key);
    const section = async () => evalJS(`document.getElementById('startSection').getAttribute('aria-hidden') === 'true' ? 'nav' : 'start'`);
    const focus = async () => evalJS(`document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : 'none'`);
    const waitForScreen = target => waitFor(evalJS, `state.currentSection === '${target}' && !isScreenTransitioning() && (() => {
      const el = document.getElementById('${target}Section');
      const t = el ? getComputedStyle(el).transform : '';
      return !t || t === 'none' || Math.abs(new DOMMatrixReadOnly(t).m42) < 2;
    })()`);
    // 过渡结束后允许亚像素误差，避免 Linux/CI 的 matrix 尾数导致严格等于 0 失败。
    const nearZero = value => value !== null && Math.abs(value) < 2;

    // ══════════════════════════════════════════════════════════════════════
    // 1. 双屏切屏状态机与键盘导航完整闭环
    // ══════════════════════════════════════════════════════════════════════

    // 1.1 初始状态
    const init = await evalJS(`(() => {
      const s = document.getElementById('startSection'), n = document.getElementById('navSection');
      return {
        scrollY: window.scrollY,
        startTransform: getComputedStyle(s).transform,
        navTransform: getComputedStyle(n).transform,
        startAria: s.getAttribute('aria-hidden'),
        navAria: n.getAttribute('aria-hidden'),
        gearInteractive: getComputedStyle(document.getElementById('editBookmarksBtn')).pointerEvents !== 'none',
      };
    })()`);
    const initValid = init.scrollY === 0 && (init.startTransform === 'none' || init.startTransform === 'matrix(1, 0, 0, 1, 0, 0)')
      && tyOf(init.navTransform) > 599 && init.navAria === 'true' && init.startAria !== 'true' && init.gearInteractive;
    assert.ok(initValid, '初始状态合规');

    // 1.2 JS API 切换到 Nav
    await evalJS('window.switchToNav()'); await waitForScreen('nav');
    const navState = await evalJS(`(() => {
      const s = document.getElementById('startSection'), n = document.getElementById('navSection');
      return {
        scrollY: window.scrollY,
        startTransform: getComputedStyle(s).transform,
        target: document.documentElement.dataset.screen,
        navTransform: getComputedStyle(n).transform,
        navAria: n.getAttribute('aria-hidden'),
        gearInteractive: getComputedStyle(document.getElementById('editBookmarksBtn')).pointerEvents !== 'none',
      };
    })()`);
    const navValid = nearZero(tyOf(navState.navTransform)) && navState.scrollY === 0 && navState.target === 'nav'
      && navState.navAria !== 'true' && !navState.gearInteractive;
    assert.ok(navValid, '切至 Nav 状态合规');

    // 1.3 切回 Start + ArrowDown 切屏
    await evalJS('window.switchToStart()'); await waitForScreen('start');
    const focusAfterStart = await focus();
    await press('ArrowDown'); await waitForScreen('nav');
    assert.equal(await section(), 'nav');

    // 1.4 盲打自动聚焦
    await evalJS('window.switchToStart()'); await waitForScreen('start');
    await press('g');
    await waitFor(evalJS, 'document.activeElement?.id === "searchInput"');
    assert.equal(await focus(), 'searchInput');

    // 1.5 PageDown 按键切屏
    await evalJS('window.switchToStart()'); await waitForScreen('start');
    await evalJS(`(async () => {
      document.activeElement && document.activeElement.blur && document.activeElement.blur();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true }));
    })()`);
    await waitForScreen('nav');
    assert.equal(await evalJS('document.documentElement.dataset.screen === "nav"'), true);
    assert.equal(focusAfterStart, 'BODY');

    // 合成 KeyboardEvent 不触发浏览器默认滚动；用 CDP 真实按键验证切屏后的连续滚动。
    const nativeKey = async (key, windowsVirtualKeyCode) => {
      for (const type of ['keyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode });
      }
    };
    for (const [key, keyCode] of [['ArrowDown', 40], ['PageDown', 34]]) {
      await evalJS('switchToStart()'); await waitForScreen('start');
      await evalJS('dom.searchInput.focus()');
      await nativeKey(key, keyCode); await waitForScreen('nav');
      const contentFocused = (await focus()) === 'navContent';
      await nativeKey('ArrowDown', 40);
      await waitFor(evalJS, 'dom.navContent.scrollTop > 0');
      await new Promise(resolve => setTimeout(resolve, 250));
      const scrollTop = await evalJS('dom.navContent.scrollTop');
      await nativeKey('ArrowUp', 38);
      await waitFor(evalJS, `dom.navContent.scrollTop < ${scrollTop}`);
      assert.ok(contentFocused && (await section()) === 'nav', `${key} 从搜索框切屏后无需点击即可上下滚动`);
    }

    // ══════════════════════════════════════════════════════════════════════
    // 2. 键盘方向键在联想/弹窗与顶端的输入保护
    // ══════════════════════════════════════════════════════════════════════

    await evalJS('window.switchToStart()'); await waitForScreen('start');
    await evalJS(`(function(){
      const i = document.getElementById('searchInput');
      i.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, 'git');
      i.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await waitFor(evalJS, 'document.querySelectorAll("#suggestionMenu .suggestion-item").length > 0');
    await press('ArrowDown');
    await waitFor(evalJS, 'document.querySelector("#suggestionMenu .suggestion-item.active") !== null');
    assert.equal(await section(), 'start', '联想菜单展开时 ArrowDown 不触发切屏');
    await press('Escape');
    await waitFor(evalJS, '!document.getElementById("suggestionMenu").classList.contains("active") && OverlayStack.isEmpty()');

    await evalJS('window.switchToNav()'); await waitForScreen('nav');
    await evalJS('window.switchToStart()'); await waitForScreen('start');
    await evalJS('document.getElementById("editBookmarksBtn").click()');
    await waitFor(evalJS, 'OverlayStack.top()?.id === "editModal"');
    await evalJS(`document.querySelector('.edit-row-card input').focus()`);
    await press('ArrowDown');
    await waitFor(evalJS, '!isScreenTransitioning() && state.currentSection === "start"');
    assert.equal(await section(), 'start', '弹窗输入框内 ArrowDown 不触发切屏');
    await evalJS('document.getElementById("cancelEditBtn").click()');
    await waitFor(evalJS, '!document.getElementById("editModal").open && OverlayStack.isEmpty()');

    await evalJS('window.switchToNav()'); await waitForScreen('nav');
    await evalJS('document.getElementById("navContent").scrollTop = 0');
    await waitFor(evalJS, 'document.getElementById("navContent").scrollTop === 0');
    await evalJS('dom.sidebarList.firstElementChild.focus()');
    await nativeKey('ArrowUp', 38);
    assert.equal(await section(), 'nav', '侧栏处理的 ArrowUp 不应返回首页');
    assert.equal(await evalJS('document.activeElement === dom.sidebarList.lastElementChild'), true);
    await nativeKey('Home', 36);
    assert.equal(await section(), 'nav', '侧栏处理的 Home 不应返回首页');
    assert.equal(await evalJS('document.activeElement === dom.sidebarList.firstElementChild'), true);
    await waitFor(evalJS, 'dom.navContent.scrollTop === 0');
    await evalJS('document.activeElement && document.activeElement.blur()');
    await press('ArrowUp'); await waitForScreen('start');
    assert.equal(await section(), 'start', 'Nav 顶端 ArrowUp 返回 Start');

    // ══════════════════════════════════════════════════════════════════════
    // 3. 滚轮与触屏手势切屏及内部滚动拦截机制
    // ══════════════════════════════════════════════════════════════════════

    await waitFor(evalJS, '!isScreenTransitioning() && OverlayStack.isEmpty()');
    await evalJS(`(function(){
      document.dispatchEvent(new WheelEvent('wheel', { deltaY: 60, cancelable: true }));
      setTimeout(() => document.dispatchEvent(new WheelEvent('wheel', { deltaY: 60, cancelable: true })), 30);
    })()`); await waitForScreen('nav');
    assert.ok(nearZero(tyOf(await evalJS('getComputedStyle(document.getElementById("navSection")).transform'))));

    await evalJS('switchToStart()'); await waitForScreen('start');

    await evalJS(`(function(){
      const tc = (y) => new Touch({ identifier: 1, target: document.body, clientX: 0, clientY: y });
      document.dispatchEvent(new TouchEvent('touchstart', { touches: [tc(400)], cancelable: true }));
      document.dispatchEvent(new TouchEvent('touchmove', { touches: [tc(260)], cancelable: true }));
      document.dispatchEvent(new TouchEvent('touchend', { changedTouches: [tc(260)], cancelable: true }));
    })()`); await waitForScreen('nav');
    assert.ok(nearZero(tyOf(await evalJS('getComputedStyle(document.getElementById("navSection")).transform'))));

    // 触屏快速轻扫：位移与速度共同决定是否切屏。
    await evalJS('window.switchToStart()'); await waitForScreen('start');
    const flick = async (from, to, target) => {
      await evalJS(`(async () => {
        const tc = y => new Touch({ identifier: 2, target: document.body, clientX: 0, clientY: y });
        document.getElementById('navContent').scrollTop = 0;
        document.dispatchEvent(new TouchEvent('touchstart', { touches: [tc(${from})], cancelable: true }));
        await new Promise(resolve => setTimeout(resolve, 50));
        document.dispatchEvent(new TouchEvent('touchend', { changedTouches: [tc(${to})], cancelable: true }));
      })()`);
      await waitForScreen(target);
    };
    await flick(300, 270, 'nav');
    assert.ok(nearZero(tyOf(await evalJS('getComputedStyle(dom.navSection).transform'))));
    await flick(270, 300, 'start');
    assert.ok(nearZero(tyOf(await evalJS('getComputedStyle(dom.startSection).transform'))));

    // 横向轻扫即使带有足够的纵向位移，松手时也不能触发切屏。
    for (const target of ['start', 'nav']) {
      if (target === 'nav') { await evalJS('switchToNav()'); await waitForScreen('nav'); }
      const horizontal = await evalJS(`(() => {
        const from = ${target === 'start' ? 400 : 360};
        const to = ${target === 'start' ? 360 : 400};
        const touch = (x, y) => new Touch({ identifier: 3, target: document.body, clientX: x, clientY: y });
        dom.navContent.scrollTop = 0;
        document.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(10, from)], cancelable: true }));
        document.dispatchEvent(new TouchEvent('touchmove', { touches: [touch(310, to)], cancelable: true }));
        document.dispatchEvent(new TouchEvent('touchend', { changedTouches: [touch(310, to)], cancelable: true }));
        return { section: state.currentSection, transitioning: isScreenTransitioning() };
      })()`);
      assert.ok(horizontal.section === target && !horizontal.transitioning, `${target} 屏横向轻扫不误切屏`);
    }
  } finally {
    await chrome.close();
    await server.close();
  }
});

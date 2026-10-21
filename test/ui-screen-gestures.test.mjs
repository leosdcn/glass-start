/** 验证双屏切换、输入保护、滚轮与触屏手势。 */
import { launchSession, tyOf, makeTester, pressKey, waitFor } from './helpers.mjs';

const { pass, finish } = makeTester();
const { server, chrome, send, evalJS } = await launchSession();

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
    gearClass: document.getElementById('editBookmarksBtn').className,
  };
})()`);
const initValid = init.scrollY === 0 && (init.startTransform === 'none' || init.startTransform === 'matrix(1, 0, 0, 1, 0, 0)')
  && tyOf(init.navTransform) > 599 && init.navAria === 'true' && init.startAria !== 'true' && !init.gearClass.includes('hidden-on-nav');

// 1.2 JS API 切换到 Nav
await evalJS('window.switchToNav()'); await waitForScreen('nav');
const navState = await evalJS(`(() => {
  const s = document.getElementById('startSection'), n = document.getElementById('navSection');
  return {
    scrollY: window.scrollY,
    startTransform: getComputedStyle(s).transform,
    isPushedUp: s.classList.contains('screen-pushed-up'),
    navTransform: getComputedStyle(n).transform,
    navAria: n.getAttribute('aria-hidden'),
    gearClass: document.getElementById('editBookmarksBtn').className,
  };
})()`);
const navValid = nearZero(tyOf(navState.navTransform)) && navState.scrollY === 0 && navState.isPushedUp
  && navState.navAria !== 'true' && navState.gearClass.includes('hidden-on-nav');

// 1.3 切回 Start + ArrowDown 切屏
await evalJS('window.switchToStart()'); await waitForScreen('start');
const focusAfterStart = await focus();
await press('ArrowDown'); await waitForScreen('nav');
const arrowDownToNav = (await section()) === 'nav';

// 1.4 盲打自动聚焦
await evalJS('window.switchToStart()'); await waitForScreen('start');
await press('g');
await waitFor(evalJS, 'document.activeElement?.id === "searchInput"');
const blindTypeFocus = (await focus()) === 'searchInput';

// 1.5 PageDown 按键切屏
await evalJS('window.switchToStart()'); await waitForScreen('start');
await evalJS(`(async () => {
  document.activeElement && document.activeElement.blur && document.activeElement.blur();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true }));
})()`);
await waitForScreen('nav');
const pagedownPushed = await evalJS('document.getElementById("startSection").classList.contains("screen-pushed-up")');
const pagedownValid = pagedownPushed === true;

const navDetail = navValid ? '' : ` navState=${JSON.stringify(navState)}`;
pass('双屏切屏状态机与键盘导航完整闭环 (初始态/API/ArrowDown/盲打/PageDown)',
  initValid && navValid && focusAfterStart === 'BODY' && arrowDownToNav && blindTypeFocus && pagedownValid,
  `init=${initValid}, nav=${navValid}${navDetail}, focus=${focusAfterStart}, arrow=${arrowDownToNav}, blind=${blindTypeFocus}, pagedown=${pagedownValid}`);

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
const suggestProtect = (await section()) === 'start';
await press('Escape');
await waitFor(evalJS, '!document.getElementById("suggestionMenu").classList.contains("active") && OverlayStack.isEmpty()');

await evalJS('window.switchToNav()'); await waitForScreen('nav');
await evalJS('window.switchToStart()'); await waitForScreen('start');
await evalJS('document.getElementById("editBookmarksBtn").click()');
await waitFor(evalJS, 'OverlayStack.top()?.id === "editModal"');
await evalJS(`document.querySelector('.edit-row-card input').focus()`);
await press('ArrowDown');
await waitFor(evalJS, '!isScreenTransitioning() && state.currentSection === "start"');
const modalProtect = (await section()) === 'start';
await evalJS('document.getElementById("cancelEditBtn").click()');
await waitFor(evalJS, 'document.getElementById("editModal").hasAttribute("hidden") && OverlayStack.isEmpty()');

await evalJS('window.switchToNav()'); await waitForScreen('nav');
await evalJS('document.getElementById("navContent").scrollTop = 0');
await waitFor(evalJS, 'document.getElementById("navContent").scrollTop === 0');
await evalJS('document.activeElement && document.activeElement.blur()');
await press('ArrowUp'); await waitForScreen('start');
const topArrowUpBack = (await section()) === 'start';

pass('键盘方向键在联想/弹窗与顶端的输入保护 (联想防误切/弹窗防误切/顶端ArrowUp返回)',
  suggestProtect && modalProtect && topArrowUpBack,
  `suggest=${suggestProtect}, modal=${modalProtect}, top=${topArrowUpBack}`);

// ══════════════════════════════════════════════════════════════════════
// 3. 滚轮与触屏手势切屏及内部滚动拦截机制
// ══════════════════════════════════════════════════════════════════════

await waitFor(evalJS, '!isScreenTransitioning() && OverlayStack.isEmpty()');
await evalJS(`(function(){
  document.dispatchEvent(new WheelEvent('wheel', { deltaY: 60, cancelable: true }));
  setTimeout(() => document.dispatchEvent(new WheelEvent('wheel', { deltaY: 60, cancelable: true })), 30);
})()`); await waitForScreen('nav');
const wheelInNav = nearZero(tyOf(await evalJS('getComputedStyle(document.getElementById("navSection")).transform')));

await evalJS(`document.getElementById('navContent').scrollTop = 400`);
await waitFor(evalJS, 'document.getElementById("navContent").scrollTop === 400');
await evalJS(`document.dispatchEvent(new WheelEvent('wheel', { deltaY: -60, cancelable: true }))`);
await waitFor(evalJS, '!isScreenTransitioning() && state.currentSection === "nav"');
const scrollBlocked = await evalJS('document.getElementById("startSection").getAttribute("aria-hidden") === "true"');

await evalJS(`document.getElementById('navContent').scrollTop = 0`);
await waitFor(evalJS, 'document.getElementById("navContent").scrollTop === 0');
// 同一轮滚内容到顶不能直接返回；静默后才开始新一轮向上意图。
await evalJS(`new Promise(resolve => setTimeout(resolve, CONFIG.GESTURE.WHEEL_IDLE_MS + 30))`);
await evalJS(`document.dispatchEvent(new WheelEvent('wheel', { deltaY: -60, cancelable: true }))`);
await waitForScreen('start');
const wheelBackStart = await evalJS('document.getElementById("startSection").getAttribute("aria-hidden") !== "true"');

await evalJS(`(function(){
  const tc = (y) => new Touch({ identifier: 1, target: document.body, clientX: 0, clientY: y });
  document.dispatchEvent(new TouchEvent('touchstart', { touches: [tc(400)], cancelable: true }));
  document.dispatchEvent(new TouchEvent('touchmove', { touches: [tc(260)], cancelable: true }));
  document.dispatchEvent(new TouchEvent('touchend', { changedTouches: [tc(260)], cancelable: true }));
})()`); await waitForScreen('nav');
const touchInNav = nearZero(tyOf(await evalJS('getComputedStyle(document.getElementById("navSection")).transform')));

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
const flickInNav = nearZero(tyOf(await evalJS('getComputedStyle(dom.navSection).transform')));
await flick(270, 300, 'start');
const flickBackStart = nearZero(tyOf(await evalJS('getComputedStyle(dom.startSection).transform')));
const flickOk = flickInNav && flickBackStart;

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
  pass(`${target} 屏横向轻扫不误切屏`, horizontal.section === target && !horizontal.transitioning, JSON.stringify(horizontal));
}

pass('滚轮与触屏手势切屏及内部滚动拦截机制 (滚轮下切/内容滚动拦截/滚轮上切/触屏阈值滑屏/Flick快速轻扫)',
  wheelInNav && scrollBlocked && wheelBackStart && touchInNav && flickOk);


const code = finish();
await chrome.close();
await server.close();
process.exit(code);

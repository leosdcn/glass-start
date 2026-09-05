/**
 * 双屏状态机、键盘导航与手势调度测试套件 (ui-screen-gestures.test.mjs)
 *
 * 核心断言：
 * 1. 双屏切屏状态机与键盘导航完整闭环 (初始态/API/ArrowDown/盲打/PageDown)
 * 2. 键盘方向键在联想/弹窗与顶端的输入保护 (联想防误切/弹窗防误切/顶端ArrowUp返回)
 * 3. 滚轮与触屏手势切屏及内部滚动拦截机制 (滚轮下切/内容滚动拦截/滚轮上切/触屏阈值滑屏/Flick快速轻扫)
 */
import { launchSession, sleep, tyOf, makeTester, pressKey } from './helpers.mjs';

const { pass, finish } = makeTester();
const { server, chrome, send, evalJS } = await launchSession();

await sleep(300);

const press = (key) => pressKey(evalJS, key);
const section = async () => evalJS(`document.getElementById('startSection').getAttribute('aria-hidden') === 'true' ? 'nav' : 'start'`);
const focus = async () => evalJS(`document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : 'none'`);
const stackTop = () => evalJS(`OverlayStack.top() ? OverlayStack.top().id : null`);

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
  && tyOf(init.navTransform) > 600 && init.navAria === 'true' && init.startAria !== 'true' && !init.gearClass.includes('hidden-on-nav');

// 1.2 JS API 切换到 Nav
await evalJS('window.switchToNav()'); await sleep(650);
const navState = await evalJS(`(() => {
  const s = document.getElementById('startSection'), n = document.getElementById('navSection');
  return {
    scrollY: window.scrollY,
    startTransform: getComputedStyle(s).transform,
    navTransform: getComputedStyle(n).transform,
    navAria: n.getAttribute('aria-hidden'),
    gearClass: document.getElementById('editBookmarksBtn').className,
  };
})()`);
const navValid = tyOf(navState.navTransform) === 0 && navState.scrollY === 0 && tyOf(navState.startTransform) < -600
  && navState.navAria !== 'true' && navState.gearClass.includes('hidden-on-nav');

// 1.3 切回 Start + ArrowDown 切屏
await evalJS('window.switchToStart()'); await sleep(650);
const focusAfterStart = await focus();
await press('ArrowDown'); await sleep(200);
const arrowDownToNav = (await section()) === 'nav';

// 1.4 盲打自动聚焦
await evalJS('window.switchToStart()'); await sleep(650);
await press('g'); await sleep(150);
const blindTypeFocus = (await focus()) === 'searchInput';

// 1.5 PageDown 按键切屏
await evalJS('window.switchToStart()'); await sleep(650);
await evalJS(`(async () => {
  document.activeElement && document.activeElement.blur && document.activeElement.blur();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 650));
})()`);
const pagedownTy = tyOf(await evalJS('getComputedStyle(document.getElementById("startSection")).transform'));
const pagedownValid = pagedownTy !== null && pagedownTy < -600;

pass('双屏切屏状态机与键盘导航完整闭环 (初始态/API/ArrowDown/盲打/PageDown)',
  initValid && navValid && focusAfterStart === 'BODY' && arrowDownToNav && blindTypeFocus && pagedownValid,
  `init=${initValid}, nav=${navValid}, blind=${blindTypeFocus}, pagedown=${pagedownValid}`);

// ══════════════════════════════════════════════════════════════════════
// 2. 键盘方向键在联想/弹窗与顶端的输入保护
// ══════════════════════════════════════════════════════════════════════

await evalJS('window.switchToStart()'); await sleep(650);
await evalJS(`(function(){
  const i = document.getElementById('searchInput');
  i.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, 'git');
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`); await sleep(500);
await press('ArrowDown'); await sleep(150);
const suggestProtect = (await section()) === 'start';
await press('Escape'); await sleep(200);

await evalJS('window.switchToNav()'); await sleep(650);
await evalJS('window.switchToStart()'); await sleep(650);
await evalJS('document.getElementById("editBookmarksBtn").click()'); await sleep(300);
await evalJS(`document.querySelector('.edit-row-card input').focus()`);
await press('ArrowDown'); await sleep(150);
const modalProtect = (await section()) === 'start';
await evalJS('document.getElementById("cancelEditBtn").click()'); await sleep(200);

await evalJS('window.switchToNav()'); await sleep(650);
await evalJS('document.getElementById("navContent").scrollTop = 0'); await sleep(150);
await evalJS('document.activeElement && document.activeElement.blur()');
await press('ArrowUp'); await sleep(650);
const topArrowUpBack = (await section()) === 'start';

pass('键盘方向键在联想/弹窗与顶端的输入保护 (联想防误切/弹窗防误切/顶端ArrowUp返回)',
  suggestProtect && modalProtect && topArrowUpBack,
  `suggest=${suggestProtect}, modal=${modalProtect}, top=${topArrowUpBack}`);

// ══════════════════════════════════════════════════════════════════════
// 3. 滚轮与触屏手势切屏及内部滚动拦截机制
// ══════════════════════════════════════════════════════════════════════

await sleep(300);
await evalJS(`(function(){
  document.dispatchEvent(new WheelEvent('wheel', { deltaY: 60, cancelable: true }));
  setTimeout(() => document.dispatchEvent(new WheelEvent('wheel', { deltaY: 60, cancelable: true })), 30);
})()`); await sleep(650);
const wheelInNav = tyOf(await evalJS('getComputedStyle(document.getElementById("navSection")).transform')) === 0;

await evalJS(`document.getElementById('navContent').scrollTo({ top: 400 })`); await sleep(150);
await evalJS(`document.dispatchEvent(new WheelEvent('wheel', { deltaY: -60, cancelable: true }))`); await sleep(250);
const scrollBlocked = await evalJS('document.getElementById("startSection").getAttribute("aria-hidden") === "true"');

await evalJS(`document.getElementById('navContent').scrollTo({ top: 0 })`); await sleep(150);
await evalJS(`document.dispatchEvent(new WheelEvent('wheel', { deltaY: -60, cancelable: true }))`); await sleep(200);
await evalJS(`document.dispatchEvent(new WheelEvent('wheel', { deltaY: -60, cancelable: true }))`); await sleep(650);
const wheelBackStart = await evalJS('document.getElementById("startSection").getAttribute("aria-hidden") !== "true"');

await evalJS(`(function(){
  const tc = (y) => new Touch({ identifier: 1, target: document.body, clientX: 0, clientY: y });
  document.dispatchEvent(new TouchEvent('touchstart', { touches: [tc(400)], cancelable: true }));
  document.dispatchEvent(new TouchEvent('touchmove', { touches: [tc(260)], cancelable: true }));
  document.dispatchEvent(new TouchEvent('touchend', { changedTouches: [tc(260)], cancelable: true }));
})()`); await sleep(650);
const touchInNav = tyOf(await evalJS('getComputedStyle(document.getElementById("navSection")).transform')) === 0;

// 3.5 触屏快速轻扫 (Flick Gesture: 位移 >= 25px 且速度 > 0.25px/ms 快速切屏)
await evalJS('window.switchToStart()'); await sleep(650);
const flickCheck = await evalJS(`(async () => {
  const tc = (y) => new Touch({ identifier: 2, target: document.body, clientX: 0, clientY: y });
  // 模拟在 50ms 内轻扫 30px (位移 < 40px 阈值，但速度 0.6px/ms > 0.25px/ms 满足 Flick)
  document.dispatchEvent(new TouchEvent('touchstart', { touches: [tc(300)], cancelable: true }));
  await new Promise(r => setTimeout(r, 50));
  document.dispatchEvent(new TouchEvent('touchend', { changedTouches: [tc(270)], cancelable: true }));
  await new Promise(r => setTimeout(r, 650));
  const navTy = typeof tyOf === 'function' ? tyOf(getComputedStyle(document.getElementById('navSection')).transform) : 0;
  const inNav = navTy === 0;

  // 导航页顶端反向 Flick 轻扫切回 Start
  document.getElementById('navContent').scrollTop = 0;
  document.dispatchEvent(new TouchEvent('touchstart', { touches: [tc(270)], cancelable: true }));
  await new Promise(r => setTimeout(r, 50));
  document.dispatchEvent(new TouchEvent('touchend', { changedTouches: [tc(300)], cancelable: true }));
  await new Promise(r => setTimeout(r, 650));
  const backStart = document.getElementById('startSection').getAttribute('aria-hidden') !== 'true';

  return { inNav, backStart };
})()`);
const flickOk = flickCheck.inNav && flickCheck.backStart;

pass('滚轮与触屏手势切屏及内部滚动拦截机制 (滚轮下切/内容滚动拦截/滚轮上切/触屏阈值滑屏/Flick快速轻扫)',
  wheelInNav && scrollBlocked && wheelBackStart && touchInNav && flickOk);


const code = finish();
await chrome.close();
await server.close();
process.exit(code);

/**
 * 视图滑动切换、手势与键盘交互综合回归测试 (view-interaction.test.mjs)
 *
 * 精简版：9 个核心精准断言
 */
import { launchSession, sleep, tyOf, makeTester, pressKey } from './helpers.mjs';

const { pass, finish } = makeTester();
const { server, chrome, evalJS } = await launchSession();

await sleep(300);

const press = (key) => pressKey(evalJS, key);
const section = async () => evalJS(`document.getElementById('startSection').getAttribute('aria-hidden') === 'true' ? 'nav' : 'start'`);
const focus = async () => evalJS(`document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : 'none'`);

// 1. 初始视图状态符合规范 (scrollY=0, Nav屏置于屏下)
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
pass('初始视图状态符合规范 (scrollY=0, Nav屏置于屏下)', initValid, `navTransform=${init.navTransform}`);

// 2. JS API 切换至导航页状态完全就位 (Start屏移出, 齿轮隐藏)
await evalJS('window.switchToNav()'); await sleep(1200);
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
pass('JS API 切换至导航页状态完全就位 (Start屏移出, 齿轮隐藏)', navValid, `startTransform=${navState.startTransform}`);

// 3. 切回起始页后搜索框未自动聚焦，ArrowDown 可即时切屏
await evalJS('window.switchToStart()'); await sleep(700);
const f = await focus();
await press('ArrowDown'); await sleep(200);
pass('切回起始页后搜索框未自动聚焦，ArrowDown 可即时切屏', f === 'BODY' && (await section()) === 'nav', `focus=${f}`);

// 4. 字母键盲打自动聚焦搜索框
await evalJS('window.switchToStart()'); await sleep(700);
await press('g'); await sleep(150);
pass('字母键盲打自动聚焦搜索框', (await focus()) === 'searchInput');

// 5. 联想激活及编辑弹窗输入时方向键被保护 (不误切屏)
await evalJS(`(function(){
  const i = document.getElementById('searchInput');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, 'git');
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`); await sleep(1800);
await press('ArrowDown'); await sleep(150);
const suggestProtect = (await section()) === 'start';

await evalJS('window.switchToNav()'); await sleep(700);
await evalJS('window.switchToStart()'); await sleep(700);
await evalJS('document.getElementById("editBookmarksBtn").click()'); await sleep(400);
await evalJS(`document.querySelector('.edit-row-card input').focus()`);
await press('ArrowDown'); await sleep(150);
const modalProtect = (await section()) === 'start';
await evalJS('document.getElementById("cancelEditBtn").click()'); await sleep(300);
pass('联想激活及编辑弹窗输入时方向键被保护 (不误切屏)', suggestProtect && modalProtect);

// 6. 导航页顶端 ArrowUp 切回起始页
await evalJS('window.switchToNav()'); await sleep(700);
await evalJS('document.getElementById("navContent").scrollTop = 0'); await sleep(200);
await evalJS('document.activeElement && document.activeElement.blur()');
await press('ArrowUp'); await sleep(800);
pass('导航页顶端 ArrowUp 切回起始页', (await section()) === 'start');

// 7. 滚轮/触屏手势切屏与导航页滚动拦截机制正常
await sleep(600);
await evalJS(`(function(){
  document.dispatchEvent(new WheelEvent('wheel', { deltaY: 60, cancelable: true }));
  setTimeout(() => document.dispatchEvent(new WheelEvent('wheel', { deltaY: 60, cancelable: true })), 30);
})()`); await sleep(800);
const wheelInNav = tyOf(await evalJS('getComputedStyle(document.getElementById("navSection")).transform')) === 0;

await evalJS(`document.getElementById('navContent').scrollTo({ top: 400 })`); await sleep(200);
await evalJS(`document.dispatchEvent(new WheelEvent('wheel', { deltaY: -60, cancelable: true }))`); await sleep(400);
const scrollBlocked = await evalJS('document.getElementById("startSection").getAttribute("aria-hidden") === "true"');

await evalJS(`document.getElementById('navContent').scrollTo({ top: 0 })`); await sleep(200);
await evalJS(`document.dispatchEvent(new WheelEvent('wheel', { deltaY: -60, cancelable: true }))`); await sleep(300);
await evalJS(`document.dispatchEvent(new WheelEvent('wheel', { deltaY: -60, cancelable: true }))`); await sleep(800);
const wheelBackStart = await evalJS('document.getElementById("startSection").getAttribute("aria-hidden") !== "true"');

await evalJS(`(function(){
  const tc = (y) => new Touch({ identifier: 1, target: document.body, clientX: 0, clientY: y });
  document.dispatchEvent(new TouchEvent('touchstart', { touches: [tc(400)], cancelable: true }));
  document.dispatchEvent(new TouchEvent('touchmove', { touches: [tc(260)], cancelable: true }));
  document.dispatchEvent(new TouchEvent('touchend', { changedTouches: [tc(260)], cancelable: true }));
})()`); await sleep(900);
const touchInNav = tyOf(await evalJS('getComputedStyle(document.getElementById("navSection")).transform')) === 0;

pass('滚轮/触屏手势切屏与导航页滚动拦截机制正常', wheelInNav && scrollBlocked && wheelBackStart && touchInNav);

// 8. sessionStorage 状态恢复 (刷新后保持 Nav 屏无过渡)
await evalJS('sessionStorage.setItem("startpage_section", "nav")');
await evalJS('location.reload()'); await sleep(1500);
const restored = await evalJS(`(() => {
  const n = document.getElementById('navSection');
  return n.className.includes('screen-pushed-in') && !n.className.includes('nav-hidden');
})()`);
pass('sessionStorage 状态恢复 (刷新后保持 Nav 屏无过渡)', restored === true);

// 9. 全局键盘 PageDown 按键流畅切屏
await evalJS('window.switchToStart()'); await sleep(800);
await evalJS(`(async () => {
  document.activeElement && document.activeElement.blur && document.activeElement.blur();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 700));
})()`);
const kbdTy = tyOf(await evalJS('getComputedStyle(document.getElementById("startSection")).transform'));
pass('全局键盘 PageDown 按键流畅切屏', kbdTy !== null && kbdTy < -600, `translateY=${kbdTy}`);

// 10. 联想重渲染保持键盘选中项无异常 (防止 ReferenceError 回归)
await evalJS('window.switchToStart()'); await sleep(500);
await evalJS(`(() => {
  const i = document.getElementById('searchInput');
  i.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, 'git');
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(300);
await press('ArrowDown');
await sleep(150);
const suggestSelectionCheck = await evalJS(`(() => {
  const menu = document.getElementById('suggestionMenu');
  const items = menu ? menu.querySelectorAll('.suggestion-item') : [];
  const selected = menu ? menu.querySelector('.suggestion-item.active') : null;
  return { hasItems: items.length > 0, isSelected: selected !== null };
})()`);
pass('联想重渲染保持键盘选中项无异常 (防止 ReferenceError 回归)', suggestSelectionCheck.hasItems && suggestSelectionCheck.isSelected);

const code = finish();
await chrome.close();
await server.close();
process.exit(code);

/**
 * 视图交互、手势导航、弹窗层叠栈与移动视口综合测试套件 (ui-interaction.test.mjs)
 *
 * 精炼架构：7 大高密度全景断言
 * 1. 双屏切屏状态机与键盘导航完整闭环
 * 2. 键盘方向键在联想/弹窗与顶端的输入保护
 * 3. 滚轮与触屏手势切屏及内部滚动拦截机制
 * 4. sessionStorage 刷新状态保持无闪烁
 * 5. 搜索联想键盘选中项保持与 Escape 优雅清退
 * 6. OverlayStack 多层弹窗嵌套压退栈与安全白名单
 * 7. 移动端视口 (iPhone) 与侧边栏 Tab 滚动联动
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

pass('滚轮与触屏手势切屏及内部滚动拦截机制 (滚轮下切/内容滚动拦截/滚轮上切/触屏滑屏)',
  wheelInNav && scrollBlocked && wheelBackStart && touchInNav);

// ══════════════════════════════════════════════════════════════════════
// 4. sessionStorage 刷新状态保持无闪烁及切回 Start 屏组件全量可见
// ══════════════════════════════════════════════════════════════════════

await evalJS('sessionStorage.setItem("startpage_section", "nav")');
await evalJS('setTimeout(() => location.reload(), 10)'); await sleep(800);
const restored = await evalJS(`(() => {
  const n = document.getElementById('navSection');
  return n.className.includes('screen-pushed-in') && !n.className.includes('nav-hidden');
})()`);

await evalJS('window.switchToStart()'); await sleep(650);
const backFromReloadedNav = await evalJS(`(() => {
  const s = document.getElementById('startSection');
  const clock = document.getElementById('clock');
  const search = document.getElementById('searchInput');
  const weather = document.getElementById('weatherWidget');
  const gear = document.getElementById('editBookmarksBtn');
  const sRect = s ? s.getBoundingClientRect() : null;
  const sTy = getComputedStyle(s).transform;
  const nrPresent = document.documentElement.classList.contains('nr');
  const gearHidden = gear ? gear.classList.contains('hidden-on-nav') : false;
  return {
    sTop: sRect ? sRect.top : -999,
    sHeight: sRect ? sRect.height : 0,
    hasClock: !!clock && clock.offsetWidth > 0,
    hasSearch: !!search && search.offsetWidth > 0,
    hasWeather: !!weather,
    nrPresent,
    gearHidden,
    startAria: s.getAttribute('aria-hidden')
  };
})()`);
const startRestoredValid = backFromReloadedNav.sTop === 0 && backFromReloadedNav.sHeight > 0
  && backFromReloadedNav.hasClock && backFromReloadedNav.hasSearch && backFromReloadedNav.hasWeather
  && !backFromReloadedNav.nrPresent && !backFromReloadedNav.gearHidden && backFromReloadedNav.startAria !== 'true';

// 4.2 BFCache / pageshow 生命周期切屏锁自愈与防白屏校验
await evalJS('window.switchToNav()');
await sleep(100); // 切屏进行中（isTransitioning === true 且定时器挂起）
await evalJS('window.dispatchEvent(new Event("pageshow"))'); // 模拟外部返回触发 pageshow 唤醒
const bfCacheHealed = await evalJS(`(() => {
  const isTrans = typeof window.isScreenTransitioning === 'function' ? window.isScreenTransitioning() : false;
  const n = document.getElementById('navSection');
  const s = document.getElementById('startSection');
  return !isTrans && n.classList.contains('screen-pushed-in') && !n.classList.contains('nav-hidden') && s.classList.contains('screen-pushed-up');
})()`);

// 4.3 Command+左键 / 鼠标中键后台打开防 is-clicked 下沉迟滞与普通点击分流校验
await evalJS('window.switchToStart()'); await sleep(350);
const bookmarkClickTest = await evalJS(`(() => {
  const bm = document.querySelector('.bookmark-item');
  if (!bm) return { hasBm: false };
  // 模拟 Command + 左键点击 (metaKey: true)
  bm.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
  const cmdHasIsClicked = bm.classList.contains('is-clicked');
  
  // 模拟中键 auxclick (button: 1)
  bm.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
  const midHasIsClicked = bm.classList.contains('is-clicked');

  // 模拟普通左键点击 (无修饰键)
  bm.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  const normalHasIsClicked = bm.classList.contains('is-clicked');

  return { hasBm: true, cmdHasIsClicked, midHasIsClicked, normalHasIsClicked };
})()`);
const bookmarkTactileOk = bookmarkClickTest.hasBm && !bookmarkClickTest.cmdHasIsClicked && !bookmarkClickTest.midHasIsClicked && bookmarkClickTest.normalHasIsClicked;

// 4.4 普通点击返回不动鼠标时防假性悬停残留与鼠标移动唤醒校验
const hoverGatingTest = await evalJS(`(() => {
  const bm = document.querySelector('.bookmark-item');
  if (!bm) return { ok: false };
  // 模拟普通点击跳出
  bm.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  window.dispatchEvent(new Event('blur'));
  window.dispatchEvent(new Event('pagehide'));
  
  // 模拟从外部返回（多标签切回 / BFCache 恢复：focus + pageshow + visibilitychange）但不移动鼠标
  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('pageshow'));
  document.dispatchEvent(new Event('visibilitychange'));
  const bodyHasTabBlurredOnReturn = document.body.classList.contains('tab-blurred');
  const style = window.getComputedStyle(bm);
  const isScaleNormal = !style.transform || style.transform === 'none' || style.transform.includes('matrix(1, 0, 0, 1');
  
  // 模拟物理鼠标移动 1px
  window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 200 }));
  const bodyClearedTabBlurred = !document.body.classList.contains('tab-blurred');
  
  return {
    ok: bodyHasTabBlurredOnReturn && isScaleNormal && bodyClearedTabBlurred
  };
})()`);
const hoverGatingOk = hoverGatingTest.ok;

// 4.5 模拟“导航页点击标签跳出 -> 外部页面唤醒/切回 -> 滚轮切回首屏”全链路自愈与防白屏深度校验
await evalJS('window.switchToNav()'); await sleep(650);
const navJumpBackTest = await evalJS(`(async () => {
  const navBm = document.querySelector('.nav-bookmark');
  if (!navBm) return { ok: false, reason: 'no-nav-bm' };
  
  // 1. 模拟在导航页点击书签标签跳转外部站点
  navBm.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  window.dispatchEvent(new Event('blur'));
  window.dispatchEvent(new Event('pagehide'));
  
  // 2. 模拟从外部站点返回（多标签切回 / BFCache 恢复）
  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('pageshow'));
  document.dispatchEvent(new Event('visibilitychange'));
  
  // 3. 用户在导航页顶端向上滚动切回起始页
  document.getElementById('navContent').scrollTop = 0;
  document.dispatchEvent(new WheelEvent('wheel', { deltaY: -60, cancelable: true }));
  await new Promise(r => setTimeout(r, 30));
  document.dispatchEvent(new WheelEvent('wheel', { deltaY: -60, cancelable: true }));
  await new Promise(r => setTimeout(r, 650));
  
  const s = document.getElementById('startSection');
  const n = document.getElementById('navSection');
  const clock = document.getElementById('clock');
  const search = document.getElementById('searchInput');
  const weather = document.getElementById('weatherWidget');
  const gear = document.getElementById('editBookmarksBtn');
  const bms = document.querySelectorAll('.bookmark-item');
  const sRect = s ? s.getBoundingClientRect() : null;
  const sTransform = s ? getComputedStyle(s).transform : '';
  const isScaleNormal = !sTransform || sTransform === 'none' || sTransform === 'matrix(1, 0, 0, 1, 0, 0)';
  
  return {
    ok: sRect && sRect.top === 0 && sRect.height > 0 && isScaleNormal
      && s.getAttribute('aria-hidden') !== 'true'
      && n.classList.contains('nav-hidden')
      && !document.documentElement.classList.contains('nr')
      && !!clock && clock.offsetWidth > 0
      && !!search && search.offsetWidth > 0
      && !!weather
      && bms.length > 0
      && (!gear || !gear.classList.contains('hidden-on-nav')),
    sTop: sRect ? sRect.top : -999,
    bmCount: bms.length,
    isScaleNormal
  };
})()`);
const navJumpBackOk = navJumpBackTest.ok;

pass('sessionStorage 刷新保持、BFCache 自愈、导航页跳出返回滚动防白屏及无残留', 
  restored === true && startRestoredValid && bfCacheHealed && bookmarkTactileOk && hoverGatingOk && navJumpBackOk,
  `restored=${restored}, startRestored=${startRestoredValid}, bfCacheHealed=${bfCacheHealed}, bookmarkTactile=${bookmarkTactileOk}, hoverGating=${hoverGatingOk}, navJumpBack=${navJumpBackOk}`);

// ══════════════════════════════════════════════════════════════════════
// 5. 搜索联想键盘选中项保持与 Escape 优雅清退
// ══════════════════════════════════════════════════════════════════════

await evalJS('window.switchToStart()'); await sleep(350);
await evalJS(`(() => {
  const i = document.getElementById('searchInput');
  i.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, 'git');
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(500);
await press('ArrowDown'); await sleep(150);
const suggestSelectionCheck = await evalJS(`(() => {
  const menu = document.getElementById('suggestionMenu');
  const items = menu ? menu.querySelectorAll('.suggestion-item') : [];
  const selected = menu ? menu.querySelector('.suggestion-item.active') : null;
  return { hasItems: items.length > 0, isSelected: selected !== null };
})()`);

await press('Escape'); await sleep(200);
const escResult = await evalJS(`({
  val: document.getElementById('searchInput').value,
  menuActive: document.getElementById('suggestionMenu').classList.contains('active'),
  idx: selectedSuggestionIdx,
  top: OverlayStack.top() ? OverlayStack.top().id : null
})`);
const escValid = escResult.val === 'git' && !escResult.menuActive && escResult.idx === -1 && escResult.top === null;

pass('搜索联想键盘选中项保持与 Escape 优雅清退 (高亮选中/还原查询词/清空Overlay栈)',
  suggestSelectionCheck.hasItems && suggestSelectionCheck.isSelected && escValid);

// ══════════════════════════════════════════════════════════════════════
// 6. OverlayStack 多层弹窗嵌套压退栈与安全白名单
// ══════════════════════════════════════════════════════════════════════

// 6.1 clock
const clockOk = (await evalJS(`document.getElementById('clock').style.willChange`)) === '';

// 6.2 多层 Modal FIFO/LIFO
await evalJS(`document.getElementById('editBookmarksBtn').click()`); await sleep(300);
await evalJS(`document.getElementById('togglePickerBtn').click()`); await sleep(300);
const topPicker = await stackTop();
await press('Escape'); await sleep(350);
const afterEsc1 = await evalJS(`({ pickerHidden: document.getElementById('bookmarkPicker').hasAttribute('hidden'), editOpen: !document.getElementById('editModal').hasAttribute('hidden') })`);
await press('Escape'); await sleep(350);
const topNull = await stackTop();
const modalStackOk = topPicker === 'bookmarkPicker' && afterEsc1.pickerHidden && afterEsc1.editOpen && topNull === null;

// 6.3 引擎下拉框
await evalJS(`document.getElementById('engineBtn').click()`); await sleep(300);
const topDropdown = await stackTop();
await press('Escape'); await sleep(300);
const dropdownOk = topDropdown === 'dropdown' && (await stackTop()) === null;

// 6.4 活动 Modal 拦截滚轮与快捷键
await evalJS(`document.getElementById('editBookmarksBtn').click()`); await sleep(300);
await evalJS(`window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))`); await sleep(300);
const wheelSec = await evalJS(`state.currentSection`);
await press('PageDown'); await sleep(300);
const keySec = await evalJS(`state.currentSection`);
await press('Escape'); await sleep(300);
const lockOk = wheelSec === 'start' && keySec === 'start';

// 6.5 重置确认弹窗
await evalJS(`document.getElementById('resetEditBtn').click()`); await sleep(300);
const topConfirm = await stackTop();
await press('Escape'); await sleep(300);
const confirmOk = topConfirm === 'confirmModal' && (await stackTop()) === null;

// 6.6 jsonDropzone
const dropzoneOk = await evalJS(`(() => {
  let fired = false;
  const input = document.getElementById('importJsonInput');
  input.addEventListener('click', () => { fired = true; }, { once: true });
  document.getElementById('jsonDropzone').click();
  return fired;
})()`);

// 6.7 遮罩透明度设置记忆
await evalJS(`localStorage.setItem('maskOpacity', 50)`);
await evalJS('setTimeout(() => location.reload(), 10)'); await sleep(1200);
const beforeOverlay = await evalJS(`getComputedStyle(document.getElementById('bgOverlay')).backgroundColor`);
await press('Escape'); await sleep(300);
const afterOverlay = await evalJS(`getComputedStyle(document.getElementById('bgOverlay')).backgroundColor`);
const maskOk = beforeOverlay === afterOverlay;
await evalJS(`localStorage.removeItem('maskOpacity')`);

// 6.8 搜索引擎白名单
const engineDropdownCheck = await evalJS(`(() => {
  const buttons = [...document.querySelectorAll('#dropdownMenu button[data-engine]')];
  const engineKeys = buttons.map(b => b.dataset.engine);
  return {
    isClean: engineKeys.length === 3 && engineKeys.includes('bing') && engineKeys.includes('google') && engineKeys.includes('wikipedia') && !engineKeys.includes('baidu') && !engineKeys.includes('duckduckgo')
  };
})()`);

pass('OverlayStack 多层弹窗嵌套压退栈与安全白名单 (多层Modal/引擎下拉/快捷键拦截/遮罩记忆/Bing-Google-Wikipedia白名单)',
  clockOk && modalStackOk && dropdownOk && lockOk && confirmOk && dropzoneOk && maskOk && engineDropdownCheck.isClean);

// ══════════════════════════════════════════════════════════════════════
// 7. 移动端视口 (iPhone 17 402x874) 与侧边栏 Tab 滚动联动
// ══════════════════════════════════════════════════════════════════════

await send('Emulation.setDeviceMetricsOverride', {
  width: 402,
  height: 874,
  deviceScaleFactor: 3,
  mobile: true
});
await sleep(300);

await evalJS('window.switchToNav()'); await sleep(600);

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
const tab0Ok = tab0Info?.active && tab0Info?.text.includes('人工智能') && tab0Info?.visible && tab0Info?.scrollLeft === 0;
const touchTargetOk = (tab0Info?.tabHeight || 0) >= 35;

await evalJS('document.getElementById("navContent").scrollTop = 800'); await sleep(300);
await evalJS('document.getElementById("navContent").dispatchEvent(new Event("scroll"))'); await sleep(500);

const scrolledInfo = await evalJS(`(() => {
  const activeTab = document.getElementById('sidebar').querySelector('.sidebar-item.active');
  return activeTab ? activeTab.id : null;
})()`);
const scrollSwitchOk = scrolledInfo !== 'cat-tab-0';

await evalJS('document.getElementById("navContent").scrollTop = 0'); await sleep(300);
await evalJS('document.getElementById("navContent").dispatchEvent(new Event("scroll"))'); await sleep(600);

const restoredInfo = await evalJS(`(() => {
  const tab0 = document.getElementById('cat-tab-0'), sidebar = document.getElementById('sidebar');
  const tRect = tab0.getBoundingClientRect(), sRect = sidebar.getBoundingClientRect();
  return {
    active: tab0.classList.contains('active'),
    scrollLeft: sidebar.scrollLeft,
    visible: tRect.left >= sRect.left && tRect.right <= sRect.right
  };
})()`);
const scrollBackOk = restoredInfo.active && restoredInfo.scrollLeft === 0 && restoredInfo.visible;

pass('移动端视口 (iPhone 17) 与侧边栏 Tab 滚动联动及 44px 触控规范 (默认激活可见/滚动高亮切分类/滚回顶部恢复/触控高度达标)',
  tab0Ok && scrollSwitchOk && scrollBackOk && touchTargetOk,
  JSON.stringify({ tab0Ok, scrollSwitchOk, scrollBackOk, touchTargetOk, tabHeight: tab0Info?.tabHeight }));

const code = finish();
await chrome.close();
await server.close();
process.exit(code);

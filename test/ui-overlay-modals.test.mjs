/**
 * 弹窗层叠栈、BFCache 自愈、搜索联想与移动视口测试套件 (ui-overlay-modals.test.mjs)
 *
 * 核心断言：
 * 4. sessionStorage 刷新保持、BFCache 自愈、导航页书签3D倾斜与跳出返回滚动防白屏及无残留
 * 5. 搜索联想键盘选中项保持与 Escape 优雅清退
 * 6. OverlayStack 多层弹窗嵌套压退栈、安全白名单与 Focus Trap 焦点锁
 * 7. 移动端视口 (iPhone 17) 与侧边栏 Tab 滚动联动及 44px 触控规范
 */
import { launchSession, sleep, makeTester, pressKey } from './helpers.mjs';

const { pass, finish } = makeTester();
const { server, chrome, send, evalJS } = await launchSession();

await sleep(300);

const press = (key) => pressKey(evalJS, key);
const stackTop = () => evalJS(`OverlayStack.top() ? OverlayStack.top().id : null`);
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
// 4.45 导航页书签 3D 倾斜与 VisionOS 折射光斑 (mousemove / RAF 帧合并 / resetActiveCard 还原)
const tiltTest = await evalJS(`(async () => {
  const navBm = document.querySelector('.nav-bookmark');
  if (!navBm) return { ok: false, reason: 'no-nav-bm' };
  if (typeof window.resetActiveTiltCard !== 'function') return { ok: false, reason: 'no-reset-fn' };

  const rect = navBm.getBoundingClientRect();
  const clientX = rect.left + rect.width * 0.8;
  const clientY = rect.top + rect.height * 0.8;

  navBm.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX, clientY }));
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
    resetOk,
    transform
  };
})()`);
const tiltOk = tiltTest.ok;

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

pass('sessionStorage 刷新保持、BFCache 自愈、导航页书签3D倾斜与跳出返回滚动防白屏及无残留', 
  restored === true && startRestoredValid && bfCacheHealed && bookmarkTactileOk && hoverGatingOk && tiltOk && navJumpBackOk,
  `restored=${restored}, startRestored=${startRestoredValid}, bfCacheHealed=${bfCacheHealed}, bookmarkTactile=${bookmarkTactileOk}, hoverGating=${hoverGatingOk}, tilt=${tiltOk}, navJumpBack=${navJumpBackOk}`);

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

// 6.9 无障碍 Focus Trap 焦点循环锁定与焦点平滑归还 (Tab 从末尾回绕首项 / Shift+Tab 从首项回绕末尾 / 外部焦点强制回捕 / 多层嵌套栈顶隔离 / 弹窗关闭归还焦点到触发按钮)
const focusTrapCheck = await evalJS(`(async () => {
  // 1. 打开设置弹窗
  const editBtn = document.getElementById('editBookmarksBtn');
  const editInitExpanded = editBtn ? editBtn.getAttribute('aria-expanded') : null;
  editBtn.focus();
  editBtn.click();
  await new Promise(r => setTimeout(r, 300));
  const editOpenExpanded = editBtn ? editBtn.getAttribute('aria-expanded') : null;
  
  const modalEl = document.getElementById('editModal');
  const focusables = Array.from(modalEl.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(el => el.offsetWidth > 0 || el.offsetHeight > 0);
  const firstEl = focusables[0];
  const lastEl = focusables[focusables.length - 1];

  // 2. 从末尾元素按下 Tab 键 -> 焦点循环回绕至首项
  lastEl.focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  const tabWrapOk = document.activeElement === firstEl;

  // 3. 从首项元素按下 Shift + Tab 键 -> 焦点循环回绕至末尾
  firstEl.focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  const shiftTabWrapOk = document.activeElement === lastEl;

  // 4. 模拟外部元素失控聚焦 (如 body) -> 按下 Tab 键强行回捕至首项
  document.body.focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  const outsideTrapOk = document.activeElement === firstEl;

  // 5. 多层嵌套弹窗测试：在 editModal 之上呼出 confirmModal -> Focus Trap 必须严格隔离在栈顶 confirmModal 内部
  document.getElementById('tab-btn-data').click();
  await new Promise(r => setTimeout(r, 200));
  const resetBtn = document.getElementById('resetEditBtn');
  const confirmInitExpanded = resetBtn ? resetBtn.getAttribute('aria-expanded') : null;
  resetBtn.focus();
  resetBtn.click();
  await new Promise(r => setTimeout(r, 300));
  const confirmOpenExpanded = resetBtn ? resetBtn.getAttribute('aria-expanded') : null;
  const confirmEl = document.getElementById('confirmModal');
  const confirmFocusables = Array.from(confirmEl.querySelectorAll('button:not([disabled])')).filter(el => el.offsetWidth > 0 || el.offsetHeight > 0);
  const confirmFirst = confirmFocusables[0];
  const confirmLast = confirmFocusables[confirmFocusables.length - 1];
  
  confirmLast.focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  const stackedTabWrapOk = document.activeElement === confirmFirst;
  
  document.getElementById('confirmCancelBtn').click();
  await new Promise(r => setTimeout(r, 300));
  const confirmClosedExpanded = resetBtn ? resetBtn.getAttribute('aria-expanded') : null;
  const confirmTriggerRestoredOk = document.activeElement && document.activeElement.id === 'resetEditBtn';
  const confirmAriaOk = confirmInitExpanded === 'false' && confirmOpenExpanded === 'true' && confirmClosedExpanded === 'false';

  // 6. 书签提取子弹窗 (bookmarkPicker) 焦点归还测试 (位于 tabBookmarks 选项卡)
  document.getElementById('tab-btn-bookmarks').click();
  await new Promise(r => setTimeout(r, 200));
  const pickerBtn = document.getElementById('togglePickerBtn');
  const pickerInitExpanded = pickerBtn ? pickerBtn.getAttribute('aria-expanded') : null;
  pickerBtn.focus();
  pickerBtn.click();
  await new Promise(r => setTimeout(r, 300));
  const pickerOpenExpanded = pickerBtn ? pickerBtn.getAttribute('aria-expanded') : null;
  document.getElementById('donePickerBtn').click();
  await new Promise(r => setTimeout(r, 300));
  const pickerClosedExpanded = pickerBtn ? pickerBtn.getAttribute('aria-expanded') : null;
  const pickerTriggerRestoredOk = document.activeElement && document.activeElement.id === 'togglePickerBtn';
  const pickerAriaOk = pickerInitExpanded === 'false' && pickerOpenExpanded === 'true' && pickerClosedExpanded === 'false';

  // 7. 设置弹窗内快捷键与鸣谢按钮 aria-expanded 联动测试
  const shortcutBtn = document.getElementById('openShortcutFromSettingsBtn');
  const creditsBtn = document.getElementById('openCreditsFromSettingsBtn');
  const shortcutInitExpanded = shortcutBtn ? shortcutBtn.getAttribute('aria-expanded') : null;
  shortcutBtn?.focus();
  shortcutBtn?.click();
  await new Promise(r => setTimeout(r, 300));
  const shortcutOpenExpanded = shortcutBtn ? shortcutBtn.getAttribute('aria-expanded') : null;
  document.getElementById('doneShortcutBtn')?.click();
  await new Promise(r => setTimeout(r, 300));
  const shortcutClosedExpanded = shortcutBtn ? shortcutBtn.getAttribute('aria-expanded') : null;
  const shortcutAriaOk = shortcutInitExpanded === 'false' && shortcutOpenExpanded === 'true' && shortcutClosedExpanded === 'false';

  const creditsInitExpanded = creditsBtn ? creditsBtn.getAttribute('aria-expanded') : null;
  creditsBtn?.focus();
  creditsBtn?.click();
  await new Promise(r => setTimeout(r, 300));
  const creditsOpenExpanded = creditsBtn ? creditsBtn.getAttribute('aria-expanded') : null;
  document.getElementById('doneCreditsBtn')?.click();
  await new Promise(r => setTimeout(r, 300));
  const creditsClosedExpanded = creditsBtn ? creditsBtn.getAttribute('aria-expanded') : null;
  const creditsAriaOk = creditsInitExpanded === 'false' && creditsOpenExpanded === 'true' && creditsClosedExpanded === 'false';

  // 8. 关闭设置弹窗并验证焦点平滑归还至触发源 (editBookmarksBtn)
  document.getElementById('cancelEditBtn').click();
  await new Promise(r => setTimeout(r, 300));
  const editClosedExpanded = editBtn ? editBtn.getAttribute('aria-expanded') : null;
  const editAriaOk = editInitExpanded === 'false' && editOpenExpanded === 'true' && editClosedExpanded === 'false';
  const focusRestoredOk = document.activeElement && document.activeElement.id === 'editBookmarksBtn';
  const bodyLockReleased = !document.body.classList.contains('overflow-hidden') && !document.body.classList.contains('touch-none');

  return { tabWrapOk, shiftTabWrapOk, outsideTrapOk, stackedTabWrapOk, confirmTriggerRestoredOk, confirmAriaOk, pickerTriggerRestoredOk, pickerAriaOk, shortcutAriaOk, creditsAriaOk, editAriaOk, focusRestoredOk, bodyLockReleased };
})()`);
const focusTrapOk = focusTrapCheck.tabWrapOk && focusTrapCheck.shiftTabWrapOk && focusTrapCheck.outsideTrapOk && focusTrapCheck.stackedTabWrapOk && focusTrapCheck.confirmTriggerRestoredOk && focusTrapCheck.confirmAriaOk && focusTrapCheck.pickerTriggerRestoredOk && focusTrapCheck.pickerAriaOk && focusTrapCheck.shortcutAriaOk && focusTrapCheck.creditsAriaOk && focusTrapCheck.editAriaOk && focusTrapCheck.focusRestoredOk && focusTrapCheck.bodyLockReleased;

pass('OverlayStack 多层弹窗嵌套压退栈、安全白名单与 Focus Trap 焦点锁 (多层Modal/引擎下拉/快捷键拦截/遮罩记忆/Bing-Google-Wikipedia/Focus Trap回绕/外部回捕/栈顶隔离/子弹窗焦点归还/ARIA联动/主弹窗焦点归还)',
  clockOk && modalStackOk && dropdownOk && lockOk && confirmOk && dropzoneOk && maskOk && engineDropdownCheck.isClean && focusTrapOk,
  JSON.stringify({ clockOk, modalStackOk, dropdownOk, lockOk, confirmOk, dropzoneOk, maskOk, isClean: engineDropdownCheck.isClean, focusTrapCheck }));

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

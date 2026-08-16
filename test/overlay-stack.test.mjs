/**
 * UI 弹窗层叠栈 (OverlayStack)、遮罩与全局 Escape 响应综合测试 (overlay-stack.test.mjs)
 *
 * 精简版：8 个核心精准断言
 */
import { launchSession, sleep, makeTester, pressKey } from './helpers.mjs';

const { pass, finish } = makeTester();
const { server, chrome, evalJS } = await launchSession();

await sleep(1800);
const press = (key) => pressKey(evalJS, key);
const stackTop = () => evalJS(`OverlayStack.top() ? OverlayStack.top().id : null`);

// 1. clock 基础状态校验
pass('clock 基础状态正常 (无常驻 will-change)', (await evalJS(`document.getElementById('clock').style.willChange`)) === '');

// 2. 多层 Modal 嵌套压栈且 Escape 先关顶层
await evalJS(`document.getElementById('editBookmarksBtn').click()`); await sleep(300);
await evalJS(`document.getElementById('togglePickerBtn').click()`); await sleep(300);
const topPicker = await stackTop();
await press('Escape'); await sleep(350);
const afterEsc1 = await evalJS(`({ pickerHidden: document.getElementById('bookmarkPicker').hasAttribute('hidden'), editOpen: !document.getElementById('editModal').hasAttribute('hidden') })`);
await press('Escape'); await sleep(350);
const topNull = await stackTop();
pass('多层 Modal 嵌套压栈且 Escape 先关顶层', topPicker === 'bookmarkPicker' && afterEsc1.pickerHidden && afterEsc1.editOpen && topNull === null, '压栈退栈符合 FIFO');

// 3. 引擎下拉框入栈且 Escape 可优雅关闭
await evalJS(`document.getElementById('engineBtn').click()`); await sleep(300);
const topDropdown = await stackTop();
await press('Escape'); await sleep(300);
pass('引擎下拉框入栈且 Escape 可优雅关闭', topDropdown === 'dropdown' && (await stackTop()) === null);

// 4. 联想输入 Escape 优雅还原原始查询词并清空 Overlay 栈
await evalJS(`document.getElementById('searchInput').focus()`); await sleep(100);
await evalJS(`(function(){
  const i = document.getElementById('searchInput');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, 'git');
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(1800);
await press('ArrowDown'); await sleep(300);
await press('Escape'); await sleep(300);
const escResult = await evalJS(`({
  val: document.getElementById('searchInput').value,
  menuActive: document.getElementById('suggestionMenu').classList.contains('active'),
  idx: selectedSuggestionIdx,
  top: OverlayStack.top() ? OverlayStack.top().id : null
})`);
pass('联想输入 Escape 优雅还原原始查询词并清空 Overlay 栈',
  escResult.val === 'git' && !escResult.menuActive && escResult.idx === -1 && escResult.top === null,
  JSON.stringify(escResult));

// 5. 活动 Modal 激活时全局滚轮与 PageDown 快捷键被拦截
await evalJS(`document.getElementById('editBookmarksBtn').click()`); await sleep(300);
await evalJS(`window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))`); await sleep(300);
const wheelSec = await evalJS(`state.currentSection`);
await press('PageDown'); await sleep(300);
const keySec = await evalJS(`state.currentSection`);
await press('Escape'); await sleep(300);
pass('活动 Modal 激活时全局滚轮与 PageDown 快捷键被拦截', wheelSec === 'start' && keySec === 'start', `wheel=${wheelSec} key=${keySec}`);

// 6. 重置确认弹窗入栈且 Escape 可取消不触发重置
await evalJS(`document.getElementById('resetEditBtn').click()`); await sleep(300);
const topConfirm = await stackTop();
await press('Escape'); await sleep(300);
const afterConfirmNull = await stackTop();
pass('重置确认弹窗入栈且 Escape 可取消不触发重置', topConfirm === 'confirmModal' && afterConfirmNull === null);

// 7. jsonDropzone 导入触发链路通畅
const chainFired = await evalJS(`(() => {
  let fired = false;
  const input = document.getElementById('importJsonInput');
  input.addEventListener('click', () => { fired = true; }, { once: true });
  document.getElementById('jsonDropzone').click();
  return fired;
})()`);
pass('jsonDropzone 导入触发链路通畅', chainFired === true);

// 8. Escape 关闭弹窗时不重置遮罩透明度设置
await evalJS(`localStorage.setItem('maskOpacity', 50); location.reload()`); await sleep(2200);
const beforeOverlay = await evalJS(`getComputedStyle(document.getElementById('bgOverlay')).backgroundColor`);
await press('Escape'); await sleep(300);
const afterOverlay = await evalJS(`getComputedStyle(document.getElementById('bgOverlay')).backgroundColor`);
pass('Escape 关闭弹窗时不重置遮罩透明度设置', beforeOverlay === afterOverlay, `bg=${beforeOverlay}`);
await evalJS(`localStorage.removeItem('maskOpacity')`);

// 9. 搜索引擎白名单校验 (仅保留 Bing 与 Google，彻底杜绝百度与冗余项)
const engineDropdownCheck = await evalJS(`(() => {
  const buttons = [...document.querySelectorAll('#dropdownMenu button[data-engine]')];
  const engineKeys = buttons.map(b => b.dataset.engine);
  const hasBaidu = engineKeys.includes('baidu');
  const hasDuck = engineKeys.includes('duckduckgo');
  return {
    count: buttons.length,
    engineKeys,
    isClean: engineKeys.length === 2 && engineKeys.includes('bing') && engineKeys.includes('google') && !hasBaidu && !hasDuck
  };
})()`);
pass('搜索引擎白名单校验 (仅保留 Bing 与 Google，彻底杜绝百度/DuckDuckGo)', engineDropdownCheck.isClean, JSON.stringify(engineDropdownCheck.engineKeys));

const code = finish();
await chrome.close();
await server.close();
process.exit(code);

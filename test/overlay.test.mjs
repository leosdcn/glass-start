import { launchSession, sleep, makeTester } from './helpers.mjs';

const { pass, finish } = makeTester();
const { server, chrome, evalJS } = await launchSession(9333);

await sleep(1800);
const press = (key) => evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true, cancelable: true }))`);
const stackTop = () => evalJS(`OverlayStack.top() ? OverlayStack.top().id : null`);

// 1. 编辑弹窗开启时入栈，栈顶为 editModal
await evalJS(`document.getElementById('editBookmarksBtn').click()`);
await sleep(300);
pass('编辑弹窗开启入栈 top=editModal', (await stackTop()) === 'editModal', `top=${await stackTop()}`);

// 2. 弹窗内嵌套打开书签选择器，后开先关：top=bookmarkPicker
await evalJS(`document.getElementById('togglePickerBtn').click()`);
await sleep(300);
pass('嵌套打开选择器 top=bookmarkPicker', (await stackTop()) === 'bookmarkPicker', `top=${await stackTop()}`);

// 3. 多层嵌套时 Escape 先关顶层(选择器)，编辑弹窗仍开
await press('Escape');
await sleep(300);
const afterEsc1 = await evalJS(`({ pickerHidden: document.getElementById('bookmarkPicker').hasAttribute('hidden'), editOpen: !document.getElementById('editModal').hasAttribute('hidden') })`);
pass('Escape 后开先关: 先关选择器、编辑弹窗保留', afterEsc1.pickerHidden && afterEsc1.editOpen, JSON.stringify(afterEsc1));

// 4. 再 Escape 关闭编辑弹窗，栈清空
await press('Escape');
await sleep(300);
pass('再 Escape 关闭编辑弹窗、栈清空', (await stackTop()) === null, `top=${await stackTop()}`);

// 5. 引擎下拉开启时入栈，Escape 优雅关闭
await evalJS(`document.getElementById('engineBtn').click()`);
await sleep(300);
pass('引擎下拉入栈 top=dropdown', (await stackTop()) === 'dropdown', `top=${await stackTop()}`);
await press('Escape');
await sleep(300);
pass('Escape 关闭引擎下拉、栈清空', (await stackTop()) === null, `top=${await stackTop()}`);

// 6. 联想激活时入栈，Escape 关闭联想
await evalJS(`document.getElementById('searchInput').focus()`);
await sleep(100);
await evalJS(`(function(){
  const i = document.getElementById('searchInput');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, 'git');
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(1800);
pass('联想激活入栈 top=suggestions', (await stackTop()) === 'suggestions', `top=${await stackTop()}`);
await press('Escape');
await sleep(300);
pass('Escape 关闭联想、栈清空', (await stackTop()) === null, `top=${await stackTop()}`);

// 7. 滚轮挂起: 弹窗开启时滚轮下滚不切屏
await evalJS(`document.getElementById('editBookmarksBtn').click()`);
await sleep(300);
await evalJS(`window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))`);
await sleep(400);
const wheelBlocked = await evalJS(`state.currentSection`);
pass('弹窗开启时滚轮不切屏(挂起)', wheelBlocked === 'start', `section=${wheelBlocked}`);
await press('Escape');
await sleep(300);

// 8. 弹窗开启时全局快捷键(PageDown)被拦截
await evalJS(`document.getElementById('editBookmarksBtn').click()`);
await sleep(300);
await press('PageDown');
await sleep(400);
const hotkeyBlocked = await evalJS(`state.currentSection`);
pass('弹窗开启时 PageDown 被拦截', hotkeyBlocked === 'start', `section=${hotkeyBlocked}`);
await press('Escape');
await sleep(300);

// 9. 确认弹窗(重置)入栈且 Escape 可关(不触发重置副作用)
await evalJS(`document.getElementById('resetEditBtn').click()`);
await sleep(300);
pass('确认弹窗入栈 top=confirmModal', (await stackTop()) === 'confirmModal', `top=${await stackTop()}`);
await press('Escape');
await sleep(300);
pass('Escape 关闭确认弹窗且未执行重置', (await stackTop()) === null && (await evalJS(`!!document.getElementById('editModal').hasAttribute('hidden')`)), `top=${await stackTop()}`);

const code = finish();
await chrome.close();
await server.close();
process.exit(code);

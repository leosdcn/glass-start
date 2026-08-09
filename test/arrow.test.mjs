import { launchSession, sleep, makeTester } from './helpers.mjs';

const { pass, finish } = makeTester();
const { server, chrome, evalJS } = await launchSession();

await sleep(1800);
const press = (key) => evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true, cancelable: true }))`);
const section = async () => evalJS(`document.getElementById('startSection').getAttribute('aria-hidden') === 'true' ? 'nav' : 'start'`);
const focus = async () => evalJS(`document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : 'none'`);

// 1. 切回后焦点不再自动聚焦搜索框 → BODY，↓ 立即可切屏
await evalJS('window.switchToNav()'); await sleep(700);
await evalJS('window.switchToStart()'); await sleep(700);
const f = await focus();
pass('切回后搜索框未自动聚焦(焦点=BODY)', f === 'BODY', `focus=${f}`);
await press('ArrowDown'); await sleep(200);
pass('切回后立即 ArrowDown 切回导航页', (await section()) === 'nav', `section=${await section()}`);

// 2. 字母键盲打聚焦搜索框仍生效
await evalJS('window.switchToStart()'); await sleep(700);
await press('g'); await sleep(150);
pass('字母键盲打仍自动聚焦搜索框', (await focus()) === 'searchInput', `focus=${await focus()}`);

// 3. 联想激活时 ArrowDown 走联想选中(不切屏)
await evalJS(`(function(){
  const i = document.getElementById('searchInput');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, 'git');
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(1800);
const suggestOn = await evalJS(`document.getElementById('suggestionMenu').classList.contains('active')`);
await press('ArrowDown'); await sleep(150);
const selIdx = await evalJS(`[...document.querySelectorAll('.suggestion-item')].findIndex(el => el.classList.contains('active'))`);
pass('联想激活时 ArrowDown 用于联想选中(不切屏)', suggestOn && selIdx >= 0 && (await section()) === 'start', `suggest=${suggestOn} sel=${selIdx}`);

// 4. 编辑弹窗输入框聚焦时 ArrowDown 不误切
await evalJS('window.switchToNav()'); await sleep(700);
await evalJS('window.switchToStart()'); await sleep(700);
await evalJS('document.getElementById("editBookmarksBtn").click()'); await sleep(400);
await evalJS(`document.querySelector('.edit-row-card input').focus()`);
await press('ArrowDown'); await sleep(150);
pass('编辑弹窗输入框聚焦时 ArrowDown 不误切', (await section()) === 'start', `section=${await section()}`);
await evalJS('document.getElementById("cancelEditBtn").click()'); await sleep(300);

// 5. 导航页顶 ArrowUp 切回起始页
await evalJS('window.switchToNav()'); await sleep(700);
await evalJS('document.getElementById("navContent").scrollTop = 0'); await sleep(200);
await evalJS('document.activeElement && document.activeElement.blur()');
await press('ArrowUp'); await sleep(200);
pass('导航页顶 ArrowUp 切回起始页', (await section()) === 'start', `section=${await section()}`);

const code = finish();
await chrome.close();
await server.close();
process.exit(code);

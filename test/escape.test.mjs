/**
 * BUG 3 回归测试：Escape 关闭联想面板时还原被 ↑↓ 选中的原始输入
 *
 * 回归背景：keydown Escape 分支中「还原 originalQuery」的逻辑曾位于栈顶 close() 分支的
 * return 之后 —— 联想面板在 OverlayStack 中时 Escape 必然先命中栈顶分支并提前 return，
 * 还原逻辑是永远执行不到的死代码。修复后还原逻辑被移入栈顶分支（先还原、再关闭）。
 *
 * 本测试验证（本地书签联想无需网络，输入 'git' 可命中分类书签 GitHub）：
 *   1. 输入 'git' 后本地书签联想激活（OverlayStack 栈顶为 suggestions）
 *   2. 按 ↓ 选中联想词后，输入框内容被替换为联想词（GitHub）
 *   3. 按 Escape 后：输入框还原为原始查询 'git'、联想面板关闭、Overlay 栈清空
 */
import { launchSession, sleep, makeTester } from './helpers.mjs';

const { pass, finish } = makeTester();
const { server, chrome, evalJS } = await launchSession(9335);

await sleep(1800);

const press = (key) => evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true, cancelable: true }))`);
const inputVal = () => evalJS(`document.getElementById('searchInput').value`);
const stackTop = () => evalJS(`OverlayStack.top() ? OverlayStack.top().id : null`);
const menuActive = () => evalJS(`document.getElementById('suggestionMenu').classList.contains('active')`);

// 1. 聚焦搜索框并输入 'git'（触发本地书签联想：GitHub）
await evalJS(`document.getElementById('searchInput').focus()`);
await sleep(100);
await evalJS(`(function(){
  const i = document.getElementById('searchInput');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, 'git');
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(1500);
pass('输入 "git" 后本地书签联想激活 (top=suggestions)', (await stackTop()) === 'suggestions', `top=${await stackTop()}`);

// 2. 按 ↓ 选中第一条联想词，输入框被替换为联想词（不再等于原始输入）
await press('ArrowDown');
await sleep(300);
const afterDown = await evalJS(`({ val: document.getElementById('searchInput').value, idx: selectedSuggestionIdx })`);
pass('按 ↓ 后选中联想词并填入输入框', afterDown.idx === 0 && afterDown.val !== 'git' && afterDown.val.length > 0, JSON.stringify(afterDown));

// 3. 按 Escape：输入框还原为原始查询 'git'，面板关闭，栈清空
await press('Escape');
await sleep(300);
const afterEsc = await evalJS(`({
  val: document.getElementById('searchInput').value,
  menuActive: document.getElementById('suggestionMenu').classList.contains('active'),
  idx: selectedSuggestionIdx
})`);
pass('Escape 后输入框还原为原始查询 "git"', afterEsc.val === 'git', `val=${afterEsc.val}`);
pass('Escape 后联想面板关闭、选中索引复位', !afterEsc.menuActive && afterEsc.idx === -1, JSON.stringify(afterEsc));
pass('Escape 后 Overlay 栈清空', (await stackTop()) === null, `top=${await stackTop()}`);

const code = finish();
await chrome.close();
await server.close();
process.exit(code);

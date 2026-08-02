import { launchSession, sleep, makeTester } from './helpers.mjs';

const { pass, finish } = makeTester();
const { server, chrome, evalJS } = await launchSession(9333);

await sleep(1800);
const press = (key) => evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true, cancelable: true }))`);

// 1. 首屏书签由 JS 渲染（不再依赖静态 HTML 死 DOM）
const bm = await evalJS(`(() => {
  const imgs = [...document.querySelectorAll('#bookmarks img')];
  return { count: imgs.length, hasJS: imgs.every(i => i.hasAttribute('fetchpriority')) };
})()`);
pass('首屏书签由 JS 渲染(8个,JS特征)', bm.count === 8 && bm.hasJS, `count=${bm.count} js=${bm.hasJS}`);

// 2. 用户自定义书签刷新后仍正确渲染
await evalJS(`localStorage.setItem('userBookmarks', JSON.stringify([{name:'测试站',url:'https://example.com',icon:''}]))`);
await evalJS('location.reload()');
await sleep(2200);
const custom = await evalJS(`[...document.querySelectorAll('#bookmarks .bookmark-title')].map(e => e.textContent)`);
pass('用户自定义书签刷新后正确渲染', custom.length === 1 && custom[0] === '测试站', `names=${JSON.stringify(custom)}`);
await evalJS(`localStorage.removeItem('userBookmarks')`);

// 3. clock 无常驻 will-change: contents
pass('clock 已移除 will-change: contents', (await evalJS(`document.getElementById('clock').style.willChange`)) === '');

// 4. Escape 不重置遮罩视觉（cancelEditModal 不应在弹窗关闭时被调用）
await evalJS(`localStorage.setItem('maskOpacity', 50); location.reload()`);
await sleep(2200);
const before = await evalJS(`getComputedStyle(document.getElementById('bgOverlay')).backgroundColor`);
await press('Escape');
await sleep(300);
const after = await evalJS(`getComputedStyle(document.getElementById('bgOverlay')).backgroundColor`);
pass('Escape 不重置遮罩(50%应保持)', before === after, `before=${before} after=${after}`);
await evalJS(`localStorage.removeItem('maskOpacity')`);

// 5. 设置弹窗开着时 Escape 可关闭
await evalJS(`document.getElementById('editBookmarksBtn').click()`);
await sleep(300);
const open1 = await evalJS(`!document.getElementById('editModal').hasAttribute('hidden')`);
await press('Escape');
await sleep(300);
const open2 = await evalJS(`!document.getElementById('editModal').hasAttribute('hidden')`);
pass('弹窗开着时 Escape 可关闭', open1 && !open2, `open=${open1} → afterEscape=${open2}`);

// 6. jsonDropzone → importJsonInput 点击链路完好（importJsonBtn 死引用清理后）
const chain = await evalJS(`(() => {
  let fired = false;
  const input = document.getElementById('importJsonInput');
  input.addEventListener('click', () => { fired = true; }, { once: true });
  document.getElementById('jsonDropzone').click();
  return fired;
})()`);
pass('jsonDropzone 点击链路完好', chain === true);

const code = finish();
await chrome.close();
await server.close();
process.exit(code);

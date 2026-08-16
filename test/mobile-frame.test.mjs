/**
 * 移动端视口适配与防 iframe 嵌套安全防护测试 (mobile-frame.test.mjs)
 *
 * 精简版：4 个核心精准断言
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from './cdp.mjs';
import { startServer } from './server.mjs';
import { launchSession, makeTester, sleep } from './helpers.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');

const t = makeTester();

// ---------- 1. 移动端视口与 Tab 滚动测试 ----------
const { server, chrome, send, evalJS } = await launchSession(9338);

try {
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
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
      scrollLeft: sidebar.scrollLeft
    };
  })()`);

  t.pass('iPhone 视口下分类 Tab 默认激活且视口内完全可见',
    tab0Info?.active && tab0Info?.text.includes('人工智能') && tab0Info?.visible && tab0Info?.scrollLeft === 0);

  await evalJS('document.getElementById("navContent").scrollTop = 800'); await sleep(300);
  await evalJS('document.getElementById("navContent").dispatchEvent(new Event("scroll"))'); await sleep(500);

  const scrolledInfo = await evalJS(`(() => {
    const activeTab = document.getElementById('sidebar').querySelector('.sidebar-item.active');
    return activeTab ? activeTab.id : null;
  })()`);

  t.pass('导航页内容滚动后侧边栏高亮跟随切分类', scrolledInfo !== 'cat-tab-0', `activeId=${scrolledInfo}`);

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

  t.pass('内容滚回顶部后分类 Tab 恢复高亮与 0 偏移', restoredInfo.active && restoredInfo.scrollLeft === 0 && restoredInfo.visible);

} finally {
  await chrome.close();
  await server.close();
}

// ---------- 2. 防 <iframe> 恶意嵌套 Frame-Busting 测试 ----------
const FRAME_PORT = 9444;
const frameServer = await startServer(FRAME_PORT, ROOT, {
  '/embed.html': '<!DOCTYPE html><html><body><iframe id="targetFrame" src="/index.html" style="width:800px;height:600px;"></iframe></body></html>'
});

const frameChrome = await launchChrome({ port: FRAME_PORT + 1, url: `http://127.0.0.1:${FRAME_PORT}/embed.html` });
const frameSend = frameChrome.send;
await frameSend('Page.enable');
await frameSend('Runtime.enable');

await sleep(1500);

const evalFrameJS = async (expr) => {
  const r = await frameSend('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.value;
};

const topUrl = await evalFrameJS('window.top.location.href');
t.pass('防 iframe 嵌套 (Frame-Busting) 破局跳转正常', topUrl && topUrl.includes('/index.html'), `topUrl=${topUrl}`);

await frameChrome.close();
await frameServer.close();

process.exit(t.finish());

/**
 * Glass Start — Safari / WebKit 自动化冒烟测试 (Zero-Dependency Native W3C WebDriver)
 * 
 * 利用 macOS 原生 /usr/bin/safaridriver 通过标准 W3C WebDriver HTTP REST API 运行，
 * 绝不引入任何外部重型依赖（无 Playwright、无 Selenium、无第三方 npm 包）。
 */

import { spawn } from 'node:child_process';
import { getFreePort, makeTester } from './helpers.mjs';
import { startServer } from './server.mjs';

const { pass, finish } = makeTester();

// 1. 平台前置检查：非 macOS 平台安全跳过
if (process.platform !== 'darwin') {
  console.log(`ℹ 当前系统为 ${process.platform}（非 macOS），自动跳过 Safari WebKit 冒烟测试。`);
  process.exit(0);
}

const driverPort = await getFreePort();
const serverPort = await getFreePort();

// 启动本地静态测试服务器
const server = await startServer(serverPort);

// 启动原生 safaridriver 守护进程
const driver = spawn('safaridriver', ['-p', String(driverPort)], {
  stdio: ['ignore', 'pipe', 'pipe']
});

let isDriverRunning = false;
driver.on('error', () => { isDriverRunning = false; });
driver.on('exit', () => { isDriverRunning = false; });

// 等待 safaridriver 端口开放
const waitForPort = async (port, maxMs = 3000) => {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/status`);
      if (res.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
};

const driverReady = await waitForPort(driverPort);
if (!driverReady) {
  console.log('ℹ 未能连接到本地 safaridriver 端口，跳过 Safari 自动化测试。');
  driver.kill();
  await server.close();
  process.exit(0);
}

// 建立 W3C WebDriver 会话
let sessionId = null;
try {
  const sessionRes = await fetch(`http://127.0.0.1:${driverPort}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      capabilities: {
        alwaysMatch: {
          browserName: 'safari'
        }
      }
    })
  });
  const sessionData = await sessionRes.json();
  if (sessionData.value?.error) {
    const errMsg = sessionData.value.message || sessionData.value.error;
    console.log(`\nℹ Safari 远程自动化未启用或会话受限: ${errMsg}`);
    console.log('   💡 提示：在本地调试 Safari 自动化需在 Safari 菜单中启用 [开发] -> [允许远程自动化]，');
    console.log('      或在终端运行 `sudo safaridriver --enable`。GitHub Actions macOS CI 已自动配置。');
    driver.kill();
    await server.close();
    process.exit(0);
  }
  sessionId = sessionData.value?.sessionId;
} catch (err) {
  console.log(`ℹ 创建 Safari 会话失败: ${err.message}，跳过测试。`);
  driver.kill();
  await server.close();
  process.exit(0);
}

// 封装原生 W3C WebDriver REST 请求原语
const baseUrl = `http://127.0.0.1:${driverPort}/session/${sessionId}`;

async function evalJS(script, args = []) {
  const res = await fetch(`${baseUrl}/execute/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script, args })
  });
  const data = await res.json();
  if (data.value && typeof data.value === 'object' && data.value.error) {
    throw new Error(`Safari WebDriver Eval Error (${data.value.error}): ${data.value.message}`);
  }
  return data.value;
}

async function navigate(url) {
  await fetch(`${baseUrl}/url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
}

async function setWindowRect(width, height) {
  await fetch(`${baseUrl}/window/rect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ width, height })
  });
}

async function waitForCondition(predicateJs, timeout = 5000, interval = 30) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await evalJS(`return (${predicateJs});`);
      if (res) return res;
    } catch {}
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`Timeout waiting for predicate: ${predicateJs}`);
}

try {
  // 调整窗口尺寸（模拟典型桌面视口）
  await setWindowRect(1440, 900);

  // 导航至本地应用服务
  await navigate(`http://127.0.0.1:${serverPort}/`);

  // 等待应用水合完成
  await waitForCondition('document.readyState === "complete" && !!window.OverlayStack && !!window.state && typeof window.switchToNav === "function"');

  // ══════════════════════════════════════════════════════════════════════
  // 用例 1: 首屏渲染、毛玻璃支持与主应用 Landmark 契约
  // ══════════════════════════════════════════════════════════════════════
  const s1 = await evalJS(`return (() => {
    const start = document.getElementById("startSection");
    const clock = document.getElementById("clock");
    const search = document.getElementById("searchInput");
    const weather = document.getElementById("weatherWidget");
    const gear = document.getElementById("editBookmarksBtn");
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    const bdf = CSS.supports("-webkit-backdrop-filter", "blur(10px)") || CSS.supports("backdrop-filter", "blur(10px)");
    return {
      hasStart: !!start,
      mainTag: start ? start.tagName : '',
      hasClock: !!clock && clock.offsetWidth > 0,
      hasSearch: !!search && search.offsetWidth > 0,
      hasWeather: !!weather,
      hasGear: !!gear,
      themeColor: themeMeta ? themeMeta.getAttribute('content') : null,
      backdropFilterSupported: bdf
    };
  })()`);

  const s1Ok = s1.hasStart && s1.mainTag === 'MAIN' && s1.hasClock && s1.hasSearch && s1.hasWeather && s1.hasGear && !!s1.themeColor && s1.backdropFilterSupported;
  pass('WebKit 首屏完整渲染、语义化 <main> Landmark 与毛玻璃特效支持', s1Ok, JSON.stringify(s1));

  // ══════════════════════════════════════════════════════════════════════
  // 用例 2: 双屏切屏推移状态机 (Start <-> Nav)
  // ══════════════════════════════════════════════════════════════════════
  await evalJS('window.switchToNav();');
  await waitForCondition('state.currentSection === "nav" && !isScreenTransitioning()');
  const navCheck = await evalJS(`return (() => {
    const nav = document.getElementById("navSection");
    const start = document.getElementById("startSection");
    return {
      navPushedIn: nav && nav.classList.contains("screen-pushed-in"),
      navNotHidden: nav && !nav.classList.contains("nav-hidden"),
      startAriaHidden: start && start.getAttribute("aria-hidden") === "true"
    };
  })()`);

  await evalJS('window.switchToStart();');
  await waitForCondition('state.currentSection === "start" && !isScreenTransitioning()');
  const startCheck = await evalJS(`return (() => {
    const nav = document.getElementById("navSection");
    const start = document.getElementById("startSection");
    return {
      startPushedBack: start && !start.classList.contains("screen-pushed-up"),
      startAriaRestored: start && start.getAttribute("aria-hidden") !== "true",
      navHidden: nav && nav.classList.contains("nav-hidden")
    };
  })()`);

  const s2Ok = navCheck.navPushedIn && navCheck.navNotHidden && navCheck.startAriaHidden && startCheck.startPushedBack && startCheck.startAriaRestored && startCheck.navHidden;
  pass('WebKit 双屏切屏状态机推移闭环 (switchToNav / switchToStart)', s2Ok, JSON.stringify({ navCheck, startCheck }));

  // ══════════════════════════════════════════════════════════════════════
  // 用例 3: 搜索框联想输入与 Escape 优雅退栈
  // ══════════════════════════════════════════════════════════════════════
  await evalJS(`(() => {
    const i = document.getElementById("searchInput");
    i.focus();
    i.value = "git";
    i.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitForCondition('document.querySelectorAll("#suggestionMenu .suggestion-item").length > 0');
  const suggestItemsCount = await evalJS('return document.querySelectorAll("#suggestionMenu .suggestion-item").length;');

  await evalJS('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));');
  await waitForCondition('!document.getElementById("suggestionMenu").classList.contains("active") && OverlayStack.isEmpty()');
  const escDismissOk = await evalJS('return !document.getElementById("suggestionMenu").classList.contains("active") && OverlayStack.isEmpty();');

  const s3Ok = suggestItemsCount > 0 && escDismissOk;
  pass('WebKit 搜索联想输入呈现与 Escape 优雅清退', s3Ok, `itemsCount=${suggestItemsCount}, escDismiss=${escDismissOk}`);

  // ══════════════════════════════════════════════════════════════════════
  // 用例 4: 设置弹窗 OverlayStack 压栈、inert 隔离与关闭归还
  // ══════════════════════════════════════════════════════════════════════
  await evalJS('document.getElementById("editBookmarksBtn").click();');
  await waitForCondition('OverlayStack.top() && OverlayStack.top().id === "editModal"');
  const modalOpened = await evalJS(`return (() => {
    const modal = document.getElementById("editModal");
    const start = document.getElementById("startSection");
    return {
      visible: modal && !modal.hasAttribute("hidden"),
      topId: OverlayStack.top() ? OverlayStack.top().id : null,
      startInert: start ? start.inert : false
    };
  })()`);

  await evalJS('document.getElementById("cancelEditBtn").click();');
  await waitForCondition('document.getElementById("editModal").hasAttribute("hidden") && OverlayStack.isEmpty()');
  const modalClosed = await evalJS(`return (() => {
    const modal = document.getElementById("editModal");
    const start = document.getElementById("startSection");
    return {
      hidden: modal && modal.hasAttribute("hidden"),
      empty: OverlayStack.isEmpty(),
      startInert: start ? start.inert : false
    };
  })()`);

  const s4Ok = modalOpened.visible && modalOpened.topId === 'editModal' && modalOpened.startInert === true
    && modalClosed.hidden && modalClosed.empty && modalClosed.startInert === false;
  pass('WebKit 设置弹窗层叠栈 (OverlayStack 压栈/背景 inert 隔离/退栈平滑恢复)', s4Ok, JSON.stringify({ modalOpened, modalClosed }));

  // ══════════════════════════════════════════════════════════════════════
  // 用例 5: iOS 移动端字体与防放大规范 (Computed >= 16px)
  // ══════════════════════════════════════════════════════════════════════
  const mobileSpec = await evalJS(`return (() => {
    const sInput = document.getElementById("searchInput");
    const fs = sInput ? parseFloat(window.getComputedStyle(sInput).fontSize) : 0;
    return {
      searchFontSize: fs,
      fontSizeCompliant: fs >= 16
    };
  })()`);

  const s5Ok = mobileSpec.fontSizeCompliant;
  pass('WebKit 移动端输入规范 (单行输入框计算字号 >= 16px 防视口意外放大)', s5Ok, JSON.stringify(mobileSpec));

} finally {
  if (sessionId) {
    try {
      await fetch(`${baseUrl}`, { method: 'DELETE' });
    } catch {}
  }
  driver.kill();
  await server.close();
}

const exitCode = finish();
process.exit(exitCode);

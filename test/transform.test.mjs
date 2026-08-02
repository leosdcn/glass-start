import { launchSession, sleep, tyOf, makeTester } from './helpers.mjs';

const { pass, finish } = makeTester();
const { server, chrome, evalJS } = await launchSession(9333);

// 等页面初始化 & 壁纸/图标不阻塞
await sleep(1800);

// ---------- 1. 初始状态 ----------
const init = await evalJS(`(() => {
  const s = document.getElementById('startSection');
  const n = document.getElementById('navSection');
  const cs = getComputedStyle(s), cn = getComputedStyle(n);
  return {
    scrollY: window.scrollY,
    startTransform: cs.transform,
    navTransform: cn.transform,
    navClass: n.className,
    startAria: s.getAttribute('aria-hidden'),
    navAria: n.getAttribute('aria-hidden'),
    gearClass: document.getElementById('editBookmarksBtn').className,
    section: sessionStorage.getItem('startpage_section'),
  };
})()`);
pass('初始 scrollY=0', init.scrollY === 0, `scrollY=${init.scrollY}`);
pass('初始 start transform = none/0', init.startTransform === 'none' || init.startTransform === 'matrix(1, 0, 0, 1, 0, 0)', init.startTransform);
const navInitTy = tyOf(init.navTransform);
pass('初始 nav 在屏下 (translateY ~100vh)', navInitTy !== null && navInitTy > 600, `translateY=${navInitTy}`);
pass('初始 nav aria-hidden=true', init.navAria === 'true');
pass('初始 start 可见', init.startAria !== 'true');
pass('初始齿轮可见', !init.gearClass.includes('hidden-on-nav'));

// ---------- 2. 切到导航页 ----------
await evalJS('window.switchToNav()');
await sleep(1200);
const navEnd = tyOf(await evalJS('getComputedStyle(document.getElementById("navSection")).transform'));
pass('nav 滑入 结束位 translateY(0)', navEnd === 0, `translateY=${navEnd}`);
pass('切 nav 后 scrollY 保持 0', (await evalJS('window.scrollY')) === 0);
const startOut = await evalJS('getComputedStyle(document.getElementById("startSection")).transform');
pass('切 nav 后 start 移出 (translateY -100vh)', tyOf(startOut) !== null && tyOf(startOut) < -600, startOut);
pass('nav aria-hidden 移除', (await evalJS('document.getElementById("navSection").getAttribute("aria-hidden")')) !== 'true');
pass('齿轮隐藏', (await evalJS('document.getElementById("editBookmarksBtn").className')).includes('hidden-on-nav'));

// ---------- 3. sessionStorage 刷新保持 ----------
await evalJS('sessionStorage.setItem("startpage_section", "nav")');
await evalJS('location.reload()');
await sleep(1500);
const restored = await evalJS(`(() => {
  const n = document.getElementById('navSection');
  const s = document.getElementById('startSection');
  return {
    navClass: n.className,
    navTransform: getComputedStyle(n).transform,
    startTransform: getComputedStyle(s).transform,
    navAria: n.getAttribute('aria-hidden'),
    startAria: s.getAttribute('aria-hidden'),
  };
})()`);
pass('刷新后恢复 nav (无过渡)', restored.navClass.includes('screen-pushed-in') && !restored.navClass.includes('nav-hidden'), restored.navClass);
pass('恢复态 start 移出', tyOf(restored.startTransform) !== null && tyOf(restored.startTransform) < -600, restored.startTransform);

// ---------- 4. 切回起始页 ----------
await evalJS('window.switchToStart()');
await sleep(800);
const back = await evalJS(`(() => {
  const n = document.getElementById('navSection');
  const s = document.getElementById('startSection');
  return {
    navClass: n.className,
    navTransform: getComputedStyle(n).transform,
    startTransform: getComputedStyle(s).transform,
    gearClass: document.getElementById('editBookmarksBtn').className,
  };
})()`);
pass('切回 start 后 nav 移出', tyOf(back.navTransform) !== null && tyOf(back.navTransform) > 600, back.navTransform);
pass('切回 start 后 start 回位', back.startTransform === 'none' || back.startTransform === 'matrix(1, 0, 0, 1, 0, 0)', back.startTransform);
pass('齿轮恢复', !back.gearClass.includes('hidden-on-nav'));
pass('nav-hidden 恢复', back.navClass.includes('nav-hidden'));

// ---------- 5. 键盘切换 ----------
await evalJS(`(async () => {
  document.activeElement && document.activeElement.blur && document.activeElement.blur();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 700));
})()`);
const kbdTy = tyOf(await evalJS('getComputedStyle(document.getElementById("startSection")).transform'));
pass('键盘 PageDown 切 nav', kbdTy !== null && kbdTy < -600, `translateY=${kbdTy}`);

// ---------- 6. 编辑弹窗 ----------
await evalJS('document.getElementById("editBookmarksBtn").click()');
await sleep(400);
pass('编辑弹窗可打开', await evalJS('!document.getElementById("editModal").hidden'));
await evalJS('document.getElementById("cancelEditBtn").click()');
await sleep(300);

const code = finish();
await chrome.close();
await server.close();
process.exit(code);

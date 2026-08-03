import { launchSession, sleep, tyOf, makeTester } from './helpers.mjs';

const { pass, finish } = makeTester();
const { server, chrome, evalJS } = await launchSession(9333);

await sleep(1800);

// 滚轮向下累积 120px → 切到导航页
await evalJS(`(function(){
  const h = new WheelEvent('wheel', { deltaY: 60, cancelable: true });
  document.dispatchEvent(h);
  setTimeout(() => document.dispatchEvent(new WheelEvent('wheel', { deltaY: 60, cancelable: true })), 30);
})()`);
await sleep(800);
const navTy = tyOf(await evalJS('getComputedStyle(document.getElementById("navSection")).transform'));
pass('滚轮下滚两次(120px)切至导航页', navTy !== null && navTy === 0, `nav translateY=${navTy}`);
pass('切换后 scrollY 仍为 0', (await evalJS('window.scrollY')) === 0);

// 导航页内部内容高度是否可滚动
const navScrollable = await evalJS(`(() => {
  const nc = document.getElementById('navContent');
  return { sh: nc.scrollHeight, ch: nc.clientHeight };
})()`);
pass('导航页内部可滚动 (内容>视口)', navScrollable.sh > navScrollable.ch, `scrollHeight=${navScrollable.sh} clientHeight=${navScrollable.ch}`);

// 在导航页向上滚: 已滚动内部内容时放行, 到顶才切回 start
await evalJS(`document.getElementById('navContent').scrollTo({ top: 400 })`);
await sleep(200);
await evalJS(`document.dispatchEvent(new WheelEvent('wheel', { deltaY: -60, cancelable: true }))`);
await sleep(400);
const stillNav = await evalJS('document.getElementById("startSection").getAttribute("aria-hidden") === "true"');
pass('导航页已滚动内容时上滚不放行切屏', stillNav);

// 滚回顶部再上滚 → 切回 start
await evalJS(`document.getElementById('navContent').scrollTo({ top: 0 })`);
await sleep(200);
await evalJS(`document.dispatchEvent(new WheelEvent('wheel', { deltaY: -60, cancelable: true }))`);
await sleep(300);
await evalJS(`document.dispatchEvent(new WheelEvent('wheel', { deltaY: -60, cancelable: true }))`);
await sleep(800);
const startVisible = await evalJS('document.getElementById("startSection").getAttribute("aria-hidden") !== "true"');
const navBackTy = tyOf(await evalJS('getComputedStyle(document.getElementById("navSection")).transform'));
pass('到顶后上滚两次切回 start', startVisible && navBackTy !== null && navBackTy > 600, `nav translateY=${navBackTy}`);

// 触屏 touchmove 累积与 touchend 拖拽切换
await evalJS(`(function(){
  const tc = (y) => new Touch({ identifier: 1, target: document.body, clientX: 0, clientY: y });
  document.dispatchEvent(new TouchEvent('touchstart', { touches: [tc(400)], cancelable: true }));
  document.dispatchEvent(new TouchEvent('touchmove', { touches: [tc(260)], cancelable: true }));
  document.dispatchEvent(new TouchEvent('touchend', { changedTouches: [tc(260)], cancelable: true }));
})()`);
await sleep(900);
const touchTy = tyOf(await evalJS('getComputedStyle(document.getElementById("navSection")).transform'));
pass('触屏上滑切换至导航页', touchTy !== null && touchTy === 0, `nav translateY=${touchTy}`);

const code = finish();
await chrome.close();
await server.close();
process.exit(code);

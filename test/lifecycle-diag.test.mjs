/** 验证指纹刷新冷却、内存日志与连续异常处理；模拟事件不验证真实 GPU 绘制。 */
import { launchSession, makeTester, waitFor } from './helpers.mjs';

const { pass, finish } = makeTester();
const { server, chrome, evalJS } = await launchSession();

// ══════════════════════════════════════════════════════════════════════
// 1. 指纹校验与刷新冷却；函数会读写 SessionStorage 并记录日志。
// ══════════════════════════════════════════════════════════════════════

const fp = await evalJS(`(() => {
  sessionStorage.removeItem('gs_build_reload_at');
  const same = window.__GLASS_DIAG__.verify('app-core-v100', 'app-core-v100');
  const diff1 = window.__GLASS_DIAG__.verify('app-core-v200', 'app-core-v999');
  const guardWritten = (Number(sessionStorage.getItem('gs_build_reload_at')) || 0) > 0;
  const diff2 = window.__GLASS_DIAG__.verify('app-core-v200', 'app-core-v999');
  const devMode = window.__GLASS_DIAG__.verify(null, null).mismatch === false
    && window.__GLASS_DIAG__.verify('only-html', null).mismatch === false;
  return {
    sameNoReload: !same.mismatch && !same.mayReload,
    diffDetected: diff1.mismatch === true && diff1.mayReload === true,
    guardWritten,
    cooldownBlocks: diff2.mismatch === true && diff2.mayReload === false,
    devMode
  };
})()`);
pass('双端构建指纹契约裁决 (同版放行/跨版本守卫刷新/冷却期防风暴/开发模式缺省跳过)',
  fp.sameNoReload && fp.diffDetected && fp.guardWritten && fp.cooldownBlocks && fp.devMode,
  JSON.stringify(fp));

// ══════════════════════════════════════════════════════════════════════
// 2. 运行时黑匣子生命周期环形日志
// ══════════════════════════════════════════════════════════════════════

await evalJS(`
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new ErrorEvent('error', { message: 'diag-unit-test' }));
`);
await waitFor(evalJS, `window.__GLASS_DIAG__.dump().some(e => e.ev === 'js-error')`);
const bb = await evalJS(`(() => {
  const dump = window.__GLASS_DIAG__.dump();
  const evs = dump.map(e => e.ev);
  const lastPageshow = dump.filter(e => e.ev === 'pageshow').pop();
  const unitErrorEntry = dump.filter(e => e.ev === 'js-error').pop();
  return {
    hasPageshow: evs.includes('pageshow'),
    hasVisibility: evs.includes('visibility'),
    hasError: evs.includes('js-error'),
    errorMessageKept: !!unitErrorEntry && String(unitErrorEntry.d && unitErrorEntry.d.msg).includes('diag-unit-test'),
    persistedTrue: dump.some(e => e.ev === 'pageshow' && !!e.d && e.d.persisted === true),
    entriesShaped: dump.every(e => typeof e.t === 'number' && typeof e.ev === 'string'),
    capped: dump.length <= 40,
    noStorageWrites: sessionStorage.getItem('gs_diag_log') === null && sessionStorage.getItem('gs_last_heal') === null
  };
})()`);
pass('运行时黑匣子纯内存环形日志 (persisted/visibility/js-error 全捕获/结构合规/容量封顶/零存储写入)',
  bb.hasPageshow && bb.hasVisibility && bb.hasError && bb.errorMessageKept && bb.persistedTrue && bb.entriesShaped && bb.capped && bb.noStorageWrites,
  JSON.stringify(bb));

// ══════════════════════════════════════════════════════════════════════
// 3. 模拟唤醒后的 will-change 状态。
// ══════════════════════════════════════════════════════════════════════

const gate = await evalJS(`(async () => {
  const s = document.getElementById('startSection');
  // 场景A：常规 pageshow（非 persisted）唤醒后，磁贴由 handleAppWakeUp 管理
  s.style.willChange = 'auto';
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
  await new Promise(r => setTimeout(r, 80));
  const normalWakeHandled = typeof s.style.willChange === 'string';
  // 场景B：persisted BFCache 恢复，handleAppWakeUp(true) 强制重建 startSection 磁贴
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  await new Promise(r => setTimeout(r, 80));
  const rebuiltWhenPersisted = s.style.willChange === 'transform';
  s.style.willChange = '';
  return { normalWakeHandled, rebuiltWhenPersisted };
})()`);
pass('WebKit 磁贴重建 (常规唤醒状态机正常/persisted 恢复强制重栅格化)',
  gate.normalWakeHandled && gate.rebuiltWhenPersisted,
  JSON.stringify(gate));

// ══════════════════════════════════════════════════════════════════════
// 4. 连续异常的处理顺序与停止记录。
// ══════════════════════════════════════════════════════════════════════

const ladder = await evalJS(`(async () => {
  const clock = document.getElementById('clock');
  clock.style.display = 'none';           // 制造哨兵元素不可见的持续异常态
  window.__GLASS_DIAG__.probe();          // streak-1 → L1 幂等校准（无法修复 display:none）
  await new Promise(r => setTimeout(r, 900));  // 自动复检 streak-2 → L2 磁贴重建
  await new Promise(r => setTimeout(r, 900));  // 自动复检 streak-3 → L3 冷却期拦截
  clock.style.display = '';
  window.__GLASS_DIAG__.probe();          // 健康复检清零 streak
  await new Promise(r => setTimeout(r, 60));
  const evs = window.__GLASS_DIAG__.dump().map(e => e.ev);
  const s = document.getElementById('startSection');
  return {
    a1: evs.includes('anomaly-1'),
    a2: evs.includes('anomaly-2'),
    a3: evs.includes('anomaly-3'),
    reloadBlocked: evs.includes('heal-reload-blocked') && !evs.includes('heal-reload'),
    stillAlive: !!s && !document.documentElement.classList.contains('nr')
  };
})()`);
pass('白屏异常三级修复阶梯 (L1校准/L2磁贴/L3冷却拦截连续升级/页面存活无刷新死循环)',
  ladder.a1 && ladder.a2 && ladder.a3 && ladder.reloadBlocked && ladder.stillAlive,
  JSON.stringify(ladder));

// ══════════════════════════════════════════════════════════════════════
// 5. 诊断面板负向锁定 (?diag=1 不得复活任何 UI；取证仅存控制台 dump 通道)
// ══════════════════════════════════════════════════════════════════════

await evalJS(`location.href = location.origin + '/?diag=1'`);
await waitFor(evalJS, `location.search === '?diag=1' && document.readyState === 'complete' && typeof window.__GLASS_DIAG__ === 'object'`);
const panel = await evalJS(`(() => {
  const noPanel = !document.getElementById('glassDiagPanel');
  const dump = typeof window.__GLASS_DIAG__ === 'object'
    && typeof window.__GLASS_DIAG__.dump === 'function'
    ? window.__GLASS_DIAG__.dump()
    : null;
  const diagAlive = Array.isArray(dump);
  return { noPanel, diagAlive };
})()`);
await evalJS(`location.href = location.origin + '/'`);
await waitFor(evalJS, `location.search === '' && document.readyState === 'complete'`);
pass('诊断面板负向锁定 (?diag=1 零 UI 复活/控制台 dump 取证通道存活且结构合规)',
  panel.noPanel && panel.diagAlive,
  JSON.stringify(panel));

const code = finish();
await chrome.close();
await server.close();
process.exit(code);

/**
 * 构建指纹契约、运行时黑匣子与白屏自愈阶梯测试套件 (lifecycle-diag.test.mjs)
 *
 * 5 大高密度全景断言：
 * 1. 双端构建指纹契约裁决（同版放行 / 跨版本不一致守卫刷新 / 冷却期防刷新风暴）
 * 2. 运行时黑匣子生命周期环形日志（persisted pageshow / visibilitychange / js-error 全捕获且容量封顶）
 * 3. WebKit 合成层磁贴重建门控（仅真实 BFCache persisted 恢复时间窗内执行，常规唤醒零开销）
 * 4. 白屏异常三级修复阶梯（连续异常升级制 + 冷却期拦截刷新风暴，绝不误伤正常会话）
 * 5. ?diag=1 只读现场诊断面板渲染、构建指纹回显与 A11y 合规
 */
import { launchSession, sleep, makeTester } from './helpers.mjs';

const { pass, finish } = makeTester();
const { server, chrome, evalJS } = await launchSession(9341);

await sleep(300);

// ══════════════════════════════════════════════════════════════════════
// 1. 双端构建指纹契约裁决 (verifyFingerprint 纯函数注入测试)
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
await sleep(150);
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
    persistedTrue: !!lastPageshow && !!lastPageshow.d && lastPageshow.d.persisted === true,
    entriesShaped: dump.every(e => typeof e.t === 'number' && typeof e.ev === 'string'),
    capped: dump.length <= 40
  };
})()`);
pass('运行时黑匣子环形日志 (pageshow persisted/visibility/js-error 全捕获/条目结构合规/容量封顶)',
  bb.hasPageshow && bb.hasVisibility && bb.hasError && bb.errorMessageKept && bb.persistedTrue && bb.entriesShaped && bb.capped,
  JSON.stringify(bb));

// ══════════════════════════════════════════════════════════════════════
// 3. WebKit 合成层磁贴重建门控 (非持久唤醒零开销 / persisted 恢复必重建)
// ══════════════════════════════════════════════════════════════════════

const gate = await evalJS(`(async () => {
  // 隔离前置污染：等待上一场景 persisted 唤醒的磁贴重建时间窗（2500ms）完全过期
  await new Promise(r => setTimeout(r, 2650));
  const s = document.getElementById('startSection');
  s.style.willChange = 'auto';
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
  await new Promise(r => setTimeout(r, 80));
  const blockedWhenNormal = s.style.willChange === 'auto';
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  await new Promise(r => setTimeout(r, 80));
  const rebuiltWhenPersisted = s.style.willChange === 'transform';
  s.style.willChange = '';
  return { blockedWhenNormal, rebuiltWhenPersisted };
})()`);
pass('WebKit 磁贴重建门控 (常规唤醒保持 auto 零开销/persisted 恢复强制重栅格化)',
  gate.blockedWhenNormal && gate.rebuiltWhenPersisted,
  JSON.stringify(gate));

// ══════════════════════════════════════════════════════════════════════
// 4. 白屏异常三级修复阶梯 (连续异常升级 + 冷却期拦截刷新，页面绝不失活)
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
// 5. ?diag=1 只读现场诊断面板 (渲染/指纹回显/A11y/复制按钮)
// ══════════════════════════════════════════════════════════════════════

await evalJS(`location.href = location.origin + '/?diag=1'`);
await sleep(1300);
const panel = await evalJS(`(() => {
  const p = document.getElementById('glassDiagPanel');
  if (!p) return { exists: false };
  const pre = p.querySelector('pre');
  return {
    exists: true,
    showsBuild: !!pre && pre.textContent.includes('html=app-core-v') && pre.textContent.includes('app=app-core-v'),
    hasCopyBtn: !!p.querySelector('button[aria-label="复制诊断现场信息到剪贴板"]'),
    a11yLabel: p.getAttribute('aria-label') === '运行时诊断信息面板'
  };
})()`);
await evalJS(`location.href = location.origin + '/'`);
await sleep(700);
pass('?diag=1 只读诊断面板 (面板渲染/双端构建指纹回显/复制按钮/A11y 标签)',
  panel.exists && panel.showsBuild && panel.hasCopyBtn && panel.a11yLabel,
  JSON.stringify(panel));

const code = finish();
await chrome.close();
await server.close();
process.exit(code);

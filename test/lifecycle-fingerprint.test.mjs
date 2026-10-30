/** 验证保留的构建指纹刷新冷却与页面唤醒行为。 */
import { launchSession, makeTester } from './support/helpers.mjs';

const { pass, finish } = makeTester();
const { server, chrome, evalJS } = await launchSession();

const fp = await evalJS(`(() => {
  sessionStorage.removeItem('gs_build_reload_at');
  const same = verifyFingerprint('app-core-v100', 'app-core-v100');
  const diff1 = verifyFingerprint('app-core-v200', 'app-core-v999');
  const guardWritten = (Number(sessionStorage.getItem('gs_build_reload_at')) || 0) > 0;
  const diff2 = verifyFingerprint('app-core-v200', 'app-core-v999');
  const devMode = verifyFingerprint(null, null).mismatch === false
    && verifyFingerprint('only-html', null).mismatch === false;
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

const code = finish();
await chrome.close();
await server.close();
process.exit(code);

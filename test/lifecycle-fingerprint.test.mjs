/** 验证构建指纹校验与刷新冷却。 */
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

const code = finish();
await chrome.close();
await server.close();
process.exit(code);

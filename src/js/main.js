import { init } from './init.js';
import { initLifecycleAndBlackbox } from './core/lifecycle.js';

// 生产只装配应用；测试兼容接口不在正常页面上挂载。
async function bootstrap() {
    if (window.__GLASS_TEST__ === true) await import('./testing/bridge.js');
    initLifecycleAndBlackbox();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
}
bootstrap();

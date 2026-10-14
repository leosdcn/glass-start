import { init } from './init.js';
import { initLifecycleAndBlackbox } from './core/lifecycle.js';

// 生产编译移除此测试分支；测试构建仍由运行时标记控制接口挂载。
async function bootstrap() {
    if (window.__GLASS_TEST__ === true) await import('./testing/bridge.js');
    initLifecycleAndBlackbox();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
}
bootstrap();

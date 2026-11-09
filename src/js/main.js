import { init } from './init.js';

// 生产编译移除此测试分支；测试构建仍由运行时标记控制接口挂载。
async function bootstrap() {
    if (window.__GLASS_BUILD_HTML__ !== window.__GLASS_BUILD_APP__) {
        console.error('Glass Start: HTML and application build versions differ.');
        return;
    }
    if (window.__GLASS_TEST__ === true) await import('./testing/bridge.js');
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
}
bootstrap();

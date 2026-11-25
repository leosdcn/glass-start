/** 双屏交互边界：到顶保护、连续输入、动画互斥与零动画完成。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { launchSession, waitFor } from './support/helpers.mjs';

test('双屏交互边界与动画完成套件', async t => {
const { server, chrome, send, evalJS } = await launchSession();
t.after(async () => {
    await chrome.close();
    await server.close();
});
const settled = target => waitFor(evalJS, `state.currentSection === '${target}' && !isScreenTransitioning()`);
const idle = () => evalJS('new Promise(resolve => setTimeout(resolve, CONFIG.GESTURE.WHEEL_IDLE_MS + 40))');
const wheel = (delta, extra = '') => evalJS(`document.dispatchEvent(new WheelEvent('wheel', { deltaY:${delta}, cancelable:true, ${extra} }))`);
const section = () => evalJS('state.currentSection');
try {
    // Chrome 保留离屏绘制，但第二屏仍不能命中指针或获得焦点。
    assert.equal(await evalJS(`(() => {
        const nav = dom.navSection;
        const surface = nav.querySelector('.nav-surface');
        const hit = document.elementFromPoint(innerWidth / 2, innerHeight - 2);
        return nav.inert && nav.getAttribute('aria-hidden') === 'true' &&
            nav.getBoundingClientRect().top >= innerHeight - 1 && !nav.contains(hit) &&
            getComputedStyle(nav).pointerEvents === 'none' &&
            getComputedStyle(nav).willChange === 'transform' &&
            getComputedStyle(surface).backdropFilter !== 'none';
    })()`), true);
    // 移除 Chrome 标记后仍采用隐藏、卸载玻璃及释放合成提示的原路径。
    assert.deepEqual(await evalJS(`(() => {
        document.documentElement.classList.remove('is-chrome');
        try {
            return [getComputedStyle(dom.navSection).visibility,
                getComputedStyle(dom.navSection.querySelector('.nav-surface')).backdropFilter,
                getComputedStyle(dom.navSection).willChange];
        } finally { document.documentElement.classList.add('is-chrome'); }
    })()`), ['hidden', 'none', 'auto']);

    // 两种模式使用各自的 CSS 时长，共用速度曲线。
    assert.equal(await evalJS(`(() => {
        const original = document.documentElement.dataset.transitionMode;
        try {
            return ['classic','sheet'].every(mode => {
                document.documentElement.dataset.transitionMode = mode;
                const duration = mode === 'sheet' ? 520 : 580;
                return [dom.startSection,dom.navSection].every(node => {
                    const style = getComputedStyle(node);
                    return style.transitionDuration.split(',').every(value=>Number.parseFloat(value)*1000===duration) &&
                        style.transitionTimingFunction.includes('cubic-bezier(0.28, 0.11, 0.32, 1)');
                });
            });
        } finally { document.documentElement.dataset.transitionMode = original; }
    })()`), true);

    // 调整视口高度时，离屏页应跟随边界移动，不启动一次额外的切屏过渡。
    const viewport = height => send('Emulation.setDeviceMetricsOverride', {
        width: 1280, height, deviceScaleFactor: 1, mobile: false
    });
    const originalMode = await evalJS('document.documentElement.dataset.transitionMode');
    await viewport(680);
    await waitFor(evalJS, 'innerHeight === 680 && Math.abs(dom.navSection.getBoundingClientRect().top - 680) < 1');
    const assertOffscreenAfterResize = async (height, direction) => {
        await viewport(height);
        await waitFor(evalJS, `innerHeight === ${height}`);
        const bounds = await evalJS(`(() => {
            const node = ${direction === 'nav' ? 'dom.navSection' : 'dom.startSection'};
            const animating = node.getAnimations().some(animation =>
                animation instanceof CSSTransition && animation.transitionProperty === 'transform');
            return { animating, inert: node.inert };
        })()`);
        assert.equal(bounds.animating, false, '视口调整不触发 transform 过渡');
        assert.equal(bounds.inert, true);
        const edge = direction === 'nav' ? 'dom.navSection.getBoundingClientRect().top' : 'dom.startSection.getBoundingClientRect().bottom';
        await waitFor(evalJS, `Math.abs(${edge} - ${direction === 'nav' ? height : 0}) < 1`);
    };
    await assertOffscreenAfterResize(840, 'nav');
    await evalJS("document.documentElement.dataset.transitionMode = 'classic'; switchToNav()");
    await settled('nav');
    await assertOffscreenAfterResize(680, 'start');
    await evalJS('switchToStart()');
    await settled('start');

    await evalJS(`(() => {
        window.__resizeWarmupResult = null;
        const nav = dom.navSection;
        const probe = () => {
            const warmup = nav.getAnimations().find(animation => !(animation instanceof CSSTransition));
            if (!warmup || !warmup.currentTime) {
                requestAnimationFrame(probe);
                return;
            }
            const wasInert = nav.inert && nav.getAttribute('aria-hidden') === 'true';
            const wasTransparent = Number(getComputedStyle(nav).opacity) <= 0.0011;
            switchToNav();
            requestAnimationFrame(() => {
                const transform = nav.getAnimations().find(animation =>
                    animation instanceof CSSTransition && animation.transitionProperty === 'transform');
                window.__resizeWarmupResult = [wasInert, wasTransparent, warmup.playState, nav.inert, Boolean(transform)];
            });
        };
        window.addEventListener('resize', () => requestAnimationFrame(probe), { once: true });
    })()`);
    await viewport(760);
    await waitFor(evalJS, 'window.__resizeWarmupResult !== null');
    assert.deepEqual(await evalJS('window.__resizeWarmupResult'), [true, true, 'idle', false, true],
        '预绘制期间导航仍隔离，切入会取消预绘制并正常播放 transform 过渡');
    await settled('nav');
    await evalJS('switchToStart()');
    await settled('start');
    await evalJS(`document.documentElement.dataset.transitionMode = ${JSON.stringify(originalMode)}`);
    await send('Emulation.clearDeviceMetricsOverride');
    console.log('✅ 调整视口不会误播放切屏，预绘制可中断并保持正常入场');

    // 同一短窗口的小位移累计可进入，动画期间 API/键盘/滚轮均不能反转。
    await wheel(10); await wheel(10); await wheel(10);
    assert.equal(await section(), 'start');
    await wheel(10);
    assert.deepEqual(await evalJS(`(() => {
        switchToStart(); switchToNav();
        document.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowUp',cancelable:true,bubbles:true}));
        document.dispatchEvent(new WheelEvent('wheel', {deltaY:-60,cancelable:true}));
        return [state.currentSection, isScreenTransitioning()];
    })()`), ['nav', true]);
    await settled('nav');
    console.log('✅ 两种模式时长与曲线保留，连续输入不能打断切屏');

    // 用浏览器真实默认滚动将内容带到顶部，再发同向尾部事件。
    await evalJS("dom.navContent.style.scrollBehavior='auto'; dom.navContent.scrollTop=30");
    await idle();
    const point = await evalJS('(() => {const r=dom.navContent.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
    // 在实际到顶的 scroll 回调内发送尾部事件，避免 CDP 往返跨过手势静默窗口。
    await evalJS(`(() => {
        window.__topWheelTailSection = null;
        const onTop = () => {
            if (dom.navContent.scrollTop !== 0) return;
            dom.navContent.removeEventListener('scroll', onTop);
            document.dispatchEvent(new WheelEvent('wheel', {deltaY:-60,cancelable:true}));
            window.__topWheelTailSection = state.currentSection;
        };
        dom.navContent.addEventListener('scroll', onTop);
    })()`);
    await send('Input.dispatchMouseEvent', { type:'mouseWheel', ...point, deltaX:0, deltaY:-60 });
    await waitFor(evalJS, 'window.__topWheelTailSection !== null');
    assert.equal(await evalJS('window.__topWheelTailSection'), 'nav');
    assert.equal(await section(), 'nav');
    await idle();
    await wheel(-60);
    await settled('start');
    console.log('✅ 内容滚到顶部的同轮尾部输入不返回，静默后新一轮可返回');

    // 滚回顶部的惯性衰减阶段不误切屏，新一轮向上划动直接返回首屏（无需点击页面）。
    await idle();
    await wheel(60);
    await settled('nav');
    await evalJS("dom.navContent.style.scrollBehavior='auto'; dom.navContent.scrollTop=50");
    await evalJS(`(() => {
        window.__topCoastDone = false;
        const onTop = () => {
            if (dom.navContent.scrollTop !== 0) return;
            dom.navContent.removeEventListener('scroll', onTop);
            (async () => {
                let d = -15;
                for (let i = 0; i < 10; i++) {
                    d *= 0.85;
                    document.dispatchEvent(new WheelEvent('wheel', { deltaY: d, cancelable: true }));
                    await new Promise(r => setTimeout(r, 25));
                }
                window.__topCoastDone = true;
            })();
        };
        dom.navContent.addEventListener('scroll', onTop);
    })()`);
    await send('Input.dispatchMouseEvent', { type:'mouseWheel', ...point, deltaX:0, deltaY:-100 });
    await waitFor(evalJS, 'window.__topCoastDone === true');
    assert.equal(await section(), 'nav');
    await idle();
    await wheel(-60);
    await settled('start');
    console.log('✅ 滚回顶部的惯性动量衰减不误切屏，新一轮划动无需点击直接返回首屏');

    // 同向惯性跨过动画完成边界，也不能重新启动动画或改变状态。
    await idle();
    await wheel(60);
    await settled('nav');
    await wheel(-60); // 反向新意图返回
    await settled('start');
    await idle();
    await wheel(60);
    await settled('nav');
    await idle();
    await wheel(-60);
    // 动画过程中用连续输入延续当前轮次到动画结束之后。
    await evalJS(`(async () => {
        while (isScreenTransitioning()) {
            document.dispatchEvent(new WheelEvent('wheel',{deltaY:-60,cancelable:true}));
            await new Promise(resolve => setTimeout(resolve,40));
        }
        document.dispatchEvent(new WheelEvent('wheel',{deltaY:-60,cancelable:true}));
    })()`);
    assert.equal(await section(), 'start');

    // 修饰键及横向输入不占用切屏；间隔或反向输入清空旧累计。
    await idle();
    for (const modifier of ['ctrlKey','metaKey','altKey','shiftKey']) await wheel(60, `${modifier}:true`);
    await wheel(60, 'deltaX:100');
    assert.equal(await section(), 'start');
    await wheel(30); await idle(); await wheel(10);
    assert.equal(await section(), 'start');
    await wheel(-30); await wheel(30);
    assert.equal(await section(), 'start');
    await wheel(10);
    await settled('nav');
    console.log('✅ 缩放、横向输入不切屏；累计在静默和反向时重置');

    // 从顶部先滚入内容再拉回，同一触屏也不能改变用途。
    assert.equal(await evalJS(`(() => {
        const tc = y => new Touch({identifier:6,target:dom.navContent,clientX:100,clientY:y});
        dom.navContent.dispatchEvent(new TouchEvent('touchstart',{touches:[tc(200)],bubbles:true}));
        dom.navContent.scrollTop=100;
        dom.navContent.dispatchEvent(new TouchEvent('touchmove',{touches:[tc(100)],bubbles:true,cancelable:true}));
        dom.navContent.scrollTop=0;
        dom.navContent.dispatchEvent(new TouchEvent('touchend',{changedTouches:[tc(300)],bubbles:true}));
        return state.currentSection;
    })()`), 'nav');

    // 侧边栏独立滚动，即使内容在顶部也不返回。
    await idle();
    assert.deepEqual(await evalJS(`(() => {
        const el = document.getElementById('sidebar');
        el.style.height='100px'; el.style.maxHeight='100px'; el.scrollTop=100;
        const before=el.scrollTop;
        el.dispatchEvent(new WheelEvent('wheel',{deltaY:-60,cancelable:true,bubbles:true}));
        return [before > 0, state.currentSection];
    })()`), [true, 'nav']);

    // 一次触屏从内容中间滚到顶不能返回；松手后新一轮下滑可以返回。
    assert.equal(await evalJS(`(() => {
        const tc = y => new Touch({identifier:7,target:dom.navContent,clientX:100,clientY:y});
        dom.navContent.scrollTop=100;
        dom.navContent.dispatchEvent(new TouchEvent('touchstart',{touches:[tc(200)],bubbles:true}));
        dom.navContent.scrollTop=0;
        dom.navContent.dispatchEvent(new TouchEvent('touchmove',{touches:[tc(300)],bubbles:true,cancelable:true}));
        dom.navContent.dispatchEvent(new TouchEvent('touchend',{changedTouches:[tc(300)],bubbles:true}));
        return state.currentSection;
    })()`), 'nav');
    await evalJS(`(() => {
        const tc = y => new Touch({identifier:8,target:dom.navContent,clientX:100,clientY:y});
        dom.navContent.dispatchEvent(new TouchEvent('touchstart',{touches:[tc(200)],bubbles:true}));
        dom.navContent.dispatchEvent(new TouchEvent('touchmove',{touches:[tc(300)],bubbles:true,cancelable:true}));
    })()`);
    await settled('start');
    console.log('✅ 侧边栏独立滚动不误退；触屏滚到顶必须松手再下滑');

    // 动画中才落下的手指不应在动画结束后用陈旧起点触发切屏。
    await evalJS(`(() => {
        switchToNav();
        const tc = new Touch({identifier:9,target:document.body,clientX:0,clientY:200});
        document.dispatchEvent(new TouchEvent('touchstart',{touches:[tc]}));
    })()`);
    await settled('nav');
    await evalJS(`document.dispatchEvent(new TouchEvent('touchend',{changedTouches:[new Touch({identifier:9,target:document.body,clientX:0,clientY:400})]}))`);
    assert.equal(await section(), 'nav');

    // 触摸期间被其他入口切到另一屏，松手不能用旧屏的起点切回。
    await evalJS('switchToStart()');
    await settled('start');
    await evalJS(`(() => {
        const point = new Touch({identifier:10,target:dom.startSection,clientX:0,clientY:200});
        dom.startSection.dispatchEvent(new TouchEvent('touchstart',{touches:[point],bubbles:true}));
        switchToNav();
    })()`);
    await settled('nav');
    await evalJS(`(() => {
        const point = new Touch({identifier:10,target:dom.startSection,clientX:0,clientY:400});
        dom.startSection.dispatchEvent(new TouchEvent('touchend',{changedTouches:[point],bubbles:true}));
    })()`);
    assert.equal(await section(), 'nav', '上一屏的触摸不能把当前屏切回去');

    // 无动画无需超时等待，两个方向都能连续立即完成。
    await send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    assert.deepEqual(await evalJS(`(() => {
        switchToStart(); const first=[state.currentSection,isScreenTransitioning()];
        switchToNav(); return [...first,state.currentSection,isScreenTransitioning(),dom.startSection.inert,dom.navSection.inert];
    })()`), ['start',false,'nav',false,true,false]);
    await send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    await evalJS('switchToStart()');
    assert.equal(await evalJS('isScreenTransitioning()'), true);
    await send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await settled('start');
    assert.equal(await evalJS("document.body.classList.contains('is-screen-transitioning')"), false);
    console.log('✅ 触屏起点不残留；减弱动效立即完成，动画中开启也能解锁');

    // 即使外部监听器拦截 transitionend，动画对象仍能结算。
    await send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    await evalJS(`(() => {
        window.__stopScreenEnd = e => e.stopImmediatePropagation();
        dom.navSection.addEventListener('transitionend', __stopScreenEnd, true);
        switchToNav();
    })()`);
    await settled('nav');
    await evalJS(`(() => {
        dom.navSection.removeEventListener('transitionend', __stopScreenEnd, true);
        switchToStart();
        handleAppWakeUp();
        switchToNav();
    })()`);
    await settled('nav');
    assert.deepEqual(await evalJS('[dom.navSection.classList.contains("nav-hidden"),dom.startSection.inert,dom.navSection.inert]'), [false,true,false]);
    assert.equal(await evalJS(`(async () => {
        dom.navSection.style.setProperty('--duration-slide', '0s');
        try {
            switchToStart();
            await new Promise(requestAnimationFrame);
            return !isScreenTransitioning();
        } finally { dom.navSection.style.removeProperty('--duration-slide'); }
    })()`), true);
    console.log('✅ 动画对象结算不依赖事件传播，CSS 零时长和唤醒均能清理切屏锁');
} finally {
    await chrome.close();
    await server.close();
}
});

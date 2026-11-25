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

await t.test('离屏隔离、动效参数与视口调整预绘制', async () => {
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
    assert.deepEqual(await evalJS(`(() => {
        document.documentElement.classList.remove('is-chrome');
        try {
            return [getComputedStyle(dom.navSection).visibility,
                getComputedStyle(dom.navSection.querySelector('.nav-surface')).backdropFilter,
                getComputedStyle(dom.navSection).willChange];
        } finally { document.documentElement.classList.add('is-chrome'); }
    })()`), ['hidden', 'none', 'auto']);

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

    const viewport = height => send('Emulation.setDeviceMetricsOverride', {
        width: 1280, height, deviceScaleFactor: 1, mobile: false
    });
    const originalMode = await evalJS('document.documentElement.dataset.transitionMode');
    try {
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
            const nativeAnimate = nav.animate;
            let animated = false;
            nav.animate = function(...args) {
                animated = true;
                return nativeAnimate.apply(this, args);
            };
            const onResize = () => requestAnimationFrame(probe);
            const cleanupProbe = () => {
                nav.animate = nativeAnimate;
                window.removeEventListener('resize', onResize);
            };
            window.__cleanupResizeWarmupProbe = cleanupProbe;
            const probe = () => {
                const warmup = nav.getAnimations().find(animation => !(animation instanceof CSSTransition));
                if (!warmup) {
                    if (animated) {
                        // 高并发 CPU 抖动导致预绘制短动画在帧间已结束时，重新触发一次 resize 采样。
                        animated = false;
                        window.dispatchEvent(new Event('resize'));
                        return;
                    }
                    requestAnimationFrame(probe);
                    return;
                }
                if (!warmup.currentTime) {
                    requestAnimationFrame(probe);
                    return;
                }
                const wasInert = nav.inert && nav.getAttribute('aria-hidden') === 'true';
                const wasTransparent = Number(getComputedStyle(nav).opacity) <= 0.0011;
                switchToNav();
                requestAnimationFrame(() => {
                    const transform = nav.getAnimations().find(animation =>
                        animation instanceof CSSTransition && animation.transitionProperty === 'transform');
                    cleanupProbe();
                    window.__resizeWarmupResult = [wasInert, wasTransparent, warmup.playState, nav.inert, Boolean(transform)];
                });
            };
            window.addEventListener('resize', onResize);
        })()`);
        await viewport(760);
        await waitFor(evalJS, 'window.__resizeWarmupResult !== null');
        assert.deepEqual(await evalJS('window.__resizeWarmupResult'), [true, true, 'idle', false, true],
            '预绘制期间导航仍隔离，切入会取消预绘制并正常播放 transform 过渡');
        await settled('nav');
        await evalJS('switchToStart()');
        await settled('start');
    } finally {
        await evalJS(`window.__cleanupResizeWarmupProbe?.(); delete window.__cleanupResizeWarmupProbe; document.documentElement.dataset.transitionMode = ${JSON.stringify(originalMode)}`);
        await send('Emulation.clearDeviceMetricsOverride');
    }
});

await t.test('滚轮累计、动画互斥与顶部惯性保护', async () => {
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

    await evalJS("dom.navContent.style.scrollBehavior='auto'; dom.navContent.scrollTop=30");
    await idle();
    const point = await evalJS('(() => {const r=dom.navContent.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
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

    await idle();
    await wheel(60);
    await settled('nav');
    await wheel(-60);
    await settled('start');
    await idle();
    await wheel(60);
    await settled('nav');
    await idle();
    await wheel(-60);
    await evalJS(`(async () => {
        while (isScreenTransitioning()) {
            document.dispatchEvent(new WheelEvent('wheel',{deltaY:-60,cancelable:true}));
            await new Promise(resolve => setTimeout(resolve,40));
        }
        document.dispatchEvent(new WheelEvent('wheel',{deltaY:-60,cancelable:true}));
    })()`);
    assert.equal(await section(), 'start');

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
});

await t.test('触屏滚动保护、侧边栏滚动与切屏后旧触点隔离', async () => {
    await evalJS('switchToNav()');
    await settled('nav');
    assert.equal(await evalJS(`(() => {
        const tc = y => new Touch({identifier:6,target:dom.navContent,clientX:100,clientY:y});
        dom.navContent.dispatchEvent(new TouchEvent('touchstart',{touches:[tc(200)],bubbles:true}));
        dom.navContent.scrollTop=100;
        dom.navContent.dispatchEvent(new TouchEvent('touchmove',{touches:[tc(100)],bubbles:true,cancelable:true}));
        dom.navContent.scrollTop=0;
        dom.navContent.dispatchEvent(new TouchEvent('touchend',{changedTouches:[tc(300)],bubbles:true}));
        return state.currentSection;
    })()`), 'nav');

    await idle();
    const sidebar = document => `(() => {
        const el = ${document}.getElementById('sidebar');
        el.style.height='100px'; el.style.maxHeight='100px'; el.scrollTop=100;
        const before=el.scrollTop;
        el.dispatchEvent(new WheelEvent('wheel',{deltaY:-60,cancelable:true,bubbles:true}));
        el.style.height=''; el.style.maxHeight='';
        return [before > 0, state.currentSection];
    })()`;
    assert.deepEqual(await evalJS(sidebar('document')), [true, 'nav']);

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

    await evalJS(`(() => {
        switchToNav();
        const tc = new Touch({identifier:9,target:document.body,clientX:0,clientY:200});
        document.dispatchEvent(new TouchEvent('touchstart',{touches:[tc]}));
    })()`);
    await settled('nav');
    await evalJS(`document.dispatchEvent(new TouchEvent('touchend',{changedTouches:[new Touch({identifier:9,target:document.body,clientX:0,clientY:400})]}))`);
    assert.equal(await section(), 'nav');

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
});

await t.test('减弱动效、零时长与 BFCache 唤醒解除切屏锁', async () => {
    try {
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
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
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
    } finally {
        await send('Emulation.setEmulatedMedia', { features: [] });
    }
});

await t.test('sessionStorage 写入受阻时切屏与 pageshow 仍保持屏幕状态一致', async () => {
    for (const target of ['nav', 'start']) {
        assert.equal(await evalJS(`(() => {
            reconcileScreenState('${target === 'nav' ? 'start' : 'nav'}', true);
            const native = Storage.prototype.setItem;
            Storage.prototype.setItem = function(key, value) {
                if (this === sessionStorage) throw Error('blocked');
                return native.call(this, key, value);
            };
            try {
                ${target === 'nav' ? 'switchToNav' : 'switchToStart'}();
                window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
                return state.currentSection;
            } finally {
                Storage.prototype.setItem = native;
            }
        })()`), target);
    }
});
});

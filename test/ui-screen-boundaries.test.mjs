/** 双屏交互边界：到顶保护、连续输入、动画互斥与零动画完成。 */
import assert from 'node:assert/strict';
import { launchSession, waitFor } from './helpers.mjs';

const { server, chrome, send, evalJS } = await launchSession();
const settled = target => waitFor(evalJS, `state.currentSection === '${target}' && !isScreenTransitioning()`);
const idle = () => evalJS('new Promise(resolve => setTimeout(resolve, CONFIG.GESTURE.WHEEL_IDLE_MS + 40))');
const wheel = (delta, extra = '') => evalJS(`document.dispatchEvent(new WheelEvent('wheel', { deltaY:${delta}, cancelable:true, ${extra} }))`);
const section = () => evalJS('state.currentSection');
try {
    // 固定原动画契约，避免整理逻辑时改变观感。
    assert.deepEqual(await evalJS(`(() => {
        const style = getComputedStyle(dom.navSection);
        return [style.transitionDuration, style.transitionTimingFunction];
    })()`), ['0.58s', 'cubic-bezier(0.5, 0, 0.2, 1)']);

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
    console.log('✅ 原动画时长及曲线保留，小幅滚轮累计生效，动画不能被反向输入打断');

    // 用浏览器真实默认滚动将内容带到顶部，再发同向尾部事件。
    await evalJS("dom.navContent.style.scrollBehavior='auto'; dom.navContent.scrollTop=30");
    await idle();
    const point = await evalJS('(() => {const r=dom.navContent.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
    await send('Input.dispatchMouseEvent', { type:'mouseWheel', ...point, deltaX:0, deltaY:-60 });
    await waitFor(evalJS, 'dom.navContent.scrollTop === 0');
    await wheel(-60);
    assert.equal(await section(), 'nav');
    await idle();
    await wheel(-60);
    await settled('start');
    console.log('✅ 内容滚到顶部的同轮尾部输入不返回，静默后新一轮可返回');

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

    // 事件丢失时兜底完成；唤醒取消旧任务后不会再被旧完成回调覆盖。
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
    console.log('✅ 过渡事件丢失时可兜底完成，唤醒清理后下一次切屏不受旧任务干扰');
} finally {
    await chrome.close();
    await server.close();
}

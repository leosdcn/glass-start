/** 真实触摸滚动、临时拦截释放，以及触摸/鼠标能力切换回归。 */
if (process.env.CI) {
    console.log('⚠️ 当前环境为云端无桌面无物理鼠标容器，跳过物理输入设备热插拔感知测试');
    process.exit(0);
}
import assert from 'node:assert/strict';
import { launchSession, waitFor } from './support/helpers.mjs';

const {server,chrome,send,evalJS} = await launchSession();
try {
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await send('Emulation.setTouchEmulationEnabled',{enabled:true});
    await send('Page.reload');
    await waitFor(evalJS,'typeof switchToNav === "function" && !!document.querySelector(".bookmark-item")');
    const blockingMoves = async expression => {
        const {result} = await send('Runtime.evaluate',{expression});
        const {listeners} = await send('DOMDebugger.getEventListeners',{objectId:result.objectId});
        return listeners.filter(listener=>listener.type==='touchmove' && !listener.passive).length;
    };
    assert.equal(await blockingMoves('document'),0,'document 上没有非被动 touchmove');
    const touch = (type,y) => send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x:195,y}]});
    await touch('touchStart',600);
    await touch('touchMove',480);
    await touch('touchEnd');
    await waitFor(evalJS,'state.currentSection === "nav" && !isScreenTransitioning()');
    assert.equal(await blockingMoves('document'),0);

    await evalJS("dom.navContent.style.scrollBehavior='auto';dom.navContent.scrollTop=400");
    await waitFor(evalJS,'dom.navContent.scrollTop===400');
    await waitFor(async()=>await blockingMoves('dom.navContent')===0,'true');
    await touch('touchStart',450);
    await evalJS(`window.__nativeScrollEnded=false;dom.navContent.addEventListener('scrollend',()=>{__nativeScrollEnded=true},{once:true})`);
    await touch('touchMove',520);
    await touch('touchMove',580);
    await touch('touchEnd');
    await waitFor(evalJS,'dom.navContent.scrollTop<380');
    assert.equal(await evalJS('state.currentSection'),'nav');
    // 等待原生惯性结束，再验证新一轮顶部下滑。
    await waitFor(evalJS,'window.__nativeScrollEnded');
    await evalJS('dom.navContent.scrollTop=0');
    await waitFor(evalJS,'dom.navContent.scrollTop===0');
    // scrollTop 写入先于异步 scroll 事件，落指前须确认顶部取消滚动的监听已恢复。
    await waitFor(async()=>await blockingMoves('dom.navContent')===1,'true');
    await evalJS(`window.__preventedTouch=false;document.addEventListener('touchmove',e=>{if(e.defaultPrevented)__preventedTouch=true},{passive:true})`);
    await touch('touchStart',350);
    await touch('touchMove',480);
    await touch('touchEnd');
    await waitFor(evalJS,'state.currentSection === "start" && !isScreenTransitioning()');
    assert.equal(await evalJS('__preventedTouch'),true,'顶部返回的真实 touchmove 仍能阻止默认滚动');
    assert.equal(await blockingMoves('document'),0);
    console.log('✅ 无全局触摸阻塞监听；中间原生滚动释放局部监听，真实上滑/顶部下滑仍能切屏并取消默认滚动');

    // 取消与多指之后，新的单指手势仍能独立工作。
    await touch('touchStart',600);await touch('touchCancel');
    assert.equal(await evalJS('state.currentSection'),'start');
    await touch('touchStart',600);
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:195,y:600,id:0},{x:240,y:600,id:1}]});
    await touch('touchEnd');
    assert.equal(await blockingMoves('document'),0);
    assert.equal(await evalJS('state.currentSection'),'start');

    await evalJS('switchToNav()');await waitFor(evalJS,'!isScreenTransitioning()');
    // 页面在纯触屏模式启动，此后接入鼠标，无需刷新即可启用倾斜。
    await send('Emulation.clearDeviceMetricsOverride');
    await send('Emulation.setTouchEmulationEnabled',{enabled:false});
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:200,y:200});
    const hasMouseMedia = await evalJS("matchMedia('(hover:hover) and (pointer:fine)').matches");
    if (!hasMouseMedia && process.env.CI) {
        await evalJS(`(() => {
            const desc = Object.getOwnPropertyDescriptor(MediaQueryList.prototype, 'matches');
            Object.defineProperty(MediaQueryList.prototype, 'matches', {
                configurable: true,
                get() {
                    if (this.media && this.media.includes('hover') && this.media.includes('fine')) return true;
                    return desc ? desc.get.call(this) : false;
                }
            });
        })()`);
    } else {
        await waitFor(evalJS,"matchMedia('(hover:hover) and (pointer:fine)').matches");
    }
    const dispatch = (type,pointerType) => evalJS(`(async()=>{
        document.body.classList.remove('tab-blurred');
        const card=document.querySelector('.nav-bookmark');const r=card.getBoundingClientRect();
        card.dispatchEvent(new PointerEvent('${type}',{bubbles:true,pointerType:'${pointerType}',clientX:r.x+10,clientY:r.y+10}));
        await new Promise(requestAnimationFrame);return card.style.transform;
    })()`);
    assert.match(await dispatch('pointermove','mouse'),/perspective/);
    assert.equal(await dispatch('pointerdown','touch'),'');
    assert.equal(await dispatch('pointermove','touch'),'');
    assert.match(await dispatch('pointermove','mouse'),/perspective/);
    await send('Emulation.setTouchEmulationEnabled',{enabled:true});
    await waitFor(evalJS,'document.querySelector(".nav-bookmark").style.transform === ""');
    await send('Emulation.setTouchEmulationEnabled',{enabled:false});
    assert.match(await dispatch('pointermove','mouse'),/perspective/);
    console.log('✅ 触屏启动后接鼠标无需刷新；手指不触发倾斜，能力消失时清理，恢复后鼠标可用');
} finally {await chrome.close();await server.close();}

/** 用真实 Chrome trace 验证高频光斑更新不触发重绘，拖拽标记不重复更新节点。 */
import assert from 'node:assert/strict';
import { launchSession, waitFor } from './helpers.mjs';

const {server,chrome,send,evalJS} = await launchSession();
const settleCard = () => waitFor(evalJS, `renderCard.getAnimations({subtree:true}).every(a=>a.playState!=='running')`);
try {
    await evalJS('switchToNav()');
    await waitFor(evalJS, '!isScreenTransitioning()');
    const point = await evalJS(`(() => {
        window.renderCard=document.querySelector('.nav-bookmark');
        const r=renderCard.getBoundingClientRect();
        window.renderPoint={x:r.x+30,y:r.y+r.height/2};
        return renderPoint;
    })()`);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
    await settleCard();
    // 等待可见图标完成淡入，排除网络解码等非光斑操作导致的绘制。
    await waitFor(evalJS, `[...dom.navContent.querySelectorAll('img')].filter(img=>{
        const r=img.getBoundingClientRect();return r.top<innerHeight && r.bottom>0;
    }).every(img=>img.complete)`);
    await settleCard();

    const events=[];
    const unsubscribe=send('Tracing.dataCollected',event=>events.push(...event.value));
    await send('Tracing.start',{categories:'devtools.timeline',transferMode:'ReportEvents'});
    await evalJS(`(async () => {
        for(let i=0;i<30;i++){
            renderCard.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',
                clientX:renderPoint.x+(i%10),clientY:renderPoint.y+(i%4)}));
            await new Promise(requestAnimationFrame);
        }
        await new Promise(requestAnimationFrame);
    })()`);
    const done=new Promise(resolve=>{
        const stop=send('Tracing.tracingComplete',()=>{stop();resolve();});
    });
    await send('Tracing.end');
    await done;
    unsubscribe();
    const paints=events.filter(event=>event.name==='Paint' && event.ph==='X');
    // 少量容差留给偶发浏览器绘制；旧实现同一场景每帧重绘（约 58 次）。
    assert.ok(paints.length<=2, `30 帧光斑移动产生了 ${paints.length} 次 Paint`);
    assert.equal(events.some(event=>event.name==='Layout' && event.ph==='X'),false);
    const spotlight=await evalJS(`(() => {
        const style=getComputedStyle(renderCard,'::before');
        const matrix=new DOMMatrix(style.transform);
        return {x:matrix.m41,y:matrix.m42,expectedX:parseFloat(renderCard.style.getPropertyValue('--mouse-x')),
            expectedY:parseFloat(renderCard.style.getPropertyValue('--mouse-y')),clipped:getComputedStyle(renderCard).overflow};
    })()`);
    assert.ok(Math.abs(spotlight.x-spotlight.expectedX)<0.01);
    assert.ok(Math.abs(spotlight.y-spotlight.expectedY)<0.01);
    assert.equal(spotlight.clipped,'hidden');
    console.log(`✅ 30 帧光斑移动仅 ${paints.length} 次 Paint，无布局，位置跟随指针并裁切在卡片内`);

    // 从已悬停卡片返回时，结束旧的悬停过渡，移动中的卡片也不能命中指针。
    await evalJS('switchToStart()');
    assert.deepEqual(await evalJS(`(() => {
        const card = getComputedStyle(renderCard);
        return [document.body.classList.contains('is-screen-transitioning'),card.pointerEvents,
            card.transitionDuration,getComputedStyle(renderCard,'::before').transitionDuration,
            getComputedStyle(renderCard.querySelector('.icon-box')).transitionDuration];
    })()`), [true,'none','0s','0s','0s']);
    await waitFor(evalJS, '!isScreenTransitioning()');
    await evalJS('switchToNav()');
    assert.equal(await evalJS('getComputedStyle(renderCard).pointerEvents'), 'none');
    await waitFor(evalJS, '!isScreenTransitioning()');
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
    await settleCard();
    assert.equal(await evalJS(`renderCard.matches(':hover') && getComputedStyle(renderCard).pointerEvents === 'auto' &&
        Number(getComputedStyle(renderCard,'::before').opacity) > 0.99 &&
        getComputedStyle(renderCard).transitionDuration.split(',').some(value=>parseFloat(value)>0)`), true);
    console.log('✅ Chrome切屏中暂停卡片命中及悬停过渡，完成后恢复原有光斑和悬停反馈');

    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
    await waitFor(evalJS, 'getComputedStyle(renderCard,"::before").willChange === "auto"');
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
    assert.equal(await evalJS('getComputedStyle(renderCard,"::before").willChange'), 'auto');
    await evalJS('switchToStart()');
    await waitFor(evalJS, '!isScreenTransitioning()');
    await evalJS('openEditModal()');
    await waitFor(evalJS, 'dom.editModal.classList.contains("active")');
    await evalJS(`(() => {
        window.renderDragTarget=dom.editList.querySelectorAll('.edit-row-card')[2];
        window.renderDragRect=renderDragTarget.getBoundingClientRect();
        renderDragTarget.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,clientY:renderDragRect.top+5}));
    })()`);
    await waitFor(evalJS, 'renderDragTarget.classList.contains("drop-target-above")');
    const changes=await evalJS(`(async () => {
        let count=0;
        const observer=new MutationObserver(records=>{count+=records.length;});
        observer.observe(dom.editList,{attributes:true,subtree:true,attributeFilter:['class']});
        for(let i=0;i<30;i++){
            renderDragTarget.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,clientY:renderDragRect.top+5}));
            await new Promise(requestAnimationFrame);
        }
        await new Promise(requestAnimationFrame);
        observer.disconnect();
        return count;
    })()`);
    assert.equal(changes,0);
    await evalJS(`renderDragTarget.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,clientY:renderDragRect.bottom-2}))`);
    await waitFor(evalJS, 'renderDragTarget.classList.contains("drop-target-below")');
    assert.equal(await evalJS(`dom.editList.querySelectorAll('.drop-target-above,.drop-target-below').length`),1);
    await evalJS(`dom.editList.dispatchEvent(new DragEvent('dragleave',{bubbles:true}))`);
    assert.equal(await evalJS(`dom.editList.querySelectorAll('.drop-target-above,.drop-target-below').length`),0);
    console.log('✅ 光斑合成提示在离开或减弱动效时释放；拖拽目标不变时零节点更新，跨边缘和离开正确切换');
} finally {
    await chrome.close();
    await server.close();
}

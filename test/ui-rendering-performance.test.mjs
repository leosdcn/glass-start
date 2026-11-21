/** 验证光斑坐标与溢出裁切，切屏过渡状态与拖拽节点零更新。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { launchSession, waitFor, navigateAndWait } from './support/helpers.mjs';

test('导航悬停与拖拽渲染', async () => {
    const {server,chrome,send,evalJS} = await launchSession();
    const settleCard = () => waitFor(evalJS, `renderCard.getAnimations({subtree:true}).every(a=>a.playState!=='running')`);
    try {
        // 该用例测量指针更新；真实天气响应会在任意时刻重建天气 DOM，污染全页。
        // 在重新启动应用前准备有效缓存，天气网络与刷新行为由对应数据回归覆盖。
        await send('Page.addScriptToEvaluateOnNewDocument', {source:`
            localStorage.setItem('glass_weather_cache', JSON.stringify({
                timestamp:Date.now(), current:{temp:20,icon:'☀️',weatherText:'晴'},
                location:{name:'测试地点'}, daily:[]
            }));
        `});
        await navigateAndWait(send, evalJS, 'http://127.0.0.1:' + server.port + '/',
            `typeof switchToNav === 'function' && !!document.querySelector('.bookmark-item')`);
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

        const spotlight = await evalJS(`(() => {
            const style = getComputedStyle(renderCard, '::before');
            const matrix = new DOMMatrix(style.transform);
            return {
                x: matrix.m41,
                y: matrix.m42,
                expectedX: parseFloat(renderCard.style.getPropertyValue('--mouse-x')),
                expectedY: parseFloat(renderCard.style.getPropertyValue('--mouse-y')),
                clipped: getComputedStyle(renderCard).overflow
            };
        })()`);
        assert.ok(Math.abs(spotlight.x - spotlight.expectedX) < 0.01);
        assert.ok(Math.abs(spotlight.y - spotlight.expectedY) < 0.01);
        assert.equal(spotlight.clipped, 'hidden');

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
        console.log('✅ 切屏中暂停卡片命中及悬停过渡，完成后恢复原有光斑和悬停反馈');

        await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
        await waitFor(evalJS, 'getComputedStyle(renderCard,"::before").willChange === "auto"');
        const measurements = await evalJS(`(async () => {
            const cards = [...dom.navCategories.querySelectorAll('.nav-bookmark')].slice(0, 3);
            const reads = [0, 0, 0];
            const read = Element.prototype.getBoundingClientRect;
            const rects = cards.map(card => read.call(card));
            for (const [i, card] of cards.entries()) {
                card.getBoundingClientRect = function() { reads[i]++; return read.call(this); };
            }
            try {
                for (const [i, card] of cards.entries()) {
                    card.dispatchEvent(new PointerEvent('pointermove', { bubbles:true, pointerType:'mouse',
                        clientX:rects[i].left+10, clientY:rects[i].top+10 }));
                }
                const beforeFrame = [...reads];
                await new Promise(requestAnimationFrame);
                return [beforeFrame, reads, cards.map(card => card.style.transform.includes('perspective'))];
            } finally { for (const card of cards) delete card.getBoundingClientRect; }
        })()`);
        assert.deepEqual(measurements, [[0,0,0], [0,0,1], [false,false,true]]);
        await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
        await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
        assert.equal(await evalJS('getComputedStyle(renderCard,"::before").willChange'), 'auto');
        await evalJS('switchToStart()');
        await waitFor(evalJS, '!isScreenTransitioning()');
        await evalJS('openEditModal()');
        await waitFor(evalJS, 'document.getElementById("editModal").open');
        await evalJS(`(() => {
            const rows = dom.editList.querySelectorAll('.edit-row-card');
            const source = rows[0];
            source.querySelector('.drag-handle').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
            source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true}));
            window.renderDragTarget=rows[2];
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
        assert.deepEqual(await evalJS(`(async () => {
            const rows = [...dom.editList.querySelectorAll('.edit-row-card')];
            const [source, alternate, target] = rows;
            const order = () => modalState.draftBookmarks.map(bookmark => bookmark.id);
            const drag = (element, type, clientY) =>
                element.dispatchEvent(new DragEvent(type, {bubbles:true,cancelable:true,clientY}));
            const start = () => {
                source.querySelector('.drag-handle').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
                drag(source,'dragstart',0);
            };
            const unchanged = [];
            const original = JSON.stringify(order());
            for (const [invalid, event] of [[source, 'dragenter'], [dom.editList, 'dragover']]) {
                start();
                drag(target, 'dragover', target.getBoundingClientRect().bottom-2);
                await new Promise(requestAnimationFrame);
                drag(invalid, event, invalid.getBoundingClientRect().top+5);
                const noIndicator = !dom.editList.querySelector('.drop-target-above,.drop-target-below');
                drag(invalid, 'drop', invalid.getBoundingClientRect().top+5);
                drag(source, 'dragend', 0);
                unchanged.push(noIndicator && JSON.stringify(order()) === original);
            }
            start();
            drag(target, 'dragover', target.getBoundingClientRect().bottom-2);
            drag(alternate, 'drop', alternate.getBoundingClientRect().bottom-2);
            drag(source, 'dragend', 0);
            return {unchanged, actualTarget: order()[0] === alternate.dataset.id && order()[1] === source.dataset.id
                && order()[2] === target.dataset.id};
        })()`), { unchanged: [true,true], actualTarget: true });
        console.log('✅ 光斑合成提示在离开或减弱动效时释放；拖拽目标不变时零节点更新，跨边缘和离开正确切换');
    } finally {
        await chrome.close();
        await server.close();
    }
});

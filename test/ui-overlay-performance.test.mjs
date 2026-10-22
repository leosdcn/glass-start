/** 弹窗隔离只更新变化的区域，保留嵌套焦点和屏幕状态恢复。 */
import assert from 'node:assert/strict';
import {launchSession,waitFor} from './helpers.mjs';

const {server,chrome,send,evalJS}=await launchSession();
try {
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await evalJS('dom.editBookmarksBtn.focus();openEditModal()');
    await waitFor(evalJS,'dom.editModal.contains(document.activeElement)');
    const result=await evalJS(`(async()=>{
        let count=0;
        const observer=new MutationObserver(records=>count+=records.length);
        observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['inert']});
        const focused=document.activeElement;
        for(let i=0;i<20;i++)OverlayStack.pop('absent-performance-layer');
        for(let i=0;i<20;i++)OverlayStack.syncModalAccessibility();
        await new Promise(requestAnimationFrame);
        observer.disconnect();
        return{mutations:count,focus:focused===document.activeElement,
            isolated:dom.startSection.inert&&dom.navSection.inert&&!dom.editModal.inert};
    })()`);
    assert.deepEqual(result,{mutations:0,focus:true,isolated:true});
    console.log('✅ 空关闭与相同隔离状态重复同步均零 inert 写入，焦点和背景隔离不变');

    await evalJS(`(()=>{
        window.performanceInertChanges=[];
        window.performanceInertObserver=new MutationObserver(records=>{
            performanceInertChanges.push(...records.map(record=>record.target.id));
        });
        performanceInertObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:['inert']});
        dom.togglePickerBtn.focus();openBookmarkPicker();
    })()`);
    await waitFor(evalJS,'dom.bookmarkPicker.contains(document.activeElement)');
    assert.equal(await evalJS(`!performanceInertChanges.includes('startSection') && !performanceInertChanges.includes('navSection')`),true);
    assert.equal(await evalJS('dom.editModal.inert && !dom.bookmarkPicker.inert'),true);
    await evalJS(`dom.donePickerBtn.click()`);
    await waitFor(evalJS,'document.activeElement===dom.togglePickerBtn');
    assert.equal(await evalJS(`!performanceInertChanges.includes('startSection') && !performanceInertChanges.includes('navSection')`),true);
    await evalJS('performanceInertObserver.disconnect()');
    console.log('✅ 嵌套弹窗开关只更新变化的弹窗区域，持续隔离的两屏不重复切换');

    await evalJS(`OverlayStack.setBaseInert(dom.startSection,true);closeEditModal()`);
    await waitFor(evalJS,'!state.editOpen && dom.editModal.hidden');
    assert.equal(await evalJS('dom.startSection.inert && dom.navSection.inert'),true);
    await evalJS(`OverlayStack.setBaseInert(dom.startSection,false);dom.editBookmarksBtn.focus();openEditModal()`);
    await waitFor(evalJS,'dom.editModal.contains(document.activeElement)');
    await evalJS('closeEditModal()');
    await waitFor(evalJS,'document.activeElement===dom.editBookmarksBtn');
    assert.equal(await evalJS('!dom.startSection.inert && dom.navSection.inert'),true);
    console.log('✅ 隔离期间更新的屏幕基础状态保留，最终退栈恢复隔离和触发焦点');
}finally{
    await chrome.close();await server.close();
}

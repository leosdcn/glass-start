import assert from 'node:assert/strict';
import { launchSession, waitFor } from './support/helpers.mjs';
import { test } from 'node:test';

await test("焦点循环、嵌套弹窗与背景隔离", async () => {
    const { server, chrome, send, evalJS } = await launchSession();
    const escape = async () => {
      await send('Input.dispatchKeyEvent', { type:'keyDown', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 });
      await send('Input.dispatchKeyEvent', { type:'keyUp', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 });
    };
    try {
      await waitFor(evalJS, 'typeof openEditModal === "function"');
      await send('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion', value:'reduce'}] });
      await evalJS('dom.editBookmarksBtn.focus(); openEditModal();');
      await waitFor(evalJS, 'dom.editModal.contains(document.activeElement) && dom.editModal.classList.contains("active")');
      const root = await evalJS(`(() => {
    dom.searchInput.focus();
    return {focusBlocked:dom.editModal.contains(document.activeElement),
      background:dom.startSection.inert && dom.navSection.inert, ancestor:!document.body.inert,
      modal:!dom.editModal.inert};
  })()`);
      assert.equal(Object.values(root).every(Boolean), true, JSON.stringify(root));
      const { root: document } = await send('DOM.getDocument');
      const { nodeId } = await send('DOM.querySelector', { nodeId:document.nodeId, selector:'#searchInput' });
      const ax = await send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives:false });
      assert.equal(ax.nodes[0].ignored, true);
      await evalJS("window.dispatchEvent(new Event('pageshow'));");
      assert.equal(await evalJS('dom.startSection.inert && dom.navSection.inert'), true);
      console.log('✅ 打开立即进入弹窗焦点，背景拒绝焦点且从无障碍树排除，页面唤醒不解除隔离');

      await evalJS('dom.togglePickerBtn.focus(); openBookmarkPicker();');
      await waitFor(evalJS, 'dom.bookmarkPicker.contains(document.activeElement)');
      await evalJS("dom.donePickerBtn.focus(); showConfirm('测试通知', null, '测试', dom.donePickerBtn);");
      await waitFor(evalJS, 'dom.confirmModal.contains(document.activeElement)');
      assert.equal(await evalJS('dom.editModal.inert && dom.bookmarkPicker.inert && !dom.confirmModal.inert'), true);
      await escape();
      await waitFor(evalJS, 'document.activeElement === dom.donePickerBtn && !dom.bookmarkPicker.inert');
      assert.equal(await evalJS('dom.editModal.inert'), true);
      await escape();
      await waitFor(evalJS, 'document.activeElement === dom.togglePickerBtn && !dom.editModal.inert');
      await escape();
      await waitFor(evalJS, 'document.activeElement === dom.editBookmarksBtn && !state.editOpen');
      assert.equal(await evalJS('!dom.startSection.inert && dom.navSection.inert && !document.body.classList.contains("overflow-hidden")'), true);
      console.log('✅ 设置→选择器→确认框逐层 Escape 恢复触发焦点，原屏幕 inert 与滚动锁正确恢复');

      const edge = await evalJS(`(async () => {
    const existing = document.createElement('div'); existing.inert = true; document.body.appendChild(existing);
    await openEditModal(); closeEditModal();
    await new Promise(requestAnimationFrame);
    const quickClose = !dom.editModal.classList.contains('active') && !state.editOpen && !dom.startSection.inert;
    await openEditModal();
    await new Promise(requestAnimationFrame);
    const reopened = dom.editModal.contains(document.activeElement) && dom.startSection.inert;
    closeEditModal(); await new Promise(requestAnimationFrame);
    const preserved = existing.inert; existing.remove();
    const opener = document.createElement('button'); opener.type = 'button'; opener.textContent = '临时触发';
    document.body.appendChild(opener); opener.focus(); openCreditsModal(); opener.remove();
    await new Promise(requestAnimationFrame); closeCreditsModal(); await new Promise(requestAnimationFrame);
    const fallback = document.activeElement.isConnected && document.activeElement !== document.body &&
      !document.activeElement.closest('[inert], [hidden], [aria-hidden="true"]');
    const hidden = document.createElement('button'); hidden.type = 'button'; hidden.textContent = '隐藏触发';
    document.body.appendChild(hidden); hidden.focus(); openShortcutModal();
    await new Promise(requestAnimationFrame); hidden.style.visibility = 'hidden';
    closeShortcutModal(); await new Promise(requestAnimationFrame);
    const hiddenFallback = document.activeElement !== hidden && document.activeElement !== document.body;
    hidden.remove();
    return {quickClose, reopened, preserved, fallback, hiddenFallback};
  })()`);
      assert.equal(Object.values(edge).every(Boolean), true, JSON.stringify(edge));
      console.log('✅ 快速关闭不被迟到动画重开，重新打开正常，既有 inert 和触发元素移除均正确处理');
      assert.equal(await evalJS('dom.editModal.hidden && dom.shortcutModal.hidden && dom.creditsModal.hidden'), true);
      await send('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion', value:'no-preference'}] });
      const animated = await evalJS(`(async () => {
    openShortcutModal(); closeShortcutModal();
    await new Promise(resolve => setTimeout(resolve, CONFIG.TIMERS.MODAL_HIDE_DELAY + 60));
    const closed = dom.shortcutModal.hidden && !dom.shortcutModal.classList.contains('active');

    // 1) 第一帧与第二帧之间取消：不挂载 .active，等待延迟隐藏后干净退栈
    openShortcutModal(); await new Promise(requestAnimationFrame);
    closeShortcutModal();
    await new Promise(resolve => setTimeout(resolve, CONFIG.TIMERS.MODAL_HIDE_DELAY + 60));
    const midFrameCanceled = dom.shortcutModal.hidden && !dom.shortcutModal.classList.contains('active') && OverlayStack.isEmpty();

    // 2) 完全激活后退出途中（<220ms）重开：单帧立即反转接续并恢复焦点
    openShortcutModal();
    while (!dom.shortcutModal.classList.contains('active')) await new Promise(requestAnimationFrame);
    closeShortcutModal();
    const midExitHidden = !dom.shortcutModal.hasAttribute('hidden');
    openShortcutModal();
    await new Promise(resolve => setTimeout(resolve, CONFIG.TIMERS.MODAL_HIDE_DELAY + 60));
    const reopened = !dom.shortcutModal.hidden && dom.shortcutModal.classList.contains('active') &&
      dom.shortcutModal.contains(document.activeElement);

    // 3) 双层 rAF 入场期间连按快捷键（⌘/）：识别为已在栈中并关闭而非重复打开
    closeShortcutModal();
    await new Promise(resolve => setTimeout(resolve, CONFIG.TIMERS.MODAL_HIDE_DELAY + 60));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', metaKey: true, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', metaKey: true, bubbles: true }));
    const rapidKeyHandled = OverlayStack.isEmpty();

    openShortcutModal();
    while (!dom.shortcutModal.classList.contains('active')) await new Promise(requestAnimationFrame);
    closeShortcutModal();
    const exitStarted = !dom.shortcutModal.hidden && dom.shortcutModal.getAttribute('aria-hidden') === 'true' &&
      !dom.shortcutModal.contains(document.activeElement);
    await new Promise(resolve => setTimeout(resolve, CONFIG.TIMERS.MODAL_HIDE_DELAY + 60));
    const exitFinished = dom.shortcutModal.hidden && OverlayStack.isEmpty() && !dom.startSection.inert;
    return {closed, midFrameCanceled, midExitHidden, reopened, rapidKeyHandled, exitStarted, exitFinished};
  })()`);
      assert.equal(Object.values(animated).every(Boolean), true, JSON.stringify(animated));
      console.log('✅ 普通动效下区分两帧间取消与退出重开，连按快捷键正确切换，退栈延迟隐藏');
    } finally {
      await chrome.close();
      await server.close();
    }
});

await test("隔离增量更新与基础状态恢复", async () => {
    /** 弹窗隔离只更新变化的区域，保留嵌套焦点和屏幕状态恢复。 */



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
});

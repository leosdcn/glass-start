import assert from 'node:assert/strict';
import { launchSession, waitFor } from './support/helpers.mjs';

const { server, chrome, send, evalJS } = await launchSession();
try {
  await send('Emulation.setEmulatedMedia', { features: [{ name:'prefers-reduced-motion', value:'reduce' }] });
  for (const failure of ['BOOKMARK_KEYS', 'CUSTOM_META']) {
    const result = await evalJS(`(() => {
      resetUserBookmarks();
      const legacy = [{name:'唯一备份',url:'https://legacy.example.test/',icon:'./icons/bing.com.png',desc:'原简介'}];
      storageSet(CONFIG.KEYS.LEGACY_BOOKMARKS, legacy);
      const native = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key,value) {
        if(key===CONFIG.KEYS.${failure}) throw Error('quota');
        return native.call(this,key,value);
      };
      try {
        loadBookmarks();
        return { retained:!!storageGet(CONFIG.KEYS.LEGACY_BOOKMARKS), data:pageData.bookmarks[0] };
      } finally { Storage.prototype.setItem = native; }
    })()`);
    assert.equal(result.retained, true);
    assert.deepEqual(result.data, {name:'唯一备份',url:'https://legacy.example.test/',icon:'./icons/bing.com.png',desc:'原简介'});
    assert.equal(await evalJS(`(() => {loadBookmarks();return !storageGet(CONFIG.KEYS.LEGACY_BOOKMARKS)&&pageData.bookmarks[0].name==='唯一备份'})()`), true);
  }
  console.log('✅ GS-10 两个迁移写入故障均保留旧数据，全字段恢复并支持重试');

  await evalJS('resetUserBookmarks(); openEditModal()');
  for (const selector of ['.edit-name', '.edit-url']) {
    assert.equal(await evalJS(`(() => {
      const input = dom.editList.querySelector('${selector}');input.focus();
      window.dispatchEvent(new Event('blur'));handleAppWakeUp();
      return document.activeElement===input;
    })()`), true);
  }
  await evalJS('cancelEditModal()');
  for (const target of ['nav', 'start']) {
    assert.equal(await evalJS(`(() => {
      reconcileScreenState('${target === 'nav' ? 'start' : 'nav'}',true);
      const native=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){if(this===sessionStorage)throw Error('blocked');return native.call(this,key,value)};
      try {${target === 'nav' ? 'switchToNav' : 'switchToStart'}();handleAppWakeUp();return state.currentSection;}
      finally{Storage.prototype.setItem=native}
    })()`), target);
  }
  console.log('✅ GS-01/02 编辑焦点保留，会话写入失败时双向唤醒保持内存屏幕');

  const imports = await evalJS(`(async()=>{
    await openEditModal();
    const Native=window.FileReader, readers=[];
    window.FileReader=class{constructor(){readers.push(this)}readAsText(){}};
    const release=(index,name)=>readers[index].onload({target:{result:JSON.stringify([{name,url:'https://import.example.test/'}])}});
    try{
      importBookmarksJSON({});cancelEditModal();await openEditModal();
      const before=JSON.stringify(modalState.draftBookmarks);
      release(0,'过期');
      const noPrompt=OverlayStack.top()?.id==='editModal';
      importBookmarksJSON({});importBookmarksJSON({});release(1,'旧文件');
      const latestOnly=OverlayStack.top()?.id==='editModal';
      release(2,'新文件');dom.confirmOkBtn.click();
      return {noPrompt,latestOnly,name:modalState.draftBookmarks[0].name};
    }finally{window.FileReader=Native;cancelEditModal()}
  })()`);
  assert.deepEqual(imports,{noPrompt:true,latestOnly:true,name:'新文件'});
  console.log('✅ GS-11 关闭重开、连续导入的过期读取不会弹确认或覆盖新草稿');

  await evalJS(`(async()=>{
    storageSet(CONFIG.KEYS.MASK_OPACITY,20);await openEditModal();previewDraftMaskOpacity(45);
    window.__nativeSet=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key===CONFIG.KEYS.MASK_OPACITY)throw Error('quota');return __nativeSet.call(this,key,value)};
    await saveEditModal();
  })()`);
  assert.equal(await evalJS(`state.editOpen && modalState.draftMaskOpacity===45 && /背景暗度未能保存/.test(dom.confirmMsg.textContent)`),true);
  await evalJS('Storage.prototype.setItem=__nativeSet;dom.confirmOkBtn.click();saveEditModal()');
  await waitFor(evalJS,'!state.editOpen');
  assert.equal(await evalJS('storageGet(CONFIG.KEYS.MASK_OPACITY)'),45);
  console.log('✅ GS-12 暗度保存失败保留草稿和窗口，恢复后重试成功');

  await evalJS(`(async()=>{
    await openEditModal();window.__nativeRemove=Storage.prototype.removeItem;
    Storage.prototype.removeItem=function(key){if([CONFIG.KEYS.BOOKMARK_KEYS,CONFIG.KEYS.CUSTOM_META,CONFIG.KEYS.MASK_OPACITY].includes(key))throw Error('denied');return __nativeRemove.call(this,key)};
    resetBookmarks();dom.confirmOkBtn.click();
  })()`);
  await waitFor(evalJS,`OverlayStack.top()?.id==='confirmModal' && /部分设置未能清除/.test(dom.confirmMsg.textContent)`);
  assert.equal(await evalJS('state.editOpen && modalState.draftMaskOpacity===45 && dom.maskOpacityInput.value==="45"'),true);
  await evalJS(`Storage.prototype.removeItem=__nativeRemove;dom.confirmOkBtn.click();setTransitionMode('classic');resetBookmarks();dom.confirmOkBtn.click()`);
  await waitFor(evalJS,'!state.editOpen');
  assert.equal(await evalJS(`getTransitionMode()==='sheet' && document.documentElement.dataset.transitionMode==='sheet' && !localStorage.getItem(CONFIG.KEYS.TRANSITION_MODE) && document.querySelector('.settings-transition-btn[data-mode="sheet"]').getAttribute('aria-pressed')==='true'`),true);
  console.log('✅ GS-13/15 部分重置失败有反馈并同步暗度，重试恢复默认切屏偏好');

  await evalJS(`(async()=>{await openEditModal();await previewDraftWallpaper(backgrounds[1])})()`);
  const beforePreset=await evalJS('getWallpaperSelectionDB().then(JSON.stringify)');
  await send('Network.enable');
  await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  assert.equal(await evalJS('previewDraftWallpaper(backgrounds[7])'),false);
  assert.equal(await evalJS('getWallpaperSelectionDB().then(JSON.stringify)'),beforePreset);
  await evalJS('dom.confirmOkBtn.click()');
  assert.equal(await evalJS('previewDraftWallpaper(backgrounds[1])'),true);
  await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  assert.equal(await evalJS('previewDraftWallpaper(backgrounds[7])'),true);
  await evalJS('cancelEditModal()');
  console.log('✅ GS-09 未缓存预设离线选择失败保留旧记录，已准备预设可离线选择，联网后重试成功');

  const upload=await evalJS(`(async()=>{
    await openEditModal();await previewDraftWallpaper(backgrounds[1]);
    const before=JSON.stringify(await getWallpaperSelectionDB());
    uploadWallpaper(new File(['broken-image'],'broken.png',{type:'image/png'}));
    await flushWallpaperSelection();
    return {failed:modalState.wallpaperSaveFailed,same:before===JSON.stringify(await getWallpaperSelectionDB())};
  })()`);
  assert.deepEqual(upload,{failed:true,same:true});
  await evalJS('dom.confirmOkBtn.click();cancelEditModal()');
  console.log('✅ GS-08 损坏上传解码失败，IDB 保留之前的有效壁纸');

  // 多指顺序变化与生命周期取消；实际目标由浏览器布局提供。
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evalJS(`(async()=>{
    await openEditModal();
    replaceBookmarkDraft(Array.from({length:16},(_,i)=>({id:'touch_'+i,name:'书签'+i,url:'https://touch'+i+'.example.test/'})));
    renderEditList();
    window.__touch=(id,x,y)=>new Touch({identifier:id,target:dom.editList,clientX:x,clientY:y});
    window.__dispatch=(type,touches,changed)=>dom.editList.querySelector('.drag-handle').dispatchEvent(new TouchEvent(type,{bubbles:true,touches,changedTouches:changed}));
    const a=dom.editList.querySelectorAll('.edit-row-card')[0].getBoundingClientRect();
    const b=dom.editList.querySelectorAll('.edit-row-card')[1].getBoundingClientRect();
    window.__first=__touch(7,a.x+15,a.y+20);window.__moved=__touch(7,b.x+15,b.bottom-2);window.__other=__touch(8,a.x+30,a.y+20);
    __dispatch('touchstart',[__first],[__first]);__dispatch('touchmove',[__other,__moved],[__moved]);
  })()`);
  await evalJS('new Promise(requestAnimationFrame)');
  assert.equal(await evalJS(`(()=>{__dispatch('touchend',[__moved],[__other]);return modalState.draftBookmarks[0].id==='touch_0'&&!!dom.editList.querySelector('.dragging')})()`),true);
  await evalJS(`__dispatch('touchend',[],[__moved])`);
  assert.equal(await evalJS(`modalState.draftBookmarks[0].id==='touch_1'`),true);
  await evalJS(`__dispatch('touchstart',[__first],[__first]);__dispatch('touchmove',[__moved],[__moved])`);
  await evalJS('new Promise(requestAnimationFrame)');
  assert.equal(await evalJS(`(()=>{const before=JSON.stringify(modalState.draftBookmarks);window.dispatchEvent(new Event('blur'));handleAppWakeUp();__dispatch('touchend',[],[__moved]);return before===JSON.stringify(modalState.draftBookmarks)&&!dom.editList.querySelector('.dragging,.drop-target-above,.drop-target-below')})()`),true);
  await evalJS(`(()=>{dom.editList.scrollTop=0;const rect=dom.editList.getBoundingClientRect();const edge=__touch(7,rect.x+20,rect.bottom-2);__dispatch('touchstart',[__first],[__first]);__dispatch('touchmove',[edge],[edge])})()`);
  await waitFor(evalJS,'dom.editList.scrollTop>30');
  await evalJS("__dispatch('touchcancel',[],[__first]);window.__scrollAfterCancel=dom.editList.scrollTop");
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(await evalJS('dom.editList.scrollTop===__scrollAfterCancel'),true);
  console.log('✅ GS-03/04/05 只由主触点提交，中断后迟到结束无效，边缘持续滚动且取消即停');
} finally {
  await chrome.close();
  await server.close();
}

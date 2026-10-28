/** 重复打开目录复用节点，草稿成员变化只更新可用性，目录内容变化可靠失效。 */
import assert from 'node:assert/strict';
import { launchSession, waitFor } from './support/helpers.mjs';

const {server,chrome,send,evalJS} = await launchSession();
try {
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await evalJS('openEditModal()');
    await waitFor(evalJS,'dom.editModal.classList.contains("active")');
    assert.equal(await evalJS(`(async () => {
        openBookmarkPicker();
        window.reuseItems=[...dom.pickerContent.querySelectorAll('.picker-item')];
        let replaced=0;
        const observer=new MutationObserver(records=>{replaced+=records.length;});
        observer.observe(dom.pickerContent,{childList:true,subtree:true});
        dom.donePickerBtn.click();openBookmarkPicker();
        await new Promise(requestAnimationFrame);
        observer.disconnect();
        return reuseItems.length>0 && reuseItems.every(node=>node.isConnected) && replaced===0;
    })()`),true);
    console.log('✅ 相同目录重复打开时全部复用卡片和图片，零内容节点替换');

    assert.equal(await evalJS(`(() => {
        window.reusePick=reuseItems.find(item=>!item.disabled);
        window.reuseImage=reusePick.querySelector('img');
        const before=modalState.draftBookmarks.length;
        reusePick.click();
        const added=reusePick.disabled && modalState.draftBookmarks.length===before+1;
        dom.donePickerBtn.click();openBookmarkPicker();
        return added && reusePick.isConnected && reusePick.querySelector('img')===reuseImage && reusePick.disabled;
    })()`),true);
    assert.equal(await evalJS(`(() => {
        dom.donePickerBtn.click();
        dom.editList.querySelector('.edit-row-card:last-child .del-btn').click();
        openBookmarkPicker();
        return !reusePick.disabled && reusePick.isConnected && reusePick.querySelector('img')===reuseImage &&
            reusePick.getAttribute('aria-label').startsWith('添加快捷书签：');
    })()`),true);
    assert.equal(await evalJS(`(async () => {
        reusePick.click();dom.donePickerBtn.click();cancelEditModal();
        await openEditModal();openBookmarkPicker();
        return reusePick.isConnected && !reusePick.disabled && reusePick.querySelector('img')===reuseImage;
    })()`),true);
    console.log('✅ 添加、删除和取消草稿后同步禁用状态，保留现有图标节点');

    assert.equal(await evalJS(`(() => {
        dom.donePickerBtn.click();
        const bookmark=pageData.categories[0].bookmarks[0];
        bookmark.icon=bookmark.icon==='./icons/github.com.png'?'./icons/bilibili.com.png':'./icons/github.com.png';
        openBookmarkPicker();
        const updated=[...dom.pickerContent.querySelectorAll('.picker-item')].find(item=>item.dataset.url===bookmark.url);
        return reuseItems.every(node=>!node.isConnected) && updated.querySelector('img').getAttribute('src')===bookmark.icon;
    })()`),true);
    assert.equal(await evalJS(`(() => {
        dom.donePickerBtn.click();
        const before=dom.pickerContent.firstElementChild;
        pageData.categories[0].icon='./icons/dev.svg';
        openBookmarkPicker();
        return dom.pickerContent.firstElementChild!==before &&
            dom.pickerContent.firstElementChild.querySelector('img').getAttribute('src')==='./icons/dev.svg';
    })()`),true);
    console.log('✅ 书签或分类图标单独变化时重建目录，缓存不会遮蔽新内容');
} finally {
    await chrome.close();
    await server.close();
}

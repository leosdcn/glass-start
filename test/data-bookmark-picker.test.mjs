import assert from 'node:assert/strict';
import { launchSession, waitFor } from './support/helpers.mjs';
import { test } from 'node:test';

await test("目录图标复用与过期预览请求", async () => {
    /** 目录添加保留本地图标，失败徽标改名和关闭后的防抖不发起新请求。 */



    const {server,chrome,send,evalJS} = await launchSession();
    try {
        const external = [];
        await send('Fetch.enable', {patterns:[{urlPattern:'https://a.favicon.im/*'}, {urlPattern:'https://www.google.com/s2/favicons*'}]});
        send('Fetch.requestPaused', event => {
            external.push(event.request.url);
            send('Fetch.failRequest', {requestId:event.requestId,errorReason:'Failed'}).catch(()=>{});
        });
        const selected = await evalJS(`(async () => {
        await openEditModal();
        openBookmarkPicker();
        const item = dom.pickerContent.querySelector('.picker-item:not(:disabled)');
        const expected = pageData.categories.flatMap(cat=>cat.bookmarks).find(bm=>bm.url===item.dataset.url);
        item.dataset.name = 'DOM 中的伪造名称';
        item.click();
        const draft = modalState.draftBookmarks.at(-1);
        const image = dom.editList.lastElementChild.querySelector('img');
        const collected = collectEditData();
        saveUserBookmarks(collected);
        cancelEditModal();
        loadBookmarks();
        return {expected:{name:expected.name,icon:expected.icon,desc:expected.desc},
            draft:{name:draft.name,icon:draft.icon,desc:draft.desc},
            renderedIcon:image.getAttribute('src'), savedIcon:pageData.bookmarks.at(-1).icon};
    })()`);
        assert.deepEqual(selected.draft,selected.expected);
        assert.equal(selected.renderedIcon,selected.expected.icon);
        assert.equal(selected.savedIcon,selected.expected.icon);
        assert.equal(external.length,0);
        console.log('✅ 从目录添加、草稿预览与保存均使用原始本地图标和元数据，无外部图标请求');

        await evalJS(`(async () => {
        await openEditModal();
        renderEditList([{name:'旧名称',url:'https://performance-icon.invalid/',icon:'data:image/png;base64,broken'}]);
    })()`);
        await waitFor(evalJS, '!!dom.editList.querySelector(".edit-favicon-initial")');
        const before = external.length;
        assert.equal(await evalJS(`(() => {
        const row=dom.editList.querySelector('.edit-row-card');
        const badge=row.querySelector('.edit-favicon-initial');
        const input=row.querySelector('.edit-name');
        for (const value of ['新名称','最新名称']) {
            input.value=value; input.dispatchEvent(new Event('input',{bubbles:true}));
        }
        return badge===row.querySelector('.edit-favicon-initial') && badge.textContent==='最' &&
            !row.querySelector('img') && modalState.draftBookmarks[0].name==='最新名称';
    })()`),true);
        assert.equal(external.length,before);
        console.log('✅ 图标失败后的改名只更新现有首字徽标，不重建图片或重试外部请求');

        assert.equal(await evalJS(`(async () => {
        const row=dom.editList.querySelector('.edit-row-card');
        const box=row.querySelector('.edit-favicon-box');
        const badge=box.firstElementChild;
        const url=row.querySelector('.edit-url');
        url.value='https://cancelled-icon.invalid/';
        url.dispatchEvent(new Event('input',{bubbles:true}));
        cancelEditModal();
        await new Promise(resolve=>setTimeout(resolve,CONFIG.SUGGEST.DEBOUNCE_MS+30));
        return box.firstElementChild===badge && !box.querySelector('img');
    })()`),true);
        assert.equal(external.length,before);
        console.log('✅ 关闭设置后未执行的图标预览不会继续创建图片和联网请求');

        await evalJS(`(async () => {
        await openEditModal();
        renderEditList(pageData.bookmarks.slice(0,2));
        const rows = [...dom.editList.querySelectorAll('.edit-row-card')];
        rows.forEach((row,i) => {
            const input = row.querySelector('.edit-url');
            input.value = 'https://row-' + i + '.example/';
            input.dispatchEvent(new Event('input',{bubbles:true}));
        });
    })()`);
        await waitFor(async () => external.some(url=>url.includes('row-0.example')) && external.some(url=>url.includes('row-1.example')), 'true');
        assert.deepEqual(await evalJS('modalState.draftBookmarks.map(bm=>bm.url)'), ['https://row-0.example/','https://row-1.example/']);
        await evalJS('cancelEditModal()');
        console.log('✅ 两行快速修改 URL 均独立更新图标预览，草稿地址正确');
    } finally {
        await chrome.close();
        await server.close();
    }
});

await test("挑选器节点复用与目录失效", async () => {
    /** 重复打开目录复用节点，草稿成员变化只更新可用性，目录内容变化可靠失效。 */



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
});

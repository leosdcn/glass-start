/** 目录添加保留本地图标，失败徽标改名和关闭后的防抖不发起新请求。 */
import assert from 'node:assert/strict';
import { launchSession, waitFor } from './helpers.mjs';

const {server,chrome,send,evalJS} = await launchSession();
try {
    const external = [];
    await send('Fetch.enable', {patterns:[{urlPattern:'https://a.favicon.im/*'}, {urlPattern:'https://www.google.com/s2/favicons*'}, {urlPattern:'https://*.invalid/favicon.ico'}]});
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
} finally {
    await chrome.close();
    await server.close();
}

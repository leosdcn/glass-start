import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { launchSession, waitFor } from './helpers.mjs';

const require = createRequire(import.meta.url);
const code = require('esbuild').buildSync({ entryPoints:['src/js/utils/category-catalog.js'], bundle:true,
  write:false, format:'cjs', target:'es2022' }).outputFiles[0].text;
const module = {exports:{}};
new Function('module', 'exports', code)(module, module.exports);
const {getCategoryCatalog, searchUrlKey} = module.exports;
const a = {name:'Zulu', url:'https://www.example.com/', icon:'./icons/github.com.png', desc:'目录简介'};
const b = {name:'Alpha', url:'https://example.com/', icon:'./icons/github.com.png'};
const categories = [{name:'第一分类', bookmarks:[a]}, {name:'第二分类', bookmarks:[{...a,name:'重复'}, b]}];
const first = getCategoryCatalog(categories);
assert.equal(first.byUrl.size, 2);
assert.equal(first.byUrl.get(a.url).name, 'Zulu');
assert.equal(first.searchCategories.size, 1);
assert.equal(first.searchCategories.get(searchUrlKey(b.url)), '第一分类');
assert.equal(getCategoryCatalog(categories), first);
categories[0].bookmarks.push({...b, name:'Beta'});
const changed = getCategoryCatalog(categories);
assert.notEqual(changed, first);
assert.deepEqual(changed.sorted[0].sortedBookmarks.map(bm=>bm.name), ['Beta','Zulu']);
console.log('✅ 目录保留完整 URL 键、第一分类归属，内容原地变化使索引和排序一起失效');

const {server,chrome,evalJS} = await launchSession();
try {
  await evalJS(`pageData.categories=[{name:'测试', bookmarks:[${JSON.stringify(a)}]}]`);
  for (const desc of [undefined, '']) {
    const item = {...a};
    if (desc === undefined) delete item.desc; else item.desc = desc;
    const direct = await evalJS(`(async () => {
      storageRemove(CONFIG.KEYS.CUSTOM_META);
      saveUserBookmarks([${JSON.stringify(item)}]);
      loadBookmarks();
      return pageData.bookmarks[0].desc;
    })()`);
    assert.equal(direct, desc === undefined ? '目录简介' : '');
    await evalJS(`(async () => {
      await openEditModal();
      const transfer=new DataTransfer();
      transfer.items.add(new File([${JSON.stringify(JSON.stringify([item]))}], 'bookmarks.json', {type:'application/json'}));
      dom.importJsonInput.files=transfer.files;
      dom.importJsonInput.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
    await waitFor(evalJS, 'OverlayStack.top()?.id === "confirmModal"');
    const imported = await evalJS(`(async () => {
      dom.confirmOkBtn.click();
      const collected=collectEditData();
      const create=URL.createObjectURL, click=HTMLAnchorElement.prototype.click; let blob;
      URL.createObjectURL=value=>{blob=value;return create(value)};
      HTMLAnchorElement.prototype.click=function(){};
      let exported;
      try {exportBookmarksJSON();exported=JSON.parse(await blob.text()).bookmarks[0]}
      finally {URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click}
      saveUserBookmarks(collected); cancelEditModal(); loadBookmarks();
      return {hasDesc:Object.hasOwn(exported,'desc'),desc:pageData.bookmarks[0].desc};
    })()`);
    assert.deepEqual(imported, {hasDesc:desc !== undefined, desc:desc === undefined ? '目录简介' : ''});
  }
  console.log('✅ 简介缺省继承、显式空串清空，导入、草稿、导出及重载保持同一语义');
} finally {await chrome.close();await server.close()}

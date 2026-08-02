import { launchSession, sleep, makeTester } from './helpers.mjs';

const { pass, finish } = makeTester();
const { server, chrome, evalJS } = await launchSession(9333);

await sleep(1800);

// 1. 全新启动: 无用户数据时渲染默认书签
const init = await evalJS(`(() => {
  const keys = localStorage.getItem('userBookmarkKeys');
  const meta = localStorage.getItem('userCustomMeta');
  return {
    count: document.querySelectorAll('#bookmarks .bookmark-item, #bookmarks a[href]').length,
    keys,
    meta
  };
})()`);
pass('全新启动默认书签渲染且无派生存储', init.count === 8 && init.keys === null && init.meta === null, JSON.stringify(init));

// 2. 旧版 userBookmarks 静态快照 → 自动迁移为 userBookmarkKeys + userCustomMeta
await evalJS(`localStorage.setItem('userBookmarks', JSON.stringify([
  { name: 'Gitee', url: 'https://gitee.com', icon: '' },
  { name: '自建站', url: 'https://custom.example.dev', icon: 'https://custom.example.dev/icon.png', desc: '个人站点' }
]))`);
await evalJS('location.reload()');
await sleep(2200);
const migrated = await evalJS(`(() => ({
  keys: JSON.parse(localStorage.getItem('userBookmarkKeys') || 'null'),
  meta: JSON.parse(localStorage.getItem('userCustomMeta') || '{}'),
  legacyGone: localStorage.getItem('userBookmarks') === null
}))()`);
const giteeIsCat = await evalJS(`!!localStorage.getItem('userBookmarkKeys') && JSON.parse(localStorage.getItem('userBookmarkKeys')).includes('https://gitee.com')`);
const customInMeta = await evalJS(`(JSON.parse(localStorage.getItem('userCustomMeta') || '{}')['https://custom.example.dev'] || {}).name === '自建站'`);
pass('旧版快照迁移为 keys + customMeta, 删除旧键',
  migrated.legacyGone && migrated.keys.length === 2 && giteeIsCat && customInMeta,
  JSON.stringify(migrated));

// 3. 迁移后首屏正确渲染: 默认网址用分类元数据, 自定义网址保留图标元数据
const render3 = await evalJS(`(() => {
  const titles = [...document.querySelectorAll('#bookmarks .bookmark-title')].map(e => e.textContent.trim());
  const customBm = pageData.bookmarks.find(b => normalizeUrl(b.url) === 'https://custom.example.dev');
  return { titles, customIcon: customBm ? customBm.icon : '' };
})()`);
pass('迁移后首屏渲染且自定义图标元数据保留',
  render3.titles.includes('Gitee') && render3.titles.includes('自建站') && render3.customIcon.includes('custom.example.dev/icon.png'),
  JSON.stringify(render3));

// 4. 派生动态同步: 修改分类数据库元数据后重新派生, 名称即时更新
await evalJS(`localStorage.setItem('userBookmarkKeys', JSON.stringify(['https://github.com']))`);
await evalJS(`(function(){
  let gh = null;
  for (const c of pageData.categories) {
    const b = (c.bookmarks || []).find(x => normalizeUrl(x.url) === 'https://github.com');
    if (b) { gh = b; break; }
  }
  if (gh) gh.name = 'GitHub-Derived';
  const keys = JSON.parse(localStorage.getItem('userBookmarkKeys'));
  const meta = JSON.parse(localStorage.getItem('userCustomMeta') || '{}');
  pageData.bookmarks = getDerivedBookmarks(keys, pageData.categories, meta);
  renderBookmarks();
})()`);
await sleep(300);
const derivedName = await evalJS(`([...document.querySelectorAll('#bookmarks .bookmark-title')].map(e => e.textContent.trim()))[0]`);
pass('分类元数据更新后派生名称即时同步', derivedName === 'GitHub-Derived', `name=${derivedName}`);

// 5. saveUserBookmarks 只存 keys + customMeta, 不存全量快照
await evalJS(`(function(){
  pageData.categories = [];
  saveUserBookmarks([{ name: '自定义A', url: 'https://aaa.example.com', icon: 'https://aaa.example.com/a.png' }]);
})()`);
const saveModel = await evalJS(`(() => ({
  keys: JSON.parse(localStorage.getItem('userBookmarkKeys') || 'null'),
  meta: JSON.parse(localStorage.getItem('userCustomMeta') || '{}'),
  snapshot: localStorage.getItem('userBookmarks')
}))()`);
pass('保存只存 keys+customMeta, 无全量快照',
  saveModel.keys && saveModel.keys.length === 1 && saveModel.keys[0] === 'https://aaa.example.com'
  && saveModel.meta['https://aaa.example.com'] && saveModel.meta['https://aaa.example.com'].icon.includes('aaa.example.com/a.png')
  && saveModel.snapshot === null,
  JSON.stringify(saveModel));

// 6. bug E 回归: 自定义图标保存后刷新不丢失(派生数据源 icon 保留)
await evalJS('location.reload()');
await sleep(2200);
const keepIcon = await evalJS(`(() => {
  const bm = pageData.bookmarks.find(b => normalizeUrl(b.url) === 'https://aaa.example.com');
  return bm ? bm.icon : '';
})()`);
pass('自定义图标刷新后保留(非被 faviconFromUrl 覆盖)', keepIcon.includes('aaa.example.com/a.png'), `icon=${keepIcon}`);

const code = finish();
await chrome.close();
await server.close();
process.exit(code);

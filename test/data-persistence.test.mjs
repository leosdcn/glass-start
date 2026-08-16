/**
 * 书签数据模型持久化、派生与自动迁移测试 (data-persistence.test.mjs)
 *
 * 精简版：6 个核心精准断言
 */
import { launchSession, sleep, makeTester } from './helpers.mjs';

const { pass, finish } = makeTester();
const { server, chrome, evalJS } = await launchSession();

await sleep(300);

// 1. 首屏书签 JS 动态渲染正常且全新启动无派生垃圾
const bm = await evalJS(`(() => {
  const imgs = [...document.querySelectorAll('#bookmarks img')];
  const keys = localStorage.getItem('userBookmarkKeys');
  const meta = localStorage.getItem('userCustomMeta');
  return { count: imgs.length, hasJS: imgs.every(i => i.classList.contains('lazy-icon') || i.hasAttribute('data-md')), keys, meta };
})()`);
pass('首屏书签 JS 动态渲染正常且全新启动无派生垃圾', bm.count === 8 && bm.hasJS && bm.keys === null && bm.meta === null);

// 2. 旧版 userBookmarks 自动迁移为 keys + customMeta
await evalJS(`localStorage.setItem('userBookmarks', JSON.stringify([
  { name: 'Gitee', url: 'https://gitee.com', icon: '' },
  { name: '自建站', url: 'https://custom.example.dev', icon: 'https://custom.example.dev/icon.png', desc: '个人站点' }
]))`);
await evalJS('location.reload()'); await sleep(2200);

const migrated = await evalJS(`(() => ({
  keys: JSON.parse(localStorage.getItem('userBookmarkKeys') || 'null'),
  meta: JSON.parse(localStorage.getItem('userCustomMeta') || '{}'),
  legacyGone: localStorage.getItem('userBookmarks') === null
}))()`);
const giteeIsCat = await evalJS(`!!localStorage.getItem('userBookmarkKeys') && JSON.parse(localStorage.getItem('userBookmarkKeys')).includes('https://gitee.com')`);
const customInMeta = await evalJS(`(JSON.parse(localStorage.getItem('userCustomMeta') || '{}')['https://custom.example.dev'] || {}).name === '自建站'`);

pass('旧版 userBookmarks 自动迁移为 keys + customMeta',
  migrated.legacyGone && migrated.keys.length === 2 && giteeIsCat && customInMeta,
  JSON.stringify(migrated));

// 3. 迁移后首屏渲染正常且自定义图标元数据保留
const render3 = await evalJS(`(() => {
  const titles = [...document.querySelectorAll('#bookmarks .bookmark-title')].map(e => e.textContent.trim());
  const customBm = pageData.bookmarks.find(b => normalizeUrl(b.url) === 'https://custom.example.dev');
  return { titles, customIcon: customBm ? customBm.icon : '' };
})()`);
pass('迁移后首屏渲染正常且自定义图标元数据保留',
  render3.titles.includes('Gitee') && render3.titles.includes('自建站') && render3.customIcon.includes('custom.example.dev/icon.png'),
  JSON.stringify(render3));

// 4. 分类元数据更新后派生名称即时同步
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
})()`); await sleep(300);
const derivedName = await evalJS(`([...document.querySelectorAll('#bookmarks .bookmark-title')].map(e => e.textContent.trim()))[0]`);
pass('分类元数据更新后派生名称即时同步', derivedName === 'GitHub-Derived');

// 5. saveUserBookmarks 遵循轻量模型 (只存 keys+customMeta)
await evalJS(`(function(){
  pageData.categories = [];
  saveUserBookmarks([{ name: '自定义A', url: 'https://aaa.example.com', icon: 'https://aaa.example.com/a.png' }]);
})()`);
const saveModel = await evalJS(`(() => ({
  keys: JSON.parse(localStorage.getItem('userBookmarkKeys') || 'null'),
  meta: JSON.parse(localStorage.getItem('userCustomMeta') || '{}'),
  snapshot: localStorage.getItem('userBookmarks')
}))()`);
pass('saveUserBookmarks 遵循轻量模型 (只存 keys+customMeta)',
  saveModel.keys && saveModel.keys.length === 1 && saveModel.keys[0] === 'https://aaa.example.com'
  && saveModel.meta['https://aaa.example.com'] && saveModel.meta['https://aaa.example.com'].icon.includes('aaa.example.com/a.png')
  && saveModel.snapshot === null);

// 6. 自定义图标刷新后持久化正常
await evalJS('location.reload()'); await sleep(2200);
const keepIcon = await evalJS(`(() => {
  const bm = pageData.bookmarks.find(b => normalizeUrl(b.url) === 'https://aaa.example.com');
  return bm ? bm.icon : '';
})()`);
pass('自定义图标刷新后持久化正常', keepIcon.includes('aaa.example.com/a.png'), `icon=${keepIcon}`);

// 7. 首屏快捷书签在全新加载与刷新后 100% 渲染且无空白丢失
await evalJS('localStorage.clear(); location.reload()'); await sleep(2200);
const refreshCheck = await evalJS(`(() => {
  const items = [...document.querySelectorAll('#bookmarks .bookmark-item')];
  const titles = items.map(i => (i.querySelector('.bookmark-title') || {}).textContent || '').filter(Boolean);
  const imgs = items.map(i => i.querySelector('img')).filter(Boolean);
  const allLoadedOrHaveSrc = imgs.length === 8 && imgs.every(img => img.src && !img.src.startsWith('data:image/svg'));
  return {
    itemCount: items.length,
    titleCount: titles.length,
    imgCount: imgs.length,
    allLoadedOrHaveSrc
  };
})()`);
pass('首屏快捷书签在全新加载与刷新后 100% 渲染且无空白丢失',
  refreshCheck.itemCount === 8 && refreshCheck.titleCount === 8 && refreshCheck.imgCount === 8 && refreshCheck.allLoadedOrHaveSrc,
  JSON.stringify(refreshCheck));

await evalJS(`localStorage.clear()`);

const code = finish();
await chrome.close();
await server.close();
process.exit(code);

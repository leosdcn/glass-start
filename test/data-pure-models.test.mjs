import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

// 与浏览器使用同一配置；此入口无需启动 HTTP 服务或 Chrome。
const { outputFiles } = buildSync({
  stdin: { contents: `export * from './src/js/utils/bookmark-search.js'; export * from './src/js/utils/weather-model.js'; export { CONFIG } from './src/js/config/constants.js'; export * from './src/js/state/bookmark-draft.js'; export {modalState} from './src/js/state/store.js';`, resolveDir:process.cwd() },
  bundle:true, write:false, format:'esm', platform:'node'
});
const model = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));
const { CONFIG, rankBookmarkSuggestions, normalizeWeatherForecast, damerauLevenshteinDistance } = model;
assert.equal(damerauLevenshteinDistance('githbu', 'github'), 1);
const candidates = [
  {bm:{name:'Tools', url:'https://tools.example', icon:'', desc:'GitHub'}, normUrl:'tools.example', defaultCat:'工具'},
  {bm:{name:'GitHub', url:'https://github.com', icon:''}, normUrl:'github.com', defaultCat:'开发'}
];
const input = {candidates, urlToCategoryMap:new Map()};
assert.deepEqual(rankBookmarkSuggestions('github', input, CONFIG.SUGGEST).map(item=>item.name), ['GitHub', 'Tools']);
assert.deepEqual(rankBookmarkSuggestions('/', input, CONFIG.SUGGEST), []);
assert.equal(rankBookmarkSuggestions('githbu', input, CONFIG.SUGGEST)[0].name, 'GitHub');
assert.equal(candidates[0].bm.name, 'Tools');
const forecast = normalizeWeatherForecast({current:{temperature_2m:21.6, is_day:0}, daily:{}}, {lat:1, lon:2}, CONFIG.WEATHER, 123);
assert.equal(forecast.timestamp, 123);
assert.equal(forecast.current.temp, 22);
assert.equal(forecast.current.isDay, false);
assert.deepEqual(forecast.daily, []);
assert.equal(forecast.current.sunrise, '--:--');
model.replaceBookmarkDraft([{id:'a',name:'A',url:'https://a.test',icon:''}, {id:'b',name:'B',url:'https://b.test',icon:''}]);
assert.equal(model.modalState.bookmarksChanged, false);
model.updateBookmarkDraft('a', {name:'Changed'});
assert.equal(model.modalState.draftBookmarks[0].name, 'Changed');
assert.equal(model.reorderBookmarkDraft('a', 'missing', true), false);
assert.equal(model.reorderBookmarkDraft('a', 'b', false), true);
assert.deepEqual(model.modalState.draftBookmarks.map(item=>item.id), ['b','a']);
assert.equal(model.removeBookmarkDraft('a'), true);
assert.equal(model.removeBookmarkDraft('a'), false);
assert.equal(model.modalState.bookmarksChanged, true);
console.log('✅ 独立验证搜索排序、拼写容错、天气转换与草稿修改，无浏览器依赖');

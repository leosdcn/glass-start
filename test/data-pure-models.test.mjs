import assert from 'node:assert/strict';
import { test } from 'node:test';
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

test('低降水概率且当前无雨时平滑预报，高降水概率保留雨天预报', () => {
  const location = {lat:31.230, lon:121.473, name:'上海'};
  for (const [code, pop, expected] of [
    [51, 16, {text:'晴间多云', icon:'🌤️'}],
    [63, 80, {text:'中雨', icon:'🌧️'}]
  ]) {
    const result = normalizeWeatherForecast({
      current:{temperature_2m:31, is_day:1, precipitation:0, weather_code:1},
      daily:{time:['2026-08-18', '2026-08-19'], weather_code:[code, 80],
        temperature_2m_max:[32, 29], temperature_2m_min:[24, 25],
        precipitation_probability_max:[pop, 45]}
    }, location, CONFIG.WEATHER, 123);
    assert.deepEqual({text:result.daily[0].text, icon:result.daily[0].icon}, expected,
      `天气代码 ${code}、降水概率 ${pop}%`);
  }
});

test('地名合并重复行政区，保留同名省市并消除前缀重复', () => {
  for (const [parts, expected] of [
    [['中国', '上海市', '上海市', '普陀'], '中国 · 上海市 · 普陀'],
    [['中国', '北京市', '北京市', '朝阳'], '中国 · 北京市 · 朝阳'],
    [['中国', '吉林省', '吉林市', '吉林市'], '中国 · 吉林省 · 吉林市'],
    [['中国', '上海市', '黄浦区', '黄浦'], '中国 · 上海市 · 黄浦区'],
    [['中国', '香港特别行政区', '香港'], '中国 · 香港特别行政区']
  ]) {
    assert.equal(model.formatLocationFullName(parts), expected, parts.join('/'));
  }
});

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

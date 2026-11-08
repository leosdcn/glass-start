import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSync } from 'esbuild';

// 与浏览器使用同一配置；此入口无需启动 HTTP 服务或 Chrome。
const { outputFiles } = buildSync({
  stdin: { contents: `
    export * from './src/js/utils/bookmark-search.js';
    export * from './src/js/utils/category-catalog.js';
    export * from './src/js/utils/weather-model.js';
    export * from './src/js/utils/weather-data.js';
    export { faviconFallbackFromUrl, normalizeUrl } from './src/js/utils/bookmark-model.js';
    export { escapeHtml } from './src/js/utils/helpers.js';
    export { CONFIG } from './src/js/config/constants.js';
    export * from './src/js/state/bookmark-draft.js';
    export { modalState } from './src/js/state/store.js';
  `, resolveDir:process.cwd() },
  bundle:true, write:false, format:'esm', platform:'node'
});
const model = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));
const { CONFIG, rankBookmarkSuggestions, normalizeWeatherForecast, damerauLevenshteinDistance, weatherNum, toDisplayTemp, getCategoryCatalog, searchUrlKey } = model;
const candidates = [
  {bm:{name:'Tools', url:'https://tools.example', icon:'', desc:'GitHub'}, normUrl:'tools.example', defaultCat:'工具'},
  {bm:{name:'GitHub', url:'https://github.com', icon:''}, normUrl:'github.com', defaultCat:'开发'},
  {bm:{name:'Google', url:'https://google.com', icon:''}, normUrl:'google.com', defaultCat:'工具'}
];
const input = {candidates, urlToCategoryMap:new Map()};
test('书签名称、地址与简介的排序优先级和拼写容错', () => {
  const ranked = { ...input, candidates: [
    candidates[0],
    {bm:{name:'Mirror', url:'https://github.example', icon:''}, normUrl:'github.example', defaultCat:'工具'},
    {bm:{name:'使用 GitHub', url:'https://git.example', icon:''}, normUrl:'git.example', defaultCat:'开发'},
    {bm:{name:'GitHub Desktop', url:'https://desktop.example', icon:''}, normUrl:'desktop.example', defaultCat:'开发'},
    candidates[1]
  ] };
  assert.deepEqual(rankBookmarkSuggestions('github', ranked, CONFIG.SUGGEST, 5).map(item => item.name),
    ['GitHub', 'GitHub Desktop', '使用 GitHub', 'Mirror', 'Tools']);
  assert.deepEqual(rankBookmarkSuggestions('/', input, CONFIG.SUGGEST), []);
  assert.equal(damerauLevenshteinDistance('githbu', 'github'), 1);
  assert.equal(rankBookmarkSuggestions('githbu', input, CONFIG.SUGGEST)[0].name, 'GitHub');
  assert.equal(rankBookmarkSuggestions('goolge', input, CONFIG.SUGGEST)[0].name, 'Google');
  assert.equal(candidates[0].bm.name, 'Tools');
});

test('书签文本转义、URL 规范化及图标备用地址', () => {
  const escaped = model.escapeHtml('<img src=x onerror="alert(1)">');
  assert.ok(escaped.includes('&lt;img') && !escaped.includes('<img'));
  assert.ok(model.normalizeUrl('javascript:alert(1)').startsWith('https://'));
  for (const [url, host] of [
    ['https://github.com', 'github.com'],
    ['https://www.google.com', 'google.com'],
    ['https://a.favicon.im/bilibili.com', 'bilibili.com']
  ]) {
    assert.equal(model.faviconFallbackFromUrl(url), 'https://www.google.com/s2/favicons?domain=' + host + '&sz=128');
  }
  assert.equal(model.faviconFallbackFromUrl(''), '');
});

test('多词模糊查询不能跳过不匹配的单字符词', () => {
  for (const query of ['x y', 'x github', 'github x', 'z githbu']) {
    assert.deepEqual(rankBookmarkSuggestions(query, input, CONFIG.SUGGEST), [], query);
  }
  assert.equal(rankBookmarkSuggestions('g githbu', input, CONFIG.SUGGEST)[0].name, 'GitHub');
  assert.equal(rankBookmarkSuggestions('git githbu', input, CONFIG.SUGGEST)[0].name, 'GitHub');
});
const forecast = normalizeWeatherForecast({current:{temperature_2m:21.6, is_day:0}, daily:{}}, {lat:1, lon:2}, CONFIG.WEATHER, 123);
assert.equal(forecast.timestamp, 123);
assert.equal(forecast.current.temp, 22);
assert.deepEqual(forecast.daily, []);
assert.equal(forecast.current.sunriseToday, '--:--');
assert.equal(Object.hasOwn(forecast.current, 'weatherText'), false);
assert.equal(normalizeWeatherForecast({ timezone: 'Europe/London' }, {lat:1, lon:2}, CONFIG.WEATHER, 123).timezone, 'Europe/London');
assert.equal(Object.hasOwn(forecast, 'timezone'), false, '旧响应不伪造天气地点时区');

test('低降水概率且当前无雨时平滑预报，高降水概率保留雨天预报', () => {
  const location = {lat:31.230, lon:121.473, name:'上海'};
  for (const [code, pop, expected] of [
    [51, 16, {weatherCode:1, icon:'🌤️'}],
    [63, 80, {weatherCode:63, icon:'🌧️'}]
  ]) {
    const result = normalizeWeatherForecast({
      current:{temperature_2m:31, is_day:1, precipitation:0, weather_code:1},
      daily:{time:['2026-08-18', '2026-08-19'], weather_code:[code, 80],
        temperature_2m_max:[32, 29], temperature_2m_min:[24, 25],
        precipitation_probability_max:[pop, 45]}
    }, location, CONFIG.WEATHER, 123);
    assert.deepEqual({weatherCode:result.daily[0].weatherCode, icon:result.daily[0].icon}, expected,
      `天气代码 ${code}、降水概率 ${pop}%`);
    assert.equal(Object.hasOwn(result.daily[0], 'text'), false);
    assert.equal(Object.hasOwn(result.daily[0], 'label'), false);
  }
});

test('昼夜及未知天气代码保留原有图标回退', () => {
  for (const [code, isDay, icon] of [[0, 1, '☀️'], [0, 0, '🌙'], [51, 1, '🌧️'], [51, 0, '🌧️'], [80, 1, '🌦️'], [80, 0, '🌧️'], [67, 1, '🌧️'], [82, 0, '🌧️'], [97, 1, '⛈️'], [999, 1, '⛅'], [999, 0, '☁️']]) {
    const result = normalizeWeatherForecast({current:{weather_code:code, is_day:isDay}},
      {lat:1, lon:2}, CONFIG.WEATHER, 123);
    assert.equal(result.current.icon, icon);
    assert.equal(result.current.weatherCode, code);
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

test('气象数值与异常温度文本清洗 (防 XSS 与非预期类型防御)', () => {
  const cases = [
    [23, '23°'], ['23.6', '24°'], [-4.6, '-5°'], [0, '0°'],
    [null, '0°'], [undefined, '0°'], ['', '0°'], ['  ', '0°'],
    [true, '0°'], ['NaN', '0°'], ['Infinity', '0°'],
    ['<img src=x onerror=alert(1)>', '0°'], [[], '0°'], [[25], '0°'], [{}, '0°']
  ];
  for (const [value, expected] of cases) {
    const formatted = Math.round(weatherNum(value, 0)) + '°';
    assert.equal(formatted, expected, `输入值 ${JSON.stringify(value)}`);
  }
});

test('温度单位换算及异常容错', () => {
  assert.equal(toDisplayTemp(0, 'C'), 0);
  assert.equal(toDisplayTemp(0, 'F'), 32);
  assert.equal(toDisplayTemp(24, 'C'), 24);
  assert.equal(toDisplayTemp(24, 'F'), 75);
  assert.equal(toDisplayTemp(100, 'F'), 212);
  assert.equal(toDisplayTemp(-10, 'F'), 14);
  assert.equal(toDisplayTemp('invalid', 'F'), 32);
  assert.equal(toDisplayTemp('25.6', 'C'), 26);
});

test('分类目录索引映射、首分类归属与内容变更失效算法', () => {
  const a = { name: 'Zulu', url: 'https://www.example.com/', icon: './icons/github.com.png', desc: '目录简介' };
  const b = { name: 'Alpha', url: 'https://example.com/', icon: './icons/github.com.png' };
  const categories = [{ name: '第一分类', bookmarks: [a] }, { name: '第二分类', bookmarks: [{ ...a, name: '重复' }, b] }];
  const first = getCategoryCatalog(categories);
  assert.equal(first.byUrl.size, 2);
  assert.equal(first.byUrl.get(a.url).name, 'Zulu');
  assert.equal(first.searchCategories.size, 1);
  assert.equal(first.searchCategories.get(searchUrlKey(b.url)), '第一分类');
  assert.equal(getCategoryCatalog(categories), first);
  categories[0].bookmarks.push({ ...b, name: 'Beta' });
  const changed = getCategoryCatalog(categories);
  assert.notEqual(changed, first);
  assert.deepEqual(changed.sorted[0].sortedBookmarks.map(bm => bm.name), ['Beta', 'Zulu']);
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

test('天气时间拒绝越界值，允许单数字小时', () => {
  for (const [input, expected] of [['0:00','0:00'],['23:59','23:59'],[' 7:05 ','7:05'],
    ['24:00','--:--'],['29:75','--:--'],['12:60','--:--'],['-1:00','--:--'],[null,'--:--']]) {
    assert.equal(model.weatherTime(input), expected);
  }
});

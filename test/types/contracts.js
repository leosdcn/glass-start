/** 仅供 tsc 检查的负向契约，不参与运行时测试或生产构建。 */
import { updateBookmarkDraft, replaceBookmarkDraft } from '../../src/js/state/bookmark-draft.js';
import { damerauLevenshteinDistance, rankBookmarkSuggestions } from '../../src/js/utils/bookmark-search.js';
import { CONFIG } from '../../src/js/config/constants.js';
import { normalizeWeatherForecast } from '../../src/js/utils/weather-model.js';

updateBookmarkDraft('bookmark', { name: '新名称' });
replaceBookmarkDraft([{ name:'示例', url:'https://example.com', icon:'' }]);
damerauLevenshteinDistance('ab', 'ba');
rankBookmarkSuggestions('query', {candidates:[],urlToCategoryMap:new Map()}, CONFIG.SUGGEST);
normalizeWeatherForecast({}, {lat:1, lon:2}, CONFIG.WEATHER, 123);
// @ts-expect-error 草稿 URL 必须为字符串。
updateBookmarkDraft('bookmark', { url: 123 });
// @ts-expect-error 编辑距离不接受数值输入。
damerauLevenshteinDistance(123, 'abc');
// @ts-expect-error 候选模型不可缺失。
rankBookmarkSuggestions('query', {}, {});
// @ts-expect-error 地点必须包含有效字段类型。
normalizeWeatherForecast({}, {lat:'invalid', lon:2}, {}, 123);

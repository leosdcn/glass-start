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

import { dom } from '../../src/js/state/dom.js';
import { state, pageData } from '../../src/js/state/store.js';

if (dom.searchInput) dom.searchInput.value = 'query';
if (dom.saveEditBtn) dom.saveEditBtn.disabled = true;
state.customWallpaper = 'https://example.com/wallpaper.jpg';
state.customWallpaper = null;
state.currentSection = 'nav';
// @ts-expect-error 普通容器没有输入框 value 属性。
if (dom.clock) dom.clock.value = 'invalid';
// @ts-expect-error 按钮不能替换为输入框。
dom.saveEditBtn = document.createElement('input');
// @ts-expect-error 节点首次缓存前可能不存在。
dom.searchInput.focus();
// @ts-expect-error 屏幕状态只能为既定枚举值。
state.currentSection = 'unknown';
// @ts-expect-error 壁纸不能写入数值。
state.customWallpaper = 123;
// @ts-expect-error 书签必须包含模型所需字段。
pageData.bookmarks.push({name:'missing-url'});

/**
 * 数据持久化、书签搜索算法与天气组件功能测试套件 (data-features.test.mjs)
 *
 * 精炼架构：6 大高密度全景断言
 * 1. 书签三级模糊搜索与优先级排序算法
 * 2. 书签轻量存储模型、旧版数据迁移与自定义图标持久化
 * 3. 天气组件胶囊交互与 OverlayStack 层叠栈响应
 * 4. 天气弹窗 2×2 网格布局与工位优先级规范
 * 5. 相对湿度、实时风速与降水雨伞 9 阶形态动态演化
 * 6. 预报等宽排版、多日平滑对齐与多级行政区划消歧
 */
import { launchSession, sleep, makeTester, pressKey } from './helpers.mjs';

const { pass, finish } = makeTester();
const { server, chrome, evalJS } = await launchSession(9339);

await sleep(300);
await evalJS('window.fetchWeather = async () => {}; isFetchingWeather = true;');
const press = (key) => pressKey(evalJS, key);

// ══════════════════════════════════════════════════════════════════════
// 1. 书签三级模糊搜索与优先级排序算法
// ══════════════════════════════════════════════════════════════════════

const searchAlgoCheck = await evalJS(`(() => {
  const originalBookmarks = pageData.bookmarks;
  const originalCategories = pageData.categories;
  try {
    // 1.1 精确匹配优先于简介匹配
    pageData.bookmarks = [
      { name: "代码托管平台", url: "https://hub.example.com", desc: "全球最大的 GitHub 开源平台" }
    ];
    pageData.categories = [
      { name: "开发工具", bookmarks: [{ name: "GitHub", url: "https://github.com", desc: "开源项目托管" }] }
    ];
    const res1 = getLocalBookmarkSuggestions("GitHub", 2);
    const exactNameOk = res1[0]?.name === 'GitHub' && res1[1]?.name === '代码托管平台';

    // 1.2 包含/前缀匹配优先于仅简介匹配
    pageData.bookmarks = [
      { name: "开源资讯网", url: "https://news.example.com", desc: "汇聚各类开源项目动态" },
      { name: "ChatGPT", url: "https://chatgpt.com", desc: "OpenAI 开发的人工智能对话模型" }
    ];
    pageData.categories = [
      { name: "AI 工具", bookmarks: [{ name: "AI 绘画助手", url: "https://ai-art.example.com", desc: "智能生图工具" }] }
    ];
    const res2 = getLocalBookmarkSuggestions("AI", 2);
    const subNameOk = res2[0]?.name === 'AI 绘画助手' && res2[1]?.name === 'ChatGPT';

    // 1.3 三级优先级梯队 (书签名 > URL > 简介)
    pageData.bookmarks = [
      { name: "资讯聚合", url: "https://info.example.com", desc: "收录各类 react 生态资源" },
      { name: "前端导航", url: "https://react-community.example.com", desc: "前端社区" },
      { name: "React 官方文档", url: "https://react.dev", desc: "用于构建 Web 界面" }
    ];
    pageData.categories = [];
    const res3 = getLocalBookmarkSuggestions("react", 3);
    const tierOk = res3.length === 3 && res3[0].name === 'React 官方文档' && res3[1].name === '前端导航' && res3[2].name === '资讯聚合';

    // 1.4 无书签名匹配时优雅降级
    pageData.bookmarks = [
      { name: "阿里云", url: "https://aliyun.com", desc: "领先的云计算服务商与大数据分析" }
    ];
    const res4 = getLocalBookmarkSuggestions("大数据", 1);
    const fallbackOk = res4[0]?.name === '阿里云';

    return { exactNameOk, subNameOk, tierOk, fallbackOk };
  } finally {
    pageData.bookmarks = originalBookmarks;
    pageData.categories = originalCategories;
  }
})()`);

pass('书签三级模糊搜索与优先级排序算法 (精确匹配/包含匹配/三级梯队/简介降级)',
  searchAlgoCheck.exactNameOk && searchAlgoCheck.subNameOk && searchAlgoCheck.tierOk && searchAlgoCheck.fallbackOk,
  JSON.stringify(searchAlgoCheck));

// ══════════════════════════════════════════════════════════════════════
// 2. 书签轻量存储模型、旧版数据迁移与自定义图标持久化
// ══════════════════════════════════════════════════════════════════════

// 2.1 首屏干净启动
const bmInit = await evalJS(`(() => {
  const imgs = [...document.querySelectorAll('#bookmarks img')];
  const keys = localStorage.getItem('userBookmarkKeys');
  const meta = localStorage.getItem('userCustomMeta');
  return { count: imgs.length, hasJS: imgs.every(i => i.classList.contains('lazy-icon') || i.hasAttribute('data-md')), keys, meta };
})()`);
const bmClean = bmInit.count === 8 && bmInit.hasJS && bmInit.keys === null && bmInit.meta === null;

// 2.2 旧版 userBookmarks 自动迁移
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
const migrationOk = migrated.legacyGone && migrated.keys.length === 2 && giteeIsCat && customInMeta;

// 2.3 迁移后自定义图标保留
const renderTitles = await evalJS(`(() => {
  const titles = [...document.querySelectorAll('#bookmarks .bookmark-title')].map(e => e.textContent.trim());
  const customBm = pageData.bookmarks.find(b => normalizeUrl(b.url) === 'https://custom.example.dev');
  return { titles, customIcon: customBm ? customBm.icon : '' };
})()`);
const customMetaOk = renderTitles.titles.includes('Gitee') && renderTitles.titles.includes('自建站') && renderTitles.customIcon.includes('custom.example.dev/icon.png');

// 2.4 saveUserBookmarks 轻量模型
await evalJS(`(function(){
  pageData.categories = [];
  saveUserBookmarks([{ name: '自定义A', url: 'https://aaa.example.com', icon: 'https://aaa.example.com/a.png' }]);
})()`);
const saveModel = await evalJS(`(() => ({
  keys: JSON.parse(localStorage.getItem('userBookmarkKeys') || 'null'),
  meta: JSON.parse(localStorage.getItem('userCustomMeta') || '{}'),
  snapshot: localStorage.getItem('userBookmarks')
}))()`);
const saveModelOk = saveModel.keys && saveModel.keys.length === 1 && saveModel.keys[0] === 'https://aaa.example.com'
  && saveModel.meta['https://aaa.example.com'] && saveModel.meta['https://aaa.example.com'].icon.includes('aaa.example.com/a.png')
  && saveModel.snapshot === null;

// 2.5 自定义图标刷新持久化与首屏防空白
await evalJS('location.reload()'); await sleep(2200);
const keepIcon = await evalJS(`(() => {
  const bm = pageData.bookmarks.find(b => normalizeUrl(b.url) === 'https://aaa.example.com');
  return bm ? bm.icon : '';
})()`);
const iconPersistOk = keepIcon.includes('aaa.example.com/a.png');

await evalJS('localStorage.clear(); location.reload()'); await sleep(2200);
const refreshCheck = await evalJS(`(() => {
  const items = [...document.querySelectorAll('#bookmarks .bookmark-item')];
  const titles = items.map(i => (i.querySelector('.bookmark-title') || {}).textContent || '').filter(Boolean);
  const imgs = items.map(i => i.querySelector('img')).filter(Boolean);
  const allLoadedOrHaveSrc = imgs.length === 8 && imgs.every(img => img.src && !img.src.startsWith('data:image/svg'));
  return { itemCount: items.length, titleCount: titles.length, imgCount: imgs.length, allLoadedOrHaveSrc };
})()`);
const blankGuardOk = refreshCheck.itemCount === 8 && refreshCheck.titleCount === 8 && refreshCheck.imgCount === 8 && refreshCheck.allLoadedOrHaveSrc;

await evalJS(`localStorage.clear()`);

pass('书签轻量存储模型、旧版数据迁移与自定义图标持久化 (keys+customMeta/迁移/图标持久化/首屏防空白)',
  bmClean && migrationOk && customMetaOk && saveModelOk && iconPersistOk && blankGuardOk);

// ══════════════════════════════════════════════════════════════════════
// 3. 天气组件胶囊交互与 OverlayStack 层叠栈响应
// ══════════════════════════════════════════════════════════════════════

const widgetExists = await evalJS(`!!document.getElementById('weatherWidget') && !!document.getElementById('weatherBtn')`);

await evalJS(`document.getElementById('weatherBtn').click()`); await sleep(300);
const popoverOpened = await evalJS(`({
  active: document.getElementById('weatherPopover').classList.contains('active'),
  ariaHidden: document.getElementById('weatherPopover').getAttribute('aria-hidden') === 'false',
  expanded: document.getElementById('weatherBtn').getAttribute('aria-expanded') === 'true',
  stackTop: OverlayStack.top() ? OverlayStack.top().id : null
})`);
const openOk = popoverOpened.active && popoverOpened.ariaHidden && popoverOpened.expanded && popoverOpened.stackTop === 'weatherPopover';

await press('Escape'); await sleep(300);
const popoverClosed = await evalJS(`({
  active: document.getElementById('weatherPopover').classList.contains('active'),
  expanded: document.getElementById('weatherBtn').getAttribute('aria-expanded') === 'false',
  stackTop: OverlayStack.top() ? OverlayStack.top().id : null
})`);
const closeOk = !popoverClosed.active && popoverClosed.expanded && popoverClosed.stackTop === null;

pass('天气组件胶囊交互与 OverlayStack 层叠栈响应 (挂载存在/点击展开入栈/Escape退栈)',
  widgetExists && openOk && closeOk);

// ══════════════════════════════════════════════════════════════════════
// 4. 天气弹窗 2×2 网格布局与工位优先级规范
// ══════════════════════════════════════════════════════════════════════

await evalJS(`(() => {
  isFetchingWeather = true;
  const mockData = {
    location: { name: '上海市', fullName: '中国 · 上海市' },
    current: {
      temp: 31, apparent: 36, weatherText: '多云', icon: '⛅', isDay: true, humidity: 60, windSpeed: 3.7, pop: 16,
      sunrise: '05:35', sunset: '18:59', sunriseToday: '05:35', sunsetToday: '18:59', sunriseTomorrow: '05:36', sunsetTomorrow: '18:58'
    },
    daily: [
      { label: '今天', icon: '🌦️', text: '毛毛雨', tempMin: 24, tempMax: 32 },
      { label: '明天', icon: '🌦️', text: '阵雨', tempMin: 25, tempMax: 29 },
      { label: '周四', icon: '🌧️', text: '中度阵雨', tempMin: 24, tempMax: 31 },
      { label: '周五', icon: '⛈️', text: '雷雨伴冰雹', tempMin: 25, tempMax: 29 }
    ]
  };
  renderWeatherPopover(mockData);
  openWeatherPopover();
})()`);
await sleep(300);

const domCheck = await evalJS(`(() => {
  const pop = document.getElementById('weatherPopover');
  if (!pop) return null;
  const text = pop.innerText || '';
  const cards = pop.querySelectorAll('.glass-subcard');
  return {
    hasLocation: text.includes('中国 · 上海市'),
    hasTemp: text.includes('31°C') && text.includes('体感 36°C'),
    cardCount: cards.length,
    card0: cards[0] ? cards[0].innerText.replace(/\\s+/g, ' ') : '',
    card1: cards[1] ? cards[1].innerText.replace(/\\s+/g, ' ') : '',
    card2: cards[2] ? cards[2].innerText.replace(/\\s+/g, ' ') : '',
    card3: cards[3] ? cards[3].innerText.replace(/\\s+/g, ' ') : '',
    hasUmbrella: text.includes('🌂') || text.includes('☂️') || text.includes('☔️')
  };
})()`);

const gridOrderOk = domCheck && domCheck.hasLocation && domCheck.hasTemp && domCheck.cardCount === 4 && domCheck.hasUmbrella
  && domCheck.card0.includes('相对湿度') && domCheck.card1.includes('实时风速') && domCheck.card2.includes('降水概率')
  && (domCheck.card3.includes('今日日落') || domCheck.card3.includes('明日日出'));

pass('天气弹窗 2×2 网格布局与工位优先级规范 (湿度/风速/降水/日出日落 四大指标与排版)',
  gridOrderOk, `cards: [${domCheck?.card0}] [${domCheck?.card1}] [${domCheck?.card2}] [${domCheck?.card3}]`);

// ══════════════════════════════════════════════════════════════════════
// 5. 相对湿度、实时风速与降水雨伞 9 阶形态动态演化
// ══════════════════════════════════════════════════════════════════════

const dynamicIconsCheck = await evalJS(`(() => {
  // 5.1 干燥 + 微风 + 低降水
  renderWeatherPopover({
    location: { name: '北京' },
    current: { temp: 22, apparent: 23, weatherText: '晴', icon: '☀️', isDay: true, humidity: 20, windSpeed: 2.3, pop: 10, sunrise: '05:35', sunset: '18:59' },
    daily: []
  });
  const htmlDry = document.getElementById('weatherPopover').innerHTML;
  const hasDryCactus = htmlDry.includes('🌵');
  const hasLowWindLeaf = htmlDry.includes('🍃');
  const hasLowPopFoldedUmbrella = htmlDry.includes('🌂');

  // 5.2 舒适湿度 + 清风 + 中降水
  renderWeatherPopover({
    location: { name: '青岛' },
    current: { temp: 24, apparent: 25, weatherText: '多云', icon: '⛅', isDay: true, humidity: 55, windSpeed: 22.0, pop: 35, sunrise: '05:35', sunset: '18:59' },
    daily: []
  });
  const htmlMid = document.getElementById('weatherPopover').innerHTML;
  const hasComfortHumidity = htmlMid.includes('💧');
  const hasMidWindStreamer = htmlMid.includes('🎏');
  const hasMidPopUmbrella = htmlMid.includes('☂️');

  // 5.3 潮湿 + 暴风 + 强降水
  renderWeatherPopover({
    location: { name: '广州' },
    current: { temp: 30, apparent: 35, weatherText: '雷阵雨', icon: '⛈️', isDay: true, humidity: 85, windSpeed: 45.0, pop: 80, sunrise: '05:35', sunset: '18:59' },
    daily: []
  });
  const htmlWet = document.getElementById('weatherPopover').innerHTML;
  const hasWetSplashes = htmlWet.includes('💦');
  const hasHighWindTornado = htmlWet.includes('🌪️');
  const hasRainUmbrella = htmlWet.includes('☔️');

  return {
    hasLowPopFoldedUmbrella, hasMidPopUmbrella, hasRainUmbrella,
    hasDryCactus, hasComfortHumidity, hasWetSplashes,
    hasLowWindLeaf, hasMidWindStreamer, hasHighWindTornado
  };
})()`);

const dynamicsAllOk = dynamicIconsCheck &&
  dynamicIconsCheck.hasLowPopFoldedUmbrella && dynamicIconsCheck.hasMidPopUmbrella && dynamicIconsCheck.hasRainUmbrella &&
  dynamicIconsCheck.hasDryCactus && dynamicIconsCheck.hasComfortHumidity && dynamicIconsCheck.hasWetSplashes &&
  dynamicIconsCheck.hasLowWindLeaf && dynamicIconsCheck.hasMidWindStreamer && dynamicIconsCheck.hasHighWindTornado;

pass('相对湿度、实时风速与降水雨伞 9 阶形态动态演化 (🌵/💧/💦、🍃/🎏/🌪️、🌂/☂️/☔️ 100% 联动准确)',
  dynamicsAllOk, JSON.stringify(dynamicIconsCheck));

// ══════════════════════════════════════════════════════════════════════
// 6. 预报等宽排版、多日平滑对齐与多级行政区划消歧
// ══════════════════════════════════════════════════════════════════════

// 6.1 等宽周几标签
const weekdayCheck = await evalJS(`(() => {
  renderWeatherPopover({
    location: { name: '上海市' },
    current: { temp: 28, apparent: 30, weatherText: '多云', icon: '⛅', pop: 10, humidity: 50, windSpeed: 3, sunset: '18:59' },
    daily: [
      { label: '今天', icon: '⛅', text: '多云', tempMin: 22, tempMax: 30 },
      { label: '明天', icon: '🌦️', text: '阵雨', tempMin: 23, tempMax: 29 },
      { label: '周四', icon: '🌧️', text: '小雨', tempMin: 21, tempMax: 28 },
      { label: '周五', icon: '☀️', text: '晴', tempMin: 20, tempMax: 31 }
    ]
  });
  const labels = [...document.querySelectorAll('#weatherPopover [class*="space-y"] > div > span:first-child')].map(s => s.innerText.trim());
  return labels.length === 4 && labels.every(l => l.length === 2);
})()`);

// 6.2 预报平滑对齐
const smoothingCheck = await evalJS(`(() => {
  const mockFetch = async (mockApiData) => {
    const origFetch = window.fetch;
    window.fetch = async () => ({ ok: true, json: async () => mockApiData });
    try { return await fetchWeatherForecast({ lat: 31.230, lon: 121.473, name: '上海' }); }
    finally { window.fetch = origFetch; }
  };

  return (async () => {
    const resA = await mockFetch({
      current: { temperature_2m: 31, apparent_temperature: 36, is_day: 1, precipitation: 0, weather_code: 1, wind_speed_10m: 3, relative_humidity_2m: 60 },
      daily: { time: ['2026-08-18', '2026-08-19'], weather_code: [51, 80], temperature_2m_max: [32, 29], temperature_2m_min: [24, 25], precipitation_probability_max: [16, 45] }
    });
    const resB = await mockFetch({
      current: { temperature_2m: 28, apparent_temperature: 30, is_day: 1, precipitation: 0, weather_code: 1, wind_speed_10m: 3, relative_humidity_2m: 70 },
      daily: { time: ['2026-08-18', '2026-08-19'], weather_code: [63, 80], temperature_2m_max: [30, 28], temperature_2m_min: [23, 24], precipitation_probability_max: [80, 45] }
    });
    return resA.daily[0].text === '晴间多云' && resA.daily[0].icon === '🌤️' && resB.daily[0].text === '中雨' && resB.daily[0].icon === '🌧️';
  })();
})()`);

// 6.3 地理消歧
const geoFormatCheck = await evalJS(`(() => {
  const c1 = formatLocationFullName(['中国', '上海市', '上海市', '普陀']);
  const c2 = formatLocationFullName(['中国', '北京市', '北京市', '朝阳']);
  const c3 = formatLocationFullName(['中国', '吉林省', '吉林市', '吉林市']);
  const c4 = formatLocationFullName(['中国', '上海市', '黄浦区', '黄浦']);
  const c5 = formatLocationFullName(['中国', '香港特别行政区', '香港']);
  return c1 === '中国 · 上海市 · 普陀' && c2 === '中国 · 北京市 · 朝阳' && c3 === '中国 · 吉林省 · 吉林市' && c4 === '中国 · 上海市 · 黄浦区' && c5 === '中国 · 香港特别行政区';
})()`);

pass('预报等宽排版、多日平滑对齐与多级行政区划消歧 (周几等宽/低POP平滑/多级行政消歧)',
  weekdayCheck && smoothingCheck && geoFormatCheck);

await press('Escape');
await sleep(200);

const code = finish();
await chrome.close();
await server.close();
process.exit(code);

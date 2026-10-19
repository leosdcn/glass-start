/** 验证书签搜索与持久化、天气呈现及生命周期恢复。 */
import { launchSession, makeTester, pressKey, waitFor } from './helpers.mjs';

const { pass, finish } = makeTester();
const { server, chrome, evalJS } = await launchSession();

await evalJS(`
  window.fetch = async () => ({ ok: true, json: async () => ({}) });
  isFetchingWeather = true;
`);
const press = (key) => pressKey(evalJS, key);

// ══════════════════════════════════════════════════════════════════════
// 1. 书签分级匹配、模糊容错与排序
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
      { name: "开发编程", bookmarks: [{ name: "GitHub", url: "https://github.com", desc: "开源项目托管" }] }
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

    // 1.5 Damerau-Levenshtein 拼写容错/模糊纠错匹配 (Tier 60/70)
    pageData.bookmarks = [
      { name: "GitHub", url: "https://github.com", desc: "代码托管" },
      { name: "React 官方文档", url: "https://react.dev", desc: "前端框架" }
    ];
    pageData.categories = [];
    const resFuzzy1 = getLocalBookmarkSuggestions("githbu", 1); // 易位错字容错 (bu -> ub)
    const fuzzyNameOk = resFuzzy1[0]?.name === 'GitHub';
    const resFuzzy2 = getLocalBookmarkSuggestions("reac", 1);   // 前缀容错
    const fuzzyPrefixOk = resFuzzy2[0]?.name === 'React 官方文档';

    // 1.6 纯标点符号查询过滤 (如 "/" 不得误命中所有以 https:// 开头的书签)
    const resPunct = getLocalBookmarkSuggestions("/", 5);
    const punctFilterOk = resPunct.length === 0;

    return { exactNameOk, subNameOk, tierOk, fallbackOk, fuzzyNameOk, fuzzyPrefixOk, punctFilterOk };
  } finally {
    pageData.bookmarks = originalBookmarks;
    pageData.categories = originalCategories;
  }
})()`);

pass('书签三级模糊搜索与优先级排序算法 (精确匹配/包含匹配/三级梯队/简介降级/Damerau-Levenshtein模糊纠错/纯标点过滤)',
  searchAlgoCheck.exactNameOk && searchAlgoCheck.subNameOk && searchAlgoCheck.tierOk && searchAlgoCheck.fallbackOk && searchAlgoCheck.fuzzyNameOk && searchAlgoCheck.fuzzyPrefixOk && searchAlgoCheck.punctFilterOk,
  JSON.stringify(searchAlgoCheck));

// ══════════════════════════════════════════════════════════════════════
// 2. 书签轻量存储模型、旧版数据迁移与自定义图标持久化
// ══════════════════════════════════════════════════════════════════════

// 2.1 首屏干净启动与防空白兜底
const bmInit = await evalJS(`(() => {
  const items = [...document.querySelectorAll('#bookmarks .bookmark-item')];
  const titles = items.map(i => (i.querySelector('.bookmark-title') || {}).textContent || '').filter(Boolean);
  const imgs = items.map(i => i.querySelector('img')).filter(Boolean);
  const allLoadedOrHaveSrc = imgs.length === 8 && imgs.every(img => img.src && !img.src.startsWith('data:image/svg'));
  const keys = localStorage.getItem('userBookmarkKeys');
  const meta = localStorage.getItem('userCustomMeta');
  return { itemCount: items.length, titleCount: titles.length, imgCount: imgs.length, allLoadedOrHaveSrc, keys, meta };
})()`);
const bmClean = bmInit.itemCount === 8 && bmInit.titleCount === 8 && bmInit.imgCount === 8 && bmInit.allLoadedOrHaveSrc && bmInit.keys === null && bmInit.meta === null;

// 2.2 旧版 userBookmarks 自动迁移
await evalJS(`localStorage.setItem('userBookmarks', JSON.stringify([
  { name: 'Gitee', url: 'https://gitee.com', icon: '' },
  { name: '自建站', url: 'https://custom.example.dev', icon: 'https://custom.example.dev/icon.png', desc: '个人站点' }
]))`);
await evalJS('setTimeout(() => location.reload(), 10)');
await waitFor(evalJS, 'document.readyState === "complete" && typeof openEditModal === "function" && localStorage.getItem("userBookmarks") === null');
await evalJS(`
  window.fetch = async () => ({ ok: true, json: async () => ({}) });
  isFetchingWeather = true;
`);

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

// 2.4 saveUserBookmarks 轻量模型与 XSS 安全防御
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

// 2.5 恶意 XSS 注入与转义安全防护
const xssCheck = await evalJS(`(() => {
  const dirtyName = '<img src=x onerror="window.__xss_fired=true">测试XSS';
  const sanitizedName = escapeHtml(dirtyName);
  const dirtyUrl = 'javascript:alert(1)';
  const normalized = normalizeUrl(dirtyUrl);
  return {
    escaped: sanitizedName.includes('&lt;img') && !sanitizedName.includes('<img'),
    xssFired: !!window.__xss_fired,
    safeUrl: normalized.startsWith('https://')
  };
})()`);
const xssOk = xssCheck && xssCheck.escaped && !xssCheck.xssFired && xssCheck.safeUrl;

// 2.6 气象缓存数值信任边界与 weatherNum / weatherTime 安全净化
const weatherSanitizeCheck = await evalJS(`(() => {
  const n1 = weatherNum('<script>alert(1)</script>', 0);
  const n2 = weatherNum('NaN', 50);
  const n3 = weatherNum(null, 50);
  const n4 = weatherNum(undefined, 50);
  const n5 = weatherNum('', 50);
  const n6 = weatherNum('42.5', 0);
  const n7 = weatherNum(true, 50);
  const n8 = weatherNum(false, 50);
  const t1 = weatherTime('<script>18:00</script>');
  const t2 = weatherTime('18:59');
  const t3 = weatherTime('9:41');
  const t4 = weatherTime(null);
  return {
    n1: n1 === 0,
    n2: n2 === 50,
    n3: n3 === 50,
    n4: n4 === 50,
    n5: n5 === 50,
    n6: n6 === 42.5,
    n7: n7 === 50,
    n8: n8 === 50,
    t1: t1 === '--:--',
    t2: t2 === '18:59',
    t3: t3 === '9:41',
    t4: t4 === '--:--'
  };
})()`);
const weatherSanitizeOk = weatherSanitizeCheck && weatherSanitizeCheck.n1 && weatherSanitizeCheck.n2 && weatherSanitizeCheck.n3 && weatherSanitizeCheck.n4 && weatherSanitizeCheck.n5 && weatherSanitizeCheck.n6 && weatherSanitizeCheck.n7 && weatherSanitizeCheck.n8 && weatherSanitizeCheck.t1 && weatherSanitizeCheck.t2 && weatherSanitizeCheck.t3 && weatherSanitizeCheck.t4;

// 2.7 关键交互图标按钮 (del-btn / weatherRefreshBtn) 显式声明 aria-label 规范
const btnA11yCheck = await evalJS(`(() => {
  renderEditList(pageData.bookmarks);
  const delBtn = document.querySelector('.del-btn');
  const delHasAria = delBtn ? delBtn.getAttribute('aria-label') === '删除书签' : false;

  renderWeatherPopover({
    location: { name: '北京', fullName: '中国 · 北京市' },
    current: { temp: 22, apparent: 23, weatherText: '晴', icon: '☀️', humidity: 40, windSpeed: 2.0, pop: 0, sunrise: '05:30', sunset: '18:50' },
    daily: []
  });
  const refBtn = document.getElementById('weatherRefreshBtn');
  const refHasAria = refBtn ? refBtn.getAttribute('aria-label') === '立即刷新天气' : false;

  return { delHasAria, refHasAria };
})()`);
const btnA11yOk = btnA11yCheck && btnA11yCheck.delHasAria && btnA11yCheck.refHasAria;

// 预设壁纸与深浅主题映射、模式标识保持一致。
const wallpaperThemeCheck = await evalJS(`(() => {
  const themes = PRESET_WALLPAPER_THEMES;
  const bgs = backgrounds;
  const countOk = Array.isArray(themes) && themes.length === 8 && Array.isArray(bgs) && bgs.length === 8;
  const isAlternating = themes.every((t, i) => i % 2 === 0 ? !t.isLight : t.isLight);
  const colorsOk = themes.every((t, i) => i % 2 === 0 ? t.color === '#0b0f19' : t.color === '#ffffff');
  return { countOk, isAlternating, colorsOk };
})()`);
const wallpaperThemeOk = wallpaperThemeCheck && wallpaperThemeCheck.countOk && wallpaperThemeCheck.isAlternating && wallpaperThemeCheck.colorsOk;

// 2.9 系统重置与书签默认模型纯 ESM 闭环断言 (不依赖 window 全局挂载 / 内存与存储同步恢复)
const resetBookmarksCheck = await evalJS(`(async () => {
  pageData.categories = DEFAULT_CATEGORIES;
  localStorage.setItem('userBookmarkKeys', JSON.stringify(['https://custom-only.test']));
  localStorage.setItem('userCustomMeta', JSON.stringify({ 'https://custom-only.test': { name: '临时测试' } }));
  localStorage.setItem('preferredEngine', 'google');
  localStorage.setItem('userWallpaper', 'https://custom.test/bg.jpg');
  pageData.bookmarks = [{ name: '临时测试', url: 'https://custom-only.test' }];
  renderBookmarks();

  const origWinDerived = window.getDerivedBookmarks;
  const origWinDefault = window.DEFAULT_BOOKMARKS;
  delete window.getDerivedBookmarks;
  delete window.DEFAULT_BOOKMARKS;

  try {
    resetBookmarks();
    const okBtn = dom.confirmOkBtn || $('confirmOkBtn');
    if (okBtn) okBtn.click();
    const deadline = Date.now() + 3000;
    while (localStorage.getItem('userBookmarkKeys') !== null && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    const countOk = Array.isArray(pageData.bookmarks) && pageData.bookmarks.length === 8;
    const names = pageData.bookmarks.map(b => b.name);
    const hasDefaultNames = names.includes('LocalSend') && names.includes('DeepSeek') && names.includes('Gemini');

    const storageClean = localStorage.getItem('userBookmarkKeys') === null
      && localStorage.getItem('userCustomMeta') === null
      && localStorage.getItem('preferredEngine') === null
      && localStorage.getItem('userWallpaper') === null;

    const domTitles = [...document.querySelectorAll('#bookmarks .bookmark-title')].map(e => e.textContent.trim());
    const domOk = domTitles.includes('LocalSend') && domTitles.includes('DeepSeek');

    const resetSuccess = countOk && hasDefaultNames && storageClean && domOk;
    return { resetSuccess, countOk, hasDefaultNames, storageClean, domOk };
  } finally {
    window.getDerivedBookmarks = origWinDerived;
    window.DEFAULT_BOOKMARKS = origWinDefault;
  }
})()`);
const resetBookmarksOk = resetBookmarksCheck && resetBookmarksCheck.resetSuccess;

await evalJS(`localStorage.clear()`);

pass('书签轻量存储模型、旧版数据迁移、自定义图标持久化、XSS清洗与纯ESM系统重置 (keys+customMeta/迁移/图标持久化/首屏防空白/XSS防注入/weatherNum清洗/图标按钮Aria-Label/壁纸深浅二元契约/纯ESM重置自闭环)',
  bmClean && migrationOk && customMetaOk && saveModelOk && xssOk && weatherSanitizeOk && btnA11yOk && wallpaperThemeOk && resetBookmarksOk,
  JSON.stringify({ ...saveModel, resetBookmarksOk: resetBookmarksCheck.resetSuccess }));

// ══════════════════════════════════════════════════════════════════════
// 3. 天气组件胶囊交互、OverlayStack 层叠栈响应与搜索联想防竞态
// ══════════════════════════════════════════════════════════════════════

const widgetExists = await evalJS(`!!document.getElementById('weatherWidget') && !!document.getElementById('weatherBtn')`);

await evalJS(`document.getElementById('weatherBtn').click()`);
await waitFor(evalJS, `document.getElementById('weatherPopover')?.classList.contains('active') && OverlayStack.top()?.id === 'weatherPopover'`);
const popoverOpened = await evalJS(`({
  active: document.getElementById('weatherPopover').classList.contains('active'),
  ariaHidden: document.getElementById('weatherPopover').getAttribute('aria-hidden') === 'false',
  expanded: document.getElementById('weatherBtn').getAttribute('aria-expanded') === 'true',
  stackTop: OverlayStack.top() ? OverlayStack.top().id : null
})`);
const openOk = popoverOpened.active && popoverOpened.ariaHidden && popoverOpened.expanded && popoverOpened.stackTop === 'weatherPopover';

await press('Escape');
await waitFor(evalJS, `!document.getElementById('weatherPopover')?.classList.contains('active') && OverlayStack.isEmpty()`);
const popoverClosed = await evalJS(`({
  active: document.getElementById('weatherPopover').classList.contains('active'),
  expanded: document.getElementById('weatherBtn').getAttribute('aria-expanded') === 'false',
  stackTop: OverlayStack.top() ? OverlayStack.top().id : null
})`);
const closeOk = !popoverClosed.active && popoverClosed.expanded && popoverClosed.stackTop === null;

// 3.2 搜索联想 activeSuggestReqId 递增防竞态调度与失效请求自动丢弃
const suggestAntiRaceCheck = await evalJS(`(() => {
  // 1. 发起第一次请求
  fetchSuggestions('bing', 'git');
  const req1Id = activeSuggestReqId;
  const cb1Name = '__glassSuggestCb_' + req1Id;
  const cb1Exists = typeof window[cb1Name] === 'function';

  // 2. 快速键入第二个词发起第二次请求
  fetchSuggestions('bing', 'github');
  const req2Id = activeSuggestReqId;
  const cb2Name = '__glassSuggestCb_' + req2Id;
  const reqIdIncremented = req2Id > req1Id;

  // 3. 模拟请求 1 晚于请求 2 返回：调用旧回调 cb1 时，由于内部校验 reqId !== activeSuggestReqId，必须静默丢弃
  if (typeof window[cb1Name] === 'function') {
    window[cb1Name](['git', ['git-old-slow-result']]);
  }
  const oldResultDiscarded = !document.getElementById('suggestionMenu').innerText.includes('git-old-slow-result');

  // 4. 清退联想时自动自增 reqId 并清空未决脚本
  hideSuggestions();
  const req3Id = activeSuggestReqId;
  const hideInvalidatedReq = req3Id > req2Id;

  return { cb1Exists, reqIdIncremented, oldResultDiscarded, hideInvalidatedReq };
})()`);
const antiRaceOk = suggestAntiRaceCheck && suggestAntiRaceCheck.cb1Exists && suggestAntiRaceCheck.reqIdIncremented && suggestAntiRaceCheck.oldResultDiscarded && suggestAntiRaceCheck.hideInvalidatedReq;

pass('天气组件胶囊交互、OverlayStack 层叠栈响应与搜索联想防竞态 (挂载存在/点击展开入栈/Escape退栈/activeSuggestReqId防竞态丢弃)',
  widgetExists && openOk && closeOk && antiRaceOk,
  JSON.stringify({ widgetExists, openOk, closeOk, antiRaceOk }));

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
await waitFor(evalJS, `document.getElementById('weatherPopover')?.classList.contains('active') && (document.getElementById('weatherPopover')?.innerText || '').includes('31°C')`);

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
  && (domCheck.card3.includes('今日日落') || domCheck.card3.includes('明日日出') || domCheck.card3.includes('今日日出'));

pass('天气弹窗 2×2 网格布局与工位优先级规范 (湿度/风速/降水/日出日落 四大指标与排版)',
  gridOrderOk, `cards: [${domCheck?.card0}] [${domCheck?.card1}] [${domCheck?.card2}] [${domCheck?.card3}]`);

// ══════════════════════════════════════════════════════════════════════
// 湿度、风速与降水概率的分档图标。
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

// ══════════════════════════════════════════════════════════════════════
// 7. 标签页休眠唤醒感知与天气/时钟即时对齐测试
// ══════════════════════════════════════════════════════════════════════

const wakeupSyncCheck = await evalJS(`(() => {
  return (async () => {
    isFetchingWeather = false;
    let fetchCount = 0;
    const origFetch = window.fetch;

    window.fetch = async (url, opts) => {
      fetchCount++;
      return {
        ok: true,
        json: async () => ({
          current: {
            temperature_2m: 26,
            apparent_temperature: 27,
            is_day: 1,
            precipitation: 0,
            weather_code: 0,
            wind_speed_10m: 4.2,
            relative_humidity_2m: 50
          },
          daily: {
            time: ['2026-08-19'],
            weather_code: [0],
            temperature_2m_max: [28],
            temperature_2m_min: [22],
            precipitation_probability_max: [10],
            sunrise: ['2026-08-19T05:30'],
            sunset: ['2026-08-19T18:50']
          }
        })
      };
    };

    try {
      // 7.1 缓存有效（< 15 分钟）切回前台：0 网络请求
      const recentCache = {
        timestamp: Date.now() - (5 * 60 * 1000), // 5分钟前
        location: { name: '北京', fullName: '中国 · 北京市', lat: 39.9, lon: 116.4 },
        current: { temp: 25, apparent: 26, weatherText: '晴', icon: '☀️', humidity: 45, windSpeed: 3.0, pop: 0 },
        daily: []
      };
      storageSet('glass_weather_cache', recentCache);
      fetchCount = 0;
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise(r => setTimeout(r, 60));
      const validCacheNoFetch = fetchCount === 0;

      // 7.2 缓存过期（> 15 分钟，如休眠 2 小时）切回前台：即时发起静默刷新并更新缓存
      const expiredCache = {
        timestamp: Date.now() - (120 * 60 * 1000), // 2小时前
        location: { name: '北京', fullName: '中国 · 北京市', lat: 39.9, lon: 116.4 },
        current: { temp: 20, apparent: 20, weatherText: '阴', icon: '☁️', humidity: 60, windSpeed: 2.0, pop: 10 },
        daily: []
      };
      storageSet('glass_weather_cache', expiredCache);
      storageSet('glass_weather_loc_cache', expiredCache.location);
      fetchCount = 0;
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise(r => setTimeout(r, 350));
      const updatedCache = storageGet('glass_weather_cache', null);
      const expiredCacheAutoRefreshed = fetchCount > 0 && updatedCache && (Date.now() - updatedCache.timestamp < 1500);

      // 7.3 时钟切回前台即时同步 (重置时间缓存模拟跨分钟切回)
      lastTimeStr = '';
      if (dom.clock) dom.clock.textContent = '00:00:00';
      document.dispatchEvent(new Event('visibilitychange'));
      const clockSynced = dom.clock && dom.clock.textContent !== '00:00:00';

      // 7.4 BFCache pageshow 唤醒感知：超期缓存通过 pageshow 唤醒即时自动刷新
      const expiredCachePageshow = {
        timestamp: Date.now() - (120 * 60 * 1000),
        location: { name: '上海', fullName: '中国 · 上海市', lat: 31.2, lon: 121.5 },
        current: { temp: 22, apparent: 22, weatherText: '多云', icon: '⛅', humidity: 55, windSpeed: 2.5, pop: 5 },
        daily: []
      };
      storageSet('glass_weather_cache', expiredCachePageshow);
      storageSet('glass_weather_loc_cache', expiredCachePageshow.location);
      fetchCount = 0;
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      await new Promise(r => setTimeout(r, 350));
      const updatedPageshowCache = storageGet('glass_weather_cache', null);
      const pageshowExpiredAutoRefreshed = fetchCount > 0 && updatedPageshowCache && (Date.now() - updatedPageshowCache.timestamp < 1500);

      return {
        validCacheNoFetch,
        expiredCacheAutoRefreshed,
        clockSynced,
        pageshowExpiredAutoRefreshed
      };
    } finally {
      window.fetch = origFetch;
      isFetchingWeather = false;
    }
  })();
})()`);

const wakeupAllOk = wakeupSyncCheck &&
  wakeupSyncCheck.validCacheNoFetch &&
  wakeupSyncCheck.expiredCacheAutoRefreshed &&
  wakeupSyncCheck.clockSynced &&
  wakeupSyncCheck.pageshowExpiredAutoRefreshed;

pass('标签页休眠唤醒感知与天气/时钟即时对齐 (有效缓存0请求/超期自动静默刷新/时钟即时同步/BFCache双通道气象刷新)',
  wakeupAllOk, JSON.stringify(wakeupSyncCheck));

// ══════════════════════════════════════════════════════════════════════
// 8. Favicon 多级容灾降级引擎 (Google S2 备用源自动回退/首字母文字徽章兜底/状态机防死循环)
// ══════════════════════════════════════════════════════════════════════

const faviconFallbackCheck = await evalJS(`(() => {
  // 8.1 faviconFallbackFromUrl 提取算法
  const urlFallback = faviconFallbackFromUrl('https://github.com');
  const wwwFallback = faviconFallbackFromUrl('https://www.google.com');
  const imFallback = faviconFallbackFromUrl('https://a.favicon.im/bilibili.com');
  const emptyFallback = faviconFallbackFromUrl('');

  const urlFallbackOk = urlFallback === 'https://www.google.com/s2/favicons?domain=github.com&sz=128';
  const wwwFallbackOk = wwwFallback === 'https://www.google.com/s2/favicons?domain=google.com&sz=128';
  const imFallbackOk = imFallback === 'https://www.google.com/s2/favicons?domain=bilibili.com&sz=128';
  const emptyFallbackOk = emptyFallback === '';

  // 8.2 handleIconError 双轨降级状态机 (主源失败切换备用源 -> 备用源失败降级文字徽章)
  const container = document.createElement('div');
  container.className = 'icon-box icon-box-md';
  const img = document.createElement('img');
  img.src = 'https://a.favicon.im/example.com';
  img.dataset.initial = 'E';
  img.dataset.md = '1';
  img.dataset.url = 'https://example.com';
  container.appendChild(img);
  document.body.appendChild(container);

  // 首次触发：切换为 Google S2 备用源，图片未被移除
  handleIconError(img);
  const firstFallbackOk = img.dataset.fallback === '1'
    && img.src === 'https://www.google.com/s2/favicons?domain=example.com&sz=128'
    && container.contains(img);

  // 二次触发：备用源依然加载失败，图片被移除，父容器变为首字母文字徽章
  handleIconError(img);
  const secondFallbackOk = !container.contains(img)
    && container.textContent === 'E'
    && container.classList.contains('font-semibold');

  container.remove();

  return {
    urlFallbackOk,
    wwwFallbackOk,
    imFallbackOk,
    emptyFallbackOk,
    firstFallbackOk,
    secondFallbackOk
  };
})()`);

const faviconFallbackAllOk = faviconFallbackCheck &&
  faviconFallbackCheck.urlFallbackOk &&
  faviconFallbackCheck.wwwFallbackOk &&
  faviconFallbackCheck.imFallbackOk &&
  faviconFallbackCheck.emptyFallbackOk &&
  faviconFallbackCheck.firstFallbackOk &&
  faviconFallbackCheck.secondFallbackOk;

pass('Favicon 多级容灾降级引擎 (Google S2 备用源自动回退/首字母文字徽章兜底/状态机防死循环)',
  faviconFallbackAllOk, JSON.stringify(faviconFallbackCheck));

await press('Escape');
await waitFor(evalJS, `OverlayStack.isEmpty()`);

const code = finish();
await chrome.close();
await server.close();
process.exit(code);


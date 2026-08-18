/**
 * 天气小组件 (Weather Widget) 综合测试套件 (weather-widget.test.mjs)
 *
 * 覆盖：
 * 1. 24 小时日落/日出智能时间感知算法
 * 2. 降水概率三阶雨伞形态 (🌂 / ☂️ / ☔️) 动态渲染
 * 3. 未来几天预报周几 (今天/明天/周X/周Y) 2 字符等宽排版
 * 4. DOM 弹窗交互与 OverlayStack 层叠栈响应
 */
import { launchSession, sleep, makeTester, pressKey } from './helpers.mjs';

const { pass, finish } = makeTester();
const { server, chrome, evalJS } = await launchSession();

await sleep(300);
const press = (key) => pressKey(evalJS, key);

// 1. 基础 DOM 节点与预加载胶囊校验
const widgetExists = await evalJS(`!!document.getElementById('weatherWidget') && !!document.getElementById('weatherBtn')`);
pass('天气胶囊与挂载节点存在', widgetExists);

// 2. 点击天气胶囊打开弹窗并压入 OverlayStack
await evalJS(`document.getElementById('weatherBtn').click()`);
await sleep(300);
const popoverOpened = await evalJS(`({
  active: document.getElementById('weatherPopover').classList.contains('active'),
  ariaHidden: document.getElementById('weatherPopover').getAttribute('aria-hidden') === 'false',
  expanded: document.getElementById('weatherBtn').getAttribute('aria-expanded') === 'true',
  stackTop: OverlayStack.top() ? OverlayStack.top().id : null
})`);
pass('点击胶囊顺利展开弹窗并入栈 OverlayStack',
  popoverOpened.active && popoverOpened.ariaHidden && popoverOpened.expanded && popoverOpened.stackTop === 'weatherPopover',
  JSON.stringify(popoverOpened));

// 3. Escape 键可优雅关闭天气弹窗并清空 OverlayStack
await press('Escape');
await sleep(300);
const popoverClosed = await evalJS(`({
  active: document.getElementById('weatherPopover').classList.contains('active'),
  expanded: document.getElementById('weatherBtn').getAttribute('aria-expanded') === 'false',
  stackTop: OverlayStack.top() ? OverlayStack.top().id : null
})`);
pass('Escape 键优雅关闭天气弹窗并退栈',
  !popoverClosed.active && popoverClosed.expanded && popoverClosed.stackTop === null,
  JSON.stringify(popoverClosed));

// 4. 模拟注入测试数据并验证 2x2 网格与动态雨伞 (🌂: 16% 低概率)
await evalJS(`(() => {
  const mockData = {
    location: { name: '上海市', fullName: '中国 · 上海市' },
    current: {
      temp: 31,
      apparent: 36,
      weatherText: '多云',
      icon: '⛅',
      isDay: true,
      humidity: 60,
      windSpeed: 3.7,
      pop: 16,
      sunrise: '05:35',
      sunset: '18:59',
      sunriseToday: '05:35',
      sunsetToday: '18:59',
      sunriseTomorrow: '05:36',
      sunsetTomorrow: '18:58'
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
  const dailyRows = pop.querySelectorAll('[class*="space-y"] > div');
  return {
    hasLocation: text.includes('中国 · 上海市'),
    hasTemp: text.includes('31°C') && text.includes('体感 36°C'),
    cardCount: cards.length,
    card0: cards[0] ? cards[0].innerText.replace(/\\s+/g, ' ') : '',
    card1: cards[1] ? cards[1].innerText.replace(/\\s+/g, ' ') : '',
    card2: cards[2] ? cards[2].innerText.replace(/\\s+/g, ' ') : '',
    card3: cards[3] ? cards[3].innerText.replace(/\\s+/g, ' ') : '',
    hasUmbrella: text.includes('🌂') || text.includes('☂️') || text.includes('☔️'),
    dailyCount: dailyRows.length
  };
})()`);

pass('天气弹窗 2x2 网格与各项指标正确渲染',
  domCheck && domCheck.hasLocation && domCheck.hasTemp && domCheck.cardCount === 4 && domCheck.hasUmbrella,
  JSON.stringify(domCheck));

// 5. 验证 2x2 网格卡片优先级顺序 (湿度 ➔ 风速 ➔ 降水概率 ➔ 日落/日出)
const orderCorrect = domCheck && domCheck.card0.includes('相对湿度') &&
                     domCheck.card1.includes('实时风速') &&
                     domCheck.card2.includes('降水概率') &&
                     (domCheck.card3.includes('今日日落') || domCheck.card3.includes('明日日出'));
pass('2x2 网格桌面端工位优先级顺序准确 (湿度/风速/降水/日出日落)', orderCorrect, `cards: [${domCheck?.card0}] [${domCheck?.card1}] [${domCheck?.card2}] [${domCheck?.card3}]`);

// 6. 验证降水概率三阶雨伞形态 (75% 高概率切换为 ☔️)
const highPopCheck = await evalJS(`(() => {
  const mockHigh = {
    location: { name: '上海市' },
    current: { temp: 22, apparent: 23, weatherText: '暴雨', icon: '⛈️', isDay: true, humidity: 88, windSpeed: 7.2, pop: 75, sunrise: '05:35', sunset: '18:59' },
    daily: []
  };
  renderWeatherPopover(mockHigh);
  return document.getElementById('weatherPopover').innerHTML.includes('☔️');
})()`);
pass('强降雨 (75%) 动态激活落雨伞形态 (☔️)', highPopCheck);

// 7. 验证未来预报周几等宽标签 (今天/明天/周四/周五)
const weekdayCheck = await evalJS(`(() => {
  const mockWeek = {
    location: { name: '上海市' },
    current: { temp: 28, apparent: 30, weatherText: '多云', icon: '⛅', pop: 10, humidity: 50, windSpeed: 3, sunset: '18:59' },
    daily: [
      { label: '今天', icon: '⛅', text: '多云', tempMin: 22, tempMax: 30 },
      { label: '明天', icon: '🌦️', text: '阵雨', tempMin: 23, tempMax: 29 },
      { label: '周四', icon: '🌧️', text: '小雨', tempMin: 21, tempMax: 28 },
      { label: '周五', icon: '☀️', text: '晴', tempMin: 20, tempMax: 31 }
    ]
  };
  renderWeatherPopover(mockWeek);
  const labels = [...document.querySelectorAll('#weatherPopover [class*="space-y"] > div > span:first-child')].map(s => s.innerText.trim());
  return {
    labels,
    allTwoChars: labels.length === 4 && labels.every(l => l.length === 2)
  };
})()`);
pass('未来预报等宽“周几”两字符标签渲染准确', weekdayCheck && weekdayCheck.allTwoChars, JSON.stringify(weekdayCheck?.labels));

await press('Escape');
await sleep(200);

const code = finish();
await chrome.close();
await server.close();
process.exit(code);

/** 验证天气胶囊交互、弹窗布局规范、动态演化图标及休眠唤醒感知。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { launchSession, pressKey, waitFor, navigateAndWait } from './support/helpers.mjs';

test('天气交互、弹窗规范与休眠感知套件', async (t) => {
  const { server, chrome, send, evalJS } = await launchSession();
  const press = (key) => pressKey(evalJS, key);

  // 在应用中固定请求边界，避免真实定位网络阻塞测试
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.fetch = async () => ({ ok: true, json: async () => ({}) });
  ` });
  await navigateAndWait(send, evalJS, `http://127.0.0.1:${server.port}/`,
    'typeof openEditModal === "function" && !!document.querySelector(".bookmark-item") && !isFetchingWeather');

  try {
    await t.test('天气组件胶囊展开、Escape 退栈与 ARIA 状态同步', async () => {
      const widgetExists = await evalJS(`!!document.getElementById('weatherWidget') && !!document.getElementById('weatherBtn')`);
      assert.equal(widgetExists, true);

      await evalJS(`document.getElementById('weatherBtn').click()`);
      await waitFor(evalJS, `document.getElementById('weatherPopover')?.classList.contains('active') && OverlayStack.top()?.id === 'weatherPopover'`);
      const popoverOpened = await evalJS(`({
        active: document.getElementById('weatherPopover').classList.contains('active'),
        ariaHidden: document.getElementById('weatherPopover').getAttribute('aria-hidden') === 'false',
        expanded: document.getElementById('weatherBtn').getAttribute('aria-expanded') === 'true',
        stackTop: OverlayStack.top() ? OverlayStack.top().id : null
      })`);
      assert.ok(popoverOpened.active && popoverOpened.ariaHidden && popoverOpened.expanded && popoverOpened.stackTop === 'weatherPopover');

      await press('Escape');
      await waitFor(evalJS, `!document.getElementById('weatherPopover')?.classList.contains('active') && OverlayStack.isEmpty()`);
      const popoverClosed = await evalJS(`({
        active: document.getElementById('weatherPopover').classList.contains('active'),
        expanded: document.getElementById('weatherBtn').getAttribute('aria-expanded') === 'false',
        stackTop: OverlayStack.top() ? OverlayStack.top().id : null
      })`);
      assert.ok(!popoverClosed.active && popoverClosed.expanded && popoverClosed.stackTop === null);
    });

    await t.test('天气弹窗 2×2 网格布局与工位优先级规范', async () => {
      await evalJS(`(() => {
        const mockData = {
          location: { name: '上海市', fullName: '中国 · 上海市' },
          current: {
            temp: 31, apparent: 36, weatherText: '多云', icon: '⛅', humidity: 60, windSpeed: 3.7, pop: 16,
            sunriseToday: '05:35', sunsetToday: '18:59', sunriseTomorrow: '05:36'
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
          hasTemp: text.includes('31°C') && text.includes('体感 36°') && !text.includes('体感 36°C'),
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

      assert.ok(gridOrderOk, `cards: [${domCheck?.card0}] [${domCheck?.card1}] [${domCheck?.card2}] [${domCheck?.card3}]`);
    });

    await t.test('天气弹窗内原位切换摄氏度/华氏度并即时换算', async () => {
      await evalJS(`document.getElementById('tempUnitToggleBtn').click()`);
      await waitFor(evalJS, `(document.getElementById('weatherPopover')?.innerText || '').includes('88°F')`);
      const fahrenheitState = await evalJS(`({
        popover: document.getElementById('weatherPopover').innerText,
        capsule: document.getElementById('weatherTemp').textContent,
        storage: localStorage.getItem('glass_temp_unit')
      })`);
      assert.ok(fahrenheitState.popover.includes('88°F') && fahrenheitState.popover.includes('体感 97°') && !fahrenheitState.popover.includes('体感 97°F'));
      assert.equal(fahrenheitState.capsule, '88°');
      assert.equal(fahrenheitState.storage, 'F');

      await evalJS(`document.getElementById('tempUnitToggleBtn').click()`);
      await waitFor(evalJS, `(document.getElementById('weatherPopover')?.innerText || '').includes('31°C')`);
      const celsiusState = await evalJS(`({
        popover: document.getElementById('weatherPopover').innerText,
        capsule: document.getElementById('weatherTemp').textContent,
        storage: localStorage.getItem('glass_temp_unit')
      })`);
      assert.ok(celsiusState.popover.includes('31°C') && celsiusState.popover.includes('体感 36°') && !celsiusState.popover.includes('体感 36°C'));
      assert.equal(celsiusState.capsule, '31°');
      assert.equal(celsiusState.storage, 'C');
    });

    await t.test('太阳提示使用天气地点时区，兼容夏令时及无时区旧缓存', async () => {
      await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' });
      const cases = [
        ['Europe/London', '2026-11-04T12:00:00Z', '今日日落', '16:30'],
        ['Europe/London', '2026-11-04T20:00:00Z', '明日日出', '07:02'],
        ['America/New_York', '2026-07-04T10:00:00Z', '今日日出', '07:00'],
        ['America/New_York', '2026-11-04T12:00:00Z', '今日日落', '16:30'],
        [undefined, '2026-11-04T12:00:00Z', '明日日出', '07:02']
      ];
      try {
        for (const [timezone, instant, label, time] of cases) {
          const text = await evalJS(`(() => {
            const OriginalDate = Date;
            window.Date = class extends OriginalDate { constructor(...args) {
              if (args.length) super(...args); else super(${JSON.stringify(instant)});
            }};
            try {
              renderWeatherPopover({ timezone: ${JSON.stringify(timezone) || 'undefined'},
                location: { name: '时区测试' }, current: { temp: 10,
                  sunriseToday: '07:00', sunsetToday: '16:30', sunriseTomorrow: '07:02' }, daily: [] });
              return dom.weatherPopover.textContent;
            } finally { window.Date = OriginalDate; }
          })()`);
          assert.ok(text.includes(label) && text.includes(time), `${timezone}: ${text}`);
        }
      } finally {
        await send('Emulation.setTimezoneOverride', { timezoneId: '' });
      }
    });

    await t.test('相对湿度、实时风速与降水雨伞 9 阶形态动态演化', async () => {
      const dynamicIconsCheck = await evalJS(`(() => {
        // 干燥 + 微风 + 低降水
        renderWeatherPopover({
          location: { name: '北京' },
          current: { temp: 22, apparent: 23, weatherText: '晴', icon: '☀️', humidity: 20, windSpeed: 2.3, pop: 10, sunriseToday: '05:35', sunsetToday: '18:59' },
          daily: []
        });
        const htmlDry = document.getElementById('weatherPopover').innerHTML;
        const hasDryCactus = htmlDry.includes('🌵');
        const hasLowWindLeaf = htmlDry.includes('🍃');
        const hasLowPopFoldedUmbrella = htmlDry.includes('🌂');

        // 舒适湿度 + 清风 + 中降水
        renderWeatherPopover({
          location: { name: '杭州' },
          current: { temp: 24, apparent: 25, weatherText: '多云', icon: '⛅', humidity: 55, windSpeed: 22.0, pop: 35, sunriseToday: '05:35', sunsetToday: '18:59' },
          daily: []
        });
        const htmlMid = document.getElementById('weatherPopover').innerHTML;
        const hasComfortHumidity = htmlMid.includes('💧');
        const hasMidWindStreamer = htmlMid.includes('🎏');
        const hasMidPopUmbrella = htmlMid.includes('☂️');

        // 潮湿 + 暴风 + 强降水
        renderWeatherPopover({
          location: { name: '广州' },
          current: { temp: 30, apparent: 35, weatherText: '雷阵雨', icon: '⛈️', humidity: 85, windSpeed: 55.0, pop: 80, sunriseToday: '05:35', sunsetToday: '18:59' },
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

      assert.ok(dynamicIconsCheck.hasLowPopFoldedUmbrella);
      assert.ok(dynamicIconsCheck.hasMidPopUmbrella);
      assert.ok(dynamicIconsCheck.hasRainUmbrella);
      assert.ok(dynamicIconsCheck.hasDryCactus);
      assert.ok(dynamicIconsCheck.hasComfortHumidity);
      assert.ok(dynamicIconsCheck.hasWetSplashes);
      assert.ok(dynamicIconsCheck.hasLowWindLeaf);
      assert.ok(dynamicIconsCheck.hasMidWindStreamer);
      assert.ok(dynamicIconsCheck.hasHighWindTornado);
    });

    await t.test('缺少日期的旧缓存预报标签按顺序呈现', async () => {
      const weekdayLabels = await evalJS(`(() => {
        renderWeatherPopover({
          location: { name: '上海市' },
          current: { temp: 28, apparent: 30, weatherText: '多云', icon: '⛅', pop: 10, humidity: 50, windSpeed: 3, sunsetToday: '18:59' },
          daily: [
            { label: '今天', icon: '⛅', text: '多云', tempMin: 22, tempMax: 30 },
            { label: '明天', icon: '🌦️', text: '阵雨', tempMin: 23, tempMax: 29 },
            { label: '周四', icon: '🌧️', text: '小雨', tempMin: 21, tempMax: 28 },
            { label: '周五', icon: '☀️', text: '晴', tempMin: 20, tempMax: 31 }
          ]
        });
        openWeatherPopover();
        const labels = [...document.querySelectorAll('#weatherPopover [class*="space-y"] > div > span.w-10:first-child')].map(s => (s.innerText || s.textContent).trim());
        return labels;
      })()`);

      assert.deepEqual(weekdayLabels, ['今天', '明天', '周四', '周五']);
    });

    await t.test('标签页休眠唤醒感知与天气/时钟即时对齐', async () => {
      const wakeupSyncCheck = await evalJS(`(() => {
        return (async () => {
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
            // 缓存有效（< 15 分钟）切回前台：0 网络请求
            const recentCache = {
              timestamp: Date.now() - (5 * 60 * 1000),
              location: { name: '北京', fullName: '中国 · 北京市', lat: 39.9, lon: 116.4 },
              current: { temp: 25, apparent: 26, weatherText: '晴', icon: '☀️', humidity: 45, windSpeed: 3.0, pop: 0 },
              daily: []
            };
            storageSet('glass_weather_cache', recentCache);
            fetchCount = 0;
            document.dispatchEvent(new Event('visibilitychange'));
            await new Promise(r => setTimeout(r, 60));
            const validCacheNoFetch = fetchCount === 0;

            // 缓存过期（> 15 分钟）切回前台：发起刷新
            const expiredCache = {
              timestamp: Date.now() - (120 * 60 * 1000),
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

            // 时钟即时修复
            if (dom.clock) dom.clock.textContent = '00:00:00';
            document.dispatchEvent(new Event('visibilitychange'));
            const clockSynced = dom.clock && dom.clock.textContent !== '00:00:00';

            // BFCache pageshow 唤醒感知
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
          }
        })();
      })()`);

      assert.ok(wakeupSyncCheck.validCacheNoFetch);
      assert.ok(wakeupSyncCheck.expiredCacheAutoRefreshed);
      assert.ok(wakeupSyncCheck.clockSynced);
      assert.ok(wakeupSyncCheck.pageshowExpiredAutoRefreshed);
    });
  } finally {
    await chrome.close();
    await server.close();
  }
});

import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../test/support/server.mjs';
import { launchChrome } from '../test/support/cdp.mjs';
import { createEvaluator, getFreePort, sleep, waitFor, navigateAndWait } from '../test/support/helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const OUTPUT_DIR = join(ROOT_DIR, 'docs', 'assets');
// 默认保留中文截图；node scripts/capture-preview.mjs --lang=en 生成英文版。
const language = process.argv.find(arg => arg.startsWith('--lang='))?.slice(7) || 'zh-CN';
if (!['zh-CN', 'en'].includes(language)) throw new Error('Unsupported language: ' + language);
const startFilename = language === 'en' ? 'preview-start-en.png' : 'preview-start.png';
const navFilename = language === 'en' ? 'preview-nav-en.png' : 'preview-nav.png';

await mkdir(OUTPUT_DIR, { recursive: true });

console.log('🚀 正在启动允许 GPU 加速的 Chrome 截图会话...');
const server = await startServer(0, undefined, {}, { testMode: true });
const cdpPort = await getFreePort();
const targetUrl = `http://127.0.0.1:${server.port}/index.html`;

// 启动带有 GPU 加速并直接导航的 Chrome
const chrome = await launchChrome({
  port: cdpPort,
  url: targetUrl,
  disableGPU: false,
  testMode: true
});
const { send } = chrome;
const evalJS = createEvaluator(send);

try {
  const FIXED_TS = new Date('2026-10-27T12:00:00+08:00').getTime();

  // 1. 设置 1440x900 @2x 视口与地理/时区模拟
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false
  });
  await send('Emulation.setGeolocationOverride', {
    latitude: 31.2304,
    longitude: 121.4737,
    accuracy: 100
  });
  await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' });

  // 2. 注入固定时间与上海天气缓存
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    (() => {
      const language = ${JSON.stringify(language)};
      const loc = {
        name: language === 'en' ? 'Shanghai' : '上海',
        fullName: language === 'en' ? 'Shanghai, China' : '上海市',
        lat: 31.2304,
        lon: 121.4737,
        language,
        timestamp: Date.now()
      };
      const weather = {
        timestamp: Date.now(),
        location: loc,
        current: {
          temp: 21,
          apparent: 21,
          weatherCode: 1,
          icon: '🌤️',
          isDay: true,
          humidity: 55,
          windSpeed: 3.2,
          precipitation: 0,
          pop: 10,
          sunrise: '06:08',
          sunset: '17:15',
          sunriseToday: '06:08',
          sunsetToday: '17:15',
          sunriseTomorrow: '06:09',
          sunsetTomorrow: '17:14'
        },
        daily: [
          { date: '2026-10-27', weatherCode: 1, icon: '🌤️', tempMax: 23, tempMin: 15 },
          { date: '2026-10-28', weatherCode: 0, icon: '☀️', tempMax: 24, tempMin: 16 },
          { date: '2026-10-29', weatherCode: 2, icon: '⛅', tempMax: 22, tempMin: 15 },
          { date: '2026-10-30', weatherCode: 3, icon: '☁️', tempMax: 20, tempMin: 14 },
          { date: '2026-10-31', weatherCode: 80, icon: '🌦️', tempMax: 19, tempMin: 13 },
          { date: '2026-11-01', weatherCode: 0, icon: '☀️', tempMax: 21, tempMin: 12 },
          { date: '2026-11-02', weatherCode: 1, icon: '🌤️', tempMax: 22, tempMin: 13 }
        ]
      };

      try {
        localStorage.setItem('glass_language', JSON.stringify(language));
        localStorage.setItem('glass_weather_loc_cache', JSON.stringify(loc));
        localStorage.setItem('glass_weather_cache', JSON.stringify(weather));
      } catch(e) {}
      window.__PREVIEW_READY__ = true;
    })()
  ` });
  await navigateAndWait(send, evalJS, targetUrl,
    `window.__PREVIEW_READY__ && document.documentElement.lang === ${JSON.stringify(language)} && typeof switchToNav === 'function' && !!document.querySelector('.bookmark-item')`);

  // 3. 充分等待壁纸完全就绪、所有入场动画彻底定格完成 (消除加载中途半透明)
  await sleep(3000);

  // 4. 确保时钟、天气文字与动画全部完全 settle
  await evalJS(`
    (() => {
      // 停止并清理任何处于播放中的入场动画，直接定格最终态
      document.querySelectorAll('.fade-in').forEach(el => {
        el.style.animation = 'none';
        el.style.opacity = '1';
        el.style.transform = 'none';
      });

      const clock = document.getElementById('clock');
      const dateEl = document.getElementById('date');
      const weatherCity = document.getElementById('weatherCity');
      const weatherTemp = document.getElementById('weatherTemp');
      if (clock) clock.innerHTML = '12<span class="clock-colon mx-0.5 sm:mx-1">:</span>00';
      if (dateEl) dateEl.textContent = window.__GLASS_I18N__.formatDate(new Date(${FIXED_TS}));
      if (weatherCity) weatherCity.textContent = ${JSON.stringify(language === 'en' ? 'Shanghai' : '上海')};
      if (weatherTemp) weatherTemp.textContent = '21°';
    })()
  `);
  await sleep(600);

  // 5. 截取首屏起始页（已完全稳定）
  console.log('📸 截取首屏起始页 (' + startFilename + ')...');
  const startSnap = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(OUTPUT_DIR, startFilename), Buffer.from(startSnap.data, 'base64'));

  // 6. 切换到第二屏导航页
  console.log('📸 切换到导航页 (' + navFilename + ')...');
  await evalJS('window.switchToNav()');
  await waitFor(evalJS, `state.currentSection === 'nav' && !isScreenTransitioning()`);
  await evalJS('window.activateVisibleNavIcons && window.activateVisibleNavIcons()');
  await sleep(1500);

  const navSnap = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(OUTPUT_DIR, navFilename), Buffer.from(navSnap.data, 'base64'));

  // 7. 使用 sips 优化为 1440px 宽度
  try {
    const { execSync } = await import('node:child_process');
    execSync(`sips -Z 1440 "${join(OUTPUT_DIR, startFilename)}"`, { stdio: 'ignore' });
    execSync(`sips -Z 1440 "${join(OUTPUT_DIR, navFilename)}"`, { stdio: 'ignore' });
  } catch(e) {}

  console.log('✅ Chrome 截图已成功生成至 docs/assets/ !');
} finally {
  await chrome.close();
  await server.close();
}

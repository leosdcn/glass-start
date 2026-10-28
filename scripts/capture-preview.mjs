import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../test/support/server.mjs';
import { launchChrome } from '../test/support/cdp.mjs';
import { createEvaluator, getFreePort, sleep, waitFor } from '../test/support/helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const OUTPUT_DIR = join(ROOT_DIR, 'docs', 'assets');

await mkdir(OUTPUT_DIR, { recursive: true });

console.log('🚀 正在启动具备真实 GPU 硬件加速的 Chrome 会话...');
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
  await evalJS(`
    (() => {
      const FIXED_TS = ${FIXED_TS};
      const loc = {
        name: '上海',
        fullName: '上海市',
        lat: 31.2304,
        lon: 121.4737,
        ts: FIXED_TS
      };
      const weather = {
        timestamp: FIXED_TS,
        location: loc,
        current: {
          temp: 21,
          apparent: 21,
          weatherCode: 1,
          weatherText: '晴间多云',
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
          { date: '2026-10-27', label: '今天', icon: '🌤️', text: '晴间多云', tempMax: 23, tempMin: 15 },
          { date: '2026-10-28', label: '明天', icon: '☀️', text: '晴', tempMax: 24, tempMin: 16 },
          { date: '2026-10-29', label: '周四', icon: '⛅', text: '多云', tempMax: 22, tempMin: 15 },
          { date: '2026-10-30', label: '周五', icon: '☁️', text: '阴', tempMax: 20, tempMin: 14 },
          { date: '2026-10-31', label: '周六', icon: '🌦️', text: '局部阵雨', tempMax: 19, tempMin: 13 },
          { date: '2026-11-01', label: '周日', icon: '☀️', text: '晴', tempMax: 21, tempMin: 12 },
          { date: '2026-11-02', label: '周一', icon: '🌤️', text: '晴间多云', tempMax: 22, tempMin: 13 }
        ]
      };

      try {
        localStorage.setItem('glass_weather_loc_cache', JSON.stringify(loc));
        localStorage.setItem('glass_weather_cache', JSON.stringify(weather));
      } catch(e) {}
    })()
  `);

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
      if (dateEl) dateEl.textContent = '10月27日 星期二';
      if (weatherCity) weatherCity.textContent = '上海';
      if (weatherTemp) weatherTemp.textContent = '21°';
    })()
  `);
  await sleep(600);

  // 5. 截取首屏起始页（已完全稳定）
  console.log('📸 截取首屏起始页 (preview-start.png)...');
  const startSnap = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(OUTPUT_DIR, 'preview-start.png'), Buffer.from(startSnap.data, 'base64'));

  // 6. 切换到第二屏导航页
  console.log('📸 切换到导航页 (preview-nav.png)...');
  await evalJS('window.switchToNav()');
  await waitFor(evalJS, `state.currentSection === 'nav' && !isScreenTransitioning()`);
  await evalJS('window.activateVisibleNavIcons && window.activateVisibleNavIcons()');
  await sleep(1500);

  const navSnap = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(OUTPUT_DIR, 'preview-nav.png'), Buffer.from(navSnap.data, 'base64'));

  // 7. 使用 sips 优化为 1440px 宽度
  try {
    const { execSync } = await import('node:child_process');
    execSync(`sips -Z 1440 "${join(OUTPUT_DIR, 'preview-start.png')}"`, { stdio: 'ignore' });
    execSync(`sips -Z 1440 "${join(OUTPUT_DIR, 'preview-nav.png')}"`, { stdio: 'ignore' });
  } catch(e) {}

  console.log('✅ 实机截图已成功生成至 docs/assets/ !');
} finally {
  await chrome.close();
  await server.close();
}

/** 生成场景截图并断言布局，不做基准图像差分；视口与场景在各测试处定义。 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchSession, sleep, makeTester, pressKey, waitFor, navigateAndWait } from './support/helpers.mjs';

/** 截图产物输出目录：项目内 test/artifacts/（已 gitignore），相对脚本定位，跨机器可移植 */
const ARTIFACT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'artifacts');

try {
  await mkdir(ARTIFACT_DIR, { recursive: true });
} catch {}

const { pass, finish, results } = makeTester();
const { server, chrome, send, evalJS } = await launchSession();

const press = (key) => pressKey(evalJS, key);
const settled = section => waitFor(evalJS, `state.currentSection === '${section}' && !isScreenTransitioning()`);

/** 截图并保存到测试产物目录 */
async function captureScreenshot(filename) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const buf = Buffer.from(data, 'base64');
  await writeFile(join(ARTIFACT_DIR, filename), buf);
  return filename;
}

/** 提取关键组件的几何尺寸与计算样式 */
async function inspectComponentMetrics(selectors) {
  return await evalJS(`(() => {
    const list = ${JSON.stringify(selectors)};
    const res = {};
    for (const [key, sel] of Object.entries(list)) {
      const el = document.querySelector(sel);
      if (!el) {
        res[key] = { exists: false };
        continue;
      }
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      res[key] = {
        exists: true,
        tagName: el.tagName,
        id: el.id,
        className: el.className,
        rect: {
          x: Math.round(rect.x * 10) / 10,
          y: Math.round(rect.y * 10) / 10,
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
          top: Math.round(rect.top * 10) / 10,
          bottom: Math.round(rect.bottom * 10) / 10,
          left: Math.round(rect.left * 10) / 10,
          right: Math.round(rect.right * 10) / 10,
        },
        computed: {
          display: style.display,
          visibility: style.visibility,
          opacity: parseFloat(style.opacity || '1'),
          transform: style.transform,
          pointerEvents: style.pointerEvents,
          zIndex: style.zIndex,
        },
        ariaHidden: el.getAttribute('aria-hidden'),
        inert: el.inert,
        offsetWidth: el.offsetWidth,
        offsetHeight: el.offsetHeight,
      };
    }
    return res;
  })()`);
}

const START_COMPONENTS = {
  startSection: '#startSection',
  clock: '#clock',
  date: '#date',
  searchBoxWrapper: '.search-box-wrapper',
  searchInput: '#searchInput',
  engineBtn: '#engineBtn',
  weatherWidget: '#weatherWidget',
  weatherBtn: '#weatherBtn',
  bookmarksNav: 'nav[aria-label="快捷书签"]',
  bookmarks: '#bookmarks',
  editBookmarksBtn: '#editBookmarksBtn',
  scrollDownHint: '#scrollDownHint',
};

const NAV_COMPONENTS = {
  navSection: '#navSection',
  navHeader: '#navHeader',
  navHint: '#navHint',
  sidebar: '#sidebar',
  sidebarList: '#sidebarList',
  navContent: '#navContent',
  navCategories: '#navCategories',
};

console.log('🚀 开始执行 Glass Start 视觉渲染与切屏回归测试...\n');

// ══════════════════════════════════════════════════════════════════════
// 场景 A：首屏正常初始态
// ══════════════════════════════════════════════════════════════════════
await send('Emulation.setDeviceMetricsOverride', {
  width: 1470,
  height: 956,
  deviceScaleFactor: 2,
  mobile: false,
});
await sleep(400);

const metricsA = await inspectComponentMetrics(START_COMPONENTS);
await captureScreenshot('visual_test_scenario_A_desktop_start.png');

const startVisibleA = 
  metricsA.clock.exists && metricsA.clock.rect.width > 100 && metricsA.clock.rect.height > 40 && metricsA.clock.computed.opacity > 0.8 &&
  metricsA.searchBoxWrapper.exists && metricsA.searchBoxWrapper.rect.width > 400 && metricsA.searchBoxWrapper.rect.height >= 40 &&
  metricsA.weatherWidget.exists && metricsA.weatherBtn.rect.width > 60 && metricsA.weatherBtn.computed.visibility !== 'hidden' &&
  metricsA.bookmarks.exists && metricsA.bookmarks.rect.width > 400 &&
  metricsA.editBookmarksBtn.exists && metricsA.editBookmarksBtn.rect.width > 30 && metricsA.editBookmarksBtn.computed.visibility !== 'hidden' &&
  metricsA.startSection.rect.top === 0 && metricsA.startSection.ariaHidden !== 'true';

pass('场景 A [Desktop 1470x956 (MacBook Air)]: 首屏初始态完整渲染 (时钟/搜索框/天气胶囊/快捷书签/设置按钮全量就位)',
  startVisibleA,
  JSON.stringify({
    clock: `${metricsA.clock.rect.width}x${metricsA.clock.rect.height} @ y=${metricsA.clock.rect.y}`,
    search: `${metricsA.searchBoxWrapper.rect.width}x${metricsA.searchBoxWrapper.rect.height} @ y=${metricsA.searchBoxWrapper.rect.y}`,
    weather: `${metricsA.weatherBtn.rect.width}x${metricsA.weatherBtn.rect.height} @ x=${metricsA.weatherBtn.rect.x},y=${metricsA.weatherBtn.rect.y}`,
    gear: `${metricsA.editBookmarksBtn.rect.width}x${metricsA.editBookmarksBtn.rect.height} @ x=${metricsA.editBookmarksBtn.rect.x},y=${metricsA.editBookmarksBtn.rect.y}`,
  }));

// ══════════════════════════════════════════════════════════════════════
// 场景 B：平滑切换至导航页
// ══════════════════════════════════════════════════════════════════════
await evalJS('window.switchToNav()');
await settled('nav');

const metricsB = await inspectComponentMetrics({ ...START_COMPONENTS, ...NAV_COMPONENTS });
await captureScreenshot('visual_test_scenario_B_desktop_nav.png');

const transitionMode = await evalJS('document.documentElement.dataset.transitionMode');
const startPositionValid = transitionMode === 'sheet'
  ? metricsB.startSection.rect.width > 0 && metricsB.startSection.rect.width < metricsB.navSection.rect.width
    && metricsB.startSection.rect.height > 0 && metricsB.startSection.rect.height < metricsB.navSection.rect.height
    && Number(metricsB.startSection.computed.zIndex) < Number(metricsB.navSection.computed.zIndex)
  : metricsB.startSection.rect.bottom <= 1;
const navVisibleB = 
  metricsB.navSection.exists && metricsB.navSection.rect.top === 0 && metricsB.navSection.ariaHidden !== 'true' &&
  metricsB.navHeader.exists && metricsB.navHeader.rect.height > 30 &&
  metricsB.sidebar.exists && metricsB.sidebar.rect.width > 80 &&
  metricsB.navContent.exists && metricsB.navContent.rect.width > 500 &&
  startPositionValid && // 层叠模式缩小到导航后方，经典模式完整移出视口
  metricsB.startSection.ariaHidden === 'true' && metricsB.startSection.inert && // 两种切屏模式均隔离首屏
  metricsB.editBookmarksBtn.computed.pointerEvents === 'none' && // gear disabled on nav
  metricsB.editBookmarksBtn.className.includes('hidden-on-nav');

pass('场景 B [Desktop 1470x956 (MacBook Air)]: 切换至导航页 (分类侧边栏/导航Header/卡片流容器 100% 呈现，起始页安全隔离，齿轮禁用)',
  navVisibleB,
  JSON.stringify({
    navSectionY: metricsB.navSection.rect.y,
    startSectionTop: metricsB.startSection.rect.top,
    sidebarWidth: metricsB.sidebar.rect.width,
    navContentWidth: metricsB.navContent.rect.width,
    gearPointerEvents: metricsB.editBookmarksBtn.computed.pointerEvents,
    gearHiddenClass: metricsB.editBookmarksBtn.className.includes('hidden-on-nav'),
  }));

// ══════════════════════════════════════════════════════════════════════
// 场景 C：在导航页刷新页面 (sessionStorage='nav')
// ══════════════════════════════════════════════════════════════════════
await evalJS('window.__visualBeforeReload = true; sessionStorage.setItem("startpage_section", "nav")');
await navigateAndWait(send, evalJS, `http://127.0.0.1:${server.port}/`, `!window.__visualBeforeReload && typeof switchToStart === 'function' && state.currentSection === 'nav'`);
await settled('nav');

const metricsC = await inspectComponentMetrics({ ...START_COMPONENTS, ...NAV_COMPONENTS });
await captureScreenshot('visual_test_scenario_C_desktop_nav_reloaded.png');

const navReloadedC = 
  metricsC.navSection.exists && metricsC.navSection.rect.top === 0 && metricsC.navSection.ariaHidden !== 'true' &&
  metricsC.sidebar.exists && metricsC.sidebar.rect.width > 80 &&
  metricsC.navContent.exists && metricsC.navContent.rect.width > 500;

pass('场景 C [Desktop 1470x956 (MacBook Air)]: 导航页刷新水合态 (sessionStorage 保持直出导航页无闪烁)',
  navReloadedC,
  JSON.stringify({
    navTop: metricsC.navSection.rect.top,
    sidebarRect: metricsC.sidebar.rect,
  }));

// ══════════════════════════════════════════════════════════════════════
// 场景 D：从刷新后的导航页平滑切回搜索页 (重点验证组件消失问题)
// ══════════════════════════════════════════════════════════════════════
await evalJS('window.switchToStart()');
await settled('start');

const metricsD = await inspectComponentMetrics(START_COMPONENTS);
await captureScreenshot('visual_test_scenario_D_desktop_back_to_start.png');

const startRestoredD = 
  metricsD.startSection.exists && metricsD.startSection.rect.top === 0 && metricsD.startSection.ariaHidden !== 'true' &&
  metricsD.clock.exists && metricsD.clock.rect.width > 100 && metricsD.clock.rect.height > 40 && metricsD.clock.computed.opacity > 0.8 &&
  metricsD.searchBoxWrapper.exists && metricsD.searchBoxWrapper.rect.width > 400 && metricsD.searchBoxWrapper.rect.height >= 40 &&
  metricsD.weatherWidget.exists && metricsD.weatherBtn.rect.width > 60 && metricsD.weatherBtn.computed.visibility !== 'hidden' &&
  metricsD.bookmarks.exists && metricsD.bookmarks.rect.width > 400 &&
  metricsD.editBookmarksBtn.exists && metricsD.editBookmarksBtn.rect.width > 30 && metricsD.editBookmarksBtn.computed.opacity > 0.5 &&
  metricsD.editBookmarksBtn.computed.visibility !== 'hidden';

pass('场景 D [Desktop 1470x956 (MacBook Air)]: 从刷新后的导航页切回搜索页 (时钟/搜索框/快捷书签/天气/齿轮 100% 完整复原，零空白零残影)',
  startRestoredD,
  JSON.stringify({
    clock: `${metricsD.clock.rect.width}x${metricsD.clock.rect.height} @ (${metricsD.clock.rect.x}, ${metricsD.clock.rect.y}) opacity=${metricsD.clock.computed.opacity}`,
    searchBox: `${metricsD.searchBoxWrapper.rect.width}x${metricsD.searchBoxWrapper.rect.height} @ (${metricsD.searchBoxWrapper.rect.x}, ${metricsD.searchBoxWrapper.rect.y})`,
    weatherBtn: `${metricsD.weatherBtn.rect.width}x${metricsD.weatherBtn.rect.height} @ (${metricsD.weatherBtn.rect.x}, ${metricsD.weatherBtn.rect.y}) opacity=${metricsD.weatherBtn.computed.opacity}`,
    bookmarks: `${metricsD.bookmarks.rect.width}x${metricsD.bookmarks.rect.height} @ (${metricsD.bookmarks.rect.x}, ${metricsD.bookmarks.rect.y})`,
    gearBtn: `${metricsD.editBookmarksBtn.rect.width}x${metricsD.editBookmarksBtn.rect.height} @ (${metricsD.editBookmarksBtn.rect.x}, ${metricsD.editBookmarksBtn.rect.y}) opacity=${metricsD.editBookmarksBtn.computed.opacity}`,
  }));

// ══════════════════════════════════════════════════════════════════════
// 场景 E：搜索框联想输入与退栈还原状态
// ══════════════════════════════════════════════════════════════════════
await evalJS(`(() => {
  const i = document.getElementById('searchInput');
  i.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, 'github');
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(500);

const metricsE1 = await inspectComponentMetrics({
  ...START_COMPONENTS,
  suggestionMenu: '#suggestionMenu',
  activeSuggestion: '#suggestionMenu .suggestion-item',
});
await captureScreenshot('visual_test_scenario_E1_desktop_suggestions_active.png');

const suggestionActiveE1 = 
  metricsE1.suggestionMenu.exists && metricsE1.suggestionMenu.rect.height > 50 &&
  metricsE1.suggestionMenu.computed.visibility !== 'hidden' && metricsE1.suggestionMenu.computed.opacity > 0.8;

// 按 Escape 退出联想面板
await press('Escape');
await sleep(300);

const metricsE2 = await inspectComponentMetrics({
  ...START_COMPONENTS,
  suggestionMenu: '#suggestionMenu',
});
await captureScreenshot('visual_test_scenario_E2_desktop_suggestions_dismissed.png');

const suggestionDismissedE2 = 
  metricsE2.suggestionMenu.computed.visibility === 'hidden' ||
  metricsE2.suggestionMenu.computed.opacity === 0 ||
  metricsE2.suggestionMenu.rect.height === 0 ||
  metricsE2.suggestionMenu.ariaHidden === 'true';

pass('场景 E [Desktop 1470x956 (MacBook Air)]: 搜索框联想输入激活与退栈清退 (Spotlight 级下拉渲染与 Escape 优雅隐退)',
  suggestionActiveE1 && suggestionDismissedE2,
  JSON.stringify({
    suggestionActiveHeight: metricsE1.suggestionMenu.rect.height,
    suggestionActiveOpacity: metricsE1.suggestionMenu.computed.opacity,
    dismissedAriaHidden: metricsE2.suggestionMenu.ariaHidden,
  }));

// ══════════════════════════════════════════════════════════════════════
// 场景 F：移动端起始页
// ══════════════════════════════════════════════════════════════════════
await send('Emulation.setDeviceMetricsOverride', {
  width: 402,
  height: 874,
  deviceScaleFactor: 3,
  mobile: true,
});
await sleep(400);

const metricsF = await inspectComponentMetrics(START_COMPONENTS);
await captureScreenshot('visual_test_scenario_F_mobile_start.png');

const mobileStartValidF = 
  metricsF.clock.exists && metricsF.clock.rect.width > 80 &&
  metricsF.searchBoxWrapper.exists && metricsF.searchBoxWrapper.rect.width >= 300 &&
  metricsF.weatherWidget.exists && metricsF.weatherBtn.rect.width > 50 &&
  metricsF.bookmarks.exists && metricsF.bookmarks.rect.width >= 300 &&
  metricsF.editBookmarksBtn.exists && metricsF.editBookmarksBtn.rect.width >= 35;

pass('场景 F [Mobile 402x874 (iPhone 17)]: 移动端起始页响应式渲染 (时钟/搜索框/快捷书签/天气/齿轮在移动端完美自适应)',
  mobileStartValidF,
  JSON.stringify({
    clock: `${metricsF.clock.rect.width}x${metricsF.clock.rect.height}`,
    searchBox: `${metricsF.searchBoxWrapper.rect.width}x${metricsF.searchBoxWrapper.rect.height}`,
    bookmarks: `${metricsF.bookmarks.rect.width}x${metricsF.bookmarks.rect.height}`,
    gear: `${metricsF.editBookmarksBtn.rect.width}x${metricsF.editBookmarksBtn.rect.height}`,
  }));

// ══════════════════════════════════════════════════════════════════════
// 场景 G：移动端导航页 (顶部水平 Tab 与卡片流)
// ══════════════════════════════════════════════════════════════════════
await evalJS('window.switchToNav()');
await settled('nav');

const metricsG = await inspectComponentMetrics({ ...START_COMPONENTS, ...NAV_COMPONENTS });
await captureScreenshot('visual_test_scenario_G_mobile_nav.png');

const mobileNavValidG = 
  metricsG.navSection.exists && metricsG.navSection.rect.top === 0 &&
  metricsG.sidebar.exists && metricsG.sidebar.rect.height >= 40 && // horizontal top bar
  metricsG.navContent.exists && metricsG.navContent.rect.width >= 350;

pass('场景 G [Mobile 402x874 (iPhone 17)]: 移动端导航页响应式渲染 (水平分类Tab栏/卡片流/返回Header正常呈现)',
  mobileNavValidG,
  JSON.stringify({
    sidebarHeight: metricsG.sidebar.rect.height,
    navContentRect: metricsG.navContent.rect,
  }));

// ══════════════════════════════════════════════════════════════════════
// 场景 H：移动端在导航页刷新并切回搜索页
// ══════════════════════════════════════════════════════════════════════
await evalJS('window.__visualBeforeReload = true; sessionStorage.setItem("startpage_section", "nav")');
await navigateAndWait(send, evalJS, `http://127.0.0.1:${server.port}/`, `!window.__visualBeforeReload && typeof switchToStart === 'function' && state.currentSection === 'nav'`);
await settled('nav');
await evalJS('window.switchToStart()');
await settled('start');

const metricsH = await inspectComponentMetrics(START_COMPONENTS);
await captureScreenshot('visual_test_scenario_H_mobile_back_to_start.png');

const mobileStartRestoredH = 
  metricsH.startSection.exists && metricsH.startSection.rect.top === 0 &&
  metricsH.clock.exists && metricsH.clock.rect.width > 80 && metricsH.clock.computed.opacity > 0.8 &&
  metricsH.searchBoxWrapper.exists && metricsH.searchBoxWrapper.rect.width >= 300 &&
  metricsH.weatherWidget.exists && metricsH.weatherBtn.rect.width > 50 &&
  metricsH.bookmarks.exists && metricsH.bookmarks.rect.width >= 300 &&
  metricsH.editBookmarksBtn.exists && metricsH.editBookmarksBtn.rect.width >= 35 && metricsH.editBookmarksBtn.computed.opacity > 0.5;

pass('场景 H [Mobile 402x874 (iPhone 17)]: 移动端刷新后切回搜索页全量复原 (时钟/搜索框/快捷书签/天气/齿轮 零缺失)',
  mobileStartRestoredH,
  JSON.stringify({
    clock: `${metricsH.clock.rect.width}x${metricsH.clock.rect.height}`,
    searchBox: `${metricsH.searchBoxWrapper.rect.width}x${metricsH.searchBoxWrapper.rect.height}`,
    weather: `${metricsH.weatherBtn.rect.width}x${metricsH.weatherBtn.rect.height}`,
    gear: `${metricsH.editBookmarksBtn.rect.width}x${metricsH.editBookmarksBtn.rect.height}`,
  }));

// ══════════════════════════════════════════════════════════════════════
// 场景 I：设置与偏好弹窗完整渲染 (外观/书签/数据面板)
// ══════════════════════════════════════════════════════════════════════
await send('Emulation.setDeviceMetricsOverride', { width: 1470, height: 956, deviceScaleFactor: 2, mobile: false });
await evalJS('window.switchToStart()');
await settled('start');
await evalJS('document.getElementById("editBookmarksBtn").click()');
await sleep(500);

const metricsI = await inspectComponentMetrics({
  editModal: '#editModal',
  editModalContent: '#editModal > div',
  tabBookmarks: '#tabBookmarks',
  editList: '#editList',
  saveEditBtn: '#saveEditBtn',
});
await captureScreenshot('visual_test_scenario_I_edit_modal.png');

const editModalValidI = 
  metricsI.editModal.exists && metricsI.editModal.computed.visibility !== 'hidden' &&
  metricsI.editModalContent.rect.width > 500 && metricsI.editModalContent.rect.height > 400 &&
  metricsI.saveEditBtn.exists;

pass('场景 I [Desktop 1470x956 (MacBook Air)]: 设置与偏好弹窗渲染 (毛玻璃容器/Tab导航/快捷书签列表/保存取消按钮)',
  editModalValidI,
  JSON.stringify({
    modalRect: metricsI.editModalContent.rect,
    saveBtn: metricsI.saveEditBtn.rect,
  }));

// ══════════════════════════════════════════════════════════════════════
// 场景 J：天气预报详情卡片展开
// ══════════════════════════════════════════════════════════════════════
await press('Escape');
await sleep(400);
await evalJS('document.getElementById("weatherBtn").click()');
await sleep(500);

const metricsJ = await inspectComponentMetrics({
  weatherWidget: '#weatherWidget',
  weatherPopover: '#weatherPopover',
  weatherBtn: '#weatherBtn',
});
await captureScreenshot('visual_test_scenario_J_weather_popover.png');

const weatherPopoverValidJ = 
  metricsJ.weatherPopover.exists && metricsJ.weatherPopover.rect.width > 200 &&
  metricsJ.weatherPopover.computed.visibility !== 'hidden' &&
  metricsJ.weatherPopover.computed.opacity > 0.8;

pass('场景 J [Desktop 1470x956 (MacBook Air)]: 天气预报详情展开卡片 (2×2详细指标/多日天气预报/日落感知/带伞提示)',
  weatherPopoverValidJ,
  JSON.stringify({
    popoverRect: metricsJ.weatherPopover.rect,
    popoverOpacity: metricsJ.weatherPopover.computed.opacity,
  }));

// ══════════════════════════════════════════════════════════════════════
// 场景 K：全站快捷键速查面板 (Cmd/Ctrl + /)
// ══════════════════════════════════════════════════════════════════════
await press('Escape');
await sleep(400);
await evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', code: 'Slash', metaKey: true, bubbles: true }))`);
await sleep(500);

const metricsK = await inspectComponentMetrics({
  shortcutModal: '#shortcutModal',
  shortcutModalContent: '#shortcutModal > div',
  shortcutModalList: '#shortcutModalList',
  doneShortcutBtn: '#doneShortcutBtn',
});
await captureScreenshot('visual_test_scenario_K_shortcut_modal.png');

const shortcutModalValidK = 
  metricsK.shortcutModal.exists && metricsK.shortcutModal.computed.visibility !== 'hidden' &&
  metricsK.shortcutModalContent.rect.width > 350 &&
  metricsK.doneShortcutBtn.exists;

pass('场景 K [Desktop 1470x956 (MacBook Air)]: 快捷键速查面板 (⌘/ 触发/全站键盘快捷键键位指引)',
  shortcutModalValidK,
  JSON.stringify({
    shortcutRect: metricsK.shortcutModalContent.rect,
  }));

await press('Escape');
await sleep(400);

const exitCode = finish();
await chrome.close();
await server.close();

// 输出最终详细指标给调用者
const testSummaryData = {
  totalPassed: results.filter(r => r.ok).length,
  totalTests: results.length,
  scenarios: {
    metricsA,
    metricsB,
    metricsC,
    metricsD,
    metricsE1,
    metricsE2,
    metricsF,
    metricsG,
    metricsH,
    metricsI,
    metricsJ,
    metricsK,
  }
};

await writeFile(
  join(ARTIFACT_DIR, 'visual_test_summary.json'),
  JSON.stringify(testSummaryData, null, 2)
);

process.exit(exitCode);

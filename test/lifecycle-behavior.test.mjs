import assert from 'node:assert/strict';
import { launchSession, waitFor, navigateAndWait } from './support/helpers.mjs';

const { server, chrome, send, evalJS } = await launchSession(0, {
  '/bfcache-away.html': '<!doctype html><title>BFCache round trip</title>'
});
try {
  await waitFor(evalJS, '!document.querySelector(".fade-in")');
  await evalJS(`(() => {
    window.__nrChanges = [];
    new MutationObserver(records => {
      for (const record of records) {
        if ((record.oldValue || '').split(/\\s+/).includes('nr') || document.documentElement.classList.contains('nr')) __nrChanges.push(true);
      }
    }).observe(document.documentElement, {attributes:true, attributeFilter:['class'], attributeOldValue:true});
  })()`);
  // 非 Chrome 路径仅验证项目 CSS 策略，不模拟其他浏览器引擎。
  for (const chromeCSS of [true, false]) {
    await evalJS(`document.documentElement.classList.toggle('is-chrome', ${chromeCSS})`);
    for (const event of ['pageshow', 'visibilitychange']) {
      for (const section of ['nav', 'start']) {
        await evalJS(section === 'nav' ? 'switchToNav()' : 'switchToStart()');
        await waitFor(evalJS, `state.currentSection === '${section}' && !isScreenTransitioning()`);
        await evalJS(`(() => {
          dom.startSection.style.transition = 'none';
          dom.startSection.style.transform = 'translateY(123px)';
          dom.clock.classList.add('fade-in', 'is-clicked', 'dragging');
          ${event === 'pageshow' ? "window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true}))" : "document.dispatchEvent(new Event('visibilitychange'))"};
        })()`);
        const result = await evalJS(`({
          section: state.currentSection,
          unlocked: !isScreenTransitioning(),
          inlineLayers: [dom.startSection.style.willChange, dom.navSection.style.willChange],
          layers: [getComputedStyle(dom.startSection).willChange, getComputedStyle(dom.navSection).willChange],
          clean: !dom.startSection.style.transition && !dom.startSection.style.transform && !dom.clock.matches('.fade-in,.is-clicked,.dragging'),
          isolated: dom.startSection.inert === (state.currentSection === 'nav') && dom.navSection.inert === (state.currentSection === 'start'),
          layout: (state.currentSection === 'start' ? dom.startSection : dom.navSection).getBoundingClientRect().top
        })`);
        assert.equal(result.section, section);
        assert.deepEqual(result.inlineLayers, ['', '']);
        assert.deepEqual(result.layers, [chromeCSS ? 'transform' : 'auto', chromeCSS ? 'transform' : 'auto']);
        assert.ok(result.unlocked && result.clean && result.isolated, JSON.stringify(result));
        assert.ok(Math.abs(result.layout) < 2, JSON.stringify(result));

        // 新标签页切回走 visibilitychange；返回后再次切屏仍须保留合成提示。
        const nextSection = section === 'start' ? 'nav' : 'start';
        const transition = await evalJS(`(() => {
          ${nextSection === 'nav' ? 'switchToNav()' : 'switchToStart()'};
          return {
            active: document.body.classList.contains('is-screen-transitioning'),
            startLayer: getComputedStyle(dom.startSection).willChange,
            navLayer: getComputedStyle(dom.navSection).willChange
          };
        })()`);
        assert.ok(transition.active, JSON.stringify(transition));
        assert.equal(transition.startLayer, 'transform');
        assert.equal(transition.navLayer, 'transform');
        await waitFor(evalJS, `state.currentSection === '${nextSection}' && !isScreenTransitioning()`);
        assert.equal(await evalJS('document.body.classList.contains("is-screen-transitioning")'), false);
        assert.equal(await evalJS('getComputedStyle(dom.navSection).willChange'), chromeCSS ? 'transform' : 'auto');
      }
    }
    // 使用真实历史返回确认同一文档进入 BFCache，分别覆盖两屏恢复及再次切屏。
    for (const section of ['start', 'nav']) {
      await evalJS(section === 'nav' ? 'switchToNav()' : 'switchToStart()');
      await waitFor(evalJS, `state.currentSection === '${section}' && !isScreenTransitioning()`);
      const token = await evalJS(`(() => {
        window.__bfcacheToken = Math.random();
        window.__bfcacheRestored = false;
        window.addEventListener('pageshow', event => { window.__bfcacheRestored = event.persisted; }, {once:true});
        return __bfcacheToken;
      })()`);
      const url = `http://127.0.0.1:${server.port}/`;
      await navigateAndWait(send, evalJS, url + 'bfcache-away.html');
      const history = await send('Page.getNavigationHistory');
      await send('Page.navigateToHistoryEntry', {entryId:history.entries[history.currentIndex - 1].id});
      await waitFor(evalJS, `location.href === ${JSON.stringify(url)} && window.__bfcacheRestored === true`);
      const restored = await evalJS(`({
        token:__bfcacheToken, section:state.currentSection, unlocked:!isScreenTransitioning(),
        inlineLayers:[dom.startSection.style.willChange, dom.navSection.style.willChange],
        layers:[getComputedStyle(dom.startSection).willChange, getComputedStyle(dom.navSection).willChange],
        isolated:dom.startSection.inert === (state.currentSection === 'nav') && dom.navSection.inert === (state.currentSection === 'start'),
        top:(state.currentSection === 'start' ? dom.startSection : dom.navSection).getBoundingClientRect().top
      })`);
      assert.equal(restored.token, token);
      assert.equal(restored.section, section);
      assert.ok(restored.unlocked && restored.isolated && Math.abs(restored.top) < 2, JSON.stringify(restored));
      assert.deepEqual(restored.inlineLayers, ['', '']);
      assert.deepEqual(restored.layers, [chromeCSS ? 'transform' : 'auto', chromeCSS ? 'transform' : 'auto']);
      const nextSection = section === 'start' ? 'nav' : 'start';
      await evalJS(nextSection === 'nav' ? 'switchToNav()' : 'switchToStart()');
      assert.equal(await evalJS('getComputedStyle(dom.startSection).willChange'), 'transform');
      await waitFor(evalJS, `state.currentSection === '${nextSection}' && !isScreenTransitioning()`);
      assert.ok(await evalJS(`Math.abs(dom.${nextSection === 'nav' ? 'navSection' : 'startSection'}.getBoundingClientRect().top) < 2`));
    }
  }
  assert.equal(await evalJS('__nrChanges.length'), 0);
  console.log('✅ 两种 CSS 策略下，唤醒及真实 BFCache 返回恢复两屏布局、隔离和交互；合成提示由 CSS 管理，无内联残留');
} finally {
  await chrome.close();
  await server.close();
}

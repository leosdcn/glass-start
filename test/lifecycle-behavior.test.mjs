import assert from 'node:assert/strict';
import { launchSession, waitFor } from './helpers.mjs';

const { server, chrome, evalJS } = await launchSession();
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
        clean: !dom.startSection.style.transition && !dom.startSection.style.transform && !dom.clock.matches('.fade-in,.is-clicked,.dragging'),
        isolated: dom.startSection.inert === (state.currentSection === 'nav') && dom.navSection.inert === (state.currentSection === 'start'),
        layout: (state.currentSection === 'start' ? dom.startSection : dom.navSection).getBoundingClientRect().top
      })`);
      assert.equal(result.section, section);
      assert.ok(result.unlocked && result.clean && result.isolated, JSON.stringify(result));
      assert.ok(Math.abs(result.layout) < 2, JSON.stringify(result));
    }
  }
  assert.equal(await evalJS('__nrChanges.length'), 0);
  console.log('✅ 两种唤醒事件均恢复目标屏幕、布局、可访问性和交互状态；运行时不重加预渲染类');
} finally {
  await chrome.close();
  await server.close();
}

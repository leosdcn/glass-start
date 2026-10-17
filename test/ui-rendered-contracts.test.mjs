import assert from 'node:assert/strict';
import { launchSession, waitFor } from './helpers.mjs';

const { server, chrome, evalJS } = await launchSession();
const inspect = () => evalJS(`(() => {
  const issues = [];
  for (const button of document.querySelectorAll('button')) {
    if (button.getAttribute('type') !== 'button') issues.push('button-type:' + (button.id || button.textContent.trim()));
  }
  for (const dialog of document.querySelectorAll('[aria-modal="true"]')) {
    if (dialog.style.display) issues.push('modal-display:' + dialog.id);
    const opened = OverlayStack.stack.some(entry => entry.id === dialog.id);
    if (opened && (dialog.hidden || getComputedStyle(dialog).display === 'none')) issues.push('modal-invisible:' + dialog.id);
    if (!opened && dialog.classList.contains('active')) issues.push('modal-without-stack:' + dialog.id);
  }
  return issues;
})()`);
const verify = async scene => assert.deepEqual(await inspect(), [], scene);
try {
  await verify('首屏、导航与预设动态按钮');
  await evalJS('openEditModal()');
  await waitFor(evalJS, 'dom.editModal.classList.contains("active")');
  await evalJS('dom.addBookmarkBtn.click()');
  await verify('设置与新增书签行');
  await evalJS('openBookmarkPicker()');
  await waitFor(evalJS, 'dom.bookmarkPicker.classList.contains("active")');
  await verify('目录挑选器');
  await evalJS("showConfirm('检查', null, '检查')");
  await waitFor(evalJS, 'dom.confirmModal.classList.contains("active")');
  await verify('嵌套确认框');
  await evalJS('dom.confirmCancelBtn.click(); dom.donePickerBtn.click(); closeEditModal(); openCreditsModal()');
  await waitFor(evalJS, 'dom.creditsModal.classList.contains("active")');
  await verify('鸣谢内容');
  await evalJS('closeCreditsModal(); openShortcutModal()');
  await waitFor(evalJS, 'dom.shortcutModal.classList.contains("active")');
  await evalJS("renderWeatherPopover({current:{temp:20,humidity:50,windSpeed:1},location:{name:'测试'},daily:[]})");
  await verify('快捷键与天气内容');

  // 验证检查器确实能捕获两种已确认的静态检查盲区，随后还原页面。
  await evalJS(`(() => {
    dom.shortcutModal.insertAdjacentHTML('beforeend', '<button id="contract-probe">probe</button>');
    const dialog = dom.shortcutModal;
    dialog.style.display = 'none';
  })()`);
  const issues = await inspect();
  assert.ok(issues.includes('button-type:contract-probe'));
  assert.ok(issues.includes('modal-display:shortcutModal'));
  assert.ok(issues.includes('modal-invisible:shortcutModal'));
  await evalJS("document.getElementById('contract-probe').remove(); dom.shortcutModal.style.display = ''; closeShortcutModal()");
  await verify('还原并关闭');
  console.log('✅ 动态按钮显式声明类型；弹窗可见性与层叠栈一致，别名修改 display 也能检出');

  // 同时启用两个系统偏好时，降低透明度仍必须关闭模糊；弹窗不能覆盖实色降级。
  await evalJS('openEditModal()');
  const wasBright = await evalJS("document.documentElement.classList.contains('wallpaper-bright')");
  for (const motion of ['no-preference', 'reduce']) {
    await chrome.send('Emulation.setEmulatedMedia', { features: [
      { name:'prefers-reduced-motion', value:motion },
      { name:'prefers-reduced-transparency', value:'reduce' }
    ] });
    for (const bright of [false, true]) {
      await evalJS(`document.documentElement.classList.toggle('wallpaper-bright', ${bright})`);
      await waitFor(evalJS, `['#weatherBtn', '#editModal .glass-strong'].every(selector => {
        const s = getComputedStyle(document.querySelector(selector));
        const alpha = Number(s.backgroundColor.match(/rgba?\\([^)]*, ([\\d.]+)\\)$/)?.[1] || 1);
        return s.backdropFilter === 'none' && alpha >= 0.9;
      })`);
    }
  }
  await chrome.send('Emulation.setEmulatedMedia', { features: [] });
  await evalJS(`document.documentElement.classList.toggle('wallpaper-bright', ${wasBright}); closeEditModal()`);
  console.log('✅ 深浅背景下降低透明度保持实色底；叠加减弱动效也不重新启用模糊');
} finally {
  await chrome.close();
  await server.close();
}

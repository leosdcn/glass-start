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
// 在最亮的白色背板上合成降级底色与控件底色，检查实际文字而非仅检查父容器。
const verifyFallbackText = async () => {
  const ratios = await evalJS(`(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently:true });
    const rgba = color => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    };
    const blend = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] / 255 + bg[i] * (1 - fg[3] / 255));
    const luminance = rgb => rgb.map(c => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    return ['#searchInput', '#searchInput::placeholder', '.bookmark-title', '#weatherCity',
      '.nav-bookmark', '.bookmark-description', '#editModal h3', '#saveEditBtn', '#editList input'].map(selector => {
      const el = document.querySelector(selector.replace('::placeholder', ''));
      const surface = el.closest('.glass, .glass-strong');
      const layers = [];
      for (let node = el; node; node = node.parentElement) {
        layers.push(rgba(getComputedStyle(node).backgroundColor));
        if (node === surface) break;
      }
      const bg = layers.reverse().reduce((color, layer) => blend(layer, color), [255, 255, 255]);
      const color = getComputedStyle(el, selector.includes('::placeholder') ? '::placeholder' : null).color;
      const fgLum = luminance(blend(rgba(color), bg)), bgLum = luminance(bg);
      return { selector, bg, color, ratio: (Math.max(fgLum, bgLum) + 0.05) / (Math.min(fgLum, bgLum) + 0.05) };
    });
  })()`);
  for (const result of ratios) assert.ok(result.ratio >= 4.5, `降级文字对比度不足：${JSON.stringify(result)}`);
};
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
  const material = await evalJS(`(() => {
    const root = document.documentElement;
    const previousTint = root.style.getPropertyValue('--glass-tint');
    root.style.setProperty('--glass-tint', '70, 120, 200');
    const s = getComputedStyle(document.querySelector('#editModal .glass-strong'));
    const result = { bg:s.backgroundColor, gradient:s.backgroundImage, blur:s.backdropFilter, border:s.borderColor };
    if (previousTint) root.style.setProperty('--glass-tint', previousTint); else root.style.removeProperty('--glass-tint');
    return result;
  })()`);
  assert.equal(material.bg, 'rgba(255, 255, 255, 0.2)');
  assert.ok(material.gradient.includes('linear-gradient') && material.gradient.includes('70, 120, 200'));
  assert.equal(material.blur, 'blur(40px)');
  assert.equal(material.border, 'rgba(70, 120, 200, 0.22)');
  for (const motion of ['no-preference', 'reduce']) {
    // 减弱动效只关闭动画和过渡，静态玻璃仍保留普通／强两级模糊。
    await chrome.send('Emulation.setEmulatedMedia', { features: [
      { name:'prefers-reduced-motion', value:motion },
      { name:'prefers-reduced-transparency', value:'no-preference' }
    ] });
    const glassLevels = await evalJS(`['#weatherBtn', '.search-box-wrapper', '#editModal .glass-strong'].map(selector => {
      const s = getComputedStyle(document.querySelector(selector));
      return { blur:s.backdropFilter, animation:s.animationName, transition:s.transitionDuration };
    })`);
    assert.deepEqual(glassLevels.map(s => s.blur), ['blur(24px)', 'blur(40px)', 'blur(40px)'],
      '减弱动效不改变玻璃模糊层级');
    if (motion === 'reduce') {
      for (const s of glassLevels) {
        assert.equal(s.animation, 'none');
        assert.equal(s.transition, '0s');
      }
    }
    await chrome.send('Emulation.setEmulatedMedia', { features: [
      { name:'prefers-reduced-motion', value:motion },
      { name:'prefers-reduced-transparency', value:'reduce' }
    ] });
    for (const bright of [false, true]) {
      await evalJS(`document.documentElement.classList.toggle('wallpaper-bright', ${bright})`);
      await waitFor(evalJS, `['#weatherBtn', 'nav[aria-label="快捷书签"]', '#editModal .glass-strong', '.search-box-wrapper', '.nav-surface'].every(selector => {
        const s = getComputedStyle(document.querySelector(selector));
        const alpha = Number(s.backgroundColor.match(/rgba?\\([^)]*, ([\\d.]+)\\)$/)?.[1] || 1);
        return s.backdropFilter === 'none' && s.backgroundImage === 'none' && alpha >= 0.9;
      })`);
      await verifyFallbackText();
    }
  }
  await chrome.send('Emulation.setEmulatedMedia', { features: [] });
  // Chromium 支持滤镜；仅在测试页中强制启用现有 @supports 降级分支。
  assert.equal(await evalJS(`(() => {
    const activateFallback = container => {
      for (let i = 0; i < container.cssRules.length; i++) {
        const rule = container.cssRules[i];
        if (rule instanceof CSSSupportsRule && rule.conditionText.startsWith('not ') && rule.conditionText.includes('backdrop-filter')) {
          const replacement = '@supports (display: block) {' + Array.from(rule.cssRules, r => r.cssText).join('') + '}';
          container.deleteRule(i);
          container.insertRule(replacement, i);
          return true;
        }
        if (rule.cssRules && activateFallback(rule)) return true;
      }
      return false;
    };
    return Array.from(document.styleSheets).some(activateFallback);
  })()`), true, '找到并启用滤镜兼容降级规则');
  for (const bright of [false, true]) {
    await evalJS(`document.documentElement.classList.toggle('wallpaper-bright', ${bright})`);
    await verifyFallbackText();
  }
  await evalJS(`document.documentElement.classList.toggle('wallpaper-bright', ${wasBright}); closeEditModal()`);
  console.log('✅ 深浅背景下减少透明度及滤镜兼容降级的文字保持可读；叠加减弱动效也不重新启用模糊');
  console.log('✅ 减弱动效关闭动画及过渡，保留普通玻璃 24px 与强玻璃 40px');
} finally {
  await chrome.close();
  await server.close();
}

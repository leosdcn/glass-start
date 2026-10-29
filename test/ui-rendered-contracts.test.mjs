import assert from 'node:assert/strict';
import { launchSession, waitFor } from './support/helpers.mjs';

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
  // 在相邻帧快速往返切换尺寸，避免等待过渡结束掩盖容器与内部网格不同步。
  for (const [width, height] of [[2560,1440], [1920,1080], [1280,720], [1000,800], [390,844], [2560,1440], [1920,1080]]) {
    await chrome.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:1, mobile:false });
    const layout = await evalJS(`new Promise(resolve => requestAnimationFrame(() => {
      const search = document.querySelector('[role="search"]').getBoundingClientRect();
      const grid = dom.bookmarks, nav = grid.parentElement;
      const rect = nav.getBoundingClientRect();
      resolve({ width:rect.width, searchWidth:search.width, left:rect.left, searchLeft:search.left,
        delay:getComputedStyle(nav).transitionDelay,
        layoutTransitions:nav.getAnimations().flatMap(a => a.effect.getKeyframes())
          .some(frame => ['maxWidth', 'paddingLeft', 'paddingRight', 'marginBottom'].some(key => key in frame)),
        columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length });
    }))`);
    assert.ok(Math.abs(layout.width-layout.searchWidth)<1 && Math.abs(layout.left-layout.searchLeft)<1,
      `${width}px 快捷书签应即时与搜索条对齐：${JSON.stringify(layout)}`);
    assert.equal(layout.delay, '0s', '入场动画延迟不能触发容器布局过渡延迟');
    assert.equal(layout.layoutTransitions, false, '响应式布局不能生成延迟过渡');
    assert.equal(layout.columns, width>=768 ? 8 : 4);
  }
  console.log('✅ 2K、1K 与手机尺寸快速往返切换，快捷书签即时对齐搜索条且无布局延迟');
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

  // 外观页不能靠压缩网格行高塞进弹窗；窄屏改由内容区滚动，底部操作仍固定。
  await evalJS('openEditModal()');
  await waitFor(evalJS, 'dom.editModal.classList.contains("active")');
  await evalJS('Promise.all(dom.editModal.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})))');
  for (const [width, height] of [[1920,1080], [1000,800], [768,800], [640,800], [390,844], [320,740]]) {
    await chrome.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:2, mobile:false });
    await evalJS("document.getElementById('tab-btn-bookmarks').click()");
    const panelHeight = await evalJS("parseFloat(getComputedStyle(dom.editModal.querySelector('.glass-strong')).height)");
    await evalJS("document.getElementById('tab-btn-appearance').click(); new Promise(requestAnimationFrame)");
    const layout = await evalJS(`(() => {
      const panel = dom.tabAppearance, grid = dom.presetWallpaperGrid;
      const cards = [...grid.querySelectorAll('.preset-bg-card')];
      const rects = cards.map(card=>card.getBoundingClientRect());
      const controls = [...panel.querySelectorAll('.appearance-field')].map(el=>el.getBoundingClientRect());
      const noOverlap = rects.every((r,i)=>rects.slice(i+1).every(other=>
        Math.min(r.right,other.right)-Math.max(r.left,other.left)<1 ||
        Math.min(r.bottom,other.bottom)-Math.max(r.top,other.top)<1));
      return {
        count:cards.length, noOverlap,
        height:parseFloat(getComputedStyle(dom.editModal.querySelector('.glass-strong')).height),
        horizontalOverflow:panel.scrollWidth>panel.clientWidth+1,
        fullGallery:panel.scrollHeight<=panel.clientHeight+1,
        aligned:Math.max(...controls.map(r=>r.top))-Math.min(...controls.map(r=>r.top))<1,
        framed:cards.every(card=>{
          const image=card.querySelector('.preset-bg-image').getBoundingClientRect();
          const title=card.querySelector('.preset-bg-title').getBoundingClientRect();
          return Math.abs(image.width/image.height-16/10)<0.02 &&
            title.top>image.top && title.bottom<=image.bottom &&
            title.left>=image.left && title.right<=image.right;
        })
      };
    })()`);
    assert.equal(layout.count, 8);
    assert.equal(layout.height, panelHeight, `${width}px 切换外观页不能撑高弹窗`);
    assert.ok(layout.noOverlap && layout.framed && !layout.horizontalOverflow, `${width}px: ${JSON.stringify(layout)}`);
    if (width>=640) assert.ok(layout.aligned, `${width}px 三组设置保持横排`);
    if (width===1920) assert.ok(layout.fullGallery, '桌面两排壁纸完整可见');
    const beforeLink = await evalJS(`({
      controlsHeight:dom.tabAppearance.querySelector('.appearance-controls').clientHeight,
      galleryTop:dom.tabAppearance.querySelector('.appearance-gallery').offsetTop
    })`);
    await evalJS('dom.urlBgBtn.click()');
    assert.equal(await evalJS(`document.activeElement===dom.urlBgInput &&
      !dom.urlBgInputRow.classList.contains('hidden') &&
      dom.urlBgInputRow.closest('.appearance-source')!==null &&
      Math.abs(dom.urlBgInputRow.getBoundingClientRect().width-dom.urlBgBtn.closest('.appearance-source').getBoundingClientRect().width)<1`), true,
      `${width}px 网络直链输入在自定义壁纸列原位展开并获得焦点`);
    assert.deepEqual(await evalJS(`({
      controlsHeight:dom.tabAppearance.querySelector('.appearance-controls').clientHeight,
      galleryTop:dom.tabAppearance.querySelector('.appearance-gallery').offsetTop
    })`), beforeLink, `${width}px 展开直链输入不增高设置区或推移壁纸`);
    await evalJS('dom.urlBgCancelBtn.click()');
    assert.equal(await evalJS("dom.urlBgInputRow.classList.contains('hidden') && !dom.urlBgBtnGroup.classList.contains('hidden')"), true);
  }
  await chrome.send('Emulation.setDeviceMetricsOverride', {width:1920,height:1080,deviceScaleFactor:2,mobile:false});
  await evalJS("document.querySelector('#settingsTransitionGrid [data-mode=sheet]').click()");
  assert.equal(await evalJS("document.documentElement.dataset.transitionMode==='sheet' && document.querySelector('#settingsTransitionGrid [data-mode=sheet]').getAttribute('aria-pressed')==='true'"), true);
  const savedBg = await evalJS('state.bg');
  await evalJS('dom.presetWallpaperGrid.querySelectorAll("button")[2].querySelector("svg").dispatchEvent(new MouseEvent("click",{bubbles:true}))');
  await waitFor(evalJS, 'modalState.draftWallpaper===backgrounds[2] && dom.presetWallpaperGrid.querySelectorAll("button")[2].getAttribute("aria-pressed")==="true"');
  assert.equal(await evalJS('dom.presetWallpaperGrid.querySelectorAll("button[aria-pressed=true]").length'), 1);
  assert.equal(await evalJS('state.bg'), savedBg, '预览不修改已保存预设');
  await evalJS("document.querySelector('#settingsTransitionGrid [data-mode=classic]').click(); cancelEditModal()");
  assert.equal(await evalJS('state.bg'), savedBg, '取消设置保留原壁纸');
  console.log('✅ 外观横排保留弹窗高度；六种视口下缩略图无重叠，直链原位展开不推移壁纸，选中态同步');

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
  assert.equal(material.blur, 'blur(36px)');
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
    assert.deepEqual(glassLevels.map(s => s.blur), ['blur(22px)', 'blur(36px)', 'blur(36px)'],
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
  console.log('✅ 减弱动效关闭动画及过渡，保留普通玻璃 22px 与强玻璃 36px');
} finally {
  await chrome.close();
  await server.close();
}

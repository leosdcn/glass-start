/** 尺寸变化应直接重排，不能意外给宽度、间距等布局属性添加过渡。 */
import assert from 'node:assert/strict';
import { launchSession, waitFor } from './helpers.mjs';

const { chrome, server, send, evalJS } = await launchSession();
const settle = () => evalJS(`Promise.all(document.getAnimations()
  .filter(a => a.effect.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})))`);
const inspect = () => evalJS(`new Promise(resolve => requestAnimationFrame(() => {
  const layoutProperty = /^(width|height|minWidth|maxWidth|minHeight|maxHeight|padding|margin|fontSize|lineHeight|gap|rowGap|columnGap|gridTemplate|flexBasis|top$|left$|right$|bottom$)/;
  resolve(document.getAnimations().flatMap(animation => {
    const element = animation.effect.target;
    if (!element?.getClientRects().length) return [];
    const properties = [...new Set(animation.effect.getKeyframes()
      .flatMap(frame => Object.keys(frame).filter(key => layoutProperty.test(key))))];
    return properties.length ? [{ node:element.id || element.className, properties }] : [];
  }));
}))`);
const resize = (width, height) => send('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor:1, mobile:false
});
const scenes = [
  ['首屏', ''],
  ['导航', 'switchToNav()'],
  ['书签设置', 'switchToStart();openEditModal()'],
  ['外观', "document.getElementById('tab-btn-appearance').click()"],
  ['壁纸直链', 'dom.urlBgBtn.click()'],
  ['数据管理', "document.getElementById('tab-btn-data').click()"],
  ['书签挑选器', "document.getElementById('tab-btn-bookmarks').click();openBookmarkPicker()"],
  ['确认框', "showConfirm('布局检查',null,'检查')"],
  ['快捷键', 'dom.confirmCancelBtn.click();dom.donePickerBtn.click();closeEditModal();openShortcutModal()'],
  ['鸣谢', 'closeShortcutModal();openCreditsModal()']
];

try {
  for (const [scene, setup] of scenes) {
    if (setup) await evalJS(setup);
    await settle();
    for (const [width, height] of [[3840,2160], [2560,1440], [1920,1080], [1280,720],
      [1024,768], [768,800], [767,800], [640,800], [639,800], [390,844], [844,390], [2560,1440]]) {
      await resize(width, height);
      assert.deepEqual(await inspect(), [], `${scene} ${width}×${height} 不应产生布局属性过渡`);
    }
    console.log(`✅ ${scene}：12 次跨分辨率与断点切换无布局属性过渡`);
  }

  // 删除未结束时调整尺寸，仍只允许透明度与 transform 动画。
  await evalJS('closeCreditsModal();openEditModal()');
  await settle();
  const before = await evalJS('modalState.draftBookmarks.length');
  await evalJS("dom.editList.querySelector('.del-btn').click()");
  await resize(1000, 800);
  assert.deepEqual(await inspect(), [], '删除过程中切换尺寸不能动画化行间距和内边距');
  await waitFor(evalJS, `dom.editList.querySelectorAll('.edit-row-card').length === ${before - 1}`);
  assert.equal(await evalJS('modalState.draftBookmarks.length'), before - 1);
  console.log('✅ 删除与尺寸切换同时发生时无布局过渡，草稿和占位行正常移除');
} finally {
  await chrome.close();
  await server.close();
}

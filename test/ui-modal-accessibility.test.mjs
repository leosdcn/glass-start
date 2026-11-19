import assert from 'node:assert/strict';
import { launchSession, waitFor } from './support/helpers.mjs';
import { test } from 'node:test';

const visibleRing = /(?<!rgba\(0, 0, 0, 0\)) 0px 0px 0px 2px(?:,|$)/;

async function clickWithoutFocus(send, evalJS, id) {
  const point = await evalJS(`(() => {
    const button = document.getElementById(${JSON.stringify(id)});
    // 模拟 Safari 点击按钮时不会先把焦点移到按钮上。
    button.addEventListener('mousedown', e => e.preventDefault(), { once: true });
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  const mouse = { ...point, button: 'left', clickCount: 1 };
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...mouse });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...mouse });
}

async function forceFocusVisible(send, root, selector) {
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['focus-visible'] });
  return () => send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
}

test('设置的初始页签在鼠标打开时隐藏焦点环，使用键盘时恢复', async () => {
  const { server, chrome, send, evalJS } = await launchSession();
  const press = async (key, windowsVirtualKeyCode, text) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode, text });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode });
  };
  const focusStyle = () => evalJS(`(() => {
    const tab = document.activeElement;
    const style = getComputedStyle(tab);
    return { id: tab.id, selected: tab.getAttribute('aria-selected'), outline: style.outlineStyle, shadow: style.boxShadow };
  })()`);
  try {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const point = await evalJS(`(() => {
      // 模拟 Safari 的鼠标点击不先把焦点移到设置按钮。
      dom.searchInput.focus();
      dom.editBookmarksBtn.addEventListener('mousedown', e => e.preventDefault(), { once: true });
      const rect = dom.editBookmarksBtn.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    const mouse = { ...point, button: 'left', clickCount: 1 };
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...mouse });
    assert.equal(await evalJS('document.activeElement === dom.searchInput'), true);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...mouse });
    await waitFor(evalJS, 'dom.editModal.open');

    await send('DOM.enable');
    await send('CSS.enable');
    const { root } = await send('DOM.getDocument');
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#tab-btn-bookmarks' });
    // 模拟 WebKit 在鼠标打开原生弹窗后为初始焦点匹配 :focus-visible。
    await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['focus-visible'] });
    const initial = await focusStyle();
    assert.equal(initial.id, 'tab-btn-bookmarks');
    assert.equal(initial.selected, 'true');
    assert.equal(initial.outline, 'none');
    assert.doesNotMatch(initial.shadow, visibleRing);

    await press('Home', 36);
    const sameTab = await focusStyle();
    assert.equal(sameTab.id, 'tab-btn-bookmarks');
    assert.match(sameTab.shadow, visibleRing);
    await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    await press('ArrowRight', 39);
    const appearance = await focusStyle();
    assert.equal(appearance.id, 'tab-btn-appearance');
    assert.equal(appearance.selected, 'true');
    assert.match(appearance.shadow, visibleRing);

    await press('Escape', 27);
    assert.equal(await evalJS('!dom.editModal.open && document.activeElement === dom.editBookmarksBtn'), true);
    await press('Enter', 13, '\r');
    await waitFor(evalJS, 'dom.editModal.open');
    const keyboard = await focusStyle();
    assert.equal(keyboard.id, 'tab-btn-bookmarks');
    assert.match(keyboard.shadow, visibleRing);
  } finally {
    await chrome.close();
    await server.close();
  }
});

test('确认弹窗在鼠标打开时隐藏取消按钮焦点环，使用键盘时恢复', async () => {
  const { server, chrome, send, evalJS } = await launchSession();
  const press = async (key, windowsVirtualKeyCode, text) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode, text });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode });
  };
  const focusStyle = () => evalJS(`(() => {
    const el = document.activeElement;
    const style = getComputedStyle(el);
    return { id: el.id, outline: style.outlineStyle, outlineWidth: style.outlineWidth };
  })()`);
  try {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await evalJS(`(() => {
      dom.updateNoticeText.textContent = '有新版本';
      dom.updateNotice.classList.remove('hidden');
      dom.updateReloadBtn.disabled = false;
      dom.updateReloadBtn.addEventListener('click', () => {
        showConfirm('有新版本', () => {}, '新版本已就绪', {
          triggerEl: dom.updateReloadBtn,
          okText: '立即更新',
          tone: 'neutral',
          cancelText: '稍后'
        });
      });
    })()`);

    const point = await evalJS(`(() => {
      const rect = dom.updateReloadBtn.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    const mouse = { ...point, button: 'left', clickCount: 1 };
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...mouse });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...mouse });
    await waitFor(evalJS, 'dom.confirmModal.open');

    await send('DOM.enable');
    await send('CSS.enable');
    const { root } = await send('DOM.getDocument');
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#confirmCancelBtn' });
    // 模拟 WebKit 在鼠标打开原生弹窗后为初始焦点匹配 :focus-visible。
    await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['focus-visible'] });
    const initial = await focusStyle();
    assert.equal(initial.id, 'confirmCancelBtn');
    assert.equal(initial.outline, 'none');

    await press('Tab', 9);
    await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    const ok = await focusStyle();
    assert.equal(ok.id, 'confirmOkBtn');
    assert.equal(ok.outline, 'solid');

    await press('Escape', 27);
    await waitFor(evalJS, '!dom.confirmModal.open');

    // 键盘触发打开时保持焦点环可见
    await evalJS(`dom.updateReloadBtn.focus()`);
    await press('Enter', 13, '\r');
    await waitFor(evalJS, 'dom.confirmModal.open');
    const { nodeId: cancelNodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#confirmCancelBtn' });
    await send('CSS.forcePseudoState', { nodeId: cancelNodeId, forcedPseudoClasses: ['focus-visible'] });
    const keyboard = await focusStyle();
    assert.equal(keyboard.id, 'confirmCancelBtn');
    assert.equal(keyboard.outline, 'solid');
    await send('CSS.forcePseudoState', { nodeId: cancelNodeId, forcedPseudoClasses: [] });
    await press('Escape', 27);
  } finally {
    await chrome.close();
    await server.close();
  }
});

test('语言弹窗聚焦当前选项，打开和归还焦点沿用鼠标或键盘提示', async () => {
  const { server, chrome, send, evalJS } = await launchSession();
  const click = id => clickWithoutFocus(send, evalJS, id);
  const press = async (key, windowsVirtualKeyCode) => {
    for (const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode });
    }
  };
  const shadow = () => evalJS('getComputedStyle(dom.languageBtn).boxShadow');
  const restored = '!dom.languageModal.open && dom.editModal.open && document.activeElement === dom.languageBtn';
  try {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await evalJS(`storageSet(CONFIG.KEYS.LANGUAGE, 'zh-CN'); openEditModal()`);
    await click('languageBtn');
    assert.equal(await evalJS('dom.languageModal.open && document.activeElement.dataset.lang'), 'zh-CN');
    await send('DOM.enable');
    await send('CSS.enable');
    const { root } = await send('DOM.getDocument');
    const clearOption = await forceFocusVisible(send, root, '#languageList [data-lang="zh-CN"]');
    assert.doesNotMatch(await evalJS('getComputedStyle(document.activeElement).boxShadow'), visibleRing);
    await clearOption();

    await click('cancelLanguageBtn');
    assert.equal(await evalJS(restored), true);
    const clearTrigger = await forceFocusVisible(send, root, '#languageBtn');
    assert.doesNotMatch(await shadow(), visibleRing);
    await press('Shift', 16);
    assert.equal(await evalJS(restored), true);
    assert.match(await shadow(), visibleRing);

    await click('languageBtn');
    await click('doneLanguageBtn');
    assert.equal(await evalJS(restored), true);
    assert.doesNotMatch(await shadow(), visibleRing);
    await evalJS('dom.cancelEditBtn.focus(); dom.languageBtn.focus()');
    assert.match(await shadow(), visibleRing);
    await clearTrigger();

    await click('languageBtn');
    assert.equal(await evalJS('dom.languageModal.open'), true);
    await press('Escape', 27);
    assert.equal(await evalJS(restored), true);
    assert.match(await shadow(), visibleRing);

    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    for (const [id, expected] of [['languageBtn', 'dom.languageModal.open'], ['cancelLanguageBtn', restored]]) {
      const touch = await evalJS(`(() => {
        const rect = document.getElementById('${id}').getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await waitFor(evalJS, expected);
    }
    const clearTouch = await forceFocusVisible(send, root, '#languageBtn');
    assert.doesNotMatch(await shadow(), visibleRing);
    await clearTouch();
  } finally {
    await chrome.close();
    await server.close();
  }
});

test('设置子弹窗向实际点击的按钮归还焦点并隐藏指针焦点环', async () => {
  const { server, chrome, send, evalJS } = await launchSession();
  const click = id => clickWithoutFocus(send, evalJS, id);
  try {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await evalJS(`(async () => {
      await openEditModal();
      document.getElementById('tab-btn-data').click();
    })()`);
    await send('DOM.enable');
    await send('CSS.enable');
    const { root } = await send('DOM.getDocument');
    for (const [opener, modalId, closer] of [
      ['openShortcutFromSettingsBtn', 'shortcutModal', 'doneShortcutBtn'],
      ['openCreditsFromSettingsBtn', 'creditsModal', 'doneCreditsBtn'],
      ['resetEditBtn', 'confirmModal', 'confirmCancelBtn']
    ]) {
      await evalJS("document.getElementById('tab-btn-data').focus()");
      await click(opener);
      assert.equal(await evalJS(`document.getElementById('${modalId}').open`), true, modalId);
      if (modalId === 'shortcutModal') {
        assert.equal(await evalJS('document.activeElement === dom.doneShortcutBtn'), true);
        const clear = await forceFocusVisible(send, root, '#doneShortcutBtn');
        assert.doesNotMatch(await evalJS('getComputedStyle(dom.doneShortcutBtn).boxShadow'), visibleRing);
        await clear();
      }
      await click(closer);
      assert.equal(await evalJS(`!document.getElementById('${modalId}').open && document.activeElement.id === '${opener}'`), true, opener);
      const clear = await forceFocusVisible(send, root, `#${opener}`);
      assert.equal(await evalJS('getComputedStyle(document.activeElement).outlineStyle'), 'none', opener);
      assert.doesNotMatch(await evalJS('getComputedStyle(document.activeElement).boxShadow'), visibleRing, opener);
      await clear();
    }
  } finally {
    await chrome.close();
    await server.close();
  }
});

test('原生模态隔离背景，按栈顺序归还焦点', async () => {
  const { server, chrome, send, evalJS } = await launchSession();
  const press = async (key, windowsVirtualKeyCode) => {
    for (const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', { type, key, code:key, windowsVirtualKeyCode });
    }
  };
  try {
    await send('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion', value:'reduce'}] });
    await evalJS('dom.editBookmarksBtn.focus(); openEditModal()');
    assert.equal(await evalJS('document.activeElement.id'), 'tab-btn-bookmarks');
    const { root: document } = await send('DOM.getDocument');
    const { nodeId } = await send('DOM.querySelector', { nodeId:document.nodeId, selector:'#searchInput' });
    const ax = await send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives:false });
    assert.equal(ax.nodes[0].ignored, true);
    await evalJS("window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); dom.searchInput.focus()");
    assert.equal(await evalJS('dom.editModal.contains(document.activeElement)'), true);
    await press('Tab', 9);
    assert.equal(await evalJS('dom.editModal.contains(document.activeElement)'), true);

    await evalJS('dom.togglePickerBtn.focus(); openBookmarkPicker(); dom.donePickerBtn.focus()');
    await evalJS("showConfirm('测试通知', null, '测试', { triggerEl: dom.donePickerBtn })");
    assert.equal(await evalJS('dom.togglePickerBtn.focus(); dom.donePickerBtn.focus(); dom.confirmModal.contains(document.activeElement)'), true);
    await press('Escape', 27);
    assert.equal(await evalJS('!dom.confirmModal.open && document.activeElement === dom.donePickerBtn'), true);
    await press('Escape', 27);
    assert.equal(await evalJS('document.activeElement === dom.togglePickerBtn'), true);
    await press('Escape', 27);
    assert.equal(await evalJS('document.activeElement === dom.editBookmarksBtn && !state.editOpen && dom.navSection.inert && !document.body.classList.contains("overflow-hidden")'), true);

    await evalJS("showConfirm('测试确认', () => {}, '测试', { tone: 'neutral' })");
    await press('Tab', 9);
    assert.equal(await evalJS('dom.confirmOkBtn.matches(":focus-visible")'), true);
    const shadow = await evalJS('getComputedStyle(dom.confirmOkBtn).boxShadow');
    const { x, y } = await evalJS(`(() => {
      const rect = dom.confirmOkBtn.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await waitFor(evalJS, `dom.confirmOkBtn.matches(':hover') && getComputedStyle(dom.confirmOkBtn).boxShadow !== ${JSON.stringify(shadow)}`);
    assert.deepEqual(await evalJS(`(() => {
      const style = getComputedStyle(dom.confirmOkBtn);
      return [dom.confirmOkBtn.matches(':focus-visible'), style.outlineStyle, style.outlineWidth];
    })()`), [true, 'solid', '2px']);
    await press('Escape', 27);

    const fallback = await evalJS(`(() => {
      const existing = document.createElement('div'); existing.inert = true; document.body.append(existing);
      const trigger = document.createElement('button'); trigger.type = 'button'; document.body.append(trigger);
      trigger.focus(); openCreditsModal(); trigger.remove(); closeCreditsModal();
      return existing.inert && document.activeElement !== document.body && document.activeElement.isConnected;
    })()`);
    assert.equal(fallback, true);
  } finally {
    await chrome.close();
    await server.close();
  }
});

test('退场继续绘制时，下层可立即获得焦点与点击', async () => {
  const { server, chrome, evalJS } = await launchSession();
  try {
    await evalJS(`(async () => {
      dom.editBookmarksBtn.focus(); await openEditModal();
      document.getElementById('tab-btn-data').click();
    })()`);
    await waitFor(evalJS, 'dom.editModal.getAnimations({subtree:true}).length === 0');
    await evalJS('dom.openCreditsFromSettingsBtn.focus(); openCreditsModal()');
    await waitFor(evalJS, 'Number(getComputedStyle(dom.creditsModal.firstElementChild).opacity) === 1');
    const exit = await evalJS(`(() => {
      closeCreditsModal();
      const trigger = dom.openCreditsFromSettingsBtn;
      const bounds = trigger.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return {
        logicalClose: !dom.creditsModal.open && !dom.creditsModal.matches(':modal'),
        visualExit: getComputedStyle(dom.creditsModal).display !== 'none',
        focusRestored: document.activeElement === trigger,
        pointerRestored: trigger.contains(hit)
      };
    })()`);
    assert.deepEqual(exit, { logicalClose:true, visualExit:true, focusRestored:true, pointerRestored:true });

    await evalJS('openCreditsModal()');
    assert.equal(await evalJS('dom.creditsModal.open && dom.creditsModal.contains(document.activeElement)'), true);
    await evalJS('closeCreditsModal(); closeEditModal()');
    await waitFor(evalJS, 'getComputedStyle(dom.creditsModal).display === "none" && getComputedStyle(dom.editModal).display === "none"');

    // 在同一个任务内取消打开，并用连按快捷键验证业务栈与原生状态同步。
    assert.equal(await evalJS(`(() => {
      openShortcutModal(); closeShortcutModal();
      const canceled = !dom.shortcutModal.open && OverlayStack.isEmpty();
      const press = () => document.dispatchEvent(new KeyboardEvent('keydown', { key:'/', metaKey:true, bubbles:true }));
      press(); press();
      return canceled && !dom.shortcutModal.open && OverlayStack.isEmpty();
    })()`), true);
  } finally {
    await chrome.close();
    await server.close();
  }
});

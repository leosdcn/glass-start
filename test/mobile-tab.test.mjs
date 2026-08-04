import { launchSession, makeTester, sleep } from './helpers.mjs';

const t = makeTester();
const { server, chrome, send, evalJS } = await launchSession(9338);

try {
  // 设置模拟 iPhone 竖屏视口 (390 x 844, mobile=true)
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true
  });
  await sleep(300);

  // 1. 切换至导航页
  await evalJS('window.switchToNav()');
  await sleep(600);

  // 2. 检查 "cat-tab-0" (人工智能 Tab) 是否激活且在 iPhone 竖屏模式下完全可见
  const tab0Info = await evalJS(`(() => {
    const tab0 = document.getElementById('cat-tab-0');
    const sidebar = document.getElementById('sidebar');
    if (!tab0 || !sidebar) return null;
    const tRect = tab0.getBoundingClientRect();
    const sRect = sidebar.getBoundingClientRect();
    return {
      text: tab0.textContent.trim(),
      active: tab0.classList.contains('active'),
      left: tRect.left,
      right: tRect.right,
      sidebarLeft: sRect.left,
      sidebarRight: sRect.right,
      scrollLeft: sidebar.scrollLeft,
      visible: tRect.left >= sRect.left && tRect.right <= sRect.right
    };
  })()`);

  t.pass('切换至导航页后 "cat-tab-0" (人工智能) 正确激活', tab0Info?.active && tab0Info?.text.includes('人工智能'), `active=${tab0Info?.active} text=${tab0Info?.text}`);
  t.pass('iPhone 竖屏模式下 "cat-tab-0" (人工智能) 在视口内完全可见', tab0Info?.visible && tab0Info?.scrollLeft === 0, `scrollLeft=${tab0Info?.scrollLeft} visible=${tab0Info?.visible}`);

  // 3. 在移动端滚动 #navContent 至后续分类 (如向下滚动 800px)
  await evalJS('document.getElementById("navContent").scrollTop = 800');
  await sleep(300);
  await evalJS('document.getElementById("navContent").dispatchEvent(new Event("scroll"))');
  await sleep(500);

  const scrolledInfo = await evalJS(`(() => {
    const sidebar = document.getElementById('sidebar');
    const activeTab = sidebar.querySelector('.sidebar-item.active');
    return {
      activeId: activeTab ? activeTab.id : null,
      activeText: activeTab ? activeTab.textContent.trim() : null,
      scrollLeft: sidebar.scrollLeft
    };
  })()`);

  t.pass('下滚后侧边栏高亮正确切至后续分类 Tab', scrolledInfo.activeId !== 'cat-tab-0', `activeId=${scrolledInfo.activeId} activeText=${scrolledInfo.activeText}`);

  // 4. 滚回最顶部 (scrollTop = 0)，验证高亮恢复至 cat-tab-0 且 sidebar.scrollLeft 自动复位至 0
  await evalJS('document.getElementById("navContent").scrollTop = 0');
  await sleep(300);
  await evalJS('document.getElementById("navContent").dispatchEvent(new Event("scroll"))');
  await sleep(600);

  const restoredInfo = await evalJS(`(() => {
    const tab0 = document.getElementById('cat-tab-0');
    const sidebar = document.getElementById('sidebar');
    const tRect = tab0.getBoundingClientRect();
    const sRect = sidebar.getBoundingClientRect();
    return {
      active: tab0.classList.contains('active'),
      scrollLeft: sidebar.scrollLeft,
      visible: tRect.left >= sRect.left && tRect.right <= sRect.right
    };
  })()`);

  t.pass('滚回顶部后 "cat-tab-0" (人工智能) 恢复高亮', restoredInfo.active, `active=${restoredInfo.active}`);
  t.pass('滚回顶部后 sidebar.scrollLeft 恢复为 0 且 Tab 完全呈现', restoredInfo.scrollLeft === 0 && restoredInfo.visible, `scrollLeft=${restoredInfo.scrollLeft} visible=${restoredInfo.visible}`);

} finally {
  await chrome.close();
  await server.close();
}

process.exit(t.finish());

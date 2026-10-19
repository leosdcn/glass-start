import assert from 'node:assert/strict';
import { launchSession, navigateAndWait, waitFor } from './helpers.mjs';

const { server, chrome, send, evalJS } = await launchSession();
const origin = `http://127.0.0.1:${server.port}`;
try {
  await evalJS('navigator.serviceWorker.ready.then(() => true)');
  await send('Page.reload');
  await waitFor(evalJS, '!!navigator.serviceWorker.controller && typeof openEditModal === "function"');
  for (const suffix of ['', '?v=icon-navigation']) {
    await navigateAndWait(send, evalJS, `${origin}/apple-touch-icon.png${suffix}`,
      'document.contentType === "image/png" && document.images[0]?.complete');
    const icon = await evalJS('({type:document.contentType,width:document.images[0].naturalWidth,height:document.images[0].naturalHeight})');
    assert.deepEqual(icon, { type: 'image/png', width: 180, height: 180 });
    await navigateAndWait(send, evalJS, origin + '/', 'typeof openEditModal === "function"');
  }
  await navigateAndWait(send, evalJS, `${origin}/icons/app/favicon.svg?v=icon-navigation`,
    'document.contentType === "image/svg+xml"');
  assert.equal(await evalJS('document.documentElement.localName'), 'svg');
  await navigateAndWait(send, evalJS, origin + '/offline-entry', 'typeof openEditModal === "function"');
  console.log('✅ SW 控制下直接导航到 PNG/SVG（含版本参数）返回图像，普通页面导航仍可回退主文档');
} finally {
  await chrome.close();
  await server.close();
}

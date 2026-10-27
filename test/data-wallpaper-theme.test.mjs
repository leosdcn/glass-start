import assert from 'node:assert/strict';
import { launchSession, waitFor } from './helpers.mjs';

const { server, chrome, send, evalJS } = await launchSession();
// 通过真实壁纸加载流程采样；生成图只驻留测试页内存，不存入 LocalStorage。
async function sample({ width, height, viewportWidth = width, viewportHeight = height, bands, mask = 0 }) {
  await send('Emulation.setDeviceMetricsOverride', {
    width:viewportWidth, height:viewportHeight, deviceScaleFactor:1, mobile:false
  });
  await evalJS(`(() => {
    const canvas = document.createElement('canvas');
    canvas.width = ${width}; canvas.height = ${height};
    const ctx = canvas.getContext('2d');
    for (const band of ${JSON.stringify(bands)}) {
      ctx.fillStyle = band.color;
      ctx.fillRect(band.x, band.y, band.width, band.height);
    }
    ${mask === null ? "localStorage.removeItem('maskOpacity');" : `localStorage.setItem('maskOpacity', ${JSON.stringify(JSON.stringify(mask))});`}
    localStorage.removeItem('glass_tint_cache');
    applyWallpaper(canvas.toDataURL(), false);
  })()`);
  await waitFor(evalJS, "localStorage.getItem('glass_tint_cache') !== null");
  return evalJS(`({
    bright:document.documentElement.classList.contains('wallpaper-bright'),
    tint:document.documentElement.style.getPropertyValue('--glass-tint').split(',').map(Number)
  })`);
}

try {
  // 书签就绪时 IDB 壁纸恢复可能尚未结束，先等初始壁纸解码，避免覆盖测试采样。
  await waitFor(evalJS, 'getPreparedWallpaperImage(backgrounds[state.bg]) !== null');
  const gray = { width:800, height:800, bands:[{x:0, y:0, width:800, height:800, color:'rgb(150, 150, 150)'}] };
  assert.deepEqual(await sample(gray), {bright:true, tint:[150, 150, 150]}, '零遮罩不应误用默认暗度');
  for (const mask of [20, null, 'invalid']) {
    assert.deepEqual(await sample({...gray, mask}), {bright:false, tint:[140, 140, 140]}, '显式、缺省及非法暗度均正确处理');
  }
  const split = await sample({width:800, height:800, bands:[
    {x:0, y:0, width:800, height:800, color:'rgb(60, 80, 200)'},
    {x:0, y:0, width:800, height:200, color:'white'}
  ]});
  assert.equal(split.bright, true, '顶栏保留顶部亮度采样');
  assert.ok(split.tint[2] > split.tint[0] + 70, '环境色应包含中央及下方蓝色区域');
  for (const portrait of [true, false]) {
    const width = portrait ? 1200 : 800, height = portrait ? 800 : 1200;
    const cropped = await sample({width, height, viewportWidth:portrait ? 400 : 800, viewportHeight:portrait ? 800 : 400, bands:[
      {x:0, y:0, width, height, color:'white'},
      {x:portrait ? 400 : 0, y:portrait ? 0 : 400, width:portrait ? 400 : 800, height:portrait ? 800 : 400, color:'rgb(60, 100, 200)'}
    ]});
    assert.equal(cropped.bright, false, '顶部主题采样应排除被裁掉的白色区域');
    // 缩小裁切图时边缘插值可能混入邻接像素，允许两个色阶的误差。
    assert.ok(cropped.tint.every((value, i) => Math.abs(value - [60, 100, 200][i]) <= 2),
      '横纵向 cover 裁切均应排除不可见白色区域：' + cropped.tint);
  }
  console.log('✅ 自定义壁纸零暗度、默认值、独立顶栏与环境色采样、横纵向居中裁切正确');
} finally {
  await chrome.close();
  await server.close();
}

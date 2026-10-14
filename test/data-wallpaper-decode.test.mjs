import assert from 'node:assert/strict';
import { launchSession, waitFor } from './helpers.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64');
const { server, chrome, send, evalJS } = await launchSession(0, { '/decode.png': (req, res) => {
  res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(png);
} });
try {
  await waitFor(evalJS, 'typeof applyWallpaper === "function"');
  const result = await evalJS(`(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');
    const pending = new Map();
    const wait = async predicate => {
      const deadline = Date.now() + 3000;
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error('Decode regression timed out');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    };
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const url = tag => location.origin + '/decode.png?' + tag;
    const showing = tag => dom.bgLayer.style.backgroundImage.includes('/decode.png?' + tag);
    try {
      Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable:true, value:function() {
        return new Promise((resolve, reject) => pending.set(this.src, {resolve, reject}));
      } });
      const before = dom.bgLayer.style.backgroundImage;
      applyWallpaper(url('old'), false);
      await wait(() => pending.has(url('old')));
      const waitsForDecode = dom.bgLayer.style.backgroundImage === before;
      applyWallpaper(url('new'), false);
      await wait(() => pending.has(url('new')));
      pending.get(url('new')).resolve();
      await wait(() => showing('new'));
      pending.get(url('old')).resolve();
      await frame();
      const staleIgnored = showing('new');
      applyWallpaper(url('broken'), false);
      await wait(() => pending.has(url('broken')));
      pending.get(url('broken')).reject(new DOMException('Decode failed', 'EncodingError'));
      await frame();
      const failedKeepsCurrent = showing('new');
      delete HTMLImageElement.prototype.decode;
      applyWallpaper(url('fallback'), false);
      await wait(() => showing('fallback'));
      return { waitsForDecode, staleIgnored, failedKeepsCurrent, unsupportedFallback:showing('fallback') };
    } finally {
      Object.defineProperty(HTMLImageElement.prototype, 'decode', descriptor);
    }
  })()`);
  assert.equal(Object.values(result).every(Boolean), true, JSON.stringify(result));
  console.log('✅ 解码完成前保留旧壁纸、迟到解码隔离、失败保留当前图片、无 decode 时回退加载事件');
  const uploadResult=await evalJS(`(async () => {
    const wait = async predicate => {
      const deadline=Date.now()+5000;
      while (!predicate()) { if(Date.now()>deadline) throw new Error('Upload timeout'); await new Promise(r=>setTimeout(r,20)); }
    };
    const input=dom.uploadBgInput;
    const put=file=>{const dt=new DataTransfer();dt.items.add(file);input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));};
    put(new File(['x'],'bad.txt',{type:'text/plain'}));
    const invalidBlocked=OverlayStack.top()?.id==='confirmModal';
    dom.confirmOkBtn.click();
    const source=document.createElement('canvas');source.width=3000;source.height=2000;
    source.getContext('2d').fillRect(0,0,3000,2000);
    const blob=await new Promise(resolve=>source.toBlob(resolve,'image/png'));
    const original=HTMLCanvasElement.prototype.toDataURL;
    let compressed;
    HTMLCanvasElement.prototype.toDataURL=function(type,quality){ compressed={width:this.width,height:this.height,type,quality};return original.call(this,type,quality); };
    const before=state.customWallpaper;
    try {
      put(new File([blob],'large.png',{type:'image/png'}));
      await wait(()=>state.customWallpaper!==before && state.customWallpaper?.startsWith('data:image/jpeg'));
      const fit=compressed.width<=CONFIG.APPEARANCE.MAX_UPLOAD_WIDTH && compressed.height<=CONFIG.APPEARANCE.MAX_UPLOAD_HEIGHT && Math.abs(compressed.width/compressed.height-1.5)<0.01;
      return {invalidBlocked,fit,jpeg:compressed.type==='image/jpeg',quality:compressed.quality===CONFIG.APPEARANCE.JPEG_QUALITY,persisted:await getWallpaperDB()===state.customWallpaper,inputCleared:input.value===''};
    } finally {HTMLCanvasElement.prototype.toDataURL=original;}
  })()`);
  assert.equal(Object.values(uploadResult).every(Boolean),true,JSON.stringify(uploadResult));
  console.log('✅ 上传拒绝无效文件，大图等比例压缩为 JPEG，保存至 IndexedDB 并清空文件输入');
} finally { await chrome.close(); await server.close(); }

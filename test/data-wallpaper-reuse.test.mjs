/** 相同壁纸合并待决解码、复用最近图片、不重播淡入，失败可重新尝试。 */
import assert from 'node:assert/strict';
import { launchSession, waitFor } from './helpers.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=','base64');
const {server,chrome,evalJS}=await launchSession(0,{'/reuse-wallpaper.png':(req,res)=>{
    res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});res.end(png);
}});
try {
    await evalJS(`(() => {
        window.reuseDecodeDescriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'decode');
        window.reuseSrcDescriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
        window.reuseLoads=[];window.reuseDecodes=[];window.reusePending=new Map();
        Object.defineProperty(HTMLImageElement.prototype,'src',{...reuseSrcDescriptor,set:function(value){
            if(String(value).includes('/reuse-wallpaper.png'))reuseLoads.push(value);
            return reuseSrcDescriptor.set.call(this,value);
        }});
        Object.defineProperty(HTMLImageElement.prototype,'decode',{configurable:true,value:function(){
            if(!this.src.includes('/reuse-wallpaper.png'))return reuseDecodeDescriptor.value.call(this);
            reuseDecodes.push(this.src);
            return new Promise((resolve,reject)=>reusePending.set(this.src,{resolve,reject}));
        }});
        window.reuseUrl=tag=>location.origin+'/reuse-wallpaper.png?'+tag;
        applyWallpaper(reuseUrl('shared'),true);
        applyWallpaper(reuseUrl('shared'),false);
    })()`);
    await waitFor(evalJS,'reusePending.has(reuseUrl("shared"))');
    assert.deepEqual(await evalJS('[reuseLoads.length,reuseDecodes.length]'),[1,1]);
    await evalJS('reusePending.get(reuseUrl("shared")).resolve()');
    await waitFor(evalJS,'dom.bgLayer.style.backgroundImage.includes("?shared")');
    assert.equal(await evalJS('dom.bgLayerNext.classList.contains("is-crossfading")'),false);
    assert.equal(await evalJS(`(() => {
        applyWallpaper(reuseUrl('shared'),true);applyWallpaper(reuseUrl('shared'),true);
        return reuseLoads.length===1 && reuseDecodes.length===1 && !dom.bgLayerNext.classList.contains('is-crossfading');
    })()`),true);
    console.log('✅ 同一壁纸待决调用仅加载／解码一次，已显示时不重播淡入');

    await evalJS('applyWallpaper(reuseUrl("fade"),true)');
    await waitFor(evalJS,'reusePending.has(reuseUrl("fade"))');
    await evalJS('reusePending.get(reuseUrl("fade")).resolve()');
    await waitFor(evalJS,'dom.bgLayerNext.classList.contains("is-crossfading") && dom.bgLayerNext.style.opacity === "1"');
    await evalJS('applyWallpaper(reuseUrl("fade"),true)');
    await waitFor(evalJS,'!dom.bgLayerNext.classList.contains("is-crossfading")');
    assert.equal(await evalJS('dom.bgLayer.style.backgroundImage.includes("?fade")'),true);
    assert.equal(await evalJS('reuseDecodes.filter(url=>url===reuseUrl("fade")).length'),1);
    console.log('✅ 重复应用正在淡入的壁纸不重启动画，原动画正常收尾');

    await evalJS('applyWallpaper(reuseUrl("retry"),false)');
    await waitFor(evalJS,'reusePending.has(reuseUrl("retry"))');
    await evalJS('reusePending.get(reuseUrl("retry")).reject(new Error("decode failed"))');
    await waitFor(evalJS,'dom.bgLayer.style.backgroundImage.includes("?fade")');
    // 让解码失败的微任务完成后再重试同一 URL。
    await evalJS('new Promise(resolve=>setTimeout(resolve,0))');
    await evalJS('applyWallpaper(reuseUrl("retry"),false)');
    await waitFor(evalJS,'reuseDecodes.filter(url=>url===reuseUrl("retry")).length===2');
    await evalJS('reusePending.get(reuseUrl("retry")).resolve()');
    await waitFor(evalJS,'dom.bgLayer.style.backgroundImage.includes("?retry")');
    console.log('✅ 解码失败保留当前壁纸，重试同一 URL 可成功完成');

    assert.equal(await evalJS(`(async () => {
        await commitWallpaperSelection(backgrounds[2]);
        const get=IDBObjectStore.prototype.get;
        let reads=0;
        IDBObjectStore.prototype.get=function(key){
            if(key===CONFIG.IDB.KEYS.SELECTION)reads++;
            return get.call(this,key);
        };
        try {await restoreWallpaper();return reads===1 && state.bg===2;}
        finally {IDBObjectStore.prototype.get=get;}
    })()`),true);
    console.log('✅ 已有现代选择记录时，壁纸恢复只读取一次 IndexedDB 记录');
} finally {
    try {await evalJS(`(() => {
        Object.defineProperty(HTMLImageElement.prototype,'decode',reuseDecodeDescriptor);
        Object.defineProperty(HTMLImageElement.prototype,'src',reuseSrcDescriptor);
    })()`);} finally {await chrome.close();await server.close();}
}

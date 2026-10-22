import assert from 'node:assert/strict';
import { parseOptions, summarize, measureTransition } from './benchmark-transition.mjs';
import { startServer } from './server.mjs';
import { launchChrome } from './cdp.mjs';
import { createEvaluator, getFreePort } from './helpers.mjs';

assert.equal(parseOptions([]).compare, null, '默认不访问线上');
assert.equal(parseOptions([]).throttle, 1, '默认使用原速 CPU，压力测试须显式选择');
assert.equal(parseOptions(['--native']).throttle, 1);
assert.throws(()=>parseOptions(['--rounds','0']));
assert.throws(()=>parseOptions(['--throttle','NaN']));
assert.throws(()=>parseOptions(['--compare','file:///tmp/a']));
assert.throws(()=>parseOptions(['--json']));
assert.deepEqual(summarize([
    { durationMs:100, frames:[10,10,30] },
    { durationMs:200, frames:[10,20] }
],10), {
    samples:2, durationMedianMs:100, durationP95Ms:200, frameP95Ms:30,
    maxFrameMs:30, slowIntervals:2, estimatedMissedFrames:3
});

// 构造先解除切屏锁、再淡入内容的页面，防止评测漏掉后一段动画。
const fixture = `<!doctype html><html><head><style>
#navContent { opacity:0; transition:opacity .2s linear }
body:not(.is-screen-transitioning) .screen-pushed-in #navContent { opacity:1 }
</style></head><body><div id="startSection"></div>
<div id="navSection"><div id="navContent">内容</div></div>
<script>document.addEventListener('keydown',()=>{
document.body.classList.add('is-screen-transitioning');
document.getElementById('startSection').classList.add('screen-pushed-up');
document.getElementById('navSection').classList.add('screen-pushed-in');
setTimeout(()=>document.body.classList.remove('is-screen-transitioning'),80);
});</script></body></html>`;
const server = await startServer(0,undefined,{'/fixture':fixture});
let chrome;
try {
    chrome = await launchChrome({ port:await getFreePort(), url:`http://127.0.0.1:${server.port}/fixture`, testMode:false });
    const evalJS = createEvaluator(chrome.send);
    const sample = await evalJS(`(${measureTransition.toString()})('nav')`);
    assert.ok(sample.durationMs >= 270, `必须覆盖锁解除后的 200ms 淡入：${sample.durationMs}`);
    assert.equal(await evalJS('Number(getComputedStyle(document.getElementById("navContent")).opacity)'),1);
    await assert.rejects(()=>evalJS(`(${measureTransition.toString()})('nav')`), /切屏起始状态不正确/);
    // 没有响应输入时必须超时失败，不能返回零耗时的假成功。
    await assert.rejects(()=>evalJS(`(${measureTransition.toString()})('start',150)`), /切屏超时/);
    console.log('✅ 参数与统计正确；测量覆盖锁解除后的淡入；错误状态和超时明确失败');
} finally {
    if (chrome) await chrome.close();
    await server.close();
}

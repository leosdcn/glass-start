#!/usr/bin/env node
/** 生产产物切屏帧间隔评测；默认只访问本地，完整口径见 docs/TRANSITION_BENCHMARK.md。 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';
import { launchChrome } from './cdp.mjs';
import { createEvaluator, getFreePort, navigateAndWait, sleep } from './helpers.mjs';

export function parseOptions(args) {
    const options = { rounds:5, throttle:1, compare:null, json:null, help:false };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help') options.help = true;
        else if (arg === '--native') options.throttle = 1;
        else if (['--rounds', '--throttle', '--compare', '--json'].includes(arg)) {
            const value = args[++i];
            if (!value || value.startsWith('--')) throw new Error(`${arg} 缺少参数`);
            if (arg === '--rounds') options.rounds = Number(value);
            if (arg === '--throttle') options.throttle = Number(value);
            if (arg === '--compare') options.compare = new URL(value).href;
            if (arg === '--json') options.json = value;
        } else throw new Error(`未知参数：${arg}`);
    }
    if (!Number.isInteger(options.rounds) || options.rounds < 1 || options.rounds > 50) throw new Error('--rounds 必须是 1–50 的整数');
    if (!Number.isFinite(options.throttle) || options.throttle < 1 || options.throttle > 20) throw new Error('--throttle 必须在 1–20 之间');
    if (options.compare && !/^https?:/.test(options.compare)) throw new Error('--compare 仅支持 HTTP(S)');
    return options;
}

export function percentile(values, fraction) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a,b) => a-b);
    return sorted[Math.max(0, Math.ceil(sorted.length * fraction)-1)];
}

export function summarize(samples, baselineMs) {
    const frames = samples.flatMap(sample => sample.frames);
    return {
        samples:samples.length,
        durationMedianMs:percentile(samples.map(sample=>sample.durationMs), 0.5),
        durationP95Ms:percentile(samples.map(sample=>sample.durationMs), 0.95),
        frameP95Ms:percentile(frames, 0.95),
        maxFrameMs:Math.max(0, ...frames),
        slowIntervals:frames.filter(ms=>ms > baselineMs*1.5).length,
        estimatedMissedFrames:frames.reduce((sum,ms)=>sum+Math.max(0,Math.round(ms/baselineMs)-1),0)
    };
}

// 在浏览器内序列化执行；以实际过渡和 opacity 判定结束，而非只看切屏锁。
export async function measureTransition(direction, timeoutMs = 10000) {
    const startSection = document.getElementById('startSection');
    const navSection = document.getElementById('navSection');
    const content = document.getElementById('navContent');
    const nodes = [startSection, navSection, content];
    const targetNav = direction === 'nav';
    if (!nodes.every(Boolean)) throw new Error('缺少切屏节点');
    if (startSection.classList.contains('screen-pushed-up') === targetNav) throw new Error('切屏起始状态不正确');
    return new Promise((resolveSample, reject) => {
        let frameId, timer, last, start, quiet = 0;
        const frames = [];
        const finish = error => {
            clearTimeout(timer);
            cancelAnimationFrame(frameId);
            if (error) reject(error);
            else resolveSample({ direction, durationMs:performance.now()-start, frames });
        };
        const tick = now => {
            frames.push(now-last);
            last = now;
            const reached = startSection.classList.contains('screen-pushed-up') === targetNav;
            let settled = false;
            if (reached && !document.body.classList.contains('is-screen-transitioning')) {
                // 只在收尾检查三个切屏节点，避免逐帧遍历全部书签及强制读取样式。
                const opacity = Number(getComputedStyle(content).opacity);
                const moving = nodes.some(node => node.getAnimations().some(animation =>
                    animation instanceof CSSTransition && (animation.pending || animation.playState === 'running')));
                settled = !moving && (!targetNav || opacity >= 0.999);
            }
            quiet = settled ? quiet+1 : 0;
            if (quiet >= 3) finish();
            else frameId = requestAnimationFrame(tick);
        };
        timer = setTimeout(()=>finish(new Error(`切屏超时：${direction}`)), timeoutMs);
        frameId = requestAnimationFrame(() => {
            start = last = performance.now();
            document.dispatchEvent(new KeyboardEvent('keydown', {
                key:targetNav ? 'ArrowDown' : 'ArrowUp', bubbles:true, cancelable:true
            }));
            frameId = requestAnimationFrame(tick);
        });
    });
}

async function benchmarkSite(url, options) {
    // 每个站点使用新的临时浏览器配置；不复用上一个版本的缓存与会话。
    const chrome = await launchChrome({ port:await getFreePort(), url:'about:blank', testMode:false, disableGPU:false });
    const { send } = chrome;
    const evalJS = createEvaluator(send);
    try {
        await send('Runtime.enable');
        await send('Network.enable');
        await send('Network.setBypassServiceWorker', { bypass:true });
        await send('Emulation.setDeviceMetricsOverride', { width:1920, height:1080, deviceScaleFactor:2, mobile:false });
        await send('Emulation.setCPUThrottlingRate', { rate:options.throttle });
        await send('Emulation.setEmulatedMedia', { features:[{ name:'prefers-reduced-motion', value:'no-preference' }] });
        await navigateAndWait(send, evalJS, url, '!!document.querySelector(".bookmark-item") && !!document.getElementById("navContent")', 30000);
        await evalJS('document.fonts.ready.then(()=>true)');
        const browser = await send('Browser.getVersion');
        const buildFingerprint = await evalJS('window.__GLASS_BUILD_APP__ || null');
        const baselineMs = await evalJS(`new Promise(resolve => {
            const intervals=[]; let last;
            const tick=now=>{if(last!==undefined) intervals.push(now-last); last=now;
                if(intervals.length===30) resolve(intervals.sort((a,b)=>a-b)[15]);
                else requestAnimationFrame(tick);}; requestAnimationFrame(tick);
        })`);
        const sample = direction => evalJS(`(${measureTransition.toString()})(${JSON.stringify(direction)})`);
        const firstEntry = await sample('nav');
        const firstReturn = await sample('start');
        const warmEntry = [], warmReturn = [];
        for (let round = 0; round < options.rounds; round++) {
            await sleep(150);
            warmEntry.push(await sample('nav'));
            warmReturn.push(await sample('start'));
        }
        const groups = { firstEntry:[firstEntry], firstReturn:[firstReturn], warmEntry, warmReturn };
        const summaries = Object.fromEntries(Object.entries(groups).map(([key,samples])=>[key,summarize(samples,baselineMs)]));
        return { url, browser, buildFingerprint, baselineMs, summaries, raw:groups };
    } finally { await chrome.close(); }
}

async function main() {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) {
        console.log('npm run benchmark -- [--rounds 5] [--throttle 4] [--compare URL] [--json PATH]（默认原速 CPU）');
        return;
    }
    const server = await startServer(0, undefined, {}, { testMode:false });
    try {
        const results = [];
        const urls = [`http://127.0.0.1:${server.port}/`, ...(options.compare ? [options.compare] : [])];
        for (const url of urls) {
            console.log(`评测 ${url}：1920×1080 @2x，CPU ${options.throttle}x，重复 ${options.rounds} 轮`);
            const result = await benchmarkSite(url, options);
            results.push(result);
            console.log(`基准帧间隔 ${result.baselineMs.toFixed(2)}ms；首次切入独立列出。`);
            console.table(Object.fromEntries(Object.entries(result.summaries).map(([key,values])=>[
                key, Object.fromEntries(Object.entries(values).map(([name,value])=>[name,Number(value.toFixed(2))]))
            ])));
        }
        const report = { timestamp:new Date().toISOString(), options,
            environment:'Headless Chrome with GPU allowed (actual acceleration not verified); rAF intervals, not physical presentation FPS; Service Worker bypassed', results };
        if (options.json) writeFileSync(options.json, JSON.stringify(report,null,2)+'\n');
        console.log('时长包含末尾连续 3 帧稳定确认；帧间隔与估算漏帧仅供同环境对照，不代表真实屏幕 FPS。');
    } finally { await server.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error=>{ console.error(error); process.exitCode=1; });
}

/** 重复入口共享请求，输入变化立即作废旧响应，重新定位保持刷新互斥。 */
import assert from 'node:assert/strict';
import { launchSession, waitFor } from './support/helpers.mjs';

const { server, chrome, send, evalJS } = await launchSession();
try {
    await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
        localStorage.setItem('glass_weather_cache', JSON.stringify({timestamp:Date.now(),current:{temp:20},daily:[]}));
    ` });
    await send('Page.reload');
    await waitFor(evalJS, 'typeof updateWeather === "function" && !isFetchingWeather');

    const jsonp = await evalJS(`(() => {
        const append = document.body.appendChild;
        let requests = 0;
        document.body.appendChild = function(node) {
            if (node.tagName === 'SCRIPT') { requests++; node.type = 'application/x-test'; }
            return append.call(this, node);
        };
        try {
            fetchSuggestions('bing', 'performance-pending');
            const node = dom.suggestionMenu.firstChild;
            const oldCallback = window['__glassSuggestCb_' + activeSuggestReqId];
            const id = activeSuggestReqId;
            fetchSuggestions('bing', ' performance-pending ');
            const shared = requests === 1 && id === activeSuggestReqId && node === dom.suggestionMenu.firstChild;
            state.engine = 'bing';
            dom.searchInput.value = ' performance-pending ';
            dom.searchInput.dispatchEvent(new Event('input', {bubbles:true}));
            const inputShared = requests === 1 && id === activeSuggestReqId && node === dom.suggestionMenu.firstChild && suggestionScriptTag?.isConnected;
            dom.searchInput.value = 'performance-new';
            dom.searchInput.dispatchEvent(new Event('input', {bubbles:true}));
            oldCallback(['old', ['stale-response']]);
            const staleDiscarded = !dom.suggestionMenu.textContent.includes('stale-response');
            hideSuggestions();

            fetchSuggestions('bing', 'performance-empty');
            window['__glassSuggestCb_' + activeSuggestReqId](['query', []]);
            const before = requests;
            fetchSuggestions('bing', 'performance-empty');
            const cachedEmpty = requests === before && !dom.suggestionMenu.classList.contains('active');
            // 即使下一个查询命中缓存，已清理的回调也不能再次覆盖它。
            fetchSuggestions('bing', 'performance-other');
            const stale = window['__glassSuggestCb_' + activeSuggestReqId];
            fetchSuggestions('bing', 'performance-empty');
            stale(['old', ['late-after-cache']]);
            return {shared, inputShared, staleDiscarded, cachedEmpty, cacheRaceDiscarded:!dom.suggestionMenu.classList.contains('active')};
        } finally { hideSuggestions(); document.body.appendChild = append; }
    })()`);
    assert.deepEqual(jsonp, {shared:true, inputShared:true, staleDiscarded:true, cachedEmpty:true, cacheRaceDiscarded:true});
    console.log('✅ JSONP 同查询只请求／渲染一次，输入防抖期间丢弃旧响应，空结果复用缓存');

    const selection = await evalJS(`(() => {
        const append = document.body.appendChild;
        document.body.appendChild = function(node) {
            if (node.tagName === 'SCRIPT') node.type = 'application/x-test';
            return append.call(this, node);
        };
        try {
            const begin = query => {
                dom.searchInput.value = query;
                dom.searchInput.dispatchEvent(new Event('input', {bubbles:true}));
                fetchSuggestions('bing', query);
            };
            begin('chat');
            dom.suggestionMenu.querySelector('.suggestion-item').dispatchEvent(new MouseEvent('mouseover', {bubbles:true}));
            const before = dom.searchInput.value;
            window['__glassSuggestCb_' + activeSuggestReqId](['chat',['chat result','chat other']]);
            const hoverPreserved = before === 'chat' && dom.searchInput.value === 'chat' &&
                dom.suggestionMenu.querySelector('[data-idx="0"]').classList.contains('active');
            const observer = new MutationObserver(()=>{});
            observer.observe(dom.suggestionMenu, {attributes:true, subtree:true});
            const item = dom.suggestionMenu.querySelector('[data-idx="0"]');
            for (let i=0; i<30; i++) item.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
            const repeatedWrites = observer.takeRecords().length;
            dom.suggestionMenu.querySelector('[data-idx="1"]').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
            const changedWrites = observer.takeRecords().length;
            observer.disconnect();
            const uniqueSelection = dom.suggestionMenu.querySelectorAll('[aria-selected="true"]').length === 1;
            hideSuggestions();

            begin('chatg');
            dom.searchInput.focus();
            dom.searchInput.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
            const keyboardValue = dom.searchInput.value;
            window['__glassSuggestCb_' + activeSuggestReqId](['chatg',['chatg result']]);
            const keyboardPreserved = keyboardValue !== 'chatg' && dom.searchInput.value === keyboardValue &&
                dom.suggestionMenu.querySelector('[data-idx="0"]').classList.contains('active');
            dom.searchInput.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
            return {hoverPreserved,repeatedWrites,changedWrites,uniqueSelection,keyboardPreserved,escaped:dom.searchInput.value === 'chatg'};
        } finally { hideSuggestions(); document.body.appendChild = append; }
    })()`);
    assert.deepEqual(selection, {hoverPreserved:true,repeatedWrites:0,changedWrites:4,uniqueSelection:true,keyboardPreserved:true,escaped:true});
    console.log('✅ 网络返回保留鼠标原查询与键盘填词；同项重复悬停零写入，换项只更新两个节点');

    const cors = await evalJS(`(async () => {
        const original = window.fetch;
        const requests = [];
        window.fetch = (url, options) => new Promise(resolve => requests.push({url, options, resolve}));
        try {
            fetchSuggestions('wikipedia', 'performance-cors');
            const node = dom.suggestionMenu.firstChild;
            fetchSuggestions('wikipedia', 'performance-cors');
            const shared = requests.length === 1 && !requests[0].options.signal.aborted && node === dom.suggestionMenu.firstChild;
            requests[0].resolve({ok:true,json:async()=>['query',['shared-result']]});
            await new Promise(resolve => setTimeout(resolve, 0));
            const shown = dom.suggestionMenu.textContent.includes('shared-result');
            const completedNode = dom.suggestionMenu.firstChild;
            fetchSuggestions('wikipedia', 'performance-cors');
            const cachedNodes = requests.length === 1 && completedNode === dom.suggestionMenu.firstChild;
            fetchSuggestions('wikipedia', 'performance-cancel');
            hideSuggestions();
            return {shared, shown, cachedNodes, aborted:requests[1].options.signal.aborted};
        } finally { window.fetch = original; hideSuggestions(); }
    })()`);
    assert.deepEqual(cors, {shared:true, shown:true, cachedNodes:true, aborted:true});
    console.log('✅ Wikipedia 同查询共享请求，命中相同缓存复用节点，关闭仍中止未决请求');

    await evalJS(`(() => {
        window.performanceOriginalFetch = window.fetch;
        window.performanceWeatherRequests = [];
        const oldLoc = {name:'旧地点',lat:31,lon:121,timestamp:1};
        storageSet(CONFIG.KEYS.WEATHER_LOC, oldLoc);
        storageSet(CONFIG.KEYS.WEATHER_CACHE, {timestamp:1,location:oldLoc,current:{temp:20},daily:[]});
        window.fetch = async url => {
            performanceWeatherRequests.push(url);
            if (url.includes('myip.ipip.net')) return new Promise(resolve => { window.resolvePerformanceLocation = resolve; });
            if (url.includes('geocoding-api')) return {ok:true,json:async()=>({results:[{country:'中国',admin1:'上海市',name:'上海',latitude:32,longitude:122}]})};
            if (url.includes('/forecast?')) return {ok:true,json:async()=>({
                current:{temperature_2m:url.includes('latitude=32&') ? 29 : 21,weather_code:0,is_day:1},daily:{}
            })};
            throw new Error('Unexpected weather URL: ' + url);
        };
        window.performanceWeatherUpdate = updateWeather(false);
    })()`);
    await waitFor(evalJS, 'storageGet(CONFIG.KEYS.WEATHER_CACHE).current.temp === 21');
    const pending = await evalJS(`({busy:isFetchingWeather, shared:updateWeather(true) === performanceWeatherUpdate,
        forecasts:performanceWeatherRequests.filter(url=>url.includes('/forecast?')).length})`);
    assert.deepEqual(pending, {busy:true, shared:true, forecasts:1});
    await evalJS(`(async () => {
        resolvePerformanceLocation({ok:true,json:async()=>({ret:'ok',data:{location:['中国','上海市','上海市']}})});
        await performanceWeatherUpdate;
    })()`);
    assert.deepEqual(await evalJS(`({busy:isFetchingWeather, temp:storageGet(CONFIG.KEYS.WEATHER_CACHE).current.temp,
        forecasts:performanceWeatherRequests.filter(url=>url.includes('/forecast?')).length})`), {busy:false,temp:29,forecasts:2});
    assert.equal(await evalJS(`(async () => {
        let failures = 0;
        window.fetch = async () => { failures++; throw new Error('offline'); };
        storageSet(CONFIG.KEYS.WEATHER_CACHE, {...storageGet(CONFIG.KEYS.WEATHER_CACHE),timestamp:1});
        try { await updateWeather(false); await updateWeather(false); return failures === 2 && !isFetchingWeather; }
        finally { window.fetch = performanceOriginalFetch; }
    })()`), true);
    console.log('✅ 天气先显示旧地点预报，重新定位全程共享刷新任务，新地点仅请求一次，失败后可重试');
} finally {
    await chrome.close();
    await server.close();
}

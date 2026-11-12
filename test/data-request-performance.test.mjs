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
            const cacheRaceDiscarded = !dom.suggestionMenu.classList.contains('active');
            fetchSuggestions('bing', 'performance-malformed');
            window['__glassSuggestCb_' + activeSuggestReqId]({error:'temporary'});
            const beforeRetry = requests;
            fetchSuggestions('bing', 'performance-malformed');
            const malformedRetried = requests === beforeRetry + 1;
            window['__glassSuggestCb_' + activeSuggestReqId](['query', ['restored suggestion']]);
            const retryRendered = dom.suggestionMenu.textContent.includes('restored suggestion');
            return {shared, inputShared, staleDiscarded, cachedEmpty, cacheRaceDiscarded, malformedRetried, retryRendered};
        } finally { hideSuggestions(); document.body.appendChild = append; }
    })()`);
    assert.deepEqual(jsonp, {shared:true, inputShared:true, staleDiscarded:true, cachedEmpty:true,
        cacheRaceDiscarded:true, malformedRetried:true, retryRendered:true});
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
            const keyboardPreserved = keyboardValue === 'chatg' && dom.searchInput.value === keyboardValue &&
                dom.suggestionMenu.querySelector('[data-idx="0"]').classList.contains('active');
            dom.searchInput.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
            const escaped = dom.searchInput.value === 'chatg';

            begin('git');
            dom.searchInput.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
            const highlighted = dom.suggestionMenu.querySelector('.suggestion-item.active')?.textContent.includes('GitHub');
            dom.engineBtn.click();
            document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
            dom.engineBtn.click();
            dom.dropdownMenu.querySelector('[data-engine="google"]').click();
            const engineQuery = new URL(suggestionScriptTag.src).searchParams.get('q');
            return {hoverPreserved,repeatedWrites,changedWrites,uniqueSelection,keyboardPreserved,escaped,
                highlighted, engineQuery, text: dom.searchInput.value};
        } finally { hideSuggestions(); document.body.appendChild = append; }
    })()`);
    assert.deepEqual(selection, {hoverPreserved:true,repeatedWrites:0,changedWrites:4,uniqueSelection:true,keyboardPreserved:true,escaped:true,
        highlighted:true, engineQuery:'git', text:'git'});
    console.log('✅ 网络返回保留原查询与键盘选中项，重复悬停零写入，换项只更新两个节点');

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

    await send('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion', value:'no-preference'}] });
    const loading = await evalJS(`(async () => {
        const originalFetch = window.fetch;
        const originalEngine = state.engine;
        const { searchInput, suggestionMenu } = dom;
        const originalValue = searchInput.value;
        const requestStarted = new Promise(started => {
            window.fetch = () => new Promise(resolve => started(resolve));
        });
        try {
            state.engine = 'wikipedia';
            searchInput.value = 'github';
            searchInput.dispatchEvent(new Event('input', { bubbles:true }));
            const local = suggestionMenu.querySelector('.suggestion-item[data-url]');
            const networkGroup = suggestionMenu.lastElementChild;
            const skeleton = networkGroup?.querySelector(':scope > [aria-hidden="true"]');
            const initialHeight = suggestionMenu.offsetHeight;
            const respond = await requestStarted;
            const pendingHeight = suggestionMenu.offsetHeight;
            const sameSkeleton = !!skeleton?.isConnected;
            respond({ok:true,json:async()=>['github',['github docs','github topics','github status']]});
            await new Promise(resolve => setTimeout(resolve, 0));
            const resultHeight = suggestionMenu.offsetHeight;
            const localKept = !!local?.isConnected;
            const networkShown = networkGroup?.textContent.includes('github docs');
            const waitForTransitions = () => Promise.allSettled(suggestionMenu.getAnimations().map(animation => animation.finished));
            const input = value => {
                searchInput.value = value;
                searchInput.dispatchEvent(new Event('input', { bubbles:true }));
            };
            await waitForTransitions();
            input('');
            const closingHeight = suggestionMenu.offsetHeight;
            const collapsed = searchInput.getAttribute('aria-expanded') === 'false' &&
                suggestionMenu.getAttribute('aria-hidden') === 'true' && getComputedStyle(suggestionMenu).pointerEvents === 'none';
            await waitForTransitions();
            const cleared = !suggestionMenu.querySelector('.suggestion-item');

            input('github');
            await waitForTransitions();
            input('');
            const exiting = waitForTransitions();
            input('github');
            await exiting;
            const reopened = suggestionMenu.classList.contains('active') && !!suggestionMenu.querySelector('.suggestion-item[data-url]');
            return { initialHeight, pendingHeight, resultHeight, sameSkeleton, localKept, networkShown,
                closingHeight, collapsed, cleared, reopened };
        } finally {
            hideSuggestions();
            window.fetch = originalFetch;
            state.engine = originalEngine;
            searchInput.value = originalValue;
        }
    })()`);
    assert.ok(loading.sameSkeleton && loading.localKept && loading.networkShown, JSON.stringify(loading));
    assert.equal(loading.initialHeight, loading.pendingHeight);
    assert.equal(loading.pendingHeight, loading.resultHeight);
    assert.equal(loading.closingHeight, loading.resultHeight);
    assert.ok(loading.collapsed && loading.cleared && loading.reopened, JSON.stringify(loading));

    const editedSuggestion = await evalJS(`(async () => {
        const originalFetch = window.fetch;
        const originalBookmarks = pageData.bookmarks;
        window.fetch = async () => ({ok:true,json:async()=>['rename-check',[]]});
        try {
            pageData.bookmarks = [{name:'原名称',url:'https://rename-check.test',desc:'原简介',icon:'./icons/github.com.png'}];
            fetchSuggestions('wikipedia','rename-check');
            await new Promise(resolve => setTimeout(resolve, 0));
            const originalNode = dom.suggestionMenu.querySelector('.suggestion-item');
            hideSuggestions();
            pageData.bookmarks = [{...pageData.bookmarks[0],name:'新名称',desc:'新简介',icon:'./icons/youtube.com.png'}];
            fetchSuggestions('wikipedia','rename-check');
            const node = dom.suggestionMenu.querySelector('.suggestion-item');
            return {updated:node.textContent.includes('新名称') && node.textContent.includes('新简介')
                && node.querySelector('img').getAttribute('src') === './icons/youtube.com.png',
                replaced:node !== originalNode};
        } finally { hideSuggestions(); window.fetch = originalFetch; pageData.bookmarks = originalBookmarks; }
    })()`);
    assert.deepEqual(editedSuggestion, {updated:true,replaced:true});

    const paths = await evalJS(`(async () => {
        const original = window.fetch;
        window.fetch = async () => ({ok:true,json:async()=>['verifyPath',[]]});
        try {
            const records = [
                { name:'VerifyPath A', url:'https://docs.example.test/Docs/A', icon:'./icons/github.com.png' },
                { name:'VerifyPath B', url:'https://docs.example.test/docs/a', icon:'./icons/github.com.png' }
            ];
            saveUserBookmarks(records);
            loadBookmarks();
            fetchSuggestions('wikipedia','verifypath');
            return [...dom.suggestionMenu.querySelectorAll('.suggestion-item[data-url]')].map(node => node.dataset.url);
        } finally { hideSuggestions(); window.fetch = original; }
    })()`);
    assert.deepEqual(paths, ['https://docs.example.test/Docs/A','https://docs.example.test/docs/a']);

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
    await waitFor(evalJS, 'dom.weatherTemp.textContent === "21°"');
    assert.equal(await evalJS('storageGet(CONFIG.KEYS.WEATHER_CACHE).current.temp'), 20);
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
    const zeroCoordinates = await evalJS(`(async () => {
        const originalFetch = window.fetch;
        const requests = [];
        const location = {name:'赤道', fullName:'赤道', lat:0, lon:0, language:'zh-CN', timestamp:Date.now()};
        const forecast = {current:{temperature_2m:26,weather_code:0}, daily:{}};
        try {
            window.fetch = async url => {
                requests.push(url);
                if (url.includes('/forecast?')) return {ok:true,json:async()=>forecast};
                throw new Error('location offline');
            };
            storageSet(CONFIG.KEYS.WEATHER_LOC, location);
            storageSet(CONFIG.KEYS.WEATHER_CACHE, {timestamp:1,location,current:{temp:20},daily:[]});
            await updateWeather(false);
            const cached = requests.length === 1 && requests[0].includes('latitude=0&longitude=0&')
                && storageGet(CONFIG.KEYS.WEATHER_CACHE).current.temp === 26;

            requests.length = 0;
            await updateWeather(true);
            const fallback = requests.some(url => url.includes('latitude=0&longitude=0&'));

            storageRemove(CONFIG.KEYS.WEATHER_LOC);
            storageRemove(CONFIG.KEYS.WEATHER_CACHE);
            requests.length = 0;
            window.fetch = async url => {
                requests.push(url);
                if (url.includes('/forecast?')) return {ok:true,json:async()=>forecast};
                if (url.includes('ipwho.is')) return {ok:true,json:async()=>({success:true,latitude:0,longitude:0,city:'赤道'})};
                throw new Error('primary location offline');
            };
            await updateWeather(true);
            const located = storageGet(CONFIG.KEYS.WEATHER_CACHE)?.location;
            return {cached, fallback, located:located?.lat === 0 && located?.lon === 0
                && requests.some(url => url.includes('latitude=0&longitude=0&'))};
        } finally { window.fetch = originalFetch; }
    })()`);
    assert.deepEqual(zeroCoordinates, {cached:true, fallback:true, located:true});
    console.log('✅ 零经纬度可复用缓存、定位失败时回退，并接受 IP 定位返回的零坐标');

    await evalJS(`(() => {
        window.resetWeatherOriginalFetch = window.fetch;
        const old = {name:'重置前地点',lat:1,lon:2,timestamp:1};
        storageSet(CONFIG.KEYS.WEATHER_LOC, old);
        storageSet(CONFIG.KEYS.WEATHER_CACHE,{timestamp:1,location:old,current:{temp:22},daily:[]});
        renderWeatherCapsule(storageGet(CONFIG.KEYS.WEATHER_CACHE));
        renderWeatherPopover(storageGet(CONFIG.KEYS.WEATHER_CACHE));
        window.fetch = async (url, {signal}) => {
            if (url.includes('/forecast?')) return {ok:false,status:503};
            if (url.includes('myip.ipip.net')) return {ok:false,status:503};
            if (url.includes('ipwho.is')) return new Promise(resolve => {
                window.resetWeatherSignal = signal;
                window.releaseOldLocation = () => resolve({ok:true,json:async()=>({success:true,city:'迟到地点',latitude:40,longitude:50})});
            });
            throw new Error('Unexpected URL: ' + url);
        };
        window.oldWeatherTask = updateWeather(false);
    })()`);
    await waitFor(evalJS, '!!window.releaseOldLocation');
    await evalJS(`(async () => { await openEditModal(); resetBookmarks(); dom.confirmOkBtn.click(); })()`);
    await waitFor(evalJS, '!state.editOpen && resetWeatherSignal.aborted');
    const empty = `!isFetchingWeather && !storageGet(CONFIG.KEYS.WEATHER_LOC) && !storageGet(CONFIG.KEYS.WEATHER_CACHE)
        && dom.weatherTemp.textContent === '--°' && !dom.weatherPopover.textContent.includes('重置前地点')`;
    assert.equal(await evalJS(empty), true);
    await evalJS(`(async () => { releaseOldLocation(); await oldWeatherTask; })()`);
    assert.equal(await evalJS(empty), true);
    await evalJS('window.fetch = resetWeatherOriginalFetch');
    console.log('✅ 恢复默认立即清空天气，旧定位返回后也不能回写或复原界面');
} finally {
    await chrome.close();
    await server.close();
}

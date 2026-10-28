import { t, getLocale, weatherDescription, forecastLabel } from '../core/i18n.js';
import { weatherTime, formatLocationFullName, stripAdminSuffix, normalizeWeatherForecast } from '../utils/weather-model.js';
export { weatherTime, formatLocationFullName } from '../utils/weather-model.js';
import { CONFIG } from '../config/constants.js';
import { weatherNum } from '../utils/weather-data.js';
export { weatherNum } from '../utils/weather-data.js';
import { escapeHtml, safeUrl, storageGet, storageSet, storageRemove } from '../utils/helpers.js';
import { dom } from '../state/dom.js';
import { OverlayStack } from '../core/overlay-stack.js';

import { WEATHER_EMOJI_MAP } from '../config/weather-icons.js';

/**
 * 将天气 Emoji 或本地图片映射为渲染用 HTML
 * @param {string} icon - Emoji 符号或图片路径
 * @param {string} [className='size-4'] - CSS 尺寸与样式类
 * @returns {string} 渲染的安全 HTML 字符串
 */
function getWeatherIconHTML(icon, className = 'size-4') {
    if (!icon) return '';
    const clean = typeof icon === 'string' ? icon.trim() : '';
    const path = WEATHER_EMOJI_MAP[clean] || (clean.startsWith('./') || clean.startsWith('/') || clean.endsWith('.svg') ? clean : null);
    if (path) {
        return `<img src="${safeUrl(path)}" class="${className} shrink-0 object-contain select-none inline-block align-middle pointer-events-none" alt="" aria-hidden="true" decoding="async"><span class="sr-only">${escapeHtml(clean)}</span>`;
    }
    return escapeHtml(icon);
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 */
async function fetchJsonWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => { try { controller.abort(); } catch {} }, timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`Weather request failed: HTTP ${response.status}`);
        // 超时覆盖正文读取；收到响应头后仍可能停在 json()。
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

export function openWeatherPopover() {
    const popover = dom.weatherPopover;
    const btn = dom.weatherBtn;
    if (!popover || !btn) return;
    if (!popover.innerHTML.trim()) {
        renderWeatherPopover(null);
    }
    popover.classList.add('active');
    popover.setAttribute('aria-hidden', 'false');
    btn.setAttribute('aria-expanded', 'true');
    OverlayStack.push('weatherPopover', closeWeatherPopover);
}

export function closeWeatherPopover() {
    const popover = dom.weatherPopover;
    const btn = dom.weatherBtn;
    if (!popover || !btn) return;
    OverlayStack.pop('weatherPopover');
    popover.classList.remove('active');
    popover.setAttribute('aria-hidden', 'true');
    btn.setAttribute('aria-expanded', 'false');
}

export function toggleWeatherPopover() {
    const popover = dom.weatherPopover;
    if (!popover) return;
    if (popover.classList.contains('active')) {
        closeWeatherPopover();
    } else {
        openWeatherPopover();
    }
}

/** @type {Promise<import('../types').WeatherLocation> | null} */
let inFlightLocationPromise = null;

async function resolveWeatherLocation(force = false) {
    const locCache = storageGet(CONFIG.KEYS.WEATHER_LOC, null);
    const now = Date.now();
    const LOC_TTL = CONFIG.WEATHER.LOC_TTL;
    if (!force && locCache && locCache.timestamp && (now - locCache.timestamp < LOC_TTL) && locCache.lat && (locCache.language || 'zh-CN') === getLocale()) {
        return locCache;
    }
    if (inFlightLocationPromise) return inFlightLocationPromise;
    inFlightLocationPromise = (async () => {
        try {
            return await executeResolveWeatherLocation(now);
        } finally {
            inFlightLocationPromise = null;
        }
    })();
    return inFlightLocationPromise;
}

/**
 * @param {number} now
 * @returns {Promise<import('../types').WeatherLocation>}
 */
async function executeResolveWeatherLocation(now) {

    if (getLocale() !== 'en') {
        try {
            const ipData = await fetchJsonWithTimeout('https://myip.ipip.net/json', CONFIG.WEATHER.TIMEOUT_IP);
            if (ipData?.ret === 'ok' && Array.isArray(ipData.data?.location)) {
                const locArr = ipData.data.location;
                const country = locArr[0] || '中国';
                const province = locArr[1] || '';
                const rawCity = locArr[2] || locArr[3] || province;
                const cleanCity = stripAdminSuffix(rawCity);
                const cleanProv = stripAdminSuffix(province, true);

                if (cleanCity) {
                    try {
                        const queryName = (cleanCity === cleanProv && !rawCity.endsWith('省')) ? `${cleanCity}市` : cleanCity;
                        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(queryName)}&language=zh&count=10`;
                        const geoData = await fetchJsonWithTimeout(geoUrl, CONFIG.WEATHER.TIMEOUT_IP);
                        const results = geoData?.results || [];
                        let matched = results.find((/** @type {any} */ r) => {
                            const matchCountry = !country || (r.country && (r.country.includes(country) || country.includes(r.country)));
                            const matchProv = !cleanProv || (r.admin1 && (r.admin1.includes(cleanProv) || cleanProv.includes(r.admin1))) || (r.name && r.name.includes(cleanProv));
                            return matchCountry && matchProv;
                        });

                        if (!matched && cleanProv && cleanProv !== cleanCity) {
                            try {
                                const provUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cleanProv)}&language=zh&count=5`;
                                const provData = await fetchJsonWithTimeout(provUrl, CONFIG.WEATHER.TIMEOUT_IP);
                                if (provData?.results?.[0]) {
                                    matched = provData.results[0];
                                }
                            } catch {}
                        }

                        if (!matched && results.length > 0) matched = results[0];

                        if (matched) {
                            const dispName = (matched.name || cleanCity).replace(/(市|区|县)$/, '') || matched.name || cleanCity;
                            const fullName = formatLocationFullName([matched.country || country, matched.admin1 || province, matched.admin2, matched.name || cleanCity]);
                            const resolved = {
                                name: dispName,
                                fullName: fullName,
                                lat: matched.latitude,
                                lon: matched.longitude,
                                isAuto: true,
                                language: getLocale(),
                                timestamp: now
                            };
                            storageSet(CONFIG.KEYS.WEATHER_LOC, resolved);
                            return resolved;
                        }
                    } catch {}
                }
            }
        } catch {}
    }

    try {
        const data = await fetchJsonWithTimeout(`https://ipwho.is/?lang=${getLocale() === 'en' ? 'en' : 'zh-CN'}`, CONFIG.WEATHER.TIMEOUT_IP);
        if (data?.success && data.latitude) {
            const rawCity = data.city || '';
            const rawRegion = data.region || '';
            const city = rawCity || rawRegion || t('ui.local');
            const dispName = getLocale() === 'zh-CN' ? city.replace(/(市|区|县)$/, '') || city : city;
            const fullName = formatLocationFullName([data.country, data.region, data.city]);
            const resolved = {
                name: dispName,
                fullName: fullName,
                lat: data.latitude,
                lon: data.longitude,
                isAuto: true,
                language: getLocale(),
                timestamp: now
            };
            storageSet(CONFIG.KEYS.WEATHER_LOC, resolved);
            return resolved;
        }
    } catch {}

    const fallbackLoc = {
        name: CONFIG.WEATHER.FALLBACK_LOCATION.name,
        fullName: CONFIG.WEATHER.FALLBACK_LOCATION.fullName,
        lat: CONFIG.WEATHER.FALLBACK_LOCATION.lat,
        lon: CONFIG.WEATHER.FALLBACK_LOCATION.lon,
        isAuto: true,
        isFallback: true,
        language: getLocale(),
        timestamp: now
    };
    storageSet(CONFIG.KEYS.WEATHER_LOC, fallbackLoc);
    return fallbackLoc;
}

/** @param {import('../types').WeatherLocation} loc */
export async function fetchWeatherForecast(loc) {
    const lat = loc.lat;
    const lon = loc.lon;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max&timezone=auto`;
    const data = await fetchJsonWithTimeout(url, CONFIG.WEATHER.TIMEOUT_WEATHER);

    return normalizeWeatherForecast(data, loc, CONFIG.WEATHER, Date.now());
}

/** @param {import('../types').WeatherData | null | undefined} data */
export function renderWeatherCapsule(data) {
    const weatherWidget = dom.weatherWidget;
    if (!weatherWidget || !data || !data.current) return;
    const weatherIcon = dom.weatherIcon;
    const weatherTemp = dom.weatherTemp;
    const weatherCity = dom.weatherCity;
    const weatherBtn = dom.weatherBtn;
    const temperature = Math.round(weatherNum(data.current.temp, 0));

    if (weatherIcon) {
        const iconStr = data.current.icon || '';
        if (weatherIcon.dataset && (weatherIcon.dataset.icon !== iconStr || !weatherIcon.querySelector('img'))) {
            weatherIcon.dataset.icon = iconStr;
            weatherIcon.innerHTML = getWeatherIconHTML(iconStr, 'size-4 sm:size-4.5');
        } else if (!weatherIcon.dataset && weatherIcon.textContent !== iconStr) {
            weatherIcon.textContent = iconStr;
        }
    }
    if (weatherTemp) {
        const tempStr = `${temperature}°`;
        if (weatherTemp.textContent !== tempStr) weatherTemp.textContent = tempStr;
    }
    if (weatherCity) {
        const cityName = data.location?.name || t('ui.weather');
        if (weatherCity.textContent !== cityName) weatherCity.textContent = cityName;
        weatherCity.title = data.location?.fullName || '';
    }
    if (weatherBtn) {
        const cityName = data.location ? data.location.name : t('ui.weather');
        const weatherDesc = weatherDescription(data.current.weatherCode);
        const iconStr = data.current.icon ? `${data.current.icon} ` : '';
        const newLabel = t('weather.capsule', { icon: iconStr, temperature, city: cityName || t('ui.weather'), description: weatherDesc });
        if (weatherBtn.getAttribute('aria-label') !== newLabel) weatherBtn.setAttribute('aria-label', newLabel);
    }
}

let lastRenderedPopoverSignature = '';

function renderWeatherError() {
    lastRenderedPopoverSignature = 'error';
    const weatherPopover = dom.weatherPopover;
    if (!weatherPopover) return;
    weatherPopover.innerHTML = `
        <div class="p-4 text-center space-y-2 flex flex-col items-center justify-center select-none">
            <div class="flex items-center justify-center">${getWeatherIconHTML('📡', 'size-7')}</div>
            <div class="text-xs text-white/80 font-medium">${escapeHtml(t('ui.weather.unavailable'))}</div>
            <div class="text-2xs text-white/50 leading-relaxed">${escapeHtml(t('ui.check.your.connection.or.location.access'))}</div>
            <button id="weatherErrorRetryBtn" type="button" class="mt-1 px-3.5 py-1.5 bg-white/10 hover:bg-white/20 border border-white/15 text-xs rounded-xl text-white transition flex items-center justify-center gap-1.5 mx-auto active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
                ${getWeatherIconHTML('🔄', 'size-3.5')} ${escapeHtml(t('ui.reload'))}
            </button>
        </div>
    `;
    const retryBtn = /** @type {HTMLButtonElement | null} */ (weatherPopover.querySelector('#weatherErrorRetryBtn'));
    if (retryBtn) {
        retryBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            retryBtn.disabled = true;
            retryBtn.innerHTML = `${getWeatherIconHTML('🔄', 'size-3.5')} ${escapeHtml(t('ui.retrying'))}`;
            updateWeather(true);
        });
    }
}

/** @param {import('../types').WeatherData | null | undefined} data */
export function renderWeatherPopover(data) {
    const weatherPopover = dom.weatherPopover;
    if (!weatherPopover) return;
    if (!data || !data.current) {
        if (lastRenderedPopoverSignature === 'loading' && weatherPopover.innerHTML.trim()) return;
        lastRenderedPopoverSignature = 'loading';
        weatherPopover.innerHTML = `
            <div class="p-4 text-center flex flex-col items-center justify-center gap-2.5 select-none w-full">
                <div class="size-5 border-2 border-white/25 border-t-white rounded-full animate-spin"></div>
                <div class="space-y-0.5">
                    <div class="text-xs text-white/80 font-medium">${escapeHtml(t('ui.loading.weather'))}</div>
                    <div class="text-2xs text-white/45">${escapeHtml(t('ui.finding.your.location.and.updating.weather'))}</div>
                </div>
            </div>
        `;
        return;
    }

    const raw = data.current;
    const c = {
        ...raw,
        temp: Math.round(weatherNum(raw.temp, 0)),
        apparent: Math.round(weatherNum(raw.apparent, weatherNum(raw.temp, 0))),
        humidity: Math.round(weatherNum(raw.humidity, CONFIG.WEATHER.DEFAULT_HUMIDITY)),
        windSpeed: Math.round(weatherNum(raw.windSpeed, 0) * 10) / 10,
        icon: (typeof raw.icon === 'string' && raw.icon) ? raw.icon : '⛅',
        weatherText: raw.weatherCode !== undefined || getLocale() === 'en' ? weatherDescription(raw.weatherCode) : (typeof raw.weatherText === 'string' ? raw.weatherText : '')
    };
    const loc = /** @type {import('../types').WeatherLocation} */ (data.location || {});
    const days = (Array.isArray(data.daily) ? data.daily : []).filter(isWeatherRecord).map((/** @type {any} */ d, /** @type {number} */ index) => ({
        ...d,
        label: getLocale() === 'en' || d.weatherCode !== undefined ? forecastLabel(d.date, index) : (typeof d.label === 'string' ? d.label.slice(0, CONFIG.WEATHER.LABEL_MAX_CHARS) : ''),
        icon: (typeof d.icon === 'string' && d.icon) ? d.icon : '⛅',
        text: getLocale() === 'en' || d.weatherCode !== undefined ? weatherDescription(d.weatherCode) : (typeof d.text === 'string' ? d.text.slice(0, CONFIG.SECURITY.MAX_DESC_CHARS) : ''),
        tempMax: Math.round(weatherNum(d.tempMax, 0)),
        tempMin: Math.round(weatherNum(d.tempMin, 0))
    }));

    let sunIcon = '🌅';
    let sunLabel = t('ui.sunset.today');
    let sunTime = c.sunset || '--:--';
    try {
        const now = new Date();
        const nowMins = now.getHours() * 60 + now.getMinutes();
        const parseMins = (/** @type {unknown} */ str) => {
            if (!str || typeof str !== 'string' || !str.includes(':')) return null;
            const [h, m] = str.split(':').map(Number);
            return isNaN(h) || isNaN(m) ? null : h * 60 + m;
        };
        const riseTodayMins = parseMins(c.sunriseToday || c.sunrise);
        const setTodayMins = parseMins(c.sunsetToday || c.sunset);

        if (setTodayMins !== null && nowMins >= setTodayMins) {
            sunIcon = '🌄';
            sunLabel = t('ui.sunrise.tomorrow');
            sunTime = c.sunriseTomorrow || c.sunriseToday || c.sunrise || '--:--';
        } else if (riseTodayMins !== null && nowMins < riseTodayMins) {
            sunIcon = '🌄';
            sunLabel = t('ui.sunrise.today');
            sunTime = c.sunriseToday || c.sunrise || '--:--';
        } else {
            sunIcon = '🌅';
            sunLabel = t('ui.sunset.today');
            sunTime = c.sunsetToday || c.sunset || '--:--';
        }
    } catch (_) {}
    sunTime = weatherTime(sunTime);

    const popVal = Math.max(0, Math.min(100, c.pop !== undefined ? weatherNum(c.pop, 0) : (weatherNum(c.precipitation, 0) > 0 ? 100 : 0)));
    let popIcon = '🌂';
    if (popVal >= CONFIG.WEATHER.POP_HIGH_THRESHOLD) {
        popIcon = '☔️';
    } else if (popVal >= CONFIG.WEATHER.POP_MID_THRESHOLD) {
        popIcon = '☂️';
    }

    const humVal = c.humidity !== undefined ? c.humidity : CONFIG.WEATHER.DEFAULT_HUMIDITY;
    let humIcon = '💧';
    if (humVal < CONFIG.WEATHER.HUMIDITY_LOW_THRESHOLD) {
        humIcon = '🌵';
    } else if (humVal > CONFIG.WEATHER.HUMIDITY_HIGH_THRESHOLD) {
        humIcon = '💦';
    }

    const windVal = c.windSpeed !== undefined ? c.windSpeed : 0;
    let windIcon = '🍃';
    if (windVal >= CONFIG.WEATHER.WIND_HIGH_THRESHOLD) {
        windIcon = '🌪️';
    } else if (windVal >= CONFIG.WEATHER.WIND_MID_THRESHOLD) {
        windIcon = '🎏';
    }

    /** @type {(icon: string, label: string, val: string | number) => string} */
    const weatherCard = (icon, label, val) => `
        <div class="p-2 glass-subcard flex items-center gap-2">
            <span class="text-sm select-none">${icon}</span>
            <div class="min-w-0">
                <div class="text-2xs text-white/50 leading-tight">${label}</div>
                <div class="text-xs font-semibold text-white/90 leading-tight mt-0.5">${val}</div>
            </div>
        </div>
    `;

    const sig = JSON.stringify([loc.fullName || loc.name || '', c.temp, c.apparent,
        c.humidity, c.windSpeed, c.icon, c.weatherText, sunLabel, sunTime, popVal,
        days.slice(0, CONFIG.WEATHER.FORECAST_DISPLAY_DAYS)
            .map(d => [d.label, d.tempMin, d.tempMax, d.icon, d.text])]);
    if (sig === lastRenderedPopoverSignature && weatherPopover.innerHTML.trim()) return;
    lastRenderedPopoverSignature = sig;

    weatherPopover.innerHTML = `
        <div class="flex items-center justify-between pb-2.5 mb-3 border-b border-white/10">
            <div class="flex items-center gap-1.5 min-w-0 pr-2">
                <span class="text-xs text-white/50 shrink-0 flex items-center justify-center">${getWeatherIconHTML('📍', 'size-3.5')}</span>
                <span class="text-xs font-semibold text-white/90 truncate" title="${escapeHtml(loc.fullName || loc.name || '')}">${escapeHtml(loc.fullName || loc.name || '')}</span>
            </div>
            <button id="weatherRefreshBtn" type="button" class="size-7 apple-radius bg-white/5 hover:bg-white/15 text-white flex items-center justify-center glass-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none" title="${escapeHtml(t('ui.refresh.weather'))}" aria-label="${escapeHtml(t('ui.refresh.weather'))}">
                <svg class="size-3.5 opacity-70 hover:opacity-100 transition-opacity" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>
            </button>
        </div>

        <div class="flex items-center justify-between mb-3 px-1">
            <div class="flex items-center gap-3">
                <span class="text-3xl sm:text-4xl leading-none select-none shrink-0 flex items-center justify-center">${getWeatherIconHTML(c.icon, 'size-10 sm:size-12')}</span>
                <div>
                    <div class="text-2xl font-bold tracking-tight text-white leading-none">${c.temp}<span class="text-base font-normal text-white/70">°C</span></div>
                    <div class="text-xs text-white/75 mt-1">${escapeHtml(t('weather.summary', { description: c.weatherText, temperature: c.apparent }))}</div>
                </div>
            </div>
            ${days[0] ? `<div class="text-right text-xs text-white/60"><div>${escapeHtml(t('weather.high', { temperature: days[0].tempMax }))}</div><div class="mt-0.5">${escapeHtml(t('weather.low', { temperature: days[0].tempMin }))}</div></div>` : ''}
        </div>

        <div class="grid grid-cols-2 gap-2 mb-3">
            ${weatherCard(getWeatherIconHTML(humIcon, 'size-4'), t('ui.humidity'), c.humidity + '%')}
            ${weatherCard(getWeatherIconHTML(windIcon, 'size-4'), t('ui.wind.speed'), c.windSpeed + ' km/h')}
            ${weatherCard(getWeatherIconHTML(popIcon, 'size-4'), t('ui.rain.chance'), popVal + '%')}
            ${weatherCard(getWeatherIconHTML(sunIcon, 'size-4'), sunLabel, sunTime)}
        </div>

        <div class="space-y-1.5 pt-2 border-t border-white/10">
            <div class="flex items-center justify-between gap-2 px-1 mb-1">
                <span class="text-2xs text-white/50 font-medium">${escapeHtml(t('ui.upcoming.forecast'))}</span>
                <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" class="shrink-0 text-2xs text-white/50 hover:text-white/80 transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50" aria-label="${escapeHtml(t('ui.weather.data.open.meteo.opens.in'))}">
                    Open-Meteo
                </a>
            </div>
            ${days.slice(0, CONFIG.WEATHER.FORECAST_DISPLAY_DAYS).map((/** @type {any} */ d) => `
                <div class="flex items-center justify-between text-xs py-1 px-1.5 apple-radius hover:bg-white/5 transition-colors">
                    <span class="w-10 text-white/70 font-medium shrink-0">${escapeHtml(d.label)}</span>
                    <div class="flex items-center gap-2 flex-1 min-w-0 pl-7 sm:pl-8">
                        <span class="w-5 text-center select-none shrink-0 flex items-center justify-center">${getWeatherIconHTML(d.icon, 'size-4')}</span>
                        <span class="text-2xs text-white/60 truncate">${escapeHtml(d.text)}</span>
                    </div>
                    <span class="w-16 text-right tabular-nums text-white/80 shrink-0">${d.tempMin}° ~ ${d.tempMax}°</span>
                </div>
            `).join('')}
        </div>
    `;

    const refBtn = /** @type {HTMLButtonElement | null} */ (weatherPopover.querySelector('#weatherRefreshBtn'));
    if (refBtn) {
        refBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (refBtn.disabled) return;
            refBtn.disabled = true;
            refBtn.setAttribute('aria-busy', 'true');
            const svg = refBtn.querySelector('svg');
            if (svg) svg.classList.add('weather-spin');
            const startTime = Date.now();
            const MIN_SPIN_DURATION = CONFIG.WEATHER.MIN_SPIN_DURATION;
            updateWeather(true).finally(() => {
                const elapsed = Date.now() - startTime;
                const remaining = Math.max(0, MIN_SPIN_DURATION - elapsed);
                setTimeout(() => {
                    const currentPop = dom.weatherPopover;
                    const currentRefBtn = /** @type {HTMLButtonElement | null} */ (currentPop ? currentPop.querySelector('#weatherRefreshBtn') : null);
                    const currentSvg = currentRefBtn ? currentRefBtn.querySelector('svg') : null;
                    if (currentSvg) currentSvg.classList.remove('weather-spin');
                    if (currentRefBtn) {
                        currentRefBtn.disabled = false;
                        currentRefBtn.removeAttribute('aria-busy');
                    }
                }, remaining);
            });
        });
    }
}

export let isFetchingWeather = false;
/** @type {Promise<void> | null} */
let inFlightWeatherPromise = null;

const isWeatherRecord = (/** @type {any} */ value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** @param {import('../types').WeatherData} data */
function saveWeatherCache(data) {
    const { weatherText, ...current } = data.current;
    const daily = data.daily?.map(({ text, label, ...day }) => day);
    storageSet(CONFIG.KEYS.WEATHER_CACHE, { schemaVersion: 2, ...data, current, daily });
}

function readWeatherCache() {
    const cache = storageGet(CONFIG.KEYS.WEATHER_CACHE, null);
    if (!cache) return null;
    if (!isWeatherRecord(cache) || !isWeatherRecord(cache.current)
        || (cache.daily !== undefined && (!Array.isArray(cache.daily) || !cache.daily.every(isWeatherRecord)))) {
        storageRemove(CONFIG.KEYS.WEATHER_CACHE);
        return null;
    }
    return cache;
}

export function updateWeather(force = false) {
    if (!force && typeof document !== 'undefined' && document.hidden) return Promise.resolve();
    if (inFlightWeatherPromise) return inFlightWeatherPromise;
    const cache = readWeatherCache();
    const now = Date.now();
    const CACHE_TTL = CONFIG.WEATHER.CACHE_TTL;

    if (!force && cache && cache.timestamp && (now - cache.timestamp < CACHE_TTL) && (cache.location?.language || 'zh-CN') === getLocale()) {
        renderWeatherCapsule(cache);
        renderWeatherPopover(cache);
        return Promise.resolve();
    }

    isFetchingWeather = true;
    inFlightWeatherPromise = executeWeatherUpdate(cache, force).finally(() => {
        isFetchingWeather = false;
        inFlightWeatherPromise = null;
    });
    return inFlightWeatherPromise;
}

/** @param {import('../types').WeatherData | null} cache
 * @param {boolean} force
 */
async function executeWeatherUpdate(cache, force) {
    try {
        const locCache = storageGet(CONFIG.KEYS.WEATHER_LOC, null);
        const knownLoc = (locCache && locCache.lat) ? locCache : (cache && cache.location && cache.location.lat ? cache.location : null);

        if (knownLoc && !force) {
            const forecastPromise = fetchWeatherForecast(knownLoc);
            const locationPromise = resolveWeatherLocation(false);

            const freshData = await forecastPromise;
            saveWeatherCache(freshData);
            renderWeatherCapsule(freshData);
            renderWeatherPopover(freshData);

            // 先显示已知地点的预报，同时让整个重新定位过程保留在同一刷新任务中。
            // 否则唤醒或手动刷新会与游离的重新定位回调重复请求、交错覆盖结果。
            const newLoc = await locationPromise;
            if (newLoc && (Math.abs(newLoc.lat - knownLoc.lat) > CONFIG.WEATHER.LOCATION_DRIFT_THRESHOLD || Math.abs(newLoc.lon - knownLoc.lon) > CONFIG.WEATHER.LOCATION_DRIFT_THRESHOLD || newLoc.name !== knownLoc.name || newLoc.fullName !== knownLoc.fullName)) {
                try {
                    const relocatedData = await fetchWeatherForecast(newLoc);
                    saveWeatherCache(relocatedData);
                    renderWeatherCapsule(relocatedData);
                    renderWeatherPopover(relocatedData);
                } catch {}
            }
        } else {
            const loc = await resolveWeatherLocation(force);
            const freshData = await fetchWeatherForecast(loc);
            saveWeatherCache(freshData);
            renderWeatherCapsule(freshData);
            renderWeatherPopover(freshData);
        }
    } catch (err) {
        if (cache) {
            renderWeatherCapsule(cache);
            renderWeatherPopover(cache);
        } else {
            const weatherCity = dom.weatherCity;
            if (weatherCity) weatherCity.textContent = t('ui.no.data');
            renderWeatherError();
        }
    }
}

export function initWeather() {
    const cache = readWeatherCache();
    if (cache) {
        renderWeatherCapsule(cache);
        renderWeatherPopover(cache);
    } else {
        renderWeatherPopover(null);
    }

    updateWeather(false).catch(() => {});
    setInterval(() => updateWeather(false), CONFIG.WEATHER.CACHE_TTL);
}

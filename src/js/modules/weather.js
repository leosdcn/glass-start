/** IP 定位与天气请求、缓存恢复、指标图标及预报渲染。 */
import { weatherTime, formatLocationFullName, stripAdminSuffix, normalizeWeatherForecast } from '../utils/weather-model.js';
export { WMO_WEATHER_MAP, weatherTime, formatLocationFullName, stripAdminSuffix } from '../utils/weather-model.js';
import { CONFIG } from '../config/constants.js';
import { weatherNum } from '../utils/weather-data.js';
export { weatherNum } from '../utils/weather-data.js';
import { escapeHtml, safeUrl, storageGet, storageSet, storageRemove } from '../utils/helpers.js';
import { dom, $ } from '../state/dom.js';
import { OverlayStack } from '../core/overlay-stack.js';

import { WEATHER_EMOJI_MAP } from '../config/weather-icons.js';
export { WEATHER_EMOJI_MAP };

/**
 * 将天气 Emoji 或本地图片映射为渲染用 HTML
 * @param {string} icon - Emoji 符号或图片路径
 * @param {string} [className='size-4'] - CSS 尺寸与样式类
 * @returns {string} 渲染的安全 HTML 字符串
 */
export function getWeatherIconHTML(icon, className = 'size-4') {
    if (!icon) return '';
    const clean = typeof icon === 'string' ? icon.trim() : '';
    const path = WEATHER_EMOJI_MAP[clean] || (clean.startsWith('./') || clean.startsWith('/') || clean.endsWith('.svg') ? clean : null);
    if (path) {
        return `<img src="${safeUrl(path)}" class="${className} shrink-0 object-contain select-none inline-block align-middle pointer-events-none" alt="" aria-hidden="true" loading="lazy" decoding="async"><span class="sr-only">${escapeHtml(clean)}</span>`;
    }
    return escapeHtml(icon);
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 */
export async function fetchWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => { try { controller.abort(); } catch {} }, timeoutMs);
    try {
        return await fetch(url, { signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

export function openWeatherPopover() {
    const popover = dom.weatherPopover || $('weatherPopover');
    const btn = dom.weatherBtn || $('weatherBtn');
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
    const popover = dom.weatherPopover || $('weatherPopover');
    const btn = dom.weatherBtn || $('weatherBtn');
    if (!popover || !btn) return;
    OverlayStack.pop('weatherPopover');
    popover.classList.remove('active');
    popover.setAttribute('aria-hidden', 'true');
    btn.setAttribute('aria-expanded', 'false');
}

export function toggleWeatherPopover() {
    const popover = dom.weatherPopover || $('weatherPopover');
    if (!popover) return;
    if (popover.classList.contains('active')) {
        closeWeatherPopover();
    } else {
        openWeatherPopover();
    }
}

export async function resolveWeatherLocation(force = false) {
    const locCache = storageGet(CONFIG.KEYS.WEATHER_LOC, null);
    const now = Date.now();
    const LOC_TTL = CONFIG.WEATHER.LOC_TTL;
    if (!force && locCache && locCache.timestamp && (now - locCache.timestamp < LOC_TTL) && locCache.lat) {
        return locCache;
    }

    try {
        const ipRes = await fetchWithTimeout('https://myip.ipip.net/json', CONFIG.WEATHER.TIMEOUT_IP);
        if (ipRes.ok) {
            const ipData = await ipRes.json();
            if (ipData && ipData.ret === 'ok' && Array.isArray(ipData?.data?.location)) {
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
                        const geoRes = await fetchWithTimeout(geoUrl, CONFIG.WEATHER.TIMEOUT_IP);
                        if (geoRes.ok) {
                            const geoData = await geoRes.json();
                            const results = geoData.results || [];
                            let matched = results.find((/** @type {any} */ r) => {
                                const matchCountry = !country || (r.country && (r.country.includes(country) || country.includes(r.country)));
                                const matchProv = !cleanProv || (r.admin1 && (r.admin1.includes(cleanProv) || cleanProv.includes(r.admin1))) || (r.name && r.name.includes(cleanProv));
                                return matchCountry && matchProv;
                            });

                            if (!matched && cleanProv && cleanProv !== cleanCity) {
                                try {
                                    const provUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cleanProv)}&language=zh&count=5`;
                                    const provRes = await fetchWithTimeout(provUrl, CONFIG.WEATHER.TIMEOUT_IP);
                                    if (provRes.ok) {
                                        const provData = await provRes.json();
                                        if (provData.results && provData.results[0]) {
                                            matched = provData.results[0];
                                        }
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
                                    timestamp: now
                                };
                                storageSet(CONFIG.KEYS.WEATHER_LOC, resolved);
                                return resolved;
                            }
                        }
                    } catch {}
                }
            }
        }
    } catch {}

    try {
        const res = await fetchWithTimeout('https://ipwho.is/?lang=zh-CN', CONFIG.WEATHER.TIMEOUT_IP);
        if (res.ok) {
            const data = await res.json();
            if (data && data.success && data.latitude) {
                const rawCity = data.city || '';
                const rawRegion = data.region || '';
                const dispName = (rawCity || rawRegion || '本地').replace(/(市|区|县)$/, '') || rawCity || rawRegion || '本地';
                const fullName = formatLocationFullName([data.country, data.region, data.city]);
                const resolved = {
                    name: dispName,
                    fullName: fullName,
                    lat: data.latitude,
                    lon: data.longitude,
                    isAuto: true,
                    timestamp: now
                };
                storageSet(CONFIG.KEYS.WEATHER_LOC, resolved);
                return resolved;
            }
        }
    } catch {}

    const fallbackLoc = {
        name: CONFIG.WEATHER.FALLBACK_LOCATION.name,
        fullName: CONFIG.WEATHER.FALLBACK_LOCATION.fullName,
        lat: CONFIG.WEATHER.FALLBACK_LOCATION.lat,
        lon: CONFIG.WEATHER.FALLBACK_LOCATION.lon,
        isAuto: true,
        isFallback: true,
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
    const res = await fetchWithTimeout(url, CONFIG.WEATHER.TIMEOUT_WEATHER);
    if (!res.ok) throw new Error('Open-Meteo request failed');
    const data = await res.json();

    return normalizeWeatherForecast(data, loc, CONFIG.WEATHER, Date.now());
}

/** @param {import('../types').WeatherData | null | undefined} data */
export function renderWeatherCapsule(data) {
    const weatherWidget = dom.weatherWidget || $('weatherWidget');
    if (!weatherWidget || !data || !data.current) return;
    const weatherIcon = dom.weatherIcon || $('weatherIcon');
    const weatherTemp = dom.weatherTemp || $('weatherTemp');
    const weatherCity = dom.weatherCity || $('weatherCity');
    const weatherBtn = dom.weatherBtn || $('weatherBtn');
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
        const cityName = data.location?.name || '天气';
        if (weatherCity.textContent !== cityName) weatherCity.textContent = cityName;
        weatherCity.title = data.location?.fullName || '';
    }
    if (weatherBtn) {
        const cityName = data.location ? data.location.name : '天气';
        const weatherDesc = data.current.weatherText ? ` ${data.current.weatherText}` : '';
        const iconStr = data.current.icon ? `${data.current.icon} ` : '';
        const newLabel = `${iconStr}${temperature}°·${cityName} 实时天气${weatherDesc}，点击查看详细预报`;
        if (weatherBtn.getAttribute('aria-label') !== newLabel) weatherBtn.setAttribute('aria-label', newLabel);
    }
}

export function renderWeatherError() {
    const weatherPopover = dom.weatherPopover || $('weatherPopover');
    if (!weatherPopover) return;
    weatherPopover.innerHTML = `
        <div class="p-4 text-center space-y-2 flex flex-col items-center justify-center select-none">
            <div class="flex items-center justify-center">${getWeatherIconHTML('📡', 'size-7')}</div>
            <div class="text-xs text-white/80 font-medium">天气获取失败</div>
            <div class="text-2xs text-white/50 leading-relaxed">网络异常或定位受阻，请检查网络后重试</div>
            <button id="weatherErrorRetryBtn" type="button" class="mt-1 px-3.5 py-1.5 bg-white/10 hover:bg-white/20 border border-white/15 text-xs rounded-xl text-white transition flex items-center justify-center gap-1.5 mx-auto active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
                ${getWeatherIconHTML('🔄', 'size-3.5')} <span>重新加载</span>
            </button>
        </div>
    `;
    const retryBtn = /** @type {HTMLButtonElement | null} */ (weatherPopover.querySelector('#weatherErrorRetryBtn'));
    if (retryBtn) {
        retryBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            retryBtn.disabled = true;
            retryBtn.innerHTML = `${getWeatherIconHTML('🔄', 'size-3.5')} <span>正在重试...</span>`;
            updateWeather(true);
        });
    }
}

/** @param {import('../types').WeatherData | null | undefined} data */
export function renderWeatherPopover(data) {
    const weatherPopover = dom.weatherPopover || $('weatherPopover');
    if (!weatherPopover) return;
    if (!data || !data.current) {
        weatherPopover.innerHTML = `
            <div class="p-4 text-center flex flex-col items-center justify-center gap-2.5 select-none w-full">
                <div class="size-5 border-2 border-white/25 border-t-white rounded-full animate-spin"></div>
                <div class="space-y-0.5">
                    <div class="text-xs text-white/80 font-medium">正在获取实时天气...</div>
                    <div class="text-2xs text-white/45">正在自动定位并同步气象数据</div>
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
        weatherText: (typeof raw.weatherText === 'string') ? raw.weatherText : ''
    };
    const loc = /** @type {import('../types').WeatherLocation} */ (data.location || {});
    const days = (Array.isArray(data.daily) ? data.daily : []).filter(isWeatherRecord).map((/** @type {any} */ d) => ({
        ...d,
        label: (typeof d.label === 'string') ? d.label.slice(0, CONFIG.WEATHER.LABEL_MAX_CHARS) : '',
        icon: (typeof d.icon === 'string' && d.icon) ? d.icon : '⛅',
        text: (typeof d.text === 'string') ? d.text.slice(0, CONFIG.SECURITY.MAX_DESC_CHARS) : '',
        tempMax: Math.round(weatherNum(d.tempMax, 0)),
        tempMin: Math.round(weatherNum(d.tempMin, 0))
    }));

    let sunIcon = '🌅';
    let sunLabel = '今日日落';
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
            sunLabel = '明日日出';
            sunTime = c.sunriseTomorrow || c.sunriseToday || c.sunrise || '--:--';
        } else if (riseTodayMins !== null && nowMins < riseTodayMins) {
            sunIcon = '🌄';
            sunLabel = '今日日出';
            sunTime = c.sunriseToday || c.sunrise || '--:--';
        } else {
            sunIcon = '🌅';
            sunLabel = '今日日落';
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

    weatherPopover.innerHTML = `
        <div class="flex items-center justify-between pb-2.5 mb-3 border-b border-white/10">
            <div class="flex items-center gap-1.5 min-w-0 pr-2">
                <span class="text-xs text-white/50 shrink-0 flex items-center justify-center">${getWeatherIconHTML('📍', 'size-3.5')}</span>
                <span class="text-xs font-semibold text-white/90 truncate" title="${escapeHtml(loc.fullName || loc.name || '')}">${escapeHtml(loc.fullName || loc.name || '')}</span>
            </div>
            <button id="weatherRefreshBtn" type="button" class="size-7 apple-radius bg-white/5 hover:bg-white/15 text-white flex items-center justify-center glass-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none" title="立即刷新天气" aria-label="立即刷新天气">
                <svg class="size-3.5 opacity-70 hover:opacity-100 transition-opacity" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>
            </button>
        </div>

        <div class="flex items-center justify-between mb-3 px-1">
            <div class="flex items-center gap-3">
                <span class="text-3xl sm:text-4xl leading-none select-none shrink-0 flex items-center justify-center">${getWeatherIconHTML(c.icon, 'size-10 sm:size-12')}</span>
                <div>
                    <div class="text-2xl font-bold tracking-tight text-white leading-none">${c.temp}<span class="text-base font-normal text-white/70">°C</span></div>
                    <div class="text-xs text-white/75 mt-1">${escapeHtml(c.weatherText)} · 体感 ${c.apparent}°C</div>
                </div>
            </div>
            ${days[0] ? `<div class="text-right text-xs text-white/60"><div>最高 ${days[0].tempMax}°</div><div class="mt-0.5">最低 ${days[0].tempMin}°</div></div>` : ''}
        </div>

        <div class="grid grid-cols-2 gap-2 mb-3">
            ${weatherCard(getWeatherIconHTML(humIcon, 'size-4'), '相对湿度', c.humidity + '%')}
            ${weatherCard(getWeatherIconHTML(windIcon, 'size-4'), '实时风速', c.windSpeed + ' km/h')}
            ${weatherCard(getWeatherIconHTML(popIcon, 'size-4'), '降水概率', popVal + '%')}
            ${weatherCard(getWeatherIconHTML(sunIcon, 'size-4'), sunLabel, sunTime)}
        </div>

        <div class="space-y-1.5 pt-2 border-t border-white/10">
            <div class="text-2xs text-white/50 font-medium px-1 mb-1">未来几天预报</div>
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
                    const currentPop = dom.weatherPopover || $('weatherPopover');
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

const isWeatherRecord = (/** @type {any} */ value) => value !== null && typeof value === 'object' && !Array.isArray(value);

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

export async function updateWeather(force = false) {
    if (!force && typeof document !== 'undefined' && document.hidden) return;
    const cache = readWeatherCache();
    const now = Date.now();
    const CACHE_TTL = CONFIG.WEATHER.CACHE_TTL;

    if (!force && cache && cache.timestamp && (now - cache.timestamp < CACHE_TTL)) {
        renderWeatherCapsule(cache);
        renderWeatherPopover(cache);
        return;
    }

    if (isFetchingWeather) return;
    isFetchingWeather = true;

    try {
        const locCache = storageGet(CONFIG.KEYS.WEATHER_LOC, null);
        const knownLoc = (locCache && locCache.lat) ? locCache : (cache && cache.location && cache.location.lat ? cache.location : null);

        if (knownLoc && !force) {
            const forecastPromise = fetchWeatherForecast(knownLoc);
            const locationPromise = resolveWeatherLocation(false);

            const freshData = await forecastPromise;
            storageSet(CONFIG.KEYS.WEATHER_CACHE, freshData);
            renderWeatherCapsule(freshData);
            renderWeatherPopover(freshData);

            locationPromise.then(async (newLoc) => {
                if (newLoc && (Math.abs(newLoc.lat - knownLoc.lat) > CONFIG.WEATHER.LOCATION_DRIFT_THRESHOLD || Math.abs(newLoc.lon - knownLoc.lon) > CONFIG.WEATHER.LOCATION_DRIFT_THRESHOLD)) {
                    try {
                        const relocatedData = await fetchWeatherForecast(newLoc);
                        storageSet(CONFIG.KEYS.WEATHER_CACHE, relocatedData);
                        renderWeatherCapsule(relocatedData);
                        renderWeatherPopover(relocatedData);
                    } catch {}
                }
            }).catch(() => {});
        } else {
            const loc = await resolveWeatherLocation(force);
            const freshData = await fetchWeatherForecast(loc);
            storageSet(CONFIG.KEYS.WEATHER_CACHE, freshData);
            renderWeatherCapsule(freshData);
            renderWeatherPopover(freshData);
        }
    } catch (err) {
        if (cache) {
            renderWeatherCapsule(cache);
            renderWeatherPopover(cache);
        } else {
            const weatherCity = dom.weatherCity || $('weatherCity');
            if (weatherCity) weatherCity.textContent = '暂无数据';
            renderWeatherError();
        }
    } finally {
        isFetchingWeather = false;
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

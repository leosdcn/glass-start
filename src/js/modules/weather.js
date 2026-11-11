import { t, getLocale, weatherDescription, forecastLabel } from '../core/i18n.js';
import { weatherTime, formatLocationFullName, stripAdminSuffix, normalizeWeatherForecast, getForecastPeriod } from '../utils/weather-model.js';
import { CONFIG } from '../config/constants.js';
import { isUsableWeatherData, parseTempUnit, weatherNum, toDisplayTemp } from '../utils/weather-data.js';
import { escapeHtml, safeUrl } from '../utils/helpers.js';
import { storageGet, storageSet, storageRemove } from '../utils/storage.js';
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
    const path = (Object.hasOwn(WEATHER_EMOJI_MAP, clean) ? WEATHER_EMOJI_MAP[clean] : null)
        || (clean.startsWith('./') || clean.startsWith('/') || clean.endsWith('.svg') ? clean : null);
    if (path) {
        return `<img src="${safeUrl(path)}" class="${className} shrink-0 object-contain select-none inline-block align-middle pointer-events-none" alt="" aria-hidden="true" decoding="async"><span class="sr-only" aria-hidden="true">${escapeHtml(clean)}</span>`;
    }
    return escapeHtml(icon);
}

/**
 * @param {Array<AbortSignal | undefined | null>} signals
 * @returns {AbortSignal}
 */
function anySignal(signals) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
        const filtered = signals.filter(Boolean);
        return AbortSignal.any(/** @type {AbortSignal[]} */ (filtered));
    }
    const controller = new AbortController();
    for (const sig of signals) {
        if (!sig) continue;
        if (sig.aborted) {
            controller.abort(sig.reason);
            return sig;
        }
        sig.addEventListener('abort', () => controller.abort(sig.reason), { once: true });
    }
    return controller.signal;
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 * @param {AbortSignal} [signal]
 */
async function fetchJsonWithTimeout(url, timeoutMs, signal) {
    const controller = new AbortController();
    const requestSignal = signal ? anySignal([signal, controller.signal]) : controller.signal;
    requestSignal.throwIfAborted();
    const timer = setTimeout(() => { try { controller.abort(); } catch {} }, timeoutMs);
    try {
        const response = await fetch(url, { signal: requestSignal });
        if (!response.ok) throw new Error(`Weather request failed: HTTP ${response.status}`);
        // 超时覆盖正文读取；收到响应头后仍可能停在 json()。
        const data = await response.json();
        requestSignal.throwIfAborted();
        return data;
    } finally {
        clearTimeout(timer);
    }
}

export function openWeatherPopover() {
    const popover = dom.weatherPopover;
    const btn = dom.weatherBtn;
    if (!popover || !btn || !OverlayStack.push('weatherPopover', closeWeatherPopover, btn)) return;
    if (!popover.innerHTML.trim()) {
        renderWeatherPopover(null);
    }
    popover.classList.add('active');
    popover.setAttribute('aria-hidden', 'false');
    btn.setAttribute('aria-expanded', 'true');
}

export function closeWeatherPopover() {
    const popover = dom.weatherPopover;
    const btn = dom.weatherBtn;
    if (!popover || !btn) return;
    const restoreFocus = popover.contains(document.activeElement);
    OverlayStack.pop('weatherPopover');
    popover.classList.remove('active');
    popover.setAttribute('aria-hidden', 'true');
    btn.setAttribute('aria-expanded', 'false');
    if (restoreFocus) btn.focus({ preventScroll: true });
}

export function toggleWeatherPopover() {
    const popover = dom.weatherPopover;
    if (!popover) return;
    // OverlayStack 为弹窗激活态的唯一权威源，与 Esc 退栈及全站弹窗机制保持语义一致
    const isOpen = OverlayStack.stack.some(item => item.id === 'weatherPopover');
    if (isOpen) {
        closeWeatherPopover();
    } else {
        openWeatherPopover();
    }
}

/**
 * 零经纬度也是有效坐标，不能按真假判断位置是否存在。
 * @param {import('../types').WeatherLocation | null | undefined} location
 * @returns {location is import('../types').WeatherLocation}
 */
function hasWeatherCoordinates(location) {
    return !!location
        && typeof location.lat === 'number' && Number.isFinite(location.lat) && location.lat >= -90 && location.lat <= 90
        && typeof location.lon === 'number' && Number.isFinite(location.lon) && location.lon >= -180 && location.lon <= 180;
}

function readWeatherLocation() {
    const location = storageGet(CONFIG.KEYS.WEATHER_LOC, null);
    if (location?.isFallback) {
        storageRemove(CONFIG.KEYS.WEATHER_LOC);
        return null;
    }
    return hasWeatherCoordinates(location) ? location : null;
}

/** @param {import('../types').WeatherLocation | null | undefined} a
 * @param {import('../types').WeatherLocation} b
 */
function matchesForecastLocation(a, b) {
    return hasWeatherCoordinates(a)
        && a.name === b.name && a.fullName === b.fullName
        && (a.language || 'zh-CN') === (b.language || 'zh-CN')
        && Math.abs(a.lat - b.lat) <= CONFIG.WEATHER.LOCATION_DRIFT_THRESHOLD
        && Math.abs(a.lon - b.lon) <= CONFIG.WEATHER.LOCATION_DRIFT_THRESHOLD;
}

/**
 * @param {import('../types').WeatherLocation | null} locCache
 * @param {boolean} force
 * @param {AbortSignal} signal
 */
async function resolveWeatherLocation(locCache, force, signal) {
    const now = Date.now();
    const LOC_TTL = CONFIG.WEATHER.LOC_TTL;
    if (!force && locCache && locCache.timestamp && (now - locCache.timestamp < LOC_TTL) && hasWeatherCoordinates(locCache) && (locCache.language || 'zh-CN') === getLocale()) {
        return locCache;
    }
    return executeResolveWeatherLocation(now, signal);
}

/**
 * @param {number} now
 * @param {AbortSignal} signal
 * @returns {Promise<import('../types').WeatherLocation>}
 */
async function executeResolveWeatherLocation(now, signal) {

    if (getLocale() !== 'en') {
        try {
            const ipData = await fetchJsonWithTimeout('https://myip.ipip.net/json', CONFIG.WEATHER.TIMEOUT_IP, signal);
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
                        const geoData = await fetchJsonWithTimeout(geoUrl, CONFIG.WEATHER.TIMEOUT_IP, signal);
                        const results = geoData?.results || [];
                        let matched = results.find((/** @type {import('../types').GeocodingResultItem} */ r) => {
                            const matchCountry = !country || (r.country && (r.country.includes(country) || country.includes(r.country)));
                            const matchProv = !cleanProv || (r.admin1 && (r.admin1.includes(cleanProv) || cleanProv.includes(r.admin1))) || (r.name && r.name.includes(cleanProv));
                            return matchCountry && matchProv;
                        });

                        if (!matched && cleanProv && cleanProv !== cleanCity) {
                            try {
                                const provUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cleanProv)}&language=zh&count=5`;
                                const provData = await fetchJsonWithTimeout(provUrl, CONFIG.WEATHER.TIMEOUT_IP, signal);
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
                            if (hasWeatherCoordinates(resolved)) return resolved;
                        }
                    } catch {}
                }
            }
        } catch {}
    }

    try {
        const data = await fetchJsonWithTimeout(`https://ipwho.is/?lang=${getLocale() === 'en' ? 'en' : 'zh-CN'}`, CONFIG.WEATHER.TIMEOUT_IP, signal);
        if (data?.success && Number.isFinite(data.latitude) && Number.isFinite(data.longitude)) {
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
            return resolved;
        }
    } catch {}

    throw new Error('Weather location unavailable');
}

/** @param {import('../types').WeatherLocation} loc @param {AbortSignal} [signal] */
export async function fetchWeatherForecast(loc, signal) {
    const lat = loc.lat;
    const lon = loc.lon;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max&timezone=auto`;
    const data = await fetchJsonWithTimeout(url, CONFIG.WEATHER.TIMEOUT_WEATHER, signal);

    const forecast = normalizeWeatherForecast(data, loc, CONFIG.WEATHER, Date.now());
    if (!isUsableWeatherData(forecast)) throw new Error('Weather response contains no measurements');
    return forecast;
}

/** @type {import('../types').WeatherData | null} */
let currentWeatherData = null;

function getTempUnit() {
    try {
        return parseTempUnit(localStorage.getItem(CONFIG.KEYS.TEMP_UNIT));
    } catch {
        return 'C';
    }
}

function toggleTempUnit() {
    const nextUnit = getTempUnit() === 'F' ? 'C' : 'F';
    try {
        localStorage.setItem(CONFIG.KEYS.TEMP_UNIT, nextUnit);
    } catch {}
    refreshWeatherDisplay();
}

/** 按当前单位重新渲染已有天气，不发起网络请求。 */
function refreshWeatherDisplay() {
    const data = currentWeatherData || readWeatherCache();
    if (data) {
        renderWeatherCapsule(data);
        renderWeatherPopover(data);
    }
}

/** @param {import('../types').WeatherData | null | undefined} data */
export function renderWeatherCapsule(data) {
    const weatherWidget = dom.weatherWidget;
    if (!weatherWidget) return;
    const weatherIcon = dom.weatherIcon;
    const weatherTemp = dom.weatherTemp;
    const weatherCity = dom.weatherCity;
    const weatherBtn = dom.weatherBtn;
    if (!data?.current) {
        if (weatherIcon) {
            delete weatherIcon.dataset.icon;
            weatherIcon.innerHTML = getWeatherIconHTML('🌤️', 'size-4 sm:size-4.5');
        }
        if (weatherTemp) weatherTemp.textContent = '--°';
        if (weatherCity) {
            weatherCity.textContent = t('ui.weather');
            weatherCity.title = '';
        }
        weatherBtn?.setAttribute('aria-label', t('ui.weather.open.current.conditions.and.forecast'));
        return;
    }
    currentWeatherData = data;
    const unit = getTempUnit();
    const temperature = toDisplayTemp(data.current.temp, unit);

    if (weatherIcon) {
        const iconStr = data.current.icon || '';
        if (weatherIcon.dataset.icon !== iconStr || !weatherIcon.querySelector('img')) {
            weatherIcon.dataset.icon = iconStr;
            weatherIcon.innerHTML = getWeatherIconHTML(iconStr, 'size-4 sm:size-4.5');
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
        const newLabel = t('weather.capsule', { temperature, city: cityName || t('ui.weather'), description: weatherDesc });
        if (weatherBtn.getAttribute('aria-label') !== newLabel) weatherBtn.setAttribute('aria-label', newLabel);
    }
}

let lastRenderedPopoverSignature = '';
/** @type {ReturnType<typeof mountWeatherView> | null} */
let weatherView = null;

/** @param {HTMLElement} popover */
function mountWeatherView(popover) {
    popover.innerHTML = `
        <div data-weather-status></div>
        <div data-weather-data hidden>
            <div class="flex items-center justify-between pb-2.5 mb-3 border-b border-white/10">
                <div class="flex items-center gap-1.5 min-w-0 pr-2">
                    <span class="text-xs text-white/50 shrink-0 flex items-center justify-center">${getWeatherIconHTML('📍', 'size-3.5')}</span>
                    <span data-weather-location class="text-xs font-semibold text-white/90 truncate"></span>
                </div>
                <button id="weatherRefreshBtn" type="button" class="group size-7 apple-radius bg-white/5 hover:bg-white/15 text-white flex items-center justify-center glass-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 shrink-0 aria-disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:pointer-events-none" title="${escapeHtml(t('ui.refresh.weather'))}" aria-label="${escapeHtml(t('ui.refresh.weather'))}">
                    <svg class="size-3.5 pointer-events-none opacity-70 group-hover:opacity-100" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>
                </button>
            </div>
            <div class="flex items-center justify-between gap-3 mb-3 px-1">
                <div class="flex items-center gap-3 min-w-0">
                    <span data-weather-icon class="text-3xl sm:text-4xl leading-none select-none shrink-0 flex items-center justify-center"></span>
                    <div class="min-w-0">
                        <button type="button" id="tempUnitToggleBtn" class="text-2xl font-normal tracking-tight text-white leading-none cursor-pointer select-none rounded hover:opacity-85 transition-opacity inline-block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50" title="${escapeHtml(t('weather.toggle.unit'))}" aria-label="${escapeHtml(t('weather.toggle.unit'))}"><span class="font-bold">--</span><span class="text-base font-normal text-white/70">°C</span></button>
                        <div data-weather-current class="text-xs text-white/75 mt-1${getLocale() === 'zh-CN' ? ' flex flex-wrap items-baseline gap-x-1' : ''}"></div>
                    </div>
                </div>
                <div data-weather-range class="text-right text-xs text-white/60 shrink-0 whitespace-nowrap"></div>
            </div>
            <div data-weather-stats class="grid grid-cols-2 gap-2 mb-3"></div>
            <div class="space-y-1.5 pt-2 border-t border-white/10">
                <div class="flex items-center justify-between gap-2 px-1 mb-1">
                    <span class="text-2xs text-white/50 font-medium">${escapeHtml(t('ui.upcoming.forecast'))}</span>
                    <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" class="shrink-0 text-2xs text-white/50 hover:text-white/80 transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50" aria-label="${escapeHtml(t('ui.weather.data.open.meteo.opens.in'))}">Open-Meteo</a>
                </div>
                <div data-weather-forecast class="space-y-1.5"></div>
            </div>
        </div>
    `;
    /** @param {string} selector */
    const find = selector => /** @type {HTMLElement} */ (popover.querySelector(selector));
    return {
        popover, status: find('[data-weather-status]'), body: find('[data-weather-data]'),
        location: find('[data-weather-location]'), icon: find('[data-weather-icon]'),
        temp: find('#tempUnitToggleBtn'), current: find('[data-weather-current]'),
        range: find('[data-weather-range]'), stats: find('[data-weather-stats]'),
        forecast: find('[data-weather-forecast]')
    };
}

function getWeatherView() {
    const popover = dom.weatherPopover;
    if (!popover) return null;
    if (weatherView?.popover !== popover) {
        weatherView = mountWeatherView(popover);
        lastRenderedPopoverSignature = '';
    }
    return weatherView;
}

/** @param {string} signature @param {string} html */
function showWeatherStatus(signature, html) {
    const view = getWeatherView();
    if (!view || signature === lastRenderedPopoverSignature) return;
    lastRenderedPopoverSignature = signature;
    view.body.hidden = true;
    view.status.hidden = false;
    view.status.innerHTML = html;
}

function renderWeatherError(empty = false) {
    showWeatherStatus(empty ? 'empty' : 'error', `
        <div class="p-4 text-center space-y-2 flex flex-col items-center justify-center select-none">
            <div class="flex items-center justify-center">${getWeatherIconHTML('📡', 'size-7')}</div>
            <div class="text-xs text-white/80 font-medium">${escapeHtml(t(empty ? 'ui.no.data' : 'ui.weather.unavailable'))}</div>
            ${empty ? '' : `<div class="text-2xs text-white/50 leading-relaxed">${escapeHtml(t('ui.check.your.connection.or.location.access'))}</div>`}
            <button id="weatherErrorRetryBtn" type="button" class="mt-1 px-3.5 py-1.5 bg-white/10 hover:bg-white/20 border border-white/15 text-xs rounded-xl text-white transition flex items-center justify-center gap-1.5 mx-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
                ${getWeatherIconHTML('🔄', 'size-3.5')} ${escapeHtml(t('ui.reload'))}
            </button>
        </div>
    `);
}

/** @param {import('../types').WeatherData | null | undefined} data */
export function renderWeatherPopover(data) {
    const view = getWeatherView();
    if (!view) return;
    if (!data?.current) {
        showWeatherStatus('loading', `
            <div class="p-4 text-center flex flex-col items-center justify-center gap-2.5 select-none w-full">
                <div class="size-5 border-2 border-white/25 border-t-white rounded-full animate-spin"></div>
                <div class="space-y-0.5">
                    <div class="text-xs text-white/80 font-medium">${escapeHtml(t('ui.loading.weather'))}</div>
                    <div class="text-2xs text-white/45">${escapeHtml(t('ui.finding.your.location.and.updating.weather'))}</div>
                </div>
            </div>
        `);
        return;
    }

    currentWeatherData = data;
    const unit = getTempUnit();
    const raw = data.current;
    const period = getForecastPeriod(data, new Date());
    const location = data.location?.fullName || data.location?.name || '';
    const temp = toDisplayTemp(raw.temp, unit);
    const apparent = toDisplayTemp(raw.apparent ?? raw.temp, unit);
    const humidity = Math.round(weatherNum(raw.humidity, NaN));
    const windSpeed = Math.round(weatherNum(raw.windSpeed, NaN) * 10) / 10;
    const icon = typeof raw.icon === 'string' && raw.icon ? raw.icon : '⛅';
    const weatherText = raw.weatherCode === undefined && getLocale() === 'zh-CN' && typeof raw.weatherText === 'string' && raw.weatherText
        ? raw.weatherText : weatherDescription(raw.weatherCode);
    const days = period.days.slice(0, CONFIG.WEATHER.FORECAST_DISPLAY_DAYS).map((d, index) => ({
        label: forecastLabel(d.date, d.date ? (d.date === period.date ? 0 : d.date === period.tomorrow ? 1 : 2) : index)
            || (typeof d.label === 'string' ? d.label.slice(0, CONFIG.WEATHER.LABEL_MAX_CHARS) : ''),
        icon: (typeof d.icon === 'string' && d.icon) ? d.icon : '⛅',
        text: (d.weatherCode !== undefined ? weatherDescription(d.weatherCode) : '')
            || (typeof d.text === 'string' ? d.text.slice(0, CONFIG.SECURITY.MAX_DESC_CHARS) : ''),
        tempMax: toDisplayTemp(d.tempMax, unit),
        tempMin: toDisplayTemp(d.tempMin, unit)
    }));
    const sun = period.sun;
    const sunrise = sun?.kind === 'sunrise';
    const sunDate = sun?.dateTime?.slice(0, 10);
    const sunLabel = sunDate === period.date
        ? t(sunrise ? 'ui.sunrise.today' : 'ui.sunset.today')
        : sunrise && sunDate === period.tomorrow ? t('ui.sunrise.tomorrow')
        : t(sunrise ? 'weather.nextSunrise' : sunDate ? 'weather.nextSunset' : 'weather.sunEvent');
    const sunTime = weatherTime(sun?.dateTime?.slice(11));
    const chance = weatherNum(period.pop, NaN);
    const pop = Number.isFinite(chance) ? Math.max(0, Math.min(100, chance)) : NaN;

    const sig = JSON.stringify([unit, location, temp, apparent, humidity, windSpeed, icon, weatherText, sunLabel, sunTime, pop, days,
        period.today?.tempMax, period.today?.tempMin]);
    if (sig === lastRenderedPopoverSignature) return;
    lastRenderedPopoverSignature = sig;
    if (!view.status.hidden) view.status.innerHTML = '';
    view.status.hidden = true;
    view.body.hidden = false;
    view.location.textContent = location;
    view.location.title = location;
    view.icon.innerHTML = getWeatherIconHTML(icon, 'size-10 sm:size-12');
    view.temp.innerHTML = `<span class="font-bold">${temp}</span><span class="text-base font-normal text-white/70">°${unit}</span>`;
    view.current.innerHTML = `<span>${escapeHtml(weatherText)}</span>
        ${getLocale() === 'zh-CN' ? '<span aria-hidden="true">·</span>' : ''}
        <span class="whitespace-nowrap${getLocale() === 'zh-CN' ? '' : ' block mt-0.5'}">${escapeHtml(t('weather.feels.like', { temperature: apparent }))}</span>`;
    view.range.innerHTML = period.today ? `<div>${escapeHtml(t('weather.high', { temperature: toDisplayTemp(period.today.tempMax, unit) }))}</div>
        <div>${escapeHtml(t('weather.low', { temperature: toDisplayTemp(period.today.tempMin, unit) }))}</div>` : '';
    /** @type {(icon: string, label: string, val: string | number) => string} */
    const weatherCard = (icon, label, val) => `
        <div class="p-2 glass-subcard flex items-center gap-2">
            <span class="text-sm select-none">${icon}</span>
            <div class="min-w-0">
                <div class="text-2xs text-white/50 leading-tight">${escapeHtml(label)}</div>
                <div class="text-xs font-semibold text-white/90 leading-tight mt-0.5">${escapeHtml(String(val))}</div>
            </div>
        </div>
    `;

    const humIcon = humidity < CONFIG.WEATHER.HUMIDITY_LOW_THRESHOLD ? '🌵' : humidity > CONFIG.WEATHER.HUMIDITY_HIGH_THRESHOLD ? '💦' : '💧';
    const windIcon = windSpeed >= CONFIG.WEATHER.WIND_HIGH_THRESHOLD ? '🌪️' : windSpeed >= CONFIG.WEATHER.WIND_MID_THRESHOLD ? '🎏' : '🍃';
    const popIcon = pop >= CONFIG.WEATHER.POP_HIGH_THRESHOLD ? '☔️' : pop >= CONFIG.WEATHER.POP_MID_THRESHOLD ? '☂️' : '🌂';
    view.stats.innerHTML = `
        ${weatherCard(getWeatherIconHTML(humIcon, 'size-4'), t('ui.humidity'), Number.isFinite(humidity) ? humidity + '%' : '--')}
        ${weatherCard(getWeatherIconHTML(windIcon, 'size-4'), t('ui.wind.speed'), Number.isFinite(windSpeed) ? windSpeed + ' km/h' : '--')}
        ${weatherCard(getWeatherIconHTML(popIcon, 'size-4'), t('ui.rain.chance'), Number.isFinite(pop) ? pop + '%' : '--')}
        ${weatherCard(getWeatherIconHTML(sunrise ? '🌅' : '🌇', 'size-4'), sunLabel, sunTime)}
    `;
    view.forecast.innerHTML = `
            ${days.map(d => `
                <div class="flex items-center justify-between text-xs py-1 px-1.5 apple-radius hover:bg-white/5 transition-colors">
                    <span class="w-10 text-white/70 font-medium shrink-0">${escapeHtml(d.label)}</span>
                    <div class="flex items-center gap-2 flex-1 min-w-0 pl-7 sm:pl-8">
                        <span class="w-5 text-center select-none shrink-0 flex items-center justify-center">${getWeatherIconHTML(d.icon, 'size-4')}</span>
                        <span class="text-2xs text-white/60 truncate">${escapeHtml(d.text)}</span>
                    </div>
                    <span class="w-16 text-right tabular-nums text-white/80 shrink-0">${d.tempMin}° ~ ${d.tempMax}°</span>
                </div>
            `).join('')}
    `;
}

/** @type {{ controller: AbortController, promise: Promise<void> } | null} */
let weatherRefresh = null;

export function isFetchingWeather() {
    return weatherRefresh !== null;
}

export function resetWeather() {
    const previous = weatherRefresh;
    weatherRefresh = null;
    previous?.controller.abort();
    currentWeatherData = null;
    const results = [CONFIG.KEYS.WEATHER_LOC, CONFIG.KEYS.WEATHER_CACHE, CONFIG.KEYS.TEMP_UNIT].map(storageRemove);
    renderWeatherCapsule(null);
    const view = getWeatherView();
    if (view) {
        for (const part of [view.location, view.icon, view.temp, view.current, view.range, view.stats, view.forecast]) {
            part.textContent = '';
        }
        view.location.title = '';
    }
    renderWeatherError(true);
    return results.every(Boolean);
}

function readWeatherCache() {
    const cache = storageGet(CONFIG.KEYS.WEATHER_CACHE, null);
    if (!cache) return null;
    if (!isUsableWeatherData(cache)) {
        storageRemove(CONFIG.KEYS.WEATHER_CACHE);
        return null;
    }
    return cache;
}

export function updateWeather(force = false) {
    if (!force && typeof document !== 'undefined' && document.hidden) return Promise.resolve();
    if (weatherRefresh) return weatherRefresh.promise;
    const cache = readWeatherCache();
    const locCache = readWeatherLocation();

    if (!force && cache?.timestamp && Date.now() - cache.timestamp < CONFIG.WEATHER.CACHE_TTL
        && (cache.location?.language || 'zh-CN') === getLocale()
        && (!locCache || matchesForecastLocation(cache.location, locCache))) {
        displayWeather(cache);
        return Promise.resolve();
    }

    const controller = new AbortController();
    const promise = executeWeatherUpdate(cache, locCache, force, controller.signal).finally(() => {
        if (weatherRefresh?.controller === controller) weatherRefresh = null;
    });
    weatherRefresh = { controller, promise };
    return promise;
}

/** @param {import('../types').WeatherData} data */
function displayWeather(data) {
    renderWeatherCapsule(data);
    renderWeatherPopover(data);
}

/** @param {import('../types').WeatherData | null} cache
 * @param {import('../types').WeatherLocation | null} locCache
 * @param {boolean} force
 * @param {AbortSignal} signal
 */
async function executeWeatherUpdate(cache, locCache, force, signal) {
    const knownLoc = locCache ?? (hasWeatherCoordinates(cache?.location) ? cache.location : null);
    const provisional = new AbortController();
    let usable = currentWeatherData ?? cache;
    try {
        const forecastSignal = anySignal([signal, provisional.signal]);
        const earlyForecast = knownLoc && !force ? fetchWeatherForecast(knownLoc, forecastSignal).then(data => {
            if (!forecastSignal.aborted) {
                displayWeather(data);
                usable = data;
            }
            return data;
        }).catch(() => null) : null;
        const loc = await resolveWeatherLocation(locCache, force, signal).catch(() => knownLoc);
        signal.throwIfAborted();
        if (!loc) throw new Error('Weather location unavailable');
        if (loc !== locCache && loc !== knownLoc) storageSet(CONFIG.KEYS.WEATHER_LOC, loc);
        const sameCoordinates = knownLoc?.lat === loc.lat && knownLoc.lon === loc.lon;
        let data = earlyForecast && (sameCoordinates || matchesForecastLocation(knownLoc, loc))
            ? await earlyForecast : null;
        signal.throwIfAborted();
        provisional.abort();
        if (!data) {
            if (earlyForecast && sameCoordinates) throw new Error('Weather forecast unavailable');
            data = await fetchWeatherForecast(loc, signal);
        }
        signal.throwIfAborted();
        const confirmed = { ...data, location: loc };
        displayWeather(confirmed);
        storageSet(CONFIG.KEYS.WEATHER_CACHE, confirmed);
    } catch (err) {
        if (signal.aborted) return;
        if (usable) {
            displayWeather(usable);
        } else {
            const weatherCity = dom.weatherCity;
            if (weatherCity) weatherCity.textContent = t('ui.no.data');
            renderWeatherError();
        }
    }
}

let popoverEventsBound = false;

/**
 * 委托处理天气弹窗内部的刷新与重试点击交互
 * @param {MouseEvent} e
 */
function handleWeatherPopoverClick(e) {
    e.stopPropagation();
    const target = /** @type {HTMLElement | null} */ (e.target instanceof HTMLElement ? e.target : null);
    if (!target) return;

    const unitBtn = /** @type {HTMLElement | null} */ (target.closest('#tempUnitToggleBtn'));
    if (unitBtn) {
        e.stopPropagation();
        toggleTempUnit();
        return;
    }

    const retryBtn = /** @type {HTMLButtonElement | null} */ (target.closest('#weatherErrorRetryBtn'));
    if (retryBtn) {
        e.stopPropagation();
        renderWeatherPopover(null);
        updateWeather(true).catch(() => {});
        return;
    }

    const refBtn = /** @type {HTMLButtonElement | null} */ (target.closest('#weatherRefreshBtn'));
    if (refBtn) {
        e.stopPropagation();
        if (refBtn.hasAttribute('aria-busy')) return;
        refBtn.setAttribute('aria-disabled', 'true');
        refBtn.setAttribute('aria-busy', 'true');
        const svg = refBtn.querySelector('svg');
        svg?.classList.add('weather-spin');
        const feedback = new Promise(resolve => setTimeout(resolve, CONFIG.TIMERS.WEATHER_REFRESH_FEEDBACK));
        Promise.allSettled([updateWeather(true), feedback]).then(() => {
            svg?.classList.remove('weather-spin');
            refBtn.removeAttribute('aria-disabled');
            refBtn.removeAttribute('aria-busy');
        });
    }
}

/** @type {ReturnType<typeof setInterval> | null} */
let weatherIntervalTimer = null;

function stopWeatherInterval() {
    if (weatherIntervalTimer !== null) {
        clearInterval(weatherIntervalTimer);
        weatherIntervalTimer = null;
    }
}

export function initWeather() {
    if (!popoverEventsBound && dom.weatherPopover) {
        dom.weatherPopover.addEventListener('click', handleWeatherPopoverClick);
        popoverEventsBound = true;
    }

    const cache = readWeatherCache();
    if (cache) {
        renderWeatherCapsule(cache);
        renderWeatherPopover(cache);
    } else {
        renderWeatherPopover(null);
    }

    updateWeather(false).catch(() => {});
    stopWeatherInterval();
    weatherIntervalTimer = setInterval(() => updateWeather(false).catch(() => {}), CONFIG.WEATHER.CACHE_TTL);
}

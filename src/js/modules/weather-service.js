/** 天气地理定位解析、预报接口请求与缓存校验服务。 */
import { t, getLocale } from '../core/i18n.js';
import { formatLocationFullName, stripAdminSuffix, normalizeWeatherForecast } from '../utils/weather-model.js';
import { CONFIG } from '../config/constants.js';
import { isUsableWeatherData } from '../utils/weather-data.js';
import { storageGet, storageRemove } from '../utils/storage.js';

/**
 * @param {Array<AbortSignal | undefined | null>} signals
 * @returns {AbortSignal}
 */
export function anySignal(signals) {
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

/**
 * 零经纬度也是有效坐标，不能按真假判断位置是否存在。
 * @param {import('../types').WeatherLocation | null | undefined} location
 * @returns {location is import('../types').WeatherLocation}
 */
export function hasWeatherCoordinates(location) {
    return !!location
        && typeof location.lat === 'number' && Number.isFinite(location.lat) && location.lat >= -90 && location.lat <= 90
        && typeof location.lon === 'number' && Number.isFinite(location.lon) && location.lon >= -180 && location.lon <= 180;
}

export function readWeatherLocation() {
    const location = storageGet(CONFIG.KEYS.WEATHER_LOC, null);
    if (location?.isFallback) {
        storageRemove(CONFIG.KEYS.WEATHER_LOC);
        return null;
    }
    return hasWeatherCoordinates(location) ? location : null;
}

export function readWeatherCache() {
    const cache = storageGet(CONFIG.KEYS.WEATHER_CACHE, null);
    if (!cache) return null;
    if (!isUsableWeatherData(cache)) {
        storageRemove(CONFIG.KEYS.WEATHER_CACHE);
        return null;
    }
    return cache;
}

/** @param {import('../types').WeatherLocation | null | undefined} a
 * @param {import('../types').WeatherLocation} b
 */
export function matchesForecastLocation(a, b) {
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
export async function resolveWeatherLocation(locCache, force, signal) {
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
 * @returns {Promise<import('../types').WeatherLocation | null>}
 */
async function resolveZhIpLocation(now, signal) {
    try {
        const ipData = await fetchJsonWithTimeout('https://myip.ipip.net/json', CONFIG.WEATHER.TIMEOUT_IP, signal);
        if (ipData?.ret !== 'ok' || !Array.isArray(ipData.data?.location)) return null;

        const locArr = ipData.data.location;
        const country = locArr[0] || '中国';
        const province = locArr[1] || '';
        const rawCity = locArr[2] || locArr[3] || province;
        const cleanCity = stripAdminSuffix(rawCity);
        const cleanProv = stripAdminSuffix(province, true);
        if (!cleanCity) return null;

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
                if (provData?.results?.[0]) matched = provData.results[0];
            } catch {}
        }

        if (!matched && results.length > 0) matched = results[0];
        if (!matched) return null;

        const dispName = (matched.name || cleanCity).replace(/(市|区|县)$/, '') || matched.name || cleanCity;
        const fullName = formatLocationFullName([matched.country || country, matched.admin1 || province, matched.admin2, matched.name || cleanCity]);
        const resolved = {
            name: dispName,
            fullName,
            lat: matched.latitude,
            lon: matched.longitude,
            isAuto: true,
            language: getLocale(),
            timestamp: now
        };
        return hasWeatherCoordinates(resolved) ? resolved : null;
    } catch {
        return null;
    }
}

/**
 * @param {number} now
 * @param {AbortSignal} signal
 * @returns {Promise<import('../types').WeatherLocation>}
 */
async function executeResolveWeatherLocation(now, signal) {
    if (getLocale() !== 'en') {
        const zhLocation = await resolveZhIpLocation(now, signal);
        if (zhLocation) return zhLocation;
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
                fullName,
                lat: data.latitude,
                lon: data.longitude,
                isAuto: true,
                language: getLocale(),
                timestamp: now
            };
            if (hasWeatherCoordinates(resolved)) return resolved;
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

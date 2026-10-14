/**
 * ==============================================================================
 * Glass Start — 气象引擎与 9 阶动态演化 (src/js/modules/weather.js)
 * ==============================================================================
 *
 * 核心功能：
 * 1. 气象数值净化与信任边界防御 (weatherNum, weatherTime, fetchWithTimeout)
 * 2. 气象弹窗开关与 OverlayStack 联动 (openWeatherPopover, closeWeatherPopover, toggleWeatherPopover)
 * 3. 多级行政区划消歧算法 (formatLocationFullName, stripAdminSuffix)
 * 4. 自动/静默 IP 定位与 Open-Meteo 高精度气象拉取 (resolveWeatherLocation, fetchWeatherForecast)
 * 5. 胶囊与弹窗渲染、9 阶动态形态演化 (renderWeatherCapsule, renderWeatherPopover, renderWeatherError)
 * 6. 缓存有效性校验与生命周期对齐 (updateWeather, initWeather)
 */
import { CONFIG } from '../config/constants.js';
import { weatherNum } from '../utils/weather-data.js';
export { weatherNum } from '../utils/weather-data.js';
import { escapeHtml, storageGet, storageSet, storageRemove } from '../utils/helpers.js';
import { dom, $ } from '../state/dom.js';
import { OverlayStack } from '../core/overlay-stack.js';

export const WMO_WEATHER_MAP = {
    0: { text: '晴', dayIcon: '☀️', nightIcon: '🌙' },
    1: { text: '晴间多云', dayIcon: '🌤️', nightIcon: '🌙' },
    2: { text: '多云', dayIcon: '⛅', nightIcon: '☁️' },
    3: { text: '阴', dayIcon: '☁️', nightIcon: '☁️' },
    45: { text: '雾', dayIcon: '🌫️', nightIcon: '🌫️' },
    48: { text: '雾凇', dayIcon: '🌫️', nightIcon: '🌫️' },
    51: { text: '毛毛雨', dayIcon: '🌦️', nightIcon: '🌧️' },
    53: { text: '小雨', dayIcon: '🌧️', nightIcon: '🌧️' },
    55: { text: '中雨', dayIcon: '🌧️', nightIcon: '🌧️' },
    56: { text: '冻雨', dayIcon: '🌧️', nightIcon: '🌧️' },
    57: { text: '强冻雨', dayIcon: '🌧️', nightIcon: '🌧️' },
    61: { text: '小雨', dayIcon: '🌧️', nightIcon: '🌧️' },
    63: { text: '中雨', dayIcon: '🌧️', nightIcon: '🌧️' },
    65: { text: '大雨', dayIcon: '🌧️', nightIcon: '🌧️' },
    66: { text: '冻雨', dayIcon: '🌧️', nightIcon: '🌧️' },
    67: { text: '暴雨', dayIcon: '⛈️', nightIcon: '⛈️' },
    71: { text: '小雪', dayIcon: '🌨️', nightIcon: '🌨️' },
    73: { text: '中雪', dayIcon: '🌨️', nightIcon: '🌨️' },
    75: { text: '大雪', dayIcon: '❄️', nightIcon: '❄️' },
    77: { text: '雪粒', dayIcon: '🌨️', nightIcon: '🌨️' },
    80: { text: '阵雨', dayIcon: '🌦️', nightIcon: '🌧️' },
    81: { text: '中度阵雨', dayIcon: '🌧️', nightIcon: '🌧️' },
    82: { text: '强阵雨', dayIcon: '⛈️', nightIcon: '⛈️' },
    85: { text: '阵雪', dayIcon: '🌨️', nightIcon: '🌨️' },
    86: { text: '大阵雪', dayIcon: '❄️', nightIcon: '❄️' },
    95: { text: '雷阵雨', dayIcon: '⛈️', nightIcon: '⛈️' },
    96: { text: '雷雨伴冰雹', dayIcon: '⛈️', nightIcon: '⛈️' },
    99: { text: '强雷雨伴冰雹', dayIcon: '⛈️', nightIcon: '⛈️' }
};

export function getWeatherInfo(code, isDay = true) {
    const item = WMO_WEATHER_MAP[code] || { text: '多云', dayIcon: '⛅', nightIcon: '☁️' };
    return {
        text: item.text,
        icon: isDay ? item.dayIcon : item.nightIcon
    };
}

export function weatherTime(v) {
    return (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v.trim())) ? v.trim() : '--:--';
}

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

export function formatLocationFullName(parts) {
    const cleaned = parts
        .filter(p => p && typeof p === 'string')
        .map(p => p.trim())
        .filter(Boolean);

    const result = [];
    for (let i = 0; i < cleaned.length; i++) {
        const current = cleaned[i];
        if (result.length === 0) {
            result.push(current);
            continue;
        }
        const prev = result[result.length - 1];

        if (prev.toLowerCase() === current.toLowerCase()) {
            continue;
        }

        const isProvinceAndCity = (prev.endsWith('省') || prev.endsWith('州')) && (current.endsWith('市') || current.endsWith('区') || current.endsWith('县'));
        const isPrefixMatch = (prev.startsWith(current) || current.startsWith(prev));

        if (!isProvinceAndCity && isPrefixMatch) {
            if (current.length > prev.length) {
                result[result.length - 1] = current;
            }
            continue;
        }

        result.push(current);
    }
    return result.join(' · ');
}

export function stripAdminSuffix(name, includeProvince = false) {
    if (!name || typeof name !== 'string') return '';
    const pattern = includeProvince
        ? /(省|市|区|县|特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区)$/
        : /(市|区|县|特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区)$/;
    return name.replace(pattern, '') || name;
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
                            let matched = results.find(r => {
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

export async function fetchWeatherForecast(loc) {
    const lat = loc.lat;
    const lon = loc.lon;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max&timezone=auto`;
    const res = await fetchWithTimeout(url, CONFIG.WEATHER.TIMEOUT_WEATHER);
    if (!res.ok) throw new Error('Open-Meteo request failed');
    const data = await res.json();

    const cur = data.current || {};
    const isDay = cur.is_day === 1;
    const wInfo = getWeatherInfo(cur.weather_code, isDay);
    const daily = data.daily || {};

    const days = [];
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    if (daily.time && Array.isArray(daily.time)) {
        for (let i = 0; i < Math.min(daily.time.length, CONFIG.WEATHER.FORECAST_FETCH_DAYS); i++) {
            const timeStr = daily.time[i] || '';
            const parts = timeStr.split('-').map(Number);
            const dDate = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date(timeStr);
            let dayCode = daily.weather_code ? daily.weather_code[i] : 0;

            if (i === 0) {
                const todayPop = (daily.precipitation_probability_max && daily.precipitation_probability_max[0] != null) ? daily.precipitation_probability_max[0] : 0;
                const isPrecipCode = dayCode >= CONFIG.WEATHER.PRECIP_CODE_START;
                const isCurRaining = (cur.precipitation && cur.precipitation > 0) || (cur.weather_code >= CONFIG.WEATHER.PRECIP_CODE_START);
                if (isPrecipCode && !isCurRaining && todayPop < CONFIG.WEATHER.POP_CLEAR_CONFLICT_THRESHOLD) {
                    dayCode = (cur.weather_code != null) ? cur.weather_code : 1;
                }
            }

            const dwInfo = getWeatherInfo(dayCode, true);
            const wLabel = i === 0 ? '今天' : i === 1 ? '明天' : (weekDays[dDate.getDay()] || `${dDate.getMonth() + 1}/${dDate.getDate()}`);
            days.push({
                date: daily.time[i],
                label: wLabel,
                icon: dwInfo.icon,
                text: dwInfo.text,
                tempMax: Math.round(daily.temperature_2m_max[i]),
                tempMin: Math.round(daily.temperature_2m_min[i])
            });
        }
    }

    const sunriseStr = daily.sunrise && daily.sunrise[0] ? daily.sunrise[0].split('T')[1] : '--:--';
    const sunsetStr = daily.sunset && daily.sunset[0] ? daily.sunset[0].split('T')[1] : '--:--';
    const sunriseTomStr = daily.sunrise && daily.sunrise[1] ? daily.sunrise[1].split('T')[1] : sunriseStr;
    const sunsetTomStr = daily.sunset && daily.sunset[1] ? daily.sunset[1].split('T')[1] : sunsetStr;

    return {
        timestamp: Date.now(),
        location: loc,
        current: {
            temp: Math.round(cur.temperature_2m ?? CONFIG.WEATHER.DEFAULT_TEMPERATURE),
            apparent: Math.round(cur.apparent_temperature ?? cur.temperature_2m ?? CONFIG.WEATHER.DEFAULT_TEMPERATURE),
            weatherCode: cur.weather_code ?? 0,
            weatherText: wInfo.text,
            icon: wInfo.icon,
            isDay: isDay,
            humidity: Math.round(cur.relative_humidity_2m ?? CONFIG.WEATHER.DEFAULT_HUMIDITY),
            windSpeed: Math.round((cur.wind_speed_10m ?? 0) * 10) / 10,
            precipitation: cur.precipitation ?? 0,
            pop: (daily.precipitation_probability_max && daily.precipitation_probability_max[0] != null) ? Math.round(daily.precipitation_probability_max[0]) : 0,
            sunrise: sunriseStr,
            sunset: sunsetStr,
            sunriseToday: sunriseStr,
            sunsetToday: sunsetStr,
            sunriseTomorrow: sunriseTomStr,
            sunsetTomorrow: sunsetTomStr
        },
        daily: days
    };
}

export function renderWeatherCapsule(data) {
    const weatherWidget = dom.weatherWidget || $('weatherWidget');
    if (!weatherWidget || !data || !data.current) return;
    const weatherIcon = dom.weatherIcon || $('weatherIcon');
    const weatherTemp = dom.weatherTemp || $('weatherTemp');
    const weatherCity = dom.weatherCity || $('weatherCity');
    const weatherBtn = dom.weatherBtn || $('weatherBtn');
    const temperature = Math.round(weatherNum(data.current.temp, 0));

    if (weatherIcon && weatherIcon.textContent !== data.current.icon) weatherIcon.textContent = data.current.icon;
    if (weatherTemp) {
        const tempStr = `${temperature}°`;
        if (weatherTemp.textContent !== tempStr) weatherTemp.textContent = tempStr;
    }
    if (weatherCity) {
        const cityName = data.location ? data.location.name : '天气';
        if (weatherCity.textContent !== cityName) weatherCity.textContent = cityName;
        weatherCity.title = data.location ? data.location.fullName : '';
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
            <div class="text-base">📡</div>
            <div class="text-xs text-white/80 font-medium">天气获取失败</div>
            <div class="text-2xs text-white/50 leading-relaxed">网络异常或定位受阻，请检查网络后重试</div>
            <button id="weatherErrorRetryBtn" type="button" class="mt-1 px-3.5 py-1.5 bg-white/10 hover:bg-white/20 border border-white/15 text-xs rounded-xl text-white transition flex items-center justify-center gap-1.5 mx-auto active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
                <span>🔄</span> 重新加载
            </button>
        </div>
    `;
    const retryBtn = weatherPopover.querySelector('#weatherErrorRetryBtn');
    if (retryBtn) {
        retryBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            retryBtn.disabled = true;
            retryBtn.innerHTML = '<span>🔄</span> 正在重试...';
            updateWeather(true);
        });
    }
}

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
    const loc = data.location || {};
    const days = (Array.isArray(data.daily) ? data.daily : []).filter(isWeatherRecord).map(d => ({
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
        const parseMins = (str) => {
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
                <span class="text-xs text-white/50 shrink-0">📍</span>
                <span class="text-xs font-semibold text-white/90 truncate" title="${escapeHtml(loc.fullName || loc.name)}">${escapeHtml(loc.fullName || loc.name)}</span>
            </div>
            <button id="weatherRefreshBtn" type="button" class="size-7 apple-radius bg-white/5 hover:bg-white/15 text-white flex items-center justify-center glass-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none" title="立即刷新天气" aria-label="立即刷新天气">
                <svg class="size-3.5 opacity-70 hover:opacity-100 transition-opacity" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>
            </button>
        </div>

        <div class="flex items-center justify-between mb-3 px-1">
            <div class="flex items-center gap-3">
                <span class="text-3xl sm:text-4xl leading-none select-none">${escapeHtml(c.icon)}</span>
                <div>
                    <div class="text-2xl font-bold tracking-tight text-white leading-none">${c.temp}<span class="text-base font-normal text-white/70">°C</span></div>
                    <div class="text-xs text-white/75 mt-1">${escapeHtml(c.weatherText)} · 体感 ${c.apparent}°C</div>
                </div>
            </div>
            ${days[0] ? `<div class="text-right text-xs text-white/60"><div>最高 ${days[0].tempMax}°</div><div class="mt-0.5">最低 ${days[0].tempMin}°</div></div>` : ''}
        </div>

        <div class="grid grid-cols-2 gap-2 mb-3">
            ${weatherCard(humIcon, '相对湿度', c.humidity + '%')}
            ${weatherCard(windIcon, '实时风速', c.windSpeed + ' km/h')}
            ${weatherCard(popIcon, '降水概率', popVal + '%')}
            ${weatherCard(sunIcon, sunLabel, sunTime)}
        </div>

        <div class="space-y-1.5 pt-2 border-t border-white/10">
            <div class="text-2xs text-white/50 font-medium px-1 mb-1">未来几天预报</div>
            ${days.slice(0, CONFIG.WEATHER.FORECAST_DISPLAY_DAYS).map(d => `
                <div class="flex items-center justify-between text-xs py-1 px-1.5 apple-radius hover:bg-white/5 transition-colors">
                    <span class="w-10 text-white/70 font-medium shrink-0">${escapeHtml(d.label)}</span>
                    <div class="flex items-center gap-2 flex-1 min-w-0 pl-7 sm:pl-8">
                        <span class="w-5 text-center select-none shrink-0">${escapeHtml(d.icon)}</span>
                        <span class="text-2xs text-white/60 truncate">${escapeHtml(d.text)}</span>
                    </div>
                    <span class="w-16 text-right tabular-nums text-white/80 shrink-0">${d.tempMin}° ~ ${d.tempMax}°</span>
                </div>
            `).join('')}
        </div>
    `;

    const refBtn = weatherPopover.querySelector('#weatherRefreshBtn');
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
                    const currentRefBtn = currentPop ? currentPop.querySelector('#weatherRefreshBtn') : null;
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

const isWeatherRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

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
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            updateWeather(false).catch(() => {});
        }
    }, { passive: true });
}

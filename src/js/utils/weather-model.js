// @ts-check
/** 天气代码、地点名称与预报数据转换，不依赖 DOM、网络或存储。 */
/** @type {Record<number, {dayIcon: string, nightIcon: string}>} */
const WMO_WEATHER_ICONS = {
    0: { dayIcon: '☀️', nightIcon: '🌙' },
    1: { dayIcon: '🌤️', nightIcon: '🌙' },
    2: { dayIcon: '⛅', nightIcon: '☁️' },
    3: { dayIcon: '☁️', nightIcon: '☁️' },
    45: { dayIcon: '🌫️', nightIcon: '🌫️' },
    48: { dayIcon: '🌫️', nightIcon: '🌫️' },
    51: { dayIcon: '🌧️', nightIcon: '🌧️' },
    53: { dayIcon: '🌧️', nightIcon: '🌧️' },
    55: { dayIcon: '🌧️', nightIcon: '🌧️' },
    56: { dayIcon: '🌧️', nightIcon: '🌧️' },
    57: { dayIcon: '🌧️', nightIcon: '🌧️' },
    61: { dayIcon: '🌧️', nightIcon: '🌧️' },
    63: { dayIcon: '🌧️', nightIcon: '🌧️' },
    65: { dayIcon: '🌧️', nightIcon: '🌧️' },
    66: { dayIcon: '🌧️', nightIcon: '🌧️' },
    67: { dayIcon: '🌧️', nightIcon: '🌧️' },
    71: { dayIcon: '🌨️', nightIcon: '🌨️' },
    73: { dayIcon: '🌨️', nightIcon: '🌨️' },
    75: { dayIcon: '🌨️', nightIcon: '🌨️' },
    77: { dayIcon: '🌨️', nightIcon: '🌨️' },
    80: { dayIcon: '🌦️', nightIcon: '🌧️' },
    81: { dayIcon: '🌧️', nightIcon: '🌧️' },
    82: { dayIcon: '🌧️', nightIcon: '🌧️' },
    85: { dayIcon: '🌨️', nightIcon: '🌨️' },
    86: { dayIcon: '🌨️', nightIcon: '🌨️' },
    95: { dayIcon: '⛈️', nightIcon: '⛈️' },
    96: { dayIcon: '⛈️', nightIcon: '⛈️' },
    97: { dayIcon: '⛈️', nightIcon: '⛈️' },
    99: { dayIcon: '⛈️', nightIcon: '⛈️' }
};

/** @param {number | undefined} code @param {boolean} [isDay] */
function getWeatherIcon(code, isDay = true) {
    const item = (code === undefined ? undefined : WMO_WEATHER_ICONS[code]) || { dayIcon: '⛅', nightIcon: '☁️' };
    return isDay ? item.dayIcon : item.nightIcon;
}

/** @param {unknown} v */
export function weatherTime(v) {
    return (typeof v === 'string' && /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(v.trim())) ? v.trim() : '--:--';
}

/** @param {unknown[]} parts */
export function formatLocationFullName(parts) {
    const cleaned = parts
        .filter(p => typeof p === 'string')
        .map(p => p.trim())
        .filter(Boolean);

    /** @type {string[]} */
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

const CITY_SUFFIX_RE = /(市|区|县|旗)$/;
const ALL_ADMIN_SUFFIX_RE = /(特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|省|市|区|县|旗)$/;

/** @param {unknown} name @param {boolean} [includeProvince] */
export function stripAdminSuffix(name, includeProvince = false) {
    if (!name || typeof name !== 'string') return '';
    const pattern = includeProvince ? ALL_ADMIN_SUFFIX_RE : CITY_SUFFIX_RE;
    return name.replace(pattern, '') || name;
}

/** @param {unknown} value @param {number} [scale] */
function rounded(value, scale = 1) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * scale) / scale : undefined;
}

/** 将天气响应转换为实况与按地点日期组织的预报。
 * @param {Record<string, any>} data
 * @param {import('../types').WeatherLocation} loc
 * @param {import('../types').ForecastOptions} config
 * @param {number} now
 */
export function normalizeWeatherForecast(data, loc, config, now) {
    const current = data.current || {};
    const daily = data.daily || {};
    const dates = /** @type {string[]} */ (Array.isArray(daily.time)
        ? daily.time.slice(0, config.FORECAST_FETCH_DAYS) : []);
    return {
        timestamp: now,
        ...(typeof data.timezone === 'string' ? { timezone: data.timezone } : {}),
        location: loc,
        current: {
            temp: rounded(current.temperature_2m),
            apparent: rounded(current.apparent_temperature),
            weatherCode: rounded(current.weather_code),
            icon: getWeatherIcon(current.weather_code, current.is_day === 1),
            humidity: rounded(current.relative_humidity_2m),
            windSpeed: rounded(current.wind_speed_10m, 10)
        },
        daily: dates.map((date, i) => ({
            date,
            weatherCode: rounded(daily.weather_code?.[i]),
            icon: getWeatherIcon(daily.weather_code?.[i]),
            tempMax: rounded(daily.temperature_2m_max?.[i]),
            tempMin: rounded(daily.temperature_2m_min?.[i]),
            pop: rounded(daily.precipitation_probability_max?.[i]),
            sunrise: daily.sunrise?.[i],
            sunset: daily.sunset?.[i]
        }))
    };
}

/** @param {Date} date @param {string} [timeZone] */
function weatherLocalTime(date, timeZone) {
    let formatter;
    const options = /** @type {Intl.DateTimeFormatOptions} */ ({
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        hourCycle: 'h23', calendar: 'gregory'
    });
    try { formatter = new Intl.DateTimeFormat('en-GB', { ...options, timeZone }); }
    catch { formatter = new Intl.DateTimeFormat('en-GB', options); }
    const { year, month, day, hour, minute } = Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
    return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

/** @param {string} date */
function nextWeatherDate(date) {
    const next = new Date(date + 'T00:00:00Z');
    next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString().slice(0, 10);
}

/** @param {import('../types').WeatherData} data @param {Date} now */
export function getForecastPeriod(data, now) {
    const local = weatherLocalTime(now, data.timezone);
    const tomorrow = nextWeatherDate(local.date);
    const saved = new Date(data.timestamp ?? NaN);
    const savedDate = Number.isFinite(saved.getTime()) ? weatherLocalTime(saved, data.timezone).date : local.date;
    const days = (data.daily || []).filter(day => day.date ? day.date >= local.date : savedDate === local.date);
    const today = days.find(day => day.date === local.date) ?? days.find(day => !day.date);
    const upcoming = days.flatMap(day => [
        { kind: 'sunrise', dateTime: day.sunrise },
        { kind: 'sunset', dateTime: day.sunset }
    ]);
    // 旧记录的无日期时刻以缓存生成日为准。
    upcoming.push(
        { kind: 'sunrise', dateTime: savedDate + 'T' + weatherTime(data.current.sunriseToday).padStart(5, '0') },
        { kind: 'sunset', dateTime: savedDate + 'T' + weatherTime(data.current.sunsetToday).padStart(5, '0') },
        { kind: 'sunrise', dateTime: nextWeatherDate(savedDate) + 'T' + weatherTime(data.current.sunriseTomorrow).padStart(5, '0') }
    );
    const cutoff = local.date + 'T' + local.time;
    const sun = upcoming.filter(event => typeof event.dateTime === 'string'
        && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(event.dateTime)
        && event.dateTime > cutoff)
        .sort((a, b) => (a.dateTime || '').localeCompare(b.dateTime || ''))[0];
    const pop = today?.pop ?? (savedDate === local.date ? data.current.pop : undefined);
    return { date: local.date, tomorrow, days, today, sun, pop };
}

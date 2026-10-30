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
    51: { dayIcon: '🌦️', nightIcon: '🌧️' },
    53: { dayIcon: '🌧️', nightIcon: '🌧️' },
    55: { dayIcon: '🌧️', nightIcon: '🌧️' },
    56: { dayIcon: '🌧️', nightIcon: '🌧️' },
    57: { dayIcon: '🌧️', nightIcon: '🌧️' },
    61: { dayIcon: '🌧️', nightIcon: '🌧️' },
    63: { dayIcon: '🌧️', nightIcon: '🌧️' },
    65: { dayIcon: '🌧️', nightIcon: '🌧️' },
    66: { dayIcon: '🌧️', nightIcon: '🌧️' },
    67: { dayIcon: '⛈️', nightIcon: '⛈️' },
    71: { dayIcon: '🌨️', nightIcon: '🌨️' },
    73: { dayIcon: '🌨️', nightIcon: '🌨️' },
    75: { dayIcon: '❄️', nightIcon: '❄️' },
    77: { dayIcon: '🌨️', nightIcon: '🌨️' },
    80: { dayIcon: '🌦️', nightIcon: '🌧️' },
    81: { dayIcon: '🌧️', nightIcon: '🌧️' },
    82: { dayIcon: '⛈️', nightIcon: '⛈️' },
    85: { dayIcon: '🌨️', nightIcon: '🌨️' },
    86: { dayIcon: '❄️', nightIcon: '❄️' },
    95: { dayIcon: '⛈️', nightIcon: '⛈️' },
    96: { dayIcon: '⛈️', nightIcon: '⛈️' },
    99: { dayIcon: '⛈️', nightIcon: '⛈️' }
};

/** @param {number} code @param {boolean} [isDay] */
function getWeatherIcon(code, isDay = true) {
    const item = WMO_WEATHER_ICONS[code] || { dayIcon: '⛅', nightIcon: '☁️' };
    return isDay ? item.dayIcon : item.nightIcon;
}

/** @param {unknown} v */
export function weatherTime(v) {
    return (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v.trim())) ? v.trim() : '--:--';
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

/** @param {unknown} name @param {boolean} [includeProvince] */
export function stripAdminSuffix(name, includeProvince = false) {
    if (!name || typeof name !== 'string') return '';
    const pattern = includeProvince
        ? /(省|市|区|县|特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区)$/
        : /(市|区|县|特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区)$/;
    return name.replace(pattern, '') || name;
}

/**
 * 将天气响应转换为应用数据；时间由调用方传入，便于独立验证。
 * @param {Record<string, any>} data
 * @param {import('../types').WeatherLocation} loc
 * @param {import('../types').ForecastOptions} config
 * @param {number} now
 */
export function normalizeWeatherForecast(data, loc, config, now) {
    const cur = data.current || {};
    const isDay = cur.is_day === 1;
    const daily = data.daily || {};

    const days = [];
    if (daily.time && Array.isArray(daily.time)) {
        for (let i = 0; i < Math.min(daily.time.length, config.FORECAST_FETCH_DAYS); i++) {
            let dayCode = daily.weather_code ? daily.weather_code[i] : 0;

            if (i === 0) {
                const todayPop = (daily.precipitation_probability_max && daily.precipitation_probability_max[0] != null) ? daily.precipitation_probability_max[0] : 0;
                const isPrecipCode = dayCode >= config.PRECIP_CODE_START;
                const isCurRaining = (cur.precipitation && cur.precipitation > 0) || (cur.weather_code >= config.PRECIP_CODE_START);
                if (isPrecipCode && !isCurRaining && todayPop < config.POP_CLEAR_CONFLICT_THRESHOLD) {
                    dayCode = (cur.weather_code != null) ? cur.weather_code : 1;
                }
            }

            days.push({
                date: daily.time[i],
                weatherCode: dayCode,
                icon: getWeatherIcon(dayCode),
                tempMax: Math.round(daily.temperature_2m_max?.[i] ?? cur.temperature_2m ?? config.DEFAULT_TEMPERATURE),
                tempMin: Math.round(daily.temperature_2m_min?.[i] ?? cur.temperature_2m ?? config.DEFAULT_TEMPERATURE)
            });
        }
    }

    const sunriseStr = daily.sunrise && daily.sunrise[0] ? daily.sunrise[0].split('T')[1] : '--:--';
    const sunsetStr = daily.sunset && daily.sunset[0] ? daily.sunset[0].split('T')[1] : '--:--';
    const sunriseTomStr = daily.sunrise && daily.sunrise[1] ? daily.sunrise[1].split('T')[1] : sunriseStr;
    const sunsetTomStr = daily.sunset && daily.sunset[1] ? daily.sunset[1].split('T')[1] : sunsetStr;

    return {
        timestamp: now,
        location: loc,
        current: {
            temp: Math.round(cur.temperature_2m ?? config.DEFAULT_TEMPERATURE),
            apparent: Math.round(cur.apparent_temperature ?? cur.temperature_2m ?? config.DEFAULT_TEMPERATURE),
            weatherCode: cur.weather_code ?? 0,
            icon: getWeatherIcon(cur.weather_code, isDay),
            isDay: isDay,
            humidity: Math.round(cur.relative_humidity_2m ?? config.DEFAULT_HUMIDITY),
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

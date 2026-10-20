// @ts-check
/** 天气代码、地点名称与预报数据转换，不依赖 DOM、网络或存储。 */
/** @type {Record<number, {text: string, dayIcon: string, nightIcon: string}>} */
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

/** @param {number} code @param {boolean} [isDay] */
function getWeatherInfo(code, isDay = true) {
    const item = WMO_WEATHER_MAP[code] || { text: '多云', dayIcon: '⛅', nightIcon: '☁️' };
    return {
        text: item.text,
        icon: isDay ? item.dayIcon : item.nightIcon
    };
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
    const wInfo = getWeatherInfo(cur.weather_code, isDay);
    const daily = data.daily || {};

    const days = [];
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    if (daily.time && Array.isArray(daily.time)) {
        for (let i = 0; i < Math.min(daily.time.length, config.FORECAST_FETCH_DAYS); i++) {
            const timeStr = daily.time[i] || '';
            const parts = timeStr.split('-').map(Number);
            const dDate = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date(timeStr);
            let dayCode = daily.weather_code ? daily.weather_code[i] : 0;

            if (i === 0) {
                const todayPop = (daily.precipitation_probability_max && daily.precipitation_probability_max[0] != null) ? daily.precipitation_probability_max[0] : 0;
                const isPrecipCode = dayCode >= config.PRECIP_CODE_START;
                const isCurRaining = (cur.precipitation && cur.precipitation > 0) || (cur.weather_code >= config.PRECIP_CODE_START);
                if (isPrecipCode && !isCurRaining && todayPop < config.POP_CLEAR_CONFLICT_THRESHOLD) {
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
            weatherText: wInfo.text,
            icon: wInfo.icon,
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

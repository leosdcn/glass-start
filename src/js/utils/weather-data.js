/** 首帧缓存恢复和运行时共用的气象数值清洗与单位换算规则。 */
/** @param {string | null} value 已存储的温度单位，兼容 JSON 字符串。 */
export function parseTempUnit(value) {
    return value === 'F' || value === '"F"' ? 'F' : 'C';
}

/** @param {unknown} value @param {number} fallback @returns {number} */
export function weatherNum(value, fallback) {
    if (typeof value !== 'number' && typeof value !== 'string') return fallback;
    if (typeof value === 'string' && value.trim() === '') return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

/**
 * 将摄氏度转换为当前显示单位的数值
 * @param {unknown} celsius
 * @param {'C' | 'F' | string} [unit]
 * @returns {number | '--'}
 */
export function toDisplayTemp(celsius, unit = 'C') {
    const c = weatherNum(celsius, NaN);
    if (!Number.isFinite(c)) return '--';
    const val = unit === 'F' ? Math.round(c * 1.8 + 32) : Math.round(c);
    return Object.is(val, -0) ? 0 : val;
}

/** @param {unknown} value @returns {value is string} */
export function isForecastDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** @param {import('../types').WeatherData | null} data */
export function isUsableWeatherData(data) {
    const current = data?.current;
    const daily = data?.daily;
    const isRecord = (/** @type {unknown} */ value) => !!value && typeof value === 'object' && !Array.isArray(value);
    if (!current || !isRecord(current) || data?.location?.isFallback ||
        (data?.timestamp !== undefined && !Number.isFinite(data.timestamp)) ||
        [current.icon, data?.location?.name, data?.location?.fullName].some(value => value !== undefined && typeof value !== 'string') ||
        (daily !== undefined && (!Array.isArray(daily) ||
            !daily.every(day => isRecord(day) && (day.date === undefined || day.date === '' || isForecastDate(day.date)))))) return false;
    const isMeasurement = (/** @type {unknown} */ value) => Number.isFinite(weatherNum(value, NaN));
    return ([current.temp, current.apparent, current.weatherCode, current.humidity, current.windSpeed,
        current.pop, current.precipitation].some(isMeasurement) ||
        typeof current.weatherText === 'string' && !!current.weatherText.trim() ||
        !!daily?.some(day => [day.tempMin, day.tempMax, day.weatherCode, day.pop].some(isMeasurement) ||
            typeof day.text === 'string' && !!day.text.trim()));
}

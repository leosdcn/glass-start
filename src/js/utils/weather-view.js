import { t, weatherDescription } from '../core/i18n.js';
import { WEATHER_EMOJI_MAP } from '../config/weather-icons.js';
import { escapeHtml, safeUrl } from './helpers.js';
import { toDisplayTemp } from './weather-data.js';

/** @param {string} icon */
function weatherIconPath(icon) {
    const key = icon.trim();
    if (Object.hasOwn(WEATHER_EMOJI_MAP, key)) return WEATHER_EMOJI_MAP[key];
    // 旧缓存允许使用同源图标路径。未知缓存值只作为文本显示。
    return /^(?:\.\/|\/)?icons\//.test(key) && safeUrl(key, false) !== '#' ? key : '';
}

/** @param {string} icon @param {string} path @param {string} className */
function weatherImageHTML(icon, path, className) {
    return `<img src="${safeUrl(path)}" class="${className} shrink-0 object-contain select-none inline-block align-middle pointer-events-none" alt="" aria-hidden="true" decoding="async"><span class="sr-only" aria-hidden="true">${escapeHtml(icon.trim())}</span>`;
}

/** @param {string} icon @param {string} [className] */
export function getWeatherIconHTML(icon, className = 'size-4') {
    const path = weatherIconPath(icon);
    return path ? weatherImageHTML(icon, path, className) : escapeHtml(icon);
}

/**
 * @param {Partial<Pick<import('../types').DOMCache, 'weatherIcon' | 'weatherTemp' | 'weatherCity'>> & {weatherBtn?: HTMLElement | null}} elements
 * @param {import('../types').WeatherData | null | undefined} data
 * @param {'C' | 'F'} unit
 */
export function renderWeatherCapsuleView({ weatherIcon, weatherTemp, weatherCity, weatherBtn }, data, unit) {
    const current = data?.current;
    const temperature = toDisplayTemp(current?.temp, unit);
    const city = data?.location?.name || t('ui.weather');
    const icon = current?.icon || '🌤️';

    if (weatherIcon && weatherIcon.dataset.icon !== icon) {
        weatherIcon.dataset.icon = icon;
        const path = weatherIconPath(icon);
        if (path) weatherIcon.innerHTML = weatherImageHTML(icon, path, 'size-4 sm:size-4.5');
        else weatherIcon.textContent = icon;
    }
    if (weatherTemp && weatherTemp.textContent !== temperature + '°') weatherTemp.textContent = temperature + '°';
    if (weatherCity) {
        if (weatherCity.textContent !== city) weatherCity.textContent = city;
        const title = data?.location?.fullName || '';
        if (weatherCity.title !== title) weatherCity.title = title;
        weatherCity.removeAttribute('data-i18n');
    }
    if (weatherBtn) {
        const label = current
            ? t('weather.capsule', { temperature, city, description: weatherDescription(current.weatherCode) })
            : t('ui.weather.open.current.conditions.and.forecast');
        if (weatherBtn.getAttribute('aria-label') !== label) weatherBtn.setAttribute('aria-label', label);
        weatherBtn.removeAttribute('data-i18n-aria-label');
    }
}

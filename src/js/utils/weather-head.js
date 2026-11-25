import { WEATHER_CACHE_KEY } from '../config/weather-icons.js';
import { isUsableWeatherData, getWeatherTempUnit } from './weather-data.js';
import { storageGet } from './storage.js';
import { renderWeatherCapsuleView } from './weather-view.js';

/** @param {Parameters<typeof renderWeatherCapsuleView>[0]} elements */
export function renderCachedWeatherCapsule(elements) {
    const cached = storageGet(WEATHER_CACHE_KEY);
    renderWeatherCapsuleView(elements, isUsableWeatherData(cached) ? cached : null, getWeatherTempUnit());
}

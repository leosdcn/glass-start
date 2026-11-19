import { WEATHER_CACHE_KEY } from '../config/weather-icons.js';
import { isUsableWeatherData, getWeatherTempUnit } from './weather-data.js';
import { storageGet } from './storage.js';
import { renderWeatherCapsuleView } from './weather-view.js';

export function renderCachedWeatherCapsule() {
    const cached = storageGet(WEATHER_CACHE_KEY);
    renderWeatherCapsuleView({
        weatherIcon: document.getElementById('weatherIcon'),
        weatherTemp: document.getElementById('weatherTemp'),
        weatherCity: document.getElementById('weatherCity'),
        weatherBtn: document.getElementById('weatherBtn')
    }, isUsableWeatherData(cached) ? cached : null, getWeatherTempUnit());
}

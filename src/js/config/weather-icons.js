/**
 * 天气 Emoji / 本地 SVG 图标映射：首屏预渲染与运行时共用，由构建注入 index.html。
 * 新增映射时 lint 会校验本地图标文件存在。
 * @type {Readonly<Record<string, string>>}
 */
export const WEATHER_EMOJI_MAP = Object.freeze({
  "☀️": "./icons/weather/sun.svg",
  "🌙": "./icons/weather/moon.svg",
  "🌤️": "./icons/weather/sun_cloud.svg",
  "🌤": "./icons/weather/sun_cloud.svg",
  "⛅": "./icons/weather/partly_cloudy.svg",
  "☁️": "./icons/weather/cloud.svg",
  "☁": "./icons/weather/cloud.svg",
  "🌫️": "./icons/weather/fog.svg",
  "🌫": "./icons/weather/fog.svg",
  "🌦️": "./icons/weather/drizzle.svg",
  "🌦": "./icons/weather/drizzle.svg",
  "🌧️": "./icons/weather/rain.svg",
  "🌧": "./icons/weather/rain.svg",
  "⛈️": "./icons/weather/thunder.svg",
  "⛈": "./icons/weather/thunder.svg",
  "🌨️": "./icons/weather/snow.svg",
  "🌨": "./icons/weather/snow.svg",
  "❄️": "./icons/weather/snowflake.svg",
  "❄": "./icons/weather/snowflake.svg",
  "📍": "./icons/weather/pin.svg",
  "💦": "./icons/weather/humidity_high.svg",
  "💧": "./icons/weather/humidity_mid.svg",
  "🌵": "./icons/weather/humidity_low.svg",
  "🍃": "./icons/weather/wind_low.svg",
  "🌪️": "./icons/weather/wind_high.svg",
  "🌪": "./icons/weather/wind_high.svg",
  "🎏": "./icons/weather/wind_mid.svg",
  "🌂": "./icons/weather/umbrella.svg",
  "☔️": "./icons/weather/umbrella_rain.svg",
  "☔": "./icons/weather/umbrella_rain.svg",
  "☂️": "./icons/weather/umbrella_open.svg",
  "☂": "./icons/weather/umbrella_open.svg",
  "🌅": "./icons/weather/sunset.svg",
  "🌄": "./icons/weather/sunrise_mountains.svg",
  "📡": "./icons/weather/satellite.svg",
  "🔄": "./icons/weather/reload.svg"
});

/**
 * 天气 Emoji / 本地 SVG 图标映射：首屏预渲染与运行时共用，由构建注入 index.html。
 * 新增映射时 lint 会校验本地图标文件存在。
 * @type {Readonly<Record<string, string>>}
 */
export const WEATHER_EMOJI_MAP = Object.freeze({
  "☀️": "./icons/emoji/sun.svg",
  "🌙": "./icons/emoji/crescent_moon.svg",
  "🌤️": "./icons/emoji/sun_behind_small_cloud.svg",
  "🌤": "./icons/emoji/sun_behind_small_cloud.svg",
  "⛅": "./icons/emoji/sun_behind_cloud.svg",
  "☁️": "./icons/emoji/cloud.svg",
  "☁": "./icons/emoji/cloud.svg",
  "🌫️": "./icons/emoji/fog.svg",
  "🌫": "./icons/emoji/fog.svg",
  "🌦️": "./icons/emoji/sun_behind_rain_cloud.svg",
  "🌦": "./icons/emoji/sun_behind_rain_cloud.svg",
  "🌧️": "./icons/emoji/cloud_with_rain.svg",
  "🌧": "./icons/emoji/cloud_with_rain.svg",
  "⛈️": "./icons/emoji/cloud_with_lightning_rain.svg",
  "⛈": "./icons/emoji/cloud_with_lightning_rain.svg",
  "🌨️": "./icons/emoji/cloud_with_snow.svg",
  "🌨": "./icons/emoji/cloud_with_snow.svg",
  "❄️": "./icons/emoji/snowflake.svg",
  "❄": "./icons/emoji/snowflake.svg",
  "📍": "./icons/emoji/round_pushpin.svg",
  "💦": "./icons/emoji/sweat_drops.svg",
  "💧": "./icons/emoji/droplet.svg",
  "🌵": "./icons/emoji/cactus.svg",
  "🍃": "./icons/emoji/leaf_fluttering.svg",
  "🌪️": "./icons/emoji/tornado.svg",
  "🌪": "./icons/emoji/tornado.svg",
  "🎏": "./icons/emoji/carp_streamer.svg",
  "🌂": "./icons/emoji/closed_umbrella.svg",
  "☔️": "./icons/emoji/umbrella_rain_drops.svg",
  "☔": "./icons/emoji/umbrella_rain_drops.svg",
  "☂️": "./icons/emoji/umbrella.svg",
  "☂": "./icons/emoji/umbrella.svg",
  "🌅": "./icons/emoji/sunset.svg",
  "🌄": "./icons/emoji/sunrise_over_mountains.svg",
  "📡": "./icons/emoji/satellite_antenna.svg",
  "🔄": "./icons/emoji/arrows_counterclockwise.svg"
});

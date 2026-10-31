import { getLocale } from '../core/i18n.js';
export const DEFAULT_ENGINE = getLocale() === 'en' ? 'google' : 'bing';
// 搜索引擎元数据与首屏预渲染共用；SVG 图标见 engine-icons.js，避免运行时打包大段图标。
export const ENGINE_META = Object.freeze({
    bing: Object.freeze({ name: 'Bing', url: 'https://www.bing.com/search?q=' }),
    google: Object.freeze({ name: 'Google', url: 'https://www.google.com/search?q=' }),
    wikipedia: Object.freeze({ name: 'Wikipedia', url: `https://${getLocale() === 'en' ? 'en' : 'zh'}.wikipedia.org/w/index.php?search=` })
});

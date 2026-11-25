import { getLocale } from '../core/i18n.js';
export const PREFERRED_ENGINE_KEY = 'preferredEngine';
export function getDefaultEngine() {
    return getLocale() === 'en' ? 'google' : 'bing';
}
// 搜索引擎元数据与首屏预渲染共用；SVG 图标见 engine-icons.js，避免运行时打包大段图标。
export const ENGINE_META = Object.freeze({
    bing: Object.freeze({ name: 'Bing', url: 'https://www.bing.com/search?q=' }),
    google: Object.freeze({ name: 'Google', url: 'https://www.google.com/search?q=' }),
    wikipedia: Object.freeze({
        name: 'Wikipedia',
        get url() { return `https://${getLocale() === 'en' ? 'en' : 'zh'}.wikipedia.org/w/index.php?search=`; }
    })
});

/** @param {unknown} key */
export function normalizeEngine(key) {
    return typeof key === 'string' && Object.hasOwn(ENGINE_META, key) ? key : getDefaultEngine();
}

export const IMAGE_SEARCH_LINKS = Object.freeze({
    bing: 'https://www.bing.com/images/search?view=detailv2&iss=sbi&FORM=SBIIRP&sbisrc=UrlPaste',
    google: 'https://lens.google.com/uploadbyurl'
});

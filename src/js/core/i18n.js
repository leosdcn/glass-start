import { LANGUAGE_KEY, SUPPORTED_LANGUAGES } from '../config/language.js';

/** @param {unknown} preference @param {readonly string[]} languages */
export function resolveLocale(preference, languages) {
    if (typeof preference === 'string' && SUPPORTED_LANGUAGES.includes(preference)) return preference;
    for (const language of languages) {
        const exact = SUPPORTED_LANGUAGES.find(locale => locale.toLowerCase() === language.toLowerCase());
        if (exact) return exact;
        const base = language.split('-')[0].toLowerCase();
        const match = SUPPORTED_LANGUAGES.find(locale => locale.split('-')[0].toLowerCase() === base);
        if (match) return match;
    }
    return 'en';
}

export function getLanguagePreference() {
    try {
        const value = JSON.parse(localStorage.getItem(LANGUAGE_KEY) || '"auto"');
        return typeof value === 'string' && SUPPORTED_LANGUAGES.includes(value) ? value : 'auto';
    } catch { return 'auto'; }
}

export function getLocale() {
    return typeof window !== 'undefined' && window.__GLASS_I18N__ ? window.__GLASS_I18N__.locale : 'zh-CN';
}

/** @param {string} key @param {Record<string, string | number>} [params] */
export function t(key, params = {}) {
    if (/^cache\.(title|description|action)$/.test(key)) {
        key = `cache.${typeof window !== 'undefined' && window.__GLASS_EXTENSION__ ? 'extension' : 'web'}.${key.slice(6)}`;
    }
    const context = typeof window !== 'undefined' ? window.__GLASS_I18N__ : undefined;
    let message = context?.messages[context.locale]?.[key] ?? context?.messages.en?.[key] ?? key;
    if (typeof message !== 'string') {
        const category = new Intl.PluralRules(getLocale()).select(typeof params.count === 'number' ? params.count : 0);
        message = message[category] || message.other;
    }
    return message.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
}

/** @param {ParentNode} [root] */
export function applyTranslations(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.getAttribute('data-i18n') || '');
    });
    for (const attribute of ['placeholder', 'title', 'aria-label', 'alt', 'content']) {
        root.querySelectorAll(`[data-i18n-${attribute}]`).forEach(el => {
            el.setAttribute(attribute, t(el.getAttribute(`data-i18n-${attribute}`) || ''));
        });
    }
}

/** @param {Date} date @param {Intl.DateTimeFormatOptions} [options] */
export function formatDate(date, options = { month: 'long', day: 'numeric', weekday: 'long' }) {
    return new Intl.DateTimeFormat(getLocale(), options).format(date);
}

/** @param {unknown} code */
export function weatherDescription(code) {
    return typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 99
        && typeof window !== 'undefined' && window.__GLASS_I18N__?.messages.en[`weather.code.${code}`]
        ? t(`weather.code.${code}`) : t('weather.unknown');
}

/** @param {unknown} value @param {number} index */
export function forecastLabel(value, index) {
    if (index === 0) return t('weather.today');
    if (index === 1) return t('weather.tomorrow');
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
    const [year, month, day] = value.split('-').map(Number);
    return formatDate(new Date(year, month - 1, day), { weekday: 'short' });
}

/** Resolve old Chinese preset URLs to the shared bookmark identity.
 * @param {string} url
 */
export function canonicalBookmarkUrl(url) {
    const bookmarks = typeof window !== 'undefined' ? window.__GLASS_I18N__?.catalogs?.['zh-CN']?.bookmarks : undefined;
    return Object.entries(bookmarks || {}).find(([, bookmark]) => (bookmark.url || bookmark.legacyUrl) === url)?.[0] || url;
}

/** Resolve a built-in bookmark's destination without changing its saved identity.
 * @param {string} url
 */
export function localizeBookmarkUrl(url) {
    const catalog = typeof window !== 'undefined' ? window.__GLASS_I18N__?.catalogs?.[getLocale()] : undefined;
    const canonical = canonicalBookmarkUrl(url);
    return catalog?.bookmarks[canonical]?.url || canonical;
}

/** Display-only catalog. Keep the original defaults intact for migrations.
 * @param {import('../types').BookmarkCategory[]} categories
 */
export function localizeCategories(categories) {
    const catalog = typeof window !== 'undefined' && getLocale() === 'en' ? window.__GLASS_I18N__?.catalogs?.en : undefined;
    if (!catalog) return categories;
    return categories.map(category => ({
        ...category,
        name: catalog.categories?.[category.id || ''] || category.name,
        bookmarks: category.bookmarks.map(bookmark => ({ ...bookmark, ...catalog.bookmarks[bookmark.url], url: bookmark.url }))
    }));
}

/** Called once by the build-generated blocking head script. Dictionaries are not imported by app.js.
 * @param {Record<string, Record<string, import('../types').TranslationMessage>>} messages
 */
export function initializeI18n(messages) {
    const locale = resolveLocale(getLanguagePreference(), navigator.languages?.length ? navigator.languages : [navigator.language]);
    window.__GLASS_I18N__ = { locale, messages, t, applyTranslations, formatDate, weatherDescription };
    document.documentElement.lang = locale;
    document.documentElement.dir = 'ltr';
    if (locale !== 'zh-CN') {
        document.documentElement.dataset.i18nPending = '';
        window.__GLASS_I18N__.pendingTimer = setTimeout(() => {
            delete document.documentElement.dataset.i18nPending;
        }, 3000);
    }
}

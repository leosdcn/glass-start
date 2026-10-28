import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import vm from 'node:vm';
const scope = vm.createContext({ module: { exports: {} }, Intl });
const bundled = await build({ entryPoints: ['src/js/core/i18n.js'], bundle: true, write: false, format: 'cjs', platform: 'node' });
vm.runInContext(bundled.outputFiles[0].text, scope);
const { resolveLocale, t, forecastLabel, localizeCategories, localizeBookmarkUrl, canonicalBookmarkUrl } = scope.module.exports;

const messages = Object.fromEntries(['zh-CN', 'en'].map(locale =>
    [locale, JSON.parse(readFileSync(new URL(`../src/js/config/locales/${locale}.json`, import.meta.url), 'utf8'))]));

test('explicit language, browser priority, Chinese variants and invalid preferences', () => {
    assert.equal(resolveLocale('en', ['zh-CN']), 'en');
    assert.equal(resolveLocale('auto', ['fr-FR', 'zh-Hant-TW', 'en']), 'zh-CN');
    assert.equal(resolveLocale('auto', ['en-GB', 'zh-CN']), 'en');
    assert.equal(resolveLocale(null, ['fr-FR']), 'en');
    assert.equal(resolveLocale({}, []), 'en');
    assert.equal(resolveLocale('de', ['zh-SG']), 'zh-CN');
});

test('complete messages, singular/plural, one-pass parameters and fallback', () => {
    scope.window = { __GLASS_I18N__: { locale: 'en', messages } };
    try {
        assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages['zh-CN']).sort());
        assert.equal(t('bookmark.count', { count: 1 }), '1 bookmark added');
        assert.equal(t('bookmark.count', { count: 3 }), '3 bookmarks added');
        assert.equal(t('bookmark.importConfirm', { count: 1 }), 'Import 1 bookmark into your draft? Click Done to save it.');
        assert.equal(t('bookmark.importConfirm', { count: 3 }), 'Import 3 bookmarks into your draft? Click Done to save them.');
        assert.equal(t('bookmark.addLabel', { name: '{count}<img>' }), 'Add quick bookmark: {count}<img>');
        assert.equal(t('unknown.key'), 'unknown.key');
        scope.window.__GLASS_I18N__.locale = 'missing';
        assert.equal(t('language.label'), 'Language');
        scope.window.__GLASS_I18N__.locale = 'en';
        assert.equal(forecastLabel('2026-10-28', 2), 'Wed');
        assert.equal(forecastLabel('bad date', 2), '');
    } finally { delete scope.window; }
});

test('catalog translation uses stable identity without mutating original defaults', () => {
    const categories = [{ id: 'ai', name: '人工智能', icon: '', bookmarks: [{ name: '名字', url: 'https://example.test', icon: '', desc: '简介' }] }];
    scope.window = { __GLASS_I18N__: { locale: 'en', messages,
        catalogs: { en: { categories: { ai: 'Artificial intelligence' }, bookmarks: { 'https://example.test': { name: 'Name', desc: 'Description', url: 'https://example.test/en' } } },
            'zh-CN': { bookmarks: { 'https://example.test': { url: 'https://example.test/zh' },
                'https://auto.test': { legacyUrl: 'https://auto.test/zh' } } } } } };
    try {
        const localized = localizeCategories(categories);
        assert.equal(localized[0].bookmarks[0].name, 'Name');
        assert.equal(localizeBookmarkUrl('https://example.test'), 'https://example.test/en');
        assert.equal(localized[0].bookmarks[0].url, 'https://example.test');
        assert.equal(categories[0].bookmarks[0].url, 'https://example.test');
        assert.equal(localizeBookmarkUrl('https://custom.test'), 'https://custom.test');
        scope.window.__GLASS_I18N__.locale = 'zh-CN';
        assert.equal(localizeBookmarkUrl('https://example.test'), 'https://example.test/zh');
        assert.equal(canonicalBookmarkUrl('https://example.test/zh'), 'https://example.test');
        assert.equal(canonicalBookmarkUrl('https://custom.test'), 'https://custom.test');
        assert.equal(canonicalBookmarkUrl('https://auto.test/zh'), 'https://auto.test');
        assert.equal(localizeBookmarkUrl('https://auto.test/zh'), 'https://auto.test');
        scope.window.__GLASS_I18N__.locale = 'en';
        assert.equal(localizeBookmarkUrl('https://example.test/zh'), 'https://example.test/en');
        assert.equal(localizeBookmarkUrl('https://auto.test/zh'), 'https://auto.test');
        assert.equal(categories[0].bookmarks[0].name, '名字');
        assert.equal(categories[0].name, '人工智能');
    } finally { delete scope.window; }
});

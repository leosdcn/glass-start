import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'acorn';

/** Validate only the supported translation contract, alongside the existing lint. */
export async function inspectI18n(root, sources, html) {
    const { SUPPORTED_LANGUAGES } = await import(pathToFileURL(join(root, 'src/js/config/language.js')));
    const readJSON = name => JSON.parse(readFileSync(join(root, name), 'utf8'));
    const dictionaries = Object.fromEntries(SUPPORTED_LANGUAGES.map(locale =>
        [locale, readJSON(`src/js/config/locales/${locale}.json`)]));
    const keys = Object.keys(dictionaries.en).sort();
    const placeholders = message => [...new Set((typeof message === 'string' ? [message] : Object.values(message))
        .flatMap(text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1])))].sort().join(',');
    for (const [locale, messages] of Object.entries(dictionaries)) {
        if (Object.keys(messages).sort().join('\n') !== keys.join('\n')) throw new Error(`${locale}: translation keys differ`);
        for (const [key, message] of Object.entries(messages)) {
            const branches = typeof message === 'string' ? [message] : Object.values(message);
            if (!branches.length || branches.some(text => typeof text !== 'string' || !text.trim() || /<[^>]*>/.test(text))) {
                throw new Error(`${locale}/${key}: expected plain text`);
            }
            if (typeof message !== 'string' && (!message.other || Object.keys(message).some(form =>
                !['zero', 'one', 'two', 'few', 'many', 'other'].includes(form)))) throw new Error(`${locale}/${key}: invalid plural branches`);
            if (placeholders(message) !== placeholders(dictionaries.en[key]) || branches.some(text =>
                placeholders(text) !== placeholders(message))) throw new Error(`${locale}/${key}: placeholders differ`);
        }
    }
    const checkKey = key => {
        if (/^cache\.(title|description|action)$/.test(key)) {
            checkKey(`cache.web.${key.slice(6)}`);
            checkKey(`cache.extension.${key.slice(6)}`);
        } else if (!Object.hasOwn(dictionaries.en, key)) throw new Error(`Unknown translation key: ${key}`);
    };
    const walk = node => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 't'
            && node.arguments[0]?.type === 'Literal') checkKey(node.arguments[0].value);
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(walk);
            else if (value && typeof value === 'object') walk(value);
        }
    };
    sources.forEach(({ content }) => walk(parse(content, { ecmaVersion: 'latest', sourceType: 'module' })));
    for (const match of html.matchAll(/\bdata-i18n(?:-(?:placeholder|title|aria-label|alt|content))?="([^"]+)"/g)) checkKey(match[1]);
    if (html.split('<!-- INJECT_I18N_HEAD -->').length !== 2) throw new Error('Language head slot must occur once');

    const catalog = readJSON('src/js/config/locales/catalog-en.json');
    const defaults = readJSON('bookmarks.json');
    const ids = new Set();
    const urls = new Set(defaults.categories.flatMap(category => category.bookmarks.map(bookmark => bookmark.url)));
    defaults.categories.forEach(category => {
        if (!category.id || ids.has(category.id) || !catalog.categories[category.id]) throw new Error(`Missing/duplicate category translation: ${category.id}`);
        ids.add(category.id);
        category.bookmarks.forEach(bookmark => {
            const translation = catalog.bookmarks[bookmark.url];
            if (!translation || (bookmark.desc && !translation.desc)) throw new Error(`Missing bookmark translation: ${bookmark.url}`);
        });
    });
    for (const [url, translation] of Object.entries(catalog.bookmarks)) {
        if (!urls.has(url)) throw new Error(`Orphaned bookmark translation: ${url}`);
        if ((translation.name?.length || 0) > 60) throw new Error(`Bookmark translation exceeds editor name limit: ${url}`);
        if ((translation.desc?.length || 0) > 28) throw new Error(`English bookmark description exceeds 28 characters (${translation.desc.length}): ${url}`);
    }
    return `${SUPPORTED_LANGUAGES.length} languages, ${keys.length} messages and ${urls.size} built-in bookmarks`;
}

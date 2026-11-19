export const IMAGE_CACHE_PREFIX = 'app-images-';

/** @param {string} pathname */
export function scopedCachePrefix(pathname) {
    return 'glass-scope-' + encodeURIComponent(pathname) + '-';
}

/** @param {string} key @param {string} prefix */
export function isScopedCache(key, prefix) {
    // 更深的部署路径可能恰好以同一前缀开头。
    return key.startsWith(prefix) && !key.includes('%2F-', prefix.length);
}

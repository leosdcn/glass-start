/** LocalStorage JSON 读写；不持有业务状态，也不处理 IndexedDB 或离线缓存。 */
/**
 * 安全读取 localStorage 中的配置项并反序列化为 JSON
 * @param {string} key - 存储的键名
 * @param {*} [fallback=null] - 键名不存在时的返回值
 * @param {*} [invalid=fallback] - 读取或解析失败时的返回值
 * @returns {*} 解析后的对象/数组或 fallback 默认值
 */
export function storageGet(key, fallback = null, invalid = fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
    } catch {
        return invalid;
    }
}

/**
 * 安全写入 JSON 序列化数据至 localStorage
 * @param {string} key - 存储的键名
 * @param {*} value - 需要存储的数据对象/数组/值
 * @returns {boolean} 写入成功返回 true，被沙盒阻断或磁盘超限时返回 false
 */
export function storageSet(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}

/**
 * 安全删除 localStorage 中的指定键名记录
 * @param {string} key - 需移除的键名
 * @returns {boolean} 移除成功返回 true，抛出安全异常时返回 false
 */
export function storageRemove(key) {
    try {
        localStorage.removeItem(key);
        return true;
    } catch {
        return false;
    }
}

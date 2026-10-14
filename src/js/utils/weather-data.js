/** 首帧缓存恢复和运行时共用的气象数值清洗规则。 */
export function weatherNum(value, fallback) {
    if (typeof value !== 'number' && typeof value !== 'string') return fallback;
    if (typeof value === 'string' && value.trim() === '') return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

// @ts-check
/** 书签匹配与排序；输入候选模型和配置，不访问页面或存储。 */
// 复用编辑距离矩阵缓冲区，容量不足时扩容。
let dLevBuffer = typeof Int32Array !== 'undefined' ? new Int32Array(1024) : null;

/**
 * 计算受限 Damerau–Levenshtein（OSA）距离，支持相邻字符交换。
 * @param {string} a - 源字符串
 * @param {string} b - 目标字符串
 * @returns {number} 最小编辑距离步数
 */
export function damerauLevenshteinDistance(a, b) {
    const al = a.length, bl = b.length;
    if (al === 0) return bl;
    if (bl === 0) return al;

    const cols = bl + 1;
    const requiredSize = (al + 1) * cols;
    if (!dLevBuffer || dLevBuffer.length < requiredSize) {
        dLevBuffer = new Int32Array(Math.max(requiredSize, dLevBuffer ? dLevBuffer.length * 2 : 1024));
    }
    const dp = dLevBuffer;

    for (let i = 0; i <= al; i++) dp[i * cols] = i;
    for (let j = 0; j <= bl; j++) dp[j] = j;

    for (let i = 1; i <= al; i++) {
        const iOffset = i * cols;
        const prevIOffset = (i - 1) * cols;
        const charA = a[i - 1];
        const prevCharA = i > 1 ? a[i - 2] : '';

        for (let j = 1; j <= bl; j++) {
            const cost = charA === b[j - 1] ? 0 : 1;
            let minVal = dp[prevIOffset + j] + 1; // deletion
            const insertCost = dp[iOffset + j - 1] + 1; // insertion
            if (insertCost < minVal) minVal = insertCost;
            const subCost = dp[prevIOffset + j - 1] + cost; // substitution
            if (subCost < minVal) minVal = subCost;

            if (i > 1 && j > 1 && charA === b[j - 2] && prevCharA === b[j - 1]) {
                const transCost = dp[(i - 2) * cols + j - 2] + cost; // transposition
                if (transCost < minVal) minVal = transCost;
            }
            dp[iOffset + j] = minVal;
        }
    }
    return dp[al * cols + bl];
}

/**
 * 计算关键词 q 与目标文本（或书签）的前缀拼写容错 / 模糊匹配得分 (Token Prefix Fuzzy Score)
 * @param {string} q - 用户输入的查询关键词
 * @param {string|Partial<import('../types').BookmarkItem>} target - 目标字符串或书签对象
 * @param {import('../types').FuzzyOptions} options
 * @returns {number} 匹配惩罚得分（越小越精确，未匹配返回 Infinity）
 */
export function getFuzzyScore(q, target, options) {
    const query = (q || '').trim().toLowerCase();
    if (query.length < options.MIN_QUERY_LEN) return Infinity;
    const rawText = (typeof target === 'string' ? target : `${target?.name || ''} ${target?.url || ''} ${target?.desc || ''}`).toLowerCase();
    if (!rawText.trim()) return Infinity;
    const rawTokens = rawText.split(/\s+/);
    const wordTokens = rawText.split(/[^a-z0-9\u4e00-\u9fff]+/);
    const tokens = Array.from(new Set([...rawTokens, ...wordTokens].filter(t => t.length > 0)));

    const subQueries = query.split(/\s+/).filter(sq => sq.length > 0);
    if (subQueries.length === 0) return Infinity;

    let totalDist = 0;

    for (const sq of subQueries) {
        if (sq.length < 2) continue;
        const maxDist = sq.length <= options.SHORT_QUERY_LEN ? options.MAX_DIST_SHORT : options.MAX_DIST_LONG;
        let minSubDist = Infinity;

        for (const token of tokens) {
            if (token.length < Math.max(2, sq.length - 1)) continue;
            const minLen = Math.max(2, sq.length - 1);
            const maxLen = Math.min(token.length, sq.length + 1);
            for (let len = minLen; len <= maxLen; len++) {
                const prefix = token.substring(0, len);
                const dist = damerauLevenshteinDistance(sq, prefix);
                if (dist < minSubDist) {
                    minSubDist = dist;
                    if (minSubDist === 0) break;
                }
            }
            if (minSubDist === 0) break;
        }

        if (minSubDist > maxDist) {
            return Infinity;
        }
        totalDist += minSubDist;
    }

    const maxTotalDist = query.length <= options.SHORT_QUERY_LEN ? options.MAX_DIST_SHORT : options.MAX_DIST_LONG;
    return totalDist <= maxTotalDist ? totalDist : Infinity;
}

/**
 * 在本地全站书签中根据关键词检索匹配项（包含快捷书签与分类书签）
 * @param {string} query - 搜索关键词
 * @param {import('../types').SearchCandidateModel} model
 * @param {import('../types').SearchOptions} config
 * @param {number} [limit] - 最多返回匹配条数，默认取配置
 * @returns {Array<{type: string, name: string, url: string, icon: string, desc: string, category: string}>}
 */
export function rankBookmarkSuggestions(query, model, config, limit = config.MAX_LOCAL_ITEMS) {
    const q = (query || '').trim().toLowerCase();
    if (!q || !/[a-z0-9\u4e00-\u9fff]/.test(q)) return [];
    const isFuzzyEligible = q.length >= config.FUZZY.MIN_QUERY_LEN;

    const { candidates: allCandidates, urlToCategoryMap } = model;
    const matches = [];

    for (let idx = 0; idx < allCandidates.length; idx++) {
        const { bm, normUrl, defaultCat } = allCandidates[idx];
        const bmName = (bm.name || '').toLowerCase();
        const bmDesc = (bm.desc || '').toLowerCase();
        const bmUrl = (bm.url || '').toLowerCase();
        const realCat = urlToCategoryMap.get(normUrl) || defaultCat;

        let tier = Infinity;

        if (bmName === q) {
            tier = config.TIERS.EXACT_NAME;
        } else if (bmName.startsWith(q)) {
            tier = config.TIERS.PREFIX_NAME;
        } else if (bmName.includes(q)) {
            tier = config.TIERS.SUBSTRING_NAME;
        } else if (bmUrl.includes(q) || normUrl.includes(q)) {
            tier = config.TIERS.URL_MATCH;
        } else if (bmDesc.includes(q)) {
            tier = config.TIERS.DESC_MATCH;
        } else if (isFuzzyEligible) {
            const nameFuzzyScore = getFuzzyScore(q, bm.name || '', config.FUZZY);
            if (nameFuzzyScore !== Infinity) {
                tier = config.TIERS.FUZZY_NAME_BASE + nameFuzzyScore;
            } else {
                const otherFuzzyScore = getFuzzyScore(q, `${normUrl} ${bm.desc || ''}`, config.FUZZY);
                if (otherFuzzyScore !== Infinity) {
                    tier = config.TIERS.FUZZY_OTHER_BASE + otherFuzzyScore;
                }
            }
        }

        if (tier !== Infinity) {
            matches.push({
                tier,
                idx,
                item: {
                    type: 'bookmark',
                    name: bm.name || '未命名书签',
                    url: bm.url,
                    icon: bm.icon || '',
                    desc: bm.desc || '',
                    category: realCat
                }
            });
        }
    }

    matches.sort((a, b) => (a.tier - b.tier) || (a.idx - b.idx));
    return matches.slice(0, limit).map(m => m.item);
}


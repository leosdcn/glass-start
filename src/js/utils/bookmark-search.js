// @ts-check
/** 书签匹配与排序；输入候选模型和配置，不访问页面或存储。 */
// 复用编辑距离矩阵缓冲区，常规长度内避免重复分配，超长输入改用局部缓冲区。
const MAX_POOLED_DLEV_LEN = 4096;
let dLevBuffer = new Int32Array(1024);

/** @param {string} target */
export function tokenizeSearchText(target) {
    if (!target.trim()) return [];
    const rawTokens = target.split(/\s+/);
    const wordTokens = target.split(/[^\p{L}\p{N}]+/u);
    return Array.from(new Set([...rawTokens, ...wordTokens].filter(t => t.length > 0)));
}

/**
 * 计算受限 Damerau–Levenshtein（OSA）距离，支持相邻字符交换与阈值早停。
 * @param {string} a - 源字符串
 * @param {string} b - 目标字符串
 * @param {number} [maxDist] - 允许的最大编辑距离上限；超过时返回 Infinity 提前剪枝
 * @returns {number} 最小编辑距离步数；超出上限时返回 Infinity
 */
export function damerauLevenshteinDistance(a, b, maxDist = Infinity) {
    const al = a.length, bl = b.length;
    if (al === 0) return bl <= maxDist ? bl : Infinity;
    if (bl === 0) return al <= maxDist ? al : Infinity;
    if (Math.abs(al - bl) > maxDist) return Infinity;

    const cols = bl + 1;
    const requiredSize = (al + 1) * cols;
    let dp;
    if (requiredSize <= MAX_POOLED_DLEV_LEN) {
        if (dLevBuffer.length < requiredSize) {
            dLevBuffer = new Int32Array(Math.max(requiredSize, dLevBuffer.length * 2));
        }
        dp = dLevBuffer;
    } else {
        dp = new Int32Array(requiredSize);
    }
    const radius = Math.floor(maxDist);
    const outside = Math.max(al, bl) + 1;

    for (let j = 0; j <= Math.min(bl, radius); j++) dp[j] = j;
    if (radius < bl) dp[radius + 1] = outside;

    for (let i = 1; i <= al; i++) {
        const iOffset = i * cols;
        const prevIOffset = (i - 1) * cols;
        // 超过阈值的对角带外不可能命中，只初始化本行递推会读到的边界。
        const first = Math.max(1, i - radius);
        const last = Math.min(bl, i + radius);
        dp[iOffset + first - 1] = first === 1 && i <= radius ? i : outside;
        if (last < bl) dp[iOffset + last + 1] = outside;
        const charA = a[i - 1];
        const prevCharA = i > 1 ? a[i - 2] : '';
        let minRowVal = Infinity;

        for (let j = first; j <= last; j++) {
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
            if (minVal < minRowVal) minRowVal = minVal;
        }
        if (minRowVal > maxDist) return Infinity;
    }
    const res = dp[al * cols + bl];
    return res <= maxDist ? res : Infinity;
}

/**
 * 计算已规范化关键词与目标文本的前缀拼写容错 / 模糊匹配得分 (Token Prefix Fuzzy Score)
 * @param {string} query - 已去空白并转为小写的查询关键词
 * @param {string} target - 小写目标文本
 * @param {import('../types').FuzzyOptions} options
 * @param {string[]} subQueries - 预切分的查询子词，避免循环中重复执行正则切分
 * @param {string[]} [preTokens] - 预切分的目标词元列表
 * @returns {number} 匹配惩罚得分（越小越精确，未匹配返回 Infinity）
 */
function getFuzzyScore(query, target, options, subQueries, preTokens) {
    const tokens = preTokens ?? tokenizeSearchText(target);
    if (tokens.length === 0 || subQueries.length === 0) return Infinity;

    let totalDist = 0;

    for (const sq of subQueries) {
        // 单字符不做拼写容错，但仍须命中词首，不能跳过后把无关查询算作零距离。
        if (sq.length < 2) {
            if (!tokens.some(token => token.startsWith(sq))) return Infinity;
            continue;
        }
        const maxDist = sq.length <= options.SHORT_QUERY_LEN ? options.MAX_DIST_SHORT : options.MAX_DIST_LONG;
        let minSubDist = Infinity;

        const minLen = Math.max(2, sq.length - 1);
        for (const token of tokens) {
            if (token.length < minLen) continue;
            const maxLen = Math.min(token.length, sq.length + 1);
            for (let len = minLen; len <= maxLen; len++) {
                const prefix = token.substring(0, len);
                const limit = Math.min(maxDist, minSubDist - 1);
                const dist = damerauLevenshteinDistance(sq, prefix, limit);
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

/** @param {string} query @param {string} name @param {import('../types').SearchOptions['TIERS']} tiers */
function getNameMatchTier(query, name, tiers) {
    if (name === query) return tiers.EXACT_NAME;
    if (name.startsWith(query)) return tiers.PREFIX_NAME;
    if (name.includes(query)) return tiers.SUBSTRING_NAME;
    return Infinity;
}

/**
 * 在本地全站书签中根据关键词检索匹配项（包含快捷书签与分类书签）
 * @param {string} query - 搜索关键词
 * @param {import('../types').SearchCandidateModel} model
 * @param {import('../types').SearchOptions} config
 * @param {number} [limit] - 最多返回匹配条数，默认取配置
 * @returns {Array<import('../types').BookmarkSuggestion>}
 */
export function rankBookmarkSuggestions(query, model, config, limit = config.MAX_LOCAL_ITEMS) {
    const q = (query || '').trim().toLowerCase();
    if (!q || !/[\p{L}\p{N}]/u.test(q)) return [];
    const isFuzzyEligible = q.length >= config.FUZZY.MIN_QUERY_LEN && q.length <= config.FUZZY.MAX_QUERY_LEN;
    const subQueries = isFuzzyEligible ? q.split(/\s+/).filter(sq => sq.length > 0) : [];

    const { candidates: allCandidates, urlToCategoryMap } = model;
    const matches = [];

    for (let idx = 0; idx < allCandidates.length; idx++) {
        const candidate = allCandidates[idx];
        const { bm, normUrl, defaultCat, alternateNamesLower = [] } = candidate;
        const bmName = candidate.nameLower ?? (bm.name || '').toLowerCase();
        const bmDesc = candidate.descLower ?? (bm.desc || '').toLowerCase();
        const bmUrl = candidate.urlLower ?? (bm.url || '').toLowerCase();
        const normalizedText = candidate.cleanUrl ?? normUrl.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

        let tier = getNameMatchTier(q, bmName, config.TIERS);
        for (const name of alternateNamesLower) {
            tier = Math.min(tier, getNameMatchTier(q, name, config.TIERS));
        }

        if (tier === Infinity && (bmUrl.includes(q) || normalizedText.includes(q))) {
            tier = config.TIERS.URL_MATCH;
        } else if (tier === Infinity && bmDesc.includes(q)) {
            tier = config.TIERS.DESC_MATCH;
        } else if (tier === Infinity && isFuzzyEligible) {
            let nameFuzzyScore = getFuzzyScore(q, bmName, config.FUZZY, subQueries, candidate.nameTokens);
            for (let i = 0; i < alternateNamesLower.length; i++) {
                nameFuzzyScore = Math.min(nameFuzzyScore, getFuzzyScore(q, alternateNamesLower[i], config.FUZZY, subQueries, candidate.alternateNameTokens?.[i]));
            }
            if (nameFuzzyScore !== Infinity) {
                tier = config.TIERS.FUZZY_NAME_BASE + nameFuzzyScore;
            } else {
                const otherFuzzyScore = getFuzzyScore(q, `${normalizedText} ${bmDesc}`, config.FUZZY, subQueries, candidate.otherTokens);
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
                    type: /** @type {const} */ ('bookmark'),
                    name: bm.name || '',
                    url: bm.url,
                    icon: bm.icon || '',
                    desc: bm.desc || '',
                    category: urlToCategoryMap.get(normUrl) || defaultCat
                }
            });
        }
    }

    matches.sort((a, b) => (a.tier - b.tier) || (a.idx - b.idx));
    return matches.slice(0, limit).map(m => m.item);
}


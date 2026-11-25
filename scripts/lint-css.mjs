import postcss from 'postcss';

// 每个逗号分支都必须包含正向 reduce 条件；not/or 不能误入白名单。
/** @param {string} params */
function requiresReducedMotion(params) {
    const queries = postcss.list.comma(params.replace(/\/\*[\s\S]*?\*\//g, ' ').toLowerCase());
    return queries.length > 0 && queries.every(query => {
        const tokens = postcss.list.space(query).map(token => token.replace(/\s+/g, ''));
        return tokens.includes('(prefers-reduced-motion:reduce)') &&
            !tokens.some(token => token === 'not' || token === 'or');
    });
}

/** 逐份解析源码以保留诊断位置；HTML 内联样式可传入起始位置偏移。
 * @param {Array<{ file: string, content: string, lineOffset?: number, columnOffset?: number }>} sources
 */
export function inspectCSSSources(sources) {
    /** @type {string[]} */
    const importantViolations = [];
    /** @type {string[]} */
    const prefixViolations = [];
    /** @type {string[]} */
    const hoverViolations = [];
    /** @type {string[]} */
    const fontSmoothingViolations = [];
    for (const { file, content, lineOffset = 0, columnOffset = 0 } of sources) {
        /** @param {{ line: number, column: number }} position */
        const location = position => `${file}:${position.line + lineOffset}:${position.column + (position.line === 1 ? columnOffset : 0)}`;
        let root;
        try {
            root = postcss.parse(content, { from: file });
        } catch (error) {
            const cssErr = /** @type {{ line: number, column: number, reason: string }} */ (error);
            throw new Error(`${location({ line: cssErr.line, column: cssErr.column })}: ${cssErr.reason}`, { cause: error });
        }
        root.walkRules(rule => {
            const selectors = postcss.list.comma(rule.selector);
            for (const sel of selectors) {
                if (sel.includes(':hover') && !sel.includes('-webkit-autofill')) {
                    if (!sel.includes('body:not(.tab-blurred)') && rule.source?.start) {
                        hoverViolations.push(`${location(rule.source.start)}: 包含 :hover 的选择器须加 body:not(.tab-blurred) 前缀: "${sel.trim()}"`);
                    }
                }
            }
        });
        const standardByParent = new Map();
        root.walkDecls(decl => {
            if (decl.important) {
                let reducedMotion = false;
                /** @type {any} */
                let parent = decl.parent;
                for (; parent; parent = parent.parent) {
                    if (parent.type === 'atrule' && parent.name.toLowerCase() === 'media' && requiresReducedMotion(parent.params)) {
                        reducedMotion = true;
                        break;
                    }
                }
                if (!reducedMotion && decl.source?.start) importantViolations.push(`${location(decl.source.start)}: ${decl.toString()}`);
            }
            const prop = decl.prop.toLowerCase();
            if ((prop === 'font-smoothing' || prop === '-webkit-font-smoothing' || prop === '-moz-osx-font-smoothing') && decl.source?.start) {
                fontSmoothingViolations.push(`${location(decl.source.start)}: ${decl.toString()}`);
            }
            if (prop === 'backdrop-filter') standardByParent.set(decl.parent, decl);
            if (prop === '-webkit-backdrop-filter' && standardByParent.has(decl.parent)) {
                const standard = standardByParent.get(decl.parent);
                if (decl.source?.start && standard?.source?.start) {
                    prefixViolations.push(`${location(decl.source.start)}: -webkit-backdrop-filter 须置于同一块的 backdrop-filter (${location(standard.source.start)}) 之前`);
                }
            }
        });
    }
    return { importantViolations, prefixViolations, hoverViolations, fontSmoothingViolations };
}

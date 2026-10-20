import postcss from 'postcss';

// 每个逗号分支都必须包含正向 reduce 条件；not/or 不能误入白名单。
function requiresReducedMotion(params) {
    const queries = postcss.list.comma(params.replace(/\/\*[\s\S]*?\*\//g, ' ').toLowerCase());
    return queries.length > 0 && queries.every(query => {
        const tokens = postcss.list.space(query).map(token => token.replace(/\s+/g, ''));
        return tokens.includes('(prefers-reduced-motion:reduce)') &&
            !tokens.some(token => token === 'not' || token === 'or');
    });
}

/** 逐份解析源码以保留诊断位置；HTML 内联样式可传入起始位置偏移。 */
export function inspectCSSSources(sources) {
    const importantViolations = [];
    const prefixViolations = [];
    for (const { file, content, lineOffset = 0, columnOffset = 0 } of sources) {
        const location = position => `${file}:${position.line + lineOffset}:${position.column + (position.line === 1 ? columnOffset : 0)}`;
        let root;
        try {
            root = postcss.parse(content, { from: file });
        } catch (error) {
            throw new Error(`${location({ line: error.line, column: error.column })}: ${error.reason}`, { cause: error });
        }
        const standardByParent = new Map();
        root.walkDecls(decl => {
            if (decl.important) {
                let reducedMotion = false;
                for (let parent = decl.parent; parent; parent = parent.parent) {
                    if (parent.type === 'atrule' && parent.name.toLowerCase() === 'media' && requiresReducedMotion(parent.params)) {
                        reducedMotion = true;
                        break;
                    }
                }
                if (!reducedMotion) importantViolations.push(`${location(decl.source.start)}: ${decl.toString()}`);
            }
            const prop = decl.prop.toLowerCase();
            if (prop === 'backdrop-filter') standardByParent.set(decl.parent, decl);
            if (prop === '-webkit-backdrop-filter' && standardByParent.has(decl.parent)) {
                const standard = standardByParent.get(decl.parent);
                prefixViolations.push(`${location(decl.source.start)}: -webkit-backdrop-filter 须置于同一块的 backdrop-filter (${location(standard.source.start)}) 之前`);
            }
        });
    }
    return { importantViolations, prefixViolations };
}

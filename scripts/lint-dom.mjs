/** @typedef {{ type: string, [key: string]: any }} ASTNode */
/** @typedef {{ kind: string, id?: string, value?: string }} EvalValue */
/** @typedef {{ initializer?: ASTNode | null, property?: string, value?: EvalValue }} Binding */
/** @typedef {{ parent: Scope | null, bindings: Map<string, Binding>, functionScope: boolean }} Scope */

/** @param {ASTNode} node @returns {ASTNode[]} */
const children = node => Object.values(node).flatMap(value => Array.isArray(value) ? value : [value])
    .filter(value => value && typeof value.type === 'string');
/** @param {ASTNode} node @param {(n: ASTNode) => void} visit */
const walk = (node, visit) => { visit(node); children(node).forEach(child => walk(child, visit)); };

/** 静态检查可识别的 DOM 引用；变量按词法作用域解析，注释及字符串不会被当成代码。
 * @param {Array<{ file: string, ast: ASTNode }>} sources
 * @param {string} overlayPath
 * @param {string} typesSource
 */
export function inspectDOMSources(sources, overlayPath, typesSource) {
    const trees = new Map(sources.map(({ file, ast }) => [file, ast]));
    const overlay = trees.get(overlayPath);
    if (!overlay) throw new Error('无法读取 MODAL_OVERLAY_IDS 弹窗清单');
    /** @type {Set<string>} */
    const modalIds = new Set();
    walk(overlay, node => {
        if (node.type === 'VariableDeclarator' && node.id.name === 'MODAL_OVERLAY_IDS') {
            const array = node.init?.type === 'NewExpression' && node.init.arguments[0];
            if (array?.type === 'ArrayExpression') {
                for (const item of array.elements) if (typeof item?.value === 'string') modalIds.add(item.value);
            }
        }
    });
    if (!modalIds.size) throw new Error('无法读取 MODAL_OVERLAY_IDS 弹窗清单');

    /** @type {Set<string>} */
    const cachedReferences = new Set();
    /** @type {string[]} */
    const visibilityViolations = [];
    for (const [file, tree] of trees) {
        /** @type {WeakMap<ASTNode, Scope | null>} */
        const scopes = new WeakMap();
        /**
         * @param {ASTNode} pattern
         * @param {Scope} scope
         * @param {ASTNode | null} [initializer]
         * @param {string} [property]
         */
        const bind = (pattern, scope, initializer, property) => {
            if (pattern.type === 'Identifier') scope.bindings.set(pattern.name, { initializer, property });
            else if (pattern.type === 'ObjectPattern') {
                for (const entry of pattern.properties) {
                    if (entry.type === 'Property') bind(entry.value, scope, initializer,
                        entry.computed ? entry.key.value : entry.key.name ?? entry.key.value);
                    else bind(entry.argument, scope);
                }
            } else if (pattern.type === 'AssignmentPattern') bind(pattern.left, scope, initializer, property);
            else if (pattern.type === 'RestElement') bind(pattern.argument, scope);
            else if (pattern.type === 'ArrayPattern') pattern.elements.filter(Boolean).forEach(/** @param {ASTNode} item */ item => bind(item, scope));
        };
        /**
         * @param {ASTNode} node
         * @param {Scope | null} scope
         */
        const collect = (node, scope) => {
            const isFunction = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type);
            if (node.type === 'FunctionDeclaration' && node.id && scope) bind(node.id, scope);
            if (isFunction || ['Program', 'BlockStatement', 'CatchClause', 'ForStatement', 'ForOfStatement', 'ForInStatement'].includes(node.type)) {
                scope = { parent: scope, bindings: new Map(), functionScope: isFunction || node.type === 'Program' };
            }
            scopes.set(node, scope);
            if (scope) {
                if (isFunction) {
                    if (node.id) bind(node.id, scope);
                    node.params.forEach(/** @param {ASTNode} param */ param => bind(param, scope));
                }
                if (node.type === 'CatchClause' && node.param) bind(node.param, scope);
                if (node.type === 'ClassDeclaration' && node.id) bind(node.id, scope);
                if (node.type === 'ImportDeclaration') {
                    for (const spec of node.specifiers) {
                        /** @type {EvalValue | undefined} */
                        let value;
                        if (spec.type === 'ImportSpecifier' && /(?:^|\/)state\/dom\.js$/.test(node.source.value)) {
                            if (spec.imported.name === 'dom') value = { kind: 'dom' };
                            if (spec.imported.name === '$') value = { kind: 'getter' };
                        }
                        scope.bindings.set(spec.local.name, { value });
                    }
                }
                if (node.type === 'VariableDeclaration') {
                    let target = scope;
                    if (node.kind === 'var') while (target.parent && !target.functionScope) target = target.parent;
                    for (const decl of node.declarations) bind(decl.id, target, decl.init);
                }
            }
            children(node).forEach(child => collect(child, scope));
        };
        collect(tree, null);
        /** @param {ASTNode} node */
        const lookup = node => {
            for (let scope = scopes.get(node) ?? null; scope; scope = scope.parent) {
                if (scope.bindings.has(node.name)) return scope.bindings.get(node.name);
            }
        };
        /** @param {EvalValue} value @param {string | undefined} key @returns {EvalValue[]} */
        const getMember = (value, key) => {
            if (value.kind === 'dom' && key) return [{ kind: 'element', id: key }];
            if (value.kind === 'element' && (key === 'style' || key === 'classList')) return [{ kind: key, id: value.id }];
            if (value.kind === 'document' && key && ['getElementById', 'querySelector'].includes(key)) return [{ kind: key }];
            return [];
        };
        /** @param {ASTNode | null | undefined} node @returns {string | undefined} */
        const keyOf = node => node?.type === 'MemberExpression'
            ? node.computed ? stringOf(node.property) : node.property.name : undefined;
        /** @param {ASTNode | null | undefined} node @param {Set<Binding>} [seen] @returns {EvalValue[]} */
        const evaluate = (node, seen = new Set()) => {
            if (!node) return [];
            if (node.type === 'ChainExpression') return evaluate(node.expression, seen);
            if (node.type === 'Literal' && typeof node.value === 'string') return [{ kind: 'string', value: node.value }];
            if (node.type === 'TemplateLiteral' && !node.expressions.length) return [{ kind: 'string', value: node.quasis[0].value.cooked }];
            if (node.type === 'Identifier') {
                const binding = lookup(node);
                if (!binding) return node.name === 'document' ? [{ kind: 'document' }] : [];
                if (seen.has(binding)) return [];
                if (binding.value) return [binding.value];
                const values = evaluate(binding.initializer, new Set([...seen, binding]));
                return binding.property === undefined ? values : values.flatMap(value => getMember(value, binding.property));
            }
            if (node.type === 'MemberExpression') return evaluate(node.object, seen).flatMap(value => getMember(value, keyOf(node)));
            if (node.type === 'ConditionalExpression') return [...evaluate(node.consequent, seen), ...evaluate(node.alternate, seen)];
            if (node.type === 'LogicalExpression') return [...evaluate(node.left, seen), ...evaluate(node.right, seen)];
            if (node.type === 'CallExpression') {
                return evaluate(node.callee, seen).flatMap(value => {
                    const argument = stringOf(node.arguments[0]);
                    if (['getter', 'getElementById'].includes(value.kind) && argument) return [{ kind: 'element', id: argument }];
                    if (value.kind === 'querySelector' && /^#[\w-]+$/.test(argument || '')) return [{ kind: 'element', id: /** @type {string} */ (argument).slice(1) }];
                    return [];
                });
            }
            return [];
        };
        /** @param {ASTNode | null | undefined} node */
        const stringOf = node => evaluate(node).find(value => value.kind === 'string')?.value;
        /** @param {ASTNode | null | undefined} node */
        const usesDOM = node => evaluate(node).some(value => value.kind === 'dom');
        walk(tree, node => {
            const memberKey = keyOf(node);
            if (node.type === 'MemberExpression' && usesDOM(node.object) && memberKey) cachedReferences.add(memberKey);
            if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' && usesDOM(node.init)) {
                for (const prop of node.id.properties) {
                    if (prop.type === 'Property') {
                        const propKey = prop.computed ? stringOf(prop.key) : prop.key.name ?? prop.key.value;
                        if (propKey) cachedReferences.add(propKey);
                    }
                }
            }
            if (file === overlayPath) return;
            /** @type {EvalValue[]} */
            let targets = [];
            if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression') {
                if (keyOf(node.left) === 'hidden') targets = evaluate(node.left.object).filter(value => value.kind === 'element');
                if (keyOf(node.left) === 'display' || keyOf(node.left) === 'cssText') {
                    targets = evaluate(node.left.object).filter(value => value.kind === 'style');
                }
            }
            if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
                const method = keyOf(node.callee), attribute = stringOf(node.arguments[0]);
                if (method && ['setAttribute', 'removeAttribute', 'toggleAttribute'].includes(method) && attribute === 'hidden') {
                    targets = evaluate(node.callee.object).filter(value => value.kind === 'element');
                }
                if (method && ['setProperty', 'removeProperty'].includes(method) && attribute === 'display') {
                    targets = evaluate(node.callee.object).filter(value => value.kind === 'style');
                }
                if (method && ['add', 'remove', 'toggle'].includes(method)
                    && node.arguments.some(/** @param {ASTNode} arg */ arg => stringOf(arg) === 'hidden')) {
                    targets = evaluate(node.callee.object).filter(value => value.kind === 'classList');
                }
            }
            if (targets.some(value => value.id && modalIds.has(value.id))) {
                visibilityViolations.push(`${file}:${node.loc.start.line}:${node.loc.start.column + 1}`);
            }
        });
    }
    const interfaceBody = typesSource.match(/export\s+interface\s+DOMCache\s*\{([\s\S]*?)\n\s*\}/)?.[1] || '';
    const typedIds = new Set([...interfaceBody.matchAll(/^\s*(?:([\w$-]+)|['"]([^'"]+)['"])\??\s*:/gm)].map(match => match[1] || match[2]));
    return { cachedReferences, typedIds, visibilityViolations };
}

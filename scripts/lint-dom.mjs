import { parse } from 'acorn';

const children = node => Object.values(node).flatMap(value => Array.isArray(value) ? value : [value])
    .filter(value => value && typeof value.type === 'string');
const walk = (node, visit) => { visit(node); children(node).forEach(child => walk(child, visit)); };

/** 静态检查可识别的 DOM 引用；变量按词法作用域解析，注释及字符串不会被当成代码。 */
export function inspectDOMSources(sources, overlayPath, typesSource) {
    const trees = new Map(sources.map(({ file, content }) => [file,
        parse(content, { ecmaVersion: 'latest', sourceType: 'module', locations: true })]));
    const modalIds = new Set();
    walk(trees.get(overlayPath), node => {
        if (node.type === 'VariableDeclarator' && node.id.name === 'MODAL_OVERLAY_IDS') {
            const array = node.init?.type === 'NewExpression' && node.init.arguments[0];
            if (array?.type === 'ArrayExpression') {
                for (const item of array.elements) if (typeof item?.value === 'string') modalIds.add(item.value);
            }
        }
    });
    if (!modalIds.size) throw new Error('无法读取 MODAL_OVERLAY_IDS 弹窗清单');

    const cachedReferences = new Set();
    const visibilityViolations = [];
    for (const [file, tree] of trees) {
        const scopes = new WeakMap();
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
            else if (pattern.type === 'ArrayPattern') pattern.elements.filter(Boolean).forEach(item => bind(item, scope));
        };
        const collect = (node, scope) => {
            const isFunction = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type);
            if (node.type === 'FunctionDeclaration' && node.id) bind(node.id, scope);
            if (isFunction || ['Program', 'BlockStatement', 'CatchClause', 'ForStatement', 'ForOfStatement', 'ForInStatement'].includes(node.type)) {
                scope = { parent: scope, bindings: new Map(), functionScope: isFunction || node.type === 'Program' };
            }
            scopes.set(node, scope);
            if (isFunction) {
                if (node.id) bind(node.id, scope);
                node.params.forEach(param => bind(param, scope));
            }
            if (node.type === 'CatchClause' && node.param) bind(node.param, scope);
            if (node.type === 'ClassDeclaration' && node.id) bind(node.id, scope);
            if (node.type === 'ImportDeclaration') {
                for (const spec of node.specifiers) {
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
            children(node).forEach(child => collect(child, scope));
        };
        collect(tree, null);
        const lookup = node => {
            for (let scope = scopes.get(node); scope; scope = scope.parent) {
                if (scope.bindings.has(node.name)) return scope.bindings.get(node.name);
            }
        };
        const getMember = (value, key) => {
            if (value.kind === 'dom' && key) return [{ kind: 'element', id: key }];
            if (value.kind === 'element' && key === 'style') return [{ kind: 'style', id: value.id }];
            if (value.kind === 'document' && ['getElementById', 'querySelector'].includes(key)) return [{ kind: key }];
            return [];
        };
        const keyOf = node => node?.type === 'MemberExpression'
            ? node.computed ? stringOf(node.property) : node.property.name : undefined;
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
                    if (value.kind === 'querySelector' && /^#[\w-]+$/.test(argument || '')) return [{ kind: 'element', id: argument.slice(1) }];
                    return [];
                });
            }
            return [];
        };
        const stringOf = node => evaluate(node).find(value => value.kind === 'string')?.value;
        const usesDOM = node => evaluate(node).some(value => value.kind === 'dom');
        walk(tree, node => {
            if (node.type === 'MemberExpression' && usesDOM(node.object) && keyOf(node)) cachedReferences.add(keyOf(node));
            if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' && usesDOM(node.init)) {
                for (const prop of node.id.properties) {
                    if (prop.type === 'Property') cachedReferences.add(prop.computed ? stringOf(prop.key) : prop.key.name ?? prop.key.value);
                }
            }
            if (file === overlayPath) return;
            let targets = [];
            if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression') {
                if (keyOf(node.left) === 'hidden') targets = evaluate(node.left.object).filter(value => value.kind === 'element');
                if (keyOf(node.left) === 'display') targets = evaluate(node.left.object).filter(value => value.kind === 'style');
            }
            if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
                const method = keyOf(node.callee), attribute = stringOf(node.arguments[0]);
                if (['setAttribute', 'removeAttribute', 'toggleAttribute'].includes(method) && attribute === 'hidden') {
                    targets = evaluate(node.callee.object).filter(value => value.kind === 'element');
                }
                if (['setProperty', 'removeProperty'].includes(method) && attribute === 'display') {
                    targets = evaluate(node.callee.object).filter(value => value.kind === 'style');
                }
            }
            if (targets.some(value => modalIds.has(value.id))) {
                visibilityViolations.push(`${file}:${node.loc.start.line}:${node.loc.start.column + 1}`);
            }
        });
    }
    const interfaceBody = typesSource.match(/export\s+interface\s+DOMCache\s*\{([\s\S]*?)\n\}/)?.[1] || '';
    const typedIds = new Set([...interfaceBody.matchAll(/^\s*(?:([\w$-]+)|['"]([^'"]+)['"])\??\s*:/gm)].map(match => match[1] || match[2]));
    return { cachedReferences, typedIds, visibilityViolations };
}

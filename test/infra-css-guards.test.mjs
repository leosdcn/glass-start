import assert from 'node:assert/strict';
import { inspectCSSSources } from '../scripts/lint-css.mjs';

const inspect = content => inspectCSSSources([{ file: 'fixture.css', content }]);

// 一个减弱动效查询内多个规则、嵌套 supports 和组合查询都应保留白名单。
const valid = inspect(`
/* !important; backdrop-filter: blur(1px); } -webkit-backdrop-filter: none; */
.hint { content: "!important } backdrop-filter: none;"; }
@media (prefers-reduced-motion: reduce) {
    .first { animation: none !important; }
    .second { transition: none !important; }
    @supports (display: grid) { .nested { scroll-behavior: auto !IMPORTANT; } }
}
@media screen and (prefers-reduced-motion: reduce) { .combined { animation: none !important; } }
@media (prefers-reduced-motion: reduce), print and (prefers-reduced-motion: reduce) {
    .branches { animation: none !important; }
}
.glass { -webkit-backdrop-filter: blur(1px); backdrop-filter: blur(1px); }
`);
assert.deepEqual(valid, { importantViolations: [], prefixViolations: [] });

for (const css of [
    '.outside { color: red !important; }',
    '@media (prefers-reduced-motion: no-preference) { .a { animation: none !important; } }',
    '@media not (prefers-reduced-motion: reduce) { .a { animation: none !important; } }',
    '@media (prefers-reduced-motion: reduce), print { .a { animation: none !important; } }',
    '@media (prefers-reduced-motion: reduce) or (color) { .a { animation: none !important; } }',
    '@media (prefers-reduced-motion: reduce) { .a { animation: none !important; } } .b { color: red !important; }'
]) {
    assert.equal(inspect(css).importantViolations.length, 1, css);
}
// 嵌套块之间的声明互不干扰，但子块不能清除父块中已见的标准属性。
assert.equal(inspect(`.outer {
    backdrop-filter: blur(1px);
    .inner { -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px); }
    -webkit-backdrop-filter: blur(1px);
}`).prefixViolations.length, 1);
assert.equal(inspect('.a { backdrop-filter: none; } .b { -webkit-backdrop-filter: none; }').prefixViolations.length, 0);
assert.equal(inspect('.a { backdrop-filter: none; -webkit-backdrop-filter: none; }').prefixViolations.length, 1);

const diagnostic = inspectCSSSources([{ file: 'src/index.html', lineOffset: 9, columnOffset: 7,
    content: '.a { color: red !important; }\n.b { backdrop-filter: none; -webkit-backdrop-filter: none; }' }]);
assert.match(diagnostic.importantViolations[0], /^src\/index\.html:10:13:/);
assert.match(diagnostic.prefixViolations[0], /^src\/index\.html:11:29:/);
assert.throws(() => inspectCSSSources([{ file: 'src/index.html', lineOffset: 4, columnOffset: 3, content: '.broken {' }]),
    /src\/index\.html:5:4: Unclosed block/);
console.log('✅ CSS 门禁正确处理多条减弱动效规则、嵌套与压缩样式、注释及字符串；拒绝白名单逃逸并保留源码位置');

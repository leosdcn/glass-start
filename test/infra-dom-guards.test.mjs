import assert from 'node:assert/strict';
import { inspectDOMSources } from '../scripts/lint-dom.mjs';

const overlayPath = '/project/src/js/core/overlay-stack.js';
const overlay = `export const MODAL_OVERLAY_IDS = new Set(['editModal', 'confirmModal', 'newModal']);
document.getElementById('editModal').hidden = false;`;
const inspect = content => inspectDOMSources([
    { file: overlayPath, content: overlay },
    { file: '/project/src/js/modules/probe.js', content }
], overlayPath, 'export interface DOMCache {\n editModal: HTMLElement | null;\n "confirmModal": HTMLElement | null;\n}');

const allowed = inspect(`
import { dom } from '../state/dom.js';
const ordinary = document.getElementById('notice');
ordinary.hidden = true;
ordinary.setAttribute('hidden', '');
ordinary.removeAttribute('hidden');
ordinary.toggleAttribute('hidden');
const modal = document.getElementById('foldout');
modal.style.display = 'none';
function shadow(dom) { dom.editModal.hidden = true; }
function first() { const popup = dom.editModal; return popup; }
function second() { const popup = ordinary; popup.hidden = false; }
// dom.unused.hidden = true;
const documentation = "dom.unused.hidden = true";
`);
assert.deepEqual(allowed.visibilityViolations, []);
assert.deepEqual([...allowed.cachedReferences], ['editModal']);
assert.deepEqual([...allowed.typedIds].sort(), ['confirmModal', 'editModal']);

for (const statement of [
    'ui.editModal.hidden = true;',
    "ui['editModal'].toggleAttribute('hidden');",
    "const popup = ui.editModal; const alias = popup; alias.removeAttribute('hidden');",
    "const {confirmModal: popup} = ui; popup.setAttribute('hidden', '');",
    "const popup = ui.editModal; const style = popup.style; style.display = 'none';",
    "ui.confirmModal.style.setProperty('display', 'none');",
    "document.getElementById('editModal').hidden = false;",
    "const id = 'newModal'; const popup = document.getElementById(id); popup.hidden = true;",
    "document.querySelector('#confirmModal').style.display = 'none';",
    "const popup = get('editModal'); popup.hidden = true;"
]) {
    const result = inspect(`import { dom as ui, $ as get } from '../state/dom.js';\n${statement}`);
    assert.equal(result.visibilityViolations.length, 1, statement);
    assert.match(result.visibilityViolations[0], /probe\.js:\d+:\d+$/);
}
const references = inspect(`import { dom as ui } from '../state/dom.js';
ui.editModal; ui['newModal']; const { confirmModal: popup } = ui;`);
assert.deepEqual([...references.cachedReferences].sort(), ['confirmModal', 'editModal', 'newModal']);
assert.equal(references.typedIds.has('newModal'), false);
console.log('✅ DOM 门禁允许普通元素 hidden、忽略同名局部变量；受管理弹窗的直接引用及别名写入仍受保护');

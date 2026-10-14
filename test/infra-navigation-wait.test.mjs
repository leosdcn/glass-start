import assert from 'node:assert/strict';
import { navigateAndWait } from './helpers.mjs';

const url = 'http://localhost/navigation-test';
const send = async () => ({});
let evaluations = 0;
await navigateAndWait(send, async expression => {
  assert.ok(expression.includes("document.readyState === 'complete'"));
  assert.ok(expression.includes(url));
  if (++evaluations === 1) throw new Error('CDP command Runtime.evaluate failed (-32000): Inspected target navigated or closed');
  return true;
}, url);
assert.equal(evaluations, 2);
for (const error of [new Error('Application assertion failed'), new Error('CDP command Runtime.evaluate failed (-32601): Unknown method')]) {
  await assert.rejects(navigateAndWait(send, async () => { throw error; }, url), actual => actual === error);
}
let evaluated = false;
await assert.rejects(navigateAndWait(async () => ({errorText:'net::ERR_CONNECTION_REFUSED'}), async () => { evaluated=true; }, url), /Navigation failed/);
assert.equal(evaluated, false);
console.log('✅ 导航只容忍上下文替换，页面异常、其他协议错误和导航失败直接报告');

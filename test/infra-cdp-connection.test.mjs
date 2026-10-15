import assert from 'node:assert/strict';
import { connectCDP } from './cdp.mjs';

class Socket extends EventTarget {
  readyState = WebSocket.CONNECTING;
  sent = [];
  open() { this.readyState = WebSocket.OPEN; this.dispatchEvent(new Event('open')); }
  send(value) { this.sent.push(JSON.parse(value)); }
  reply(value) { this.dispatchEvent(new MessageEvent('message', {data:JSON.stringify(value)})); }
  close() { this.readyState = WebSocket.CLOSED; this.dispatchEvent(new Event('close')); }
}
const connect = async () => {
  const socket = new Socket();
  const opening = connectCDP(socket);
  socket.open();
  return {socket, connection:await opening};
};
const {socket, connection} = await connect();
const request = connection.send('Runtime.evaluate', {expression:'42'});
socket.reply({id:socket.sent.at(-1).id, result:{value:42}});
assert.deepEqual(await request, {value:42});
const error = assert.rejects(connection.send('Missing.method'), /Missing.method failed \(-32601\)/);
socket.reply({id:socket.sent.at(-1).id, error:{code:-32601,message:'Unknown method'}});
await error;
let eventCount = 0;
const unsubscribe = connection.send('Page.event', () => eventCount++);
socket.reply({method:'Page.event',params:{}});
unsubscribe();
socket.reply({method:'Page.event',params:{}});
assert.equal(eventCount, 1);

// 请求超时设为很长，通过短截止时间证明断线会立即拒绝所有请求。
const rejects = ['Page.enable','Runtime.enable'].map(method => assert.rejects(connection.send(method, {}, 60000), new RegExp(method + ' failed: CDP connection closed')));
const deadline = setTimeout(() => { throw new Error('断线未及时结束请求'); }, 1000);
try { socket.close(); await Promise.all(rejects); } finally { clearTimeout(deadline); }
await assert.rejects(connection.send('Page.reload'), /connection closed/);
unsubscribe();
connection.close();

for (const mode of ['error','client-close','bad-json','send-error']) {
  const {socket,connection} = await connect();
  const waiting = assert.rejects(connection.send('Pending', {}, 60000), /CDP command Pending failed:/);
  if (mode === 'error') socket.dispatchEvent(new Event('error'));
  if (mode === 'client-close') connection.close();
  if (mode === 'bad-json') socket.dispatchEvent(new MessageEvent('message',{data:'{'}));
  if (mode === 'send-error') {
    socket.send = () => { throw new Error('socket unavailable'); };
    await assert.rejects(connection.send('Next'), /CDP send failed/);
  }
  await waiting;
  assert.equal(socket.readyState, WebSocket.CLOSED);
}
for (const mode of ['close','error','timeout']) {
  const socket = new Socket();
  const rejected = assert.rejects(connectCDP(socket,{openTimeoutMs:20}), /CDP connection/);
  if (mode === 'close') socket.close();
  if (mode === 'error') socket.dispatchEvent(new Event('error'));
  await rejected;
  assert.equal(socket.readyState, WebSocket.CLOSED);
}
console.log('✅ CDP 响应与事件正常；连接中断、握手失败、主动关闭及发送错误立即清理待决请求');

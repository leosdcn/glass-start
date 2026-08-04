/**
 * Service Worker 内存池（sw.js）与前端缓存清理联动针对性回归测试
 *
 * 覆盖缺陷：
 * 1. 【并发调序排队锁】：验证 enqueuePruneCache 互斥锁队列存在，确保同池淘汰串行化
 * 2. 【降级去重】：验证 fallback 循环包含 knownSet.add(k.url)，防止重复压入与漏删
 * 3. 【IDB 孤立节点 GC】：验证 orphanRecords 擦除逻辑存在，消除硬盘/内存数据泄漏
 * 4. 【IDB 连接容错】：验证 openIDB 与 error 处理器会在异常时自动重置 dbPromise
 * 5. 【前端清理联动】：验证 index.html clearCacheBtn 具备同步清除 sw-lru-db 的安全重置
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTester } from './helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const { pass, finish } = makeTester();
console.log('🔍 校验 Service Worker 内存池 LRU 与清理联动修正...');

const swContent = readFileSync(join(ROOT, 'sw.js'), 'utf-8');
const htmlContent = readFileSync(join(ROOT, 'index.html'), 'utf-8');

// 1. BUG 1：互斥锁与串行入队验证
pass('引入 pruneLocks 互斥队列机制', swContent.includes('const pruneLocks = new Map()') && swContent.includes('enqueuePruneCache('), '已定义 pruneLocks 与 enqueuePruneCache');
pass('在 fetch 事件处理中使用 enqueuePruneCache 串行化淘汰', swContent.includes('await enqueuePruneCache('), '已切换为 enqueuePruneCache 替代直接调用');

// 2. BUG 2 & 3：knownSet 去重注册验证
pass('降级淘汰循环中补全 knownSet.add(k.url) 注册', swContent.includes('knownSet.add(k.url)'), 'Fallback 循环已包含 Set 注册');

// 3. BUG 4：IDB 孤立节点垃圾回收 (GC) 验证
pass('定义 orphanRecords 进行无用 IDB 节点擦除', swContent.includes('orphanRecords') && swContent.includes('orphanRecords.forEach('), '已包含孤立记录收集与自动 GC 清理');
pass('前端 clearCacheBtn 同步清除 sw-lru-db 数据库', htmlContent.includes("indexedDB.deleteDatabase('sw-lru-db')"), 'index.html 已同步添加 IDB 清理机制');

// 4. BUG 5：IDB 连接异常重置闭环验证
pass('openIDB 在 onerror/exception 时正确重置 dbPromise = null',
  /req\.onerror\s*=\s*\(\)\s*=>\s*\{[^}]*dbPromise\s*=\s*null/.test(swContent) &&
  swContent.includes('db.onerror = () => { dbPromise = null; };'),
  'IDB 异常回调已补全 dbPromise 重置');

process.exit(finish());

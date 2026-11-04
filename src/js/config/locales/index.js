import zh from './zh-CN.json';
import en from './en.json';

// 由 scripts/build.cjs 打包进首屏语言脚本，app.js 不重复加载字典。
export const messages = { 'zh-CN': zh, en };

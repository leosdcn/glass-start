// test:unit 与跳过构建共用此清单；新增测试默认需要构建。
export const standaloneTests = new Set([
  'data-pure-models.test.mjs',
  'data-priority-fixes-unit.test.mjs',
  'data-animation-cleanup-unit.test.mjs',
  'data-wallpaper-selection-unit.test.mjs'
]);

export function requiresBuild(files) {
  return files.some(file => !standaloneTests.has(file));
}

/**
 * 本地书签搜索与优先级排序测试 (bookmark-search.test.mjs)
 * 验证：本地书签搜索时优先搜索书签名而非书签简介
 */
import { launchSession, makeTester } from './helpers.mjs';

const { pass, finish } = makeTester();
const { server, chrome, evalJS } = await launchSession();

// 1. 书签名精确匹配优先于简介包含关键词的书签
const exactNamePriority = await evalJS(`(() => {
    // 注入模拟测试数据
    const originalBookmarks = pageData.bookmarks;
    const originalCategories = pageData.categories;
    try {
        pageData.bookmarks = [
            { name: "代码托管平台", url: "https://hub.example.com", desc: "全球最大的 GitHub 开源平台" }
        ];
        pageData.categories = [
            {
                name: "开发工具",
                bookmarks: [
                    { name: "GitHub", url: "https://github.com", desc: "开源项目托管" }
                ]
            }
        ];
        const res = getLocalBookmarkSuggestions("GitHub", 2);
        return {
            firstMatch: res[0]?.name,
            secondMatch: res[1]?.name,
            total: res.length
        };
    } finally {
        pageData.bookmarks = originalBookmarks;
        pageData.categories = originalCategories;
    }
})()`);

pass(
    '书签名精确匹配优先于简介包含关键词的书签',
    exactNamePriority.firstMatch === 'GitHub' && exactNamePriority.secondMatch === '代码托管平台',
    `firstMatch=${exactNamePriority.firstMatch}, secondMatch=${exactNamePriority.secondMatch}`
);

// 2. 书签名包含关键词优先于仅简介包含关键词的书签
const substringNamePriority = await evalJS(`(() => {
    const originalBookmarks = pageData.bookmarks;
    const originalCategories = pageData.categories;
    try {
        pageData.bookmarks = [
            { name: "开源资讯网", url: "https://news.example.com", desc: "汇聚各类开源项目动态" },
            { name: "ChatGPT", url: "https://chatgpt.com", desc: "OpenAI 开发的人工智能对话模型" }
        ];
        pageData.categories = [
            {
                name: "AI 工具",
                bookmarks: [
                    { name: "AI 绘画助手", url: "https://ai-art.example.com", desc: "智能生图工具" }
                ]
            }
        ];
        // 查询 "AI"
        const res = getLocalBookmarkSuggestions("AI", 2);
        return {
            firstMatch: res[0]?.name,
            secondMatch: res[1]?.name
        };
    } finally {
        pageData.bookmarks = originalBookmarks;
        pageData.categories = originalCategories;
    }
})()`);

pass(
    '书签名包含/前缀匹配优先于仅简介包含关键词的书签',
    substringNamePriority.firstMatch === 'AI 绘画助手' && substringNamePriority.secondMatch === 'ChatGPT',
    `firstMatch=${substringNamePriority.firstMatch}, secondMatch=${substringNamePriority.secondMatch}`
);

// 3. 书签名字匹配优先于 URL 匹配，URL 匹配优先于简介匹配
const tierOrdering = await evalJS(`(() => {
    const originalBookmarks = pageData.bookmarks;
    const originalCategories = pageData.categories;
    try {
        pageData.bookmarks = [
            { name: "资讯聚合", url: "https://info.example.com", desc: "收录各类 react 生态资源" },
            { name: "前端导航", url: "https://react-community.example.com", desc: "前端社区" },
            { name: "React 官方文档", url: "https://react.dev", desc: "用于构建 Web 界面" }
        ];
        pageData.categories = [];
        const res = getLocalBookmarkSuggestions("react", 3);
        return res.map(item => item.name);
    } finally {
        pageData.bookmarks = originalBookmarks;
        pageData.categories = originalCategories;
    }
})()`);

pass(
    '书签名匹配 > URL 匹配 > 简介匹配 三级优先级梯队正常',
    tierOrdering[0] === 'React 官方文档' && tierOrdering[1] === '前端导航' && tierOrdering[2] === '资讯聚合',
    `order=${JSON.stringify(tierOrdering)}`
);

// 4. 当没有书签名匹配时，优雅降级返回简介匹配项
const descFallback = await evalJS(`(() => {
    const originalBookmarks = pageData.bookmarks;
    const originalCategories = pageData.categories;
    try {
        pageData.bookmarks = [
            { name: "阿里云", url: "https://aliyun.com", desc: "提供云服务器 ECS 与弹性计算服务" }
        ];
        pageData.categories = [];
        const res = getLocalBookmarkSuggestions("弹性计算", 2);
        return {
            match: res[0]?.name,
            count: res.length
        };
    } finally {
        pageData.bookmarks = originalBookmarks;
        pageData.categories = originalCategories;
    }
})()`);

pass(
    '无书签名匹配时优雅降级返回简介匹配书签',
    descFallback.count === 1 && descFallback.match === '阿里云',
    `match=${descFallback.match}`
);

const code = finish();
await chrome.close();
await server.close();
process.exit(code);

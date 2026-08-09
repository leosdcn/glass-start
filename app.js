        /**
         * Glass Start — 两屏结构的新标签页
         * 功能区块：
         *   起始页      — 时钟 + 搜索框 + 快捷书签
         *   导航页      — 侧边栏分类 + 书签网格，内部独立滚动
         *   滚动切换    — 滚轮/触屏累积阈值后在两屏间切换
         * 基础服务：
         *   搜索引擎切换 — 引擎选择下拉 + 搜索跳转
         *   壁纸切换    — 快捷键 Ctrl/Cmd + B 轮播背景
         *   存储工具    — localStorage（偏好引擎）/ sessionStorage（当前屏）
         * @typedef {{ name:string, url:string, icon:string, desc?:string }} Bookmark
         * @typedef {{ name:string, icon:string, bookmarks:Bookmark[] }} Category
         * @typedef {{ name:string, icon:string, url:string }} EngineConfig
         *
         * 📌 导航页书签简短介绍副标题 (desc) 编写规范：
         * 1. 字数限制：推荐控制在 6 ~ 10 个中文字符以内（或 12 ~ 20 个英文字符以内）。
         * 2. 布局特性：在导航页卡片标题下方展示，超出字数会在移动端/小屏自动截断 (`truncate`)。
         * 3. 内容准则：精准概括网站核心定位，避免冗余修饰词（如重叠动词、多余连词）。
         */

        // ==================== 默认书签（外部 bookmarks.json 加载失败 / file:// 本地运行时使用）====================
        /**
         * 🤖 AI 编程 / 开发者注意事项：
         * 1. 此处的 DEFAULT_BOOKMARKS 与 DEFAULT_CATEGORIES 数组用于 file:// 协议及网络异常时的离线降级回退。
         * 2. 运行 `npm run build` 时，build.js 会自动读取根目录 bookmarks.json 并通过正则表达式自动同步替换此处的数组。
         * 3. 重构代码时请勿重命名 `DEFAULT_BOOKMARKS` / `DEFAULT_CATEGORIES` 变量名，否则会导致 build.js 的正则匹配同步失效。
         */
        const DEFAULT_BOOKMARKS = [
            {
                "name": "微信传输助手",
                "url": "https://filehelper.weixin.qq.com",
                "icon": "https://a.favicon.im/filehelper.weixin.qq.com"
            },
            {
                "name": "微博",
                "url": "https://weibo.com",
                "icon": "https://a.favicon.im/weibo.com"
            },
            {
                "name": "豆包",
                "url": "https://www.doubao.com",
                "icon": "https://a.favicon.im/doubao.com"
            },
            {
                "name": "DeepSeek",
                "url": "https://chat.deepseek.com",
                "icon": "https://a.favicon.im/chat.deepseek.com"
            },
            {
                "name": "哔哩哔哩",
                "url": "https://www.bilibili.com",
                "icon": "https://a.favicon.im/bilibili.com"
            },
            {
                "name": "抖音",
                "url": "https://www.douyin.com",
                "icon": "https://a.favicon.im/douyin.com"
            },
            {
                "name": "中国天气网",
                "url": "https://www.weather.com.cn",
                "icon": "https://a.favicon.im/weather.com.cn"
            },
            {
                "name": "网易云音乐",
                "url": "https://music.163.com/st/webplayer",
                "icon": "https://a.favicon.im/music.163.com"
            }
        ];

        const DEFAULT_CATEGORIES = [
            {
                "name": "人工智能",
                "icon": "🤖",
                "bookmarks": [
                    {
                        "name": "Arena AI",
                        "url": "https://arena.ai",
                        "icon": "https://a.favicon.im/arena.ai",
                        "desc": "全球 AI 盲测平台"
                    },
                    {
                        "name": "ChatGPT",
                        "url": "https://chat.openai.com",
                        "icon": "https://a.favicon.im/chat.openai.com",
                        "desc": "旗舰级 AI 对话助手"
                    },
                    {
                        "name": "Civitai",
                        "url": "https://civitai.com",
                        "icon": "https://a.favicon.im/civitai.com",
                        "desc": "开源 AI 绘画模型社区"
                    },
                    {
                        "name": "Claude",
                        "url": "https://claude.ai",
                        "icon": "https://a.favicon.im/claude.ai",
                        "desc": "前沿大语言模型助手"
                    },
                    {
                        "name": "DeepSeek",
                        "url": "https://chat.deepseek.com",
                        "icon": "https://a.favicon.im/chat.deepseek.com",
                        "desc": "深度求索开源大模型"
                    },
                    {
                        "name": "Gamma",
                        "url": "https://gamma.app",
                        "icon": "https://a.favicon.im/gamma.app",
                        "desc": "AI 生成 PPT 与网页"
                    },
                    {
                        "name": "Gemini",
                        "url": "https://gemini.google.com",
                        "icon": "https://a.favicon.im/gemini.google.com",
                        "desc": "谷歌前沿多模态 AI"
                    },
                    {
                        "name": "Grok",
                        "url": "https://grok.com",
                        "icon": "https://a.favicon.im/grok.com",
                        "desc": "xAI 智能对话模型"
                    },
                    {
                        "name": "Hugging Face",
                        "url": "https://huggingface.co",
                        "icon": "https://a.favicon.im/huggingface.co",
                        "desc": "开源 AI 模型与数据集"
                    },
                    {
                        "name": "Kimi",
                        "url": "https://kimi.moonshot.cn",
                        "icon": "https://a.favicon.im/kimi.moonshot.cn",
                        "desc": "月之暗面长文本 AI"
                    },
                    {
                        "name": "Midjourney",
                        "url": "https://www.midjourney.com",
                        "icon": "https://a.favicon.im/midjourney.com",
                        "desc": "AI 图像生成与艺术"
                    },
                    {
                        "name": "Perplexity",
                        "url": "https://www.perplexity.ai",
                        "icon": "https://a.favicon.im/perplexity.ai",
                        "desc": "AI 驱动知识问答引擎"
                    },
                    {
                        "name": "Suno",
                        "url": "https://suno.com",
                        "icon": "https://a.favicon.im/suno.com",
                        "desc": "AI 音乐与歌曲创作"
                    },
                    {
                        "name": "智谱清言",
                        "url": "https://chatglm.cn",
                        "icon": "https://a.favicon.im/chatglm.cn",
                        "desc": "国产全自研 AI 大模型"
                    },
                    {
                        "name": "豆包",
                        "url": "https://www.doubao.com",
                        "icon": "https://a.favicon.im/doubao.com",
                        "desc": "字节跳动 AI 智能助手"
                    },
                    {
                        "name": "通义千问",
                        "url": "https://www.qianwen.com",
                        "icon": "https://a.favicon.im/www.qianwen.com",
                        "desc": "阿里官方 AI 智能助手"
                    }
                ]
            },
            {
                "name": "开发工具",
                "icon": "⚡",
                "bookmarks": [
                    {
                        "name": "BrowserLeaks",
                        "url": "https://browserleaks.com/ip",
                        "icon": "https://a.favicon.im/browserleaks.com",
                        "desc": "浏览器指纹与隐私检测"
                    },
                    {
                        "name": "DistroSea",
                        "url": "https://distrosea.com",
                        "icon": "https://a.favicon.im/distrosea.com",
                        "desc": "浏览器在线体验 Linux"
                    },
                    {
                        "name": "GitHub",
                        "url": "https://github.com",
                        "icon": "https://a.favicon.im/github.com",
                        "desc": "开源代码托管与协作"
                    },
                    {
                        "name": "ip.skk.moe",
                        "url": "https://ip.skk.moe",
                        "icon": "https://a.favicon.im/ip.skk.moe",
                        "desc": "极速 IP 与网络分流检测"
                    },
                    {
                        "name": "IPCheck.ing",
                        "url": "https://ipcheck.ing",
                        "icon": "https://a.favicon.im/ipcheck.ing",
                        "desc": "开源卡片式 IP 检测"
                    },
                    {
                        "name": "IT Tools",
                        "url": "https://it-tools.tech",
                        "icon": "https://a.favicon.im/it-tools.tech",
                        "desc": "开发者在线实用工具集"
                    },
                    {
                        "name": "ITDOG",
                        "url": "https://www.itdog.cn",
                        "icon": "https://a.favicon.im/itdog.cn",
                        "desc": "多节点 Ping 与路由诊断"
                    },
                    {
                        "name": "JSFiddle",
                        "url": "https://jsfiddle.net",
                        "icon": "https://a.favicon.im/jsfiddle.net",
                        "desc": "在线前端代码调试沙盒"
                    },
                    {
                        "name": "MDN Web Docs",
                        "url": "https://developer.mozilla.org",
                        "icon": "https://a.favicon.im/developer.mozilla.org",
                        "desc": "权威 Web 开发文档"
                    },
                    {
                        "name": "npm",
                        "url": "https://www.npmjs.com",
                        "icon": "https://a.favicon.im/npmjs.com",
                        "desc": "Node.js 官方包管理器"
                    },
                    {
                        "name": "Speedtest",
                        "url": "https://www.speedtest.net",
                        "icon": "https://a.favicon.im/speedtest.net",
                        "desc": "权威网络测速诊断"
                    },
                    {
                        "name": "Stack Overflow",
                        "url": "https://stackoverflow.com",
                        "icon": "https://a.favicon.im/stackoverflow.com",
                        "desc": "全球开发者问答社区"
                    },
                    {
                        "name": "v0",
                        "url": "https://v0.dev",
                        "icon": "https://a.favicon.im/v0.dev",
                        "desc": "AI 代码与生成式 UI"
                    }
                ]
            },
            {
                "name": "云端服务",
                "icon": "☁️",
                "bookmarks": [
                    {
                        "name": "AWS Console",
                        "url": "https://aws.amazon.com/console",
                        "icon": "https://a.favicon.im/amazonaws.com",
                        "desc": "AWS云服务控制台"
                    },
                    {
                        "name": "Cloudflare",
                        "url": "https://dash.cloudflare.com",
                        "icon": "https://a.favicon.im/cloudflare.com",
                        "desc": "全球网络安全与CDN"
                    },
                    {
                        "name": "Google Cloud",
                        "url": "https://console.cloud.google.com",
                        "icon": "https://a.favicon.im/cloud.google.com",
                        "desc": "谷歌云基础设施平台"
                    },
                    {
                        "name": "Microsoft Azure",
                        "url": "https://portal.azure.com",
                        "icon": "https://a.favicon.im/azure.microsoft.com",
                        "desc": "微软企业级云平台"
                    },
                    {
                        "name": "Railway",
                        "url": "https://railway.app",
                        "icon": "https://a.favicon.im/railway.app",
                        "desc": "云端极速应用部署平台"
                    },
                    {
                        "name": "Vercel",
                        "url": "https://vercel.com",
                        "icon": "https://a.favicon.im/vercel.com",
                        "desc": "前端全栈极速部署"
                    }
                ]
            },
            {
                "name": "效率办公",
                "icon": "📝",
                "bookmarks": [
                    {
                        "name": "DeepL",
                        "url": "https://www.deepl.com/zh/translator",
                        "icon": "https://a.favicon.im/deepl.com",
                        "desc": "精准自然 AI 智能翻译"
                    },
                    {
                        "name": "draw.io",
                        "url": "https://app.diagrams.net",
                        "icon": "https://a.favicon.im/app.diagrams.net",
                        "desc": "免费开源流程架构图"
                    },
                    {
                        "name": "Excalidraw",
                        "url": "https://excalidraw.com",
                        "icon": "https://a.favicon.im/excalidraw.com",
                        "desc": "手绘风格在线协作白板"
                    },
                    {
                        "name": "Gmail",
                        "url": "https://mail.google.com",
                        "icon": "https://a.favicon.im/mail.google.com",
                        "desc": "谷歌高效安全电子邮箱"
                    },
                    {
                        "name": "Google Drive",
                        "url": "https://drive.google.com",
                        "icon": "https://a.favicon.im/drive.google.com",
                        "desc": "谷歌云端硬盘与文档"
                    },
                    {
                        "name": "Google 翻译",
                        "url": "https://translate.google.com",
                        "icon": "https://a.favicon.im/translate.google.com",
                        "desc": "全球多语种即时互译"
                    },
                    {
                        "name": "MEGA",
                        "url": "https://mega.nz",
                        "icon": "https://a.favicon.im/mega.nz",
                        "desc": "端到端加密云端存储"
                    },
                    {
                        "name": "Notion",
                        "url": "https://www.notion.so",
                        "icon": "https://a.favicon.im/notion.so",
                        "desc": "一体化笔记与知识库"
                    },
                    {
                        "name": "Obsidian",
                        "url": "https://obsidian.md",
                        "icon": "https://a.favicon.im/obsidian.md",
                        "desc": "本地双链知识库笔记"
                    },
                    {
                        "name": "OneDrive",
                        "url": "https://onedrive.live.com",
                        "icon": "https://a.favicon.im/onedrive.live.com",
                        "desc": "微软云端文件存储服务"
                    },
                    {
                        "name": "Publish Markdown",
                        "url": "https://publishmarkdown.com",
                        "icon": "https://a.favicon.im/publishmarkdown.com",
                        "desc": "MD 笔记一键发布网页"
                    },
                    {
                        "name": "飞书",
                        "url": "https://www.feishu.cn",
                        "icon": "https://a.favicon.im/feishu.cn",
                        "desc": "企业级协同办公平台"
                    },
                    {
                        "name": "微信传输助手",
                        "url": "https://filehelper.weixin.qq.com",
                        "icon": "https://a.favicon.im/filehelper.weixin.qq.com",
                        "desc": "微信官方跨端文件传输"
                    }
                ]
            },
            {
                "name": "设计灵感",
                "icon": "🎨",
                "bookmarks": [
                    {
                        "name": "Behance",
                        "url": "https://www.behance.net",
                        "icon": "https://a.favicon.im/behance.net",
                        "desc": "全球设计作品展示社区"
                    },
                    {
                        "name": "Canva",
                        "url": "https://www.canva.cn",
                        "icon": "https://a.favicon.im/canva.cn",
                        "desc": "全能在线设计与 AI 创作"
                    },
                    {
                        "name": "Coolors",
                        "url": "https://coolors.co",
                        "icon": "https://a.favicon.im/coolors.co",
                        "desc": "极速配色方案在线生成"
                    },
                    {
                        "name": "Figma",
                        "url": "https://www.figma.com",
                        "icon": "https://a.favicon.im/figma.com",
                        "desc": "云端协同 UI 设计工具"
                    },
                    {
                        "name": "Fontshare",
                        "url": "https://www.fontshare.com",
                        "icon": "https://a.favicon.im/fontshare.com",
                        "desc": "免费商用高品质字体库"
                    },
                    {
                        "name": "Lucide Icons",
                        "url": "https://lucide.dev",
                        "icon": "https://a.favicon.im/lucide.dev",
                        "desc": "现代极简矢量图标库"
                    },
                    {
                        "name": "Simple Icons",
                        "url": "https://simpleicons.org",
                        "icon": "https://a.favicon.im/simpleicons.org",
                        "desc": "开源品牌矢量图标库"
                    },
                    {
                        "name": "Pexels",
                        "url": "https://www.pexels.com",
                        "icon": "https://a.favicon.im/pexels.com",
                        "desc": "免费高质量素材图库"
                    },
                    {
                        "name": "Pixiv",
                        "url": "https://www.pixiv.net",
                        "icon": "https://a.favicon.im/pixiv.net",
                        "desc": "二次元插画艺术社区"
                    },
                    {
                        "name": "Unsplash",
                        "url": "https://unsplash.com",
                        "icon": "https://a.favicon.im/unsplash.com",
                        "desc": "无版权高品质摄影图库"
                    },
                    {
                        "name": "Wallhaven",
                        "url": "https://wallhaven.cc",
                        "icon": "https://a.favicon.im/wallhaven.cc",
                        "desc": "高质量极客桌面壁纸库"
                    }
                ]
            },
            {
                "name": "社区社交",
                "icon": "💬",
                "bookmarks": [
                    {
                        "name": "Discord",
                        "url": "https://discord.com",
                        "icon": "https://a.favicon.im/discord.com",
                        "desc": "极客与游戏社区频道"
                    },
                    {
                        "name": "LINUX DO",
                        "url": "https://linux.do",
                        "icon": "https://a.favicon.im/linux.do",
                        "desc": "极客与开发者社区"
                    },
                    {
                        "name": "Reddit",
                        "url": "https://www.reddit.com",
                        "icon": "https://a.favicon.im/reddit.com",
                        "desc": "全球热门话题社区"
                    },
                    {
                        "name": "Telegram",
                        "url": "https://web.telegram.org",
                        "icon": "https://a.favicon.im/web.telegram.org",
                        "desc": "高隐私加密即时通讯"
                    },
                    {
                        "name": "V2EX",
                        "url": "https://www.v2ex.com",
                        "icon": "https://a.favicon.im/v2ex.com",
                        "desc": "程序员与极客社区"
                    },
                    {
                        "name": "X (Twitter)",
                        "url": "https://x.com",
                        "icon": "https://a.favicon.im/twitter.com",
                        "desc": "全球实时动态与热点"
                    },
                    {
                        "name": "微博",
                        "url": "https://weibo.com",
                        "icon": "https://a.favicon.im/weibo.com",
                        "desc": "国内热点社交媒体平台"
                    },
                    {
                        "name": "豆瓣",
                        "url": "https://www.douban.com",
                        "icon": "https://a.favicon.im/douban.com",
                        "desc": "图书电影音乐评分社区"
                    }
                ]
            },
            {
                "name": "影音娱乐",
                "icon": "🎬",
                "bookmarks": [
                    {
                        "name": "Bandcamp",
                        "url": "https://bandcamp.com",
                        "icon": "https://a.favicon.im/bandcamp.com",
                        "desc": "独立音乐与数字唱片"
                    },
                    {
                        "name": "Netflix",
                        "url": "https://www.netflix.com",
                        "icon": "https://a.favicon.im/netflix.com",
                        "desc": "全球流媒体影视平台"
                    },
                    {
                        "name": "SoundCloud",
                        "url": "https://soundcloud.com",
                        "icon": "https://a.favicon.im/soundcloud.com",
                        "desc": "独立音乐与音频分享"
                    },
                    {
                        "name": "Spotify",
                        "url": "https://open.spotify.com",
                        "icon": "https://a.favicon.im/spotify.com",
                        "desc": "全球流行音乐流媒体"
                    },
                    {
                        "name": "Steam",
                        "url": "https://store.steampowered.com",
                        "icon": "https://a.favicon.im/store.steampowered.com",
                        "desc": "全球 PC 数字游戏平台"
                    },
                    {
                        "name": "Twitch",
                        "url": "https://www.twitch.tv",
                        "icon": "https://a.favicon.im/twitch.tv",
                        "desc": "全球游戏与实况直播"
                    },
                    {
                        "name": "YouTube",
                        "url": "https://www.youtube.com",
                        "icon": "https://a.favicon.im/youtube.com",
                        "desc": "全球最大视频分享平台"
                    },
                    {
                        "name": "YouTube Music",
                        "url": "https://music.youtube.com",
                        "icon": "https://a.favicon.im/music.youtube.com",
                        "desc": "谷歌音乐与歌曲流媒体"
                    },
                    {
                        "name": "哔哩哔哩",
                        "url": "https://www.bilibili.com",
                        "icon": "https://a.favicon.im/bilibili.com",
                        "desc": "弹幕视频与文化社区"
                    },
                    {
                        "name": "抖音",
                        "url": "https://www.douyin.com",
                        "icon": "https://a.favicon.im/douyin.com",
                        "desc": "短视频与流行文化平台"
                    },
                    {
                        "name": "网易云音乐",
                        "url": "https://music.163.com/st/webplayer",
                        "icon": "https://a.favicon.im/music.163.com",
                        "desc": "发现好音乐与听歌社区"
                    },
                    {
                        "name": "Rate Your Music",
                        "url": "https://rateyourmusic.com",
                        "icon": "https://a.favicon.im/rateyourmusic.com",
                        "desc": "音乐评分与唱片数据库"
                    }
                ]
            },
            {
                "name": "资讯学习",
                "icon": "📰",
                "bookmarks": [
                    {
                        "name": "Google Earth",
                        "url": "https://earth.google.com/web/",
                        "icon": "https://a.favicon.im/earth.google.com",
                        "desc": "三维地球探索工具"
                    },
                    {
                        "name": "Google Maps",
                        "url": "https://maps.google.com",
                        "icon": "https://a.favicon.im/maps.google.com",
                        "desc": "全球地图导航服务"
                    },
                    {
                        "name": "高德地图",
                        "url": "https://www.amap.com",
                        "icon": "https://a.favicon.im/amap.com",
                        "desc": "国内地图导航应用"
                    },
                    {
                        "name": "Internet Archive",
                        "url": "https://archive.org",
                        "icon": "https://a.favicon.im/archive.org",
                        "desc": "互联网数字资料库"
                    },
                    {
                        "name": "Nature",
                        "url": "https://www.nature.com",
                        "icon": "https://a.favicon.im/nature.com",
                        "desc": "权威科学学术期刊"
                    },
                    {
                        "name": "OMG! Ubuntu",
                        "url": "https://www.omgubuntu.co.uk",
                        "icon": "https://a.favicon.im/omgubuntu.co.uk",
                        "desc": "Ubuntu 资讯报道"
                    },
                    {
                        "name": "roadmap.sh",
                        "url": "https://roadmap.sh",
                        "icon": "https://a.favicon.im/roadmap.sh",
                        "desc": "开发者成长路线图"
                    },
                    {
                        "name": "中国天气网",
                        "url": "https://www.weather.com.cn",
                        "icon": "https://a.favicon.im/weather.com.cn",
                        "desc": "气象预报查询平台"
                    },
                    {
                        "name": "少数派",
                        "url": "https://sspai.com",
                        "icon": "https://a.favicon.im/sspai.com",
                        "desc": "数字生活效率社区"
                    },
                    {
                        "name": "维基百科",
                        "url": "https://zh.wikipedia.org",
                        "icon": "https://a.favicon.im/zh.wikipedia.org",
                        "desc": "自由在线百科全书"
                    },
                    {
                        "name": "鸟哥的Linux私房菜",
                        "url": "https://linux.vbird.org",
                        "icon": "https://a.favicon.im/linux.vbird.org",
                        "desc": "经典 Linux 运维教程"
                    }
                ]
            }
        ];

        let pageData = { bookmarks: DEFAULT_BOOKMARKS.map(bm => ({ ...bm })), categories: DEFAULT_CATEGORIES };

        // ==================== 配置 ====================
        const engines = {
            bing: { name: 'Bing', icon: 'https://a.favicon.im/bing.com', url: 'https://www.bing.com/search?q=' },
            google: { name: 'Google', icon: 'https://a.favicon.im/google.com', url: 'https://www.google.com/search?q=' },
            duckduckgo: { name: 'DuckDuckGo', icon: 'https://a.favicon.im/duckduckgo.com', url: 'https://duckduckgo.com/?q=' },
            baidu: { name: '百度', icon: 'https://a.favicon.im/baidu.com', url: 'https://www.baidu.com/s?wd=' }
        };

        /**
         * 预设 2.5K AVIF 本地壁纸轮播列表（快捷键 B 切换，100% 原生零裁切 2.5K 母带分辨率）：
         * bg1.avif - 山峦夜空 (2560x1708 3:2 横屏) https://images.unsplash.com/photo-1477346611705-65d1883cee1e
         * bg2.avif - 湖光山色 (2560x1709 3:2 横屏) https://images.unsplash.com/photo-1506744038136-46273834b3fb
         * bg3.avif - 森林瀑布 (1707x2560 2:3 竖屏) https://images.unsplash.com/photo-1433086966358-54859d0ed716
         * bg4.avif - 星空雪山 (2560x1708 3:2 横屏) https://images.unsplash.com/photo-1519681393784-d120267933ba
         * bg5.avif - 壮丽旷野 (2560x1701 16:10.6 横屏) https://images.unsplash.com/photo-1469474968028-56623f02e42e
         * bg6.avif - 静谧海岸 (2560x1707 3:2 横屏) https://images.unsplash.com/photo-1501785888041-af3ef285b470
         * bg7.avif - 迷雾古堡 (1692x2560 2:3 竖屏) https://images.unsplash.com/photo-1518709268805-4e9042af9f23
         * bg8.avif - 梦幻流彩 (2560x1707 3:2 横屏) https://images.unsplash.com/photo-1550684848-fac1c5b4e853
         */
        const backgrounds = [
            './wallpapers/bg1.avif',
            './wallpapers/bg2.avif',
            './wallpapers/bg3.avif',
            './wallpapers/bg4.avif',
            './wallpapers/bg5.avif',
            './wallpapers/bg6.avif',
            './wallpapers/bg7.avif',
            './wallpapers/bg8.avif'
        ];

        // ==================== 状态与 DOM 缓存 ====================
        const dom = {};
        const state = {
            engine: 'bing',          // 当前激活的搜索引擎 key，对应 engines 对象的键名
            bg: 0,                   // 当前壁纸在 backgrounds 数组中的索引
            open: false,             // 搜索引擎下拉菜单是否展开
            editOpen: false,         // 编辑书签弹窗是否打开（用于屏蔽滚轮切屏与键盘快捷键）
            currentSection: 'start'  // 当前可见屏：'start'（起始页）或 'nav'（导航页）
        };

        /**
         * DOM 快速查找助手函数 (document.getElementById 封装)
         * @param {string} id - 目标 DOM 元素的 ID 字符串
         * @returns {HTMLElement|null} 返回匹配的 DOM 元素节点，未找到时返回 null
         */
        function $(id) { return document.getElementById(id); }

        /**
         * 缓存常用的 DOM 节点对象至 dom 全局映射表中
         * 避免高频交互时反复查询 DOM 节点导致的性能损耗
         * @returns {void}
         */
        function cacheDOM() {
            const ids = 'clock date searchInput searchClearBtn engineBtn engineIcon engineName dropdownMenu suggestionMenu searchBtn bookmarks sidebar sidebarList navCategories navContent editModal editList dragDropIndicator editBookmarksBtn addBookmarkBtn saveEditBtn cancelEditBtn resetEditBtn togglePickerBtn bookmarkPicker pickerContent pickerCount closePickerBtn donePickerBtn exportJsonBtn importJsonInput uploadBgBtn urlBgBtn resetBgBtn uploadBgInput wallpaperStatus bookmarkCountBadge jsonDropzone maskOpacityInput maskOpacityVal bgBlurInput bgBlurVal storageSizeBadge statBookmarkCount statWallpaperType statPwaStatus clearCacheBtn bgOverlay'.split(' ');
            ids.forEach(id => dom[id] = $(id));
        }

        // ==================== 存储工具 ====================
        /**
         * 安全读取 localStorage 中的配置项并反序列化为 JSON
         * 在 Safari 无痕模式或 Cookie 拦截环境下具备 try...catch 保护
         * @param {string} key - 存储的键名
         * @param {*} [fallback=null] - 当键名不存在或读取抛出异常时的默认返回值
         * @returns {*} 解析后的对象/数组或 fallback 默认值
         */
        // LocalStorage 一级 RAM 内存缓存池，彻底消除重复 Disk I/O 与 JSON.parse 开销
        const storageCache = new Map();

        function storageGet(key, fallback = null) {
            if (storageCache.has(key)) {
                return storageCache.get(key);
            }
            try {
                const raw = localStorage.getItem(key);
                const val = raw ? JSON.parse(raw) : fallback;
                storageCache.set(key, val);
                return val;
            } catch {
                return fallback;
            }
        }

        /**
         * 安全写入 JSON 序列化数据至 localStorage
         * @param {string} key - 存储的键名
         * @param {*} value - 需要存储的数据对象/数组/值
         * @returns {boolean} 写入成功返回 true，被沙盒阻断或磁盘超限时返回 false
         */
        function storageSet(key, value) {
            storageCache.set(key, value);
            try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
        }

        /**
         * 安全删除 localStorage 中的指定键名记录
         * @param {string} key - 需移除的键名
         * @returns {boolean} 移除成功返回 true，抛出安全异常时返回 false
         */
        function storageRemove(key) {
            storageCache.delete(key);
            try { localStorage.removeItem(key); return true; } catch { return false; }
        }

        // ==================== 统一 UI 状态与弹窗响应栈 (Overlay Priority Stack) ====================
        const OverlayStack = {
            stack: [],
            push(id, closeFn) {
                this.pop(id);
                this.stack.push({ id, close: closeFn });
                if (id !== 'suggestions') {
                    document.body.classList.add('overflow-hidden', 'touch-none');
                }
            },
            pop(id) {
                let removed = null;
                if (id) {
                    this.stack = this.stack.filter(item => item.id !== id);
                } else {
                    removed = this.stack.pop();
                }
                const modalOverlays = this.stack.filter(item => item.id !== 'suggestions');
                if (modalOverlays.length === 0) {
                    document.body.classList.remove('overflow-hidden', 'touch-none');
                }
                return removed;
            },
            top() {
                return this.stack[this.stack.length - 1] || null;
            },
            has(id) {
                return this.stack.some(item => item.id === id);
            },
            isEmpty() {
                return this.stack.length === 0;
            }
        };

        // ==================== 派生式快捷书签数据架构 (Derived Bookmark Architecture) ====================
        function deriveNameFromUrl(url) {
            try {
                const host = new URL(normalizeUrl(url)).hostname.replace(/^www\./, '');
                return host.split('.')[0] || '书签';
            } catch {
                return '书签';
            }
        }

        /**
         * 从分类数据库中动态派生快捷书签的全量元数据（保证 bookmarks.json 更新可即时应用）
         * @param {string[]} keys - 快捷书签 URL 数组
         * @param {Array} categories - 分类书签数据库
         * @param {Object} [customMeta={}] - 用户添加的自定义元数据
         * @returns {Array} 完整的快捷书签对象数组
         */
        function getDerivedBookmarks(keys, categories, customMeta = {}) {
            if (!Array.isArray(keys)) return [];

            const catMap = new Map();
            if (Array.isArray(categories)) {
                categories.forEach(cat => {
                    if (Array.isArray(cat.bookmarks)) {
                        cat.bookmarks.forEach(bm => {
                            if (bm.url && !catMap.has(normalizeUrl(bm.url))) {
                                catMap.set(normalizeUrl(bm.url), bm);
                            }
                        });
                    }
                });
            }

            return keys.map(url => {
                const normalized = normalizeUrl(url);
                if (customMeta && customMeta[normalized]) {
                    const custom = customMeta[normalized];
                    const catBm = catMap.get(normalized);
                    return {
                        name: custom.name || catBm?.name || deriveNameFromUrl(normalized),
                        url: normalized,
                        icon: custom.icon || catBm?.icon || faviconFromUrl(normalized),
                        desc: custom.desc !== undefined ? custom.desc : (catBm?.desc || '')
                    };
                }
                if (catMap.has(normalized)) {
                    const catBm = catMap.get(normalized);
                    return {
                        name: catBm.name,
                        url: catBm.url,
                        icon: catBm.icon || faviconFromUrl(catBm.url),
                        desc: catBm.desc || ''
                    };
                }
                return {
                    name: deriveNameFromUrl(normalized),
                    url: normalized,
                    icon: faviconFromUrl(normalized)
                };
            });
        }

        /**
         * 自动无缝迁移旧版 localStorage.userBookmarks 静态数组至派生架构
         */
        function migrateBookmarksStorage() {
            const rawUserKeys = storageGet('userBookmarkKeys');
            const rawLegacy = storageGet('userBookmarks');

            if (rawUserKeys && Array.isArray(rawUserKeys)) return;

            if (rawLegacy && Array.isArray(rawLegacy) && rawLegacy.length > 0) {
                const keys = [];
                const customMeta = storageGet('userCustomMeta') || {};

                const existingCatUrls = new Set();
                (DEFAULT_CATEGORIES || []).forEach(cat => {
                    (cat.bookmarks || []).forEach(bm => {
                        if (bm.url) existingCatUrls.add(normalizeUrl(bm.url));
                    });
                });

                rawLegacy.forEach(bm => {
                    if (!bm || !bm.url) return;
                    const normUrl = normalizeUrl(bm.url);
                    keys.push(normUrl);
                    if (!existingCatUrls.has(normUrl)) {
                        customMeta[normUrl] = {
                            name: bm.name || '',
                            icon: bm.icon || '',
                            desc: bm.desc || ''
                        };
                    }
                });

                storageSet('userBookmarkKeys', keys);
                storageSet('userCustomMeta', customMeta);
                storageRemove('userBookmarks');
            }
        }

        /**
         * 提交并持久化用户自定义的快捷书签（更新 URL 顺序列表与自定义扩展表）
         * @param {Array} list - 用户在编辑弹窗提交的书签列表
         */
        function saveUserBookmarks(list) {
            const keys = [];
            const customMeta = storageGet('userCustomMeta') || {};
            const catUrls = new Set();
            const catMetaMap = new Map();
            (pageData.categories || []).forEach(cat => {
                (cat.bookmarks || []).forEach(bm => {
                    if (bm.url) {
                        const nUrl = normalizeUrl(bm.url);
                        catUrls.add(nUrl);
                        if (!catMetaMap.has(nUrl)) catMetaMap.set(nUrl, bm);
                    }
                });
            });

            const newKeysSet = new Set();
            list.forEach(bm => {
                const normUrl = normalizeUrl(bm.url);
                if (!normUrl) return;
                keys.push(normUrl);
                newKeysSet.add(normUrl);
                const catBm = catMetaMap.get(normUrl);
                const isCustomized = !catBm || (bm.name && bm.name !== catBm.name) || (bm.icon && bm.icon !== (catBm.icon || faviconFromUrl(catBm.url))) || (bm.desc && bm.desc !== (catBm.desc || ''));
                if (isCustomized) {
                    customMeta[normUrl] = {
                        name: bm.name,
                        icon: bm.icon,
                        desc: bm.desc || ''
                    };
                } else {
                    delete customMeta[normUrl];
                }
            });

            // 清理已不再使用的旧 URL 自定义元数据，避免废弃 URL 记录永久残留于 localStorage
            Object.keys(customMeta).forEach(urlKey => {
                if (!newKeysSet.has(urlKey)) {
                    delete customMeta[urlKey];
                }
            });

            storageSet('userBookmarkKeys', keys);
            storageSet('userCustomMeta', customMeta);
            pageData.bookmarks = getDerivedBookmarks(keys, pageData.categories, customMeta);
            renderBookmarks();
        }

        // ==================== IndexedDB 4K 壁纸存储工具 (打破 5MB LocalStorage 限制) ====================
        const dbPromise = new Promise(resolve => {
            if (!('indexedDB' in window)) { resolve(null); return; }
            try {
                const req = indexedDB.open('GlassStartDB', 1);
                req.onupgradeneeded = e => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('wallpapers')) {
                        db.createObjectStore('wallpapers');
                    }
                };
                req.onsuccess = e => resolve(e.target.result);
                req.onerror = () => resolve(null);
            } catch { resolve(null); }
        });

        async function getWallpaperDB() {
            try {
                const db = await dbPromise;
                if (!db) return null;
                return new Promise(resolve => {
                    const tx = db.transaction('wallpapers', 'readonly');
                    const store = tx.objectStore('wallpapers');
                    const req = store.get('customWallpaper');
                    req.onsuccess = () => resolve(req.result || null);
                    req.onerror = () => resolve(null);
                });
            } catch { return null; }
        }

        async function setWallpaperDB(dataUrl) {
            try {
                const db = await dbPromise;
                if (!db) return false;
                return new Promise(resolve => {
                    const tx = db.transaction('wallpapers', 'readwrite');
                    const store = tx.objectStore('wallpapers');
                    const req = store.put(dataUrl, 'customWallpaper');
                    req.onsuccess = () => resolve(true);
                    req.onerror = () => resolve(false);
                });
            } catch { return false; }
        }

        async function removeWallpaperDB() {
            try {
                const db = await dbPromise;
                if (!db) return;
                const tx = db.transaction('wallpapers', 'readwrite');
                tx.objectStore('wallpapers').delete('customWallpaper');
            } catch {}
        }

        /**
         * 判断给定 URL 是否命中预设壁纸 backgrounds[] 数组；返回索引，未命中返回 -1。
         * 用于在"保存壁纸草稿"分支中区分「选中系统预设」与「真·自定义壁纸」，
         * 避免把 './wallpapers/bg5.avif' 这类预设路径错误写入 userWallpaper/IDB，
         * 导致 switchBg() 把预设当成"自定义"清掉并强制跳回 bg1（BUG 4a）。
         * @param {string|null|undefined} url
         * @returns {number}
         */
        function findPresetBgIndex(url) {
            if (!url || typeof url !== 'string') return -1;
            // data:URL 与 http(s) 外网图不可能是预设，快速短路
            if (/^(data:|https?:)/i.test(url)) return -1;
            return backgrounds.indexOf(url);
        }

        /**
         * 彻底清除"自定义壁纸"三通道（内存 / IDB / localStorage），不触碰 state.bg。
         * 保存系统预设或恢复默认时统一调用，避免三处清理遗漏。
         * @returns {Promise<void>}
         */
        async function clearCustomWallpaper() {
            state.customWallpaper = null;
            await removeWallpaperDB();
            storageRemove('userWallpaper');
        }

        // ==================== 安全工具 ====================
        /**
         * 协议白名单校验与 URL 安全过滤函数
         * 仅放行 http://, https:// 及 data:image/ 格式协议，彻底阻断 javascript:、vbscript: 等伪协议 XSS 注入
         * @param {string} url - 待校验的原始 URL 字符串
         * @returns {string} 校验通过返回经过 HTML 实体转义的 URL，校验失败时返回 '#' 安全占位符
         */
        function safeUrl(url) {
            const u = (url || '').trim();
            return (/^https?:\/\//i.test(u) || /^data:image\//i.test(u)) ? escapeHtml(u) : '#';
        }

        // ==================== 数据加载 ====================
        /**
         * 异步加载外部 bookmarks.json 配置文件
         * 在 file:// 本地双击协议下直接降级至内存默认值；在 HTTP/HTTPS 下异步 Fetch 最新的配置文件
         * @returns {Promise<void>}
         */
        async function loadData() {
            // 默认完全读取 HTML 内置 DEFAULT_CATEGORIES / DEFAULT_BOOKMARKS 数据，不再请求外部 bookmarks.json
            return;
        }

        /**
         * 加载用户保存在 IndexedDB / localStorage 中的自定义快捷书签与壁纸偏好
         * 用户自定义数据具备最高优先覆盖权
         * @returns {Promise<void>}
         */
        async function loadUserData() {
            migrateBookmarksStorage();
            const userKeys = storageGet('userBookmarkKeys');
            const customMeta = storageGet('userCustomMeta') || {};

            if (userKeys && Array.isArray(userKeys) && userKeys.length) {
                pageData.bookmarks = getDerivedBookmarks(userKeys, pageData.categories, customMeta);
            } else {
                pageData.bookmarks = getDerivedBookmarks(DEFAULT_BOOKMARKS.map(b => b.url), pageData.categories, customMeta);
            }

            // 恢复持久化的系统壁纸轮播索引 state.bg
            const savedBg = storageGet('bg');
            if (savedBg !== null && typeof savedBg === 'number' && savedBg >= 0 && savedBg < backgrounds.length) {
                state.bg = savedBg;
            }

            // 读取自定义壁纸：兼容旧版本 BUG（v1.0 把 './wallpapers/bgN.avif' 预设路径误写入
            // userWallpaper/IDB，导致被当作"自定义壁纸"、按 B 键强制跳回 bg1）。启动时做一次性迁移，
            // 命中预设即还原为对应索引 state.bg 并清掉三通道脏数据。
            let customBg = await getWallpaperDB();
            if (!customBg) customBg = storageGet('userWallpaper');
            const legacyPresetIdx = findPresetBgIndex(customBg);
            if (legacyPresetIdx >= 0) {
                // 旧脏数据迁移：还原 bg 索引，擦除伪自定义通道
                state.bg = legacyPresetIdx;
                storageSet('bg', legacyPresetIdx);
                await clearCustomWallpaper();
                customBg = null;
            }
            if (customBg) {
                state.customWallpaper = customBg;
                applyWallpaper(customBg, false);
            } else if (state.bg !== 0) {
                applyWallpaper(backgrounds[state.bg], false);
            }
        }

        /**
         * 规范化用户输入的 URL：去除首尾空格，若缺少协议头则自动补 https://
         * 用于编辑弹窗保存时处理用户输入的裸域名（如 "github.com"）
         * @param {string} url
         * @returns {string} 规范化后的 URL，空输入返回 ''
         */
        function normalizeUrl(url) {
            url = String(url || '').trim();
            if (!url) return '';
            if (!/^https?:\/\//i.test(url)) {
                return 'https://' + url;
            }
            return url;
        }

        /**
         * 将字符串中的 HTML 特殊字符转义为实体，防止 XSS
         * 用于所有将外部/用户数据插入 innerHTML 模板的场景
         * @param {string} str
         * @returns {string} HTML 转义后的安全字符串
         */
        const htmlEscapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        const htmlEscapeRegex = /[&<>"']/g;
        function escapeHtml(str) {
            return String(str ?? '').replace(htmlEscapeRegex, ch => htmlEscapes[ch]);
        }

        /**
         * 根据书签 URL 自动推断其 favicon 地址（通过 a.favicon.im 服务）
         * 在编辑弹窗保存时，为没有手动指定 icon 的书签自动生成图标 URL
         * @param {string} url - 书签的目标 URL
         * @returns {string} a.favicon.im 代理地址，URL 解析失败时返回 ''
         */
        function faviconFromUrl(url) {
            const normalized = normalizeUrl(url);
            try { return 'https://a.favicon.im/' + new URL(normalized).hostname; } catch { return ''; }
        }

        // ==================== 设置弹窗 Tab 切换与助手函数 ====================
        /**
         * 切换设置弹窗内部的 Tab 选项卡（快捷书签 / 外观壁纸 / 数据与备份）
         * @param {string} targetTabId - 目标 Tab 面板 DOM ID ('tabBookmarks' | 'tabAppearance' | 'tabData')
         * @returns {void}
         */
        function loadPresetBgCardImages() {
            document.querySelectorAll('.preset-bg-card img[data-src]').forEach(img => {
                if (img.dataset.src) {
                    img.src = img.dataset.src;
                    delete img.dataset.src;
                }
            });
        }

        function switchSettingsTab(targetTabId) {
            const tabs = document.querySelectorAll('.settings-tab-btn');
            const panels = document.querySelectorAll('.settings-tab-panel');
            tabs.forEach(tab => {
                const isTarget = tab.dataset.tab === targetTabId;
                tab.classList.toggle('active', isTarget);
                tab.setAttribute('aria-selected', isTarget ? 'true' : 'false');
            });
            panels.forEach(panel => {
                panel.classList.toggle('hidden', panel.id !== targetTabId);
            });
            if (targetTabId === 'tabAppearance') {
                loadPresetBgCardImages();
            }
            if (targetTabId === 'tabData') {
                updateDataTabStats();
            }
        }

        /**
         * 实时应用背景遮罩暗化度与高斯模糊度效果
         * @param {number|string} opacity - 暗色遮罩不透明度百分比 (0 ~ 80)
         * @param {number|string} blur - 背景高斯模糊像素值 (0 ~ 20)
         * @param {boolean} [save=false] - 是否同步持久化至 localStorage
         * @returns {void}
         */
        function applyBgEffects(opacity, blur, save = false) {
            const op = Math.max(0, Math.min(80, parseInt(opacity, 10) || 0));
            const bl = Math.max(0, Math.min(20, parseInt(blur, 10) || 0));
            if (dom.bgOverlay) {
                if (!save) dom.bgOverlay.style.transition = 'none';
                dom.bgOverlay.style.backgroundColor = `rgba(0, 0, 0, ${op / 100})`;
                const blurStyle = bl > 0 ? `blur(${bl}px)` : 'none';
                dom.bgOverlay.style.backdropFilter = blurStyle;
                dom.bgOverlay.style.webkitBackdropFilter = blurStyle;
                if (!save) {
                    requestAnimationFrame(() => {
                        dom.bgOverlay.style.transition = 'background-color 0.2s ease, backdrop-filter 0.2s ease, -webkit-backdrop-filter 0.2s ease';
                    });
                }
            }
            if (dom.maskOpacityVal) dom.maskOpacityVal.textContent = `${op}%`;
            if (dom.bgBlurVal) dom.bgBlurVal.textContent = `${bl}px`;
            if (dom.maskOpacityInput && dom.maskOpacityInput.value != op) dom.maskOpacityInput.value = op;
            if (dom.bgBlurInput && dom.bgBlurInput.value != bl) dom.bgBlurInput.value = bl;
            if (save) {
                storageSet('maskOpacity', op);
                storageSet('bgBlur', bl);
            }
        }

        /**
         * 更新设置弹窗「数据与备份」Tab 中的存储占用容量与项目统计状态
         * @returns {void}
         */
        function updateDataTabStats() {
            if (!dom.storageSizeBadge) return;
            try {
                const raw = JSON.stringify(localStorage);
                const bytes = new TextEncoder().encode(raw).length;
                const kb = (bytes / 1024).toFixed(1);
                dom.storageSizeBadge.textContent = `已用 ${kb} KB`;
            } catch {
                dom.storageSizeBadge.textContent = '读取中...';
            }

            if (dom.statBookmarkCount) {
                const editRows = dom.editList ? dom.editList.querySelectorAll('[data-idx]') : null;
                const count = (editRows && editRows.length > 0) ? editRows.length : pageData.bookmarks.length;
                dom.statBookmarkCount.textContent = count;
            }
            if (dom.statWallpaperType) {
                dom.statWallpaperType.textContent = state.customWallpaper ? '自定义' : '系统';
            }
            if (dom.statPwaStatus) {
                dom.statPwaStatus.textContent = ('serviceWorker' in navigator) ? '就绪' : '未开启';
            }
        }

        const modalState = {
            initialWallpaper: null,
            initialMaskOpacity: 25,
            initialBgBlur: 0,

            draftWallpaper: undefined,
            draftMaskOpacity: null,
            draftBgBlur: null,
            wallpaperChanged: false
        };

        /**
         * 刷新快捷书签数量统计徽章文本
         * @returns {void}
         */
        function updateBookmarkCountBadge() {
            if (!dom.bookmarkCountBadge) return;
            const count = dom.editList ? dom.editList.querySelectorAll('[data-idx]').length : pageData.bookmarks.length;
            dom.bookmarkCountBadge.textContent = `已添加 ${count} 项`;
        }

        /**
         * 刷新预设壁纸库卡片的激活（Active）高亮选中状态
         * @param {string} [customWallpaperOverride] - 选填，草稿模式下用于覆盖当前生效壁纸地址的 URL
         * @returns {void}
         */
        function updatePresetBgCardsUI(customWallpaperOverride) {
            loadPresetBgCardImages();
            const currentBg = customWallpaperOverride !== undefined ? (customWallpaperOverride || backgrounds[state.bg] || '') : (storageGet('userWallpaper') || backgrounds[state.bg] || '');
            document.querySelectorAll('.preset-bg-card').forEach(card => {
                const bg = card.dataset.bg;
                card.classList.toggle('active', bg === currentBg);
            });
        }

        /**
         * 刷新外观壁纸 Tab 中的壁纸来源文字提示与「恢复默认」按钮显隐状态
         * @param {string|null} [customWallpaperOverride] - 选填，草稿模式下的动态壁纸 URL
         * @returns {Promise<void>}
         */
        async function updateWallpaperStatusUI(customWallpaperOverride) {
            const resolveBg = customWallpaperOverride !== undefined
                ? customWallpaperOverride
                : (modalState.draftWallpaper !== null && modalState.draftWallpaper !== undefined
                    ? modalState.draftWallpaper
                    : (state.customWallpaper || await getWallpaperDB() || storageGet('userWallpaper')));
            // 命中预设 backgrounds[] 的 URL 不属于"自定义"，只有 data:/http(s): 以及非预设字符串才算自定义
            const isCustom = !!resolveBg && findPresetBgIndex(resolveBg) === -1;
            if (!dom.wallpaperStatus || !dom.resetBgBtn) return;
            if (isCustom) {
                dom.wallpaperStatus.textContent = '已使用自定义壁纸';
                dom.wallpaperStatus.className = 'text-[10px] text-emerald-400/90 font-medium';
                dom.resetBgBtn.classList.remove('hidden');
            } else {
                dom.wallpaperStatus.textContent = '当前使用默认壁纸';
                dom.wallpaperStatus.className = 'text-[10px] text-white/35';
                dom.resetBgBtn.classList.add('hidden');
            }
        }

        /**
         * 在草稿中实时预览选中的新壁纸（在点击「保存并关闭」之前不持久化）
         * @param {string} urlStr - 目标壁纸的图片 URL 或 DataURL
         * @returns {void}
         */
        function previewDraftWallpaper(urlStr) {
            modalState.draftWallpaper = urlStr;
            modalState.wallpaperChanged = true;
            if (urlStr && /^https?:\/\//i.test(urlStr)) {
                const testImg = new Image();
                testImg.onload = () => { applyWallpaper(urlStr, true); testImg.onload = testImg.onerror = null; };
                testImg.onerror = () => {
                    showConfirm('无法加载该网络图片，请检查图片 URL 是否有效。', null, '图片无法加载');
                    testImg.onload = testImg.onerror = null;
                };
                testImg.src = urlStr;
            } else {
                applyWallpaper(urlStr || backgrounds[state.bg], true);
            }
            updateWallpaperStatusUI(urlStr);
            updatePresetBgCardsUI(urlStr);
        }

        /**
         * 在草稿中重置为默认系统壁纸（在点击「保存并关闭」之前不持久化）
         * @returns {void}
         */
        function resetDraftWallpaper() {
            modalState.draftWallpaper = null;
            modalState.wallpaperChanged = true;
            applyWallpaper(backgrounds[0], true);
            updateWallpaperStatusUI(null);
            updatePresetBgCardsUI(backgrounds[0]);
        }

        // ==================== 编辑快捷书签弹窗 ====================
        /**
         * 生成编辑弹窗中单条书签行内 Favicon 图标 HTML
         * @param {string} name - 书签名称
         * @param {string} url - 书签 URL
         * @returns {string} 图标 HTML 字符串
         */
        function getEditFaviconInner(name = '', url = '', icon = '') {
            const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
            let faviconUrl = icon;
            if (!faviconUrl) {
                const normalizedUrl = normalizeUrl(url);
                if (normalizedUrl) {
                    try {
                        const hostname = new URL(normalizedUrl).hostname;
                        if (hostname && hostname.includes('.')) {
                            faviconUrl = 'https://a.favicon.im/' + hostname;
                        }
                    } catch {
                        faviconUrl = '';
                    }
                }
            }
            if (faviconUrl) {
                return `<div class="icon-box icon-box-sm edit-favicon-img-wrapper"><img src="${escapeHtml(faviconUrl)}" width="24" height="24" data-initial="${escapeHtml(initial)}" class="opacity-90 edit-favicon-img" alt="" loading="lazy" decoding="async"></div>`;
            }
            return `<div class="icon-box icon-box-sm bg-white/15 border border-white/20 text-white/90 text-2xs font-semibold edit-favicon-initial">${escapeHtml(initial)}</div>`;
        }

        /**
         * 处理编辑弹窗中行内 Favicon 图片加载失败的情况，优雅降级为首字母文字
         * @param {HTMLImageElement} img - 发生错误的 <img> 元素
         */
        function handleEditIconError(img) {
            if (!img || img.dataset.failed) return;
            img.dataset.failed = '1';
            const initial = img.dataset.initial || '?';
            const box = img.closest('.edit-favicon-box');
            if (box) {
                box.innerHTML = `<div class="icon-box icon-box-sm bg-white/15 border border-white/20 text-white/90 text-2xs font-semibold edit-favicon-initial">${escapeHtml(initial)}</div>`;
            }
        }
        window.handleEditIconError = handleEditIconError;

        /**
         * 生成编辑弹窗中单条书签行的 HTML 模板
         * 支持双轨自适应（移动端窄屏切为上下两轨，桌面端单横轨）及全卡片拖拽与实时 Favicon
         * @param {string} [name=''] - 书签名称
         * @param {string} [url=''] - 书签 URL
         * @param {number|string} [idx=''] - 行索引数据标记
         * @param {string} [icon=''] - 书签自定义或原图标 URL
         * @returns {string} 行 HTML 拼接字符串
         */
        function getEditRowHTML(name = '', url = '', idx = '', icon = '') {
            const rowId = (idx !== '' && idx !== undefined) ? idx : Date.now();
            return `
                <div class="edit-row-card flex flex-wrap sm:flex-nowrap items-center gap-1.5 p-1.5 px-2 bg-white/5 border border-white/10 apple-radius hover:border-white/25 transition-all group mb-1.5 shadow-xs" data-idx="${idx}" data-icon="${escapeHtml(icon || '')}" data-orig-url="${escapeHtml(url || '')}" draggable="true">
                    <div class="flex items-center gap-1.5 shrink-0">
                        <div class="drag-handle p-1 shrink-0 text-white/30 group-hover:text-white/70 hover:!text-white cursor-grab active:cursor-grabbing transition-all" title="按住拖拽排序">
                            <svg class="size-3.5 pointer-events-none" viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="4" r="1.5"/><circle cx="11" cy="4" r="1.5"/><circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/><circle cx="5" cy="12" r="1.5"/><circle cx="11" cy="12" r="1.5"/></svg>
                        </div>
                        <div class="flex flex-col gap-0.5 shrink-0">
                            <button type="button" class="move-up-btn p-0.5 text-3xs leading-none hover:bg-white/10 apple-radius text-white/40 hover:text-white transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/50" title="上移书签">▲</button>
                            <button type="button" class="move-down-btn p-0.5 text-3xs leading-none hover:bg-white/10 apple-radius text-white/40 hover:text-white transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/50" title="下移书签">▼</button>
                        </div>
                        <div class="edit-favicon-box shrink-0 flex items-center justify-center text-white/90 select-none">
                            ${getEditFaviconInner(name, url, icon)}
                        </div>
                    </div>
                    <div class="flex-1 flex flex-col sm:flex-row items-center gap-1.5 min-w-0 w-full sm:w-auto">
                        <input type="text" id="bm-name-${rowId}" name="bookmark_name_${rowId}" class="edit-name w-full sm:w-1/3 bg-black/20 border border-white/10 apple-radius px-2.5 py-1.5 text-xs text-white/90 focus:border-white/40 focus:bg-black/40 outline-none transition" value="${escapeHtml(name)}" placeholder="书签名称" aria-label="书签名称">
                        <input type="text" id="bm-url-${rowId}" name="bookmark_url_${rowId}" class="edit-url w-full sm:w-2/3 bg-black/20 border border-white/10 apple-radius px-2.5 py-1.5 text-xs text-white/75 focus:border-white/40 focus:bg-black/40 focus:text-white outline-none transition font-mono" value="${escapeHtml(url)}" placeholder="https://..." aria-label="书签网址">
                    </div>
                    <button type="button" class="del-btn shrink-0 p-1.5 hover:bg-red-500/20 apple-radius text-white/30 hover:text-red-400 transition ml-auto sm:ml-0" title="删除书签">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                </div>
            `;
        }

        /**
         * 渲染编辑弹窗中的快捷书签列表 DOM
         * @param {Bookmark[]} [listToRender] - 选填，渲染指定的书签数组，未传时默认渲染 pageData.bookmarks
         * @returns {void}
         */
        function renderEditList(listToRender) {
            const list = listToRender || pageData.bookmarks;
            dom.editList.innerHTML = '<div id="dragDropIndicator" class="drag-drop-line"></div>' + list.map((bm, i) => getEditRowHTML(bm.name, bm.url, i, bm.icon)).join('');
            dom.dragDropIndicator = dom.editList.querySelector('#dragDropIndicator');
            updateBookmarkCountBadge();
        }

        /**
         * 从编辑弹窗的 DOM 列表中读取当前所有书签条目
         * 遍历每行的名称/URL 输入框，过滤掉名称或 URL 为空的无效行，
         * 并自动为每条记录生成 icon（若 URL 未变且有自定义 icon 则保留，URL 被修改则重新生成）
         * @returns {Bookmark[]} 书签对象数组，可直接写入 pageData.bookmarks
         */
        function collectEditData() {
            const items = dom.editList.querySelectorAll('[data-idx]');
            const bookmarks = [];
            items.forEach(el => {
                const name = (el.querySelector('.edit-name')?.value || '').trim();
                let url = (el.querySelector('.edit-url')?.value || '').trim();
                url = normalizeUrl(url);
                const origIcon = el.dataset.icon || '';
                const origUrl = normalizeUrl(el.dataset.origUrl || '');
                if (name && url) {
                    let icon = '';
                    if (origIcon && (url === origUrl || !origUrl)) {
                        icon = origIcon;
                    } else {
                        icon = faviconFromUrl(url);
                    }
                    bookmarks.push({ name, url, icon });
                }
            });
            return bookmarks;
        }

        let editModalTriggerEl = null;

        /**
         * 打开设置与偏好弹窗，备份打开前的初始配置以备取消时回滚
         * @returns {void}
         */
        async function openEditModal() {
            editModalTriggerEl = document.activeElement;
            state.editOpen = true;
            OverlayStack.push('editModal', cancelEditModal);

            // 备份打开前的初始配置：自定义壁纸存储于 IndexedDB（保存路径只写 IDB 并清理了
            // localStorage），因此必须优先取 state.customWallpaper / IDB，localStorage 仅作历史兜底；
            // 否则“取消”回滚会错误地丢失当前生效的自定义壁纸
            modalState.initialWallpaper = state.customWallpaper || await getWallpaperDB() || storageGet('userWallpaper');
            if (!state.editOpen) return; // 若在读取 IDB 期间用户按 Esc 取消了弹窗，中断后续渲染逻辑
            modalState.initialMaskOpacity = storageGet('maskOpacity', 25);
            modalState.initialBgBlur = storageGet('bgBlur', 0);

            // 初始化草稿值
            modalState.draftWallpaper = modalState.initialWallpaper;
            modalState.draftMaskOpacity = modalState.initialMaskOpacity;
            modalState.draftBgBlur = modalState.initialBgBlur;
            modalState.wallpaperChanged = false;

            switchSettingsTab('tabBookmarks');
            renderEditList();
            updateWallpaperStatusUI(modalState.draftWallpaper);
            updatePresetBgCardsUI(modalState.draftWallpaper);
            applyBgEffects(modalState.draftMaskOpacity, modalState.draftBgBlur, false);
            dom.editModal.removeAttribute('aria-hidden');
            dom.editModal.removeAttribute('hidden');
            dom.editModal.classList.add('active');
        }

        /**
         * 取消编辑并关闭弹窗，撤销草稿中的预览变更，回滚至打开前的原始配置
         * @returns {void}
         */
        function cancelEditModal() {
            // 撤销草稿中的预览变更，滚回打开前的真实配置
            if (modalState.wallpaperChanged) {
                const bgToRestore = modalState.initialWallpaper || backgrounds[state.bg];
                applyWallpaper(bgToRestore, false);
            }
            applyBgEffects(modalState.initialMaskOpacity, modalState.initialBgBlur, false);
            closeEditModal();
        }

        /**
         * 关闭设置与偏好弹窗
         * @returns {void}
         */
        function closeEditModal() {
            state.editOpen = false;
            OverlayStack.pop('editModal');
            if (document.activeElement && dom.editModal.contains(document.activeElement)) {
                document.activeElement.blur();
            }
            dom.editModal.setAttribute('aria-hidden', 'true');
            dom.editModal.setAttribute('hidden', '');
            dom.editModal.classList.remove('active');

            if (editModalTriggerEl && typeof editModalTriggerEl.focus === 'function') {
                const opener = editModalTriggerEl;
                editModalTriggerEl = null;
                requestAnimationFrame(() => opener.focus());
            }
        }

        // ==================== 纯前端 JSON 配置文件导入与导出 ====================
        /**
         * 导出当前快捷书签为 JSON 格式备份文件
         * 自动触发浏览器下载，文件名为 startpage_bookmarks_YYYY-MM-DD.json
         * @returns {void}
         */
        function exportBookmarksJSON() {
            const data = collectEditData();
            const bookmarksToExport = data.length ? data : pageData.bookmarks;
            const exportData = {
                version: '1.0',
                exportDate: new Date().toISOString(),
                bookmarks: bookmarksToExport
            };
            const jsonStr = JSON.stringify(exportData, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const d = new Date();
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            a.href = url;
            a.download = `startpage_bookmarks_${dateStr}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        /**
         * 读取并解析用户选择/拖入的 JSON 备份文件，校验结构后填入编辑草稿列表中
         * @param {File} file - 用户选择的 JSON File 对象
         * @returns {void}
         */
        function importBookmarksJSON(file) {
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const parsed = JSON.parse(e.target.result);
                    let importedList = [];
                    if (Array.isArray(parsed)) {
                        importedList = parsed;
                    } else if (parsed && Array.isArray(parsed.bookmarks)) {
                        importedList = parsed.bookmarks;
                    } else if (parsed && Array.isArray(parsed.categories)) {
                        parsed.categories.forEach(cat => {
                            if (cat && Array.isArray(cat.bookmarks)) importedList.push(...cat.bookmarks);
                        });
                    } else {
                        showConfirm('上传的配置文件结构不匹配，未包含有效的书签数组。', null, '格式错误');
                        return;
                    }

                    const validBookmarks = [];
                    importedList.forEach(item => {
                        if (item && typeof item === 'object' && (item.name || item.url)) {
                            const name = String(item.name || '未命名').trim().slice(0, 60);
                            const rawUrl = String(item.url || '').trim();
                            const url = normalizeUrl(rawUrl);
                            if (name && url && (/^https?:\/\//i.test(url) || url.startsWith('data:'))) {
                                const rawIcon = typeof item.icon === 'string' && item.icon.trim() ? item.icon.trim() : faviconFromUrl(url);
                                const icon = safeUrl(rawIcon) !== '#' ? rawIcon : faviconFromUrl(url);
                                const desc = typeof item.desc === 'string' ? item.desc.trim().slice(0, 40) : '';
                                validBookmarks.push({ name, url, icon, desc });
                            }
                        }
                    });

                    if (validBookmarks.length === 0) {
                        showConfirm('配置文件中没有提取到有效的书签条目。', null, '导入失败');
                        return;
                    }

                    showConfirm(`检测到合规书签 ${validBookmarks.length} 项，确定导入并填入草稿列表中吗？需点击『保存并关闭』后生效。`, () => {
                        renderEditList(validBookmarks);
                        closeBookmarkPicker();
                    }, '导入草稿确认');
                } catch (err) {
                    showConfirm('解析 JSON 配置文件失败，请检查文件格式。', null, '解析错误');
                } finally {
                    reader.onload = null;
                }
            };
            reader.readAsText(file, 'UTF-8');
        }

        // ==================== 自定义确认弹窗（替代原生 confirm()）====================
        /**
         * 显示玻璃风格的确认弹窗，用事件回调替代阻塞式 confirm()
         * @param {string} message   - 弹窗正文
         * @param {Function} onConfirm - 用户点击「确认」后执行的回调
         */
        // 当前已挂载监听的确认弹窗清理函数（防叠加：上一弹窗未关闭时再次 showConfirm，先解除旧监听再挂新监听）
        let activeConfirmCleanup = null;
        function showConfirm(message, onConfirm, title = '重置确认') {
            const modal = $('confirmModal');
            const titleEl = $('confirmTitle');
            const msgEl = $('confirmMsg');
            const okBtn = $('confirmOkBtn');
            const cancelBtn = $('confirmCancelBtn');
            // 降级兜底：弹窗 DOM 不存在时退回原生 confirm
            if (!modal) { if (window.confirm(message)) onConfirm?.(); return; }

            // 防重：若上一个弹窗尚未关闭（监听仍挂载于同一组按钮上），先调用其 cleanup 解除监听，
            // 避免同屏叠加多套监听导致点击一次确认触发多次 onConfirm 回调
            if (activeConfirmCleanup) {
                activeConfirmCleanup();
                activeConfirmCleanup = null;
            }

            // 区分「纯通知」（onConfirm 为 null）和「确认操作」两种模式
            const isNotify = onConfirm == null;
            okBtn.textContent = isNotify ? '知道了' : '确认';
            cancelBtn.style.display = isNotify ? 'none' : '';

            if (titleEl) titleEl.textContent = title;
            msgEl.textContent = message;
            modal.removeAttribute('aria-hidden');
            modal.removeAttribute('hidden');
            modal.classList.add('active');
            OverlayStack.push('confirmModal', cleanup);

            function cleanup() {
                activeConfirmCleanup = null;
                OverlayStack.pop('confirmModal');
                if (document.activeElement && modal.contains(document.activeElement)) {
                    document.activeElement.blur();
                }
                modal.setAttribute('aria-hidden', 'true');
                modal.setAttribute('hidden', '');
                modal.classList.remove('active');
                cancelBtn.style.display = '';
                okBtn.removeEventListener('click', handleOk);
                cancelBtn.removeEventListener('click', handleCancel);
                modal.removeEventListener('click', handleBackdropClick);
            }

            function handleOk() { cleanup(); onConfirm?.(); }
            function handleCancel() { cleanup(); }
            function handleBackdropClick(e) {
                if (e.target === modal) {
                    cleanup();
                }
            }

            okBtn.addEventListener('click', handleOk);
            if (!isNotify) cancelBtn.addEventListener('click', handleCancel);
            modal.addEventListener('click', handleBackdropClick);
            activeConfirmCleanup = cleanup;
        }

        /**
         * 恢复系统初始默认状态（重置用户快捷书签、背景壁纸与偏好设置）
         * 触发二步确认弹窗，确认后清除相关 localStorage 记录并即时生效
         * @returns {void}
         */
        function resetBookmarks() {
            // 清除 localStorage 用户编辑与偏好设置，恢复系统初始默认配置并立即生效
            showConfirm('确定要恢复系统初始默认状态吗？此操作将立即清除您自定义的所有快捷书签、背景壁纸与偏好设置。', () => {
                storageRemove('userBookmarks');
                storageRemove('userBookmarkKeys');
                storageRemove('userCustomMeta');
                storageRemove('preferredEngine');
                storageRemove('userWallpaper');
                storageRemove('maskOpacity');
                storageRemove('bgBlur');
                storageRemove('bg'); // 清除持久化的壁纸轮播索引，与 state.bg = 0 保持一致

                // 自定义壁纸实际持久化于 IndexedDB（保存路径只写 IDB 并清理了 localStorage），
                // 重置时必须同步清除 IDB 与内存状态，否则刷新页面后自定义壁纸会“复活”
                removeWallpaperDB();
                state.customWallpaper = null;

                modalState.draftWallpaper = undefined;
                modalState.draftMaskOpacity = null;
                modalState.draftBgBlur = null;
                modalState.wallpaperChanged = false;

                setEngine('bing', false);
                state.bg = 0;
                applyWallpaper(backgrounds[0], false);
                applyBgEffects(25, 0, false);
                pageData.bookmarks = getDerivedBookmarks(DEFAULT_BOOKMARKS.map(b => b.url), pageData.categories);
                renderBookmarks();
                closeBookmarkPicker();
                closeEditModal();
            }, '重置所有系统设置');
        }


        // ==================== 从导航页选择弹窗 ====================
        /**
         * 打开「从导航页选择」批量挑选弹窗，渲染所有分类及其包含的站点列表
         * @returns {void}
         */
        function openBookmarkPicker() {
            OverlayStack.push('bookmarkPicker', closeBookmarkPicker);
            dom.bookmarkPicker.removeAttribute('aria-hidden');
            dom.bookmarkPicker.removeAttribute('hidden');
            dom.bookmarkPicker.classList.add('active');
            renderPickerCategories();
        }

        /**
         * 关闭「从导航页选择」挑选弹窗
         * @returns {void}
         */
        function closeBookmarkPicker() {
            OverlayStack.pop('bookmarkPicker');
            if (document.activeElement && dom.bookmarkPicker.contains(document.activeElement)) {
                document.activeElement.blur();
            }
            dom.bookmarkPicker.setAttribute('aria-hidden', 'true');
            dom.bookmarkPicker.setAttribute('hidden', '');
            dom.bookmarkPicker.classList.remove('active');
        }

        // ==================== 编辑列表拖拽排序 & 实时感知 ====================
        /**
         * 初始化编辑弹窗中书签条目的 HTML5 拖拽排序（Drag & Drop）与实时 input 监听器
         * 支持整条卡片拖拽随动、.dragging 蓝边虚线透光态与 .drag-over-top / .drag-over-bottom 蓝光插入指示线
         * @returns {void}
         */
        function initDragSort() {
            let dragSrc = null;

            function clearDragClasses() {
                if (dragOverRafId) {
                    cancelAnimationFrame(dragOverRafId);
                    dragOverRafId = null;
                }
                dom.editList.querySelectorAll('.edit-row-card').forEach(el => {
                    el.classList.remove('dragging');
                });
                if (dom.dragDropIndicator) {
                    dom.dragDropIndicator.style.opacity = '0';
                }
                lastOverTarget = null;
                lastIsTop = null;
            }

            dom.editList.addEventListener('dragstart', e => {
                // 如果拖拽是从输入框发起的，放行输入框本身的选中文本操作，不触发卡片拖拽
                if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
                    e.preventDefault();
                    return;
                }

                const item = e.target.closest('.edit-row-card');
                if (!item) return;

                dragSrc = item;
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                try {
                    e.dataTransfer.setData('text/plain', item.dataset.idx || '');
                } catch (_) {}
            });

            dom.editList.addEventListener('dragend', () => {
                clearDragClasses();
                dragSrc = null;
            });

            let dragOverRafId = null;
            let lastOverTarget = null;
            let lastIsTop = null;

            dom.editList.addEventListener('dragover', e => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';

                const target = e.target.closest('.edit-row-card');
                if (!target || target === dragSrc) return;

                if (dragOverRafId) return;
                dragOverRafId = requestAnimationFrame(() => {
                    dragOverRafId = null;

                    const rect = target.getBoundingClientRect();
                    const relY = (e.clientY - rect.top) / rect.height;

                    // 15% 中点门限死区 (Hysteresis Buffer)
                    let isTop = true;
                    if (lastOverTarget === target && lastIsTop !== null) {
                        isTop = lastIsTop ? (relY <= 0.58) : (relY < 0.42);
                    } else {
                        isTop = relY < 0.5;
                    }

                    lastOverTarget = target;
                    lastIsTop = isTop;

                    // 计算独立发光线条在两卡片 6px 间隙正中央的绝对位移
                    const lineY = isTop ? (target.offsetTop - 4.5) : (target.offsetTop + target.offsetHeight + 1.5);

                    if (dom.dragDropIndicator) {
                        dom.dragDropIndicator.style.transform = `translate3d(0, ${lineY}px, 0)`;
                        dom.dragDropIndicator.style.opacity = '1';
                    }
                });
            });

            dom.editList.addEventListener('dragleave', e => {
                // 仅当划出整个 editList 容器时才清除高亮，避免子节点间移动引发闪烁
                if (e.target === dom.editList || !dom.editList.contains(e.relatedTarget)) {
                    clearDragClasses();
                }
            });

            dom.editList.addEventListener('drop', e => {
                e.preventDefault();
                const target = lastOverTarget || e.target.closest('.edit-row-card');
                const isTop = lastIsTop !== null ? lastIsTop : true;
                clearDragClasses();

                if (!target || !dragSrc || target === dragSrc) return;

                // FLIP Step 1: 记录初始位置 (First)
                const cards = Array.from(dom.editList.querySelectorAll('.edit-row-card'));
                const firstPositions = new Map();
                cards.forEach(card => {
                    firstPositions.set(card, card.getBoundingClientRect());
                });

                // FLIP Step 2: 执行 DOM 重排 (Last)
                if (isTop) {
                    target.parentNode.insertBefore(dragSrc, target);
                } else {
                    target.parentNode.insertBefore(dragSrc, target.nextSibling);
                }

                // FLIP Step 3: 倒置偏差并播放物理滑入 (Invert & Play)
                cards.forEach(card => {
                    const first = firstPositions.get(card);
                    const last = card.getBoundingClientRect();
                    if (!first || !last) return;

                    const deltaY = first.top - last.top;
                    const deltaX = first.left - last.left;

                    if (deltaY !== 0 || deltaX !== 0) {
                        card.style.transition = 'none';
                        card.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;

                        // 强制重绘 (Reflow)
                        card.offsetHeight;

                        card.style.transition = 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)';
                        card.style.transform = 'translate3d(0, 0, 0)';

                        setTimeout(() => {
                            card.style.transition = '';
                            card.style.transform = '';
                        }, 360);
                    }
                });

                updateBookmarkCountBadge();
            });

            let touchDragCard = null;
            let touchCapturedId = null;

            dom.editList.addEventListener('pointerdown', e => {
                if (e.pointerType === 'mouse') return;
                const handle = e.target.closest('.drag-handle');
                if (!handle) return;
                const item = handle.closest('.edit-row-card');
                if (!item) return;

                touchDragCard = item;
                dragSrc = item;
                item.classList.add('dragging');
                touchCapturedId = e.pointerId;
                try { handle.setPointerCapture(e.pointerId); } catch (_) {}
            });

            let touchMoveRafId = null;
            dom.editList.addEventListener('pointermove', e => {
                if (!touchDragCard || e.pointerId !== touchCapturedId) return;
                if (touchMoveRafId) return;
                const clientX = e.clientX;
                const clientY = e.clientY;
                touchMoveRafId = requestAnimationFrame(() => {
                    touchMoveRafId = null;
                    const target = document.elementFromPoint(clientX, clientY)?.closest('.edit-row-card');
                    if (!target || target === touchDragCard) return;

                    const rect = target.getBoundingClientRect();
                    const relY = (clientY - rect.top) / rect.height;
                    const isTop = relY < 0.5;

                    lastOverTarget = target;
                    lastIsTop = isTop;

                    const lineY = isTop ? (target.offsetTop - 4.5) : (target.offsetTop + target.offsetHeight + 1.5);
                    if (dom.dragDropIndicator) {
                        dom.dragDropIndicator.style.transform = `translate3d(0, ${lineY}px, 0)`;
                        dom.dragDropIndicator.style.opacity = '1';
                    }
                });
            });

            const handleTouchPointerEnd = e => {
                if (!touchDragCard || e.pointerId !== touchCapturedId) return;
                const target = lastOverTarget;
                const isTop = lastIsTop !== null ? lastIsTop : true;

                if (target && dragSrc && target !== dragSrc) {
                    if (isTop) {
                        target.parentNode.insertBefore(dragSrc, target);
                    } else {
                        target.parentNode.insertBefore(dragSrc, target.nextSibling);
                    }
                }

                clearDragClasses();
                try { e.target.releasePointerCapture(e.pointerId); } catch (_) {}
                touchDragCard = null;
                touchCapturedId = null;
                dragSrc = null;
            };

            dom.editList.addEventListener('pointerup', handleTouchPointerEnd);
            dom.editList.addEventListener('pointercancel', handleTouchPointerEnd);

            // 实时 Favicon 与首字母图标感知：修改 URL 或名称时自动抓取刷新
            let editFaviconDebounceTimer = null;
            dom.editList.addEventListener('input', e => {
                const target = e.target;
                const row = target.closest('.edit-row-card');
                if (!row) return;

                const nameInput = row.querySelector('.edit-name');
                const urlInput = row.querySelector('.edit-url');
                const faviconBox = row.querySelector('.edit-favicon-box');
                if (!faviconBox) return;

                const nameVal = nameInput ? nameInput.value : '';
                const urlVal = urlInput ? urlInput.value : '';
                const initial = (nameVal || '?').trim().charAt(0).toUpperCase() || '?';

                const existingImg = faviconBox.querySelector('.edit-favicon-img');
                const existingInitial = faviconBox.querySelector('.edit-favicon-initial');
                if (existingImg) {
                    existingImg.dataset.initial = initial;
                }
                if (existingInitial) {
                    existingInitial.textContent = initial;
                }

                if (target.classList.contains('edit-url')) {
                    clearTimeout(editFaviconDebounceTimer);
                    editFaviconDebounceTimer = setTimeout(() => {
                        faviconBox.innerHTML = getEditFaviconInner(nameVal, urlVal);
                    }, 180);
                } else if (target.classList.contains('edit-name')) {
                    if (!existingImg || existingImg.dataset.failed === '1') {
                        faviconBox.innerHTML = getEditFaviconInner(nameVal, urlVal);
                    }
                }
            });
        }

        /**
         * 渲染导航页所有分类及其包含的书签列表至挑选弹窗中
         * 自动标记已存在于快捷书签中的站点为不可选状态
         * @returns {void}
         */
        const zhCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

        function renderPickerCategories() {
            const urls = new Set();
            dom.editList.querySelectorAll('.edit-url').forEach(inp => {
                const norm = normalizeUrl(inp.value);
                if (norm) urls.add(norm);
            });
            pageData.bookmarks.forEach(bm => {
                const norm = normalizeUrl(bm.url);
                if (norm) urls.add(norm);
            });

            dom.pickerContent.innerHTML = pageData.categories.map(cat => {
                const sortedBookmarks = [...cat.bookmarks].sort((a, b) => zhCollator.compare(a.name, b.name));
                return `
                <div>
                    <div class="flex items-center gap-1.5 mb-1.5 pb-1 border-b border-white/5">
                        <span class="text-sm">${escapeHtml(cat.icon)}</span>
                        <h4 class="text-xs font-medium text-white/70">${escapeHtml(cat.name)}</h4>
                        <span class="ml-auto text-[10px] text-white/20">${cat.bookmarks.length}</span>
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-1">
                        ${sortedBookmarks.map(bm => {
                            const exists = urls.has(bm.url);
                            return `
                                <div class="flex items-center gap-2 px-2 py-1.5 apple-radius picker-item ${exists ? 'opacity-40' : 'hover:bg-white/10 cursor-pointer'}" ${!exists ? `data-name="${escapeHtml(bm.name)}" data-url="${escapeHtml(bm.url)}"` : ''}>
                                    ${getFaviconHTML(bm, 'sm')}
                                    <span class="text-xs text-white/70 truncate flex-1">${escapeHtml(bm.name)}</span>
                                    ${exists
                                        ? '<span class="text-[10px] text-white/20 shrink-0">已存在</span>'
                                        : '<span class="text-white/40 shrink-0 text-sm">+</span>'
                                    }
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
            }).join('');
            updatePickerCount();
            initFaviconObserver();
        }

        /**
         * 刷新挑选弹窗底部的已选择书签计数
         * @returns {void}
         */
        function updatePickerCount() {
            const count = dom.editList.querySelectorAll('[data-idx]').length;
            dom.pickerCount.textContent = `已添加 ${count} 项`;
        }

        // ==================== 后台预加载图标（仅预加载首屏快捷书签）====================
        /**
         * 预加载首屏快捷书签的 Favicon 图标，提升页面初次加载体验
         * @returns {void}
         */
        function preloadFavicons() {
            const urls = new Set();
            pageData.bookmarks.forEach(bm => { if (bm.icon) urls.add(bm.icon); });
            urls.forEach(url => {
                const img = new Image();
                img.onload = img.onerror = () => { img.onload = img.onerror = null; };
                img.src = url;
            });
        }

        /**
         * 应用入口，按严格顺序初始化所有模块
         *
         * 执行顺序存在以下依赖，调整顺序可能导致静默错误，请勿随意变更：
         *   1. cacheDOM()         — 必须最先执行，所有后续函数通过 dom.* 访问元素
         *   2. loadUserData()     — 先从 localStorage 同步恢复用户编辑的书签
         *   3. renderBookmarks()  — 渲染首屏书签（此时已是用户数据或内置默认值）
         *   4. renderNavCategories() + initSidebarNav() — 渲染导航页，后者依赖前者生成的 DOM
         *   5. loadData()（异步） — 直接读取内置 DEFAULT_* 默认值，不发起外部网络请求
         */
        let isAppInitialized = false;
        function init() {
            if (isAppInitialized) return;
            isAppInitialized = true;
            cacheDOM();
            document.addEventListener('error', e => {
                if (e.target && e.target.tagName === 'IMG' && e.target.classList.contains('engine-icon')) {
                    e.target.style.display = 'none';
                }
            }, true);
            updateClock();
            loadUserData().catch(() => {});
            renderBookmarks();
            renderNavCategories(); // 内部已调用 initSidebarNav()，无需重复
            initScrollControl();
            const saved = storageGet('preferredEngine');
            if (saved && engines[saved]) setEngine(saved, false);
            setInterval(updateClock, 1000);
            bindEvents();
            bindEditEvents();
            const savedOpacity = storageGet('maskOpacity', 25);
            const savedBlur = storageGet('bgBlur', 0);
            applyBgEffects(savedOpacity, savedBlur);
            preloadNextBg();
            preloadFavicons();
            if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
            
            // 调度空闲任务，避免 manifest.json 与 loadData() 抢占关键路径带宽（消除 Critical Request Chain 警告）
            const scheduleIdleTask = (fn, fallbackDelay = 1500) => {
                if ('requestIdleCallback' in window) {
                    requestIdleCallback(fn, { timeout: 3000 });
                } else {
                    setTimeout(fn, fallbackDelay);
                }
            };

            if (location.protocol.startsWith('http')) {
                scheduleIdleTask(() => {
                    if (!document.querySelector('link[rel="manifest"]')) {
                        const originUrl = location.origin + location.pathname;
                        const manifestObj = {
                            name: "Glass Start — 轻量级玻璃拟态浏览器起始页",
                            short_name: "Glass Start",
                            description: "基于 HTML5 与 Modern JS 构建的高颜值、轻量级玻璃拟态（Glassmorphism）浏览器起始页。",
                            id: originUrl,
                            scope: originUrl,
                            start_url: originUrl,
                            display: "standalone",
                            display_override: ["standalone", "minimal-ui"],
                            background_color: "#0f172a",
                            theme_color: "#0f172a",
                            icons: [{
                                src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🪐%3C/text%3E%3C/svg%3E",
                                sizes: "512x512",
                                type: "image/svg+xml",
                                purpose: "any maskable"
                            }]
                        };
                        const blob = new Blob([JSON.stringify(manifestObj)], { type: 'application/manifest+json' });
                        const manifestLink = document.createElement('link');
                        manifestLink.rel = 'manifest';
                        manifestLink.href = URL.createObjectURL(blob);
                        document.head.appendChild(manifestLink);
                    }
                }, 1000);
            }

            scheduleIdleTask(() => {
                loadData().then(() => {
                    if (!storageGet('userBookmarkKeys')) {
                        renderBookmarks();
                    }
                    renderNavCategories();
                });
            }, 1500);

        }

        // ==================== 苹果风格 Favicon 兜底徽章 (严格尺寸强制归一) ====================
        /**
         * 图像加载失败时的全局 onerror 降级回调
         * 将加载失败的 <img> 节点替换为带站点首字母的 Apple 风格半透明徽章
         * @param {HTMLImageElement} img - 加载失败的图片节点
         * @returns {void}
         */
        function handleIconError(img) {
            if (!img || img.dataset.failed) return;
            img.dataset.failed = '1';
            const initial = img.dataset.initial || '?';
            const parent = img.parentElement;
            if (parent) {
                img.remove();
                const isMd = img.dataset.md === '1';
                const textClass = isMd ? 'text-xs' : 'text-[10px]';
                parent.classList.add('bg-white/15', 'border', 'border-white/20', 'text-white/90', textClass, 'font-semibold');
                parent.textContent = initial;
            }
        }
        window.handleIconError = handleIconError;

        // 全局捕获阶段图片加载错误处理器，彻底代替 HTML 模板行内 onerror 绑定
        document.addEventListener('error', (e) => {
            const target = e.target;
            if (target && target.tagName === 'IMG') {
                if (target.classList.contains('edit-favicon-img')) {
                    handleEditIconError(target);
                } else if (target.dataset.initial !== undefined || target.closest('.icon-box')) {
                    handleIconError(target);
                } else if (target.dataset.hideOnError === '1') {
                    target.style.display = 'none';
                }
            }
        }, true);

        /**
         * 根据书签数据对象生成规范化的 Favicon HTML 图标结构
         * 自动处理缺失图标时的首字母文字徽章，以及合法 URL 图片节点的生成
         * 📌 网络优先级调优 (HTTP/2 Multiplexing & Lazy Loading):
         *    - 首屏 8 个快捷图标 (isMd): 设置 loading="eager" fetchpriority="high"，确保首页开屏瞬间高清渲染。
         *    - 视口下方导航页 90+ 图标 (sm): 设置 loading="lazy" fetchpriority="low"，避开首屏关键资源竞争，在后台静默完成下载。
         * @param {Bookmark} bm - 单个书签数据对象
         * @param {'sm'|'md'} [sizeType='sm'] - 图标尺寸类别 ('sm': 导航页 1.5rem | 'md': 首屏 2rem)
         * @returns {string} 渲染后的 HTML 字符串
         */
        /**
         * 根据书签数据对象生成规范化的 Favicon HTML 图标结构
         * 自动处理缺失图标时的首字母文字徽章，以及合法 URL 图片节点的生成
         * 📌 网络优先级调优 (HTTP/2 Multiplexing & Lazy Loading):
         *    - 首屏 8 个快捷图标 (isMd): 设置 loading="eager" fetchpriority="high"，确保首页开屏瞬间高清渲染。
         *    - 视口下方导航页 90+ 图标 (sm): 设置 data-src 属性与 lazy-icon 类，由 IntersectionObserver 在视口内按需加载。
         * @param {Bookmark} bm - 单个书签数据对象
         * @param {'sm'|'md'} [sizeType='sm'] - 图标尺寸类别 ('sm': 导航页 1.5rem | 'md': 首屏 2rem)
         * @returns {string} 渲染后的 HTML 字符串
         */
        function getFaviconHTML(bm, sizeType = 'sm') {
            const initial = (bm.name || '?').trim().charAt(0).toUpperCase();
            const isMd = sizeType === 'md';
            const sizeClass = isMd ? 'icon-box-md' : 'icon-box-sm';
            const textClass = isMd ? 'text-xs font-semibold' : 'text-[10px] font-semibold';
            const safeIcon = safeUrl(bm.icon);
            
            if (!bm.icon || safeIcon === '#') {
                return `<div class="icon-box ${sizeClass} bg-white/15 border border-white/20 text-white/90 ${textClass}">${escapeHtml(initial)}</div>`;
            }
            const imgSize = isMd ? '32' : '24';
            if (isMd) {
                return `<div class="icon-box ${sizeClass}"><img src="${safeIcon}" width="${imgSize}" height="${imgSize}" data-initial="${escapeHtml(initial)}" data-md="1" class="lazy-icon" alt="" loading="eager" fetchpriority="high" decoding="async" onload="this.classList.add('loaded')"></div>`;
            }
            return `<div class="icon-box ${sizeClass}"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3C/svg%3E" data-src="${safeIcon}" width="${imgSize}" height="${imgSize}" data-initial="${escapeHtml(initial)}" data-md="0" class="lazy-icon" alt="" loading="lazy" decoding="async"></div>`;
        }

        // ==================== 图标 IntersectionObserver 按需微任务队列加载器 ====================
        let faviconObserver = null;
        const lazyIconQueue = [];
        let isProcessingLazyQueue = false;

        /**
         * 调度队列分批放行图标请求 (每次放行 4 个，间隔 30ms)
         * 消除快速滚屏时 30+ 图标在单帧内集中并发导致的 CPU 重排卡顿与主线程掉帧
         */
        function processLazyIconQueue() {
            if (lazyIconQueue.length === 0) {
                isProcessingLazyQueue = false;
                return;
            }
            isProcessingLazyQueue = true;
            const batch = lazyIconQueue.splice(0, 4);
            batch.forEach(img => {
                if (img && img.dataset.src) {
                    const targetSrc = img.dataset.src;
                    delete img.dataset.src;
                    img.onload = () => {
                        img.classList.add('loaded');
                    };
                    img.src = targetSrc;
                    if (img.complete && img.naturalWidth > 0) {
                        img.classList.add('loaded');
                    }
                }
            });
            setTimeout(processLazyIconQueue, 30);
        }

        function enqueueLazyIcon(img) {
            if (img && img.dataset.src) {
                lazyIconQueue.push(img);
                if (!isProcessingLazyQueue) {
                    processLazyIconQueue();
                }
            }
        }

        /**
         * 初始化或刷新图标视口观察器 (IntersectionObserver)
         * 仅在图标节点滚动至视口 (或提前 200px 缓冲区) 时才将 data-src 转换为 src 发起网络请求，
         * 彻底消除 90+ 图标同时并发竞争导致的浏览器 connection queueing 阻塞。
         */
        function initFaviconObserver() {
            if (faviconObserver) {
                try { faviconObserver.disconnect(); } catch {}
            }
            lazyIconQueue.length = 0; // 清空旧队列

            const navEl = dom.navSection || document.getElementById('navSection');
            if (navEl && navEl.classList.contains('nav-hidden')) {
                return;
            }

            if ('IntersectionObserver' in window) {
                faviconObserver = new IntersectionObserver((entries, observer) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting && entry.target.dataset.src) {
                            const img = entry.target;
                            enqueueLazyIcon(img);
                            observer.unobserve(img);
                        }
                    });
                }, {
                    root: dom.navContent || null,
                    rootMargin: '200px 0px 200px 0px'
                });

                document.querySelectorAll('#navCategories img.lazy-icon[data-src]').forEach(img => {
                    faviconObserver.observe(img);
                });
            } else {
                document.querySelectorAll('#navCategories img.lazy-icon[data-src]').forEach(img => {
                    if (img.dataset.src) {
                        img.src = img.dataset.src;
                        delete img.dataset.src;
                    }
                });
            }
        }

        // ==================== 书签 ====================
        /**
         * 渲染首屏快捷书签网格 (pageData.bookmarks)
         * @returns {void}
         */
        function renderBookmarks() {
            if (!dom.bookmarks) return;
            dom.bookmarks.innerHTML = pageData.bookmarks.map(bm => `
                <a href="${safeUrl(bm.url)}" target="_blank" rel="noopener noreferrer" 
                   class="bookmark-item flex flex-col items-center justify-center gap-2 py-3 px-1 sm:px-1.5 apple-radius text-white/90 hover:text-white">
                    ${getFaviconHTML(bm, 'md')}
                    <span class="bookmark-title text-white/90">${escapeHtml(bm.name)}</span>
                </a>
            `).join('');

            dom.bookmarks.querySelectorAll('img.lazy-icon').forEach(img => {
                if (img.complete && img.naturalWidth > 0) {
                    img.classList.add('loaded');
                } else {
                    img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
                }
            });
        }

        // ==================== 导航页（双栏布局）====================
        let lastNavCategoriesSignature = '';
        let cachedSortedCategories = null;
        let lastCategoriesRef = null;

        function getSortedCategories() {
            if (cachedSortedCategories && pageData.categories === lastCategoriesRef) {
                return cachedSortedCategories;
            }
            lastCategoriesRef = pageData.categories;
            cachedSortedCategories = pageData.categories.map(cat => ({
                ...cat,
                sortedBookmarks: [...cat.bookmarks].sort((a, b) => zhCollator.compare(a.name, b.name))
            }));
            return cachedSortedCategories;
        }

        function renderNavCategories(force = false) {
            if (!dom.sidebarList || !dom.navCategories) return;

            const currentSig = JSON.stringify(pageData.categories);
            if (!force && lastNavCategoriesSignature && currentSig === lastNavCategoriesSignature) return;
            lastNavCategoriesSignature = currentSig;

            const savedScrollTop = dom.navContent ? dom.navContent.scrollTop : 0;
            const sortedCats = getSortedCategories();

            // 左侧分类列表
            dom.sidebarList.innerHTML = pageData.categories.map((cat, i) => `
                <button type="button" role="tab" id="cat-tab-${i}" aria-selected="${i === 0 ? 'true' : 'false'}" aria-controls="cat-${i}" class="sidebar-item w-full text-left text-xs md:text-sm px-2.5 py-2 apple-radius text-white/70 flex items-center gap-2 ${i === 0 ? 'active' : ''}"
                        data-target="cat-${i}">
                    <span class="text-sm shrink-0">${escapeHtml(cat.icon)}</span>
                    <span class="truncate font-medium">${escapeHtml(cat.name)}</span>
                </button>
            `).join('');

            // 右侧书签内容（自动按 A-Z 拼音/字母排序，命中 getSortedCategories 记忆化缓存）
            dom.navCategories.innerHTML = sortedCats.map((cat, i) => {
                const sortedBookmarks = cat.sortedBookmarks;
                return `
                <div id="cat-${i}" role="tabpanel" aria-labelledby="cat-tab-${i}" class="category-block ${i > 0 ? 'scroll-mt-6' : ''}">
                    <!-- Apple 极简原生分类标题 (清爽无异形圆角框) -->
                    <div class="category-header flex items-center justify-between pb-2 mb-3.5 border-b border-white/10 transition-colors duration-300">
                        <div class="flex items-center gap-2">
                            <span class="text-sm sm:text-base shrink-0">${escapeHtml(cat.icon)}</span>
                            <h3 class="text-xs sm:text-sm font-semibold tracking-wide text-white/90">${escapeHtml(cat.name)}</h3>
                        </div>
                        <span class="text-[10px] font-medium px-2.5 py-0.5 rounded-full bg-white/10 text-white/60 border border-white/15 tracking-wide shrink-0">${cat.bookmarks.length} 项</span>
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 gap-2.5 md:gap-3">
                        ${sortedBookmarks.map(bm => `
                            <a href="${safeUrl(bm.url)}" target="_blank" rel="noopener noreferrer"
                               class="nav-bookmark group flex items-center gap-2.5 px-3 py-2.5 md:px-3.5 md:py-2.5 apple-radius text-white/80 hover:text-white">
                                ${getFaviconHTML(bm, 'sm')}
                                ${bm.desc ? `
                                    <div class="flex-1 min-w-0 flex flex-col justify-center">
                                        <span class="text-xs md:text-sm font-semibold truncate leading-tight">${escapeHtml(bm.name)}</span>
                                        <span class="text-[10px] text-white/45 truncate leading-none mt-1">${escapeHtml(bm.desc)}</span>
                                    </div>
                                ` : `
                                    <span class="flex-1 min-w-0 text-xs md:text-sm font-semibold truncate leading-tight text-white/90">${escapeHtml(bm.name)}</span>
                                `}
                            </a>
                        `).join('')}
                    </div>
                </div>
            `;
            }).join('');

            // 每次重新渲染分类后，自动刷新侧边栏动态 DOM 节点关联与位移缓存，并初始化图标懒加载观察器
            refreshSidebarNavCache();
            initSidebarNav();
            initFaviconObserver();
            if (dom.navContent && savedScrollTop > 0) {
                dom.navContent.scrollTop = savedScrollTop;
            }
        }

        let isSidebarNavInitialized = false;
        let isManualScrolling = false;
        let manualScrollTimer = null;
        let cachedSidebarItems = [];
        let cachedSidebarSections = [];
        let cachedSectionOffsets = [];

        function refreshSidebarNavCache() {
            if (!dom.sidebarList || !dom.navContent) return;
            cachedSidebarItems = Array.from(dom.sidebarList.querySelectorAll('[data-target]'));
            cachedSidebarSections = cachedSidebarItems.map(item => document.getElementById(item.dataset.target)).filter(Boolean);
            // 分类块 (#cat-i) 的 offsetParent 是 #navContent（relative），其 offsetTop 以
            // #navContent 的 padding edge 为原点，与 scrollTop 的原点完全一致，直接使用即可；
            // 不能再减 navContent.offsetTop —— 那是相对 #navSection 的另一个坐标系（偏差约 51~57px），
            // 会导致滚动监听中分类高亮提前约 50px 切换
            cachedSectionOffsets = cachedSidebarSections.map(s => s.offsetTop);
        }

        function scrollTabIntoView(item, container) {
            if (!item || !container) return;
            const isMobile = window.innerWidth <= 640;
            if (isMobile) {
                const cRect = container.getBoundingClientRect();
                const iRect = item.getBoundingClientRect();
                if (iRect.left < cRect.left + 8 || iRect.right > cRect.right - 8) {
                    const targetLeft = item.offsetLeft - (container.clientWidth / 2) + (item.offsetWidth / 2);
                    container.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
                }
            } else {
                const cRect = container.getBoundingClientRect();
                const iRect = item.getBoundingClientRect();
                if (iRect.top < cRect.top || iRect.bottom > cRect.bottom) {
                    item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }
        }

        function updateSidebarActive() {
            const sidebarContainer = dom.sidebar || document.getElementById('sidebar');
            const sidebarList = dom.sidebarList;
            const content = dom.navContent;
            if (!sidebarList || !content || isManualScrolling) return;

            if (!cachedSidebarItems.length || !cachedSectionOffsets.length) refreshSidebarNavCache();
            const items = cachedSidebarItems;
            const sections = cachedSidebarSections;
            if (!items.length || !sections.length) return;

            const containerHeight = content.clientHeight;
            const scrollTop = content.scrollTop;
            const scrollHeight = content.scrollHeight;

            let activeIdx = 0;
            if (scrollTop <= 15) {
                activeIdx = 0;
            } else {
                const secTops = cachedSectionOffsets.map(off => off - scrollTop);
                for (let i = 0; i < secTops.length; i++) {
                    if (secTops[i] <= 80) {
                        activeIdx = i;
                    }
                }
                if (scrollTop + containerHeight >= scrollHeight - 12) {
                    const currentRelTop = secTops[activeIdx];
                    if (currentRelTop < -30 || currentRelTop > 80) {
                        activeIdx = sections.length - 1;
                    }
                }
            }

            let activeBtn = null;
            items.forEach((item, i) => {
                const isActive = i === activeIdx;
                const wasActive = item.classList.contains('active');
                item.classList.toggle('active', isActive);
                item.setAttribute('aria-selected', isActive ? 'true' : 'false');
                if (isActive) activeBtn = item;
                if (isActive && !wasActive && !isManualScrolling) {
                    scrollTabIntoView(item, sidebarContainer);
                }
            });
            updateSidebarIndicator(activeBtn);
        }

        function updateSidebarIndicator(activeBtn) {
            const sidebarList = dom.sidebarList || document.getElementById('sidebarList');
            if (!sidebarList) return;
            let indicator = document.getElementById('sidebarIndicator');
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.id = 'sidebarIndicator';
                indicator.className = 'sidebar-indicator';
                sidebarList.appendChild(indicator);
            }
            if (!activeBtn) {
                indicator.style.opacity = '0';
                return;
            }
            const left = activeBtn.offsetLeft;
            const top = activeBtn.offsetTop;
            const width = activeBtn.offsetWidth;
            const height = activeBtn.offsetHeight;

            indicator.style.width = `${width}px`;
            indicator.style.height = `${height}px`;
            indicator.style.transform = `translate3d(${left}px, ${top}px, 0)`;
            indicator.style.opacity = '1';
        }

        function initSidebarNav() {
            const sidebarList = dom.sidebarList;
            const content = dom.navContent;
            if (!sidebarList || !content) return;

            // 动态更新一次当前选中高亮
            updateSidebarActive();

            if (!isSidebarNavInitialized) {
                let resizeTimer = null;
                const handleResizeOrRotate = () => {
                    if (resizeTimer) clearTimeout(resizeTimer);
                    resizeTimer = setTimeout(() => {
                        refreshSidebarNavCache();
                        requestAnimationFrame(updateSidebarActive);
                    }, 120);
                };
                window.addEventListener('resize', handleResizeOrRotate, { passive: true });
                window.addEventListener('orientationchange', handleResizeOrRotate, { passive: true });
                if ('ResizeObserver' in window && content) {
                    try {
                        const ro = new ResizeObserver(() => handleResizeOrRotate());
                        ro.observe(content);
                    } catch {}
                }

                sidebarList.addEventListener('click', (e) => {
                    const btn = e.target.closest('[data-target]');
                    if (!btn) return;
                    const targetId = btn.dataset.target;
                    const target = document.getElementById(targetId);
                    if (!target) return;

                    // 1. 立即锁定高亮，防止滚动监听在平滑过渡期间将高亮误切至中途分类
                    isManualScrolling = true;
                    if (manualScrollTimer) clearTimeout(manualScrollTimer);

                    const allItems = Array.from(sidebarList.querySelectorAll('[data-target]'));
                    allItems.forEach(item => item.classList.remove('active'));
                    btn.classList.add('active');
                    updateSidebarIndicator(btn);
                    const sidebarContainer = dom.sidebar || document.getElementById('sidebar');
                    scrollTabIntoView(btn, sidebarContainer);

                    // 2. 精确计算 target 相对 content 的 offsetTop，扣除容器 paddingTop 偏移
                    const cat0 = document.getElementById('cat-0');
                    const baseOffset = cat0 ? cat0.offsetTop : 0;
                    const targetTop = (targetId === 'cat-0') ? 0 : Math.max(0, target.offsetTop - baseOffset);

                    content.scrollTo({ top: targetTop, behavior: 'smooth' });

                    // 3. 目标分类标题柔和发光聚焦提醒，明确提示用户已定位至该分类
                    const header = target.querySelector('.category-header');
                    if (header) {
                        header.classList.remove('category-title-pulse');
                        void header.offsetWidth; // 触发 reflow
                        header.classList.add('category-title-pulse');
                    }

                    // 4. 待平滑滚动完全静止后自动解锁并校准高亮（采用 120ms 防抖 + 800ms 兜底）
                    manualScrollTimer = setTimeout(() => {
                        isManualScrolling = false;
                        updateSidebarActive();
                    }, 800);
                });

                let ticking = false;
                let scrollEndTimer = null;
                content.addEventListener('scroll', () => {
                    if (isManualScrolling) {
                        if (scrollEndTimer) clearTimeout(scrollEndTimer);
                        scrollEndTimer = setTimeout(() => {
                            isManualScrolling = false;
                            updateSidebarActive();
                        }, 120);
                        return;
                    }
                    if (!ticking) {
                        requestAnimationFrame(() => {
                            updateSidebarActive();
                            ticking = false;
                        });
                        ticking = true;
                    }
                }, { passive: true });

                isSidebarNavInitialized = true;
            }
        }
        function bindEvents() {
            // 搜索框输入、拼音合成与清空按键
            let isComposing = false;
            let justEndedComposition = false;
            let compositionEndTimer = null;
            let suggestDebounceTimer = null;

            dom.searchInput.addEventListener('compositionstart', () => {
                isComposing = true;
                justEndedComposition = false;
                hideSuggestions(); // 拼音打字未完成前隐藏联想，彻底杜绝输入法候选框与联想下拉框冲突重叠
            });

            dom.searchInput.addEventListener('compositionend', () => {
                isComposing = false;
                justEndedComposition = true;
                if (compositionEndTimer) clearTimeout(compositionEndTimer);
                compositionEndTimer = setTimeout(() => {
                    justEndedComposition = false;
                }, 100);

                const val = dom.searchInput.value;
                originalQuery = val;
                if (dom.searchClearBtn) dom.searchClearBtn.classList.toggle('hidden', !val);
                fetchSuggestions(state.engine, val);
            });

            dom.searchInput.addEventListener('click', e => {
                e.stopPropagation(); // 阻止点击输入框触发 document.click 误收起联想面板
                const val = dom.searchInput.value.trim();
                if (val && (!dom.suggestionMenu || !dom.suggestionMenu.classList.contains('active'))) {
                    fetchSuggestions(state.engine, val);
                }
            });

            dom.searchInput.addEventListener('input', () => {
                selectedSuggestionIdx = -1;
                const val = dom.searchInput.value;
                originalQuery = val;
                if (dom.searchClearBtn) dom.searchClearBtn.classList.toggle('hidden', !val);
                if (isComposing) return; // 拼音打字合成中不触发请求
                if (suggestDebounceTimer) clearTimeout(suggestDebounceTimer);
                suggestDebounceTimer = setTimeout(() => {
                    fetchSuggestions(state.engine, val);
                }, 180);
            });

            if (dom.searchClearBtn) {
                dom.searchClearBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    e.preventDefault();
                    dom.searchInput.value = '';
                    originalQuery = '';
                    dom.searchClearBtn.classList.add('hidden');
                    hideSuggestions();
                    dom.searchInput.focus();
                });
            }

            // 点击或悬停联想词/书签（事件委托，支持 Alt/Cmd+Click 新标签页打开）
            if (dom.suggestionMenu) {
                dom.suggestionMenu.addEventListener('click', e => {
                    const item = e.target.closest('[data-suggestion]');
                    if (!item) return;
                    e.stopPropagation();
                    const isNewTab = e.altKey || e.metaKey || e.ctrlKey;
                    if (item.dataset.type === 'bookmark' && item.dataset.url) {
                        openBookmarkUrl(item.dataset.url, isNewTab);
                    } else {
                        const query = item.dataset.suggestion;
                        dom.searchInput.value = query;
                        doSearch(query, isNewTab);
                    }
                });
                dom.suggestionMenu.addEventListener('mouseover', e => {
                    const item = e.target.closest('.suggestion-item');
                    if (!item) return;
                    const idx = parseInt(item.dataset.idx, 10);
                    if (isNaN(idx) || selectedSuggestionIdx === idx) return;
                    selectedSuggestionIdx = idx;
                    const prevActive = dom.suggestionMenu.querySelector('.suggestion-item.active');
                    if (prevActive) prevActive.classList.remove('active');
                    item.classList.add('active');
                });
            }

            dom.searchBtn.addEventListener('click', e => {
                doSearch(undefined, e.altKey || e.metaKey || e.ctrlKey);
            });

            // 引擎下拉菜单
            dom.engineBtn.addEventListener('click', e => {
                e.stopPropagation();
                hideSuggestions();
                toggleDropdown();
            });
            dom.dropdownMenu.addEventListener('click', e => {
                const btn = e.target.closest('[data-engine]');
                if (btn) { e.stopPropagation(); setEngine(btn.dataset.engine); }
            });

            const handleCloseMenus = () => {
                closeDropdown();
                hideSuggestions();
            };
            document.addEventListener('click', handleCloseMenus);
            window.addEventListener('blur', handleCloseMenus);

            // 点击导航页顶栏或右侧返回按钮，平滑返回起始页
            const handleBackToStart = () => {
                if (window.switchToStart) window.switchToStart();
            };
            document.getElementById('navHint')?.addEventListener('click', handleBackToStart);
            document.getElementById('navHeader')?.addEventListener('click', handleBackToStart);

            // 键盘快捷键：
            // Web 无障碍 Focus Trap 锁：防 Tab 键焦点逃逸出弹窗
            function handleModalTabFocus(e, modalEl) {
                if (!modalEl) return;
                const focusables = Array.from(modalEl.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(el => {
                    return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement;
                });
                if (focusables.length === 0) return;
                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                if (e.shiftKey) {
                    if (document.activeElement === first || !modalEl.contains(document.activeElement)) {
                        last.focus();
                        e.preventDefault();
                    }
                } else {
                    if (document.activeElement === last || !modalEl.contains(document.activeElement)) {
                        first.focus();
                        e.preventDefault();
                    }
                }
            }

            // 键盘快捷键：
            // 1. 屏间切换：PageDown / Down (非输入态切至导航页)，PageUp / Home / Up (非输入态且在导航页顶切回首屏)
            // 2. 字母键：仅在起始页非输入态聚焦搜索框
            // 3. Ctrl/Cmd+B：切换壁纸
            // 4. Escape：关弹窗/失焦
            // 5. Tab：Modal 弹窗激活时 Focus Trap 循环锁定
            document.addEventListener('keydown', e => {
                // 0. 当有活动 Modal 弹窗在栈顶时，强行防逃逸循环锁定 Tab 键焦点 (a11y Focus Trap)
                if (e.key === 'Tab' && !OverlayStack.isEmpty()) {
                    const topOverlay = OverlayStack.top();
                    if (topOverlay && topOverlay.id !== 'suggestions' && topOverlay.id !== 'dropdown') {
                        const modalEl = dom[topOverlay.id] || document.getElementById(topOverlay.id);
                        if (modalEl) {
                            handleModalTabFocus(e, modalEl);
                            return;
                        }
                    }
                }

                // 1. 优先使用 UI 响应栈 (OverlayStack) 逆序优雅处理 Escape 按键
                if (e.key === 'Escape') {
                    const topOverlay = OverlayStack.top();
                    if (topOverlay && typeof topOverlay.close === 'function') {
                        // 联想面板在栈中时，Escape 必然命中栈顶分支（此前位于 return 之后的还原
                        // 逻辑是永远执行不到的死代码）；此处先还原被 ↑↓ 选中的联想词为原始输入，再关闭面板
                        if (topOverlay.id === 'suggestions' && dom.suggestionMenu && dom.suggestionMenu.classList.contains('active') && selectedSuggestionIdx >= 0) {
                            dom.searchInput.value = originalQuery;
                            if (dom.searchClearBtn) dom.searchClearBtn.classList.toggle('hidden', !dom.searchInput.value);
                        }
                        topOverlay.close();
                        e.stopPropagation();
                        return;
                    }
                    closeDropdown();
                    hideSuggestions();
                    dom.searchInput.blur();
                    return;
                }

                // 2. 若当前有任何弹窗或 Overlay 处于激活状态，拦截后续所有全局快捷键及页面导航操作
                //    (联想面板自身也会入栈；但搜索框聚焦时方向键/回车等联想操作仍须响应，故栈内仅剩联想面板时放行)
                if (!OverlayStack.isEmpty()) {
                    const onlySuggestions = OverlayStack.top()?.id === 'suggestions' && OverlayStack.stack.length === 1;
                    if (!onlySuggestions) return;
                }

                const activeTag = document.activeElement?.tagName;
                const isInputActive = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || document.activeElement?.isContentEditable;

                // 快捷键 B：切换壁纸
                if ((e.key === 'b' || e.key === 'B') && (e.metaKey || e.ctrlKey) && !isInputActive) {
                    e.preventDefault();
                    switchBg().catch(() => {});
                    return;
                }

                // 搜索框或建议框获得焦点时的键盘控制（Enter 走默认搜索引擎，仅在 ↑↓ 明确选中某项时响应选中项）
                if (document.activeElement === dom.searchInput) {
                    if (e.isComposing || e.keyCode === 229 || isComposing || justEndedComposition) return; // 拼音输入法合成选中汉字时不触发搜索与键盘拦截

                    const isSuggestActive = dom.suggestionMenu && dom.suggestionMenu.classList.contains('active');
                    const items = isSuggestActive ? Array.from(dom.suggestionMenu.querySelectorAll('.suggestion-item')) : [];

                    if (e.key === 'Enter') {
                        e.preventDefault();
                        const isNewTab = e.altKey || e.metaKey || e.ctrlKey;
                        if (selectedSuggestionIdx >= 0 && items[selectedSuggestionIdx]) {
                            const selectedEl = items[selectedSuggestionIdx];
                            if (selectedEl.dataset.type === 'bookmark' && selectedEl.dataset.url) {
                                openBookmarkUrl(selectedEl.dataset.url, isNewTab);
                            } else {
                                doSearch(selectedEl.dataset.suggestion, isNewTab);
                            }
                        } else {
                            doSearch(undefined, isNewTab);
                        }
                        return;
                    }

                    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
                        if (e.key === 'ArrowDown' && items.length > 0) {
                            e.preventDefault();
                            if (selectedSuggestionIdx === -1) {
                                originalQuery = dom.searchInput.value;
                            }
                            selectedSuggestionIdx++;
                            if (selectedSuggestionIdx >= items.length) {
                                selectedSuggestionIdx = -1; // 导航超出底部，恢复原始输入
                            }
                            items.forEach((el, idx) => el.classList.toggle('active', idx === selectedSuggestionIdx));
                            if (selectedSuggestionIdx >= 0 && items[selectedSuggestionIdx]) {
                                dom.searchInput.value = items[selectedSuggestionIdx].dataset.suggestion;
                                items[selectedSuggestionIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                            } else {
                                dom.searchInput.value = originalQuery;
                            }
                            if (dom.searchClearBtn) dom.searchClearBtn.classList.toggle('hidden', !dom.searchInput.value);
                            return;
                        }
                        if (e.key === 'ArrowUp' && items.length > 0) {
                            e.preventDefault();
                            if (selectedSuggestionIdx === -1) {
                                originalQuery = dom.searchInput.value;
                                selectedSuggestionIdx = items.length - 1;
                            } else {
                                selectedSuggestionIdx--;
                            }
                            items.forEach((el, idx) => el.classList.toggle('active', idx === selectedSuggestionIdx));
                            if (selectedSuggestionIdx >= 0 && items[selectedSuggestionIdx]) {
                                dom.searchInput.value = items[selectedSuggestionIdx].dataset.suggestion;
                                items[selectedSuggestionIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                            } else {
                                dom.searchInput.value = originalQuery;
                            }
                            if (dom.searchClearBtn) dom.searchClearBtn.classList.toggle('hidden', !dom.searchInput.value);
                            return;
                        }
                    }
                }

                if (e.ctrlKey || e.metaKey || e.altKey) return;

                // 屏间切换快捷键（无组合键、非输入状态；搜索框聚焦但联想未激活时也放行，避免方向键死键）
                const suggestionActive = dom.suggestionMenu && dom.suggestionMenu.classList.contains('active');
                if (!isInputActive || (document.activeElement === dom.searchInput && !suggestionActive)) {
                    if (e.key === 'PageDown' || (e.key === 'ArrowDown' && state.currentSection === 'start')) {
                        e.preventDefault();
                        if (window.switchToNav) window.switchToNav();
                        return;
                    }
                    if (e.key === 'PageUp' || e.key === 'Home' || (e.key === 'ArrowUp' && state.currentSection === 'nav' && dom.navContent?.scrollTop <= 0)) {
                        e.preventDefault();
                        if (window.switchToStart) window.switchToStart();
                        return;
                    }
                }

                // 首屏单字符盲打自动聚焦搜索框
                if (state.currentSection === 'start' && e.key.length === 1 && !isInputActive) {
                    dom.searchInput.focus();
                    return;
                }
            });
        }

        // ==================== 编辑弹窗事件绑定 ====================
        function bindEditEvents() {
            document.querySelectorAll('#editModal > div, #bookmarkPicker > div, #confirmModal > div').forEach(el => {
                el.addEventListener('click', e => e.stopPropagation());
            });
            dom.editBookmarksBtn.addEventListener('click', openEditModal);
            dom.cancelEditBtn.addEventListener('click', cancelEditModal);
            dom.editModal.addEventListener('click', cancelEditModal);
            dom.togglePickerBtn.addEventListener('click', e => { e.stopPropagation(); openBookmarkPicker(); });
            dom.closePickerBtn.addEventListener('click', closeBookmarkPicker);
            dom.donePickerBtn.addEventListener('click', closeBookmarkPicker);
            dom.bookmarkPicker.addEventListener('click', closeBookmarkPicker);

            // 重置所有设置 (Danger Zone - 确认后立即重置系统，无需再点击保存)
            dom.resetEditBtn.addEventListener('click', resetBookmarks);

            // Tab 切换按钮绑定
            document.querySelectorAll('.settings-tab-btn').forEach(btn => {
                btn.addEventListener('click', e => {
                    e.stopPropagation();
                    switchSettingsTab(btn.dataset.tab);
                });
            });

            // 预设壁纸库点击绑定（草稿实时预览，点击『保存并关闭』才提交）
            document.querySelectorAll('.preset-bg-card').forEach(card => {
                card.addEventListener('click', e => {
                    e.stopPropagation();
                    const url = card.dataset.bg;
                    if (url) {
                        previewDraftWallpaper(url);
                    }
                });
            });

            // JSON 拖拽 Dropzone 交互绑定
            if (dom.jsonDropzone) {
                dom.jsonDropzone.addEventListener('click', () => dom.importJsonInput?.click());
                dom.jsonDropzone.addEventListener('dragover', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    dom.jsonDropzone.classList.add('drag-over');
                });
                dom.jsonDropzone.addEventListener('dragleave', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.relatedTarget && dom.jsonDropzone.contains(e.relatedTarget)) return;
                    dom.jsonDropzone.classList.remove('drag-over');
                });
                dom.jsonDropzone.addEventListener('drop', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    dom.jsonDropzone.classList.remove('drag-over');
                    const file = e.dataTransfer.files[0];
                    if (file) importBookmarksJSON(file);
                });
            }

            dom.pickerContent.addEventListener('click', e => {
                const item = e.target.closest('.picker-item');
                if (!item || !item.dataset.name || !item.dataset.url) return;
                const name = item.dataset.name;
                const url = item.dataset.url;
                const urls = new Set();
                dom.editList.querySelectorAll('.edit-url').forEach(inp => {
                    const norm = normalizeUrl(inp.value);
                    if (norm) urls.add(norm);
                });
                pageData.bookmarks.forEach(bm => {
                    const norm = normalizeUrl(bm.url);
                    if (norm) urls.add(norm);
                });
                if (urls.has(url)) return;

                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = getEditRowHTML(name, url, Date.now()).trim();
                const div = tempDiv.firstElementChild;
                dom.editList.appendChild(div);
                item.classList.add('opacity-40', 'pointer-events-none');
                item.dataset.name = '';
                item.dataset.url = '';
                item.querySelector('span:last-child').textContent = '✓';
                updatePickerCount();
                updateBookmarkCountBadge();
            });

            dom.addBookmarkBtn.addEventListener('click', () => {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = getEditRowHTML('', '', Date.now()).trim();
                const div = tempDiv.firstElementChild;
                dom.editList.appendChild(div);
                div.querySelector('.edit-name').focus();
                updateBookmarkCountBadge();
            });

            dom.editList.addEventListener('click', e => {
                const del = e.target.closest('.del-btn');
                if (del) {
                    del.closest('[data-idx]')?.remove();
                    updatePickerCount();
                    updateBookmarkCountBadge();
                    return;
                }
                const moveUp = e.target.closest('.move-up-btn');
                if (moveUp) {
                    const item = moveUp.closest('[data-idx]');
                    if (item && item.previousElementSibling) {
                        item.parentNode.insertBefore(item, item.previousElementSibling);
                    }
                    return;
                }
                const moveDown = e.target.closest('.move-down-btn');
                if (moveDown) {
                    const item = moveDown.closest('[data-idx]');
                    if (item && item.nextElementSibling) {
                        item.parentNode.insertBefore(item.nextElementSibling, item);
                    }
                    return;
                }
            });

            // 点击「保存并关闭」按钮提交草稿中的全部修改
            dom.saveEditBtn.addEventListener('click', async () => {
                const data = collectEditData();
                if (data.length === 0) {
                    showConfirm('至少需要保留一个名称和 URL 均已填写的书签才能保存。', null, '无法保存');
                    return;
                }
                
                // 1. 提交书签（派生架构保存）
                saveUserBookmarks(data);

                // 2. 提交壁纸（大图持久化至 IndexedDB，同步写入 localStorage['userWallpaper'] 供 head 极速预加载）
                //    关键：区分「选中系统预设（bg1~bg8）」与「真·自定义壁纸（上传 / 网络 URL）」：
                //    - 预设：只同步 state.bg 索引 + localStorage.bg，并清掉 customWallpaper 三通道。
                //      此前不做区分会把 './wallpapers/bg5.avif' 当作"自定义图"持久化，switchBg() 读到后
                //      会清掉自定义通道并强制 state.bg=0 跳回 bg1，导致 Ctrl/Cmd+B 无法继续轮播（BUG 4a）。
                //    - 自定义（data:/http:）：保持原逻辑，写入 state.customWallpaper + IDB + userWallpaper。
                //    - 恢复默认（draftWallpaper === null）：同时重置 state.bg=0 并持久化 bg=0，
                //      并清掉 customWallpaper 三通道；此前漏掉 state.bg 与 localStorage.bg，导致刷新后旧壁纸复活（BUG 4b）。
                if (modalState.wallpaperChanged) {
                    const draft = modalState.draftWallpaper;
                    const presetIdx = findPresetBgIndex(draft);
                    if (presetIdx >= 0) {
                        // 选中系统预设：按索引模式持久化（previewDraftWallpaper 已视觉切好）
                        await clearCustomWallpaper();
                        state.bg = presetIdx;
                        storageSet('bg', presetIdx);
                    } else if (draft) {
                        // 真·自定义壁纸（上传 data:URL 或 http(s) 外网图）（previewDraftWallpaper 已视觉切好）
                        state.customWallpaper = draft;
                        setWallpaperDB(draft);
                        storageSet('userWallpaper', draft);
                        // 切到自定义图时，bg 索引不再有效，归零保证退出自定义后轮播从 bg1 开始
                        state.bg = 0;
                        storageSet('bg', 0);
                    } else {
                        // 点击"恢复默认" → 回到 bg1（resetDraftWallpaper 已视觉切到 bg1）
                        await clearCustomWallpaper();
                        state.bg = 0;
                        storageSet('bg', 0);
                    }
                    if (dom.statWallpaperType) {
                        dom.statWallpaperType.textContent = state.customWallpaper ? '自定义' : '系统';
                    }
                    updatePresetBgCardsUI(draft !== null && draft !== undefined ? draft : backgrounds[0]);
                }

                // 3. 提交特效
                if (modalState.draftMaskOpacity !== null && modalState.draftBgBlur !== null) {
                    storageSet('maskOpacity', modalState.draftMaskOpacity);
                    storageSet('bgBlur', modalState.draftBgBlur);
                }

                closeEditModal();
            });

            // JSON 导入导出事件绑定
            if (dom.exportJsonBtn) dom.exportJsonBtn.addEventListener('click', exportBookmarksJSON);
            if (dom.importJsonInput) {
                dom.importJsonInput.addEventListener('change', e => {
                    const file = e.target.files[0];
                    if (file) importBookmarksJSON(file);
                    e.target.value = '';
                });
            }

            // 自定义壁纸事件绑定（草稿实时预览，保存后提交）
            if (dom.uploadBgBtn) dom.uploadBgBtn.addEventListener('click', () => dom.uploadBgInput?.click());
            if (dom.uploadBgInput) {
                dom.uploadBgInput.addEventListener('change', e => {
                    const file = e.target.files[0];
                    if (file) {
                        if (!file.type.startsWith('image/')) {
                            showConfirm('请选择有效的图片文件（JPG / PNG / WebP 等）。', null, '格式错误');
                            return;
                        }
                        const reader = new FileReader();
                        reader.onload = ev => {
                            const dataUrl = ev.target.result;
                            const img = new Image();
                            img.onload = () => {
                                // 无论原图大小，全量统一按 4K 顶级超清分辨率 (3840x2160) 及 95% 高品质 JPEG 进行优化（配 IndexedDB 存储）
                                const MAX_WIDTH = 3840;
                                const MAX_HEIGHT = 2160;
                                let width = img.width;
                                let height = img.height;

                                if (width > MAX_WIDTH || height > MAX_HEIGHT) {
                                    if (width / height > MAX_WIDTH / MAX_HEIGHT) {
                                        height = Math.round((height * MAX_WIDTH) / width);
                                        width = MAX_WIDTH;
                                    } else {
                                        width = Math.round((width * MAX_HEIGHT) / height);
                                        height = MAX_HEIGHT;
                                    }
                                }

                                const canvas = document.createElement('canvas');
                                canvas.width = width;
                                canvas.height = height;
                                const ctx = canvas.getContext('2d');
                                ctx.drawImage(img, 0, 0, width, height);

                                const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.95);
                                previewDraftWallpaper(compressedDataUrl);

                                canvas.width = 0;
                                canvas.height = 0;
                                img.onload = null;
                                reader.onload = null;
                            };
                            img.onerror = () => {
                                previewDraftWallpaper(dataUrl);
                                reader.onload = null;
                            };
                            img.src = dataUrl;
                        };
                        reader.readAsDataURL(file);
                    }
                    e.target.value = '';
                });
            }
            if (dom.urlBgBtn) {
                dom.urlBgBtn.addEventListener('click', () => {
                    const current = modalState.draftWallpaper || storageGet('userWallpaper') || '';
                    const input = prompt('请输入高清图片的网络 URL 地址：', current.startsWith('http') ? current : '');
                    if (input === null) return;
                    const trimmed = input.trim();
                    if (!trimmed) return;
                    if (!/^https?:\/\//i.test(trimmed)) {
                        showConfirm('请输入以 http:// 或 https:// 开头的有效图片链接。', null, '地址错误');
                        return;
                    }
                    previewDraftWallpaper(trimmed);
                });
            }
            if (dom.resetBgBtn) {
                dom.resetBgBtn.addEventListener('click', () => {
                    resetDraftWallpaper();
                });
            }

            // 壁纸视觉特效事件绑定（草稿实时预览）
            if (dom.maskOpacityInput) {
                dom.maskOpacityInput.addEventListener('input', e => {
                    modalState.draftMaskOpacity = parseInt(e.target.value, 10) || 0;
                    applyBgEffects(modalState.draftMaskOpacity, modalState.draftBgBlur !== null ? modalState.draftBgBlur : 0, false);
                });
            }
            if (dom.bgBlurInput) {
                dom.bgBlurInput.addEventListener('input', e => {
                    modalState.draftBgBlur = parseInt(e.target.value, 10) || 0;
                    applyBgEffects(modalState.draftMaskOpacity !== null ? modalState.draftMaskOpacity : 25, modalState.draftBgBlur, false);
                });
            }

            // 清理缓存事件绑定
            if (dom.clearCacheBtn) {
                dom.clearCacheBtn.addEventListener('click', async () => {
                    if ('caches' in window) {
                        try {
                            const keys = await caches.keys();
                            await Promise.all(keys.map(key => caches.delete(key)));
                            if ('indexedDB' in window) {
                                try { indexedDB.deleteDatabase('sw-lru-db'); } catch {}
                            }
                            showConfirm('Service Worker 离线资源与页面缓存已成功刷新清理！', null, '离线缓存已重置');
                        } catch (err) {
                            showConfirm('缓存清理完成或无需清理。', null, '清理提示');
                        }
                    } else {
                        showConfirm('当前浏览器不支持 Service Worker 缓存，或已是最新状态。', null, '提示');
                    }
                });
            }

            initDragSort();
        }

        function hideSuggestions() {
            activeSuggestReqId++; // 作废所有挂起的联想网络请求，防止 Escape/失焦后联想下拉意外"复活"
            if (suggestionScriptTag) {
                suggestionScriptTag.onerror = null;
                suggestionScriptTag.remove();
                suggestionScriptTag = null;
            }
            OverlayStack.pop('suggestions');
            if (dom.suggestionMenu) {
                dom.suggestionMenu.classList.remove('active');
                dom.suggestionMenu.setAttribute('aria-hidden', 'true');
            }
            if (dom.searchInput) {
                dom.searchInput.setAttribute('aria-expanded', 'false');
            }
            selectedSuggestionIdx = -1;
        }

        let lastDateDay = -1;
        let lastTimeStr = '';
        function updateClock() {
            if (document.hidden) return;
            const n = new Date();
            const curTimeStr = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
            if (curTimeStr !== lastTimeStr) {
                lastTimeStr = curTimeStr;
                if (dom.clock) dom.clock.textContent = curTimeStr;
            }
            const day = n.getDate();
            if (day !== lastDateDay) {
                lastDateDay = day;
                if (dom.date) dom.date.textContent = n.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
            }
        }

        // ==================== 搜索引擎与实时建议 ====================
        let suggestionScriptTag = null;
        let selectedSuggestionIdx = -1;
        let originalQuery = '';

        function toggleDropdown() {
            state.open = !state.open;
            dom.dropdownMenu.classList.toggle('active', state.open);
            dom.dropdownMenu.setAttribute('aria-hidden', (!state.open).toString());
            dom.engineBtn.setAttribute('aria-expanded', state.open.toString());
            if (state.open) {
                OverlayStack.push('dropdown', closeDropdown);
            } else {
                OverlayStack.pop('dropdown');
            }
        }
        function closeDropdown() {
            state.open = false;
            OverlayStack.pop('dropdown');
            dom.dropdownMenu.classList.remove('active');
            dom.dropdownMenu.setAttribute('aria-hidden', 'true');
            dom.engineBtn.setAttribute('aria-expanded', 'false');
        }
        /** @param {string} key - 引擎标识（bing/google/duckduckgo/baidu）
         * @param {boolean} [save] - 是否持久化到 localStorage */
        function setEngine(key, save = true) {
            const validEngine = engines[key] ? key : 'bing';
            state.engine = validEngine;
            const engineObj = engines[validEngine] || engines.bing;
            dom.engineName.textContent = engineObj.name;
            if (dom.engineIcon) {
                dom.engineIcon.style.display = '';
                dom.engineIcon.src = engineObj.icon;
                dom.engineIcon.alt = `当前引擎：${engineObj.name}`;
            }
            closeDropdown();
            if (save) storageSet('preferredEngine', validEngine);
            if (dom.searchInput && dom.searchInput.value.trim()) {
                fetchSuggestions(validEngine, dom.searchInput.value.trim());
            }
        }
        /** 
         * 执行搜索
         * @param {string} [queryOverride] - 可选直接传入建议词
         * @param {boolean} [newTab] - 是否在新标签页中打开（支持 Alt/Cmd/Ctrl+Enter 或新标签模式）
         */
        function doSearch(queryOverride, newTab = false) {
            const q = (queryOverride !== undefined ? queryOverride : dom.searchInput.value).trim();
            if (!q) return;
            hideSuggestions();
            closeDropdown();
            const engineObj = engines[state.engine] || engines.bing;
            const targetUrl = engineObj.url + encodeURIComponent(q);
            if (newTab) {
                window.open(targetUrl, '_blank', 'noopener,noreferrer');
            } else {
                window.location.href = targetUrl;
            }
        }

        /**
         * 打开本站书签 URL（带安全协议校验与域名自动补全）
         * @param {string} url - 目标网址
         * @param {boolean} [newTab] - 是否在新标签页打开
         */
        function openBookmarkUrl(url, newTab = false) {
            if (!url) return;
            let trimmed = url.trim();
            // 显式拦截高危伪协议（javascript:, data:, vbscript:, file:, blob: 等）
            if (/^(javascript|data|vbscript|file|blob):/i.test(trimmed)) {
                console.warn('⚠️ 拦截高危伪协议书签 URL:', trimmed);
                return;
            }
            // 自动补全不带协议头的纯域名（如 bilibili.com 补全为 https://bilibili.com）
            if (!/^(https?:|\/|\.\/|#)/i.test(trimmed)) {
                if (/^[\w.-]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(trimmed)) {
                    trimmed = 'https://' + trimmed;
                } else {
                    console.warn('⚠️ 拦截非安全协议书签 URL:', trimmed);
                    return;
                }
            }
            hideSuggestions();
            closeDropdown();
            if (newTab) {
                window.open(trimmed, '_blank', 'noopener,noreferrer');
            } else {
                window.location.href = trimmed;
            }
        }

        /**
         * 计算 Damerau-Levenshtein 编辑距离（支持插入、删除、替换与相邻字符易位/拼错容错）
         */
        function damerauLevenshteinDistance(a, b) {
            const al = a.length, bl = b.length;
            if (al === 0) return bl;
            if (bl === 0) return al;
            const dp = Array.from({ length: al + 1 }, () => new Int32Array(bl + 1));
            for (let i = 0; i <= al; i++) dp[i][0] = i;
            for (let j = 0; j <= bl; j++) dp[0][j] = j;

            for (let i = 1; i <= al; i++) {
                for (let j = 1; j <= bl; j++) {
                    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                    dp[i][j] = Math.min(
                        dp[i - 1][j] + 1,       // deletion
                        dp[i][j - 1] + 1,       // insertion
                        dp[i - 1][j - 1] + cost // substitution
                    );
                    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost); // transposition
                    }
                }
            }
            return dp[al][bl];
        }

        /**
         * 计算关键词 q 与书签 bm 的前缀拼写容错 / 模糊匹配得分 (Token Prefix Fuzzy Score)
         * 支持单词及按空格分割的多词子项容错检索（如 MDN Wbe Docs / oGogle Cloud）
         */
        function getFuzzyScore(q, bm) {
            const query = (q || '').trim().toLowerCase();
            if (query.length < 3) return Infinity;
            const normUrl = (bm.url || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
            const fullText = `${bm.name || ''} ${normUrl} ${bm.desc || ''}`.toLowerCase();
            const rawTokens = fullText.split(/\s+/);
            const wordTokens = fullText.split(/[^a-z0-9\u4e00-\u9fff]+/);
            const tokens = Array.from(new Set([...rawTokens, ...wordTokens].filter(t => t.length > 0)));

            const subQueries = query.split(/\s+/).filter(sq => sq.length > 0);
            if (subQueries.length === 0) return Infinity;

            let totalDist = 0;

            for (const sq of subQueries) {
                if (sq.length < 2) continue;
                const maxDist = sq.length <= 5 ? 1 : 2;
                let minSubDist = Infinity;

                for (const token of tokens) {
                    if (token.length < Math.max(2, sq.length - 1)) continue;
                    const minLen = Math.max(2, sq.length - 1);
                    const maxLen = Math.min(token.length, sq.length + 1);
                    for (let len = minLen; len <= maxLen; len++) {
                        const prefix = token.substring(0, len);
                        const dist = damerauLevenshteinDistance(sq, prefix);
                        if (dist < minSubDist) {
                            minSubDist = dist;
                            if (minSubDist === 0) break;
                        }
                    }
                    if (minSubDist === 0) break;
                }

                if (minSubDist > maxDist) {
                    return Infinity; // 子词未能命中任何 Token
                }
                totalDist += minSubDist;
            }

            const maxTotalDist = query.length <= 5 ? 1 : 2;
            return totalDist <= maxTotalDist ? totalDist : Infinity;
        }

        /**
         * 在本地全站书签中根据关键词检索匹配项（包含快捷书签与分类书签），支持精确匹配与拼写容错/模糊匹配
         * @param {string} query - 搜索关键词
         * @param {number} [limit=2] - 最多返回匹配条数（最多 2 条特色书签）
         * @returns {Array<{type: string, name: string, url: string, icon: string, desc: string, category: string}>}
         */
        function getLocalBookmarkSuggestions(query, limit = 2) {
            const q = (query || '').trim().toLowerCase();
            // 纯标点查询（如“/”会被 https:// 的斜杠误命中所有书签）不触发本地书签检索
            if (!q || !/[a-z0-9\u4e00-\u9fff]/.test(q)) return [];
            const results = [];
            const addedUrls = new Set();
            const toNormUrl = u => (u || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

            // 预先建立 URL -> 分类名称 映射表
            const urlToCategoryMap = new Map();
            if (pageData && Array.isArray(pageData.categories)) {
                for (const cat of pageData.categories) {
                    if (!cat || !Array.isArray(cat.bookmarks)) continue;
                    for (const bm of cat.bookmarks) {
                        if (bm && bm.url) {
                            const normUrl = toNormUrl(bm.url);
                            if (!urlToCategoryMap.has(normUrl)) {
                                urlToCategoryMap.set(normUrl, cat.name);
                            }
                        }
                    }
                }
            }

            // 1. 优先匹配快捷书签（精确匹配包含 q）
            if (pageData && Array.isArray(pageData.bookmarks)) {
                for (const bm of pageData.bookmarks) {
                    if (!bm || !bm.url) continue;
                    const normUrl = toNormUrl(bm.url);
                    if (addedUrls.has(normUrl)) continue;
                    const nameMatch = (bm.name || '').toLowerCase().includes(q);
                    const urlMatch = (bm.url || '').toLowerCase().includes(q);
                    const descMatch = (bm.desc || '').toLowerCase().includes(q);
                    if (nameMatch || urlMatch || descMatch) {
                        const realCat = urlToCategoryMap.get(normUrl) || '快捷书签';
                        results.push({
                            type: 'bookmark',
                            name: bm.name || '未命名书签',
                            url: bm.url,
                            icon: bm.icon || '',
                            desc: bm.desc || '',
                            category: realCat
                        });
                        addedUrls.add(normUrl);
                        if (results.length >= limit) return results;
                    }
                }
            }

            // 2. 匹配导航分类书签（精确匹配包含 q）
            if (pageData && Array.isArray(pageData.categories)) {
                for (const cat of pageData.categories) {
                    if (!cat || !Array.isArray(cat.bookmarks)) continue;
                    for (const bm of cat.bookmarks) {
                        if (!bm || !bm.url) continue;
                        const normUrl = toNormUrl(bm.url);
                        if (addedUrls.has(normUrl)) continue;
                        const nameMatch = (bm.name || '').toLowerCase().includes(q);
                        const urlMatch = (bm.url || '').toLowerCase().includes(q);
                        const descMatch = (bm.desc || '').toLowerCase().includes(q);
                        if (nameMatch || urlMatch || descMatch) {
                            results.push({
                                type: 'bookmark',
                                name: bm.name || '未命名书签',
                                url: bm.url,
                                icon: bm.icon || '',
                                desc: bm.desc || '',
                                category: cat.name || '分类书签'
                            });
                            addedUrls.add(normUrl);
                            if (results.length >= limit) return results;
                        }
                    }
                }
            }

            // 3. 若精确匹配未填满 limit 且关键词长度 >= 3，进行拼写容错 / 模糊匹配 (Fuzzy Match / Levenshtein Distance)
            if (results.length < limit && q.length >= 3) {
                const fuzzyCandidates = [];
                const checkFuzzy = (bm, defaultCat) => {
                    if (!bm || !bm.url) return;
                    const normUrl = toNormUrl(bm.url);
                    if (addedUrls.has(normUrl)) return;
                    const score = getFuzzyScore(q, bm);
                    if (score !== Infinity) {
                        const realCat = urlToCategoryMap.get(normUrl) || defaultCat;
                        fuzzyCandidates.push({
                            score,
                            item: {
                                type: 'bookmark',
                                name: bm.name || '未命名书签',
                                url: bm.url,
                                icon: bm.icon || '',
                                desc: bm.desc || '',
                                category: realCat
                            },
                            normUrl
                        });
                    }
                };

                if (pageData && Array.isArray(pageData.bookmarks)) {
                    for (const bm of pageData.bookmarks) checkFuzzy(bm, '快捷书签');
                }
                if (pageData && Array.isArray(pageData.categories)) {
                    for (const cat of pageData.categories) {
                        if (!cat || !Array.isArray(cat.bookmarks)) continue;
                        for (const bm of cat.bookmarks) checkFuzzy(bm, cat.name || '分类书签');
                    }
                }

                // 按模糊匹配得分（编辑距离）从低到高排序
                fuzzyCandidates.sort((a, b) => a.score - b.score);
                for (const candidate of fuzzyCandidates) {
                    if (addedUrls.has(candidate.normUrl)) continue;
                    results.push(candidate.item);
                    addedUrls.add(candidate.normUrl);
                    if (results.length >= limit) break;
                }
            }

            return results;
        }

        // 核心实时建议拉取函数：全面支持 百度 / Bing / Google / DuckDuckGo (Bing 回退) 的开放 Suggest API + 本地书签混排
        let activeSuggestReqId = 0;

        function fetchSuggestions(engineKey, query) {
            query = (query || '').trim();
            if (!query) {
                hideSuggestions();
                return;
            }

            // 1. 实时检索本站书签匹配结果（最多 2 条特色书签）
            const localList = getLocalBookmarkSuggestions(query, 2);

            // 2. 极速 0ms 呈现本地书签 + 预留网络联想骨架槽位（实现零 CLS 布局抖动）
            renderSuggestions(localList, [], false, true);

            // 递增请求 ID，用于在回调内部丢弃过期的异步响应
            activeSuggestReqId++;
            const reqId = activeSuggestReqId;

            if (suggestionScriptTag) {
                suggestionScriptTag.onerror = null;
                suggestionScriptTag.remove();
                suggestionScriptTag = null;
            }

            // 为每次异步 JSONP 分配独立的唯一回调，离线与悬挂回调自动隔离，彻底解决乱序覆盖与内存泄漏
            const cbName = `__glassSuggestCb_${reqId}`;
            let timeoutTimer = null;

            const cleanup = () => {
                if (timeoutTimer) {
                    clearTimeout(timeoutTimer);
                    timeoutTimer = null;
                }
                try { delete window[cbName]; } catch {}
                if (suggestionScriptTag) {
                    suggestionScriptTag.onerror = null;
                    suggestionScriptTag.remove();
                    suggestionScriptTag = null;
                }
            };

            // 4 秒超时防护：若第三方接口挂起，自动清洗
            timeoutTimer = setTimeout(() => {
                if (reqId === activeSuggestReqId) {
                    cleanup();
                }
            }, 4000);

            window[cbName] = function(data) {
                cleanup();
                try { delete window[cbName]; } catch {}
                if (reqId !== activeSuggestReqId) return; // 废弃过期异步响应
                let list = [];
                if (Array.isArray(data)) {
                    // Bing / Google format: [query, [suggestions]] / DuckDuckGo format: [{phrase:"..."}, ...]
                    list = Array.isArray(data[1]) ? data[1] : data.map(item => (typeof item === 'object' && item && item.phrase) ? item.phrase : item);
                } else if (data && Array.isArray(data.s)) {
                    // Baidu format: {s: [suggestions]}
                    list = data.s;
                }
                // 动态计算：确保 (本站书签数 + 网络联想数) 严格总计不超过 4 行，且防御性过滤非字符串项
                const maxNetCount = Math.max(0, 4 - localList.length);
                const safeList = (Array.isArray(list) ? list : []).filter(item => typeof item === 'string' && item.trim().length > 0);
                const netList = safeList.slice(0, maxNetCount);
                if (localList.length > 0 || netList.length > 0) {
                    renderSuggestions(localList, netList, true);
                } else {
                    hideSuggestions();
                }
            };

            const script = document.createElement('script');
            suggestionScriptTag = script;
            script.onerror = () => {
                cleanup();
            };

            // 搜索引擎 Suggest API 调度策略与回退机制说明：
            // 1. 百度 JSONP：显式指定 ie=utf-8&oe=utf-8，防止部分浏览器以 GBK 解码导致中文联想词乱码。
            // 2. ⚠️ DuckDuckGo 接口不可用与回退机制：DuckDuckGo 官方 ac.duckduckgo.com 接口完全不可用（服务端未开放 CORS 标头且不支持 JSONP 回调包裹），严禁前端直接调用。
            //    此处选择无缝回退至 Bing Suggest API 而非 Google API，是因为 Bing Suggest API 全球可用（国内网络直连无需梯子），
            //    可彻底避免国内用户在未开启代理时因 Google 域名被墙导致联想词 4s 超时悬挂。
            if (engineKey === 'baidu') {
                script.src = `https://suggestion.baidu.com/su?wd=${encodeURIComponent(query)}&p=3&ie=utf-8&oe=utf-8&cb=${cbName}`;
            } else if (engineKey === 'bing' || engineKey === 'duckduckgo') {
                script.src = `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(query)}&JsonType=callback&JsonCallback=${cbName}`;
            } else if (engineKey === 'google') {
                script.src = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}&callback=${cbName}`;
            }

            document.body.appendChild(script);
        }

        function renderSuggestions(localList = [], netList = [], preserveSelection = false, isNetLoading = false) {
            if (!dom.suggestionMenu) return;
            const prevIdx = preserveSelection ? selectedSuggestionIdx : -1;
            selectedSuggestionIdx = -1;

            if ((!localList || localList.length === 0) && (!netList || netList.length === 0) && !isNetLoading) {
                hideSuggestions();
                return;
            }

            let html = '';
            let globalIdx = 0;

            // 书签分组（最多 2 条）
            if (localList && localList.length > 0) {
                html += `
                    <div class="px-3.5 pt-1.5 pb-1 text-[10px] font-medium tracking-wider text-white/35 uppercase select-none">
                        <span>书签</span>
                    </div>
                `;
                localList.forEach(bm => {
                    const iconHtml = bm.icon 
                        ? `<img src="${safeUrl(bm.icon)}" width="16" height="16" class="w-4 h-4 rounded object-cover shrink-0" alt="" data-hide-on-error="1">`
                        : `<svg class="w-4 h-4 text-white/40 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>`;
                    
                    html += `
                        <div role="option" aria-selected="false" 
                             data-type="bookmark" 
                             data-url="${escapeHtml(bm.url)}" 
                             data-suggestion="${escapeHtml(bm.name)}"
                             data-idx="${globalIdx}"
                             class="suggestion-item group px-3.5 py-2.5 my-0.5 apple-radius text-sm text-white/90 flex items-center gap-3 transition-all duration-150 cursor-pointer hover:text-white">
                            ${iconHtml}
                            <div class="truncate flex-1 min-w-0 flex items-center gap-2">
                                <span class="truncate font-medium text-white/95">${escapeHtml(bm.name)}</span>
                                ${bm.desc ? `<span class="truncate text-xs text-white/45 hidden sm:inline">${escapeHtml(bm.desc)}</span>` : ''}
                            </div>
                            <span class="text-[10px] px-2 py-0.5 apple-radius bg-white/10 border border-white/15 text-white/60 shrink-0">${escapeHtml(bm.category)}</span>
                        </div>
                    `;
                    globalIdx++;
                });
            }

            // 网络搜索建议分组（确保与本站书签合计不超过 4 行）
            const maxNetCount = Math.max(0, 4 - (localList ? localList.length : 0));
            const safeNetList = (netList || []).slice(0, maxNetCount);

            if (safeNetList.length > 0) {
                if (localList && localList.length > 0) {
                    html += `
                        <div class="px-3.5 pt-2 pb-1 text-[10px] font-medium tracking-wider text-white/35 uppercase select-none">
                            <span>搜索</span>
                        </div>
                    `;
                }
                safeNetList.forEach(item => {
                    html += `
                        <div role="option" aria-selected="false" 
                             data-type="query" 
                             data-suggestion="${escapeHtml(item)}" 
                             data-idx="${globalIdx}"
                             class="suggestion-item group px-3.5 py-2.5 my-0.5 apple-radius text-sm text-white/85 flex items-center gap-3 transition-all duration-150 cursor-pointer hover:text-white">
                            <svg class="w-4 h-4 text-white/40 group-hover:text-white/80 shrink-0 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                            <span class="truncate flex-1 font-normal tracking-wide">${escapeHtml(item)}</span>
                        </div>
                    `;
                    globalIdx++;
                });
            } else if (isNetLoading) {
                if (localList && localList.length > 0) {
                    html += `
                        <div class="px-3.5 pt-2 pb-1 text-[10px] font-medium tracking-wider text-white/35 uppercase select-none">
                            <span>搜索</span>
                        </div>
                    `;
                }
                const skeletonCount = Math.max(1, 4 - (localList ? localList.length : 0));
                for (let k = 0; k < skeletonCount; k++) {
                    const widthClass = k % 2 === 0 ? 'w-44' : 'w-28';
                    html += `
                        <div class="px-3.5 py-2.5 my-0.5 apple-radius flex items-center gap-3 select-none pointer-events-none skeleton-pulse">
                            <svg class="w-4 h-4 text-white/20 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                            <div class="h-5 bg-white/15 apple-radius ${widthClass}"></div>
                        </div>
                    `;
                }
            }

            const footerHtml = `
                <div class="suggestion-footer">
                    <div class="flex items-center gap-3">
                        <span class="flex items-center gap-1.5"><kbd class="kbd-key">↑</kbd><kbd class="kbd-key">↓</kbd> 切换</span>
                        <span class="flex items-center gap-1.5"><kbd class="kbd-key">↵</kbd> 选择/搜索</span>
                    </div>
                    <span class="flex items-center gap-1.5"><kbd class="kbd-key">Alt / ⌥ + ↵</kbd> 新标签页打开</span>
                </div>
            `;

            const range = document.createRange();
            const fragment = range.createContextualFragment(html + footerHtml);
            dom.suggestionMenu.replaceChildren(fragment);
            dom.suggestionMenu.classList.add('active');
            dom.suggestionMenu.setAttribute('aria-hidden', 'false');
            if (dom.searchInput) dom.searchInput.setAttribute('aria-expanded', 'true');
            OverlayStack.push('suggestions', hideSuggestions);

            // 保持键盘导航选中索引并平滑校准边界
            if (prevIdx >= 0) {
                const items = dom.suggestionMenu.querySelectorAll('.suggestion-item');
                if (items.length > 0) {
                    const validIdx = Math.min(prevIdx, items.length - 1);
                    selectedSuggestionIdx = validIdx;
                    items[validIdx].classList.add('active');
                    items[validIdx].setAttribute('aria-selected', 'true');
                    updateSuggestionIndicator(items[validIdx]);
                    if (dom.searchInput && items[validIdx].dataset.suggestion) {
                        dom.searchInput.value = items[validIdx].dataset.suggestion;
                    }
                } else {
                    selectedSuggestionIdx = -1;
                    if (dom.searchInput && typeof originalQuery === 'string') {
                        dom.searchInput.value = originalQuery;
                    }
                }
            }
        }

        function hideSuggestions() {
            activeSuggestReqId++; // 作废所有挂起的联想网络请求，防止 Escape/失焦后联想下拉意外"复活"
            if (suggestionScriptTag) {
                suggestionScriptTag.onerror = null;
                suggestionScriptTag.remove();
                suggestionScriptTag = null;
            }
            OverlayStack.pop('suggestions');
            if (dom.suggestionMenu) {
                dom.suggestionMenu.classList.remove('active');
                dom.suggestionMenu.setAttribute('aria-hidden', 'true');
            }
            if (dom.searchInput) {
                dom.searchInput.setAttribute('aria-expanded', 'false');
            }
            selectedSuggestionIdx = -1;
        }

        // ==================== 壁纸切换 ====================
        let bgSwitchTimer = null;
        let activeWallpaperReqId = 0;

        function preloadNextBg() {
            const load = () => {
                const img = new Image();
                img.src = backgrounds[(state.bg + 1) % backgrounds.length];
            };
            const schedule = () => {
                if ('requestIdleCallback' in window) {
                    requestIdleCallback(load, { timeout: 8000 });
                } else {
                    setTimeout(load, 5000);
                }
            };
            if (document.readyState === 'complete') {
                setTimeout(schedule, 5000);
            } else {
                window.addEventListener('load', () => setTimeout(schedule, 5000), { once: true });
            }
        }
        function applyWallpaper(urlStr, animate = true) {
            const bgBase = $('bgLayer');
            const bgNext = $('bgLayerNext');
            if (!bgBase || !bgNext || !urlStr || typeof urlStr !== 'string') return;

            activeWallpaperReqId++;
            const reqId = activeWallpaperReqId;

            // 过滤 URL 中可能破坏 CSS url() 语法的引号、反斜杠、右括号与换行符
            const safeCssUrl = urlStr.replace(/["'\\\r\n)]/g, '\\$&');
            const newStyleUrl = `url("${safeCssUrl}")`;

            const img = new Image();

            const executeTransition = () => {
                if (reqId !== activeWallpaperReqId) return; // 废弃过期的慢速网络图片异步回调，防止覆盖最新壁纸
                if (bgSwitchTimer) {
                    clearTimeout(bgSwitchTimer);
                    bgSwitchTimer = null;
                }

                if (animate) {
                    // 1. 仅当上层背景当前可见（淡入动画进行中，opacity > 0.4）时才将其同步到底层作为淡入起点。
                    if (bgNext.style.backgroundImage && parseFloat(getComputedStyle(bgNext).opacity) > 0.4) {
                        bgBase.style.backgroundImage = bgNext.style.backgroundImage;
                        bgBase.style.opacity = '1';
                    }
                    // 2. 暂时断开 CSS 过渡动画，强制将 opacity 归零
                    bgNext.style.transition = 'none';
                    bgNext.style.opacity = '0';
                    void bgNext.offsetWidth; // 强行触发 DOM 重排，确保 opacity:0 瞬间生效

                    // 3. 换入新图片 URL 并设置 0.8s 平滑缓动淡入动画
                    bgNext.style.backgroundImage = newStyleUrl;
                    bgNext.style.transition = 'opacity 0.8s cubic-bezier(0.4, 0, 0.2, 1)';

                    // 4. 启动淡入动画 0 ➔ 1
                    requestAnimationFrame(() => {
                        bgNext.style.opacity = '1';
                        bgSwitchTimer = setTimeout(() => {
                            bgBase.style.backgroundImage = newStyleUrl;
                            bgBase.style.opacity = '1';
                            bgNext.style.transition = 'none';
                            bgNext.style.opacity = '0';
                            bgSwitchTimer = null;
                        }, 800);
                    });
                } else {
                    bgNext.style.transition = 'none';
                    bgNext.style.opacity = '0';
                    bgBase.style.backgroundImage = newStyleUrl;
                    bgBase.style.opacity = '1';
                }
            };

            img.src = urlStr;
            if (img.complete && img.naturalWidth > 0) {
                executeTransition();
            } else {
                img.onload = executeTransition;
            }
            updateWallpaperStatusUI().catch(() => {});
        }
        async function switchBg() {
            let customBg = state.customWallpaper || await getWallpaperDB() || storageGet('userWallpaper');
            // 防御：若拿到的是预设壁纸路径（旧数据 / 其他路径误写），当作预设处理而非"自定义"
            const legacyPresetIdx = findPresetBgIndex(customBg);
            if (legacyPresetIdx >= 0) {
                await clearCustomWallpaper();
                state.bg = legacyPresetIdx;
                // 落到下方统一"轮播到下一张"
                customBg = null;
            }
            if (customBg) {
                await removeWallpaperDB();
                storageRemove('userWallpaper');
                state.customWallpaper = null;
                state.bg = 0;
            } else {
                state.bg = (state.bg + 1) % backgrounds.length;
            }
            // 持久化壁纸轮播索引：刷新/重开后保持 Ctrl+B 轮播到的壁纸
            // （head 预加载脚本依赖 localStorage['bg'] 决定预加载哪张壁纸，此前该键只读不写）
            storageSet('bg', state.bg);
            applyWallpaper(backgrounds[state.bg], true);
            preloadNextBg();
        }



        // ==================== 滚动切换 ====================
        function initScrollControl() {
            let scrollAccum = 0;
            let resetAccumTimer = null;
            let isTransitioning = false;
            let targetSection = getSavedSection() === 'nav' ? 'nav' : 'start';
            // 调试参数扩展：支持 URL Query (e.g. ?threshold=120) 或 window.__SCROLL_THRESHOLD__ 实时调节
            let baseThreshold = 120;
            try {
                const urlParam = new URLSearchParams(window.location.search).get('threshold');
                if (urlParam && !isNaN(Number(urlParam))) baseThreshold = Number(urlParam);
            } catch {}
            const SCROLL_THRESHOLD = window.__SCROLL_THRESHOLD__ ?? baseThreshold; // 累积滚动像素阈值（跨浏览器一致）
            const startSection = document.getElementById('startSection');
            const nav = document.getElementById('navSection');
            const navContent = dom.navContent;

            // 纯无障碍 (a11y) 屏隔离与 Tab 聚焦防护：防止键盘导航误入视口外的隐藏区
            function updateSectionAccessibility(sec) {
                if (sec === 'nav') {
                    if (startSection) {
                        startSection.setAttribute('aria-hidden', 'true');
                        startSection.setAttribute('inert', '');
                    }
                    if (nav) {
                        nav.removeAttribute('aria-hidden');
                        nav.removeAttribute('inert');
                    }
                } else {
                    if (startSection) {
                        startSection.removeAttribute('aria-hidden');
                        startSection.removeAttribute('inert');
                    }
                    if (nav) {
                        nav.setAttribute('aria-hidden', 'true');
                        nav.setAttribute('inert', '');
                    }
                }
            }

            // 滚动停顿 400ms 后自动归零积累的 delta 值，彻底解决慢速滚动停顿后的误触发问题
            function resetAccumAfterDelay() {
                if (resetAccumTimer) clearTimeout(resetAccumTimer);
                resetAccumTimer = setTimeout(() => { scrollAccum = 0; }, 400);
            }

            function clearAccum() {
                scrollAccum = 0;
                if (resetAccumTimer) {
                    clearTimeout(resetAccumTimer);
                    resetAccumTimer = null;
                }
            }

            // ===== sessionStorage 刷新保持：恢复/保存页面位置 =====
            function getSavedSection() {
                try { return sessionStorage.getItem('startpage_section'); } catch { return null; }
            }
            function saveSection(s) {
                state.currentSection = s;
                try { sessionStorage.setItem('startpage_section', s); } catch {}
            }

            // 编辑按钮仅在搜索页显示（导航页隐藏）
            function updateGearVisibility() {
                if (dom.editBookmarksBtn) {
                    dom.editBookmarksBtn.classList.toggle('hidden-on-nav', state.currentSection === 'nav');
                }
            }

            function updateThemeColor(color) {
                if (!color) return;
                let meta = document.querySelector('meta[name="theme-color"]');
                if (meta) meta.remove();
                meta = document.createElement('meta');
                meta.name = 'theme-color';
                meta.content = color;
                document.head.appendChild(meta);
                if (document.body) document.body.style.backgroundColor = color;
                if (document.documentElement) document.documentElement.style.backgroundColor = color;
            }

            // 暴露全局切屏控制接口，供点击 Header、键盘快捷键等共享调用
            function switchToNav() {
                targetSection = 'nav';
                isTransitioning = true;
                clearAccum();
                saveSection('nav');
                updateSectionAccessibility('nav');
                updateGearVisibility();
                updateThemeColor('#12141a');

                if (startSection) {
                    startSection.style.transform = '';
                    startSection.style.transition = '';
                    startSection.classList.add('screen-pushed-up');
                }
                if (nav) {
                    nav.style.transform = '';
                    nav.style.transition = '';
                    nav.classList.remove('nav-hidden');
                    nav.classList.add('nav-visible', 'screen-pushed-in');
                }

                refreshSidebarNavCache();
                updateSidebarActive();
                initFaviconObserver();

                setTimeout(() => {
                    state.currentSection = 'nav';
                    isTransitioning = false;
                    if (document.activeElement && typeof document.activeElement.blur === 'function') {
                        document.activeElement.blur();
                    }
                }, 520);
            }

            function switchToStart() {
                targetSection = 'start';
                isTransitioning = true;
                clearAccum();
                if (navContent) navContent.scrollTop = 0;
                saveSection('start');
                updateSectionAccessibility('start');
                updateThemeColor('#0b0f19');

                if (startSection) {
                    startSection.style.transform = '';
                    startSection.style.transition = '';
                    startSection.classList.remove('screen-pushed-up');
                }
                if (nav) {
                    nav.style.transform = '';
                    nav.style.transition = '';
                    nav.classList.remove('screen-pushed-in');
                }

                setTimeout(() => {
                    state.currentSection = 'start';
                    isTransitioning = false;
                    updateGearVisibility();
                    nav.classList.remove('nav-visible');
                    nav.classList.add('nav-hidden');
                }, 520);
            }

            window.switchToNav = switchToNav;
            window.switchToStart = switchToStart;

            // 依据 sessionStorage 精准同步页面状态与位置
            if (getSavedSection() === 'nav') {
                if (startSection) startSection.classList.add('screen-pushed-up');
                nav.classList.remove('nav-hidden');
                nav.classList.add('nav-visible', 'screen-pushed-in');
                targetSection = 'nav';
                saveSection('nav');
                updateSectionAccessibility('nav');
                updateGearVisibility();
                updateThemeColor('#12141a');
                document.documentElement.classList.remove('nr');
                refreshSidebarNavCache();
                updateSidebarActive();
                initFaviconObserver();
            } else {
                if (startSection) startSection.classList.remove('screen-pushed-up');
                nav.classList.remove('screen-pushed-in', 'nav-visible');
                nav.classList.add('nav-hidden');
                saveSection('start');
                targetSection = 'start';
                updateSectionAccessibility('start');
                updateGearVisibility();
                document.documentElement.classList.remove('nr');
            }

            // 归一化 deltaY，兼容 Safari / Windows 的 LINE / PAGE 模式
            function normDelta(e) {
                let d = e.deltaY;
                if (e.deltaMode === 1) d *= 16;       // DOM_DELTA_LINE → 像素
                else if (e.deltaMode === 2) d *= 400;  // DOM_DELTA_PAGE → 像素
                return d;
            }

            // ==================== 触屏跟手拖拽与滚轮速度/大步幅感应 ====================
            let lastWheelTime = 0;

            document.addEventListener('wheel', (e) => {
                if (isTransitioning || !OverlayStack.isEmpty()) return;

                const delta = normDelta(e);
                const down = delta > 0;
                const absDelta = Math.abs(delta);
                const now = performance.now();
                const dt = now - lastWheelTime;
                lastWheelTime = now;
                const velocity = dt > 0 ? absDelta / dt : 0; // px/ms

                // 动态有效阈值：若单次滚动步幅 >= 100px 或快速甩动 (velocity > 1.2)，降低切屏门槛至 60px
                const effectiveThreshold = (absDelta >= 100 || velocity > 1.2) ? 60 : SCROLL_THRESHOLD;

                if (state.currentSection === 'start') {
                    if (!down) {
                        scrollAccum = Math.max(0, scrollAccum + delta);
                        resetAccumAfterDelay();
                        return;
                    }
                    e.preventDefault();
                    scrollAccum += delta;
                    resetAccumAfterDelay();
                    if (scrollAccum >= effectiveThreshold) {
                        switchToNav();
                    }
                } else {
                    // 仅当位于导航页顶端且向上滚动时才拦截并累积切屏阈值，其余状态下完全放行原生滚动
                    if (!down && navContent && navContent.scrollTop <= 0) {
                        e.preventDefault();
                        scrollAccum += absDelta;
                        resetAccumAfterDelay();
                        if (scrollAccum >= effectiveThreshold) {
                            switchToStart();
                        }
                    } else {
                        clearAccum();
                    }
                }
            }, { passive: false });

            let startTouchY = 0;
            let lastTouchY = 0;
            let touchStartTime = 0;
            let isTouchDragging = false;
            let touchDragDirection = null; // 'up' or 'down'

            function resetTouchDragStyles() {
                if (startSection) {
                    startSection.style.transition = '';
                    startSection.style.transform = '';
                    startSection.offsetHeight;
                }
                if (nav) {
                    nav.style.transition = '';
                    nav.style.transform = '';
                    nav.offsetHeight;
                }
            }

            document.addEventListener('touchstart', (e) => {
                if (isTransitioning || !OverlayStack.isEmpty()) return;
                startTouchY = e.touches[0].clientY;
                lastTouchY = startTouchY;
                touchStartTime = performance.now();
                isTouchDragging = false;
                touchDragDirection = null;
            }, { passive: true });

            document.addEventListener('touchmove', (e) => {
                if (isTransitioning || !OverlayStack.isEmpty()) return;
                const currentY = e.touches[0].clientY;
                const totalDeltaY = startTouchY - currentY;
                lastTouchY = currentY;

                if (state.currentSection === 'start') {
                    // 从首屏向上拖拽到导航页（全流程 100% 跟手跟随）
                    if (totalDeltaY > 0) {
                        if (e.cancelable) e.preventDefault();
                        isTouchDragging = true;
                        touchDragDirection = 'up';
                        const vh = window.innerHeight || 800;
                        const progress = Math.min(1, Math.max(0, totalDeltaY / vh));

                        nav.classList.remove('nav-hidden');
                        nav.classList.add('nav-visible');

                        startSection.style.transition = 'none';
                        nav.style.transition = 'none';
                        startSection.style.transform = `translateY(${-progress * 100}vh)`;
                        nav.style.transform = `translateY(${(1 - progress) * 100}vh)`;
                    } else if (isTouchDragging) {
                        if (e.cancelable) e.preventDefault();
                        startSection.style.transform = `translateY(0vh)`;
                        nav.style.transform = `translateY(100vh)`;
                    }
                } else if (state.currentSection === 'nav') {
                    // 从导航页顶部向下拖拽回首屏（全流程 100% 跟手跟随）
                    if (totalDeltaY < 0 && navContent && navContent.scrollTop <= 0) {
                        if (e.cancelable) e.preventDefault();
                        isTouchDragging = true;
                        touchDragDirection = 'down';
                        const vh = window.innerHeight || 800;
                        const absDelta = Math.abs(totalDeltaY);
                        const progress = Math.min(1, Math.max(0, absDelta / vh));

                        nav.classList.remove('nav-hidden');
                        nav.classList.add('nav-visible');

                        startSection.style.transition = 'none';
                        nav.style.transition = 'none';
                        startSection.style.transform = `translateY(${-(1 - progress) * 100}vh)`;
                        nav.style.transform = `translateY(${progress * 100}vh)`;
                    } else if (isTouchDragging) {
                        if (e.cancelable) e.preventDefault();
                        startSection.style.transform = `translateY(-100vh)`;
                        nav.style.transform = `translateY(0vh)`;
                    }
                }
            }, { passive: false });

            function handleTouchEndOrCancel(e) {
                if (!isTouchDragging) return;
                const isCancel = e.type === 'touchcancel';
                const endTouchY = (e.changedTouches && e.changedTouches.length > 0) ? e.changedTouches[0].clientY : lastTouchY;
                const totalDeltaY = startTouchY - endTouchY;
                const touchDuration = Math.max(1, performance.now() - touchStartTime);
                const velocity = Math.abs(totalDeltaY) / touchDuration; // px/ms
                const vh = window.innerHeight || 800;
                const progress = Math.min(1, Math.max(0, Math.abs(totalDeltaY) / vh));

                resetTouchDragStyles();
                isTouchDragging = false;

                // 若被系统事件打断 (touchcancel)，安全起见一律弹性复位弹回原位；正常 touchend 满足条件则切屏
                const shouldSwitch = !isCancel && (progress >= 0.20 || velocity > 0.25 || Math.abs(totalDeltaY) >= 100);

                if (state.currentSection === 'start' && touchDragDirection === 'up') {
                    if (shouldSwitch) {
                        switchToNav();
                    } else {
                        targetSection = 'start';
                        startSection.classList.remove('screen-pushed-up');
                        nav.classList.remove('screen-pushed-in', 'nav-visible');
                        nav.classList.add('nav-hidden');
                        saveSection('start');
                        updateSectionAccessibility('start');
                        updateGearVisibility();
                    }
                } else if (state.currentSection === 'nav' && touchDragDirection === 'down') {
                    if (shouldSwitch) {
                        switchToStart();
                    } else {
                        targetSection = 'nav';
                        startSection.classList.add('screen-pushed-up');
                        nav.classList.remove('nav-hidden');
                        nav.classList.add('nav-visible', 'screen-pushed-in');
                        saveSection('nav');
                        updateSectionAccessibility('nav');
                        updateGearVisibility();
                    }
                }
            }

            document.addEventListener('touchend', handleTouchEndOrCancel, { passive: true });
            document.addEventListener('touchcancel', handleTouchEndOrCancel, { passive: true });

            // ===== VisionOS 玻璃材质 3D 倾斜与光标折射高光代理 (Apple HIG 规范) =====
            (function initGlassSpotlightAndTilt() {
                if (window.matchMedia && !window.matchMedia('(hover: hover)').matches) return;

                let activeCard = null;
                let rafId = null;
                let pendingEvent = null;

                function updateCardTransform() {
                    if (!activeCard || !pendingEvent) return;
                    const rect = activeCard.getBoundingClientRect();
                    const x = pendingEvent.clientX - rect.left;
                    const y = pendingEvent.clientY - rect.top;

                    activeCard.style.setProperty('--mouse-x', `${x}px`);
                    activeCard.style.setProperty('--mouse-y', `${y}px`);

                    const centerX = rect.width / 2;
                    const centerY = rect.height / 2;
                    // 严格限制倾斜角在 1.5 度以内，保持 Apple 沉稳克制的物理质感
                    const rotateX = -((y - centerY) / centerY) * 1.5;
                    const rotateY = ((x - centerX) / centerX) * 1.5;

                    activeCard.style.transform = `perspective(800px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale(1.025)`;
                    rafId = null;
                }

                let searchBoxRafId = null;
                let activeSearchBox = null;
                let pendingSearchBoxEvent = null;

                function updateSearchBoxTransform() {
                    if (!activeSearchBox || !pendingSearchBoxEvent) return;
                    const rect = activeSearchBox.getBoundingClientRect();
                    activeSearchBox.style.setProperty('--mouse-x', `${pendingSearchBoxEvent.clientX - rect.left}px`);
                    activeSearchBox.style.setProperty('--mouse-y', `${pendingSearchBoxEvent.clientY - rect.top}px`);
                    searchBoxRafId = null;
                }

                document.addEventListener('mousemove', (e) => {
                    const searchBox = e.target.closest('.search-box-wrapper');
                    if (searchBox) {
                        activeSearchBox = searchBox;
                        pendingSearchBoxEvent = e;
                        if (!searchBoxRafId) {
                            searchBoxRafId = requestAnimationFrame(updateSearchBoxTransform);
                        }
                    }

                    const card = e.target.closest('.bookmark-item, .nav-bookmark');
                    if (card) {
                        if (activeCard && activeCard !== card) {
                            activeCard.style.transform = '';
                        }
                        activeCard = card;
                        pendingEvent = e;
                        if (!rafId) {
                            rafId = requestAnimationFrame(updateCardTransform);
                        }
                    } else if (activeCard) {
                        // 滞后量缓冲区检查 (Hysteresis Check)：防止卡片边缘 3D 倾斜导致鼠标离开容器引发 60Hz 循环闪烁抖动
                        const rect = activeCard.getBoundingClientRect();
                        const margin = 8;
                        const isNearCard = e.clientX >= rect.left - margin &&
                                           e.clientX <= rect.right + margin &&
                                           e.clientY >= rect.top - margin &&
                                           e.clientY <= rect.bottom + margin;
                        if (isNearCard) {
                            pendingEvent = e;
                            if (!rafId) {
                                rafId = requestAnimationFrame(updateCardTransform);
                            }
                        } else {
                            activeCard.style.transform = '';
                            activeCard = null;
                        }
                    }
                }, { passive: true });

                document.addEventListener('mouseout', (e) => {
                    if (activeCard && !activeCard.contains(e.relatedTarget)) {
                        const rect = activeCard.getBoundingClientRect();
                        const margin = 8;
                        const isNearCard = e.clientX >= rect.left - margin &&
                                           e.clientX <= rect.right + margin &&
                                           e.clientY >= rect.top - margin &&
                                           e.clientY <= rect.bottom + margin;
                        if (!isNearCard) {
                            activeCard.style.transform = '';
                            activeCard = null;
                        }
                    }
                }, { passive: true });
            })();
        }

        // ==================== 启动（兼容 DOMContentLoaded）====================
        document.readyState === 'loading'
            ? document.addEventListener('DOMContentLoaded', init)
            : init();
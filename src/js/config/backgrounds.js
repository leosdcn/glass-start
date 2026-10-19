/**
 * 预设壁纸清单：首屏预加载与运行时共用，构建时注入 src/index.html。
 * 新增/删除壁纸时必须同步 themes.js 的主题与色调数组，lint 会校验长度一致。
 *
 * 本地 AVIF 预设的 Unsplash 原图来源：
 * bg1.avif - 暮色山峦 https://images.unsplash.com/photo-1477346611705-65d1883cee1e
 * bg2.avif - 溪谷晨曦 https://images.unsplash.com/photo-1506744038136-46273834b3fb
 * bg3.avif - 星空雪山 https://images.unsplash.com/photo-1519681393784-d120267933ba
 * bg4.avif - 峰峦破晓 https://images.unsplash.com/photo-1469474968028-56623f02e42e
 * bg5.avif - 天际立面 https://images.unsplash.com/photo-1486406146926-c627a92ad1ab
 * bg6.avif - 极简回廊 https://images.unsplash.com/photo-1497366754035-f200968a6e72
 * bg7.avif - 紫韵流光 https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe
 * bg8.avif - 梦幻流彩 https://images.unsplash.com/photo-1550684848-fac1c5b4e853
 *
 * 重建方式：获取原图，经 sips 等比缩放生成 PNG 中间文件，不裁切、不放大。
 * 大图保留色度分辨率，缩略图使用色度采样控制体积；编码后需对比原图检查质量。
 * 大图：avifenc -s 4 -q 75 --yuv 444 input.png bgX.avif
 * 缩略图：avifenc -s 4 -q 70 --yuv 420 thumb.png bgX-thumb.avif
 */
export const PRESET_BACKGROUNDS = Object.freeze([
    './wallpapers/bg1.avif',
    './wallpapers/bg2.avif',
    './wallpapers/bg3.avif',
    './wallpapers/bg4.avif',
    './wallpapers/bg5.avif',
    './wallpapers/bg6.avif',
    './wallpapers/bg7.avif',
    './wallpapers/bg8.avif'
]);

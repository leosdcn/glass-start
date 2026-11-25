/** 以图搜图（Bing 缩放编码与 Google Lens 无来源表单上传）及图片链接探测。 */
import { t, getLocale } from '../core/i18n.js';
import { CONFIG } from '../config/constants.js';
import { getDefaultEngine } from '../config/engines.js';
import { state } from '../state/store.js';
import { dom } from '../state/dom.js';

const IMAGE_SEARCH_UPLOADS = __GLASS_IMAGE_SEARCH_UPLOADS__;

/** @param {string} url */
export function checkImageLink(url) {
    return new Promise(resolve => {
        const image = new Image();
        const finish = (/** @type {boolean} */ isImage) => {
            clearTimeout(timeout);
            image.onload = image.onerror = null;
            image.removeAttribute('src');
            resolve(isImage);
        };
        const timeout = setTimeout(() => finish(false), CONFIG.TIMERS.IMAGE_LINK_CHECK_TIMEOUT);
        image.onload = () => finish(true);
        image.onerror = () => finish(false);
        image.referrerPolicy = 'no-referrer';
        image.src = url;
    });
}

export function getImageSearchEngine() {
    const engine = state.engine;
    return engine === 'bing' || engine === 'google' ? engine : getDefaultEngine();
}

/**
 * 校验并上传本地图片至指定以图搜图引擎
 * @param {'bing' | 'google'} engine
 * @param {HTMLInputElement} input
 * @param {File} file
 * @param {() => boolean} isCurrent
 */
export async function uploadImageSearch(engine, input, file, isCurrent) {
    // Lens 的跨站上传需要省略来源，独立表单文档只对该上传应用 no-referrer。
    const form = engine === 'google' ? dom.lensUploadFrame?.contentDocument?.forms[0] : input.form;
    const reportError = () => {
        if (!isCurrent()) return;
        if (dom.imageSearchStatus) dom.imageSearchStatus.textContent = t('engine.upload.error');
    };
    if (!form || !file.size) {
        reportError();
        return;
    }

    const action = new URL(IMAGE_SEARCH_UPLOADS[engine].url);
    /** @param {Record<string, string | File>} fields */
    const submit = fields => {
        if (!isCurrent()) return;
        const controls = Object.entries(fields).map(([name, value]) => {
            const field = form.ownerDocument.createElement('input');
            field.name = name;
            if (typeof value === 'string') {
                field.type = 'hidden';
                field.value = value;
            } else {
                field.type = 'file';
                const transfer = new DataTransfer();
                transfer.items.add(value);
                field.files = transfer.files;
            }
            return field;
        });
        try {
            form.action = action.href;
            form.append(...controls);
            form.submit();
        } finally {
            controls.forEach(field => field.remove());
        }
    };

    let url;
    try {
        if (engine === 'google') {
            action.searchParams.set('hl', getLocale());
            action.searchParams.set('st', String(Date.now()));
        }
        // 拖入的文件可能没有图片 MIME。交给浏览器解码，也支持仅由 viewBox 定义尺寸的 SVG。
        url = URL.createObjectURL(file);
        const image = new Image();
        image.src = url;
        await image.decode();
        if (!isCurrent()) return;
        if (engine === 'google') {
            submit({ encoded_image: file });
            return;
        }
        // 与 Bing 网页端一样缩小大图并用白底 JPEG 编码。
        const { naturalWidth, naturalHeight } = image;
        const { maxPixels, jpegQuality } = IMAGE_SEARCH_UPLOADS.bing;
        const scale = Math.min(1, Math.sqrt(maxPixels / (naturalWidth * naturalHeight)));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(naturalWidth * scale));
        canvas.height = Math.max(1, Math.floor(naturalHeight * scale));
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) {
            reportError();
            return;
        }
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const imageBin = canvas.toDataURL('image/jpeg', jpegQuality).split(',', 2)[1];
        submit({ cbir: 'sbi', imageBin });
    } catch {
        reportError();
    } finally {
        if (url) URL.revokeObjectURL(url);
    }
}

import { readFileSync } from 'node:fs';
import { crc32, inflateSync } from 'node:zlib';

const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const IEND_CHUNK = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

/** @param {import('node:fs').PathLike} path */
export function pngDimensions(path, checkData = false) {
    const png = readFileSync(path);
    if (png.length < 57 || !png.subarray(0, 8).equals(PNG_HEADER)
        || png.toString('ascii', 12, 16) !== 'IHDR' || !png.subarray(-12).equals(IEND_CHUNK)) {
        throw new Error('Invalid PNG');
    }
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    if (!width || !height) throw new Error('Invalid PNG dimensions');
    if (checkData && width === height && width <= 128) {
        const data = [];
        for (let offset = 8; offset < png.length;) {
            if (offset + 12 > png.length) throw new Error('Truncated PNG chunk');
            const end = offset + 8 + png.readUInt32BE(offset);
            if (end + 4 > png.length || crc32(png.subarray(offset + 4, end)) !== png.readUInt32BE(end)) {
                throw new Error('Invalid PNG chunk');
            }
            if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') data.push(png.subarray(offset + 8, end));
            offset = end + 4;
        }
        // 128² RGBA 16-bit 加滤镜字节和隔行扫描开销仍小于 140 KiB。
        if (!data.length || !inflateSync(Buffer.concat(data), { maxOutputLength: 140 * 1024 }).length) {
            throw new Error('Invalid PNG image data');
        }
    }
    return { width, height };
}

/** @param {string} path */
export function validateIconPng(path) {
    const { width, height } = pngDimensions(path, true);
    if (width !== height || width > 128) throw new Error('Icon must be square and at most 128 px');
}

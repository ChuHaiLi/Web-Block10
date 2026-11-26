const fs = require('node:fs/promises');
const sharp = require('sharp');
const { uploadError } = require('./errors');
const { MAX_FILE_BYTES } = require('./parseMultipart');

const MAX_PIXELS = 40_000_000;
const jpegSignature = Buffer.from([0xff, 0xd8, 0xff]);
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function validateImage(file, filePath)
{
    if (file.bytes > MAX_FILE_BYTES || file.truncated) throw uploadError('TOO_LARGE');

    const input = await fs.open(filePath, 'r');
    const header = Buffer.alloc(pngSignature.length);
    try
    {
        const { bytesRead } = await input.read(header);
        const isJpeg = bytesRead >= jpegSignature.length && header.subarray(0, jpegSignature.length).equals(jpegSignature);
        const isPng = bytesRead === pngSignature.length && header.equals(pngSignature);
        if (!isJpeg && !isPng) throw uploadError('NOT_IMAGE');
    }
    finally
    {
        await input.close();
    }

    let metadata;
    try
    {
        metadata = await sharp(filePath, { limitInputPixels: false }).metadata();
    }
    catch (error)
    {
        throw uploadError('CORRUPT', error);
    }
    const { width, height, orientation } = metadata;
    if (width * height > MAX_PIXELS) throw uploadError('TOO_MANY_PIXELS');
    return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
}

module.exports = { MAX_PIXELS, validateImage };

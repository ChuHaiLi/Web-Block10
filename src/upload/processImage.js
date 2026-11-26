const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { uploadError } = require('./errors');
const { MAX_PIXELS, validateImage } = require('./validateImage');
const { variantPlan } = require('./variantPlan');

// Keep Windows from retaining file handles needed for upload cleanup.
sharp.cache({ files: 0 });

async function processImage(file, id, storage, writtenKeys)
{
    const source = storage.keyToPath(file.tmpKey);
    await validateImage(file, source);

    const originalKey = `originals/${id}.png`;
    const originalPath = storage.keyToPath(originalKey);
    const reservation = await fs.open(originalPath, 'wx');
    writtenKeys.push(originalKey);
    await reservation.close();

    let original;
    try
    {
        original = await sharp(source, { limitInputPixels: MAX_PIXELS, failOn: 'warning' })
            .rotate()
            .png()
            .toFile(originalPath);
    }
    catch (error)
    {
        throw uploadError('CORRUPT', error);
    }

    const widths = variantPlan(original.width, original.height);
    const variants = [];
    for (const width of widths)
    {
        const storageKey = `photos/${id}/v1/${width}.webp`;
        const variantPath = storage.keyToPath(storageKey);
        await fs.mkdir(path.dirname(variantPath), { recursive: true });
        writtenKeys.push(storageKey);
        const info = await sharp(originalPath).resize({ width }).webp({ quality: 80 }).toFile(variantPath);
        variants.push({ storageKey, width: info.width, height: info.height, mime: 'image/webp', bytes: info.size });
    }

    return { originalKey, originalWidth: original.width, originalHeight: original.height, variants };
}

module.exports = { processImage };

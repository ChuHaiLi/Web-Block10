const sharp = require('sharp');
const { uploadError } = require('./errors');
const { MAX_PIXELS, validateImage } = require('./validateImage');
const { variantPlan } = require('./variantPlan');

// Keep Windows from retaining file handles needed for upload cleanup.
sharp.cache({ files: 0 });

async function processImage(file, id, scratch, objectStore, writtenKeys)
{
    const source = scratch.keyToPath(file.tmpKey);
    const { width, height } = await validateImage(file, source);

    const originalKey = `originals/${id}.png`;
    let original;
    try
    {
        original = await sharp(source, { limitInputPixels: MAX_PIXELS, failOn: 'warning' })
            .rotate()
            .png()
            .toBuffer({ resolveWithObject: true });
    }
    catch (error)
    {
        throw uploadError('CORRUPT', error);
    }
    writtenKeys.push(originalKey);
    await objectStore.put(originalKey, original.data, { contentType: 'image/png' });

    const variants = [];
    for (const variantWidth of variantPlan(width, height))
    {
        const storageKey = `photos/${id}/v1/${variantWidth}.webp`;
        const { data, info } = await sharp(original.data).resize({ width: variantWidth })
            .webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
        writtenKeys.push(storageKey);
        await objectStore.put(storageKey, data, { contentType: 'image/webp' });
        variants.push({ storageKey, width: info.width, height: info.height, mime: 'image/webp', bytes: info.size });
    }

    return { originalKey, originalWidth: original.info.width, originalHeight: original.info.height, variants };
}

module.exports = { processImage };

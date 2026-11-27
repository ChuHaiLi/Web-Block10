const { newId } = require('../ids');
const { uploadError } = require('./errors');
const { processImage } = require('./processImage');

async function savePhoto({ prisma, scratch, objectStore, queue, faultInject, file, title, alt, ownerId })
{
    if (!ownerId) throw new TypeError('ownerId is required');

    const id = newId();
    const writtenKeys = [];

    try
    {
        const { variants, ...original } = await processImage(file, id, scratch, objectStore, writtenKeys);
        await prisma.$transaction(async tx =>
        {
            await tx.photo.create({ data: { id, ownerId, title, alt, ...original } });
            await tx.photoVersion.create({
                data: {
                    photoId: id,
                    version: 1,
                    edits: { rotate: 0, flipH: false, crop: null },
                    width: original.originalWidth,
                    height: original.originalHeight
                }
            });
            await tx.photoVariant.createMany({ data: variants.map(variant => ({ ...variant, photoId: id, version: 1 })) });
            if (process.env.NODE_ENV === 'test' && faultInject === 'db-after-write') throw new Error('FAULT_INJECT');
        });

        return { id, title, variants };
    }
    catch (error)
    {
        for (const key of writtenKeys)
        {
            await queue.deleteOrEnqueue(key, 'upload-rollback');
        }

        if (['TOO_LARGE', 'NOT_IMAGE', 'CORRUPT', 'TOO_MANY_PIXELS', 'UNSUPPORTED_DIMENSIONS'].includes(error.code)) throw error;
        throw uploadError('STORAGE_ERROR', error);
    }
}

module.exports = { savePhoto };

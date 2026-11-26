const { newPhotoId } = require('../ids');
const { uploadError } = require('./errors');
const { processImage } = require('./processImage');

async function savePhoto({ prisma, storage, file, title, alt })
{
    const id = newPhotoId();
    const writtenKeys = [];

    try
    {
        const { variants, ...original } = await processImage(file, id, storage, writtenKeys);
        await prisma.$transaction(async tx =>
        {
            await tx.photo.create({ data: { id, title, alt, ...original } });
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
        });

        return { id, title, variants };
    }
    catch (error)
    {
        for (const key of writtenKeys)
        {
            await storage.deleteKey(key).catch(cleanupError => console.error(`Không xóa được ${key}`, cleanupError));
        }

        if (['TOO_LARGE', 'NOT_IMAGE', 'CORRUPT', 'TOO_MANY_PIXELS', 'UNSUPPORTED_DIMENSIONS'].includes(error.code)) throw error;
        throw uploadError('STORAGE_ERROR', error);
    }
}

module.exports = { savePhoto };

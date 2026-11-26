const fs = require('node:fs/promises');
const { editError } = require('./errors');
const renderer = require('./renderEdits');
const { validateEdits } = require('./validateEdits');

const MAX_DB_VERSION = 2_147_483_647;

class NotApplied extends Error
{
}

async function currentPhoto(prisma, id)
{
    return prisma.photo.findUnique({
        where: { id, status: 'PUBLISHED' },
        select: { currentVersion: true }
    });
}

async function saveVersion({ prisma, storage, queue, id, input, faultInject })
{
    const photo = await prisma.photo.findUnique({
        where: { id, status: 'PUBLISHED' },
        select: { originalWidth: true, originalHeight: true }
    });
    if (!photo) throw editError('NOT_FOUND');
    const { baseVersion, edits, variantWidths } = validateEdits(input, photo);

    let allocated;
    try
    {
        allocated = await prisma.photo.update({
            where: { id, status: 'PUBLISHED' },
            data: { nextVersion: { increment: 1 } },
            select: { originalKey: true, nextVersion: true }
        });
    }
    catch (error)
    {
        if (error.code === 'P2025') throw editError('NOT_FOUND');
        throw error;
    }

    const version = allocated.nextVersion - 1;
    const writtenKeys = [];
    try
    {
        const original = await fs.readFile(storage.keyToPath(allocated.originalKey));
        const { image, width, height } = await renderer.renderEdits(original, edits);
        const variants = [];
        for (const variantWidth of variantWidths)
        {
            const storageKey = 'photos/' + id + '/v' + version + '/' + variantWidth + '.webp';
            const { data, info } = await image.clone().resize({ width: variantWidth })
                .webp({ quality: 80 })
                .toBuffer({ resolveWithObject: true });
            writtenKeys.push(storageKey);
            await storage.writeFile(storageKey, data);
            variants.push({ width: info.width, height: info.height, mime: 'image/webp', bytes: info.size, storageKey });
        }

        await prisma.$transaction(async tx =>
        {
            await tx.photoVersion.create({ data: { photoId: id, version, edits, width, height } });
            await tx.photoVariant.createMany({
                data: variants.map(variant => ({ ...variant, photoId: id, version }))
            });
            if (baseVersion > MAX_DB_VERSION) throw new NotApplied();
            const updated = await tx.photo.updateMany({
                where: { id, status: 'PUBLISHED', currentVersion: baseVersion },
                data: { currentVersion: version }
            });
            if (updated.count === 0) throw new NotApplied();

            await tx.photoVersion.update({
                where: { photoId_version: { photoId: id, version: baseVersion } },
                data: { supersededAt: new Date() }
            });
            if (process.env.NODE_ENV === 'test' && faultInject === 'edit-db-after-write') throw new Error('FAULT_INJECT');
        }, { isolationLevel: 'ReadCommitted' });

        return {
            version,
            variants: variants.map(variant => ({
                width: variant.width, height: variant.height, url: '/media/' + variant.storageKey
            }))
        };
    }
    catch (error)
    {
        for (const key of writtenKeys) await queue.deleteOrEnqueue(key, 'edit-rollback');

        if (error instanceof NotApplied)
        {
            const latest = await currentPhoto(prisma, id);
            if (!latest) throw editError('NOT_FOUND');
            throw editError('VERSION_CONFLICT', { currentVersion: latest.currentVersion });
        }
        if (error.code === 'ENOENT' && !await currentPhoto(prisma, id)) throw editError('NOT_FOUND');
        throw error;
    }
}

module.exports = { saveVersion };

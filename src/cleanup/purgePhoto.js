async function purgePhoto({ prisma, storage, id })
{
    const photo = await prisma.photo.findUnique({
        where: { id, status: 'DELETING' },
        select: { originalKey: true, variants: { select: { storageKey: true } } }
    });
    if (!photo) return 0;

    const keys = [...photo.variants.map(variant => variant.storageKey), photo.originalKey];
    let filesRemoved = 0;
    let failed = false;
    for (const key of keys)
    {
        try
        {
            if (await storage.deleteKey(key)) filesRemoved++;
        }
        catch (error)
        {
            if (error.code === 'ENOENT') continue;
            failed = true;
            console.error('Không xóa được ' + key + ' của ảnh ' + id, error);
        }
    }

    if (!failed)
    {
        const purgedAt = new Date();
        await prisma.$transaction(async tx =>
        {
            const updated = await tx.photo.updateMany({
                where: { id, status: 'DELETING' },
                data: { status: 'PURGED', purgedAt }
            });
            if (updated.count === 0) return;

            await tx.photoVersion.updateMany({ where: { photoId: id }, data: { purgedAt } });
        });
    }

    return filesRemoved;
}

module.exports = { purgePhoto };

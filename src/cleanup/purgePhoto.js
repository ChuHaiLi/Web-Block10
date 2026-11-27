async function purgePhoto({ prisma, objectStore, id })
{
    const photo = await prisma.photo.findUnique({
        where: { id, status: 'DELETING' },
        select: { originalKey: true, variants: { select: { storageKey: true } } }
    });
    if (!photo) return 0;

    let filesRemoved = 0;
    let failed = false;
    const listedKeys = [];
    try
    {
        for await (const { key } of objectStore.list('photos/' + id + '/')) listedKeys.push(key);
    }
    catch (error)
    {
        failed = true;
        console.error('Không liệt kê được object của ảnh ' + id, error);
    }

    const keys = [...new Set([...photo.variants.map(variant => variant.storageKey), ...listedKeys]), photo.originalKey];
    for (const key of keys)
    {
        try
        {
            await objectStore.delete(key);
            filesRemoved++;
        }
        catch (error)
        {
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

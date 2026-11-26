const express = require('express');

function createPagesRouter(prisma)
{
    const router = express.Router();
    router.get('/', async (req, res, next) =>
    {
        try
        {
            const records = await prisma.photo.findMany({
                where: { status: 'PUBLISHED' },
                orderBy: { createdAt: 'desc' },
                include: { variants: { where: { photoVersion: { purgedAt: null } }, orderBy: { width: 'asc' } } }
            });

            const photos = records.flatMap(({ id, title, alt, currentVersion, variants }) =>
            {
                const current = variants.filter(variant => variant.version === currentVersion);
                const cover = current.findLast(variant => variant.width <= 960) ?? current[0];
                return cover ? [{ id, title, alt, cover }] : [];
            });

            res.render('layout', { title: 'Gallery', page: 'gallery', photos });
        }
        catch (error)
        {
            next(error);
        }
    });

    router.get('/upload', (req, res) =>
    {
        res.render('layout', { title: 'Upload', page: 'upload' });
    });

    return router;
}

module.exports = { createPagesRouter };

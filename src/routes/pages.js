const express = require('express');

const displayedVariants = {
    where: { photoVersion: { purgedAt: null } },
    orderBy: { width: 'asc' }
};

function presentPhoto(photo)
{
    const variants = photo.variants
        .filter(variant => variant.version === photo.currentVersion)
        .map(variant => ({ ...variant, url: '/media/' + variant.storageKey }));
    const cover = variants.findLast(variant => variant.width <= 960) ?? variants[0];
    if (!cover) return null;

    const srcset = variants.map(variant => variant.url + ' ' + variant.width + 'w').join(', ');
    return { ...photo, variants, cover, srcset };
}

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
                include: { variants: displayedVariants }
            });
            const photos = records.map(presentPhoto).filter(Boolean);
            res.render('layout', { title: 'Gallery', page: 'gallery', photos });
        }
        catch (error)
        {
            next(error);
        }
    });

    router.get('/photos/:id', async (req, res, next) =>
    {
        try
        {
            const record = await prisma.photo.findUnique({
                where: { id: req.params.id, status: 'PUBLISHED' },
                include: { variants: displayedVariants }
            });
            const photo = record && presentPhoto(record);
            if (!photo) return next();

            res.render('layout', { title: photo.title, page: 'detail', photo });
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

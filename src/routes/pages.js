const express = require('express');
const fs = require('node:fs/promises');
const sharp = require('sharp');
const { MAX_PIXELS } = require('../upload/validateImage');
const { purgePhoto } = require('../cleanup/purgePhoto');

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

function createPagesRouter(prisma, storage)
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

    router.get('/photos/:id/edit/source', async (req, res, next) =>
    {
        try
        {
            const photo = await prisma.photo.findUnique({
                where: { id: req.params.id, status: 'PUBLISHED' },
                select: { originalKey: true }
            });
            if (!photo) return next();

            const original = await fs.readFile(storage.keyToPath(photo.originalKey));
            const webp = await sharp(original, { limitInputPixels: MAX_PIXELS, failOn: 'warning' })
                .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 80 })
                .toBuffer();
            res.set('Cache-Control', 'private, no-store').type('image/webp').send(webp);
        }
        catch (error)
        {
            if (error.code === 'ENOENT') return next();
            next(error);
        }
    });

    router.post('/photos/:id/delete', async (req, res, next) =>
    {
        const { id } = req.params;
        try
        {
            const updated = await prisma.photo.updateMany({
                where: { id, status: 'PUBLISHED' },
                data: { status: 'DELETING', deletedAt: new Date() }
            });
            if (updated.count === 0) return next();

            await purgePhoto({ prisma, storage, id });
            res.redirect(303, '/');
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

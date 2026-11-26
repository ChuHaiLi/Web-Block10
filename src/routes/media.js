const express = require('express');
const { variantKeyPattern } = require('../storage');

function createMediaRouter(prisma, storage)
{
    const router = express.Router();
    router.get(/^\//, async (req, res, next) =>
    {
        let key;
        try
        {
            key = decodeURIComponent(req.path.slice(1));
        }
        catch
        {
            return next();
        }
        if (key !== key.trim() || !variantKeyPattern.test(key)) return next();

        try
        {
            const variant = await prisma.photoVariant.findFirst({
                where: { storageKey: key, photo: { status: 'PUBLISHED' }, photoVersion: { purgedAt: null } },
                select: { storageKey: true }
            });
            if (!variant) return next();

            res.set({
                'Content-Type': 'image/webp',
                'Cache-Control': 'public, max-age=31536000, immutable',
                'X-Content-Type-Options': 'nosniff'
            });
            res.sendFile(variant.storageKey, { root: storage.root, cacheControl: false, dotfiles: 'deny' }, error =>
            {
                if (!error) return;
                if (error.code === 'ENOENT' && !res.headersSent)
                {
                    console.warn(`Thiếu file media ${key}`);
                    res.removeHeader('Content-Type');
                    res.removeHeader('Cache-Control');
                    return next();
                }
                next(error);
            });
        }
        catch (error)
        {
            next(error);
        }
    });

    return router;
}

module.exports = { createMediaRouter };

const express = require('express');
const { once } = require('node:events');
const { pipeline } = require('node:stream/promises');
const { variantKeyPattern } = require('../storage/objectStore');

async function sendMedia(req, res, { body, contentLength })
{
    const controller = new AbortController();
    const onClose = () =>
    {
        controller.abort();
        body.destroy();
    };
    res.once('close', onClose);
    try
    {
        res.set({
            'Content-Type': 'image/webp',
            'Content-Length': String(contentLength),
            'Cache-Control': 'public, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff'
        });
        if (req.method === 'HEAD') return res.end();

        // A direct pipeline to res destroys the socket on a source error even before headers are sent.
        await pipeline(body, async (chunks, { signal }) =>
        {
            for await (const chunk of chunks)
            {
                if (!res.write(chunk)) await once(res, 'drain', { signal });
            }
            res.end();
        }, { signal: controller.signal });
    }
    finally
    {
        body.destroy();
        res.off('close', onClose);
    }
}

function createMediaRouter(prisma, objectStore)
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

        let variant;
        try
        {
            variant = await prisma.photoVariant.findFirst({
                where: { storageKey: key, photo: { status: 'PUBLISHED' }, photoVersion: { purgedAt: null } },
                select: { storageKey: true }
            });
        }
        catch (error)
        {
            return next(error);
        }
        if (!variant) return next();

        try
        {
            const object = await objectStore.getStream(variant.storageKey);
            if (res.destroyed)
            {
                object.body.destroy();
                return;
            }
            await sendMedia(req, res, object);
        }
        catch (error)
        {
            if (res.destroyed) return;
            if (res.headersSent) return next(error);
            for (const header of ['Content-Type', 'Content-Length', 'Cache-Control', 'X-Content-Type-Options'])
            {
                res.removeHeader(header);
            }
            if (error.code === 'NOT_FOUND')
            {
                console.warn(`Thiếu object media ${key}`);
                return next();
            }
            if (objectStore.describe().driver !== 's3') return next(error);
            console.error('Không đọc được object media ' + key, error);
            res.status(502).type('text').send('Không đọc được ảnh từ kho lưu trữ');
        }
    });

    return router;
}

module.exports = { createMediaRouter };

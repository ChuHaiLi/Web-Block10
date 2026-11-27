const express = require('express');
const { once } = require('node:events');
const { pipeline } = require('node:stream/promises');
const { createCleanupQueue } = require('../cleanup/queue');
const { isPresetAllowed } = require('../download/presets');
const { createRenditionService } = require('../download/renditions');

const MAX_DB_INT = 2_147_483_647;
const PHOTO_ID_PATTERN = /^[A-Za-z0-9_-]{12}$/;
const VERSION_PATTERN = /^[1-9]\d*$/;
const RESPONSE_HEADERS = ['Content-Type', 'Content-Length', 'Content-Disposition', 'Cache-Control', 'X-Content-Type-Options'];

function asciiBaseName(title, photoId)
{
    const clean = String(title ?? '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
        .replace(/-+$/g, '');
    return clean || 'photo-' + photoId;
}

function utf8BaseName(title, photoId)
{
    const clean = String(title ?? '')
        .replace(/\p{Cc}/gu, '')
        .replace(/[\\/:*?"<>|]/g, '')
        .trim();
    return clean || 'photo-' + photoId;
}

function encodeRFC5987(value)
{
    return encodeURIComponent(value).replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
}

function buildContentDisposition({ title, photoId, isOriginal, width, height, ext })
{
    const suffix = (isOriginal ? '-original-' : '-') + width + 'x' + height + '.' + ext;
    const asciiName = asciiBaseName(title, photoId) + suffix;
    const utf8Name = utf8BaseName(title, photoId) + suffix;
    return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeRFC5987(utf8Name)}`;
}

function clearDownloadHeaders(res)
{
    for (const header of RESPONSE_HEADERS) res.removeHeader(header);
}

async function sendStreamResponse(req, res, { body, contentLength, contentType, disposition })
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
            'Content-Type': contentType,
            'Content-Length': String(contentLength),
            'Content-Disposition': disposition,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff'
        });
        if (req.method === 'HEAD') return res.end();

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

function sendBufferResponse(req, res, { buffer, contentType, disposition })
{
    res.set({
        'Content-Type': contentType,
        'Content-Length': String(buffer.length),
        'Content-Disposition': disposition,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD') return res.end();
    res.end(buffer);
}

async function findCachedObject(objectStore, baseKey)
{
    for (const [ext, contentType] of [['jpg', 'image/jpeg'], ['png', 'image/png']])
    {
        const key = baseKey + '.' + ext;
        try
        {
            const object = await objectStore.getStream(key);
            return { ...object, ext, contentType: object.contentType || contentType, key };
        }
        catch (error)
        {
            if (error.code !== 'NOT_FOUND') throw error;
        }
    }
    return null;
}

function createDownloadRouter(prisma, objectStore, scratch)
{
    const router = express.Router();
    const queue = createCleanupQueue({ objectStore, scratch });
    const renditions = createRenditionService({ prisma, objectStore, queue });

    router.get('/photos/:id/v/:version/download/:size', async (req, res, next) =>
    {
        const { id, version: versionParam, size } = req.params;
        if (!PHOTO_ID_PATTERN.test(id) || !VERSION_PATTERN.test(versionParam))
        {
            return res.status(404).type('text').send('Không tìm thấy ảnh');
        }
        const versionNumber = Number(versionParam);
        if (!Number.isSafeInteger(versionNumber) || versionNumber > MAX_DB_INT)
        {
            return res.status(404).type('text').send('Không tìm thấy ảnh');
        }

        const isOriginal = size === 'original';
        let record;
        try
        {
            record = await prisma.photoVersion.findFirst({
                where: { photoId: id, version: versionNumber, purgedAt: null, photo: { status: 'PUBLISHED' } },
                select: {
                    version: true,
                    width: true,
                    height: true,
                    edits: true,
                    photo: { select: { title: true, originalKey: true } }
                }
            });
        }
        catch (error)
        {
            return next(error);
        }
        if (!record) return res.status(404).type('text').send('Không tìm thấy ảnh');

        let target = null;
        if (!isOriginal)
        {
            target = isPresetAllowed(size, record.width, record.height);
            if (!target) return res.status(404).type('text').send('Không tìm thấy ảnh');
        }

        const outWidth = target ? target.width : record.width;
        const outHeight = target ? target.height : record.height;
        const baseKey = `photos/${id}/v${versionNumber}/dl/${isOriginal ? 'original' : outWidth + 'x' + outHeight}`;

        try
        {
            const cached = await findCachedObject(objectStore, baseKey);
            if (cached)
            {
                if (res.destroyed)
                {
                    cached.body.destroy();
                    return;
                }
                const disposition = buildContentDisposition({
                    title: record.photo.title,
                    photoId: id,
                    isOriginal,
                    width: outWidth,
                    height: outHeight,
                    ext: cached.ext
                });
                await sendStreamResponse(req, res, { ...cached, disposition });
                return;
            }

            const rendered = await renditions.getOrCreate({
                photoId: id,
                version: versionNumber,
                originalKey: record.photo.originalKey,
                edits: record.edits,
                target
            });
            if (res.destroyed) return;

            const ext = rendered.contentType === 'image/png' ? 'png' : 'jpg';
            const disposition = buildContentDisposition({
                title: record.photo.title,
                photoId: id,
                isOriginal,
                width: outWidth,
                height: outHeight,
                ext
            });
            sendBufferResponse(req, res, { ...rendered, disposition });
        }
        catch (error)
        {
            if (res.destroyed) return;
            if (res.headersSent) return next(error);
            clearDownloadHeaders(res);
            if (error.code === 'NOT_FOUND')
            {
                return res.status(404).type('text').send('Không tìm thấy ảnh');
            }
            if (objectStore.describe().driver !== 's3') return next(error);
            console.error('Không tạo hoặc đọc được file tải về ' + baseKey, error);
            res.status(502).type('text').send('Không đọc được ảnh từ kho lưu trữ');
        }
    });

    return router;
}

module.exports = { createDownloadRouter };

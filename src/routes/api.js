const path = require('node:path');
const express = require('express');
const { uploadError } = require('../upload/errors');
const { createCleanupQueue } = require('../cleanup/queue');
const { parseMultipart } = require('../upload/parseMultipart');
const { savePhoto } = require('../upload/savePhoto');

const requestStatuses = {
    NOT_MULTIPART: 400,
    MALFORMED: 400,
    NO_FILES: 400,
    TOO_MANY_FILES: 400,
    REQUEST_TOO_LARGE: 413,
    STORAGE_ERROR: 500
};

function getMetadata(fields, { index, filename })
{
    const titleField = fields.get('title_' + index);
    const altField = fields.get('alt_' + index);
    const title = (titleField?.value ?? '').trim();
    const alt = (altField?.value ?? '').trim();
    if (!alt && !altField?.truncated) throw uploadError('ALT_REQUIRED');
    if (titleField?.truncated || altField?.truncated || Array.from(title).length > 120 || Array.from(alt).length > 250)
    {
        throw uploadError('INVALID_FIELD');
    }

    const basename = path.win32.parse(path.win32.basename(filename)).name.replace(/\p{Cc}/gu, '').trim();
    const fallback = Array.from(basename).slice(0, 120).join('');
    return { title: title || fallback || 'Ảnh không tên', alt };
}

async function uploadPhoto(prisma, storage, queue, faultInject, file, fields)
{
    const { index, filename } = file;
    try
    {
        const metadata = getMetadata(fields, file);
        const { id, title, variants } = await savePhoto({ prisma, storage, queue, faultInject, file, ...metadata });
        return {
            index,
            filename,
            ok: true,
            photo: {
                id,
                title,
                url: '/photos/' + id,
                variants: variants.map(({ width, height, storageKey }) => ({ width, height, url: '/media/' + storageKey }))
            }
        };
    }
    catch (error)
    {
        if (error.code === 'STORAGE_ERROR') console.error(error);
        return { index, filename, ok: false, error: { code: error.code, message: error.message } };
    }
}

function sendRequestError(req, res, status, error)
{
    const payload = { error: { code: error.code, message: error.message } };
    if (!req.complete || !['NOT_MULTIPART', 'NO_FILES'].includes(error.code)) res.set('Connection', 'close');
    if (!error.drainRequest || req.complete) return res.status(status).json(payload);

    // Flush the error before ending the socket so unread bytes do not reset the response.
    const body = JSON.stringify(payload);
    const endResponse = () => res.end();
    const drainTimeout = setTimeout(endResponse, 250);
    drainTimeout.unref();
    req.once('end', endResponse);
    res.once('close', () =>
    {
        clearTimeout(drainTimeout);
        req.off('end', endResponse);
    });

    res.status(status).type('json').set('Content-Length', String(Buffer.byteLength(body))).write(body);
    req.resume();
}

function createApiRouter(prisma, storage)
{
    const router = express.Router();
    const queue = createCleanupQueue(storage);
    router.post('/uploads', async (req, res, next) =>
    {
        let parsed;
        try
        {
            parsed = await parseMultipart(req, storage, queue);
        }
        catch (error)
        {
            if (error.code === 'ABORTED')
            {
                console.warn(error.message);
                return;
            }
            const status = requestStatuses[error.code];
            if (!status) return next(error);
            if (status === 500) console.error(error);
            if (!res.destroyed) sendRequestError(req, res, status, error);
            return;
        }

        const { files, fields } = parsed;
        const results = [];
        const remaining = new Set(files.map(file => file.tmpKey));
        const faultInject = req.app.get('faultInject');
        try
        {
            for (const file of files)
            {
                results.push(await uploadPhoto(prisma, storage, queue, faultInject, file, fields));
                if (await queue.deleteOrEnqueue(file.tmpKey, 'upload-temp')) remaining.delete(file.tmpKey);
            }
        }
        catch (error)
        {
            return next(error);
        }
        finally
        {
            for (const key of remaining) await queue.deleteOrEnqueue(key, 'upload-temp');
        }

        res.json({ results });
    });

    return router;
}

module.exports = { createApiRouter };

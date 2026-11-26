const path = require('node:path');
const express = require('express');
const { uploadError } = require('../upload/errors');
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

function getMetadata(fields, filename)
{
    const title = (fields.get('title_0') ?? '').trim();
    const alt = (fields.get('alt_0') ?? '').trim();
    if (!alt) throw uploadError('ALT_REQUIRED');
    if (Array.from(title).length > 120 || Array.from(alt).length > 250) throw uploadError('INVALID_FIELD');

    const basename = path.win32.parse(path.win32.basename(filename)).name.replace(/\p{Cc}/gu, '').trim();
    const fallback = Array.from(basename).slice(0, 120).join('');
    return { title: title || fallback || 'Ảnh không tên', alt };
}

function createApiRouter(prisma, storage)
{
    const router = express.Router();
    router.post('/uploads', async (req, res, next) =>
    {
        let parsed;
        try
        {
            parsed = await parseMultipart(req, storage);
        }
        catch (error)
        {
            if (error.code === 'ABORTED') return;
            const status = requestStatuses[error.code];
            if (!status) return next(error);
            if (status === 500) console.error(error);
            if (!req.complete || status === 413) res.set('Connection', 'close');
            return res.status(status).json({ error: { code: error.code, message: error.message } });
        }

        const { file, fields } = parsed;
        const result = { index: file.index, filename: file.filename };
        try
        {
            const metadata = getMetadata(fields, file.filename);
            const { id, title, variants } = await savePhoto({ prisma, storage, file, ...metadata });
            result.ok = true;
            result.photo = {
                id,
                title,
                url: `/photos/${id}`,
                variants: variants.map(({ width, height, storageKey }) => ({ width, height, url: `/media/${storageKey}` }))
            };
        }
        catch (error)
        {
            if (error.code === 'STORAGE_ERROR') console.error(error);
            result.ok = false;
            result.error = { code: error.code, message: error.message };
        }
        finally
        {
            await storage.deleteKey(file.tmpKey).catch(error => console.error(`Không xóa được ${file.tmpKey}`, error));
        }

        res.json({ results: [result] });
    });

    return router;
}

module.exports = { createApiRouter };

const fs = require('node:fs');
const { finished } = require('node:stream/promises');
const busboy = require('busboy');
const { newPhotoId } = require('../ids');
const { uploadError } = require('./errors');

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = 55 * 1024 * 1024;

async function parseMultipart(req, scratch, queue)
{
    if (!/^multipart\/form-data(?:\s*;|$)/i.test(req.headers['content-type'] ?? ''))
    {
        throw uploadError('NOT_MULTIPART');
    }
    if (Number(req.headers['content-length']) > MAX_REQUEST_BYTES)
    {
        throw uploadError('REQUEST_TOO_LARGE');
    }

    let parser;
    try
    {
        parser = busboy({
            headers: req.headers,
            defParamCharset: 'utf8',
            limits: { files: MAX_FILES, fileSize: MAX_FILE_BYTES + 1, fields: 20, fieldSize: 4096, parts: 30 }
        });
    }
    catch (error)
    {
        throw uploadError('MALFORMED', error);
    }

    const uploadId = newPhotoId();
    const fields = new Map();
    const files = [];
    const writers = [];
    let failure;
    let requestBytes = 0;

    function abort(code, cause)
    {
        if (failure) return;
        failure = uploadError(code, cause);
        failure.drainRequest = true;
        req.unpipe(parser);
        req.pause();

        // Busboy may still be handling the chunk that raised the event.
        queueMicrotask(() =>
        {
            parser.destroy();
            for (const { writer } of writers) writer.destroy();
        });
    }

    function onData(chunk)
    {
        requestBytes += chunk.length;
        if (requestBytes > MAX_REQUEST_BYTES) abort('REQUEST_TOO_LARGE');
    }

    function onAborted()
    {
        abort('ABORTED');
    }

    function onClose()
    {
        if (!req.complete) onAborted();
    }

    parser.on('file', (field, stream, { filename, mimeType }) =>
    {
        stream.on('error', error => abort('MALFORMED', error));
        if (failure || field !== 'photos')
        {
            stream.resume();
            return;
        }

        const index = files.length;
        const tmpKey = 'tmp/' + uploadId + '-' + index;
        const file = { index, filename: filename ?? '', mimeType, tmpKey, bytes: 0, truncated: false };
        files.push(file);

        try
        {
            const writer = fs.createWriteStream(scratch.keyToPath(tmpKey), { flags: 'wx' });
            const writing = finished(writer).catch(error => abort('STORAGE_ERROR', error));
            const entry = { writer, writing, tmpKey, opened: false };
            writers.push(entry);

            writer.once('open', () =>
            {
                entry.opened = true;
            });
            stream.on('data', chunk =>
            {
                file.bytes += chunk.length;
            });
            stream.on('limit', () =>
            {
                file.truncated = true;
            });
            stream.pipe(writer);
        }
        catch (error)
        {
            abort('STORAGE_ERROR', error);
        }
    });

    parser.on('field', (field, value, { valueTruncated }) =>
    {
        if (!failure && /^(?:title|alt)_[0-4]$/.test(field)) fields.set(field, { value, truncated: valueTruncated });
    });
    parser.on('filesLimit', () => abort('TOO_MANY_FILES'));
    parser.on('fieldsLimit', () => abort('MALFORMED'));
    parser.on('partsLimit', () => abort('MALFORMED'));
    parser.on('error', error => abort('MALFORMED', error));

    const closed = new Promise(resolve => parser.once('close', resolve));
    req.on('data', onData);
    req.on('aborted', onAborted);
    req.on('close', onClose);
    req.on('error', onAborted);
    if (req.aborted) onAborted();
    else req.pipe(parser);

    try
    {
        await closed;
        await Promise.allSettled(writers.map(entry => entry.writing));
        if (failure) throw failure;
        if (files.length === 0) throw uploadError('NO_FILES');
        return { files, fields };
    }
    catch (error)
    {
        for (const { opened, tmpKey } of writers)
        {
            if (opened) await queue.deleteOrEnqueue(tmpKey, 'upload-abort');
        }
        throw error;
    }
    finally
    {
        req.off('data', onData);
        req.off('aborted', onAborted);
        req.off('close', onClose);
        req.off('error', onAborted);
    }
}

module.exports = { MAX_FILE_BYTES, parseMultipart };

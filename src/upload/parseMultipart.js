const { createWriteStream } = require('node:fs');
const { finished } = require('node:stream/promises');
const busboy = require('busboy');
const { newPhotoId } = require('../ids');
const { uploadError } = require('./errors');

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = 55 * 1024 * 1024;

async function parseMultipart(req, storage)
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
            limits: { files: 1, fileSize: MAX_FILE_BYTES + 1, fields: 20, fieldSize: 4096, parts: 30 }
        });
    }
    catch (error)
    {
        throw uploadError('MALFORMED', error);
    }

    const fields = new Map();
    let file;
    let writer;
    let writing;
    let failure;
    let requestBytes = 0;

    function abort(error)
    {
        if (failure) return;
        failure = error;
        req.unpipe(parser);
        parser.destroy();
        writer?.destroy();
    }

    function onData(chunk)
    {
        requestBytes += chunk.length;
        if (requestBytes > MAX_REQUEST_BYTES) abort(uploadError('REQUEST_TOO_LARGE'));
    }

    function onDisconnect()
    {
        if (!req.complete) abort(uploadError('ABORTED'));
    }

    parser.on('file', (field, stream, { filename, mimeType }) =>
    {
        stream.on('error', error => abort(uploadError('MALFORMED', error)));
        if (failure || field !== 'photos')
        {
            stream.resume();
            return;
        }

        const tmpKey = `tmp/${newPhotoId()}-0`;
        file = { index: 0, filename: filename ?? '', mimeType, tmpKey, bytes: 0, truncated: false };
        stream.on('data', chunk =>
        {
            file.bytes += chunk.length;
        });
        stream.on('limit', () =>
        {
            file.truncated = true;
        });

        writer = createWriteStream(storage.keyToPath(tmpKey), { flags: 'wx' });
        writing = finished(writer).catch(error => abort(uploadError('STORAGE_ERROR', error)));
        stream.pipe(writer);
    });

    parser.on('field', (field, value) =>
    {
        if (!failure && (field === 'title_0' || field === 'alt_0')) fields.set(field, value);
    });
    parser.on('filesLimit', () => abort(uploadError('TOO_MANY_FILES')));
    parser.on('fieldsLimit', () => abort(uploadError('MALFORMED')));
    parser.on('partsLimit', () => abort(uploadError('MALFORMED')));
    parser.on('error', error => abort(uploadError('MALFORMED', error)));

    const closed = new Promise(resolve => parser.once('close', resolve));
    req.on('data', onData);
    req.on('aborted', onDisconnect);
    req.on('close', onDisconnect);
    req.on('error', onDisconnect);
    req.pipe(parser);

    try
    {
        await closed;
        await writing;
        if (failure) throw failure;
        if (!file) throw uploadError('NO_FILES');
        return { file, fields };
    }
    catch (error)
    {
        if (file)
        {
            await storage.deleteKey(file.tmpKey).catch(cleanupError => console.error(cleanupError));
        }
        throw error;
    }
    finally
    {
        req.off('data', onData);
        req.off('aborted', onDisconnect);
        req.off('close', onDisconnect);
        req.off('error', onDisconnect);
    }
}

module.exports = { MAX_FILE_BYTES, parseMultipart };

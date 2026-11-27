const fs = require('node:fs/promises');
const path = require('node:path');
const { isObjectKey, validateObjectKey } = require('./objectStore');
const { keyPath, unlinkIfPresent, removeEmptyDirectory } = require('./filesystem');

const directories = ['photos', 'originals'];

function notFound(key, cause)
{
    return Object.assign(new Error('Object not found: ' + key, { cause }), { code: 'NOT_FOUND' });
}

function createLocalObjectStore(uploadRoot)
{
    const root = path.resolve(uploadRoot);

    function objectPath(key)
    {
        validateObjectKey(key);
        return keyPath(root, key);
    }

    async function put(key, body)
    {
        const filePath = objectPath(key);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, body);
    }

    async function getStream(key)
    {
        const filePath = objectPath(key);
        let handle;
        try
        {
            handle = await fs.open(filePath, 'r');
            const stat = await handle.stat();
            if (!stat.isFile()) throw notFound(key);
            return {
                body: handle.createReadStream(),
                contentLength: stat.size,
                contentType: key.endsWith('.png') ? 'image/png' : 'image/webp',
                lastModified: stat.mtime
            };
        }
        catch (error)
        {
            if (handle) await handle.close();
            if (error.code === 'ENOENT') throw notFound(key, error);
            throw error;
        }
    }

    async function getBuffer(key)
    {
        const filePath = objectPath(key);
        try
        {
            return await fs.readFile(filePath);
        }
        catch (error)
        {
            if (error.code === 'ENOENT' || error.code === 'EISDIR') throw notFound(key, error);
            throw error;
        }
    }

    async function deleteObject(key)
    {
        const filePath = objectPath(key);
        await unlinkIfPresent(filePath);
        if (key.startsWith('photos/'))
        {
            const versionDir = path.dirname(filePath);
            await removeEmptyDirectory(versionDir);
            await removeEmptyDirectory(path.dirname(versionDir));
        }
    }

    async function* walk(directory, prefix, pageSize)
    {
        const directoryPrefix = directory + '/';
        if (!prefix.startsWith(directoryPrefix) && !directoryPrefix.startsWith(prefix)) return;

        let entries;
        try
        {
            entries = await fs.opendir(path.join(root, directory), { bufferSize: pageSize });
        }
        catch (error)
        {
            if (error.code === 'ENOENT') return;
            throw error;
        }

        for await (const entry of entries)
        {
            const key = directoryPrefix + entry.name;
            if (entry.isDirectory()) yield* walk(key, prefix, pageSize);
            else if (entry.isFile() && key.startsWith(prefix) && isObjectKey(key))
            {
                try
                {
                    const stat = await fs.lstat(objectPath(key));
                    if (stat.isFile()) yield { key, size: stat.size, lastModified: stat.mtime };
                }
                catch (error)
                {
                    if (error.code !== 'ENOENT') throw error;
                }
            }
        }
    }

    async function* list(prefix, { pageSize = 1000 } = {})
    {
        for (const directory of directories) yield* walk(directory, prefix, pageSize);
    }

    async function ensureReady()
    {
        await Promise.all(directories.map(directory => fs.mkdir(path.join(root, directory), { recursive: true })));
    }

    function describe()
    {
        return { driver: 'local', root };
    }

    return { put, getStream, getBuffer, delete: deleteObject, list, ensureReady, describe };
}

module.exports = { createLocalObjectStore };

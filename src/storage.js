const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const variantKeyPattern = /^photos\/[A-Za-z0-9_-]{12}\/v\d+\/\d+\.webp$/;
const originalKeyPattern = /^originals\/[A-Za-z0-9_-]{12}\.png$/;
const temporaryKeyPattern = /^tmp\/[A-Za-z0-9_-]{12}-\d+$/;
const queueKeyPattern = /^cleanup-queue\/\d+-[a-f0-9]{12}\.(?:tmp|json|bad)$/;
const directories = ['photos', 'originals', 'tmp', 'cleanup-queue'];

async function retryWindowsFs(operation)
{
    const retries = process.platform === 'win32' ? 2 : 0;
    for (let attempt = 0; ; attempt++)
    {
        try
        {
            return await operation();
        }
        catch (error)
        {
            // Windows can report EPERM while another process is removing the same path.
            if (attempt >= retries || !['EPERM', 'EBUSY'].includes(error.code)) throw error;
            await delay(10);
        }
    }
}

async function unlinkIfPresent(filePath)
{
    try
    {
        await retryWindowsFs(() => fs.unlink(filePath));
        return true;
    }
    catch (error)
    {
        if (error.code !== 'ENOENT') throw error;
        return false;
    }
}

async function removeEmptyDirectory(directory)
{
    try
    {
        await retryWindowsFs(() => fs.rmdir(directory));
    }
    catch (error)
    {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error;
    }
}

function createStorage(uploadRoot)
{
    const root = path.resolve(uploadRoot);

    function keyToPath(key)
    {
        if (typeof key !== 'string' || key !== key.trim() ||
            ![variantKeyPattern, originalKeyPattern, temporaryKeyPattern, queueKeyPattern].some(pattern => pattern.test(key)))
        {
            throw new Error('Invalid storage key');
        }

        const filePath = path.join(root, key);
        const relative = path.relative(root, filePath);
        if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`))
        {
            throw new Error('Storage key resolves outside the upload root');
        }

        return filePath;
    }

    async function initialize()
    {
        await Promise.all(directories.map(directory => fs.mkdir(path.join(root, directory), { recursive: true })));
    }

    async function writeFile(key, bytes)
    {
        const filePath = keyToPath(key);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, bytes);
    }

    async function deleteKey(key)
    {
        const filePath = keyToPath(key);
        const removed = await unlinkIfPresent(filePath);

        if (variantKeyPattern.test(key))
        {
            const versionDir = path.dirname(filePath);
            for (const directory of [versionDir, path.dirname(versionDir)])
            {
                await removeEmptyDirectory(directory);
            }
        }
        return removed;
    }

    function listDir(directory)
    {
        if (!directories.includes(directory)) throw new Error('Invalid storage directory');
        return fs.readdir(path.join(root, directory));
    }

    return { root, initialize, keyToPath, writeFile, deleteKey, listDir };
}

module.exports = { createStorage, variantKeyPattern, originalKeyPattern, retryWindowsFs, unlinkIfPresent, removeEmptyDirectory };

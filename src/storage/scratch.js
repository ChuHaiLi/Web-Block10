const fs = require('node:fs/promises');
const path = require('node:path');
const { keyPath, unlinkIfPresent } = require('./filesystem');

const temporaryKeyPattern = /^tmp\/[A-Za-z0-9_-]{12}-\d+$/;
const queueKeyPattern = /^cleanup-queue\/\d+-[a-f0-9]{12}\.(?:tmp|json|bad)$/;
const directories = ['tmp', 'cleanup-queue'];

function createScratch(uploadRoot)
{
    const root = path.resolve(uploadRoot);

    function keyToPath(key)
    {
        if (typeof key !== 'string' || key !== key.trim() || ![temporaryKeyPattern, queueKeyPattern].some(pattern => pattern.test(key)))
        {
            throw new Error('Invalid scratch key');
        }
        return keyPath(root, key);
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

    function deleteKey(key)
    {
        return unlinkIfPresent(keyToPath(key));
    }

    function listDir(directory)
    {
        if (!directories.includes(directory)) throw new Error('Invalid scratch directory');
        return fs.readdir(path.join(root, directory));
    }

    return { root, initialize, keyToPath, writeFile, deleteKey, listDir };
}

module.exports = { createScratch };

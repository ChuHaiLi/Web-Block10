const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

function keyPath(root, key)
{
    const filePath = path.join(root, key);
    const relative = path.relative(root, filePath);
    if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`))
    {
        throw new Error('Storage key resolves outside the upload root');
    }
    return filePath;
}

function isWindowsSharingError(error)
{
    return process.platform === 'win32' && ['EPERM', 'EBUSY'].includes(error.code);
}

async function retryWindowsFs(operation)
{
    for (let attempt = 0; ; attempt++)
    {
        try
        {
            return await operation();
        }
        catch (error)
        {
            // Windows can report EPERM while another process is removing the same path.
            if (attempt >= 2 || !isWindowsSharingError(error)) throw error;
            await delay(10);
        }
    }
}

async function isMissingAfterDelete(filePath, error)
{
    if (error.code === 'ENOENT') return true;
    if (!isWindowsSharingError(error)) return false;

    try
    {
        await fs.lstat(filePath);
        return false;
    }
    catch (lookupError)
    {
        return lookupError.code === 'ENOENT';
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
        if (!await isMissingAfterDelete(filePath, error)) throw error;
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
        if (error.code !== 'ENOTEMPTY' && !await isMissingAfterDelete(directory, error)) throw error;
    }
}

module.exports = { keyPath, retryWindowsFs, unlinkIfPresent, removeEmptyDirectory };

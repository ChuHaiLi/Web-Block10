const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');

function createCleanupQueue({ scratch, objectStore })
{
    async function deleteTarget(key)
    {
        if (key.startsWith('tmp/')) return scratch.deleteKey(key);
        await objectStore.delete(key);
        return true;
    }

    async function enqueue(key, reason)
    {
        const record = { key, reason, at: new Date().toISOString() };
        const name = 'cleanup-queue/' + Date.now() + '-' + randomBytes(6).toString('hex');
        const temporary = name + '.tmp';

        try
        {
            await scratch.writeFile(temporary, JSON.stringify(record));
            await fs.rename(scratch.keyToPath(temporary), scratch.keyToPath(name + '.json'));
            return true;
        }
        catch (error)
        {
            console.error('Không ghi được hàng đợi dọn cho ' + key, error);
            return false;
        }
    }

    async function deleteOrEnqueue(key, reason)
    {
        try
        {
            await deleteTarget(key);
            return true;
        }
        catch (error)
        {
            if (error.code === 'ENOENT') return true;
            return enqueue(key, reason);
        }
    }

    return { enqueue, deleteTarget, deleteOrEnqueue };
}

module.exports = { createCleanupQueue };

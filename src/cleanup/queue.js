const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');

function createCleanupQueue(storage)
{
    async function enqueue(key, reason)
    {
        const record = { key, reason, at: new Date().toISOString() };
        const name = 'cleanup-queue/' + Date.now() + '-' + randomBytes(6).toString('hex');
        const temporary = name + '.tmp';

        try
        {
            await storage.writeFile(temporary, JSON.stringify(record));
            await fs.rename(storage.keyToPath(temporary), storage.keyToPath(name + '.json'));
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
            await storage.deleteKey(key);
            return true;
        }
        catch (error)
        {
            if (error.code === 'ENOENT') return true;
            return enqueue(key, reason);
        }
    }

    return { enqueue, deleteOrEnqueue };
}

module.exports = { createCleanupQueue };

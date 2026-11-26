const fs = require('node:fs/promises');
const path = require('node:path');
const { originalKeyPattern, retryWindowsFs, unlinkIfPresent, removeEmptyDirectory } = require('../storage');

const ONE_HOUR_MS = 60 * 60 * 1000;
const photoIdPattern = /^[A-Za-z0-9_-]{12}$/;
const versionPattern = /^v\d+$/;
const maxDatabaseVersion = 2_147_483_647;

async function attempt(operation, location)
{
    try
    {
        return await operation();
    }
    catch (error)
    {
        if (error.code !== 'ENOENT') console.error('Lỗi dọn ' + location, error);
        return undefined;
    }
}

function listEntries(directory)
{
    return attempt(() => fs.readdir(directory, { withFileTypes: true }), directory);
}

async function removeFile(filePath)
{
    const removed = await attempt(() => unlinkIfPresent(filePath), filePath);
    return removed ? 1 : 0;
}

async function removeVersion(directory)
{
    const entries = await listEntries(directory);
    if (!entries) return 0;

    let removed = 0;
    for (const entry of entries)
    {
        const child = path.join(directory, entry.name);
        removed += entry.isDirectory() ? await removeVersion(child) : await removeFile(child);
    }
    await attempt(() => removeEmptyDirectory(directory), directory);
    return removed;
}

async function removeOldFiles(directory, cutoff, matches)
{
    let removed = 0;
    for (const entry of await listEntries(directory) ?? [])
    {
        if (!entry.isFile() || !matches(entry.name)) continue;
        const filePath = path.join(directory, entry.name);
        const stat = await attempt(() => fs.lstat(filePath), filePath);
        if (stat?.isFile() && stat.mtimeMs < cutoff) removed += await removeFile(filePath);
    }
    return removed;
}

async function moveBadRecord(recordPath, error)
{
    const badPath = recordPath.slice(0, -'.json'.length) + '.bad';
    const renamed = await attempt(async () =>
    {
        await retryWindowsFs(() => fs.rename(recordPath, badPath));
        return true;
    }, recordPath);
    if (renamed) console.error('Bản ghi dọn không hợp lệ ' + recordPath, error);
}

async function cleanQueue(storage, cutoff)
{
    const directory = path.join(storage.root, 'cleanup-queue');
    let queueFilesRemoved = 0;
    let queueRecordsRemoved = 0;

    for (const entry of await listEntries(directory) ?? [])
    {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const recordPath = path.join(directory, entry.name);
        const contents = await attempt(() => retryWindowsFs(() => fs.readFile(recordPath, 'utf8')), recordPath);
        if (contents === undefined) continue;

        let key;
        try
        {
            key = JSON.parse(contents)?.key;
            if (typeof key !== 'string' || !/^(?:photos|originals|tmp)\//.test(key))
            {
                throw new Error('Invalid cleanup target');
            }
            storage.keyToPath(key);
        }
        catch (error)
        {
            await moveBadRecord(recordPath, error);
            continue;
        }

        try
        {
            if (await storage.deleteKey(key)) queueFilesRemoved++;
        }
        catch (error)
        {
            if (error.code !== 'ENOENT')
            {
                console.error('Không xóa được ' + key + ' từ ' + recordPath, error);
                continue;
            }
        }

        queueRecordsRemoved += await removeFile(recordPath);
    }

    const queueTemporaryFilesRemoved = await removeOldFiles(directory, cutoff, name => name.endsWith('.tmp'));
    return { queueFilesRemoved, queueRecordsRemoved, queueTemporaryFilesRemoved };
}

async function cleanOrphanVersions(prisma, storage, cutoff)
{
    const directory = path.join(storage.root, 'photos');
    let removed = 0;
    for (const photoEntry of await listEntries(directory) ?? [])
    {
        if (!photoEntry.isDirectory() || photoEntry.name.length !== 12 || !photoIdPattern.test(photoEntry.name)) continue;
        const photoId = photoEntry.name;
        const photoPath = path.join(directory, photoId);
        for (const entry of await listEntries(photoPath) ?? [])
        {
            if (!entry.isDirectory() || entry.name !== entry.name.trim() || !versionPattern.test(entry.name)) continue;
            const versionPath = path.join(photoPath, entry.name);
            const stat = await attempt(() => fs.lstat(versionPath), versionPath);
            if (!stat?.isDirectory() || stat.mtimeMs >= cutoff) continue;

            const version = Number(entry.name.slice(1));
            const registered = version <= maxDatabaseVersion && await prisma.photoVersion.findUnique({
                where: { photoId_version: { photoId, version } },
                select: { version: true }
            });
            if (registered) continue;

            removed += await removeVersion(versionPath);
            await attempt(() => removeEmptyDirectory(photoPath), photoPath);
        }
    }
    return removed;
}

async function cleanOrphanOriginals(prisma, storage, cutoff)
{
    const directory = path.join(storage.root, 'originals');
    let removed = 0;
    for (const entry of await listEntries(directory) ?? [])
    {
        const key = 'originals/' + entry.name;
        if (!entry.isFile() || key !== key.trim() || !originalKeyPattern.test(key)) continue;
        const filePath = storage.keyToPath(key);
        const stat = await attempt(() => fs.lstat(filePath), filePath);
        if (!stat?.isFile() || stat.mtimeMs >= cutoff) continue;

        const id = path.basename(entry.name, '.png');
        const registered = await prisma.photo.findUnique({ where: { id }, select: { id: true } });
        if (!registered) removed += await removeFile(filePath);
    }
    return removed;
}

async function runCleanup({ prisma, storage })
{
    const cutoff = Date.now() - ONE_HOUR_MS;
    const queue = await cleanQueue(storage, cutoff);
    const summary = {
        ...queue,
        temporaryFilesRemoved: await removeOldFiles(path.join(storage.root, 'tmp'), cutoff, () => true),
        orphanVersionFilesRemoved: await cleanOrphanVersions(prisma, storage, cutoff),
        orphanOriginalFilesRemoved: await cleanOrphanOriginals(prisma, storage, cutoff)
    };
    console.log('Cleanup ' + JSON.stringify(summary));
    return summary;
}

module.exports = { runCleanup };

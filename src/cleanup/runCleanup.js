const fs = require('node:fs/promises');
const path = require('node:path');
const { retryWindowsFs, unlinkIfPresent } = require('../storage/filesystem');
const { isObjectKey } = require('../storage/objectStore');
const { createCleanupQueue } = require('./queue');
const { purgePhoto } = require('./purgePhoto');

const ONE_HOUR_MS = 60 * 60 * 1000;
const BATCH_SIZE = 500;

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

async function cleanQueue(scratch, objectStore, cutoff)
{
    const directory = path.join(scratch.root, 'cleanup-queue');
    const queue = createCleanupQueue({ scratch, objectStore });
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
            if (typeof key === 'string' && key.startsWith('tmp/')) scratch.keyToPath(key);
            else if (!isObjectKey(key)) throw new Error('Invalid cleanup target');
        }
        catch (error)
        {
            await moveBadRecord(recordPath, error);
            continue;
        }

        try
        {
            if (await queue.deleteTarget(key)) queueFilesRemoved++;
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

async function cleanDeletingPhotos(prisma, objectStore)
{
    const photos = await prisma.photo.findMany({ where: { status: 'DELETING' }, select: { id: true } });
    let removed = 0;
    for (const { id } of photos)
    {
        removed += await attempt(() => purgePhoto({ prisma, objectStore, id }), id) ?? 0;
    }
    return removed;
}

async function cleanSupersededVersions(prisma, objectStore, cutoff)
{
    const versions = await prisma.photoVersion.findMany({
        where: { supersededAt: { lt: cutoff }, purgedAt: null },
        select: {
            photoId: true,
            version: true,
            photo: { select: { currentVersion: true } },
            variants: { select: { storageKey: true } }
        }
    });
    let removed = 0;
    for (const { photoId, version, photo, variants } of versions)
    {
        // Edits and restores select new versions, so a superseded version cannot become current again.
        if (version === photo.currentVersion) continue;

        let failed = false;
        for (const { storageKey } of variants)
        {
            try
            {
                await objectStore.delete(storageKey);
                removed++;
            }
            catch (error)
            {
                failed = true;
                console.error('Không xóa được variant hết hạn ' + storageKey, error);
            }
        }
        if (!failed)
        {
            await prisma.photoVersion.updateMany({
                where: { photoId, version, purgedAt: null },
                data: { purgedAt: new Date() }
            });
        }
    }
    return removed;
}

async function deleteOrphan(objectStore, key)
{
    try
    {
        await objectStore.delete(key);
        return 1;
    }
    catch (error)
    {
        console.error('Không xóa được object mồ côi ' + key, error);
        return 0;
    }
}

function* idBatches(ids)
{
    const unique = Array.from(new Set(ids));
    for (let i = 0; i < unique.length; i += BATCH_SIZE) yield unique.slice(i, i + BATCH_SIZE);
}

async function cleanOrphanVersions(prisma, objectStore, cutoff)
{
    const groups = new Map();
    for await (const { key, lastModified } of objectStore.list('photos/'))
    {
        const [, photoId, versionDir] = key.split('/');
        const prefix = photoId + '/' + versionDir;
        if (!groups.has(prefix))
        {
            groups.set(prefix, { photoId, version: Number(versionDir.slice(1)), keys: [], old: true });
        }
        const group = groups.get(prefix);
        group.keys.push(key);
        group.old &&= lastModified.getTime() < cutoff;
    }

    const candidates = [...groups.values()].filter(group => group.old);
    const registered = new Set();
    for (const ids of idBatches(candidates.map(group => group.photoId)))
    {
        const versions = await prisma.photoVersion.findMany({
            where: { photoId: { in: ids } },
            select: { photoId: true, version: true }
        });
        for (const { photoId, version } of versions) registered.add(photoId + '/' + version);
    }

    let removed = 0;
    for (const { photoId, version, keys } of candidates)
    {
        if (registered.has(photoId + '/' + version)) continue;
        for (const key of keys) removed += await deleteOrphan(objectStore, key);
    }
    return removed;
}

async function cleanOrphanOriginals(prisma, objectStore, cutoff)
{
    const candidates = new Map();
    for await (const { key, lastModified } of objectStore.list('originals/'))
    {
        if (lastModified.getTime() < cutoff) candidates.set(key.slice('originals/'.length, -'.png'.length), key);
    }

    let removed = 0;
    for (const ids of idBatches(candidates.keys()))
    {
        const photos = await prisma.photo.findMany({ where: { id: { in: ids } }, select: { id: true } });
        const registered = new Set(photos.map(photo => photo.id));
        for (const id of ids)
        {
            if (!registered.has(id)) removed += await deleteOrphan(objectStore, candidates.get(id));
        }
    }
    return removed;
}

async function runCleanup({ prisma, objectStore, scratch, versionRetentionHours = 24, now = Date.now() })
{
    const cutoff = now - ONE_HOUR_MS;
    const retentionCutoff = new Date(now - versionRetentionHours * ONE_HOUR_MS);
    const queue = await cleanQueue(scratch, objectStore, cutoff);
    const summary = {
        ...queue,
        temporaryFilesRemoved: await removeOldFiles(path.join(scratch.root, 'tmp'), cutoff, () => true),
        deletedPhotoFilesRemoved: await cleanDeletingPhotos(prisma, objectStore),
        supersededVersionFilesRemoved: await cleanSupersededVersions(prisma, objectStore, retentionCutoff),
        orphanVersionFilesRemoved: await cleanOrphanVersions(prisma, objectStore, cutoff),
        orphanOriginalFilesRemoved: await cleanOrphanOriginals(prisma, objectStore, cutoff),
        expiredSessionsRemoved: (await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date(now) } } })).count
    };
    console.log('Cleanup ' + JSON.stringify(summary));
    return summary;
}

module.exports = { runCleanup };

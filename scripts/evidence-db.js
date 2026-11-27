const { loadConfig } = require('../src/config');
const { createDb } = require('../src/db');
const { createObjectStore } = require('../src/storage/objectStore');

function getPhotoId(args)
{
    if (args.length === 0) return undefined;
    if (args.length === 2 && args[0] === '--photo' && /^[A-Za-z0-9_-]{12}$/.test(args[1]) && args[1].length === 12)
    {
        return args[1];
    }
    throw new Error('Cách dùng: npm run evidence:db [-- --photo <id>]');
}

async function listObjects(objectStore, photoId)
{
    const objects = [];
    const prefixes = photoId
        ? ['photos/' + photoId + '/', 'originals/' + photoId + '.png']
        : ['photos/', 'originals/'];
    for (const prefix of prefixes)
    {
        for await (const object of objectStore.list(prefix)) objects.push(object);
    }
    return objects.sort((a, b) => a.key.localeCompare(b.key));
}

async function evidence()
{
    const photoId = getPhotoId(process.argv.slice(2));
    const config = loadConfig();
    const objectStore = createObjectStore(config);
    const prisma = createDb(config.databaseUrl);

    try
    {
        const [photos, variants] = await prisma.$transaction([
            prisma.photo.findMany({
                where: photoId ? { id: photoId } : undefined,
                orderBy: { id: 'asc' },
                select: { id: true, title: true, status: true, currentVersion: true }
            }),
            prisma.photoVariant.findMany({
                where: photoId ? { photoId } : undefined,
                orderBy: [{ photoId: 'asc' }, { version: 'asc' }, { width: 'asc' }],
                select: { photoId: true, version: true, width: true, height: true, bytes: true, storageKey: true }
            })
        ], { isolationLevel: 'RepeatableRead' });
        const objects = await listObjects(objectStore, photoId);

        console.log('Photo');
        console.table(photos);
        console.log('PhotoVariant');
        console.table(variants.map(({ photoId, version, width, height, bytes, storageKey }) => ({
            photoId, version, 'width×height': width + '×' + height, bytes, storageKey
        })));
        console.log('Object store', objectStore.describe());
        if (objects.length) console.table(objects.map(object => ({ ...object, lastModified: object.lastModified.toISOString() })));
        else console.log('(trống)');
    }
    finally
    {
        await prisma.$disconnect();
    }
}

evidence().catch(error =>
{
    console.error(error.message);
    process.exitCode = 1;
});

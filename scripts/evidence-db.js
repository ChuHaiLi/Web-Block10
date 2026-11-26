const fs = require('node:fs/promises');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { createDb } = require('../src/db');

function getPhotoId(args)
{
    if (args.length === 0) return undefined;
    if (args.length === 2 && args[0] === '--photo' && /^[A-Za-z0-9_-]{12}$/.test(args[1]) && args[1].length === 12)
    {
        return args[1];
    }
    throw new Error('Cách dùng: npm run evidence:db [-- --photo <id>]');
}

async function listFiles(root, prefix = '', files = [])
{
    let entries;
    try
    {
        entries = await fs.readdir(path.join(root, prefix), { withFileTypes: true });
    }
    catch (error)
    {
        if (error.code === 'ENOENT') return files;
        throw error;
    }

    for (const entry of entries)
    {
        const key = path.posix.join(prefix, entry.name);
        if (entry.isDirectory()) await listFiles(root, key, files);
        else if (entry.isFile()) files.push(key);
    }
    return files;
}

async function evidence()
{
    const photoId = getPhotoId(process.argv.slice(2));
    const config = loadConfig();
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
        const files = (await listFiles(config.uploadRoot)).sort();
        const selected = photoId ? files.filter(key => key === 'originals/' + photoId + '.png' ||
            key.startsWith('photos/' + photoId + '/')) : files;

        console.log('Photo');
        console.table(photos);
        console.log('PhotoVariant');
        console.table(variants.map(({ photoId, version, width, height, bytes, storageKey }) => ({
            photoId, version, 'width×height': width + '×' + height, bytes, storageKey
        })));
        console.log('File trong UPLOAD_ROOT');
        console.log(selected.length ? selected.join('\n') : '(trống)');
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

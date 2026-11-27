const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const supertest = require('supertest');
const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { createDb } = require('../src/db');
const { createObjectStore } = require('../src/storage/objectStore');
const { createScratch } = require('../src/storage/scratch');

function requireTestDatabase(databaseUrl)
{
    const database = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    if (process.env.NODE_ENV !== 'test' || !database.includes('test'))
    {
        throw new Error('Reset requires NODE_ENV=test and a database name containing test');
    }
}

async function prepareStorage(t, { storageDriver = 'local' } = {})
{
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'block10-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const config = { storageDriver, uploadRoot: path.join(root, 'objects') };
    const reopenObjectStore = () => createObjectStore(config);
    const objectStore = reopenObjectStore();
    const scratch = createScratch(path.join(root, 'scratch'));
    await objectStore.ensureReady();
    await scratch.initialize();

    async function listObjectKeys(prefix = '')
    {
        const keys = [];
        for await (const { key } of objectStore.list(prefix)) keys.push(key);
        return keys.sort();
    }

    const readObject = key => objectStore.getBuffer(key);

    async function objectExists(key)
    {
        try
        {
            const { body } = await objectStore.getStream(key);
            body.destroy();
            return true;
        }
        catch (error)
        {
            if (error.code === 'NOT_FOUND') return false;
            throw error;
        }
    }

    return { objectStore, scratch, listObjectKeys, readObject, objectExists, reopenObjectStore };
}

async function prepareTest(t, { faultInject } = {})
{
    process.env.NODE_ENV = 'test';
    const { databaseUrl, storageDriver } = loadConfig({ storageDriver: process.env.STORAGE_DRIVER });
    requireTestDatabase(databaseUrl);
    const prisma = createDb(databaseUrl);
    const stores = await prepareStorage(t, { storageDriver });

    async function resetDb()
    {
        requireTestDatabase(databaseUrl);
        await prisma.$transaction([
            prisma.photoVariant.deleteMany(),
            prisma.photoVersion.deleteMany(),
            prisma.photo.deleteMany()
        ]);
    }

    t.after(async () =>
    {
        try
        {
            await resetDb();
        }
        finally
        {
            await prisma.$disconnect();
        }
    });

    await resetDb();
    const app = createApp({ prisma, ...stores, faultInject });
    const request = supertest(app);

    function uploadFiles(files, { alt = index => `Ảnh kiểm thử ${index}` } = {})
    {
        const upload = request.post('/api/uploads');
        files.forEach(({ title, altText }, index) =>
        {
            if (title !== undefined) upload.field(`title_${index}`, title);
            const description = altText === undefined ? (typeof alt === 'function' ? alt(index) : alt) : altText;
            if (description !== null) upload.field(`alt_${index}`, description);
        });
        files.forEach(({ filename }) => upload.attach('photos', path.join(__dirname, 'fixtures', filename)));
        return upload;
    }

    return { prisma, ...stores, app, request, uploadFiles, resetDb };
}

module.exports = { prepareStorage, prepareTest };

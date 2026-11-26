const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const supertest = require('supertest');
const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { createDb } = require('../src/db');
const { createStorage } = require('../src/storage');

function requireTestDatabase(databaseUrl)
{
    const database = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    if (process.env.NODE_ENV !== 'test' || !database.includes('test'))
    {
        throw new Error('Reset requires NODE_ENV=test and a database name containing test');
    }
}

async function prepareTest(t, { faultInject } = {})
{
    process.env.NODE_ENV = 'test';
    const config = loadConfig();
    const { databaseUrl } = config;
    requireTestDatabase(databaseUrl);
    const prisma = createDb(databaseUrl);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'block10-'));
    const storage = createStorage(root);

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
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    await storage.initialize();
    await resetDb();
    const app = createApp({ prisma, storage, faultInject: faultInject ?? config.faultInject });
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

    return { prisma, storage, app, request, uploadFiles, resetDb };
}

module.exports = { prepareTest };

const fs = require('node:fs/promises');
const { randomBytes } = require('node:crypto');
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

function makeStorageConfig(storageDriver, root)
{
    const uploadRoot = path.join(root, 'objects');
    if (storageDriver === 'local') return { storageDriver, uploadRoot };

    const { s3 } = loadConfig({ nodeEnv: 'test', storageDriver, uploadRoot });
    if (s3.bucket.length > 54) throw new Error('S3_BUCKET của bộ test phải chừa 9 ký tự cho hậu tố ngẫu nhiên');
    return { storageDriver, uploadRoot, s3: { ...s3, bucket: s3.bucket + '-' + randomBytes(4).toString('hex') } };
}

async function prepareS3Bucket(t, config, reopenObjectStore)
{
    const { HeadBucketCommand, DeleteBucketCommand } = require('@aws-sdk/client-s3');
    const { createS3Client } = require('../src/storage/s3');
    const { bucket } = config.s3;
    const client = createS3Client(config.s3);
    t.after(() => client.destroy());
    try
    {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
    }
    catch (error)
    {
        if (error.$metadata?.httpStatusCode !== 404)
        {
            throw new Error('Không truy cập được SeaweedFS. Chạy: npm run storage:up và kiểm tra .env.test.');
        }

        await reopenObjectStore().ensureReady();
        // Use another instance so mocks in a test do not affect teardown.
        t.after(async () =>
        {
            const store = reopenObjectStore();
            const keys = [];
            for await (const { key } of store.list('')) keys.push(key);
            for (const key of keys) await store.delete(key);
            const cleanupClient = createS3Client(config.s3);
            try
            {
                await cleanupClient.send(new DeleteBucketCommand({ Bucket: bucket }));
            }
            catch
            {
                throw new Error('Không xóa được bucket kiểm thử đã tạo');
            }
            finally
            {
                cleanupClient.destroy();
            }
        });
        return;
    }
    throw new Error('Bucket kiểm thử ngẫu nhiên đã tồn tại');
}

async function prepareStorage(t, { storageDriver = 'local' } = {})
{
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'block10-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const config = makeStorageConfig(storageDriver, root);
    const reopenObjectStore = () => createObjectStore(config);
    const objectStore = reopenObjectStore();
    const scratch = createScratch(path.join(root, 'scratch'));
    if (storageDriver === 's3') await prepareS3Bucket(t, config, reopenObjectStore);
    else await objectStore.ensureReady();
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

const testHost = 'gallery.test';
const testPassword = 'test-password-47';

function withOrigin(request)
{
    for (const method of ['post', 'put', 'patch', 'delete', 'options'])
    {
        const send = request[method].bind(request);
        request[method] = (...args) => send(...args).set('Host', testHost).set('Origin', 'http://' + testHost);
    }
    return request;
}

async function registerAndLogin(app, { username = 'test-user' } = {})
{
    const agent = withOrigin(supertest.agent(app));
    await agent.post('/register').type('form').send({ username, password: testPassword, passwordConfirm: testPassword }).expect(303);
    return agent;
}

async function gallerySessionCookie(agent)
{
    const page = await agent.get('/').expect(200);
    const cookie = page.headers['set-cookie']?.find(value => value.startsWith('gallery.sid='));
    if (!cookie) throw new Error('Authenticated agent did not receive a gallery session cookie');
    return cookie.split(';', 1)[0];
}

async function prepareTest(t, { faultInject, authenticated = true, now } = {})
{
    process.env.NODE_ENV = 'test';
    const { databaseUrl, storageDriver, sessionSecret, cookieSecure } = loadConfig({ storageDriver: process.env.STORAGE_DRIVER });
    requireTestDatabase(databaseUrl);
    const prisma = createDb(databaseUrl);
    const stores = await prepareStorage(t, { storageDriver });

    async function resetDb()
    {
        requireTestDatabase(databaseUrl);
        await prisma.$transaction([
            prisma.photoVariant.deleteMany(),
            prisma.photoVersion.deleteMany(),
            prisma.photo.deleteMany(),
            prisma.session.deleteMany(),
            prisma.user.deleteMany()
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
    const authOptions = { sessionSecret, cookieSecure, now };
    const app = createApp({ prisma, ...stores, faultInject, ...authOptions });
    const guest = withOrigin(supertest(app));
    const request = authenticated ? await registerAndLogin(app) : guest;

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

    return { prisma, ...stores, app, request, guest, authOptions, uploadFiles, resetDb };
}

module.exports = { prepareStorage, prepareTest, registerAndLogin, gallerySessionCookie, withOrigin, testHost, testPassword };

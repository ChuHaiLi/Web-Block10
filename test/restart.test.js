const assert = require('node:assert/strict');
const { once } = require('node:events');
const path = require('node:path');
const { test } = require('node:test');
const supertest = require('supertest');
const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { createDb } = require('../src/db');
const { createScratch } = require('../src/storage/scratch');
const { prepareTest } = require('./helpers');

async function listen(app)
{
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return server;
}

function close(server)
{
    return new Promise((resolve, reject) =>
    {
        server.close(error => error ? reject(error) : resolve());
    });
}

test('restart tạo app mới với cùng DB và object store nhưng kho nháp mới, gallery và media vẫn 200', async t =>
{
    const { app, prisma, scratch, objectStore, reopenObjectStore } = await prepareTest(t);
    const first = await listen(app);
    let photo;
    let savedMedia;

    try
    {
        const request = supertest(first);
        const { body } = await request.post('/api/uploads')
            .field('title_0', 'Ảnh giữ sau restart')
            .field('alt_0', 'Ảnh kiểm thử restart')
            .attach('photos', path.join(__dirname, 'fixtures', 'photo.png'))
            .expect(200);
        assert.equal(body.results[0].ok, true);
        photo = body.results[0].photo;
        const before = await request.get('/').expect(200);
        assert.ok(before.text.includes('id="photo-' + photo.id + '"'));

        const media = await request.get(photo.variants[0].url).expect('Content-Type', 'image/webp').expect(200);
        assert.ok(Buffer.isBuffer(media.body) && media.body.length > 0);
        savedMedia = media.body;
    }
    finally
    {
        await close(first);
        await prisma.$disconnect();
    }

    const restartedPrisma = createDb(loadConfig().databaseUrl);
    const restartedScratch = createScratch(path.join(scratch.root, 'restart'));
    await restartedScratch.initialize();
    const restartedStore = reopenObjectStore();
    assert.notEqual(restartedStore, objectStore);
    assert.deepEqual(restartedStore.describe(), objectStore.describe());
    const restartedApp = createApp({
        prisma: restartedPrisma, objectStore: restartedStore, scratch: restartedScratch
    });
    assert.notEqual(restartedApp, app);
    const second = await listen(restartedApp);
    try
    {
        const request = supertest(second);
        const gallery = await request.get('/').expect(200);
        assert.ok(gallery.text.includes('id="photo-' + photo.id + '"'));
        assert.ok(gallery.text.includes(photo.variants[0].url));
        assert.match(gallery.text, /Ảnh giữ sau restart/);
        const media = await request.get(photo.variants[0].url)
            .expect('Content-Type', 'image/webp')
            .expect('Cache-Control', 'public, max-age=31536000, immutable')
            .expect(200);
        assert.deepEqual(media.body, savedMedia);
    }
    finally
    {
        await close(second);
        await restartedPrisma.$disconnect();
    }
});

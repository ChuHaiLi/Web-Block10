const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { test } = require('node:test');
const { prepareTest } = require('./helpers');

test('media GET gửi đúng WebP, header và bytes trên đĩa', async t =>
{
    const { request, storage, uploadFiles } = await prepareTest(t);
    const upload = await uploadFiles([{ filename: 'photo.png' }]).expect(200);
    const [result] = upload.body.results;
    assert.equal(result.ok, true, JSON.stringify(result));

    const { url } = result.photo.variants[0];
    const media = await request.get(url)
        .expect(200)
        .expect('Content-Type', 'image/webp')
        .expect('Cache-Control', 'public, max-age=31536000, immutable')
        .expect('X-Content-Type-Options', 'nosniff');
    assert.deepEqual(media.body, await fs.readFile(storage.keyToPath(url.slice('/media/'.length))));
});

test('media GET trả 404 với key sai, file riêng, file mồ côi hoặc ảnh bị ẩn', async t =>
{
    const { prisma, request, storage, uploadFiles } = await prepareTest(t);
    const upload = await uploadFiles([{ filename: 'photo.png' }]).expect(200);
    const [result] = upload.body.results;
    assert.equal(result.ok, true, JSON.stringify(result));

    const { id, variants } = result.photo;
    const { url } = variants[0];
    const key = url.slice('/media/'.length);
    const orphan = 'photos/' + id + '/v1/321.webp';
    await storage.writeFile(orphan, await fs.readFile(storage.keyToPath(key)));

    await request.get('/media/photos/invalid/v1/320.webp').expect(404);
    await request.get('/media/%zz').expect(404);
    await request.get('/media/%2e%2e%2foriginals%2f' + id + '.png').expect(404);
    await request.get('/media/originals/' + id + '.png').expect(404);
    await request.get('/media/' + orphan).expect(404);

    await prisma.photoVersion.update({ where: { photoId_version: { photoId: id, version: 1 } }, data: { purgedAt: new Date() } });
    await request.get(url).expect(404);
    await prisma.photoVersion.update({ where: { photoId_version: { photoId: id, version: 1 } }, data: { purgedAt: null } });

    await prisma.photo.update({ where: { id }, data: { status: 'DELETING' } });
    await request.get(url).expect(404);
    await prisma.photo.update({ where: { id }, data: { status: 'PUBLISHED' } });

    await storage.deleteKey(key);
    const missing = await request.get(url).expect(404);
    assert.equal(missing.headers['cache-control'], undefined);
});

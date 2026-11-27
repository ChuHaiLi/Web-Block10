const assert = require('node:assert/strict');
const { test } = require('node:test');
const sharp = require('sharp');
const renderer = require('../src/edit/renderEdits');
const { validateEdits } = require('../src/edit/validateEdits');
const { prepareTest } = require('./helpers');

const photo = { originalWidth: 400, originalHeight: 300 };
const base = { baseVersion: 1, rotate: 0, flipH: false, crop: null };

test('edit.validate kiểm tra kiểu, biên crop sau xoay và baseVersion kể cả khi restore', () =>
{
    for (const invalid of [
        null, {}, { ...base, baseVersion: 0 }, { ...base, baseVersion: 1.5 }, { ...base, baseVersion: '1' },
        { ...base, rotate: 45 }, { ...base, rotate: '90' }, { ...base, flipH: 'true' },
        { ...base, crop: undefined }, { ...base, crop: [] }, { ...base, crop: { x: 0, y: 0, width: 0, height: 10 } },
        { ...base, crop: { x: -1, y: 0, width: 10, height: 10 } },
        { ...base, crop: { x: 0, y: 0.5, width: 10, height: 10 } },
        { ...base, crop: { x: 0, y: 0, width: '10', height: 10 } },
        { ...base, rotate: 90, crop: { x: 295, y: 0, width: 6, height: 10 } },
        { ...base, crop: { x: 0, y: 299, width: 10, height: 2 } },
        { restore: true }, { restore: true, baseVersion: 0 }
    ])
    {
        assert.throws(() => validateEdits(invalid, photo), { code: 'INVALID_EDITS' });
    }

    const crop = { x: 295, y: 399, width: 5, height: 1 };
    assert.deepEqual(validateEdits({ ...base, rotate: 270, flipH: true, crop }, photo),
        { baseVersion: 1, edits: { rotate: 270, flipH: true, crop }, variantWidths: [5] });
    assert.deepEqual(validateEdits({ baseVersion: 4, restore: true, rotate: 45, flipH: 'true', crop: [] }, photo),
        { baseVersion: 4, edits: { rotate: 0, flipH: false, crop: null }, variantWidths: [320, 400] });

    const legalStrip = { x: 0, y: 0, width: 1, height: 16_383 };
    const wide = { originalWidth: 20_000, originalHeight: 400 };
    assert.deepEqual(validateEdits({ ...base, rotate: 90, crop: legalStrip }, wide).variantWidths, [1]);
});

test('edit.validate API trả 400 INVALID_EDITS và giữ nguyên ảnh khi payload sai', async t =>
{
    const { prisma, request, scratch, uploadFiles } = await prepareTest(t);
    const { body } = await uploadFiles([{ filename: 'corners.png' }]).expect(200);
    assert.equal(body.results[0].ok, true);
    const { id } = body.results[0].photo;
    const url = '/api/photos/' + id + '/edits';

    for (const invalid of [
        { ...base, rotate: 45 }, { ...base, flipH: 'true' },
        { ...base, rotate: 90, crop: { x: 0, y: 0, width: 301, height: 20 } }, { restore: true }
    ])
    {
        const response = await request.post(url).send(invalid).expect(400);
        assert.equal(response.body.error.code, 'INVALID_EDITS');
    }
    const malformed = await request.post(url).set('Content-Type', 'application/json').send('{').expect(400);
    assert.equal(malformed.body.error.code, 'INVALID_EDITS');

    const stored = await prisma.photo.findUniqueOrThrow({ where: { id }, include: { versions: true } });
    assert.equal(stored.currentVersion, 1);
    assert.equal(stored.nextVersion, 2);
    assert.equal(stored.versions.length, 1);
    assert.equal(stored.versions[0].supersededAt, null);
    assert.deepEqual(await scratch.listDir('cleanup-queue'), []);
    await request.get('/photos/' + id).expect(200);
});

test('edit.validate API và preview trả 404 cho ảnh thiếu hoặc không PUBLISHED', async t =>
{
    const { prisma, request, uploadFiles } = await prepareTest(t);
    const { body } = await uploadFiles([{ filename: 'corners.png' }]).expect(200);
    assert.equal(body.results[0].ok, true);
    const { id } = body.results[0].photo;

    async function expectMissing(photoId)
    {
        const response = await request.post('/api/photos/' + photoId + '/edits').send(base).expect(404);
        assert.equal(response.body.error.code, 'NOT_FOUND');
        await request.get('/photos/' + photoId + '/edit/source').expect(404);
    }

    await expectMissing('aaaaaaaaaaaa');
    for (const status of ['DELETING', 'PURGED'])
    {
        await prisma.photo.update({ where: { id }, data: { status } });
        await expectMissing(id);
    }
    const stored = await prisma.photo.findUniqueOrThrow({ where: { id } });
    assert.equal(stored.nextVersion, 2);
});

test('edit.validate variant quá cao trả 400 trước khi cấp version hoặc render', async t =>
{
    const { prisma, request, listObjectKeys } = await prepareTest(t);
    const png = await sharp({ create: { width: 20_000, height: 400, channels: 3, background: '#6495ed' } })
        .png().toBuffer();
    const { body } = await request.post('/api/uploads')
        .field('alt_0', 'Ảnh kiểm thử kích thước WebP')
        .attach('photos', png, { filename: 'wide.png', contentType: 'image/png' })
        .expect(200);
    assert.equal(body.results[0].ok, true, JSON.stringify(body));
    const { id } = body.results[0].photo;
    const before = await prisma.photo.findUniqueOrThrow({ where: { id } });
    const render = t.mock.method(renderer, 'renderEdits', async () => assert.fail('Ảnh không hợp lệ đã vào render'));

    for (const edits of [
        { ...base, rotate: 90 },
        { ...base, rotate: 90, crop: { x: 20, y: 50, width: 1, height: 17_000 } }
    ])
    {
        const response = await request.post('/api/photos/' + id + '/edits').send(edits).expect(400);
        assert.equal(response.body.error.code, 'UNSUPPORTED_DIMENSIONS');
        assert.match(response.body.error.message, /WebP.*16\.383 px/);
    }

    const after = await prisma.photo.findUniqueOrThrow({ where: { id } });
    assert.equal(after.currentVersion, before.currentVersion);
    assert.equal(after.nextVersion, before.nextVersion);
    assert.equal(render.mock.callCount(), 0);
    assert.equal(await prisma.photoVersion.count({ where: { photoId: id } }), 1);
    assert.deepEqual(await listObjectKeys('photos/' + id + '/'), body.results[0].photo.variants.map(variant => variant.url.slice('/media/'.length)).sort());
});

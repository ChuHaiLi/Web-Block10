const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { prepareTest } = require('./helpers');

test('upload.mixed chỉ công bố ảnh hợp lệ và giữ index của từng kết quả', async t =>
{
    const { prisma, storage, uploadFiles } = await prepareTest(t);
    const response = await uploadFiles([
        { filename: 'photo.jpg', altText: '  Ảnh JPEG hợp lệ  ' },
        { filename: 'fake.jpg' },
        { filename: 'truncated.jpg' },
        { filename: 'photo.png', altText: null }
    ]).expect(200);
    const results = response.body.results;
    assert.deepEqual(results.map(({ index, ok, error }) => [index, ok, error?.code]), [
        [0, true, undefined],
        [1, false, 'NOT_IMAGE'],
        [2, false, 'CORRUPT'],
        [3, false, 'ALT_REQUIRED']
    ]);

    const id = results[0].photo.id;
    const photos = await prisma.photo.findMany({ include: { variants: true } });
    assert.equal(photos.length, 1);
    assert.equal(photos[0].id, id);
    assert.equal(photos[0].title, 'photo');
    assert.equal(photos[0].alt, 'Ảnh JPEG hợp lệ');
    assert.equal(photos[0].variants.length, 3);
    assert.equal(await prisma.photoVersion.count(), 1);
    assert.deepEqual(await storage.listDir('photos'), [id]);
    assert.deepEqual(await storage.listDir('originals'), [id + '.png']);
    assert.deepEqual(await storage.listDir('tmp'), []);
});

test('upload.mixed kiểm tra độ dài field và xác định định dạng theo bytes', async t =>
{
    const { prisma, request, storage } = await prepareTest(t);
    const file = path.join(__dirname, 'fixtures', 'small.png');
    const response = await request.post('/api/uploads')
        .field('title_0', 't'.repeat(121)).field('alt_0', 'Ảnh kiểm thử 0')
        .field('alt_1', 'a'.repeat(251))
        .field('alt_2', ' '.repeat(4096) + 'a')
        .field('alt_3', '   ')
        .field('title_4', '  ').field('alt_4', '  Ảnh kiểm thử 4  ')
        .attach('photos', file).attach('photos', file).attach('photos', file).attach('photos', file)
        .attach('photos', file, { filename: 'Ảnh.txt', contentType: 'text/plain' })
        .expect(200);

    assert.deepEqual(response.body.results.map(({ index, error }) => [index, error?.code]), [
        [0, 'INVALID_FIELD'], [1, 'INVALID_FIELD'], [2, 'INVALID_FIELD'], [3, 'ALT_REQUIRED'], [4, undefined]
    ]);
    const [photo] = await prisma.photo.findMany();
    assert.equal(await prisma.photo.count(), 1);
    assert.equal(photo.title, 'Ảnh');
    assert.equal(photo.alt, 'Ảnh kiểm thử 4');
    assert.deepEqual(await storage.listDir('tmp'), []);
});

test('upload.mixed bỏ qua tên field lạ và vẫn trả 200 khi mọi ảnh bị từ chối', async t =>
{
    const { prisma, request, storage } = await prepareTest(t);
    const file = path.join(__dirname, 'fixtures', 'small.png');
    const response = await request.post('/api/uploads')
        .field('alt_99', 'Bỏ qua')
        .attach('other', file)
        .attach('photos', file)
        .expect(200);
    assert.deepEqual(response.body.results.map(({ index, ok, error }) => [index, ok, error.code]), [[0, false, 'ALT_REQUIRED']]);
    assert.equal(await prisma.photo.count(), 0);
    assert.deepEqual(await storage.listDir('tmp'), []);
});

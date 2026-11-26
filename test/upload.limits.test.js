const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');
const sharp = require('sharp');
const { prepareTest } = require('./helpers');

test('upload.limits kiểm tra biên byte, pixel và kích thước WebP', async t =>
{
    const { prisma, storage, uploadFiles } = await prepareTest(t);
    const fixtures = path.join(__dirname, 'fixtures');
    const sizeLimit = 10 * 1024 * 1024;
    assert.equal((await fs.stat(path.join(fixtures, 'exactly-10mib.png'))).size, sizeLimit);
    const oversized = path.join(fixtures, 'over-10mib.png');
    assert.equal((await fs.stat(oversized)).size, sizeLimit + 1);
    await sharp(oversized, { failOn: 'warning' }).png().toBuffer();

    const response = await uploadFiles([
        { filename: 'exactly-10mib.png' },
        { filename: 'over-10mib.png' },
        { filename: 'max-pixels.png' },
        { filename: 'too-many-pixels.png' },
        { filename: 'too-tall.png' }
    ]).expect(200);
    const results = response.body.results;
    assert.deepEqual(results.map(({ index, ok, error }) => [index, ok, error?.code]), [
        [0, true, undefined],
        [1, false, 'TOO_LARGE'],
        [2, true, undefined],
        [3, false, 'TOO_MANY_PIXELS'],
        [4, false, 'UNSUPPORTED_DIMENSIONS']
    ]);

    const ids = [results[0].photo.id, results[2].photo.id].sort();
    const photos = await prisma.photo.findMany({ orderBy: { id: 'asc' }, include: { variants: true } });
    assert.deepEqual(photos.map(photo => photo.id).sort(), ids);
    const maxPixels = photos.find(photo => photo.id === results[2].photo.id);
    assert.equal(maxPixels.originalWidth * maxPixels.originalHeight, 40_000_000);
    assert.equal(await prisma.photoVersion.count(), 2);
    assert.equal(await prisma.photoVariant.count(), 6);
    assert.deepEqual((await storage.listDir('photos')).sort(), ids);
    assert.deepEqual((await storage.listDir('originals')).sort(), ids.map(id => id + '.png'));
    assert.deepEqual(await storage.listDir('tmp'), []);
    for (const photo of photos)
    {
        for (const variant of photo.variants)
        {
            assert.equal((await fs.stat(storage.keyToPath(variant.storageKey))).size, variant.bytes);
        }
    }
});

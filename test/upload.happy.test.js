const assert = require('node:assert/strict');
const { test } = require('node:test');
const sharp = require('sharp');
const { prepareTest } = require('./helpers');

for (const image of [
    { filename: 'photo.jpg', width: 2000, height: 1333, variantWidths: [320, 960, 1600] },
    { filename: 'photo.png', width: 800, height: 600, variantWidths: [320, 800] }
])
{
    test('upload.happy ' + image.filename + ' lưu đủ file, metadata và hiển thị trên gallery', async t =>
    {
        const { prisma, scratch, readObject, request, uploadFiles } = await prepareTest(t);
        const uploadPage = await request.get('/upload').expect(200);
        assert.match(uploadPage.text, /name="photos"[^>]*multiple/);
        assert.match(uploadPage.text, /<textarea[^>]*required/);

        const title = 'Ảnh ' + image.filename;
        const alt = 'Ảnh mẫu cho gallery';
        const response = await uploadFiles([{ filename: image.filename, title: '  ' + title, altText: alt + '  ' }]).expect(200);
        assert.equal(response.body.results.length, 1);
        const [result] = response.body.results;
        assert.equal(result.index, 0);
        assert.equal(result.filename, image.filename);
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.match(result.photo.id, /^[A-Za-z0-9_-]{12}$/);
        assert.equal(result.photo.title, title);
        assert.equal(result.photo.url, '/photos/' + result.photo.id);

        const records = await prisma.photo.findMany({
            include: { versions: true, variants: { orderBy: { width: 'asc' } } }
        });
        assert.equal(records.length, 1);
        const [photo] = records;
        assert.equal(photo.id, result.photo.id);
        assert.equal(photo.status, 'PUBLISHED');
        assert.equal(photo.currentVersion, 1);
        assert.equal(photo.title, title);
        assert.equal(photo.alt, alt);
        assert.deepEqual([photo.originalWidth, photo.originalHeight], [image.width, image.height]);
        assert.equal(photo.originalKey, 'originals/' + photo.id + '.png');

        assert.equal(photo.versions.length, 1);
        const [version] = photo.versions;
        assert.equal(version.version, 1);
        assert.deepEqual([version.width, version.height], [image.width, image.height]);
        assert.deepEqual(version.edits, { rotate: 0, flipH: false, crop: null });

        const original = await sharp(await readObject(photo.originalKey)).metadata();
        assert.equal(original.format, 'png');
        assert.deepEqual([original.width, original.height], [image.width, image.height]);
        assert.deepEqual(photo.variants.map(variant => variant.width), image.variantWidths);
        assert.equal(result.photo.variants.length, image.variantWidths.length);

        for (const [index, variant] of photo.variants.entries())
        {
            const key = 'photos/' + photo.id + '/v1/' + variant.width + '.webp';
            assert.equal(variant.storageKey, key);
            assert.equal(variant.mime, 'image/webp');
            assert.equal(variant.photoId, photo.id);
            assert.equal(variant.version, 1);
            assert.equal(variant.height, Math.round(image.height * variant.width / image.width));
            const file = await readObject(key);
            assert.equal(file.length, variant.bytes);
            const info = await sharp(file).metadata();
            assert.deepEqual([info.format, info.width, info.height], ['webp', variant.width, variant.height]);
            assert.deepEqual(result.photo.variants[index], { width: variant.width, height: variant.height, url: '/media/' + key });
        }

        assert.deepEqual(await scratch.listDir('tmp'), []);
        const gallery = await request.get('/').expect(200);
        const cover = photo.variants.findLast(variant => variant.width <= 960);
        assert.ok(gallery.text.includes('id="photo-' + photo.id + '"'));
        assert.ok(gallery.text.includes('src="/media/' + cover.storageKey + '"'));
        assert.ok(gallery.text.includes('alt="' + alt + '"'));
        await request.get('/media/' + cover.storageKey).expect(200);
    });
}

test('upload.happy gửi JPEG và PNG trong cùng request', async t =>
{
    const { prisma, scratch, objectExists, uploadFiles } = await prepareTest(t);
    const response = await uploadFiles([
        { filename: 'photo.jpg', title: '  Ảnh thứ nhất  ', altText: 'JPEG trong album' },
        { filename: 'photo.png', title: '  Ảnh thứ hai  ', altText: 'PNG trong album' }
    ]).expect(200);
    const results = response.body.results;
    assert.deepEqual(results.map(({ index, ok, photo }) => [index, ok, photo?.variants.map(variant => variant.width)]),
        [[0, true, [320, 960, 1600]], [1, true, [320, 800]]]);

    const photos = await prisma.photo.findMany({ include: { variants: true } });
    const metadata = new Map(photos.map(({ id, title, alt }) => [id, [id, title, alt]]));
    assert.deepEqual(results.map(result => metadata.get(result.photo.id)), [
        [results[0].photo.id, 'Ảnh thứ nhất', 'JPEG trong album'],
        [results[1].photo.id, 'Ảnh thứ hai', 'PNG trong album']
    ]);
    assert.equal(await prisma.photoVersion.count(), 2);
    assert.equal(await prisma.photoVariant.count(), 5);
    for (const photo of photos)
    {
        assert.ok(await objectExists(photo.originalKey));
        for (const variant of photo.variants) assert.ok(await objectExists(variant.storageKey));
    }
    assert.deepEqual(await scratch.listDir('tmp'), []);
});

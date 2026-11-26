const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
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
        const { prisma, storage, request, uploadFiles } = await prepareTest(t);
        const uploadPage = await request.get('/upload').expect(200);
        assert.match(uploadPage.text, /name="photos"/);
        assert.match(uploadPage.text, /name="alt_0"[^>]*required/);

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

        const original = await sharp(storage.keyToPath(photo.originalKey)).metadata();
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
            const file = storage.keyToPath(key);
            assert.equal((await fs.stat(file)).size, variant.bytes);
            const info = await sharp(file).metadata();
            assert.deepEqual([info.format, info.width, info.height], ['webp', variant.width, variant.height]);
            assert.deepEqual(result.photo.variants[index], { width: variant.width, height: variant.height, url: '/media/' + key });
        }

        assert.deepEqual(await storage.listDir('tmp'), []);
        const gallery = await request.get('/').expect(200);
        const cover = photo.variants.findLast(variant => variant.width <= 960);
        assert.ok(gallery.text.includes('id="photo-' + photo.id + '"'));
        assert.ok(gallery.text.includes('src="/media/' + cover.storageKey + '"'));
        assert.ok(gallery.text.includes('alt="' + alt + '"'));
        await request.get('/media/' + cover.storageKey).expect(200);
    });
}

const assert = require('node:assert/strict');
const { test } = require('node:test');
const sharp = require('sharp');
const { prepareTest } = require('./helpers');

async function expectPreview(request, photoId)
{
    const response = await request.get('/photos/' + photoId + '/edit/source')
        .expect('Content-Type', 'image/webp')
        .expect('Cache-Control', 'private, no-store')
        .expect(200);
    const metadata = await sharp(response.body).metadata();
    assert.deepEqual([metadata.format, metadata.width, metadata.height], ['webp', 1600, 1066]);
    assert.equal(metadata.exif, undefined);
}

test('edit.version lưu v2 theo crop và restore từ PNG gốc thành v3', async t =>
{
    const { prisma, request, objectStore, readObject, uploadFiles } = await prepareTest(t);
    const { body } = await uploadFiles([{ filename: 'photo.jpg' }]).expect(200);
    assert.equal(body.results[0].ok, true);
    const photo = body.results[0].photo;
    const url = '/api/photos/' + photo.id + '/edits';
    const edits = { rotate: 90, flipH: true, crop: { x: 200, y: 500, width: 250, height: 400 } };

    const { body: saved } = await request.post(url).send({ baseVersion: 1, ...edits }).expect(200);
    const v2Url = '/media/photos/' + photo.id + '/v2/250.webp';
    assert.deepEqual(saved, { version: 2, variants: [{ width: 250, height: 400, url: v2Url }] });
    const v2 = await prisma.photoVersion.findUniqueOrThrow({ where: { photoId_version: { photoId: photo.id, version: 2 } } });
    assert.deepEqual(v2.edits, edits);
    assert.deepEqual([v2.width, v2.height, v2.supersededAt], [250, 400, null]);
    const v1 = await prisma.photoVersion.findUniqueOrThrow({ where: { photoId_version: { photoId: photo.id, version: 1 } } });
    assert.ok(v1.supersededAt instanceof Date);
    assert.equal(v1.purgedAt, null);

    const current = await prisma.photo.findUniqueOrThrow({ where: { id: photo.id } });
    assert.equal(current.currentVersion, 2);
    assert.equal(current.nextVersion, 3);
    const variant = await prisma.photoVariant.findUniqueOrThrow({
        where: { photoId_version_width: { photoId: photo.id, version: 2, width: 250 } }
    });
    assert.equal(variant.mime, 'image/webp');
    assert.equal(variant.bytes, (await readObject(variant.storageKey)).length);
    const rendered = await request.get(v2Url).expect('Content-Type', 'image/webp').expect(200);
    const renderedMetadata = await sharp(rendered.body).metadata();
    assert.deepEqual([renderedMetadata.width, renderedMetadata.height, renderedMetadata.exif], [250, 400, undefined]);
    const gallery = await request.get('/').expect(200);
    assert.ok(gallery.text.includes(v2Url));
    assert.ok(!gallery.text.includes(photo.variants[0].url));
    await request.get(photo.variants[0].url).expect(200);
    await expectPreview(request, photo.id);

    const { body: restored } = await request.post(url)
        .send({ baseVersion: 2, restore: true, rotate: 45, flipH: 'ignored', crop: [] }).expect(200);
    assert.equal(restored.version, 3);
    assert.deepEqual(restored.variants, photo.variants.map(item => ({ ...item, url: item.url.replace('/v1/', '/v3/') })));
    const after = await prisma.photo.findUniqueOrThrow({
        where: { id: photo.id }, include: { versions: { orderBy: { version: 'asc' } } }
    });
    assert.deepEqual([after.currentVersion, after.nextVersion], [3, 4]);
    assert.deepEqual(after.versions.map(row => row.version), [1, 2, 3]);
    assert.deepEqual(after.versions[2].edits, { rotate: 0, flipH: false, crop: null });
    assert.deepEqual([after.versions[2].width, after.versions[2].height], [2000, 1333]);
    assert.ok(after.versions[1].supersededAt instanceof Date);
    assert.deepEqual(after.versions[0].supersededAt, v1.supersededAt);
    for (const { url: media } of [...photo.variants, ...saved.variants, ...restored.variants])
    {
        await request.get(media).expect(200);
    }

    await prisma.photoVersion.update({
        where: { photoId_version: { photoId: photo.id, version: 1 } },
        data: { purgedAt: new Date() }
    });
    for (const { url: media } of photo.variants)
    {
        await objectStore.delete(media.slice('/media/'.length));
        await request.get(media).expect(404);
    }
    await expectPreview(request, photo.id);
});

test('edit.version baseVersion nguyên vượt phạm vi Int của DB trả conflict', async t =>
{
    const { prisma, request, scratch, uploadFiles } = await prepareTest(t);
    const { body } = await uploadFiles([{ filename: 'small.png' }]).expect(200);
    const { id } = body.results[0].photo;
    const response = await request.post('/api/photos/' + id + '/edits')
        .send({ baseVersion: 3_000_000_000, restore: true }).expect(409);
    assert.equal(response.body.error.code, 'VERSION_CONFLICT');
    assert.equal(response.body.currentVersion, 1);
    assert.equal(await prisma.photoVersion.count({ where: { photoId: id } }), 1);
    assert.deepEqual(await scratch.listDir('cleanup-queue'), []);
});

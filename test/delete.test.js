const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runCleanup } = require('../src/cleanup/runCleanup');
const { prepareTest } = require('./helpers');

async function getPhoto(prisma, id)
{
    return prisma.photo.findUniqueOrThrow({ where: { id }, include: { variants: true, versions: true } });
}

async function uploadPhoto(uploadFiles, filename)
{
    const { body } = await uploadFiles([{ filename }]).expect(200);
    const [result] = body.results;
    assert.equal(result.ok, true);
    return result.photo;
}

async function assertHidden(request, photo)
{
    const gallery = await request.get('/').expect(200);
    assert.ok(!gallery.text.includes('id="photo-' + photo.id + '"'));
    await request.get('/photos/' + photo.id).expect(404);
    for (const { storageKey } of photo.variants)
    {
        await request.get('/media/' + storageKey).set('Cache-Control', 'no-cache').expect(404);
    }
}

async function assertPurged(prisma, { scratch, listObjectKeys, objectExists }, before)
{
    const after = await getPhoto(prisma, before.id);
    assert.equal(after.status, 'PURGED');
    assert.ok(after.deletedAt instanceof Date);
    assert.ok(after.purgedAt instanceof Date);
    assert.ok(after.purgedAt >= after.deletedAt);
    assert.equal(after.versions.length, before.versions.length);
    assert.deepEqual(after.variants.map(row => row.storageKey).sort(), before.variants.map(row => row.storageKey).sort());
    for (const version of after.versions)
    {
        assert.deepEqual(version.purgedAt, after.purgedAt);
    }
    assert.deepEqual(await listObjectKeys('photos/' + before.id + '/'), []);
    assert.equal(await objectExists(before.originalKey), false);
    assert.deepEqual(await scratch.listDir('cleanup-queue'), []);
    return after;
}

test('delete ẩn ảnh, purge original và media của mọi version, gọi lại trả 404', async t =>
{
    const { prisma, request, scratch, objectStore, listObjectKeys, objectExists, readObject, uploadFiles } = await prepareTest(t);
    const { id, url } = await uploadPhoto(uploadFiles, 'photo.png');
    const uploaded = await getPhoto(prisma, id);
    const secondVersion = [];
    for (const variant of uploaded.variants)
    {
        const storageKey = 'photos/' + id + '/v2/' + variant.width + '.webp';
        await objectStore.put(storageKey, await readObject(variant.storageKey), { contentType: 'image/webp' });
        secondVersion.push({
            photoId: id, version: 2, storageKey,
            width: variant.width, height: variant.height, mime: variant.mime, bytes: variant.bytes
        });
    }
    await prisma.$transaction([
        prisma.photoVersion.create({
            data: {
                photoId: id, version: 2, width: uploaded.originalWidth, height: uploaded.originalHeight,
                edits: { rotate: 0, flipH: false, crop: null }
            }
        }),
        prisma.photoVariant.createMany({ data: secondVersion }),
        prisma.photo.update({ where: { id }, data: { currentVersion: 2, nextVersion: 3 } })
    ]);

    const before = await getPhoto(prisma, id);
    assert.equal(before.versions.length, 2);
    assert.equal(before.variants.length, 4);
    await request.get(url).expect(200);
    for (const { storageKey } of before.variants)
    {
        await request.get('/media/' + storageKey).expect('Cache-Control', 'public, max-age=31536000, immutable').expect(200);
    }

    await request.post(url + '/delete').expect('Location', '/').expect(303);
    const purged = await assertPurged(prisma, { scratch, listObjectKeys, objectExists }, before);
    await assertHidden(request, before);
    const repeated = await request.post(url + '/delete').expect(404);
    assert.match(repeated.text, /Không tìm thấy trang/);
    const afterRepeat = await getPhoto(prisma, id);
    assert.deepEqual(afterRepeat.deletedAt, purged.deletedAt);
    assert.deepEqual(afterRepeat.purgedAt, purged.purgedAt);
});

test('delete coi file thiếu là đã xóa và trả 404 cho id không tồn tại', async t =>
{
    const { prisma, request, scratch, objectStore, listObjectKeys, objectExists, uploadFiles } = await prepareTest(t);
    const { id, url } = await uploadPhoto(uploadFiles, 'small.png');
    const before = await getPhoto(prisma, id);
    await objectStore.delete(before.originalKey);
    await objectStore.delete(before.variants[0].storageKey);

    const missing = await request.post('/photos/aaaaaaaaaaaa/delete').expect(404);
    assert.match(missing.text, /Không tìm thấy trang/);
    assert.equal(await prisma.photo.count(), 1);
    await request.post(url + '/delete').expect('Location', '/').expect(303);
    await assertPurged(prisma, { scratch, listObjectKeys, objectExists }, before);
    await assertHidden(request, before);
});

test('delete ẩn ảnh trước khi xóa file, giữ DELETING nếu xóa lỗi rồi cleanup hoàn tất', { timeout: 10000 }, async t =>
{
    const { prisma, request, scratch, objectStore, listObjectKeys, objectExists, uploadFiles } = await prepareTest(t);
    const { id, url } = await uploadPhoto(uploadFiles, 'photo.png');
    const before = await getPhoto(prisma, id);
    const blocked = before.variants[0].storageKey;
    let startDelete;
    let finishDelete;
    const started = new Promise(resolve =>
    {
        startDelete = resolve;
    });
    const resume = new Promise(resolve =>
    {
        finishDelete = resolve;
    });
    const remove = objectStore.delete;
    const deletion = t.mock.method(objectStore, 'delete', async key =>
    {
        if (key === blocked)
        {
            startDelete();
            await resume;
            throw Object.assign(new Error('Xóa file lỗi giả lập'), { code: 'EACCES' });
        }
        return remove(key);
    });
    const log = t.mock.method(console, 'error', () => undefined);
    const first = request.post(url + '/delete').expect('Location', '/').expect(303).then(response => response);
    const endingEarly = first.then(() => assert.fail('Purge kết thúc trước khi thử xóa file'));

    try
    {
        await Promise.race([started, endingEarly]);
        const record = await getPhoto(prisma, id);
        assert.equal(record.status, 'DELETING');
        assert.ok(record.deletedAt instanceof Date);
        assert.equal(record.purgedAt, null);
        assert.ok(await objectExists(blocked));
        await assertHidden(request, before);
        await request.post(url + '/delete').expect(404);
    }
    finally
    {
        finishDelete();
    }

    await first;
    const pending = await getPhoto(prisma, id);
    assert.equal(pending.status, 'DELETING');
    assert.equal(pending.purgedAt, null);
    assert.ok(pending.versions.every(version => version.purgedAt === null));
    assert.deepEqual(await scratch.listDir('cleanup-queue'), []);
    assert.equal(log.mock.callCount(), 1);
    assert.ok(log.mock.calls[0].arguments[0].includes(blocked));
    assert.ok(await objectExists(blocked));
    for (const key of [before.originalKey, ...before.variants.map(variant => variant.storageKey)])
    {
        if (key !== blocked) assert.equal(await objectExists(key), false);
    }

    deletion.mock.restore();
    const summary = await runCleanup({ prisma, scratch, objectStore });
    assert.equal(summary.deletedPhotoFilesRemoved, before.variants.length + 1);
    const purged = await assertPurged(prisma, { scratch, listObjectKeys, objectExists }, before);
    assert.deepEqual(purged.deletedAt, pending.deletedAt);
    await assertHidden(request, before);

    const repeat = await runCleanup({ prisma, scratch, objectStore });
    assert.equal(repeat.deletedPhotoFilesRemoved, 0);
    assert.deepEqual((await getPhoto(prisma, id)).purgedAt, purged.purgedAt);
});

test('delete cleanup xử lý mọi ảnh DELETING khi hai lượt chạy đồng thời', async t =>
{
    const { prisma, request, scratch, objectStore, listObjectKeys, objectExists, uploadFiles } = await prepareTest(t);
    const first = await uploadPhoto(uploadFiles, 'small.png');
    const second = await uploadPhoto(uploadFiles, 'small.png');
    const photos = await Promise.all([getPhoto(prisma, first.id), getPhoto(prisma, second.id)]);
    await prisma.photo.updateMany({
        where: { id: { in: [first.id, second.id] } },
        data: { status: 'DELETING', deletedAt: new Date() }
    });
    const log = t.mock.method(console, 'error', () => undefined);

    await Promise.all([runCleanup({ prisma, scratch, objectStore }), runCleanup({ prisma, scratch, objectStore })]);
    for (const photo of photos)
    {
        await assertPurged(prisma, { scratch, listObjectKeys, objectExists }, photo);
        await assertHidden(request, photo);
    }
    assert.deepEqual(log.mock.calls.map(call => call.arguments), []);
});

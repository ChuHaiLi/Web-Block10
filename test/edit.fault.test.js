const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { test } = require('node:test');
const { runCleanup } = require('../src/cleanup/runCleanup');
const { prepareTest } = require('./helpers');

const edits = { baseVersion: 1, rotate: 0, flipH: true, crop: null };

async function uploadCorners(uploadFiles)
{
    const { body } = await uploadFiles([{ filename: 'corners.png' }]).expect(200);
    assert.equal(body.results[0].ok, true);
    return body.results[0].photo;
}

async function assertUnchanged(prisma, request, photo)
{
    const stored = await prisma.photo.findUniqueOrThrow({
        where: { id: photo.id }, include: { versions: true, variants: true }
    });
    assert.deepEqual([stored.status, stored.currentVersion, stored.nextVersion], ['PUBLISHED', 1, 3]);
    assert.deepEqual(stored.versions.map(row => [row.version, row.supersededAt]), [[1, null]]);
    assert.equal(stored.variants.length, photo.variants.length);
    assert.ok(stored.variants.every(row => row.version === 1));
    for (const { url } of photo.variants) await request.get(url).expect(200);
}

test('edit.fault option làm rollback metadata sau khi ghi đủ WebP và dọn file', async t =>
{
    const { prisma, request, scratch, objectStore, listObjectKeys, objectExists, uploadFiles } = await prepareTest(t, { faultInject: 'edit-db-after-write' });
    const photo = await uploadCorners(uploadFiles);
    const remove = objectStore.delete;
    const written = [];
    t.mock.method(objectStore, 'delete', async key =>
    {
        if (key.includes('/v2/'))
        {
            assert.ok(await objectExists(key));
            written.push(key);
        }
        return remove(key);
    });

    const response = await request.post('/api/photos/' + photo.id + '/edits').send(edits).expect(500);
    assert.equal(response.body.error.code, 'STORAGE_ERROR');
    assert.deepEqual(written, [320, 400].map(width => 'photos/' + photo.id + '/v2/' + width + '.webp'));
    await assertUnchanged(prisma, request, photo);
    assert.deepEqual(await listObjectKeys('photos/' + photo.id + '/v2/'), []);
    assert.deepEqual(await scratch.listDir('cleanup-queue'), []);
});

test('edit.fault xếp hàng xóa lại WebP bị chặn trong rollback', async t =>
{
    const { prisma, request, scratch, objectStore, listObjectKeys, objectExists, uploadFiles } = await prepareTest(t, { faultInject: 'edit-db-after-write' });
    const photo = await uploadCorners(uploadFiles);
    const blocked = 'photos/' + photo.id + '/v2/320.webp';
    const remove = objectStore.delete;
    const deletion = t.mock.method(objectStore, 'delete', async key =>
    {
        if (key === blocked) throw Object.assign(new Error('Xóa lỗi giả lập'), { code: 'EACCES' });
        return remove(key);
    });

    const response = await request.post('/api/photos/' + photo.id + '/edits').send(edits).expect(500);
    assert.equal(response.body.error.code, 'STORAGE_ERROR');
    await assertUnchanged(prisma, request, photo);
    await request.get('/media/' + blocked).expect(404);
    assert.ok(await objectExists(blocked));
    const entries = await scratch.listDir('cleanup-queue');
    assert.equal(entries.length, 1);
    const record = JSON.parse(await fs.readFile(scratch.keyToPath('cleanup-queue/' + entries[0]), 'utf8'));
    assert.equal(record.key, blocked);
    assert.equal(record.reason, 'edit-rollback');

    deletion.mock.restore();
    const summary = await runCleanup({ prisma, scratch, objectStore });
    assert.equal(summary.queueFilesRemoved, 1);
    assert.equal(summary.queueRecordsRemoved, 1);
    assert.deepEqual(await listObjectKeys('photos/' + photo.id + '/v2/'), []);
    assert.deepEqual(await scratch.listDir('cleanup-queue'), []);
});

test('edit.fault lỗi giữa lúc ghi dọn cả file ghi dở và file đã ghi', async t =>
{
    const { prisma, request, scratch, objectStore, listObjectKeys, uploadFiles } = await prepareTest(t);
    const photo = await uploadCorners(uploadFiles);
    const put = objectStore.put;
    t.mock.method(objectStore, 'put', async (key, bytes, options) =>
    {
        if (key.endsWith('/v2/400.webp'))
        {
            await put(key, bytes.subarray(0, 10), options);
            throw Object.assign(new Error('Ghi lỗi giả lập'), { code: 'EIO' });
        }
        return put(key, bytes, options);
    });

    const response = await request.post('/api/photos/' + photo.id + '/edits').send(edits).expect(500);
    assert.equal(response.body.error.code, 'STORAGE_ERROR');
    await assertUnchanged(prisma, request, photo);
    assert.deepEqual(await listObjectKeys('photos/' + photo.id + '/v2/'), []);
    assert.deepEqual(await scratch.listDir('cleanup-queue'), []);
});

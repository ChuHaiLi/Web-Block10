const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runCleanup } = require('../src/cleanup/runCleanup');
const renderer = require('../src/edit/renderEdits');
const { prepareTest } = require('./helpers');

const HOUR_MS = 60 * 60 * 1000;

test('download.lifecycle xóa ảnh dọn hết file dl/ và trả 404', async t =>
{
    const { guest, request, listObjectKeys, uploadFiles } = await prepareTest(t);
    const { body } = await uploadFiles([{ filename: 'photo.jpg' }]).expect(200);
    const { id } = body.results[0].photo;

    await guest.get(`/photos/${id}/v/1/download/original`).expect(200);
    await guest.get(`/photos/${id}/v/1/download/1366x768`).expect(200);
    const keysBefore = await listObjectKeys(`photos/${id}/`);
    assert.ok(keysBefore.includes(`photos/${id}/v1/dl/original.jpg`));
    assert.ok(keysBefore.includes(`photos/${id}/v1/dl/1366x768.jpg`));

    await request.post(`/photos/${id}/delete`).expect('Location', '/').expect(303);
    assert.deepEqual(await listObjectKeys(`photos/${id}/`), []);
    await guest.get(`/photos/${id}/v/1/download/original`).expect(404);
    await guest.get(`/photos/${id}/v/1/download/1366x768`).expect(404);
});

test('download.lifecycle dọn version cũ xóa luôn file dl/ của version đó, giữ version chưa dọn', async t =>
{
    const { prisma, guest, request, scratch, objectStore, objectExists, uploadFiles } = await prepareTest(t);
    const { body } = await uploadFiles([{ filename: 'photo.jpg' }]).expect(200);
    const { id } = body.results[0].photo;

    await guest.get(`/photos/${id}/v/1/download/original`).expect(200);
    await guest.get(`/photos/${id}/v/1/download/1366x768`).expect(200);

    await request.post(`/api/photos/${id}/edits`)
        .send({ baseVersion: 1, rotate: 90, flipH: false, crop: null })
        .expect(200);
    await guest.get(`/photos/${id}/v/2/download/original`).expect(200);

    // Before retention expires, superseded v1 is still downloadable.
    await guest.get(`/photos/${id}/v/1/download/original`).expect(200);

    await prisma.photoVersion.update({
        where: { photoId_version: { photoId: id, version: 1 } },
        data: { supersededAt: new Date(Date.now() - 3 * HOUR_MS) }
    });

    await runCleanup({ prisma, scratch, objectStore, versionRetentionHours: 2 });
    assert.equal(await objectExists(`photos/${id}/v1/dl/original.jpg`), false);
    assert.equal(await objectExists(`photos/${id}/v1/dl/1366x768.jpg`), false);
    assert.ok(await objectExists(`photos/${id}/v2/dl/original.jpg`));
    await guest.get(`/photos/${id}/v/1/download/original`).expect(404);
    await guest.get(`/photos/${id}/v/2/download/original`).expect(200);
});

test('download.lifecycle xóa ảnh trong lúc đang render trả 404 và không để lại file dl/', { timeout: 15000 }, async t =>
{
    const { prisma, guest, request, scratch, listObjectKeys, uploadFiles } = await prepareTest(t);
    const { body } = await uploadFiles([{ filename: 'photo.jpg' }]).expect(200);
    const { id } = body.results[0].photo;

    const originalRender = renderer.renderEdits;
    let enteredRender;
    let releaseRender;
    const renderStarted = new Promise(resolve =>
    {
        enteredRender = resolve;
    });
    const allowRender = new Promise(resolve =>
    {
        releaseRender = resolve;
    });

    t.mock.method(renderer, 'renderEdits', async (...args) =>
    {
        enteredRender();
        await allowRender;
        return originalRender(...args);
    });

    const downloadPromise = guest.get(`/photos/${id}/v/1/download/1366x768`).then(res => res);
    try
    {
        await Promise.race([
            renderStarted,
            downloadPromise.then(() => assert.fail('Tải ảnh kết thúc trước khi render bắt đầu'))
        ]);
        await request.post(`/photos/${id}/delete`).expect('Location', '/').expect(303);
        assert.equal((await prisma.photo.findUniqueOrThrow({ where: { id } })).status, 'PURGED');
    }
    finally
    {
        releaseRender();
    }

    const res = await downloadPromise;
    assert.equal(res.status, 404);
    assert.equal(res.headers['cache-control'], undefined);
    assert.deepEqual(await listObjectKeys(`photos/${id}/`), []);
    assert.deepEqual(await scratch.listDir('cleanup-queue'), []);
});

test('download.lifecycle dọn mồ côi xóa file dl/ sót lại trong version đã purge khi cũ hơn 1 giờ', async t =>
{
    const { prisma, request, scratch, objectStore, objectExists, uploadFiles } = await prepareTest(t);
    const { body } = await uploadFiles([{ filename: 'photo.jpg' }]).expect(200);
    const { id } = body.results[0].photo;

    await request.post(`/api/photos/${id}/edits`)
        .send({ baseVersion: 1, rotate: 0, flipH: true, crop: null })
        .expect(200);
    await prisma.photoVersion.update({
        where: { photoId_version: { photoId: id, version: 1 } },
        data: { supersededAt: new Date(Date.now() - 25 * HOUR_MS) }
    });
    await runCleanup({ prisma, scratch, objectStore });

    // Simulate a late dl/ object left behind in an already-purged version.
    const lateKey = `photos/${id}/v1/dl/original.jpg`;
    await objectStore.put(lateKey, Buffer.from('late-dl'), { contentType: 'image/jpeg' });

    // Recent (< 1h) must be kept.
    await runCleanup({ prisma, scratch, objectStore, now: Date.now() });
    assert.ok(await objectExists(lateKey));

    // Older than 1h must be deleted.
    const summary = await runCleanup({ prisma, scratch, objectStore, now: Date.now() + 2 * HOUR_MS });
    assert.equal(summary.orphanVersionFilesRemoved, 1);
    assert.equal(await objectExists(lateKey), false);

    // Also test a dl/ object left in a PURGED photo even if version.purgedAt was null.
    await request.post(`/photos/${id}/delete`).expect(303);
    await prisma.photoVersion.updateMany({ where: { photoId: id }, data: { purgedAt: null } });
    const purgedLateKey = `photos/${id}/v2/dl/original.jpg`;
    await objectStore.put(purgedLateKey, Buffer.from('purged-dl'), { contentType: 'image/jpeg' });
    const purgedSummary = await runCleanup({ prisma, scratch, objectStore, now: Date.now() + 2 * HOUR_MS });
    assert.equal(purgedSummary.orphanVersionFilesRemoved, 1);
    assert.equal(await objectExists(purgedLateKey), false);
});

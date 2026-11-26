const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');
const { runCleanup } = require('../src/cleanup/runCleanup');
const { prepareTest } = require('./helpers');

const HOUR_MS = 60 * 60 * 1000;
const storageKey = url => url.slice('/media/'.length);

test('cleanup, dọn file tạm và mồ côi cũ, giữ file mới hoặc có metadata', async t =>
{
    const { prisma, storage, uploadFiles } = await prepareTest(t);
    const uploaded = await uploadFiles([{ filename: 'small.png' }]).expect(200);
    const [result] = uploaded.body.results;
    assert.equal(result.ok, true);
    const { id } = result.photo;
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const registeredVersion = 'photos/' + id + '/v1/200.webp';
    const registeredOriginal = 'originals/' + id + '.png';
    const orphanVariant = 'photos/aaaaaaaaaaaa/v1/320.webp';
    const orphanExtra = 'photos/aaaaaaaaaaaa/v1/960.webp';
    const orphanVersion = 'photos/' + id + '/v2/200.webp';
    const youngVersion = 'photos/bbbbbbbbbbbb/v1/320.webp';
    const orphanOriginal = 'originals/aaaaaaaaaaaa.png';
    const youngOriginal = 'originals/bbbbbbbbbbbb.png';
    const oldTemporary = 'tmp/aaaaaaaaaaaa-0';
    const youngTemporary = 'tmp/bbbbbbbbbbbb-0';
    for (const key of [
        orphanVariant, orphanExtra, orphanVersion, youngVersion, orphanOriginal, youngOriginal, oldTemporary, youngTemporary
    ])
    {
        await storage.writeFile(key, 'fixture');
    }

    for (const key of [registeredVersion, orphanVariant, orphanVersion])
    {
        await fs.utimes(path.dirname(storage.keyToPath(key)), old, old);
    }
    for (const key of [registeredOriginal, orphanOriginal, oldTemporary, youngVersion])
    {
        await fs.utimes(storage.keyToPath(key), old, old);
    }

    const summary = await runCleanup({ prisma, storage });
    assert.equal(summary.orphanVersionFilesRemoved, 3);
    assert.equal(summary.orphanOriginalFilesRemoved, 1);
    assert.equal(summary.temporaryFilesRemoved, 1);
    for (const key of [orphanVariant, orphanExtra, orphanVersion, orphanOriginal, oldTemporary])
    {
        await assert.rejects(fs.access(storage.keyToPath(key)), { code: 'ENOENT' });
    }
    for (const key of [registeredVersion, registeredOriginal, youngVersion, youngOriginal, youngTemporary])
    {
        await fs.access(storage.keyToPath(key));
    }
    await assert.rejects(fs.access(path.dirname(storage.keyToPath(orphanVersion))), { code: 'ENOENT' });
    assert.deepEqual((await storage.listDir('photos')).sort(), [id, 'bbbbbbbbbbbb'].sort());
    assert.equal(await prisma.photo.count(), 1);
    assert.equal(await prisma.photoVersion.count(), 1);
    assert.equal(await prisma.photoVariant.count(), 1);

    const secondRun = await runCleanup({ prisma, storage });
    assert.ok(Object.values(secondRun).every(count => count === 0));
});

test('cleanup dọn version superseded quá hạn, giữ version còn hạn và version hiện tại', async t =>
{
    const { prisma, request, storage, uploadFiles } = await prepareTest(t);
    const { body } = await uploadFiles([{ filename: 'photo.jpg' }]).expect(200);
    assert.equal(body.results[0].ok, true);
    const { id, variants: expired } = body.results[0].photo;
    const editsUrl = '/api/photos/' + id + '/edits';
    const { body: recent } = await request.post(editsUrl)
        .send({ baseVersion: 1, rotate: 180, flipH: false, crop: null }).expect(200);
    const { body: current } = await request.post(editsUrl).send({ baseVersion: 2, restore: true }).expect(200);
    assert.equal(recent.version, 2);
    assert.equal(current.version, 3);
    for (const { url } of [...expired, ...recent.variants, ...current.variants])
    {
        await request.get(url).expect(200);
    }

    const now = Date.now();
    await prisma.photoVersion.updateMany({
        where: { photoId: id, version: { in: [1, 3] } },
        // An incorrect timestamp must never make the current version eligible for deletion.
        data: { supersededAt: new Date(now - 3 * HOUR_MS) }
    });
    await prisma.photoVersion.updateMany({
        where: { photoId: id, version: 2 },
        data: { supersededAt: new Date(now - HOUR_MS) }
    });

    const summary = await runCleanup({ prisma, storage, versionRetentionHours: 2 });
    assert.equal(summary.supersededVersionFilesRemoved, expired.length);
    for (const { url } of expired)
    {
        await assert.rejects(fs.access(storage.keyToPath(storageKey(url))), { code: 'ENOENT' });
        await request.get(url).expect(404);
    }
    for (const { url } of [...recent.variants, ...current.variants])
    {
        await fs.access(storage.keyToPath(storageKey(url)));
        await request.get(url).expect(200);
    }
    await fs.access(storage.keyToPath('originals/' + id + '.png'));

    const readVersions = () => prisma.photoVersion.findMany({
        where: { photoId: id },
        orderBy: { version: 'asc' },
        select: { version: true, purgedAt: true }
    });
    const versions = await readVersions();
    assert.deepEqual(versions.map(({ version }) => version), [1, 2, 3]);
    assert.ok(versions[0].purgedAt instanceof Date);
    assert.equal(versions[1].purgedAt, null);
    assert.equal(versions[2].purgedAt, null);
    assert.equal(await prisma.photoVariant.count({ where: { photoId: id, version: 1 } }), expired.length);

    const repeat = await runCleanup({ prisma, storage, versionRetentionHours: 2 });
    assert.equal(repeat.supersededVersionFilesRemoved, 0);
    assert.deepEqual(await readVersions(), versions);
});

test('cleanup giữ purgedAt null khi xóa lỗi và thử lại với các file đã mất', async t =>
{
    const { prisma, request, storage, uploadFiles } = await prepareTest(t);
    const { body } = await uploadFiles([{ filename: 'photo.png' }]).expect(200);
    assert.equal(body.results[0].ok, true);
    const { id, variants } = body.results[0].photo;
    await request.post('/api/photos/' + id + '/edits').send({ baseVersion: 1, restore: true }).expect(200);
    const where = { photoId_version: { photoId: id, version: 1 } };
    await prisma.photoVersion.update({ where, data: { supersededAt: new Date(Date.now() - 25 * HOUR_MS) } });

    const [blocked, missing] = variants.map(({ url }) => storageKey(url));
    assert.equal(variants.length, 2);
    const deleteKey = storage.deleteKey;
    const deletion = t.mock.method(storage, 'deleteKey', async key =>
    {
        if (key === blocked) throw Object.assign(new Error('Lỗi giả lập'), { code: 'EIO' });
        return deleteKey(key);
    });
    const log = t.mock.method(console, 'error', () => undefined);

    const first = await runCleanup({ prisma, storage });
    assert.equal(first.supersededVersionFilesRemoved, 1);
    assert.equal((await prisma.photoVersion.findUniqueOrThrow({ where })).purgedAt, null);
    assert.deepEqual(await storage.listDir('cleanup-queue'), []);
    await fs.access(storage.keyToPath(blocked));
    await assert.rejects(fs.access(storage.keyToPath(missing)), { code: 'ENOENT' });
    assert.equal(log.mock.callCount(), 1);
    assert.ok(log.mock.calls[0].arguments[0].includes(blocked));

    deletion.mock.restore();
    t.mock.method(storage, 'deleteKey', async key =>
    {
        if (key === missing) throw Object.assign(new Error('File đã mất'), { code: 'ENOENT' });
        return deleteKey(key);
    });
    const retry = await runCleanup({ prisma, storage });
    assert.equal(retry.supersededVersionFilesRemoved, 1);
    assert.ok((await prisma.photoVersion.findUniqueOrThrow({ where })).purgedAt instanceof Date);
    await assert.rejects(fs.access(storage.keyToPath(blocked)), { code: 'ENOENT' });
    assert.equal(log.mock.callCount(), 1);
});

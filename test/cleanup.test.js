const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { test } = require('node:test');
const { runCleanup } = require('../src/cleanup/runCleanup');
const { prepareTest } = require('./helpers');

const HOUR_MS = 60 * 60 * 1000;
const storageKey = url => url.slice('/media/'.length);

test('cleanup, dọn file tạm và mồ côi cũ, giữ file mới hoặc có metadata', async t =>
{
    const { prisma, scratch, objectStore, objectExists, listObjectKeys, uploadFiles } = await prepareTest(t);
    const uploaded = await uploadFiles([{ filename: 'small.png' }]).expect(200);
    const [result] = uploaded.body.results;
    assert.equal(result.ok, true);
    const { id } = result.photo;
    const registeredVersion = 'photos/' + id + '/v1/200.webp';
    const registeredOriginal = 'originals/' + id + '.png';
    const orphanVariant = 'photos/aaaaaaaaaaaa/v1/320.webp';
    const orphanExtra = 'photos/aaaaaaaaaaaa/v1/960.webp';
    const orphanVersion = 'photos/' + id + '/v2/200.webp';
    const youngVersion = 'photos/bbbbbbbbbbbb/v1/320.webp';
    const oldSibling = 'photos/bbbbbbbbbbbb/v1/960.webp';
    const orphanOriginal = 'originals/aaaaaaaaaaaa.png';
    const youngOriginal = 'originals/bbbbbbbbbbbb.png';
    const oldTemporary = 'tmp/aaaaaaaaaaaa-0';
    const youngTemporary = 'tmp/bbbbbbbbbbbb-0';
    for (const key of [
        orphanVariant, orphanExtra, orphanVersion, youngVersion, oldSibling, orphanOriginal, youngOriginal
    ])
    {
        const contentType = key.endsWith('.png') ? 'image/png' : 'image/webp';
        await objectStore.put(key, Buffer.from('fixture'), { contentType });
    }

    await scratch.writeFile(oldTemporary, 'fixture');
    await scratch.writeFile(youngTemporary, 'fixture');
    const now = Date.now() + 2 * HOUR_MS;
    const recent = new Date(now - HOUR_MS);
    await fs.utimes(scratch.keyToPath(youngTemporary), new Date(now), new Date(now));
    const list = objectStore.list;
    t.mock.method(objectStore, 'list', async function* (prefix, options)
    {
        for await (const object of list(prefix, options))
        {
            yield [youngVersion, youngOriginal].includes(object.key) ? { ...object, lastModified: recent } : object;
        }
    });

    const summary = await runCleanup({ prisma, scratch, objectStore, now });
    assert.equal(summary.orphanVersionFilesRemoved, 3);
    assert.equal(summary.orphanOriginalFilesRemoved, 1);
    assert.equal(summary.temporaryFilesRemoved, 1);
    for (const key of [orphanVariant, orphanExtra, orphanVersion, orphanOriginal])
    {
        assert.equal(await objectExists(key), false);
    }
    for (const key of [registeredVersion, registeredOriginal, youngVersion, oldSibling, youngOriginal])
    {
        assert.ok(await objectExists(key));
    }
    assert.deepEqual(await scratch.listDir('tmp'), [youngTemporary.slice('tmp/'.length)]);
    assert.deepEqual(await listObjectKeys('photos/'), [registeredVersion, youngVersion, oldSibling].sort());
    assert.equal(await prisma.photo.count(), 1);
    assert.equal(await prisma.photoVersion.count(), 1);
    assert.equal(await prisma.photoVariant.count(), 1);

    const secondRun = await runCleanup({ prisma, scratch, objectStore, now });
    assert.ok(Object.values(secondRun).every(count => count === 0));
});

test('cleanup dọn version superseded quá hạn, giữ version còn hạn và version hiện tại', async t =>
{
    const { prisma, request, scratch, objectStore, objectExists, uploadFiles } = await prepareTest(t);
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

    const summary = await runCleanup({ prisma, scratch, objectStore, versionRetentionHours: 2 });
    assert.equal(summary.supersededVersionFilesRemoved, expired.length);
    for (const { url } of expired)
    {
        assert.equal(await objectExists(storageKey(url)), false);
        await request.get(url).expect(404);
    }
    for (const { url } of [...recent.variants, ...current.variants])
    {
        assert.ok(await objectExists(storageKey(url)));
        await request.get(url).expect(200);
    }
    assert.ok(await objectExists('originals/' + id + '.png'));

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

    const repeat = await runCleanup({ prisma, scratch, objectStore, versionRetentionHours: 2 });
    assert.equal(repeat.supersededVersionFilesRemoved, 0);
    assert.deepEqual(await readVersions(), versions);
});

test('cleanup giữ purgedAt null khi xóa lỗi và thử lại với các file đã mất', async t =>
{
    const { prisma, request, scratch, objectStore, objectExists, uploadFiles } = await prepareTest(t);
    const { body } = await uploadFiles([{ filename: 'photo.png' }]).expect(200);
    assert.equal(body.results[0].ok, true);
    const { id, variants } = body.results[0].photo;
    await request.post('/api/photos/' + id + '/edits').send({ baseVersion: 1, restore: true }).expect(200);
    const where = { photoId_version: { photoId: id, version: 1 } };
    await prisma.photoVersion.update({ where, data: { supersededAt: new Date(Date.now() - 25 * HOUR_MS) } });

    const [blocked, missing] = variants.map(({ url }) => storageKey(url));
    assert.equal(variants.length, 2);
    const remove = objectStore.delete;
    const deletion = t.mock.method(objectStore, 'delete', async key =>
    {
        if (key === blocked) throw Object.assign(new Error('Lỗi giả lập'), { code: 'EIO' });
        return remove(key);
    });
    const log = t.mock.method(console, 'error', () => undefined);

    const first = await runCleanup({ prisma, scratch, objectStore });
    assert.equal(first.supersededVersionFilesRemoved, 1);
    assert.equal((await prisma.photoVersion.findUniqueOrThrow({ where })).purgedAt, null);
    assert.deepEqual(await scratch.listDir('cleanup-queue'), []);
    assert.ok(await objectExists(blocked));
    assert.equal(await objectExists(missing), false);
    assert.equal(log.mock.callCount(), 1);
    assert.ok(log.mock.calls[0].arguments[0].includes(blocked));

    deletion.mock.restore();
    const retry = await runCleanup({ prisma, scratch, objectStore });
    assert.equal(retry.supersededVersionFilesRemoved, 2);
    assert.ok((await prisma.photoVersion.findUniqueOrThrow({ where })).purgedAt instanceof Date);
    assert.equal(await objectExists(blocked), false);
    assert.equal(log.mock.callCount(), 1);
});

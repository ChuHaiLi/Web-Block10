const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');
const { runCleanup } = require('../src/cleanup/runCleanup');
const { prepareTest } = require('./helpers');

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

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { test } = require('node:test');
const { runCleanup } = require('../src/cleanup/runCleanup');
const { prepareTest } = require('./helpers');

async function assertEmptyDb(prisma)
{
    assert.equal(await prisma.photo.count(), 0);
    assert.equal(await prisma.photoVersion.count(), 0);
    assert.equal(await prisma.photoVariant.count(), 0);
}

async function readSingleRecord(storage)
{
    const entries = await storage.listDir('cleanup-queue');
    assert.equal(entries.length, 1);
    assert.match(entries[0], /^\d+-[a-f0-9]{12}\.json$/);
    return JSON.parse(await fs.readFile(storage.keyToPath('cleanup-queue/' + entries[0]), 'utf8'));
}

test('upload.fault, hook sau khi ghi đủ file rollback DB và dọn kho', async t =>
{
    const { prisma, storage, uploadFiles } = await prepareTest(t, { faultInject: 'db-after-write' });
    const remove = storage.deleteKey;
    const written = [];
    t.mock.method(storage, 'deleteKey', async key =>
    {
        if (!key.startsWith('tmp/'))
        {
            await fs.access(storage.keyToPath(key));
            written.push(key);
        }
        return remove(key);
    });

    const reply = await uploadFiles([{ filename: 'photo.jpg' }]).expect(200);
    const [result] = reply.body.results;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'STORAGE_ERROR');
    assert.equal(written.length, 4);
    const id = written[0].slice('originals/'.length, -'.png'.length);
    assert.match(id, /^[A-Za-z0-9_-]{12}$/);
    assert.deepEqual(written, [
        'originals/' + id + '.png',
        ...[320, 960, 1600].map(width => 'photos/' + id + '/v1/' + width + '.webp')
    ]);
    await assertEmptyDb(prisma);
    for (const directory of ['originals', 'photos', 'tmp', 'cleanup-queue'])
    {
        assert.deepEqual(await storage.listDir(directory), []);
    }
});

test('upload.fault, file rollback xóa lỗi được xếp hàng và dọn lại', async t =>
{
    const { prisma, request, storage, uploadFiles } = await prepareTest(t, { faultInject: 'db-after-write' });
    const remove = storage.deleteKey;
    const blocked = t.mock.method(storage, 'deleteKey', async key =>
    {
        if (key.startsWith('photos/') && key.endsWith('/320.webp'))
        {
            throw Object.assign(new Error('Xóa variant lỗi giả lập'), { code: 'EACCES' });
        }
        return remove(key);
    });

    const reply = await uploadFiles([{ filename: 'photo.png' }]).expect(200);
    const [result] = reply.body.results;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'STORAGE_ERROR');
    await assertEmptyDb(prisma);
    const { key, reason, at } = await readSingleRecord(storage);
    assert.match(key, /^photos\/[A-Za-z0-9_-]{12}\/v1\/320\.webp$/);
    assert.equal(reason, 'upload-rollback');
    assert.ok(Number.isFinite(Date.parse(at)));
    await fs.access(storage.keyToPath(key));
    await request.get('/media/' + key).expect(404);

    blocked.mock.restore();
    const summary = await runCleanup({ prisma, storage });
    assert.equal(summary.queueFilesRemoved, 1);
    assert.equal(summary.queueRecordsRemoved, 1);
    for (const directory of ['originals', 'photos', 'tmp', 'cleanup-queue'])
    {
        assert.deepEqual(await storage.listDir(directory), []);
    }
});

for (const { aborted, reason } of [{ aborted: false, reason: 'upload-temp' }, { aborted: true, reason: 'upload-abort' }])
{
    test('upload.fault, xếp hàng xóa lại file tạm ' + reason, async t =>
    {
        const { prisma, storage, uploadFiles } = await prepareTest(t);
        const remove = storage.deleteKey;
        const blocked = t.mock.method(storage, 'deleteKey', async key =>
        {
            if (key.startsWith('tmp/') && key.endsWith('-0'))
            {
                throw Object.assign(new Error('Xóa file tạm lỗi giả lập'), { code: 'EACCES' });
            }
            return remove(key);
        });

        const files = Array.from({ length: aborted ? 6 : 1 }, () => ({ filename: 'small.png' }));
        const { body } = await uploadFiles(files).expect(aborted ? 400 : 200);
        if (aborted)
        {
            assert.equal(body.error.code, 'TOO_MANY_FILES');
            await assertEmptyDb(prisma);
        }
        else
        {
            assert.equal(body.results[0].ok, true);
            assert.equal(await prisma.photo.count(), 1);
        }

        const record = await readSingleRecord(storage);
        assert.equal(record.reason, reason);
        assert.match(record.key, /^tmp\/[A-Za-z0-9_-]{12}-0$/);
        assert.deepEqual(await storage.listDir('tmp'), [record.key.slice('tmp/'.length)]);
        blocked.mock.restore();
        await runCleanup({ prisma, storage });
        assert.deepEqual(await storage.listDir('tmp'), []);
        assert.deepEqual(await storage.listDir('cleanup-queue'), []);
    });
}

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { test } = require('node:test');
const { createCleanupQueue } = require('../src/cleanup/queue');
const { runCleanup } = require('../src/cleanup/runCleanup');
const { prepareTest } = require('./helpers');

function gate()
{
    let open;
    const promise = new Promise(resolve =>
    {
        open = resolve;
    });
    return { promise, open };
}

test('cleanup.queue, .tmp đang ghi bị bỏ qua cho tới khi đổi tên nguyên tử', { timeout: 10000 }, async t =>
{
    const { prisma, scratch, objectStore, listObjectKeys, objectExists } = await prepareTest(t);
    const queue = createCleanupQueue({ scratch, objectStore });
    const key = 'originals/aaaaaaaaaaaa.png';
    await objectStore.put(key, Buffer.from('photo'), { contentType: 'image/png' });
    const wroteTemporary = gate();
    const finishWrite = gate();
    const writeFile = scratch.writeFile;
    t.mock.method(scratch, 'writeFile', async (target, content) =>
    {
        await writeFile(target, content);
        wroteTemporary.open();
        await finishWrite.promise;
    });

    const enqueued = queue.enqueue(key, 'test');
    try
    {
        await wroteTemporary.promise;
        const names = await scratch.listDir('cleanup-queue');
        assert.equal(names.length, 1);
        assert.match(names[0], /\.tmp$/);
        const summary = await runCleanup({ prisma, scratch, objectStore });
        assert.equal(summary.queueRecordsRemoved, 0);
        assert.equal(summary.queueTemporaryFilesRemoved, 0);
        assert.ok(await objectExists(key));
    }
    finally
    {
        finishWrite.open();
    }
    assert.equal(await enqueued, true);
    const names = await scratch.listDir('cleanup-queue');
    assert.equal(names.length, 1);
    assert.match(names[0], /\.json$/);
    await runCleanup({ prisma, scratch, objectStore });
    assert.deepEqual(await scratch.listDir('cleanup-queue'), []);
    assert.deepEqual(await listObjectKeys('originals/'), []);
});

test('cleanup.queue, hai lượt dọn đồng thời và enqueue trong lúc dọn', { timeout: 10000 }, async t =>
{
    const { prisma, scratch, objectStore, listObjectKeys } = await prepareTest(t);
    const queue = createCleanupQueue({ scratch, objectStore });
    const key = 'photos/aaaaaaaaaaaa/v1/320.webp';
    const newKey = 'originals/bbbbbbbbbbbb.png';
    await objectStore.put(key, Buffer.from('variant'), { contentType: 'image/webp' });
    await objectStore.put(newKey, Buffer.from('photo'), { contentType: 'image/png' });
    await queue.enqueue(key, 'test');
    const reachedDelete = gate();
    const finishDelete = gate();
    const remove = objectStore.delete;
    let calls = 0;
    t.mock.method(objectStore, 'delete', async target =>
    {
        if (target === key)
        {
            calls++;
            if (calls === 2) reachedDelete.open();
            await finishDelete.promise;
        }
        return remove(target);
    });
    const log = t.mock.method(console, 'error', () => undefined);

    const runs = Promise.all([runCleanup({ prisma, scratch, objectStore }), runCleanup({ prisma, scratch, objectStore })]);
    try
    {
        await reachedDelete.promise;
        assert.equal(await queue.enqueue(newKey, 'new'), true);
    }
    finally
    {
        finishDelete.open();
    }
    const summaries = await runs;
    assert.ok(summaries.some(result => result.queueRecordsRemoved === 1));
    assert.ok(summaries.some(result => result.queueFilesRemoved === 1));
    assert.deepEqual(log.mock.calls.map(call => call.arguments), []);
    assert.deepEqual(await listObjectKeys('photos/'), []);
    const [name] = await scratch.listDir('cleanup-queue');
    assert.equal(JSON.parse(await fs.readFile(scratch.keyToPath('cleanup-queue/' + name), 'utf8')).key, newKey);
    await runCleanup({ prisma, scratch, objectStore });
    assert.deepEqual(await scratch.listDir('cleanup-queue'), []);
    assert.deepEqual(await listObjectKeys('originals/'), []);
});

test('cleanup.queue, giữ bản ghi nếu xóa target vẫn lỗi', async t =>
{
    const { prisma, scratch, objectStore, objectExists } = await prepareTest(t);
    const queue = createCleanupQueue({ scratch, objectStore });
    const key = 'originals/aaaaaaaaaaaa.png';
    await objectStore.put(key, Buffer.from('photo'), { contentType: 'image/png' });
    assert.equal(await queue.enqueue(key, 'test'), true);
    const names = await scratch.listDir('cleanup-queue');
    const recordPath = scratch.keyToPath('cleanup-queue/' + names[0]);
    const record = await fs.readFile(recordPath, 'utf8');
    const deletion = t.mock.method(objectStore, 'delete', async () =>
    {
        throw Object.assign(new Error('Từ chối xóa giả lập'), { code: 'EACCES' });
    });
    const log = t.mock.method(console, 'error', () => undefined);

    const summary = await runCleanup({ prisma, scratch, objectStore });
    assert.equal(summary.queueRecordsRemoved, 0);
    assert.equal(log.mock.callCount(), 1);
    assert.equal(await fs.readFile(recordPath, 'utf8'), record);
    assert.ok(await objectExists(key));

    deletion.mock.restore();
    await runCleanup({ prisma, scratch, objectStore });
    assert.deepEqual(await scratch.listDir('cleanup-queue'), []);
});

test('cleanup.queue, cách ly JSON hỏng và dọn .tmp cũ', async t =>
{
    const { prisma, scratch, objectStore } = await prepareTest(t);
    const corrupt = 'cleanup-queue/1-aaaaaaaaaaaa.json';
    const source = 'cleanup-queue/2-bbbbbbbbbbbb.tmp';
    const recent = 'cleanup-queue/3-cccccccccccc.tmp';
    await scratch.writeFile(corrupt, '{');
    await scratch.writeFile(source, 'đang ghi');
    await scratch.writeFile(recent, 'đang ghi');
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(scratch.keyToPath(source), old, old);
    const log = t.mock.method(console, 'error', () => undefined);

    const summary = await runCleanup({ prisma, scratch, objectStore });
    assert.equal(summary.queueTemporaryFilesRemoved, 1);
    assert.deepEqual((await scratch.listDir('cleanup-queue')).sort(), ['1-aaaaaaaaaaaa.bad', '3-cccccccccccc.tmp']);
    assert.equal(log.mock.callCount(), 1);
    assert.equal(await fs.readFile(scratch.keyToPath('cleanup-queue/1-aaaaaaaaaaaa.bad'), 'utf8'), '{');
});

test('cleanup.queue, bỏ qua ENOENT khi đọc, đổi sang .bad và unlink bản ghi', async t =>
{
    const { prisma, scratch, objectStore } = await prepareTest(t);
    const missingOnRead = scratch.keyToPath('cleanup-queue/1-aaaaaaaaaaaa.json');
    const missingOnRename = scratch.keyToPath('cleanup-queue/2-bbbbbbbbbbbb.json');
    const missingOnUnlink = scratch.keyToPath('cleanup-queue/3-cccccccccccc.json');
    const key = 'originals/aaaaaaaaaaaa.png';
    await scratch.writeFile('cleanup-queue/1-aaaaaaaaaaaa.json', '{');
    await scratch.writeFile('cleanup-queue/2-bbbbbbbbbbbb.json', '{');
    await scratch.writeFile('cleanup-queue/3-cccccccccccc.json', JSON.stringify({ key, reason: 'test' }));
    await objectStore.put(key, Buffer.from('photo'), { contentType: 'image/png' });
    const unlink = fs.unlink;
    const readFile = fs.readFile;
    const rename = fs.rename;
    t.mock.method(fs, 'readFile', async (target, ...options) =>
    {
        if (target === missingOnRead) await unlink(target);
        return readFile(target, ...options);
    });
    t.mock.method(fs, 'rename', async (target, destination) =>
    {
        if (target === missingOnRename) await unlink(target);
        return rename(target, destination);
    });
    t.mock.method(fs, 'unlink', async target =>
    {
        if (target === missingOnUnlink) await unlink(target);
        return unlink(target);
    });
    const log = t.mock.method(console, 'error', () => undefined);

    const summary = await runCleanup({ prisma, scratch, objectStore });
    assert.equal(summary.queueFilesRemoved, 1);
    assert.equal(summary.queueRecordsRemoved, 0);
    assert.deepEqual(await scratch.listDir('cleanup-queue'), []);
    assert.deepEqual(log.mock.calls.map(call => call.arguments), []);
});

test('cleanup.queue, ghi log kèm key nếu không thể ghi hàng đợi', async t =>
{
    const { scratch, objectStore } = await prepareTest(t);
    const key = 'originals/aaaaaaaaaaaa.png';
    t.mock.method(scratch, 'writeFile', async () =>
    {
        throw Object.assign(new Error('Ổ đĩa đầy giả lập'), { code: 'ENOSPC' });
    });
    const log = t.mock.method(console, 'error', () => undefined);
    const queue = createCleanupQueue({ scratch, objectStore });

    assert.equal(await queue.enqueue(key, 'test'), false);
    assert.equal(log.mock.callCount(), 1);
    assert.ok(log.mock.calls[0].arguments[0].includes(key));
    assert.deepEqual(await scratch.listDir('cleanup-queue'), []);
});


test('cleanup.queue, lỗi đọc, đổi tên và unlink khác ENOENT giữ bản ghi', async t =>
{
    const { prisma, scratch, objectStore } = await prepareTest(t);
    const key = 'originals/aaaaaaaaaaaa.png';
    const names = ['1-aaaaaaaaaaaa.json', '2-bbbbbbbbbbbb.json', '3-cccccccccccc.json'];
    await scratch.writeFile('cleanup-queue/' + names[0], '{');
    await scratch.writeFile('cleanup-queue/' + names[1], '{');
    await scratch.writeFile('cleanup-queue/' + names[2], JSON.stringify({ key, reason: 'test' }));
    await objectStore.put(key, Buffer.from('photo'), { contentType: 'image/png' });
    const [readPath, renamePath, unlinkPath] = names.map(name => scratch.keyToPath('cleanup-queue/' + name));
    const denied = Object.assign(new Error('Từ chối thao tác bản ghi giả lập'), { code: 'EACCES' });
    const readFile = fs.readFile;
    const rename = fs.rename;
    const unlink = fs.unlink;
    const readMock = t.mock.method(fs, 'readFile', async (target, ...options) =>
    {
        if (target === readPath) throw denied;
        return readFile(target, ...options);
    });
    const renameMock = t.mock.method(fs, 'rename', async (target, destination) =>
    {
        if (target === renamePath) throw denied;
        return rename(target, destination);
    });
    const unlinkMock = t.mock.method(fs, 'unlink', async target =>
    {
        if (target === unlinkPath) throw denied;
        return unlink(target);
    });
    const log = t.mock.method(console, 'error', () => undefined);

    const summary = await runCleanup({ prisma, scratch, objectStore });
    assert.equal(summary.queueRecordsRemoved, 0);
    assert.equal(summary.queueFilesRemoved, 1);
    assert.equal(log.mock.callCount(), 3);
    assert.deepEqual((await scratch.listDir('cleanup-queue')).sort(), names);

    readMock.mock.restore();
    renameMock.mock.restore();
    unlinkMock.mock.restore();
    await runCleanup({ prisma, scratch, objectStore });
    assert.deepEqual((await scratch.listDir('cleanup-queue')).sort(), ['1-aaaaaaaaaaaa.bad', '2-bbbbbbbbbbbb.bad']);
});

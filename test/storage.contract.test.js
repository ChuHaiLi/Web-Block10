const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { buffer } = require('node:stream/consumers');
const { test } = require('node:test');
const { prepareStorage } = require('./helpers');
const { loadConfig } = require('../src/config');

const selectedDriver = process.env.STORAGE_DRIVER ?? loadConfig({ nodeEnv: 'test' }).storageDriver;
const drivers = ['local', 's3'];
const prefix = 'photos/aaaaaaaaaaaa/v1/';
const original = 'originals/aaaaaaaaaaaa.png';

for (const storageDriver of drivers)
{
    test('storage.contract ' + storageDriver, {
        skip: storageDriver === 's3' && selectedDriver !== 's3'
    }, async t =>
    {
        const { objectStore, scratch, objectExists } = await prepareStorage(t, { storageDriver });
        const bytes = Buffer.from([1, 0, 2, 255]);
        assert.equal(objectStore.describe().driver, storageDriver);
        await objectStore.ensureReady();

        const keys = [200, 320, 640, 960, 1600].map(width => prefix + width + '.webp');
        for (const key of keys) await objectStore.put(key, bytes, { contentType: 'image/webp' });
        await objectStore.put(original, bytes, { contentType: 'image/png' });

        const key = keys[0];
        assert.deepEqual(await objectStore.getBuffer(key), bytes);
        const media = await objectStore.getStream(key);
        assert.deepEqual(await buffer(media.body), bytes);
        assert.equal(media.contentLength, bytes.length);
        assert.equal(media.contentType, 'image/webp');
        assert.ok(media.lastModified instanceof Date && Number.isFinite(media.lastModified.getTime()));
        const png = await objectStore.getStream(original);
        assert.deepEqual(await buffer(png.body), bytes);
        assert.equal(png.contentType, 'image/png');

        const listed = [];
        for await (const item of objectStore.list(prefix, { pageSize: 2 }))
        {
            assert.equal(item.size, bytes.length);
            assert.ok(item.lastModified instanceof Date && Number.isFinite(item.lastModified.getTime()));
            listed.push(item.key);
        }
        assert.deepEqual(listed.sort(), keys.sort());

        assert.equal(await objectStore.delete(key), undefined);
        assert.equal(await objectStore.delete(key), undefined);
        assert.equal(await objectExists(key), false);
        await assert.rejects(objectStore.getBuffer(key), { code: 'NOT_FOUND' });
        await assert.rejects(objectStore.getStream(key), { code: 'NOT_FOUND' });

        for (const invalid of ['../escaped.png', key + '\n', 'tmp/aaaaaaaaaaaa-0', 'originals/short.png'])
        {
            await assert.rejects(objectStore.put(invalid, bytes, { contentType: 'image/png' }), { code: 'INVALID_KEY' });
            await assert.rejects(objectStore.getBuffer(invalid), { code: 'INVALID_KEY' });
            await assert.rejects(objectStore.getStream(invalid), { code: 'INVALID_KEY' });
            await assert.rejects(objectStore.delete(invalid), { code: 'INVALID_KEY' });
        }
        assert.throws(() => scratch.keyToPath(key), /Invalid scratch key/);
        assert.throws(() => scratch.keyToPath(original), /Invalid scratch key/);
    });
}

test('storage.local Windows kiểm tra EPERM và chỉ bỏ qua khi file đã mất', {
    skip: process.platform !== 'win32'
}, async t =>
{
    const { objectStore, objectExists } = await prepareStorage(t, { storageDriver: 'local' });
    const existing = original;
    const missing = 'originals/bbbbbbbbbbbb.png';
    await objectStore.put(existing, Buffer.from('fixture'), { contentType: 'image/png' });
    const { root } = objectStore.describe();
    const paths = [existing, missing].map(key => path.join(root, key));
    const unlink = fs.unlink;
    const denied = Object.assign(new Error('Chia sẻ file lỗi giả lập'), { code: 'EPERM' });
    t.mock.method(fs, 'unlink', async filePath =>
    {
        if (paths.includes(filePath)) throw denied;
        return unlink(filePath);
    });
    assert.equal(await objectStore.delete(missing), undefined);
    await assert.rejects(objectStore.delete(existing), { code: 'EPERM' });
    assert.ok(await objectExists(existing));
});

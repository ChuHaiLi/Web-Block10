const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { Readable } = require('node:stream');
const { test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const { prepareTest } = require('./helpers');

const boundary = 'block10-request-test';
const contentType = 'multipart/form-data; boundary=' + boundary;
const requestLimit = 55 * 1024 * 1024;
const partStart = '--' + boundary + '\r\n';
const partEnd = '--' + boundary + '--\r\n';

function field(name, value)
{
    return partStart + 'Content-Disposition: form-data; name="' + name + '"\r\n\r\n' + value + '\r\n';
}

function photoHeader(filename)
{
    return partStart + 'Content-Disposition: form-data; name="photos"; filename="' + filename +
        '"\r\nContent-Type: image/png\r\n\r\n';
}

async function assertNoUpload(prisma, storage)
{
    assert.equal(await prisma.photo.count(), 0);
    assert.equal(await prisma.photoVersion.count(), 0);
    assert.equal(await prisma.photoVariant.count(), 0);
    for (const directory of ['tmp', 'photos', 'originals'])
    {
        assert.deepEqual(await storage.listDir(directory), []);
    }
}

async function listen(t, handler)
{
    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() =>
    {
        server.closeAllConnections();
        return new Promise(resolve => server.close(resolve));
    });
    return server.address().port;
}

function postRaw(port, headers, body)
{
    return new Promise((resolve, reject) =>
    {
        const client = http.request({
            host: '127.0.0.1', port, method: 'POST', path: '/api/uploads',
            headers: { 'Content-Type': contentType, ...headers }
        }, res =>
        {
            body?.destroy();
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.once('error', reject);
            res.once('end', () =>
            {
                client.destroy();
                try
                {
                    resolve({ status: res.statusCode, headers: res.headers, json: JSON.parse(Buffer.concat(chunks)) });
                }
                catch (error)
                {
                    reject(error);
                }
            });
        });
        client.once('error', reject);
        client.setTimeout(6000, () => client.destroy(new Error('Request không kết thúc đúng hạn')));
        if (body) body.pipe(client);
        else client.flushHeaders();
    });
}

async function waitFor(condition)
{
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline)
    {
        if (await condition()) return;
        await delay(20);
    }
    assert.fail('Request không đạt trạng thái mong đợi đúng hạn');
}

test('upload.request nhận đủ 5 file trong một multipart', async t =>
{
    const { prisma, storage, uploadFiles } = await prepareTest(t);
    const files = Array.from({ length: 5 }, (_, index) => ({ filename: 'small.png', title: 'Ảnh ' + index }));
    const { body } = await uploadFiles(files).expect(200);
    assert.deepEqual(body.results.map(({ index, ok, photo }) => [index, ok, photo?.variants.map(variant => variant.width)]),
        [[0, true, [200]], [1, true, [200]], [2, true, [200]], [3, true, [200]], [4, true, [200]]]);
    assert.equal(await prisma.photo.count(), 5);
    assert.equal(await prisma.photoVariant.count(), 5);
    assert.deepEqual(await storage.listDir('tmp'), []);
});

test('upload.request từ chối file thứ 6 và không công bố file nào', async t =>
{
    const { prisma, storage, uploadFiles } = await prepareTest(t);
    const files = Array.from({ length: 6 }, () => ({ filename: 'small.png' }));
    const { body } = await uploadFiles(files).expect('Connection', 'close').expect(400);
    assert.equal(body.error.code, 'TOO_MANY_FILES');
    await assertNoUpload(prisma, storage);
});

test('upload.request từ chối sai Content-Type, thiếu boundary và multipart không có ảnh', async t =>
{
    const { prisma, storage, request } = await prepareTest(t);
    const nonMultipart = await request.post('/api/uploads').send({ photos: [] }).expect(400);
    assert.equal(nonMultipart.body.error.code, 'NOT_MULTIPART');
    const missingBoundary = await request.post('/api/uploads').set('Content-Type', 'multipart/form-data').send('x').expect(400);
    assert.equal(missingBoundary.body.error.code, 'MALFORMED');
    const noFiles = await request.post('/api/uploads').field('alt_0', 'Ảnh kiểm thử').expect(400);
    assert.equal(noFiles.body.error.code, 'NO_FILES');
    await assertNoUpload(prisma, storage);
});

test('upload.request dọn file tạm khi multipart bị cắt cụt', async t =>
{
    const { prisma, storage, request } = await prepareTest(t);
    const small = fs.readFileSync(path.join(__dirname, 'fixtures', 'small.png'));
    const brokenBody = Buffer.concat([
        Buffer.from(field('alt_0', 'Ảnh kiểm thử') + photoHeader('first.png')),
        small,
        Buffer.from('\r\n' + photoHeader('second.png')),
        small
    ]);
    const response = await request.post('/api/uploads').set('Content-Type', contentType).send(brokenBody).expect(400);
    assert.equal(response.body.error.code, 'MALFORMED');
    await assertNoUpload(prisma, storage);
});

test('upload.request từ chối vượt giới hạn trường và tổng số part', async t =>
{
    const { prisma, storage, request } = await prepareTest(t);
    const tooManyFields = Array.from({ length: 21 }, (_, index) => field('ignored_' + index, 'x')).join('');
    const tooManyParts = (partStart + 'Content-Type: text/plain\r\n\r\nx\r\n').repeat(31);
    for (const multipart of [tooManyFields, tooManyParts])
    {
        const response = await request.post('/api/uploads').set('Content-Type', contentType)
            .send(Buffer.from(multipart + partEnd)).expect(400);
        assert.equal(response.body.error.code, 'MALFORMED');
    }
    await assertNoUpload(prisma, storage);
});

test('upload.request từ chối Content-Length vượt 55 MiB trước khi nhận body', { timeout: 10000 }, async t =>
{
    const { app, prisma, storage } = await prepareTest(t);
    const port = await listen(t, app);
    const response = await postRaw(port, { 'Content-Length': requestLimit + 1 });
    assert.equal(response.status, 413);
    assert.equal(response.headers.connection, 'close');
    assert.equal(response.json.error.code, 'REQUEST_TOO_LARGE');
    await assertNoUpload(prisma, storage);
});

test('upload.request dừng chunked vượt 55 MiB và dọn file đang ghi', { timeout: 10000 }, async t =>
{
    const { app, prisma, storage } = await prepareTest(t);
    const port = await listen(t, app);
    function* multipart()
    {
        yield Buffer.from(field('alt_0', 'Ảnh kiểm thử') + photoHeader('large.png'));
        const chunk = Buffer.alloc(1024 * 1024, 0x78);
        for (let index = 0; index < 56; index++) yield chunk;
        yield Buffer.from('\r\n' + partEnd);
    }
    const response = await postRaw(port, { 'Transfer-Encoding': 'chunked' }, Readable.from(multipart()));
    assert.equal(response.status, 413);
    assert.equal(response.headers.connection, 'close');
    assert.equal(response.json.error.code, 'REQUEST_TOO_LARGE');
    await assertNoUpload(prisma, storage);
});

test('upload.request dọn mọi file tạm sau khi client ngắt giữa chừng', { timeout: 10000 }, async t =>
{
    const { app, prisma, storage } = await prepareTest(t);
    let incoming;
    const port = await listen(t, (req, res) =>
    {
        incoming = req;
        app(req, res);
    });
    const client = http.request({
        host: '127.0.0.1', port, method: 'POST', path: '/api/uploads',
        headers: { 'Content-Type': contentType, 'Transfer-Encoding': 'chunked' }
    });
    client.on('error', () => {});
    t.after(() => client.destroy());
    client.write(field('alt_0', 'Ảnh kiểm thử 0') + field('alt_1', 'Ảnh kiểm thử 1') + photoHeader('first.png'));
    client.write(Buffer.alloc(65536, 0x78));
    client.write('\r\n' + photoHeader('second.png'));
    client.write(Buffer.alloc(65536, 0x78));

    await waitFor(async () => (await storage.listDir('tmp')).length === 2);
    client.destroy();
    await waitFor(async () => incoming.aborted && incoming.listenerCount('data') === 0 &&
        (await storage.listDir('tmp')).length === 0);
    await assertNoUpload(prisma, storage);
});

test('upload.request trả 500 và dọn cả file tạm đã ghi trước lỗi ổ đĩa', { timeout: 10000 }, async t =>
{
    const { prisma, storage, uploadFiles } = await prepareTest(t);
    const createWriteStream = fs.createWriteStream;
    t.mock.method(fs, 'createWriteStream', (filePath, options) =>
    {
        const writer = createWriteStream(filePath, options);
        if (filePath.endsWith('-1'))
        {
            writer.once('open', () => writer.destroy(Object.assign(new Error('Lỗi ghi đĩa giả lập'), { code: 'ENOSPC' })));
        }
        return writer;
    });

    const response = await uploadFiles([{ filename: 'small.png' }, { filename: 'small.png' }])
        .expect('Connection', 'close').expect(500);
    assert.equal(response.body.error.code, 'STORAGE_ERROR');
    await assertNoUpload(prisma, storage);
});

test('createApp cho phép đặt FAULT_INJECT riêng cho app test', async t =>
{
    const { app, prisma, storage } = await prepareTest(t, { faultInject: 'db-after-write' });
    const { createApp } = require('../src/app');
    const secondApp = createApp({ prisma, storage, faultInject: 'edit-db-after-write' });
    assert.equal(app.get('faultInject'), 'db-after-write');
    assert.equal(secondApp.get('faultInject'), 'edit-db-after-write');
    assert.equal(createApp({ prisma, storage }).get('faultInject'), '');
});

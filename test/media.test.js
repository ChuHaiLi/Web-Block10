const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const { Readable } = require('node:stream');
const { test } = require('node:test');
const { prepareTest } = require('./helpers');

test('media GET stream đúng WebP, Content-Length và bytes trong object store', async t =>
{
    const { request, readObject, uploadFiles } = await prepareTest(t);
    const upload = await uploadFiles([{ filename: 'photo.png' }]).expect(200);
    const [result] = upload.body.results;
    assert.equal(result.ok, true, JSON.stringify(result));

    const { url } = result.photo.variants[0];
    const bytes = await readObject(url.slice('/media/'.length));
    const media = await request.get(url)
        .expect(200)
        .expect('Content-Length', String(bytes.length))
        .expect('Content-Type', 'image/webp')
        .expect('Cache-Control', 'public, max-age=31536000, immutable')
        .expect('X-Content-Type-Options', 'nosniff');
    assert.deepEqual(media.body, bytes);
    const head = await request.head(url).expect('Content-Length', String(bytes.length)).expect(200);
    assert.equal(head.text, undefined);
    for (const response of [media, head])
    {
        for (const header of ['accept-ranges', 'etag', 'last-modified'])
        {
            assert.equal(response.headers[header], undefined);
        }
    }

    for (const [header, value] of [
        ['Range', 'bytes=5-9'],
        ['Range', 'bytes=' + bytes.length + '-'],
        ['If-Match', '"mismatched"'],
        ['If-None-Match', '*']
    ])
    {
        const full = await request.get(url).set(header, value).expect(200)
            .expect('Content-Length', String(bytes.length));
        assert.equal(full.headers['content-range'], undefined);
        assert.deepEqual(full.body, bytes);
    }
});

test('media GET trả 404 với key sai, file riêng, file mồ côi hoặc ảnh bị ẩn', async t =>
{
    const { prisma, request, objectStore, readObject, uploadFiles } = await prepareTest(t);
    const upload = await uploadFiles([{ filename: 'photo.png' }]).expect(200);
    const [result] = upload.body.results;
    assert.equal(result.ok, true, JSON.stringify(result));

    const { id, variants } = result.photo;
    const { url } = variants[0];
    const key = url.slice('/media/'.length);
    const orphan = 'photos/' + id + '/v1/321.webp';
    await objectStore.put(orphan, await readObject(key), { contentType: 'image/webp' });

    await request.get('/media/photos/invalid/v1/320.webp').expect(404);
    await request.get('/media/%zz').expect(404);
    await request.get('/media/%2e%2e%2foriginals%2f' + id + '.png').expect(404);
    await request.get('/media/originals/' + id + '.png').expect(404);
    await request.get('/media/' + orphan).expect(404);

    await prisma.photoVersion.update({ where: { photoId_version: { photoId: id, version: 1 } }, data: { purgedAt: new Date() } });
    await request.get(url).expect(404);
    await prisma.photoVersion.update({ where: { photoId_version: { photoId: id, version: 1 } }, data: { purgedAt: null } });

    await prisma.photo.update({ where: { id }, data: { status: 'DELETING' } });
    await request.get(url).expect(404);
    await prisma.photo.update({ where: { id }, data: { status: 'PUBLISHED' } });

    await objectStore.delete(key);
    assert.equal(await prisma.photoVariant.count({ where: { storageKey: key } }), 1);
    const missing = await request.get(url).expect(404);
    assert.equal(missing.headers['cache-control'], undefined);
});

test('media lỗi đọc trước byte đầu tiên không kèm cache ảnh, local trả 500 và S3 trả 502', async t =>
{
    const { request, objectStore, uploadFiles } = await prepareTest(t);
    const { body } = await uploadFiles([{ filename: 'small.png' }]).expect(200);
    assert.equal(body.results[0].ok, true);
    const [{ url }] = body.results[0].photo.variants;
    const error = Object.assign(new Error('Lỗi kho giả lập'), { code: 'ECONNRESET' });
    let driver = 's3';
    t.mock.method(objectStore, 'describe', () => ({ driver }));
    t.mock.method(console, 'error', () => undefined);
    const stream = t.mock.method(objectStore, 'getStream', async () => { throw error; });
    const failedBeforeStream = await request.get(url).expect(502);
    assert.equal(failedBeforeStream.headers['cache-control'], undefined);

    stream.mock.restore();
    t.mock.method(objectStore, 'getStream', async () => ({
        body: new Readable({ read() { this.destroy(error); } }),
        contentLength: 10,
        lastModified: new Date()
    }));
    const failedBeforeFirstByte = await request.get(url).expect(502);
    assert.equal(failedBeforeFirstByte.headers['cache-control'], undefined);

    driver = 'local';
    const localFailure = await request.get(url).expect(500);
    assert.equal(localFailure.headers['cache-control'], undefined);
});

test('media hủy stream khi client ngắt kết nối', { timeout: 10000 }, async t =>
{
    const { app, objectStore, uploadFiles } = await prepareTest(t);
    const { body } = await uploadFiles([{ filename: 'small.png' }]).expect(200);
    assert.equal(body.results[0].ok, true);
    const [{ url }] = body.results[0].photo.variants;
    const source = new Readable({ read() {} });
    source.push(Buffer.alloc(1024));
    const closed = new Promise(resolve => source.once('close', resolve));
    t.mock.method(objectStore, 'getStream', async () => ({
        body: source, contentLength: 2048, lastModified: new Date()
    }));

    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve =>
    {
        server.close(resolve);
        server.closeAllConnections();
    }));
    const client = http.get('http://127.0.0.1:' + server.address().port + url);
    t.after(() => client.destroy());
    const [response] = await once(client, 'response');
    assert.equal(response.statusCode, 200);
    const [chunk] = await once(response, 'data');
    assert.ok(chunk.length > 0 && chunk.length <= 1024);
    response.destroy();
    await closed;
    assert.ok(source.destroyed);
});

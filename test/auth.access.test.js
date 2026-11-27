const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { buffer } = require('node:stream/consumers');
const { test } = require('node:test');
const { prepareTest, registerAndLogin } = require('./helpers');

const fixture = path.join(__dirname, 'fixtures', 'small.png');
const edits = { baseVersion: 1, rotate: 90, flipH: false, crop: null };

test('auth.access khách bị từ chối upload trước khi server nhận hoặc ghi body', { timeout: 15000 }, async t =>
{
    const { app, guest, prisma, scratch, listObjectKeys } = await prepareTest(t, { authenticated: false });
    await guest.get('/upload').expect('Location', '/login?next=/upload').expect(303);

    const writer = t.mock.method(fs, 'createWriteStream');
    const rejected = await guest.post('/api/uploads').field('alt_0', 'Ảnh khách')
        .attach('photos', fixture).expect('Connection', 'close').expect(401);
    assert.equal(rejected.body.error.code, 'UNAUTHENTICATED');
    assert.equal(writer.mock.callCount(), 0);

    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve =>
    {
        server.close(resolve);
        server.closeAllConnections();
    }));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const client = http.request(origin + '/api/uploads', {
        method: 'POST',
        headers: {
            Origin: origin, 'Content-Type': 'multipart/form-data; boundary=access-test', 'Content-Length': '65536'
        }
    });
    t.after(() => client.destroy());
    client.setTimeout(5000, () => client.destroy(new Error('Server không trả 401 trước khi nhận body')));
    client.flushHeaders();
    const [response] = await once(client, 'response');
    assert.equal(response.statusCode, 401);
    assert.equal(response.headers.connection, 'close');
    assert.equal(JSON.parse((await buffer(response)).toString('utf8')).error.code, 'UNAUTHENTICATED');
    assert.equal(writer.mock.callCount(), 0);
    assert.deepEqual(await scratch.listDir('tmp'), []);
    assert.deepEqual(await listObjectKeys(), []);
    assert.equal(await prisma.photo.count(), 0);
    assert.equal(await prisma.user.count(), 0);
});

test('auth.access gallery và media công khai, chỉ chủ ảnh được sửa và xóa', async t =>
{
    const { app, guest, request: owner, prisma, readObject, uploadFiles } = await prepareTest(t);
    const other = await registerAndLogin(app, { username: 'other-user' });
    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { username: 'test-user' } });
    const otherUser = await prisma.user.findUniqueOrThrow({ where: { username: 'other-user' } });
    const { body: uploaded } = await uploadFiles([{ filename: 'small.png' }]).field('ownerId', otherUser.id).expect(200);
    assert.equal(uploaded.results[0].ok, true);
    const { id, url, variants } = uploaded.results[0].photo;
    const api = '/api' + url + '/edits';
    const edit = url + '/edit';
    const source = edit + '/source';
    const remove = url + '/delete';
    const snapshot = () => prisma.photo.findUniqueOrThrow({
        where: { id }, include: { versions: { orderBy: { version: 'asc' } }, variants: { orderBy: { id: 'asc' } } }
    });
    const published = await snapshot();
    assert.equal(published.ownerId, ownerUser.id);
    const original = await readObject(published.originalKey);

    for (const actor of [guest, other, owner])
    {
        const gallery = await actor.get('/').expect(200);
        assert.ok(gallery.text.includes('id="photo-' + id + '"'));
        await actor.get(variants[0].url).expect(200);
        const detail = await actor.get(url).expect(200);
        assert.equal(detail.text.includes('href="' + edit + '"'), actor === owner);
        assert.equal(detail.text.includes('action="' + remove + '"'), actor === owner);
    }

    for (const target of [edit, source])
    {
        await guest.get(target).expect('Location', '/login?next=' + target).expect(303);
        await other.get(target).expect(403);
        await owner.get(target).expect(200);
    }
    const anonymousEdit = await guest.post(api).set('Content-Type', 'application/json').send('{').expect(401);
    assert.equal(anonymousEdit.body.error.code, 'UNAUTHENTICATED');
    await guest.post(remove).expect('Location', '/login?next=' + url).expect(303);
    const forbiddenEdit = await other.post(api).send(edits).expect(403);
    assert.equal(forbiddenEdit.body.error.code, 'FORBIDDEN');
    await other.post(remove).expect(403);
    assert.deepEqual(await snapshot(), published);
    assert.deepEqual(await readObject(published.originalKey), original);
    await guest.get(variants[0].url).expect(200);

    await owner.get('/upload').expect(200);
    await other.get('/upload').expect(200);
    const { body: otherUpload } = await other.post('/api/uploads').field('alt_0', 'Ảnh người khác')
        .attach('photos', fixture).expect(200);
    assert.equal(otherUpload.results[0].ok, true);
    assert.equal((await prisma.photo.findUniqueOrThrow({ where: { id: otherUpload.results[0].photo.id } })).ownerId, otherUser.id);

    const { body: edited } = await owner.post(api).send(edits).expect(200);
    assert.equal(edited.version, 2);
    assert.equal((await snapshot()).ownerId, ownerUser.id);
    await owner.post(remove).expect('Location', '/').expect(303);
    assert.equal((await snapshot()).status, 'PURGED');
    await guest.get(variants[0].url).expect(404);
});

test('auth.access ảnh thiếu hoặc không PUBLISHED trả 404 cho cả ba vai trò', async t =>
{
    const { app, guest, request: owner, prisma, uploadFiles } = await prepareTest(t);
    const other = await registerAndLogin(app, { username: 'other-user' });
    const { body } = await uploadFiles([{ filename: 'small.png' }]).expect(200);
    assert.equal(body.results[0].ok, true);
    const { id, url } = body.results[0].photo;

    async function expectMissing(photoUrl)
    {
        for (const actor of [guest, other, owner])
        {
            await actor.get(photoUrl + '/edit').expect(404);
            await actor.get(photoUrl + '/edit/source').expect(404);
            const missing = await actor.post('/api' + photoUrl + '/edits').send(edits).expect(404);
            assert.equal(missing.body.error.code, 'NOT_FOUND');
            await actor.post(photoUrl + '/delete').expect(404);
        }
    }

    await expectMissing('/photos/aaaaaaaaaaaa');
    for (const status of ['DELETING', 'PURGED'])
    {
        await prisma.photo.update({ where: { id }, data: { status } });
        await expectMissing(url);
    }
});

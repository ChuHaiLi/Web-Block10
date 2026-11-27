const assert = require('node:assert/strict');
const { test } = require('node:test');
const renderer = require('../src/edit/renderEdits');
const { prepareTest } = require('./helpers');

function pauseRender(t, count)
{
    let markReady;
    let resume;
    const ready = new Promise(resolve =>
    {
        markReady = resolve;
    });
    const released = new Promise(resolve =>
    {
        resume = resolve;
    });
    let entered = 0;
    const render = renderer.renderEdits;
    t.mock.method(renderer, 'renderEdits', async (...args) =>
    {
        entered++;
        if (entered === count) markReady();
        await released;
        return render(...args);
    });
    return { ready, resume };
}

const full = { rotate: 90, flipH: true, crop: null };

for (const restoreInRace of [false, true])
{
    const description = restoreInRace ? 'Lưu và Khôi phục' : 'hai lần Lưu';
    test('edit.concurrent ' + description + ' chỉ một request commit', { timeout: 15000 }, async t =>
    {
        const { prisma, request, scratch, listObjectKeys, uploadFiles } = await prepareTest(t);
        const { body } = await uploadFiles([{ filename: 'corners.png' }]).expect(200);
        assert.equal(body.results[0].ok, true);
        const { id, variants } = body.results[0].photo;
        const url = '/api/photos/' + id + '/edits';
        if (restoreInRace)
        {
            await request.post(url).send({ baseVersion: 1, rotate: 180, flipH: true, crop: null }).expect(200);
        }

        const before = await prisma.photo.findUniqueOrThrow({
            where: { id }, include: { versions: { orderBy: { version: 'asc' } } }
        });
        const baseVersion = before.currentVersion;
        const editOptions = [full, restoreInRace ? { restore: true } : { ...full, rotate: 180 }];
        const pause = pauseRender(t, 2);
        const saves = editOptions.map(edits => request.post(url)
            .send({ baseVersion, ...edits })
            .expect(response => assert.ok([200, 409].includes(response.status), JSON.stringify(response.body)))
            .then(response => response));
        try
        {
            await Promise.race([pause.ready, Promise.race(saves).then(() => assert.fail('Request kết thúc trước khi cả hai vào render'))]);
        }
        finally
        {
            pause.resume();
        }
        const replies = await Promise.all(saves);

        assert.deepEqual(replies.map(response => response.status).sort(), [200, 409]);
        const winnerIndex = replies.findIndex(response => response.status === 200);
        const winner = replies[winnerIndex].body;
        const conflict = replies[1 - winnerIndex].body;
        assert.equal(conflict.error.code, 'VERSION_CONFLICT');
        assert.equal(conflict.currentVersion, winner.version);
        assert.ok([before.nextVersion, before.nextVersion + 1].includes(winner.version));
        const loser = winner.version === before.nextVersion ? before.nextVersion + 1 : before.nextVersion;

        const after = await prisma.photo.findUniqueOrThrow({
            where: { id }, include: { versions: { orderBy: { version: 'asc' } }, variants: true }
        });
        assert.deepEqual([after.currentVersion, after.nextVersion], [winner.version, before.nextVersion + 2]);
        assert.deepEqual(after.versions.map(row => row.version), [...before.versions.map(row => row.version), winner.version]);
        assert.ok(after.versions.find(row => row.version === baseVersion).supersededAt instanceof Date);
        const winnerEdits = editOptions[winnerIndex];
        assert.deepEqual(after.versions.at(-1).edits, winnerEdits.restore ? { rotate: 0, flipH: false, crop: null } : winnerEdits);
        assert.ok(after.variants.every(variant => variant.version !== loser));
        assert.deepEqual(await listObjectKeys('photos/' + id + '/v' + loser + '/'), []);
        assert.deepEqual(await scratch.listDir('cleanup-queue'), []);
        for (const { url: media } of [...variants, ...winner.variants]) await request.get(media).expect(200);
        const loserWidths = editOptions[1 - winnerIndex].rotate === 90 ? [300] : [320, 400];
        for (const width of loserWidths)
        {
            await request.get('/media/photos/' + id + '/v' + loser + '/' + width + '.webp').expect(404);
        }
    });
}

test('edit.concurrent xóa trong lúc render trả 404 và dọn version đang lưu', { timeout: 15000 }, async t =>
{
    const { prisma, request, scratch, objectStore, listObjectKeys, uploadFiles } = await prepareTest(t);
    const { body } = await uploadFiles([{ filename: 'corners.png' }]).expect(200);
    assert.equal(body.results[0].ok, true);
    const { id } = body.results[0].photo;
    const pause = pauseRender(t, 1);
    const writing = [];
    const put = objectStore.put;
    t.mock.method(objectStore, 'put', async (key, bytes, options) =>
    {
        if (key.startsWith('photos/' + id + '/v2/')) writing.push(key);
        return put(key, bytes, options);
    });
    const save = request.post('/api/photos/' + id + '/edits')
        .send({ baseVersion: 1, ...full }).expect(404).then(response => response);

    try
    {
        await Promise.race([pause.ready, save.then(() => assert.fail('Request kết thúc trước render'))]);
        await request.post('/photos/' + id + '/delete').expect('Location', '/').expect(303);
        const deleted = await prisma.photo.findUniqueOrThrow({ where: { id } });
        assert.equal(deleted.status, 'PURGED');
    }
    finally
    {
        pause.resume();
    }

    const response = await save;
    assert.equal(response.body.error.code, 'NOT_FOUND');
    const stored = await prisma.photo.findUniqueOrThrow({
        where: { id }, include: { versions: true, variants: true }
    });
    assert.deepEqual([stored.status, stored.currentVersion, stored.nextVersion], ['PURGED', 1, 3]);
    assert.deepEqual(stored.versions.map(row => row.version), [1]);
    assert.ok(stored.variants.every(variant => variant.version === 1));
    assert.deepEqual(writing, ['photos/' + id + '/v2/300.webp']);
    assert.deepEqual(await listObjectKeys('photos/'), []);
    assert.deepEqual(await listObjectKeys('originals/'), []);
    assert.deepEqual(await scratch.listDir('cleanup-queue'), []);
    await request.get('/media/' + writing[0]).expect(404);
});

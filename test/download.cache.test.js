const assert = require('node:assert/strict');
const { test } = require('node:test');
const sharp = require('sharp');
const renderer = require('../src/edit/renderEdits');
const { prepareTest } = require('./helpers');

test('download.cache tái sử dụng file đã tạo và gộp request đồng thời cùng key', async t =>
{
    const { guest, uploadFiles } = await prepareTest(t);
    const { body } = await uploadFiles([{ filename: 'photo.jpg' }]).expect(200);
    const { id } = body.results[0].photo;

    const originalRender = renderer.renderEdits;
    let enteredFirst;
    let releaseFirst;
    const firstEntered = new Promise(resolve =>
    {
        enteredFirst = resolve;
    });
    const allowFirst = new Promise(resolve =>
    {
        releaseFirst = resolve;
    });

    let callCount = 0;
    t.mock.method(renderer, 'renderEdits', async (...args) =>
    {
        callCount++;
        if (callCount === 1)
        {
            enteredFirst();
            await allowFirst;
        }
        return originalRender(...args);
    });

    const url = `/photos/${id}/v/1/download/1366x768`;
    const firstReq = guest.get(url).expect(200).then(res => res);
    await firstEntered;
    const secondReq = guest.get(url).expect(200).then(res => res);
    releaseFirst();

    const [first, second] = await Promise.all([firstReq, secondReq]);
    assert.equal(callCount, 1);
    assert.deepEqual(first.body, second.body);

    // Subsequent request hits object store cache without calling renderEdits.
    const cached = await guest.get(url).expect(200);
    assert.equal(callCount, 1);
    assert.deepEqual(cached.body, first.body);
});

test('download.cache giới hạn tối đa 2 render chạy song song trong tiến trình', { timeout: 15000 }, async t =>
{
    const { guest, request } = await prepareTest(t);
    const uhdBuffer = await sharp({
        create: { width: 3840, height: 2160, channels: 3, background: '#264653' }
    }).png().toBuffer();

    const { body } = await request.post('/api/uploads')
        .field('alt_0', 'Ảnh 4K semaphore')
        .attach('photos', uhdBuffer, 'uhd.png')
        .expect(200);
    const { id } = body.results[0].photo;

    const originalRender = renderer.renderEdits;
    let active = 0;
    let maxActive = 0;
    let totalCalls = 0;
    let twoActive;
    let releaseBatch;
    const reachedTwo = new Promise(resolve =>
    {
        twoActive = resolve;
    });
    const allowBatch = new Promise(resolve =>
    {
        releaseBatch = resolve;
    });

    t.mock.method(renderer, 'renderEdits', async (...args) =>
    {
        totalCalls++;
        active++;
        if (active > maxActive) maxActive = active;
        if (active === 2) twoActive();
        try
        {
            await allowBatch;
            return await originalRender(...args);
        }
        finally
        {
            active--;
        }
    });

    const sizes = ['original', '1366x768', '1920x1080', '2560x1440'];
    const requests = sizes.map(size => guest.get(`/photos/${id}/v/1/download/${size}`).expect(200).then(res => res));

    try
    {
        await reachedTwo;
        // Give the event loop a tick to verify a 3rd render does not enter before a slot frees.
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(active, 2);
        assert.equal(maxActive, 2);
        assert.equal(totalCalls, 2);
    }
    finally
    {
        releaseBatch();
    }

    const responses = await Promise.all(requests);
    assert.equal(totalCalls, 4);
    assert.equal(maxActive, 2);
    assert.equal(active, 0);
    const dims = await Promise.all(responses.map(async res =>
    {
        const m = await sharp(res.body).metadata();
        return [m.width, m.height];
    }));
    assert.deepEqual(dims, [[3840, 2160], [1366, 768], [1920, 1080], [2560, 1440]]);
});

const assert = require('node:assert/strict');
const { test } = require('node:test');
const sharp = require('sharp');
const { getAvailablePresetGroups } = require('../src/download/presets');
const { prepareTest } = require('./helpers');

test('download.presets lọc theo kích thước version và tạo file đúng kích thước', async t =>
{
    const { guest, request, objectExists, uploadFiles } = await prepareTest(t);

    // 2000x1333: only 1366x768, 1920x1080, 1920x1200 have both width <= 2000 and height <= 1333.
    const { body: smallUpload } = await uploadFiles([{ filename: 'photo.jpg', title: 'Ảnh mẫu' }]).expect(200);
    assert.equal(smallUpload.results[0].ok, true);
    const smallId = smallUpload.results[0].photo.id;

    const hd = await guest.get(`/photos/${smallId}/v/1/download/1366x768`)
        .expect(200)
        .expect('Content-Type', 'image/jpeg');
    const hdMeta = await sharp(hd.body).metadata();
    assert.deepEqual([hdMeta.width, hdMeta.height], [1366, 768]);
    assert.match(hd.headers['content-disposition'], /filename="Anh-mau-1366x768\.jpg"/);

    await guest.get(`/photos/${smallId}/v/1/download/1920x1080`).expect(200);
    await guest.get(`/photos/${smallId}/v/1/download/1920x1200`).expect(200);
    for (const oversized of ['2560x1440', '1080x1920', '1620x2160'])
    {
        const rejected = await guest.get(`/photos/${smallId}/v/1/download/${oversized}`).expect(404);
        assert.equal(rejected.headers['cache-control'], undefined);
    }

    // 3840x2160 4K image: accepts 1920x1080 and 3840x2160, rejects 5120x2880.
    const uhdBuffer = await sharp({
        create: { width: 3840, height: 2160, channels: 3, background: '#1e3a5f' }
    }).png().toBuffer();
    const { body: uhdUpload } = await request.post('/api/uploads')
        .field('title_0', 'Cảnh 4K')
        .field('alt_0', 'Ảnh 4K kiểm thử')
        .attach('photos', uhdBuffer, 'uhd.png')
        .expect(200);
    assert.equal(uhdUpload.results[0].ok, true);
    const uhdId = uhdUpload.results[0].photo.id;

    const fullHd = await guest.get(`/photos/${uhdId}/v/1/download/1920x1080`)
        .expect(200)
        .expect('Content-Type', 'image/jpeg');
    const fullHdMeta = await sharp(fullHd.body).metadata();
    assert.deepEqual([fullHdMeta.width, fullHdMeta.height], [1920, 1080]);
    assert.equal(fullHdMeta.exif, undefined);
    assert.ok(await objectExists(`photos/${uhdId}/v1/dl/1920x1080.jpg`));

    // Shared preset 2560x1600 (present in both Desktop and Tablet) uses the same key.
    await guest.get(`/photos/${uhdId}/v/1/download/2560x1600`).expect(200);
    assert.ok(await objectExists(`photos/${uhdId}/v1/dl/2560x1600.jpg`));
    await guest.get(`/photos/${uhdId}/v/1/download/5120x2880`).expect(404);

    // Invalid size strings and invalid version parameters -> 404.
    for (const invalidPath of [
        `/photos/${uhdId}/v/1/download/1000x1000`,
        `/photos/${uhdId}/v/1/download/800x600`,
        `/photos/${uhdId}/v/1/download/01920x1080`,
        `/photos/${uhdId}/v/1/download/unknown`,
        `/photos/${uhdId}/v/0/download/original`,
        `/photos/${uhdId}/v/-1/download/original`,
        `/photos/${uhdId}/v/abc/download/original`,
        `/photos/${uhdId}/v/9999999999/download/original`,
        `/photos/${uhdId}/v/99/download/original`,
        '/photos/short/v/1/download/original'
    ])
    {
        const res = await guest.get(invalidPath).expect(404);
        assert.equal(res.headers['cache-control'], undefined);
    }

    // After crop edit to 1500x900, v2 only accepts 1366x768 (rejects 1920x1080), while v1 still accepts 1920x1080.
    await request.post(`/api/photos/${smallId}/edits`)
        .send({ baseVersion: 1, rotate: 0, flipH: false, crop: { x: 0, y: 0, width: 1500, height: 900 } })
        .expect(200);

    const v2Original = await guest.get(`/photos/${smallId}/v/2/download/original`).expect(200);
    const v2OrigMeta = await sharp(v2Original.body).metadata();
    assert.deepEqual([v2OrigMeta.width, v2OrigMeta.height], [1500, 900]);

    await guest.get(`/photos/${smallId}/v/2/download/1366x768`).expect(200);
    await guest.get(`/photos/${smallId}/v/2/download/1920x1080`).expect(404);
    await guest.get(`/photos/${smallId}/v/1/download/1920x1080`).expect(200);
});

test('download.presets getAvailablePresetGroups ẩn nhóm rỗng', () =>
{
    assert.deepEqual(getAvailablePresetGroups(200, 150), []);

    const cropped = getAvailablePresetGroups(1500, 900);
    assert.deepEqual(cropped.map(group => group.id), ['desktop']);
    assert.deepEqual(cropped[0].items.map(item => `${item.width}x${item.height}`), ['1366x768']);

    const uhd = getAvailablePresetGroups(3840, 2160);
    assert.deepEqual(uhd.map(group => group.id), ['desktop', 'phone', 'tablet']);
    assert.deepEqual(uhd.find(g => g.id === 'phone').items.map(i => `${i.width}x${i.height}`), ['1080x1920']);
    assert.ok(uhd[0].items.some(item => item.width === 2560 && item.height === 1600));
    assert.ok(uhd[2].items.some(item => item.width === 2560 && item.height === 1600));
    assert.ok(!uhd[0].items.some(item => item.width === 5120));
});

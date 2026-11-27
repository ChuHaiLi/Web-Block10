const assert = require('node:assert/strict');
const { test } = require('node:test');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { downloadKeyPattern, isObjectKey } = require('../src/storage/objectStore');
const { prepareTest } = require('./helpers');

test('download.original khách tải được JPEG chuẩn hóa, không EXIF, đúng header và tên file tiếng Việt', async t =>
{
    const { prisma, app, guest, objectStore, scratch, authOptions, uploadFiles } = await prepareTest(t);
    const title = 'Ảnh Đẹp: Bãi biển / Hoàng hôn *2026*?';
    const { body } = await uploadFiles([{ filename: 'exif-rotated.jpg', title }]).expect(200);
    assert.equal(body.results[0].ok, true);
    const { id } = body.results[0].photo;

    let sessionReads = 0;
    const observedPrisma = prisma.$extends({
        query: {
            session: {
                findUnique({ args, query })
                {
                    sessionReads++;
                    return query(args);
                }
            }
        }
    });
    const guestApp = createApp({ prisma: observedPrisma, objectStore, scratch, ...authOptions });
    const supertest = require('supertest');
    const guestWithObserver = supertest(guestApp);

    const downloadUrl = `/photos/${id}/v/1/download/original`;
    const response = await guestWithObserver.get(downloadUrl)
        .expect(200)
        .expect('Content-Type', 'image/jpeg')
        .expect('Cache-Control', 'public, max-age=31536000, immutable')
        .expect('X-Content-Type-Options', 'nosniff');

    assert.equal(response.headers['set-cookie'], undefined);
    assert.equal(sessionReads, 0);
    assert.equal(response.headers['content-length'], String(response.body.length));

    const disposition = response.headers['content-disposition'];
    assert.match(disposition, /^attachment; filename="Anh-Dep-Bai-bien-Hoang-hon-2026-original-800x1200\.jpg"; filename\*=UTF-8''/);
    const utf8Encoded = disposition.split("filename*=UTF-8''")[1];
    assert.equal(decodeURIComponent(utf8Encoded), 'Ảnh Đẹp Bãi biển  Hoàng hôn 2026-original-800x1200.jpg');

    const metadata = await sharp(response.body).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.equal(metadata.isProgressive, true);
    assert.equal(metadata.width, 800);
    assert.equal(metadata.height, 1200);
    assert.equal(metadata.exif, undefined);

    // Download key exists in objectStore, matches downloadKeyPattern, and is NOT served by /media.
    const key = `photos/${id}/v1/dl/original.jpg`;
    assert.ok(downloadKeyPattern.test(key));
    assert.ok(isObjectKey(key));
    await guest.get('/media/' + key).expect(404);
});

test('download.original tiêu đề chỉ toàn ký tự đặc biệt dùng fallback photo-<id>', async t =>
{
    const { guest, uploadFiles } = await prepareTest(t);
    const { body } = await uploadFiles([{ filename: 'small.png', title: '///:***' }]).expect(200);
    assert.equal(body.results[0].ok, true);
    const { id } = body.results[0].photo;

    const response = await guest.get(`/photos/${id}/v/1/download/original`).expect(200);
    const disposition = response.headers['content-disposition'];
    assert.equal(
        disposition,
        `attachment; filename="photo-${id}-original-200x150.jpg"; filename*=UTF-8''photo-${id}-original-200x150.jpg`
    );
});

test('download.original PNG có kênh alpha tải về định dạng PNG giữ alpha', async t =>
{
    const { guest, request, objectExists, uploadFiles } = await prepareTest(t);
    const alphaPng = await sharp({
        create: { width: 300, height: 200, channels: 4, background: { r: 20, g: 140, b: 220, alpha: 0.4 } }
    }).png().toBuffer();

    const { body } = await request.post('/api/uploads')
        .field('title_0', 'Nền trong suốt')
        .field('alt_0', 'Ảnh PNG có alpha')
        .attach('photos', alphaPng, 'alpha.png')
        .expect(200);
    assert.equal(body.results[0].ok, true);
    const { id } = body.results[0].photo;

    const response = await guest.get(`/photos/${id}/v/1/download/original`)
        .expect(200)
        .expect('Content-Type', 'image/png')
        .expect('Cache-Control', 'public, max-age=31536000, immutable')
        .expect('X-Content-Type-Options', 'nosniff');

    const metadata = await sharp(response.body).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.hasAlpha, true);
    assert.equal(metadata.width, 300);
    assert.equal(metadata.height, 200);
    assert.equal(metadata.exif, undefined);
    assert.match(response.headers['content-disposition'], /filename="Nen-trong-suot-original-300x200\.png"/);
    assert.ok(await objectExists(`photos/${id}/v1/dl/original.png`));

    // Cached hit also serves PNG.
    await guest.get(`/photos/${id}/v/1/download/original`)
        .expect(200)
        .expect('Content-Type', 'image/png');
});

test('download.original nhánh lỗi không mang Cache-Control, S3 trả 502 và local trả 500', async t =>
{
    const { guest, objectStore, uploadFiles } = await prepareTest(t);
    const { body } = await uploadFiles([{ filename: 'small.png' }]).expect(200);
    const { id } = body.results[0].photo;

    const notFound = await guest.get('/photos/aaaaaaaaaaaa/v/1/download/original').expect(404);
    assert.equal(notFound.headers['cache-control'], undefined);

    let driver = 's3';
    t.mock.method(objectStore, 'describe', () => ({ driver }));
    t.mock.method(console, 'error', () => undefined);
    t.mock.method(objectStore, 'getBuffer', async () =>
    {
        throw Object.assign(new Error('Lỗi đọc kho giả lập'), { code: 'ECONNRESET' });
    });

    const s3Failed = await guest.get(`/photos/${id}/v/1/download/original`).expect(502);
    assert.equal(s3Failed.headers['cache-control'], undefined);

    driver = 'local';
    const localFailed = await guest.get(`/photos/${id}/v/1/download/original`).expect(500);
    assert.equal(localFailed.headers['cache-control'], undefined);
});

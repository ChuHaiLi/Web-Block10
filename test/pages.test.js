const assert = require('node:assert/strict');
const { test } = require('node:test');
const sharp = require('sharp');
const { prepareTest } = require('./helpers');

const gallerySizes = '(max-width: 599px) 100vw, (max-width: 999px) 50vw, 33vw';
const detailSizes = '(max-width: 1600px) 100vw, 1600px';

function imageAttributes(html)
{
    return Array.from(html.matchAll(/<img\b[^>]*>/g), ([tag]) =>
        Object.fromEntries(Array.from(tag.matchAll(/([\w-]+)="([^"]*)"/g), ([, name, value]) => [name, value]))
    );
}

function assertImage(image, { variants, coverWidth, sizes, loading, alt })
{
    const cover = variants.find(variant => variant.width === coverWidth);
    assert.ok(cover);
    assert.equal(image.src, cover.url);
    assert.equal(image.srcset, variants.map(variant => variant.url + ' ' + variant.width + 'w').join(', '));
    assert.equal(image.sizes, sizes);
    assert.equal(image.width, String(cover.width));
    assert.equal(image.height, String(cover.height));
    assert.equal(image.loading, loading);
    assert.equal(image.decoding, 'async');
    assert.equal(image.alt, alt);
}

test('pages gallery rỗng có link Upload và ảnh được sắp mới nhất trước', async t =>
{
    const { prisma, request, uploadFiles } = await prepareTest(t);
    const empty = await request.get('/').expect(200);
    assert.match(empty.text, /Chưa có ảnh\.[\s\S]*<a href="\/upload">Tải ảnh lên<\/a>/);
    assert.deepEqual(imageAttributes(empty.text), []);

    const { body } = await uploadFiles([
        { filename: 'photo.jpg', title: 'Ảnh cũ', altText: 'Ảnh JPEG' },
        { filename: 'photo.png', title: 'Ảnh mới', altText: 'Ảnh <PNG> & sân' }
    ]).expect(200);
    const [jpeg, png] = body.results.map(result =>
    {
        assert.equal(result.ok, true);
        return result.photo;
    });
    await prisma.photo.update({ where: { id: jpeg.id }, data: { createdAt: new Date('2026-01-01T00:00:00Z') } });
    await prisma.photo.update({ where: { id: png.id }, data: { createdAt: new Date('2026-02-01T00:00:00Z') } });

    const gallery = await request.get('/').expect(200);
    assert.deepEqual(Array.from(gallery.text.matchAll(/class="photo-card" href="([^"]+)"/g), ([, url]) => url),
        [png.url, jpeg.url]);
    const images = imageAttributes(gallery.text);
    assert.equal(images.length, 2);
    assert.deepEqual(images[0].srcset.split(', ').map(candidate => candidate.split(' ').at(-1)), ['320w', '800w']);
    assertImage(images[0], { variants: png.variants, coverWidth: 800, sizes: gallerySizes, loading: 'lazy', alt: 'Ảnh &lt;PNG&gt; &amp; sân' });
    assertImage(images[1], { variants: jpeg.variants, coverWidth: 960, sizes: gallerySizes, loading: 'lazy', alt: 'Ảnh JPEG' });
    assert.match(gallery.text, /<figcaption>Ảnh mới<\/figcaption>/);
});

test('pages chi tiết có ảnh eager, metadata, bảng variant và form xác nhận xóa', async t =>
{
    const { prisma, request, uploadFiles } = await prepareTest(t);
    const title = 'Ảnh chi tiết';
    const alt = 'Một khoảng sân';
    const createdAt = new Date('2026-03-04T12:34:56.000Z');
    const { body } = await uploadFiles([{ filename: 'photo.png', title, altText: alt }]).expect(200);
    const [result] = body.results;
    assert.equal(result.ok, true);
    const { id, url, variants } = result.photo;
    const record = await prisma.photo.update({
        where: { id }, data: { createdAt },
        include: { variants: { orderBy: { width: 'asc' } } }
    });

    const detail = await request.get(url).expect(200);
    const images = imageAttributes(detail.text);
    assert.equal(images.length, 1);
    assertImage(images[0], { variants, coverWidth: 800, sizes: detailSizes, loading: 'eager', alt });
    assert.ok(detail.text.includes('<h1>' + title + '</h1>'));
    assert.ok(detail.text.includes('<dd>' + alt + '</dd>'));
    assert.ok(detail.text.includes('<time datetime="' + createdAt.toISOString() + '">'));
    assert.match(detail.text, /<dt>Phiên bản<\/dt>\s*<dd>1<\/dd>/);
    assert.match(detail.text, /<caption>Các biến thể WebP<\/caption>/);
    const rows = Array.from(detail.text.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g), ([, row]) => row);
    assert.equal(rows.length, record.variants.length);
    for (const [index, variant] of record.variants.entries())
    {
        assert.ok(rows[index].includes('<td>' + variant.width + ' × ' + variant.height + '</td>'));
        assert.ok(rows[index].includes('<td>' + variant.bytes + '</td>'));
        assert.ok(rows[index].includes('href="/media/' + variant.storageKey + '"'));
    }
    assert.ok(detail.text.includes('method="post" action="' + url + '/delete"'));
    assert.ok(detail.text.includes('<a href="' + url + '/edit">Chỉnh sửa</a>'));
    assert.match(detail.text, /onsubmit="return window\.confirm\(/);
    assert.match(detail.text, /<button type="submit">Xóa<\/button>/);
});

test('pages loại ảnh DELETING và PURGED khỏi gallery, chi tiết trả 404', async t =>
{
    const { prisma, request, uploadFiles } = await prepareTest(t);
    const { body } = await uploadFiles([
        { filename: 'small.png', title: 'Ảnh công khai' },
        { filename: 'small.png', title: 'Ảnh đang xóa' },
        { filename: 'small.png', title: 'Ảnh đã dọn' }
    ]).expect(200);
    const [published, deleting, purged] = body.results.map(result =>
    {
        assert.equal(result.ok, true);
        return result.photo;
    });
    await prisma.photo.update({ where: { id: deleting.id }, data: { status: 'DELETING' } });
    await prisma.photo.update({ where: { id: purged.id }, data: { status: 'PURGED' } });

    const gallery = await request.get('/').expect(200);
    assert.deepEqual(Array.from(gallery.text.matchAll(/class="photo-card" href="([^"]+)"/g), ([, url]) => url), [published.url]);
    await request.get(published.url).expect(200);
    await request.get(published.url + '/edit').expect(200);
    for (const url of [deleting.url, purged.url, '/photos/aaaaaaaaaaaa'])
    {
        const missing = await request.get(url).expect(404);
        assert.match(missing.text, /Không tìm thấy trang/);
        await request.get(url + '/edit').expect(404);
    }
});

test('pages nạp edits hiện tại và kích thước gốc cho trang chỉnh sửa', async t =>
{
    const { request, uploadFiles } = await prepareTest(t);
    const { body } = await uploadFiles([{ filename: 'corners.png' }]).expect(200);
    assert.equal(body.results[0].ok, true);
    const { id, url } = body.results[0].photo;
    const edits = { rotate: 90, flipH: true, crop: { x: 12, y: 25, width: 100, height: 150 } };
    await request.post('/api/photos/' + id + '/edits').send({ baseVersion: 1, ...edits }).expect(200);

    const page = await request.get(url + '/edit').expect(200).expect('Cache-Control', 'private, no-store');
    const [, encoded] = page.text.match(/data-initial="([^"]+)"/);
    assert.deepEqual(JSON.parse(encoded.replaceAll('&#34;', '"')), {
        baseVersion: 2,
        originalWidth: 400,
        originalHeight: 300,
        edits
    });
    assert.ok(page.text.includes('data-source="' + url + '/edit/source"'));
    assert.match(page.text, /<script src="\/edit\.js" defer>/);
});

test('pages dùng variant của currentVersion và fallback về variant nhỏ nhất nếu mọi width > 960', async t =>
{
    const { prisma, request, storage, uploadFiles } = await prepareTest(t);
    const alt = 'Mô tả ảnh có nhiều phiên bản';
    const { body } = await uploadFiles([{ filename: 'photo.jpg', altText: alt }]).expect(200);
    const [result] = body.results;
    assert.equal(result.ok, true);
    const { id, url } = result.photo;
    const original = await prisma.photo.findUniqueOrThrow({ where: { id } });
    const variants = [];
    for (const width of [1100, 1600])
    {
        const storageKey = 'photos/' + id + '/v2/' + width + '.webp';
        const { data, info } = await sharp(storage.keyToPath(original.originalKey))
            .resize({ width }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
        await storage.writeFile(storageKey, data);
        variants.push({ width: info.width, height: info.height, bytes: info.size, storageKey, mime: 'image/webp' });
    }
    await prisma.$transaction([
        prisma.photoVersion.create({
            data: {
                photoId: id, version: 2, width: original.originalWidth, height: original.originalHeight,
                edits: { rotate: 0, flipH: false, crop: null }
            }
        }),
        prisma.photoVariant.createMany({ data: variants.map(variant => ({ ...variant, photoId: id, version: 2 })) }),
        prisma.photo.update({ where: { id }, data: { currentVersion: 2, nextVersion: 3 } })
    ]);
    const display = variants.map(variant => ({ ...variant, url: '/media/' + variant.storageKey }));

    const gallery = await request.get('/').expect(200);
    assertImage(imageAttributes(gallery.text)[0],
        { variants: display, coverWidth: 1100, sizes: gallerySizes, loading: 'lazy', alt });
    const detail = await request.get(url).expect(200);
    assertImage(imageAttributes(detail.text)[0],
        { variants: display, coverWidth: 1100, sizes: detailSizes, loading: 'eager', alt });
    assert.match(detail.text, /<dt>Phiên bản<\/dt>\s*<dd>2<\/dd>/);
    assert.ok(!detail.text.includes('/v1/'));
});

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const sharp = require('sharp');
const { prepareTest, registerAndLogin } = require('./helpers');

const gallerySizes = '(max-width: 599px) 100vw, (max-width: 999px) 50vw, (max-width: 1279px) 33vw, 410px';
const detailSizes = '(max-width: 999px) 100vw, (max-width: 1279px) calc(100vw - 412px), 916px';

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
    const { prisma, request, guest, uploadFiles } = await prepareTest(t);
    const empty = await request.get('/').expect(200);
    assert.match(empty.text, /<h1 class="section-title">Ảnh mới nhất<\/h1>/);
    assert.match(empty.text, /class="empty-state"[\s\S]*Chưa có ảnh nào[\s\S]*<a class="btn btn-primary" href="\/upload">Tải ảnh lên<\/a>/);
    assert.deepEqual(imageAttributes(empty.text), []);
    const guestEmpty = await guest.get('/').expect(200);
    assert.match(guestEmpty.text, /Chưa có ảnh nào[\s\S]*<a class="btn btn-primary" href="\/login\?next=\/upload">Đăng nhập để tải ảnh<\/a>/);
    assert.doesNotMatch(guestEmpty.text, /href="\/upload"/);

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
    assert.match(gallery.text, /<figcaption>\s*<span class="photo-title">Ảnh mới<\/span>\s*<span class="photo-author">bởi test-user · <time datetime="2026-02-01T00:00:00\.000Z">1\/2\/2026<\/time><\/span>/);
    assert.match(gallery.text, /<div class="photo-frame">\s*<img class="photo-image"/);
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
    assert.match(detail.text, /<h1>Ảnh chi tiết<\/h1>\s*<p class="photo-author">Đăng bởi test-user<\/p>/);
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

test('pages ảnh của tôi chỉ có ảnh PUBLISHED của mình, mới nhất trước và dùng ảnh responsive như gallery', async t =>
{
    const { app, prisma, request, guest, uploadFiles } = await prepareTest(t);
    await guest.get('/me').expect('Location', '/login?next=/me').expect(303);
    const guestGallery = await guest.get('/').expect(200);
    assert.doesNotMatch(guestGallery.text, /href="\/(?:me|account\/password)"/);
    const empty = await request.get('/me').expect('Cache-Control', 'private, no-store').expect(200);
    assert.match(empty.text, /<h1 class="section-title">Ảnh của tôi<\/h1>/);
    assert.match(empty.text, /Chưa có ảnh nào[\s\S]*Bạn chưa đăng ảnh nào\.[\s\S]*<a class="btn btn-primary" href="\/upload">Tải ảnh lên<\/a>/);
    assert.match(empty.text, /href="\/me" aria-current="page">Ảnh của tôi<\/a>/);
    assert.doesNotMatch(empty.text, /href="\/" aria-current/);
    assert.match(empty.text, /href="\/account\/password">Đổi mật khẩu<\/a>/);

    const { body } = await uploadFiles([
        { filename: 'small.png', title: 'Ảnh của tôi cũ', altText: 'Ảnh cũ' },
        { filename: 'small.png', title: 'Ảnh đang xóa' },
        { filename: 'small.png', title: 'Ảnh đã xóa' },
        { filename: 'small.png', title: 'Ảnh của tôi mới', altText: 'Ảnh mới' }
    ]).expect(200);
    const [older, deleting, purged, newer] = body.results.map(result =>
    {
        assert.equal(result.ok, true);
        return result.photo;
    });
    await prisma.$transaction([
        prisma.photo.update({ where: { id: older.id }, data: { createdAt: new Date('2026-01-01T00:00:00Z') } }),
        prisma.photo.update({ where: { id: newer.id }, data: { createdAt: new Date('2026-02-01T00:00:00Z') } }),
        prisma.photo.update({ where: { id: deleting.id }, data: { status: 'DELETING' } }),
        prisma.photo.update({ where: { id: purged.id }, data: { status: 'PURGED' } })
    ]);
    const other = await registerAndLogin(app, { username: 'other-owner' });
    const uploaded = await other.post('/api/uploads').field('title_0', 'Ảnh của người khác').field('alt_0', 'Ảnh khác')
        .attach('photos', path.join(__dirname, 'fixtures', 'small.png')).expect(200);
    assert.equal(uploaded.body.results[0].ok, true);
    const otherPhoto = uploaded.body.results[0].photo;

    const myPhotos = await request.get('/me').expect(200);
    const cardUrls = html => Array.from(html.matchAll(/class="photo-card" href="([^"]+)"/g), ([, url]) => url);
    assert.deepEqual(cardUrls(myPhotos.text), [newer.url, older.url]);
    assert.deepEqual(cardUrls((await other.get('/me').expect(200)).text), [otherPhoto.url]);
    const gallery = await guest.get('/').expect(200);
    assert.match(gallery.text, /Ảnh của người khác<\/span>\s*<span class="photo-author">bởi other-owner · /);
    const detail = await request.get(otherPhoto.url).expect(200);
    assert.match(detail.text, /Đăng bởi other-owner/);
    const publicImages = imageAttributes(gallery.text);
    assert.deepEqual(imageAttributes(myPhotos.text), publicImages.filter(image => ['Ảnh mới', 'Ảnh cũ'].includes(image.alt)));
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
    const { prisma, request, objectStore, readObject, uploadFiles } = await prepareTest(t);
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
        const { data, info } = await sharp(await readObject(original.originalKey))
            .resize({ width }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
        await objectStore.put(storageKey, data, { contentType: 'image/webp' });
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

test('pages trang chi tiết hiển thị nút tải bản gốc cho khách, lọc kích thước và ẩn nhóm rỗng', async t =>
{
    const { guest, request, uploadFiles } = await prepareTest(t);

    // 200x150: guest sees original download button, and "Kích thước khác" is completely hidden.
    const { body: smallUpload } = await uploadFiles([{ filename: 'small.png', title: 'Ảnh nhỏ' }]).expect(200);
    const smallId = smallUpload.results[0].photo.id;
    const smallDetail = await guest.get(`/photos/${smallId}`).expect(200);
    assert.ok(smallDetail.text.includes(`href="/photos/${smallId}/v/1/download/original" download>⬇ Tải bản gốc (200×150)</a>`));
    assert.ok(!smallDetail.text.includes('Kích thước khác'));

    // 2000x1333: only Desktop group is shown; Điện thoại and Tablet / iPad are hidden.
    const { body: jpgUpload } = await uploadFiles([{ filename: 'photo.jpg', title: 'Ảnh 2000px' }]).expect(200);
    const jpgId = jpgUpload.results[0].photo.id;
    const jpgDetail = await guest.get(`/photos/${jpgId}`).expect(200);
    assert.ok(jpgDetail.text.includes(`href="/photos/${jpgId}/v/1/download/original" download>⬇ Tải bản gốc (2000×1333)</a>`));
    assert.ok(jpgDetail.text.includes('Kích thước khác'));
    assert.ok(jpgDetail.text.includes('id="tab-desktop"'));
    assert.ok(!jpgDetail.text.includes('id="tab-phone"'));
    assert.ok(!jpgDetail.text.includes('id="tab-tablet"'));
    assert.ok(jpgDetail.text.includes(`/photos/${jpgId}/v/1/download/1366x768`));
    assert.ok(jpgDetail.text.includes(`/photos/${jpgId}/v/1/download/1920x1080`));
    assert.ok(jpgDetail.text.includes('Full HD'));
    assert.ok(!jpgDetail.text.includes('2560x1440'));

    // After crop edit to 1500x900 (v2), links use /v/2/download/... and 1920x1080 is no longer listed.
    await request.post(`/api/photos/${jpgId}/edits`)
        .send({ baseVersion: 1, rotate: 0, flipH: false, crop: { x: 0, y: 0, width: 1500, height: 900 } })
        .expect(200);
    const v2Detail = await guest.get(`/photos/${jpgId}`).expect(200);
    assert.ok(v2Detail.text.includes(`href="/photos/${jpgId}/v/2/download/original" download>⬇ Tải bản gốc (1500×900)</a>`));
    assert.ok(v2Detail.text.includes(`/photos/${jpgId}/v/2/download/1366x768`));
    assert.ok(!v2Detail.text.includes('1920x1080'));
    assert.ok(!v2Detail.text.includes('/v/1/download/'));

    // 3840x2160: all three groups (Desktop, Điện thoại, Tablet / iPad) are shown with tabs and labels.
    const uhdBuffer = await sharp({
        create: { width: 3840, height: 2160, channels: 3, background: '#1e3a5f' }
    }).png().toBuffer();
    const { body: uhdUpload } = await request.post('/api/uploads')
        .field('title_0', 'Ảnh 4K')
        .field('alt_0', 'Ảnh 4K trang chi tiết')
        .attach('photos', uhdBuffer, 'uhd.png')
        .expect(200);
    const uhdId = uhdUpload.results[0].photo.id;
    const uhdDetail = await guest.get(`/photos/${uhdId}`).expect(200);
    assert.ok(uhdDetail.text.includes('id="tab-desktop"'));
    assert.ok(uhdDetail.text.includes('aria-selected="true"'));
    assert.ok(uhdDetail.text.includes('id="tab-phone"'));
    assert.ok(uhdDetail.text.includes('id="tab-tablet"'));
    assert.ok(uhdDetail.text.includes('4K UHD'));
    assert.ok(!uhdDetail.text.includes('5120x2880'));
    assert.match(uhdDetail.text, /<script src="\/detail\.js" defer><\/script>/);
});

test('pages giao diện mới: font tự host, bảng màu :root và không gọi bên thứ ba', async t =>
{
    const { guest, request } = await prepareTest(t);
    const css = (await guest.get('/styles.css').expect(200)).text;
    const tokens = {
        '--bg': '#2b2f35', '--surface': '#353a41', '--surface-2': '#40464e', '--border': '#4a515a',
        '--text': '#eef1f6', '--muted': '#b0b8c3', '--accent': '#9be22d', '--accent-ink': '#121608',
        '--danger': '#ff9898', '--radius': '12px', '--radius-sm': '8px',
        '--font-heading': "'Be Vietnam Pro', system-ui, sans-serif", '--font-body': "'Open Sans', system-ui, sans-serif"
    };
    const root = css.match(/:root\s*\{([^}]*)\}/)[1];
    for (const [name, value] of Object.entries(tokens)) assert.ok(root.includes(name + ': ' + value + ';'), name);
    assert.match(root, /color-scheme: dark;/);
    assert.match(css, /:focus-visible\s*\{\s*outline: 3px solid var\(--accent\);\s*outline-offset: 2px;/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.doesNotMatch(css, /googleapis|gstatic|https?:\/\//);

    for (const [family, weights] of [['be-vietnam-pro', [600, 700]], ['open-sans', [400, 600]]])
    {
        for (const weight of weights)
        {
            for (const subset of ['vietnamese', 'latin-ext', 'latin'])
            {
                assert.ok(css.includes(`/fonts/${family}/${family}-${subset}-${weight}-normal.woff2`), `${family} ${weight} ${subset}`);
            }
        }
    }
    assert.match(css, /font-family: 'Be Vietnam Pro';[^}]*unicode-range: [^;]*U\+1EA0-1EF9/);

    const fontUrls = Array.from(css.matchAll(/url\('(\/fonts\/[^']+)'\)/g), ([, url]) => url);
    assert.ok(fontUrls.length > 0);
    for (const url of fontUrls)
    {
        const font = await guest.get(url).expect(200).expect('Content-Type', /font\/woff2/);
        assert.ok(font.body.length > 1000, url);
    }
    await guest.get('/fonts/be-vietnam-pro/khong-ton-tai.woff2').expect(404);

    const page = (await request.get('/').expect(200)).text;
    assert.doesNotMatch(page, /fonts\.googleapis|fonts\.gstatic|https?:\/\//);
});

test('pages header: khách có nút Đăng nhập/Đăng ký, người dùng có menu tài khoản và link hiện tại', async t =>
{
    const { guest, request } = await prepareTest(t);
    const visitor = (await guest.get('/').expect(200)).text;
    assert.match(visitor, /<a class="site-name" href="\/"><span class="site-name-accent">Photo<\/span> Gallery<\/a>/);
    assert.match(visitor, /<a class="btn btn-outline" href="\/login">Đăng nhập<\/a>/);
    assert.match(visitor, /<a class="btn btn-primary" href="\/register">Đăng ký<\/a>/);
    assert.match(visitor, /href="\/" aria-current="page">Gallery<\/a>/);
    assert.doesNotMatch(visitor, /<details/);

    const member = (await request.get('/upload').expect(200)).text;
    assert.match(member, /href="\/upload" aria-current="page">Upload<\/a>/);
    assert.match(member, /<details class="header-menu nav-menu">/);
    const userMenu = member.match(/<details class="header-menu user-menu">([\s\S]*?)<\/details>/)[1];
    assert.match(userMenu, /test-user/);
    assert.match(userMenu, /href="\/me">Ảnh của tôi<\/a>/);
    assert.match(userMenu, /href="\/account\/password">Đổi mật khẩu<\/a>/);
    assert.match(userMenu, /action="\/logout"/);
    assert.match(member, /id="dropzone"/);
    assert.match(member, /<input id="photos" name="photos" type="file"/);

    const login = (await guest.get('/login').expect(200)).text;
    assert.match(login, /class="btn btn-outline" href="\/login" aria-current="page">Đăng nhập<\/a>/);
    assert.match(login, /<section class="card auth-card">/);
});

test('pages trang chi tiết hai cột: nút tải, thông tin, nút chủ ảnh và bảng kỹ thuật trong details', async t =>
{
    const { guest, request, uploadFiles } = await prepareTest(t);
    const { body } = await uploadFiles([{ filename: 'photo.jpg', title: 'Ảnh hai cột', altText: 'Mô tả' }]).expect(200);
    const { url } = body.results[0].photo;

    const html = (await request.get(url).expect(200)).text;
    const order = [
        'class="detail-stage"', 'class="download-original"', 'class="info-card"',
        'class="photo-actions"', 'class="tech-details"', 'class="download-presets"'
    ].map(marker => html.indexOf(marker));
    assert.ok(order.every(index => index > 0), 'thiếu khối: ' + order);
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
    assert.match(html, /<details class="tech-details">\s*<summary>Thông tin kỹ thuật<\/summary>[\s\S]*<table class="variant-table">[\s\S]*<\/details>/);

    const visitor = (await guest.get(url).expect(200)).text;
    assert.ok(!visitor.includes('class="photo-actions"'));
    assert.ok(visitor.includes('class="download-original"'));
});

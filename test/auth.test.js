const assert = require('node:assert/strict');
const { test } = require('node:test');
const argon2 = require('argon2');
const supertest = require('supertest');
const { createApp } = require('../src/app');
const { runCleanup } = require('../src/cleanup/runCleanup');
const { prepareTest, testHost, testPassword } = require('./helpers');

const noStore = 'private, no-store';
const incorrectLogin = 'Tên đăng nhập hoặc mật khẩu không đúng';

function registration(username, options = {})
{
    return { username, password: testPassword, passwordConfirm: testPassword, ...options };
}

function postForm(request, url, form)
{
    return request.post(url).type('form').send(form);
}

function sessionCookie(response)
{
    const [cookie] = response.headers['set-cookie'] ?? [];
    assert.match(cookie, /^gallery\.sid=/);
    return cookie.split(';')[0];
}

test('auth.register chuẩn hóa tên và lưu hash Argon2id rồi đăng nhập ngay', async t =>
{
    const { prisma, request } = await prepareTest(t, { guestUploads: true });
    await request.get('/register').expect('Cache-Control', noStore).expect(200);
    const registered = await postForm(request, '/register', registration('  Alice.VN  ')).expect('Location', '/').expect(303);
    const cookie = sessionCookie(registered);
    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'alice.vn' } });
    assert.match(user.id, /^[A-Za-z0-9_-]{12}$/);
    assert.match(user.passwordHash, /^\$argon2id\$/);
    assert.ok(await argon2.verify(user.passwordHash, testPassword));
    assert.ok(!JSON.stringify(user).includes(testPassword));
    const loggedIn = await request.get('/').set('Cookie', cookie).expect(200);
    assert.ok(loggedIn.text.includes('alice.vn'));
    assert.ok(loggedIn.text.includes('method="post" action="/logout"'));

    for (const [fields, message] of [
        [registration('ALICE.VN'), 'Tên đăng nhập đã được dùng'],
        [registration('short-pass', { password: '1234567', passwordConfirm: '1234567' }), 'Mật khẩu phải dài 8–128 ký tự'],
        [registration('long-pass', { password: 'z'.repeat(129), passwordConfirm: 'z'.repeat(129) }), 'Mật khẩu phải dài 8–128 ký tự'],
        [registration('SameUsername', { password: 'SameUsername', passwordConfirm: 'SameUsername' }), 'Mật khẩu không được trùng tên đăng nhập'],
        [registration('confirmation', { passwordConfirm: 'a-second-password' }), 'Hai mật khẩu không khớp'],
        [registration('-invalid'), 'Tên đăng nhập phải dài 3–30 ký tự']
    ])
    {
        const invalid = await postForm(request, '/register', fields).expect('Cache-Control', noStore).expect(400);
        assert.ok(invalid.text.includes(message));
        assert.ok(invalid.text.includes('name="username" value="' + fields.username + '"'));
        assert.doesNotMatch(invalid.text, /<input[^>]*type="password"[^>]*\bvalue=/);
        assert.equal(invalid.headers['set-cookie'], undefined);
    }
    assert.equal(await prisma.user.count(), 1);
});

test('auth.login đổi SID, dùng chung thông báo lỗi và chỉ POST mới đăng xuất', async t =>
{
    const { prisma, request } = await prepareTest(t, { guestUploads: true });
    const registered = await postForm(request, '/register', registration('alice')).expect(303);
    const oldCookie = sessionCookie(registered);
    const oldSession = await prisma.session.findFirstOrThrow();
    const loggedIn = await postForm(request, '/login', { username: ' ALICE ', password: testPassword })
        .set('Cookie', oldCookie).expect('Location', '/').expect(303);
    const newCookie = sessionCookie(loggedIn);
    const current = await prisma.session.findFirstOrThrow();
    assert.notEqual(newCookie, oldCookie);
    assert.notEqual(current.sid, oldSession.sid);
    assert.equal(await prisma.session.count(), 1);

    const verify = t.mock.method(argon2, 'verify');
    for (const username of ['missing-user', 'Alice'])
    {
        const rejected = await postForm(request, '/login', { username, password: 'incorrect-password' }).expect(401);
        assert.ok(rejected.text.includes(incorrectLogin));
        assert.ok(rejected.text.includes('name="username" value="' + username + '"'));
        assert.ok(!rejected.text.includes('incorrect-password'));
    }
    assert.equal(verify.mock.callCount(), 2);
    assert.ok(verify.mock.calls.every(call => call.arguments[0].startsWith('$argon2id$')));

    await request.get('/logout').set('Cookie', newCookie).expect(404);
    const stillLoggedIn = await request.get('/').set('Cookie', newCookie).expect(200);
    assert.ok(stillLoggedIn.text.includes('action="/logout"'));
    const loggedOut = await request.post('/logout').set('Cookie', newCookie).expect('Location', '/').expect(303);
    assert.match(loggedOut.headers['set-cookie'][0], /^gallery\.sid=;/);
    assert.equal(await prisma.session.count(), 0);
    const guest = await request.get('/').set('Cookie', newCookie).expect(200);
    assert.ok(guest.text.includes('href="/login"'));
});

test('auth.session cookie dùng chung giữa hai app, HTML private và media không tải session', async t =>
{
    const { prisma, request, objectStore, scratch, authOptions, uploadFiles } = await prepareTest(t, { guestUploads: true });
    const publicPage = await request.get('/').expect('Cache-Control', noStore).expect(200);
    assert.equal(publicPage.headers['set-cookie'], undefined);
    assert.ok(publicPage.text.includes('href="/login"'));
    assert.equal(await prisma.session.count(), 0);

    const registered = await postForm(request, '/register', registration('shared-user')).expect(303);
    const cookie = sessionCookie(registered);
    assert.match(registered.headers['set-cookie'][0], /; HttpOnly(?:;|$)/);
    assert.match(registered.headers['set-cookie'][0], /; SameSite=Lax(?:;|$)/);
    const session = await prisma.session.findFirstOrThrow();
    const aged = Date.now() + 60_000;
    await prisma.session.update({ where: { sid: session.sid }, data: { expiresAt: new Date(aged) } });

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
    const secondApp = createApp({ prisma: observedPrisma, objectStore, scratch, ...authOptions });
    const second = supertest(secondApp);
    const viewer = await second.get('/').set('Cookie', cookie).expect('Cache-Control', noStore).expect(200);
    assert.ok(viewer.text.includes('shared-user'));
    assert.match(viewer.headers['set-cookie'][0], /gallery\.sid=/);
    assert.equal(sessionReads, 1);
    const refreshed = await prisma.session.findUniqueOrThrow({ where: { sid: session.sid } });
    assert.ok(refreshed.expiresAt.getTime() > Date.now() + 6 * 24 * 60 * 60 * 1000);

    const { body } = await uploadFiles([{ filename: 'small.png' }]).expect(200);
    assert.equal(body.results[0].ok, true);
    const photo = await prisma.photo.findUniqueOrThrow({ where: { id: body.results[0].photo.id }, include: { owner: true } });
    assert.equal(photo.owner.username, '!guest-upload');
    const [{ url }] = body.results[0].photo.variants;
    const before = sessionReads;
    await second.get('/styles.css').set('Cookie', cookie).expect(200);
    const media = await second.get(url).set('Cookie', cookie)
        .expect('Cache-Control', 'public, max-age=31536000, immutable').expect(200);
    assert.equal(media.headers['set-cookie'], undefined);
    assert.equal(sessionReads, before);

    await prisma.user.update({ where: { id: session.userId }, data: { passwordChangedAt: new Date(+session.createdAt + 1) } });
    const stale = await second.get('/').set('Cookie', cookie).expect('Cache-Control', noStore).expect(200);
    assert.ok(stale.text.includes('href="/login"'));
    assert.equal(await prisma.session.count(), 0);

    await prisma.session.create({
        data: { sid: 'expired-session', data: '{}', userId: session.userId, expiresAt: new Date(Date.now() - 1000) }
    });
    assert.equal((await runCleanup({ prisma, objectStore, scratch })).expiredSessionsRemoved, 1);
    assert.equal(await prisma.session.count(), 0);
});

test('auth.origin yêu cầu Origin hoặc Referer cùng scheme, host và cổng cho request thay đổi dữ liệu', async t =>
{
    const { app, prisma } = await prepareTest(t, { guestUploads: true });
    const request = supertest(app);
    for (const headers of [
        {},
        { Origin: 'http://other.test:3100' },
        { Origin: 'http://' + testHost + ':3101' },
        { Origin: 'https://' + testHost + ':3100' },
        { Origin: 'null', Referer: 'http://' + testHost + ':3100/register' }
    ])
    {
        const response = await postForm(request, '/register', registration('origin-user'))
            .set('Host', testHost + ':3100').set(headers).expect(403);
        assert.equal(response.body.error.code, 'BAD_ORIGIN');
    }
    assert.equal(await prisma.user.count(), 0);
    await request.options('/styles.css').expect(403);
    await request.head('/register').expect(200);
    await postForm(request, '/register', registration('origin-user'))
        .set('Host', testHost + ':3100').set('Origin', 'http://' + testHost + ':3100').expect(303);
    await postForm(request, '/login', { username: 'origin-user', password: testPassword })
        .set('Host', testHost + ':3101').set('Referer', 'http://' + testHost + ':3101/login?next=/upload').expect(303);
});

test('auth.redirect chỉ nhận next nội bộ ở đăng nhập và đăng ký', async t =>
{
    const { request } = await prepareTest(t, { guestUploads: true });
    const form = await request.get('/register').query({ next: '/upload' }).expect(200);
    assert.ok(form.text.includes('name="next" value="/upload"'));
    await postForm(request, '/register', registration('redirect-user', { next: '/upload' })).expect('Location', '/upload').expect(303);
    const paths = ['/upload', '//evil.com', 'https://evil.com', '/\\evil.com', '/\t/evil.com'];
    for (const next of paths)
    {
        await postForm(request, '/login', { username: 'redirect-user', password: testPassword, next })
            .expect('Location', next === '/upload' ? '/upload' : '/').expect(303);
    }
    await postForm(request, '/register', registration('unsafe-redirect', { next: '//evil.com' })).expect('Location', '/').expect(303);
});

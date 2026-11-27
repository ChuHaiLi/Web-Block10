const assert = require('node:assert/strict');
const { test } = require('node:test');
const argon2 = require('argon2');
const supertest = require('supertest');
const { prepareTest, registerAndLogin, gallerySessionCookie, withOrigin, testPassword } = require('./helpers');

const path = '/account/password';
const username = 'test-user';
const newPassword = 'changed-password-93';

function change(agent, fields = {})
{
    return agent.post(path).type('form').send({
        currentPassword: testPassword,
        newPassword,
        newPasswordConfirm: newPassword,
        ...fields
    });
}

function login(agent, password)
{
    return agent.post('/login').type('form').send({ username, password });
}

test('auth.password yêu cầu đăng nhập và dùng chung bộ đếm khóa với đăng nhập', async t =>
{
    const time = Date.now();
    const { prisma, request, guest } = await prepareTest(t, { now: () => time });
    const userState = () => prisma.user.findUniqueOrThrow({ where: { username } });
    await guest.get(path).expect('Location', '/login?next=/account/password').expect(303);
    await change(guest).expect('Location', '/login?next=/account/password').expect(303);
    const page = await request.get(path).expect('Cache-Control', 'private, no-store').expect(200);
    assert.match(page.text, /href="\/account\/password" aria-current="page">Đổi mật khẩu<\/a>/);
    assert.equal((page.text.match(/type="password"/g) ?? []).length, 3);
    assert.match(page.text, /name="currentPassword" type="password" maxlength="128" autocomplete="current-password"/);

    const wrong = await change(request, { currentPassword: 'wrong-current' }).expect(400);
    assert.match(wrong.text, /Mật khẩu hiện tại không đúng/);
    assert.doesNotMatch(wrong.text, /wrong-current|changed-password-93|test-password-47/);
    assert.equal((await userState()).failedLoginCount, 1);
    for (let attempt = 0; attempt < 3; attempt++) await login(guest, 'wrong-login').expect(401);
    assert.equal((await userState()).failedLoginCount, 4);
    const locked = await change(request, { currentPassword: 'wrong-again' }).expect(400);
    assert.match(locked.text, /tạm khóa.*15 phút/);
    assert.equal((await userState()).failedLoginCount, 0);
    assert.equal(+(await userState()).lockedUntil, time + 15 * 60_000);
    assert.match((await change(request).expect(400)).text, /tạm khóa.*15 phút/);
    assert.match((await login(guest, testPassword).expect(401)).text, /tạm khóa.*15 phút/);
});

test('auth.password kiểm tra mật khẩu mới, hủy các phiên cũ và giữ phiên hiện tại', async t =>
{
    let time = Date.now();
    const { app, prisma, request, guest } = await prepareTest(t, { now: () => time });
    const other = withOrigin(supertest.agent(app));
    await login(other, testPassword).expect(303);
    const unrelated = await registerAndLogin(app, { username: 'other-user' });
    const oldCookie = await gallerySessionCookie(request);
    const where = { username };
    const before = await prisma.user.findUniqueOrThrow({ where });
    assert.equal(await prisma.session.count({ where: { userId: before.id } }), 2);

    for (const [fields, message] of [
        [{ newPassword: 'short', newPasswordConfirm: 'short' }, /dài 8–128 ký tự/],
        [{ newPassword: username, newPasswordConfirm: username }, /không được trùng tên đăng nhập/],
        [{ newPasswordConfirm: 'different-password' }, /Hai mật khẩu không khớp/],
        [{ newPassword: testPassword, newPasswordConfirm: testPassword }, /mới phải khác mật khẩu hiện tại/]
    ])
    {
        const rejected = await change(request, fields).expect(400);
        assert.match(rejected.text, message);
    }
    assert.deepEqual(await prisma.user.findUniqueOrThrow({ where }), before);

    time = Math.max(time, +before.passwordChangedAt) + 1000;
    await change(request).expect('Location', '/me').expect(303);
    const after = await prisma.user.findUniqueOrThrow({ where });
    assert.equal(+after.passwordChangedAt, time);
    assert.notEqual(after.passwordHash, before.passwordHash);
    assert.ok(await argon2.verify(after.passwordHash, newPassword));
    assert.equal(after.failedLoginCount, 0);
    assert.notEqual(await gallerySessionCookie(request), oldCookie);
    assert.equal(await prisma.session.count({ where: { userId: before.id } }), 1);
    await request.get('/me').expect(200);
    await other.get('/me').expect('Location', '/login?next=/me').expect(303);
    await guest.get('/me').set('Cookie', oldCookie).expect(303);
    await unrelated.get('/me').expect(200);
    await login(guest, testPassword).expect(401);
    await login(guest, newPassword).expect(303);
});

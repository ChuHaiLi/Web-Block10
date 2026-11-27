const assert = require('node:assert/strict');
const { test } = require('node:test');
const supertest = require('supertest');
const { createApp } = require('../src/app');
const { prepareTest, withOrigin, testPassword } = require('./helpers');

const incorrectLogin = /Tên đăng nhập hoặc mật khẩu không đúng/;
const lockout = /Tài khoản tạm khóa do đăng nhập sai nhiều lần\. Thử lại sau 15 phút/;
const fifteenMinutes = 15 * 60_000;

function login(agent, password)
{
    return agent.post('/login').type('form').send({ username: ' TEST-USER ', password });
}

test('auth.lockout khóa từ lần 5, chặn mật khẩu đúng và mở khóa sau 15 phút', async t =>
{
    let time = Date.now();
    const { prisma, guest } = await prepareTest(t, { now: () => time });
    const userState = () => prisma.user.findUniqueOrThrow({ where: { username: 'test-user' } });

    for (let attempt = 1; attempt <= 4; attempt++)
    {
        const response = await login(guest, 'wrong-password').expect(401);
        assert.match(response.text, incorrectLogin);
        const user = await userState();
        assert.equal(user.failedLoginCount, attempt);
        assert.equal(user.lockedUntil, null);
    }
    const fifth = await login(guest, 'wrong-password').expect(401);
    assert.match(fifth.text, lockout);
    const locked = await userState();
    assert.equal(locked.failedLoginCount, 0);
    assert.equal(+locked.lockedUntil, time + fifteenMinutes);
    const correctWhileLocked = await login(guest, testPassword).expect(401);
    assert.match(correctWhileLocked.text, lockout);
    assert.equal(correctWhileLocked.headers['set-cookie'], undefined);

    time += 14 * 60_000 + 1;
    const almostUnlocked = await login(guest, testPassword).expect(401);
    assert.match(almostUnlocked.text, /Thử lại sau 1 phút/);
    assert.equal(+(await userState()).lockedUntil, +locked.lockedUntil);
    time = +locked.lockedUntil;
    await login(guest, testPassword).expect(303);
    assert.equal((await userState()).failedLoginCount, 0);
    assert.equal((await userState()).lockedUntil, null);

    await login(guest, 'wrong-password').expect(401);
    assert.equal((await userState()).failedLoginCount, 1);
    await login(guest, testPassword).expect(303);
    assert.equal((await userState()).failedLoginCount, 0);
});

test('auth.lockout đếm sai đồng thời từ hai app và chỉ khóa một lần ở ngưỡng', async t =>
{
    const time = Date.now();
    const { prisma, guest, objectStore, scratch, authOptions } = await prepareTest(t, { now: () => time });
    const secondApp = createApp({ prisma, objectStore, scratch, ...authOptions });
    const second = withOrigin(supertest(secondApp));
    const where = { username: 'test-user' };

    await Promise.all([login(guest, 'wrong-one').expect(401), login(second, 'wrong-two').expect(401)]);
    assert.equal((await prisma.user.findUniqueOrThrow({ where })).failedLoginCount, 2);

    await prisma.user.update({ where, data: { failedLoginCount: 4 } });
    const responses = await Promise.all([login(guest, 'wrong-three').expect(401), login(second, 'wrong-four').expect(401)]);
    for (const response of responses) assert.match(response.text, lockout);
    const locked = await prisma.user.findUniqueOrThrow({ where });
    assert.equal(locked.failedLoginCount, 0);
    assert.equal(+locked.lockedUntil, time + fifteenMinutes);
});

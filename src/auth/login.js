const argon2 = require('argon2');
const { lockoutMessage, unlockedCredentials, currentLockout, recordFailedPassword } = require('./policy');

// Argon2id with library defaults. Unknown users still pay the password verification cost.
const dummyPasswordHash = '$argon2id$v=19$m=65536,t=3,p=4$YE0i9Ta/VqYfcQNAhYUq/w$mkWjOlAckKINowhfuKNPH+61FrWgf7whUN+Fuh9+o1M';

function normalizeLogin(value)
{
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validLogin(login)
{
    return /^[a-z0-9][a-z0-9_.-]{2,29}$/.test(login);
}

function passwordLength(password)
{
    return typeof password === 'string' ? Array.from(password).length : 0;
}

function validateNewPassword(username, password, confirmation)
{
    const length = passwordLength(password);
    if (length < 8 || length > 128) return 'Mật khẩu phải dài 8–128 ký tự';
    if (normalizeLogin(password) === username) return 'Mật khẩu không được trùng tên đăng nhập';
    if (password !== confirmation) return 'Hai mật khẩu không khớp';
    return '';
}

async function checkPassword(prisma, user, password, now, incorrectPassword)
{
    const locked = lockoutMessage(user?.lockedUntil, now);
    if (locked) return locked;

    const usable = typeof password === 'string' && passwordLength(password) <= 128;
    const matches = await argon2.verify(user?.passwordHash ?? dummyPasswordHash, usable ? password : 'invalid-login-input');
    if (!user) return incorrectPassword;
    if (usable && matches) return '';
    return (await recordFailedPassword(prisma, user, now)) || incorrectPassword;
}

async function verifyLogin(prisma, username, password, now)
{
    const incorrectLogin = 'Tên đăng nhập hoặc mật khẩu không đúng';
    const user = validLogin(username) ? await prisma.user.findUnique({ where: { username } }) : null;
    const error = await checkPassword(prisma, user, password, now, incorrectLogin);
    if (error) return { error };

    const reset = await prisma.user.updateMany({
        where: unlockedCredentials(user, now),
        data: { failedLoginCount: 0, lockedUntil: null }
    });
    if (reset.count === 0) return { error: (await currentLockout(prisma, user.id, now)) || incorrectLogin };
    return { user };
}

function safeNext(value)
{
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') ||
        /[\\\u0000-\u001f\u007f]/.test(value))
    {
        return '/';
    }
    return value;
}

module.exports = { normalizeLogin, validLogin, validateNewPassword, checkPassword, verifyLogin, safeNext };

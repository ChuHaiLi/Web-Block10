const argon2 = require('argon2');

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

async function verifyLogin(prisma, username, password)
{
    const user = validLogin(username) ? await prisma.user.findUnique({ where: { username } }) : null;
    const usable = typeof password === 'string' && passwordLength(password) <= 128;
    const matches = await argon2.verify(user?.passwordHash ?? dummyPasswordHash, usable ? password : 'invalid-login-input');
    return user && usable && matches ? user : null;
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

module.exports = { normalizeLogin, validLogin, passwordLength, verifyLogin, safeNext, dummyPasswordHash };

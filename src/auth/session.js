const session = require('express-session');
const { PrismaSessionStore } = require('./sessionStore');

const cookieName = 'gallery.sid';
const sessionAge = 7 * 24 * 60 * 60 * 1000;

function cookieOptions(cookieSecure)
{
    return { httpOnly: true, sameSite: 'lax', secure: cookieSecure, path: '/' };
}

function sessionMiddleware(prisma, sessionSecret, cookieSecure)
{
    return session({
        name: cookieName,
        secret: sessionSecret,
        store: new PrismaSessionStore(prisma),
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: { ...cookieOptions(cookieSecure), maxAge: sessionAge }
    });
}

function closeSession(req, res, cookieSecure)
{
    return new Promise((resolve, reject) => req.session.destroy(error =>
    {
        if (error) return reject(error);
        res.clearCookie(cookieName, cookieOptions(cookieSecure));
        resolve();
    }));
}

async function establishSession(req, { id, passwordChangedAt })
{
    await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.userId = id;
    req.session.passwordChangedAt = passwordChangedAt.getTime();
    req.session.createdAt = Math.max(Date.now(), req.session.passwordChangedAt);
    await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
}

function loadUser(prisma, cookieSecure)
{
    return async (req, res, next) =>
    {
        req.user = res.locals.user = null;
        if (!req.session.userId) return next();

        try
        {
            const user = await prisma.user.findUnique({
                where: { id: req.session.userId },
                select: { id: true, username: true, passwordChangedAt: true }
            });
            const changedAt = user?.passwordChangedAt.getTime();
            // A login verified against the previous password might save its session after revocation.
            const sessionPassword = req.session.passwordChangedAt ?? changedAt;
            if (!user || req.session.createdAt < changedAt || sessionPassword !== changedAt)
            {
                await closeSession(req, res, cookieSecure);
                return next();
            }
            req.user = res.locals.user = { id: user.id, username: user.username };
            next();
        }
        catch (error)
        {
            next(error);
        }
    };
}

module.exports = { sessionMiddleware, closeSession, establishSession, loadUser };

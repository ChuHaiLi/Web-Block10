const express = require('express');
const argon2 = require('argon2');
const { newId } = require('../ids');
const { redirectToLogin } = require('../auth/access');
const { normalizeLogin, validLogin, validateNewPassword, checkPassword, verifyLogin, safeNext } = require('../auth/login');
const { unlockedCredentials, currentLockout } = require('../auth/policy');
const { closeSession, establishSession } = require('../auth/session');

const parseForm = express.urlencoded({ extended: false, limit: '10kb' });
const passwordPath = '/account/password';
const incorrectPassword = 'Mật khẩu hiện tại không đúng';

function renderForm(req, res, status = 200, error = '')
{
    const registering = req.path.toLowerCase().replace(/\/$/, '') === '/register';
    const username = typeof req.body?.username === 'string' ? req.body.username : '';
    res.status(status).render('layout', {
        page: 'auth',
        title: registering ? 'Đăng ký' : 'Đăng nhập',
        action: registering ? '/register' : '/login',
        registering,
        username,
        nextPath: safeNext(req.body?.next ?? req.query.next),
        error
    });
}

function parseFormWith(render)
{
    return (req, res, next) => parseForm(req, res, error =>
    {
        if (error) return render(req, res, 400, 'Dữ liệu biểu mẫu không hợp lệ');
        next();
    });
}

function renderPasswordForm(req, res, status = 200, error = '')
{
    res.status(status).render('layout', { page: 'password', title: 'Đổi mật khẩu', error });
}

function requirePasswordUser(req, res, next)
{
    if (!req.user) return redirectToLogin(res, passwordPath);
    next();
}

function createAuthRouter(prisma, cookieSecure, now)
{
    const router = express.Router();
    const authForm = parseFormWith(renderForm);
    router.get(['/register', '/login'], (req, res) => renderForm(req, res));

    router.post('/register', authForm, async (req, res, next) =>
    {
        const username = normalizeLogin(req.body.username);
        const { password, passwordConfirm } = req.body;
        if (!validLogin(username))
        {
            return renderForm(req, res, 400, 'Tên đăng nhập phải dài 3–30 ký tự, bắt đầu bằng chữ hoặc số và chỉ gồm a-z, 0-9, _, . hoặc -');
        }
        const passwordError = validateNewPassword(username, password, passwordConfirm);
        if (passwordError) return renderForm(req, res, 400, passwordError);

        try
        {
            const passwordHash = await argon2.hash(password);
            const id = newId();
            let user;
            try
            {
                user = await prisma.user.create({ data: { id, username, passwordHash } });
            }
            catch (error)
            {
                if (error.code === 'P2002') return renderForm(req, res, 400, 'Tên đăng nhập đã được dùng');
                throw error;
            }
            await establishSession(req, user);
            res.redirect(303, safeNext(req.body.next ?? req.query.next));
        }
        catch (error)
        {
            next(error);
        }
    });

    router.post('/login', authForm, async (req, res, next) =>
    {
        try
        {
            const { user, error } = await verifyLogin(prisma, normalizeLogin(req.body.username), req.body.password, now());
            if (error) return renderForm(req, res, 401, error);
            await establishSession(req, user);
            res.redirect(303, safeNext(req.body.next ?? req.query.next));
        }
        catch (error)
        {
            next(error);
        }
    });

    router.post('/logout', async (req, res, next) =>
    {
        try
        {
            await closeSession(req, res, cookieSecure);
            res.redirect(303, '/');
        }
        catch (error)
        {
            next(error);
        }
    });

    router.get(passwordPath, requirePasswordUser, (req, res) => renderPasswordForm(req, res));
    router.post(passwordPath, requirePasswordUser, parseFormWith(renderPasswordForm), async (req, res, next) =>
    {
        try
        {
            const { currentPassword, newPassword, newPasswordConfirm } = req.body ?? {};
            const attemptedAt = now();
            const user = await prisma.user.findUnique({ where: { id: req.user.id } });
            const error = await checkPassword(prisma, user, currentPassword, attemptedAt, incorrectPassword);
            if (error) return renderPasswordForm(req, res, 400, error);

            const passwordError = validateNewPassword(user.username, newPassword, newPasswordConfirm);
            if (passwordError) return renderPasswordForm(req, res, 400, passwordError);
            if (newPassword === currentPassword)
            {
                return renderPasswordForm(req, res, 400, 'Mật khẩu mới phải khác mật khẩu hiện tại');
            }

            const passwordHash = await argon2.hash(newPassword);
            const changedAt = now();
            const passwordChangedAt = new Date(Math.max(changedAt, user.passwordChangedAt.getTime() + 1));
            const updated = await prisma.$transaction(async tx =>
            {
                const result = await tx.user.updateMany({
                    where: unlockedCredentials(user, changedAt),
                    data: { passwordHash, passwordChangedAt, failedLoginCount: 0, lockedUntil: null }
                });
                if (result.count === 0) return false;
                await tx.session.deleteMany({ where: { userId: user.id, NOT: { sid: req.sessionID } } });
                return true;
            });
            if (!updated)
            {
                const message = (await currentLockout(prisma, user.id, changedAt)) || incorrectPassword;
                return renderPasswordForm(req, res, 400, message);
            }

            await establishSession(req, { id: user.id, passwordChangedAt });
            res.redirect(303, '/me');
        }
        catch (error)
        {
            next(error);
        }
    });

    return router;
}

module.exports = { createAuthRouter };

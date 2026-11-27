const express = require('express');
const argon2 = require('argon2');
const { newId } = require('../ids');
const { normalizeLogin, validLogin, passwordLength, verifyLogin, safeNext } = require('../auth/login');
const { closeSession, establishSession } = require('../auth/session');

const parseForm = express.urlencoded({ extended: false, limit: '10kb' });

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

function authForm(req, res, next)
{
    parseForm(req, res, error =>
    {
        if (error) return renderForm(req, res, 400, 'Dữ liệu biểu mẫu không hợp lệ');
        next();
    });
}

function createAuthRouter(prisma, cookieSecure)
{
    const router = express.Router();
    router.get(['/register', '/login'], (req, res) => renderForm(req, res));

    router.post('/register', authForm, async (req, res, next) =>
    {
        const username = normalizeLogin(req.body.username);
        const { password, passwordConfirm } = req.body;
        if (!validLogin(username))
        {
            return renderForm(req, res, 400, 'Tên đăng nhập phải dài 3–30 ký tự, bắt đầu bằng chữ hoặc số và chỉ gồm a-z, 0-9, _, . hoặc -');
        }
        if (passwordLength(password) < 8 || passwordLength(password) > 128)
        {
            return renderForm(req, res, 400, 'Mật khẩu phải dài 8–128 ký tự');
        }
        if (normalizeLogin(password) === username)
        {
            return renderForm(req, res, 400, 'Mật khẩu không được trùng tên đăng nhập');
        }
        if (password !== passwordConfirm)
        {
            return renderForm(req, res, 400, 'Hai mật khẩu không khớp');
        }

        try
        {
            const passwordHash = await argon2.hash(password);
            const id = newId();
            try
            {
                await prisma.user.create({ data: { id, username, passwordHash } });
            }
            catch (error)
            {
                if (error.code === 'P2002') return renderForm(req, res, 400, 'Tên đăng nhập đã được dùng');
                throw error;
            }
            await establishSession(req, id);
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
            const user = await verifyLogin(prisma, normalizeLogin(req.body.username), req.body.password);
            if (!user) return renderForm(req, res, 401, 'Tên đăng nhập hoặc mật khẩu không đúng');
            await establishSession(req, user.id);
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

    return router;
}

module.exports = { createAuthRouter };

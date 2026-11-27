const path = require('node:path');
const express = require('express');
const { createApiRouter } = require('./routes/api');
const { createMediaRouter } = require('./routes/media');
const { createPagesRouter } = require('./routes/pages');
const { createAuthRouter } = require('./routes/auth');
const { originCheck } = require('./auth/originCheck');
const { sessionMiddleware, loadUser } = require('./auth/session');

function createApp({ prisma, objectStore, scratch, sessionSecret, cookieSecure = false, faultInject = '', now = Date.now })
{
    const app = express();
    app.set('view engine', 'ejs');
    app.set('faultInject', process.env.NODE_ENV === 'test' ? faultInject : '');
    app.set('views', path.join(__dirname, 'views'));
    app.use(originCheck);
    app.use(express.static(path.join(__dirname, 'public')));
    app.use('/media', createMediaRouter(prisma, objectStore), (req, res) =>
    {
        res.status(404).type('text').send('Không tìm thấy ảnh');
    });

    app.use(sessionMiddleware(prisma, sessionSecret, cookieSecure));
    app.use(loadUser(prisma, cookieSecure));
    app.use('/api', createApiRouter(prisma, objectStore, scratch));
    app.use((req, res, next) =>
    {
        res.set('Cache-Control', 'private, no-store');
        next();
    });
    app.use(createAuthRouter(prisma, cookieSecure, now));
    app.use(createPagesRouter(prisma, objectStore));

    app.use((req, res) =>
    {
        res.status(404).render('layout', { title: 'Không tìm thấy', page: '404' });
    });

    app.use((error, req, res, next) =>
    {
        if (res.headersSent) return next(error);
        if (error.status === 400)
        {
            return res.status(400).type('text').send('Yêu cầu không hợp lệ');
        }
        console.error(error);
        res.status(500).type('text').send('Máy chủ gặp lỗi');
    });

    return app;
}

module.exports = { createApp };

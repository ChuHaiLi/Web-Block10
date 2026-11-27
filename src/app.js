const path = require('node:path');
const express = require('express');
const { createApiRouter } = require('./routes/api');
const { createMediaRouter } = require('./routes/media');
const { createPagesRouter } = require('./routes/pages');

function createApp({ prisma, objectStore, scratch, faultInject = '' })
{
    const app = express();
    app.set('view engine', 'ejs');
    app.set('faultInject', process.env.NODE_ENV === 'test' ? faultInject : '');
    app.set('views', path.join(__dirname, 'views'));
    app.use(express.static(path.join(__dirname, 'public')));

    app.use('/api', createApiRouter(prisma, objectStore, scratch));
    app.use('/media', createMediaRouter(prisma, objectStore));
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

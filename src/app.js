const path = require('node:path');
const express = require('express');
const { createApiRouter } = require('./routes/api');
const { createMediaRouter } = require('./routes/media');
const { createPagesRouter } = require('./routes/pages');

function createApp({ prisma, storage })
{
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));
    app.use(express.static(path.join(__dirname, 'public')));

    app.use('/api', createApiRouter(prisma, storage));
    app.use('/media', createMediaRouter(prisma, storage));
    app.use(createPagesRouter(prisma));

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

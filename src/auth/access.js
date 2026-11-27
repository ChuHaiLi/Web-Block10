const { safeNext } = require('./login');

const unauthenticated = { code: 'UNAUTHENTICATED', message: 'Bạn cần đăng nhập' };
const forbidden = { code: 'FORBIDDEN', message: 'Chỉ chủ ảnh mới có quyền thực hiện thao tác này' };
const notFound = { code: 'NOT_FOUND', message: 'Không tìm thấy ảnh' };

function redirectToLogin(res, nextPath)
{
    const encoded = encodeURIComponent(safeNext(nextPath)).replaceAll('%2F', '/');
    return res.redirect(303, '/login?next=' + encoded);
}

function isPhotoOwner(user, photo)
{
    return user?.id === photo.ownerId;
}

function requirePhotoOwner(prisma, { api = false, select = { id: true } } = {})
{
    return async (req, res, next) =>
    {
        try
        {
            const photo = await prisma.photo.findUnique({
                where: { id: req.params.id, status: 'PUBLISHED' },
                select: { ...select, ownerId: true }
            });
            if (!photo)
            {
                if (api) return res.status(404).json({ error: notFound });
                return next('route');
            }
            if (!req.user)
            {
                if (api) return res.status(401).json({ error: unauthenticated });
                const nextPath = req.method === 'POST' ? '/photos/' + encodeURIComponent(req.params.id) : req.originalUrl;
                return redirectToLogin(res, nextPath);
            }
            if (!isPhotoOwner(req.user, photo))
            {
                if (api) return res.status(403).json({ error: forbidden });
                return res.status(403).render('layout', { title: 'Không có quyền', page: '403', message: forbidden.message });
            }

            req.photo = photo;
            next();
        }
        catch (error)
        {
            next(error);
        }
    };
}

module.exports = { unauthenticated, redirectToLogin, isPhotoOwner, requirePhotoOwner };

const session = require('express-session');

class PrismaSessionStore extends session.Store
{
    constructor(prisma)
    {
        super();
        this.prisma = prisma;
    }

    get(sid, callback)
    {
        this.prisma.session.findUnique({ where: { sid } }).then(row =>
        {
            if (!row || row.expiresAt <= new Date()) return null;
            try
            {
                return { ...JSON.parse(row.data), createdAt: row.createdAt.getTime() };
            }
            catch
            {
                return null;
            }
        }).then(value => callback(null, value), callback);
    }

    set(sid, value, callback = () => {})
    {
        const data = {
            userId: value.userId ?? null,
            data: JSON.stringify(value),
            expiresAt: new Date(value.cookie.expires)
        };
        this.prisma.session.upsert({
            where: { sid },
            create: { sid, ...data, createdAt: new Date(value.createdAt ?? Date.now()) },
            update: data
        }).then(() => callback(), callback);
    }

    destroy(sid, callback = () => {})
    {
        this.prisma.session.deleteMany({ where: { sid } }).then(() => callback(), callback);
    }

    touch(sid, value, callback = () => {})
    {
        this.prisma.session.updateMany({
            where: { sid, expiresAt: { gt: new Date() } },
            data: { expiresAt: new Date(value.cookie.expires) }
        }).then(() => callback(), callback);
    }
}

module.exports = { PrismaSessionStore };

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const MINUTE_MS = 60_000;

function lockoutMessage(lockedUntil, now)
{
    if (!lockedUntil || lockedUntil <= now) return '';
    const minutes = Math.ceil((lockedUntil - now) / MINUTE_MS);
    return 'Tài khoản tạm khóa do đăng nhập sai nhiều lần. Thử lại sau ' + minutes + ' phút';
}

function unlockedCredentials(user, now)
{
    return {
        id: user.id,
        passwordHash: user.passwordHash,
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date(now) } }]
    };
}

async function currentLockout(prisma, id, now)
{
    const user = await prisma.user.findUnique({ where: { id }, select: { lockedUntil: true } });
    return lockoutMessage(user?.lockedUntil, now);
}

function recordFailedPassword(prisma, user, now)
{
    return prisma.$transaction(async tx =>
    {
        const updated = await tx.user.updateMany({
            where: unlockedCredentials(user, now),
            data: { failedLoginCount: { increment: 1 } }
        });
        if (updated.count === 0) return currentLockout(tx, user.id, now);

        // Keep the row locked through the threshold check so two servers cannot miss or extend a lock.
        const { failedLoginCount } = await tx.user.findUniqueOrThrow({
            where: { id: user.id }, select: { failedLoginCount: true }
        });
        if (failedLoginCount < MAX_FAILED_LOGINS) return '';

        const lockedUntil = new Date(now + LOCK_MINUTES * MINUTE_MS);
        await tx.user.update({ where: { id: user.id }, data: { lockedUntil, failedLoginCount: 0 } });
        return lockoutMessage(lockedUntil, now);
    });
}

module.exports = { MAX_FAILED_LOGINS, LOCK_MINUTES, lockoutMessage, unlockedCredentials, currentLockout, recordFailedPassword };

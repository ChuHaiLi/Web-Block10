function originCheck(req, res, next)
{
    if (req.method === 'GET' || req.method === 'HEAD') return next();

    const host = req.get('Host');
    const expectedUrl = req.protocol + '://' + host;
    if (host && URL.canParse(expectedUrl))
    {
        const expected = new URL(expectedUrl);
        const origin = req.get('Origin');
        const validHost = !expected.username && !expected.password && expected.pathname === '/' &&
            !expected.search && !expected.hash;
        if (validHost && origin === expected.origin) return next();
        const referer = req.get('Referer');
        if (validHost && origin === undefined && /^https?:\/\//i.test(referer ?? '') &&
            URL.canParse(referer) && new URL(referer).origin === expected.origin)
        {
            return next();
        }
    }

    res.status(403).json({ error: { code: 'BAD_ORIGIN', message: 'Nguồn yêu cầu không hợp lệ' } });
}

module.exports = { originCheck };

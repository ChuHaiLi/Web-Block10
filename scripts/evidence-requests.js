const { randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { Readable } = require('node:stream');
const { loadConfig } = require('../src/config');
const { createDb } = require('../src/db');

const root = path.resolve(__dirname, '..');
const fixtures = path.join(root, 'test', 'fixtures');
const evidence = path.join(root, 'evidence');
const timeoutMs = 30_000;

const usage = 'Cách dùng: npm run evidence:requests -- --base http://localhost:3000 [--out <thư mục>]';

function getOptions(args)
{
    try
    {
        const [flag, base, ...rest] = args;
        if (flag === '--base' && base && (rest.length === 0 || (rest.length === 2 && rest[0] === '--out' && rest[1])))
        {
            const endpoint = new URL('/api/uploads', base);
            if (['http:', 'https:'].includes(endpoint.protocol))
            {
                return { endpoint, outDir: rest.length ? path.resolve(rest[1]) : evidence };
            }
        }
    }
    catch
    {
        // Invalid URLs use the same usage message as missing arguments.
    }
    throw new Error(usage);
}

function parseBody(text)
{
    try
    {
        return JSON.parse(text);
    }
    catch
    {
        return text;
    }
}

async function registerEvidenceUser(endpoint)
{
    const username = 'evidence-' + randomBytes(6).toString('hex');
    const password = randomBytes(24).toString('base64url');
    const response = await fetch(new URL('/register', endpoint), {
        method: 'POST',
        headers: { Origin: endpoint.origin },
        body: new URLSearchParams({ username, password, passwordConfirm: password }),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs)
    });
    const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
    await response.arrayBuffer();
    if (response.status !== 303 || !cookie?.startsWith('gallery.sid='))
    {
        throw new Error('Đăng ký tài khoản evidence thất bại (HTTP ' + response.status + ')');
    }
    return cookie;
}

async function sendFixtures(endpoint, cookie, names, missingAlt)
{
    const data = new FormData();
    for (const index of names.keys())
    {
        if (index !== missingAlt) data.append('alt_' + index, 'Ảnh kiểm thử ' + names[index]);
    }
    for (const name of names)
    {
        const type = name.endsWith('.png') ? 'image/png' : 'image/jpeg';
        const file = await fs.readFile(path.join(fixtures, name));
        data.append('photos', new Blob([file], { type }), name);
    }

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Origin: endpoint.origin, ...(cookie ? { Cookie: cookie } : {}) },
        body: data,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs)
    });
    return { status: response.status, body: parseBody(await response.text()) };
}

function* oversizedMultipart(boundary)
{
    yield Buffer.from(
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="alt_0"\r\n\r\nẢnh kiểm thử giới hạn request\r\n' +
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="photos"; filename="large.png"\r\n' +
        'Content-Type: image/png\r\n\r\n'
    );
    const chunk = Buffer.alloc(1024 * 1024, 0x78);
    for (let index = 0; index < 56; index++) yield chunk;
    yield Buffer.from('\r\n--' + boundary + '--\r\n');
}

function sendChunked(endpoint, cookie)
{
    const boundary = 'gallery-' + randomUUID();
    const body = Readable.from(oversizedMultipart(boundary));
    const transport = endpoint.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) =>
    {
        let responseStarted = false;
        const request = transport.request(endpoint, {
            method: 'POST',
            headers: {
                Origin: endpoint.origin,
                Cookie: cookie,
                'Content-Type': 'multipart/form-data; boundary=' + boundary,
                'Transfer-Encoding': 'chunked'
            },
            signal: AbortSignal.timeout(timeoutMs)
        }, async response =>
        {
            responseStarted = true;
            body.unpipe(request);
            body.destroy();
            try
            {
                const chunks = [];
                for await (const chunk of response) chunks.push(chunk);
                resolve({ status: response.statusCode, body: parseBody(Buffer.concat(chunks).toString('utf8')) });
            }
            catch (error)
            {
                reject(error);
            }
            finally
            {
                request.destroy();
            }
        });
        request.once('error', error =>
        {
            body.destroy();
            if (!responseStarted) reject(error);
        });
        body.once('error', error => request.destroy(error));
        body.pipe(request);
    });
}

async function writeMixedEvidence(prisma, endpoint, cookie, outDir, { filename, names, missingAlt, errorCodes })
{
    const response = await sendFixtures(endpoint, cookie, names, missingAlt);
    const results = response.body?.results;
    const matches = Array.isArray(results) && results.length === errorCodes.length &&
        results.every((result, index) => result?.index === index && result.filename === names[index] &&
            (errorCodes[index] ? result.ok === false && result.error?.code === errorCodes[index] :
                result.ok === true && typeof result.photo?.id === 'string'));
    if (response.status !== 200 || !matches)
    {
        throw new Error(filename + ' nhận phản hồi ngoài dự kiến HTTP ' + response.status + ' ' + JSON.stringify(response.body));
    }

    const ids = results.filter(result => result.ok).map(result => result.photo.id);
    if (await prisma.photo.count({ where: { id: { in: ids } } }) !== ids.length)
    {
        throw new Error('DB của lệnh evidence không thấy ảnh vừa upload. Hãy dùng cùng cấu hình DB với server.');
    }

    await fs.writeFile(path.join(outDir, filename), JSON.stringify(response.body, null, 2) + '\n');
    console.log(filename + ' HTTP ' + response.status + ' Photo ' + ids.join(', '));
    return results.find(result => result.ok).photo;
}

async function writeAccessEvidence(endpoint, photo, outDir)
{
    const otherCookie = await registerEvidenceUser(endpoint);
    const guestUpload = await sendFixtures(endpoint, null, ['small.png']);
    const get = url => fetch(new URL(url, endpoint), { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    const uploadPage = await get('/upload');
    const loginLocation = uploadPage.headers.get('location');
    await uploadPage.arrayBuffer();

    const otherDelete = await fetch(new URL(photo.url + '/delete', endpoint), {
        method: 'POST',
        headers: { Origin: endpoint.origin, Cookie: otherCookie },
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs)
    });
    await otherDelete.arrayBuffer();
    const gallery = await get('/');
    const showsPhoto = (await gallery.text()).includes('href="' + photo.url + '"');
    const mediaUrl = photo.variants[0].url;
    const media = await get(mediaUrl);
    await media.arrayBuffer();

    const uploadCode = guestUpload.body?.error?.code;
    const report = [
        'Khách POST /api/uploads → HTTP ' + guestUpload.status + ' ' + (uploadCode ?? ''),
        'Khách GET /upload → HTTP ' + uploadPage.status + ' ' + (loginLocation ?? ''),
        'Người khác POST ' + photo.url + '/delete → HTTP ' + otherDelete.status,
        'Khách GET / → HTTP ' + gallery.status + ' · ảnh ' + photo.id + ' hiển thị: ' + (showsPhoto ? 'có' : 'không'),
        'Khách GET ' + mediaUrl + ' → HTTP ' + media.status
    ].join('\n');
    await fs.writeFile(path.join(outDir, '17-auth-access.txt'), report + '\n');
    console.log('17-auth-access.txt\n' + report);
    if (guestUpload.status !== 401 || uploadCode !== 'UNAUTHENTICATED' ||
        uploadPage.status !== 303 || loginLocation !== '/login?next=/upload' ||
        otherDelete.status !== 403 || gallery.status !== 200 || !showsPhoto || media.status !== 200)
    {
        throw new Error('Quyền truy cập ngoài dự kiến. Xem ' + path.join(outDir, '17-auth-access.txt') + '.');
    }
}

async function captureLimit(prisma, label, send)
{
    const before = await prisma.photo.count();
    const response = await send();
    const after = await prisma.photo.count();
    return { label, before, after, ...response };
}

async function main()
{
    const { endpoint, outDir } = getOptions(process.argv.slice(2));
    const { databaseUrl } = loadConfig();
    const prisma = createDb(databaseUrl);
    try
    {
        await prisma.$connect();
        const cookie = await registerEvidenceUser(endpoint);
        await fs.mkdir(outDir, { recursive: true });
        const photo = await writeMixedEvidence(prisma, endpoint, cookie, outDir, {
            filename: '08a-invalid-files.json',
            names: ['photo.jpg', 'fake.jpg', 'truncated.jpg'],
            errorCodes: [null, 'NOT_IMAGE', 'CORRUPT']
        });
        await writeMixedEvidence(prisma, endpoint, cookie, outDir, {
            filename: '08b-invalid-files.json',
            names: ['photo.png', 'over-10mib.png', 'too-many-pixels.png', 'small.png'],
            missingAlt: 3,
            errorCodes: [null, 'TOO_LARGE', 'TOO_MANY_PIXELS', 'ALT_REQUIRED']
        });

        const tooMany = await captureLimit(prisma, '6 file hợp lệ', () => sendFixtures(endpoint, cookie, Array(6).fill('small.png')));
        const oversized = await captureLimit(prisma, 'Chunked trên 55 MiB (1 file)', () => sendChunked(endpoint, cookie));
        const report = [tooMany, oversized].map(result => [
            result.label,
            'HTTP ' + result.status,
            'Photo trước = ' + result.before,
            'Photo sau = ' + result.after,
            'Body',
            JSON.stringify(result.body, null, 2)
        ].join('\n')).join('\n\n');
        await fs.writeFile(path.join(outDir, '09-request-limits.txt'), report + '\n');
        console.log('09-request-limits.txt\n' + report);

        if (tooMany.status !== 400 || tooMany.body?.error?.code !== 'TOO_MANY_FILES' || tooMany.before !== tooMany.after ||
            oversized.status !== 413 || oversized.body?.error?.code !== 'REQUEST_TOO_LARGE' || oversized.before !== oversized.after)
        {
            throw new Error('Giới hạn request hoặc số Photo ngoài dự kiến. Xem ' + path.join(outDir, '09-request-limits.txt') + '.');
        }
        await writeAccessEvidence(endpoint, photo, outDir);
    }
    finally
    {
        await prisma.$disconnect();
    }
}

main().catch(error =>
{
    console.error(error.message);
    process.exitCode = 1;
});

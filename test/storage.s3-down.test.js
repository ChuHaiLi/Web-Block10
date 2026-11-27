const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { test } = require('node:test');
const supertest = require('supertest');
const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { createObjectStore } = require('../src/storage/objectStore');
const { prepareTest } = require('./helpers');

const s3 = {
    bucket: 'photo-gallery-test-down',
    region: 'us-east-1',
    forcePathStyle: true,
    accessKeyId: 'test-access-key-for-error-checks',
    secretAccessKey: 'test-secret-key-for-error-checks'
};

async function listen(server)
{
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return 'http://127.0.0.1:' + server.address().port;
}

function close(server)
{
    return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test('storage.s3-down upload rollback và media 502, không ghi object xuống đĩa', { timeout: 15000 }, async t =>
{
    const reservation = net.createServer();
    const endpoint = await listen(reservation);
    await close(reservation);

    const { prisma, scratch, uploadFiles } = await prepareTest(t);
    const objectStore = createObjectStore({ storageDriver: 's3', uploadRoot: scratch.root, s3: { ...s3, endpoint } });
    const request = supertest(createApp({ prisma, scratch, objectStore }));
    const log = t.mock.method(console, 'error', () => undefined);

    const upload = await request.post('/api/uploads').field('alt_0', 'S3 offline')
        .attach('photos', path.join(__dirname, 'fixtures', 'small.png'))
        .expect(200);
    const [result] = upload.body.results;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'STORAGE_ERROR');
    assert.equal(await prisma.photo.count(), 0);
    assert.deepEqual(await scratch.listDir('tmp'), []);
    for (const directory of ['photos', 'originals'])
    {
        await assert.rejects(fs.access(path.join(scratch.root, directory)), { code: 'ENOENT' });
    }

    const { body } = await uploadFiles([{ filename: 'small.png' }]).expect(200);
    assert.equal(body.results[0].ok, true);
    const [{ url }] = body.results[0].photo.variants;
    const missing = await request.get(url).expect(502);
    assert.equal(missing.headers['cache-control'], undefined);
    assert.ok(log.mock.calls.some(({ arguments: args }) => args[1]?.endpoint === endpoint &&
        args[1]?.key === url.slice('/media/'.length) && args[1]?.bucket === s3.bucket));

    const startup = spawnSync(process.execPath, ['src/server.js'], {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
        env: {
            ...process.env,
            NODE_ENV: 'development',
            DATABASE_URL: loadConfig({ nodeEnv: 'test', storageDriver: 'local' }).databaseUrl,
            PORT: '0',
            UPLOAD_ROOT: scratch.root,
            STORAGE_DRIVER: 's3',
            S3_ENDPOINT: endpoint,
            S3_BUCKET: s3.bucket,
            S3_REGION: s3.region,
            S3_ACCESS_KEY_ID: s3.accessKeyId,
            S3_SECRET_ACCESS_KEY: s3.secretAccessKey,
            S3_FORCE_PATH_STYLE: 'true'
        }
    });
    assert.ifError(startup.error);
    assert.equal(startup.status, 1);
    assert.ok(startup.stderr.includes(endpoint));
    assert.match(startup.stderr, /npm run storage:up/);
    assert.doesNotMatch(startup.stdout, /Photo Gallery:/);
    assert.ok(!startup.stderr.includes(s3.accessKeyId) && !startup.stderr.includes(s3.secretAccessKey));
});

test('storage.s3 bỏ thông tin xác thực từ lỗi SDK và chặn key sai trước khi gửi HTTP', { timeout: 10000 }, async t =>
{
    let requests = 0;
    const server = http.createServer((req, res) =>
    {
        requests++;
        res.writeHead(403, { 'Content-Type': 'application/xml' });
        res.end('<Error><Code>AccessDenied</Code><Message>' + s3.accessKeyId + ' ' + s3.secretAccessKey + '</Message></Error>');
    });
    const endpoint = await listen(server);
    t.after(() => close(server));
    const objectStore = createObjectStore({ storageDriver: 's3', s3: { ...s3, endpoint } });
    const log = t.mock.method(console, 'error', () => undefined);
    await assert.rejects(objectStore.getStream('../invalid'), { code: 'INVALID_KEY' });
    assert.equal(requests, 0);
    const key = 'originals/aaaaaaaaaaaa.png';
    await assert.rejects(objectStore.getBuffer(key), error =>
    {
        assert.equal(error.code, 'AccessDenied');
        assert.ok(!error.message.includes(s3.accessKeyId) && !error.message.includes(s3.secretAccessKey));
        assert.equal(error.cause, undefined);
        return true;
    });
    assert.equal(requests, 1);
    assert.deepEqual(log.mock.calls[0].arguments[1], {
        driver: 's3', endpoint, bucket: s3.bucket, command: 'GetObjectCommand', key, error: 'AccessDenied'
    });
});

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const dotenv = require('dotenv');
const { loadConfig } = require('../src/config');

const databaseUrl = 'postgresql://localhost/photo_gallery_test';
const sessionSecret = 'fake-session-secret-for-config-tests';
const s3Env = {
    STORAGE_DRIVER: 's3',
    S3_ENDPOINT: 'http://localhost:8333',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'photo-gallery-test',
    S3_ACCESS_KEY_ID: 'fake-access',
    S3_SECRET_ACCESS_KEY: 'fake-secret',
    S3_FORCE_PATH_STYLE: 'true'
};

test('config từ chối UPLOAD_ROOT test resolve trùng thư mục dev trong .env', t =>
{
    const env = {
        '.env': { UPLOAD_ROOT: '../custom-dev-uploads' },
        '.env.test': { DATABASE_URL: databaseUrl, SESSION_SECRET: sessionSecret, UPLOAD_ROOT: '../custom-dev-uploads/../custom-dev-uploads/.' }
    };
    t.mock.method(dotenv, 'config', ({ path: filename }) => ({ parsed: env[path.basename(filename)] }));

    assert.throws(() => loadConfig({ nodeEnv: 'test' }), /Test UPLOAD_ROOT must differ from the dev UPLOAD_ROOT in \.env/);
});

test('config mặc định dùng gallery-uploads-test khi .env.test thiếu UPLOAD_ROOT', t =>
{
    const env = { '.env': {}, '.env.test': { DATABASE_URL: databaseUrl, SESSION_SECRET: sessionSecret } };
    t.mock.method(dotenv, 'config', ({ path: filename }) => ({ parsed: env[path.basename(filename)] }));

    const config = loadConfig({ nodeEnv: 'test' });
    assert.equal(config.uploadRoot, path.resolve(__dirname, '../../gallery-uploads-test'));
    assert.equal(config.storageDriver, 'local');
    assert.equal(config.storageDriverDefaulted, true);
});

test('config từ chối STORAGE_DRIVER sai và cho phép test chọn driver rõ ràng', t =>
{
    const env = {
        '.env': {},
        '.env.test': { DATABASE_URL: databaseUrl, SESSION_SECRET: sessionSecret, ...s3Env }
    };
    t.mock.method(dotenv, 'config', ({ path: filename }) => ({ parsed: env[path.basename(filename)] }));
    assert.equal(loadConfig({ nodeEnv: 'test' }).storageDriver, 's3');
    assert.equal(loadConfig({ nodeEnv: 'test', storageDriver: 'local' }).storageDriver, 'local');
    assert.equal(loadConfig({ nodeEnv: 'test', storageDriver: 'local' }).storageDriverDefaulted, false);
    assert.throws(() => loadConfig({ nodeEnv: 'test', storageDriver: 'disk' }), /STORAGE_DRIVER/);
});

test('config kiểm tra biến S3 và giữ riêng bucket test', t =>
{
    const fileEnv = { DATABASE_URL: databaseUrl, SESSION_SECRET: sessionSecret, ...s3Env };
    const devEnv = { S3_BUCKET: 'photo-gallery' };
    t.mock.method(dotenv, 'config', ({ path: filename }) => ({
        parsed: path.basename(filename) === '.env.test' ? fileEnv : devEnv
    }));
    const load = () => loadConfig({ nodeEnv: 'test' }).s3;
    assert.equal(load().bucket, 'photo-gallery-test');
    assert.equal(load().forcePathStyle, true);
    fileEnv.S3_FORCE_PATH_STYLE = 'false';
    assert.equal(load().forcePathStyle, false);
    fileEnv.S3_FORCE_PATH_STYLE = 'maybe';
    assert.throws(load, /S3_FORCE_PATH_STYLE/);
    fileEnv.S3_FORCE_PATH_STYLE = 'true';

    for (const name of Object.keys(s3Env).filter(name => name.startsWith('S3_')))
    {
        delete fileEnv[name];
        assert.throws(load, {
            message: 'Thiếu biến trong .env.test: ' + name
        });
        fileEnv[name] = s3Env[name];
    }
    for (const bucket of ['Photo-gallery-test', '-test', 'test-', 'ab', 'test' + 'a'.repeat(60)])
    {
        fileEnv.S3_BUCKET = bucket;
        assert.throws(load, /S3_BUCKET phải dài 3–63 ký tự/);
    }
    fileEnv.S3_BUCKET = 'gallery';
    assert.throws(load, /phải chứa "test"/);
    fileEnv.S3_BUCKET = devEnv.S3_BUCKET = 'photo-gallery-test';
    assert.throws(load, /khác S3_BUCKET trong \.env/);
    devEnv.S3_BUCKET = 'photo-gallery';
    fileEnv.S3_ENDPOINT = 'http://fake-user:fake-password@localhost:8333';
    assert.throws(load, { message: 'S3_ENDPOINT phải là URL HTTP hoặc HTTPS không chứa thông tin xác thực, query hay fragment' });
});

test('config yêu cầu SESSION_SECRET riêng và kiểm tra COOKIE_SECURE', t =>
{
    const fileEnv = { DATABASE_URL: databaseUrl };
    t.mock.method(dotenv, 'config', ({ path: filename }) => ({
        parsed: path.basename(filename) === '.env.test' ? fileEnv : { SESSION_SECRET: 'separate-dev-secret-for-config-tests' }
    }));
    const load = () => loadConfig({ nodeEnv: 'test' });
    for (const invalid of [undefined, 'a'.repeat(31), 'replace-with-at-least-32-random-characters'])
    {
        fileEnv.SESSION_SECRET = invalid;
        assert.throws(load, /SESSION_SECRET trong \.env\.test/);
    }
    fileEnv.SESSION_SECRET = sessionSecret;
    assert.equal(load().sessionSecret, sessionSecret);
    assert.equal(load().cookieSecure, false);
    fileEnv.COOKIE_SECURE = 'true';
    assert.equal(load().cookieSecure, true);
    fileEnv.COOKIE_SECURE = 'maybe';
    assert.throws(load, /COOKIE_SECURE/);
});

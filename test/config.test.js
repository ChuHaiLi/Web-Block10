const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const dotenv = require('dotenv');
const { loadConfig } = require('../src/config');

const databaseUrl = 'postgresql://localhost/photo_gallery_test';

test('config từ chối UPLOAD_ROOT test resolve trùng thư mục dev trong .env', t =>
{
    const env = {
        '.env': { UPLOAD_ROOT: '../custom-dev-uploads' },
        '.env.test': { DATABASE_URL: databaseUrl, UPLOAD_ROOT: '../custom-dev-uploads/../custom-dev-uploads/.' }
    };
    t.mock.method(dotenv, 'config', ({ path: filename }) => ({ parsed: env[path.basename(filename)] }));

    assert.throws(() => loadConfig({ nodeEnv: 'test' }), /Test UPLOAD_ROOT must differ from the dev UPLOAD_ROOT in \.env/);
});

test('config mặc định dùng gallery-uploads-test khi .env.test thiếu UPLOAD_ROOT', t =>
{
    const env = { '.env': {}, '.env.test': { DATABASE_URL: databaseUrl } };
    t.mock.method(dotenv, 'config', ({ path: filename }) => ({ parsed: env[path.basename(filename)] }));

    const config = loadConfig({ nodeEnv: 'test' });
    assert.equal(config.uploadRoot, path.resolve(__dirname, '../../gallery-uploads-test'));
    assert.equal(config.storageDriver, 'local');
});

test('config từ chối STORAGE_DRIVER sai và cho phép test chọn driver rõ ràng', t =>
{
    const env = {
        '.env': {},
        '.env.test': { DATABASE_URL: databaseUrl, STORAGE_DRIVER: 's3' }
    };
    t.mock.method(dotenv, 'config', ({ path: filename }) => ({ parsed: env[path.basename(filename)] }));
    assert.equal(loadConfig({ nodeEnv: 'test' }).storageDriver, 's3');
    assert.equal(loadConfig({ nodeEnv: 'test', storageDriver: 'local' }).storageDriver, 'local');
    assert.throws(() => loadConfig({ nodeEnv: 'test', storageDriver: 'disk' }), /STORAGE_DRIVER/);
});

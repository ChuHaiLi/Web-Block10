const path = require('node:path');
const dotenv = require('dotenv');

const appRoot = path.resolve(__dirname, '..');
const defaultDevRoot = '../gallery-uploads';
const defaultTestRoot = '../gallery-uploads-test';

function readEnv(filename)
{
    return dotenv.config({ path: path.join(appRoot, filename), processEnv: {} }).parsed ?? {};
}

function loadConfig({ nodeEnv = process.env.NODE_ENV, uploadRoot, storageDriver } = {})
{
    const isTest = nodeEnv === 'test';
    const devEnv = readEnv('.env');
    const envFile = isTest ? '.env.test' : '.env';
    const fileEnv = isTest ? readEnv(envFile) : devEnv;
    const env = isTest ? fileEnv : { ...fileEnv, ...process.env };
    const driver = storageDriver ?? (env.STORAGE_DRIVER || 'local');
    if (!['local', 's3'].includes(driver)) throw new Error('STORAGE_DRIVER phải là local hoặc s3');
    const root = path.resolve(appRoot, uploadRoot ?? (env.UPLOAD_ROOT || (isTest ? defaultTestRoot : defaultDevRoot)));

    if (isTest)
    {
        const devRoot = path.resolve(appRoot, devEnv.UPLOAD_ROOT || defaultDevRoot);
        if (path.relative(devRoot, root) === '')
        {
            throw new Error('Test UPLOAD_ROOT must differ from the dev UPLOAD_ROOT in .env');
        }
    }

    for (const directory of [__dirname, path.join(appRoot, 'public')])
    {
        const relative = path.relative(directory, root);
        if (relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)))
        {
            throw new Error('UPLOAD_ROOT must be outside src/ and public/');
        }
    }

    if (!env.DATABASE_URL)
    {
        throw new Error(`DATABASE_URL is missing from ${envFile}`);
    }

    return {
        databaseUrl: env.DATABASE_URL,
        port: Number(env.PORT || 3000),
        uploadRoot: root,
        storageDriver: driver,
        versionRetentionHours: Number(env.VERSION_RETENTION_HOURS || 24),
        cleanupIntervalMinutes: Number(env.CLEANUP_INTERVAL_MINUTES || 15),
        faultInject: isTest ? (env.FAULT_INJECT ?? '') : ''
    };
}

module.exports = { loadConfig };

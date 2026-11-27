const path = require('node:path');
const dotenv = require('dotenv');

const appRoot = path.resolve(__dirname, '..');
const defaultDevRoot = '../gallery-uploads';
const defaultTestRoot = '../gallery-uploads-test';
const requiredS3Variables = [
    'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_FORCE_PATH_STYLE'
];

function readEnv(filename)
{
    return dotenv.config({ path: path.join(appRoot, filename), processEnv: {} }).parsed ?? {};
}

function loadS3Config(env, envFile, devBucket, isTest)
{
    const missing = requiredS3Variables.filter(name => !env[name]?.trim());
    if (missing.length) throw new Error('Thiếu biến trong ' + envFile + ': ' + missing.join(', '));

    let endpoint;
    try
    {
        endpoint = new URL(env.S3_ENDPOINT);
    }
    catch
    {
        throw new Error('S3_ENDPOINT phải là URL HTTP hoặc HTTPS hợp lệ');
    }
    if (!['http:', 'https:'].includes(endpoint.protocol) ||
        endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    {
        throw new Error('S3_ENDPOINT phải là URL HTTP hoặc HTTPS không chứa thông tin xác thực, query hay fragment');
    }

    const bucket = env.S3_BUCKET;
    if (bucket !== bucket.trim() || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket))
    {
        throw new Error('S3_BUCKET phải dài 3–63 ký tự, chỉ gồm chữ thường, số và dấu gạch ngang, bắt đầu và kết thúc bằng chữ hoặc số');
    }
    if (isTest && (!bucket.includes('test') || bucket === devBucket))
    {
        throw new Error('S3_BUCKET của test phải chứa "test" và khác S3_BUCKET trong .env');
    }
    if (!['true', 'false'].includes(env.S3_FORCE_PATH_STYLE))
    {
        throw new Error('S3_FORCE_PATH_STYLE phải là true hoặc false');
    }
    return {
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        bucket,
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true'
    };
}

function loadConfig({ nodeEnv = process.env.NODE_ENV, uploadRoot, storageDriver } = {})
{
    const isTest = nodeEnv === 'test';
    const devEnv = readEnv('.env');
    const envFile = isTest ? '.env.test' : '.env';
    const fileEnv = isTest ? readEnv(envFile) : devEnv;
    const env = isTest ? fileEnv : { ...fileEnv, ...process.env };
    const configuredDriver = storageDriver ?? (env.STORAGE_DRIVER || undefined);
    const driver = configuredDriver ?? 'local';
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
        storageDriverDefaulted: configuredDriver === undefined,
        ...(driver === 's3' && { s3: loadS3Config(env, envFile, devEnv.S3_BUCKET, isTest) }),
        versionRetentionHours: Number(env.VERSION_RETENTION_HOURS || 24),
        cleanupIntervalMinutes: Number(env.CLEANUP_INTERVAL_MINUTES || 15),
        faultInject: isTest ? (env.FAULT_INJECT ?? '') : ''
    };
}

module.exports = { loadConfig };

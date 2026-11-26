const path = require('node:path');
const dotenv = require('dotenv');

const appRoot = path.resolve(__dirname, '..');

function loadConfig({ nodeEnv = process.env.NODE_ENV, uploadRoot } = {})
{
    const isTest = nodeEnv === 'test';
    const envFile = path.join(appRoot, isTest ? '.env.test' : '.env');
    const fileEnv = dotenv.config({ path: envFile, processEnv: {} }).parsed ?? {};
    const env = isTest ? fileEnv : { ...fileEnv, ...process.env };
    const root = path.resolve(appRoot, uploadRoot ?? (env.UPLOAD_ROOT || '../gallery-uploads'));

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
        throw new Error(`DATABASE_URL is missing from ${path.basename(envFile)}`);
    }

    return {
        databaseUrl: env.DATABASE_URL,
        port: Number(env.PORT || 3000),
        uploadRoot: root,
        versionRetentionHours: Number(env.VERSION_RETENTION_HOURS || 24),
        cleanupIntervalMinutes: Number(env.CLEANUP_INTERVAL_MINUTES || 15),
        faultInject: isTest ? (env.FAULT_INJECT ?? '') : ''
    };
}

module.exports = { loadConfig };

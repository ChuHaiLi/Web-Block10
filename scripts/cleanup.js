const { runCleanup } = require('../src/cleanup/runCleanup');
const { loadConfig } = require('../src/config');
const { createDb } = require('../src/db');
const { createStorage } = require('../src/storage');

async function cleanup()
{
    const config = loadConfig();
    const prisma = createDb(config.databaseUrl);
    const storage = createStorage(config.uploadRoot);

    try
    {
        await storage.initialize();
        await prisma.$connect();
        await runCleanup({ prisma, storage, versionRetentionHours: config.versionRetentionHours });
    }
    finally
    {
        await prisma.$disconnect();
    }
}

cleanup().catch(error =>
{
    console.error(error);
    process.exitCode = 1;
});

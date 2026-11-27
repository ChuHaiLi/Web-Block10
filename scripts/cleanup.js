const { runCleanup } = require('../src/cleanup/runCleanup');
const { loadConfig } = require('../src/config');
const { createDb } = require('../src/db');
const { createObjectStore } = require('../src/storage/objectStore');
const { createScratch } = require('../src/storage/scratch');

async function cleanup()
{
    const config = loadConfig();
    const prisma = createDb(config.databaseUrl);
    const objectStore = createObjectStore(config);
    const scratch = createScratch(config.uploadRoot);

    try
    {
        await objectStore.ensureReady();
        await scratch.initialize();
        await prisma.$connect();
        await runCleanup({ prisma, objectStore, scratch, versionRetentionHours: config.versionRetentionHours });
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

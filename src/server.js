const { createApp } = require('./app');
const { runCleanup } = require('./cleanup/runCleanup');
const { loadConfig } = require('./config');
const { createDb } = require('./db');
const { createObjectStore } = require('./storage/objectStore');
const { createScratch } = require('./storage/scratch');

async function start()
{
    const config = loadConfig();
    const prisma = createDb(config.databaseUrl);
    const objectStore = createObjectStore(config);
    const scratch = createScratch(config.uploadRoot);
    let running = false;

    async function cleanup()
    {
        if (running) return;
        running = true;
        try
        {
            await runCleanup({ prisma, objectStore, scratch, versionRetentionHours: config.versionRetentionHours });
        }
        catch (error)
        {
            console.error('Cleanup thất bại', error);
        }
        finally
        {
            running = false;
        }
    }

    try
    {
        await objectStore.ensureReady();
        await scratch.initialize();
        await prisma.$connect();
        await cleanup();
        const app = createApp({ prisma, objectStore, scratch, faultInject: config.faultInject });
        const server = app.listen(config.port, () =>
        {
            console.log(`Photo Gallery: http://localhost:${server.address().port}`);
        });
        const timer = setInterval(cleanup, config.cleanupIntervalMinutes * 60 * 1000);
        timer.unref();
        server.once('close', () => clearInterval(timer));
    }
    catch (error)
    {
        await prisma.$disconnect();
        throw error;
    }
}

start().catch(error =>
{
    console.error(error.message);
    process.exitCode = 1;
});

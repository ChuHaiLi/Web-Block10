const { createApp } = require('./app');
const { loadConfig } = require('./config');
const { createDb } = require('./db');
const { createStorage } = require('./storage');

async function start()
{
    const config = loadConfig();
    const prisma = createDb(config.databaseUrl);
    const storage = createStorage(config.uploadRoot);

    try
    {
        await storage.initialize();
        await prisma.$connect();
        const app = createApp({ prisma, storage });
        const server = app.listen(config.port, () =>
        {
            console.log(`Photo Gallery: http://localhost:${server.address().port}`);
        });
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

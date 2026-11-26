const { PrismaClient } = require('@prisma/client');

function createDb(databaseUrl)
{
    return new PrismaClient({ datasourceUrl: databaseUrl });
}

module.exports = { createDb };

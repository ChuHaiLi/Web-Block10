const sharp = require('sharp');
const renderer = require('../edit/renderEdits');

const MAX_CONCURRENT_RENDERS = 2;
let activeRenders = 0;
const waiters = [];

function acquireRenderSlot()
{
    if (activeRenders < MAX_CONCURRENT_RENDERS)
    {
        activeRenders++;
        return Promise.resolve();
    }
    return new Promise(resolve => waiters.push(resolve));
}

function releaseRenderSlot()
{
    const next = waiters.shift();
    if (next) next();
    else activeRenders--;
}

async function isVersionPublished(prisma, photoId, version)
{
    const record = await prisma.photoVersion.findFirst({
        where: { photoId, version, purgedAt: null, photo: { status: 'PUBLISHED' } },
        select: { version: true }
    });
    return Boolean(record);
}

function createRenditionService({ prisma, objectStore, queue })
{
    const inFlight = new Map();

    async function renderAndStore({ photoId, version, originalKey, edits, target })
    {
        await acquireRenderSlot();
        try
        {
            let original;
            try
            {
                original = await objectStore.getBuffer(originalKey);
            }
            catch (error)
            {
                if (error.code === 'NOT_FOUND')
                {
                    if (!await isVersionPublished(prisma, photoId, version))
                    {
                        throw Object.assign(new Error('Photo or version no longer available'), { code: 'NOT_FOUND' });
                    }
                    throw Object.assign(new Error('Missing original object: ' + originalKey), { code: 'MISSING_ORIGINAL', cause: error });
                }
                throw error;
            }

            const { image } = await renderer.renderEdits(original, edits);
            const metadata = await image.metadata();
            const hasAlpha = Boolean(metadata.hasAlpha);

            let pipeline = image.clone();
            if (target)
            {
                pipeline = pipeline.resize({
                    width: target.width,
                    height: target.height,
                    fit: 'cover',
                    position: sharp.strategy.attention
                });
            }

            const buffer = hasAlpha
                ? await pipeline.png().toBuffer()
                : await pipeline.jpeg({ quality: 90, progressive: true, mozjpeg: true }).toBuffer();

            const ext = hasAlpha ? 'png' : 'jpg';
            const contentType = hasAlpha ? 'image/png' : 'image/jpeg';
            const sizePart = target ? target.width + 'x' + target.height : 'original';
            const key = `photos/${photoId}/v${version}/dl/${sizePart}.${ext}`;

            await objectStore.put(key, buffer, { contentType });

            if (!await isVersionPublished(prisma, photoId, version))
            {
                await queue.deleteOrEnqueue(key, 'download-rollback');
                throw Object.assign(new Error('Photo or version no longer available'), { code: 'NOT_FOUND' });
            }

            return { key, buffer, contentType };
        }
        finally
        {
            releaseRenderSlot();
        }
    }

    function getOrCreate(params)
    {
        const sizePart = params.target ? params.target.width + 'x' + params.target.height : 'original';
        const flightKey = `${params.photoId}/v${params.version}/${sizePart}`;
        const existing = inFlight.get(flightKey);
        if (existing) return existing;

        const promise = renderAndStore(params).finally(() =>
        {
            inFlight.delete(flightKey);
        });
        inFlight.set(flightKey, promise);
        return promise;
    }

    return { getOrCreate };
}

module.exports = { createRenditionService, MAX_CONCURRENT_RENDERS };

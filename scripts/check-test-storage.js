const { randomBytes } = require('node:crypto');
const { buffer } = require('node:stream/consumers');
const { setTimeout: delay } = require('node:timers/promises');
const {
    HeadBucketCommand, CreateBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, DeleteBucketCommand
} = require('@aws-sdk/client-s3');
const { loadConfig } = require('../src/config');
const { createS3Client } = require('../src/storage/s3');

async function waitForBucket(client, bucket)
{
    const connectDeadline = Date.now() + 10_000;
    // The S3 port can be open while the SeaweedFS master is still electing a leader.
    const signal = AbortSignal.timeout(45_000);
    for (;;)
    {
        try
        {
            await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: signal });
            return;
        }
        catch (error)
        {
            const status = error.$metadata?.httpStatusCode;
            if (status === 404) return;
            const disconnected = ['ECONNREFUSED', 'ECONNRESET'].includes(error.code);
            const starting = disconnected ? Date.now() < connectDeadline : error.name === 'TimeoutError' || status >= 500;
            if (!starting || signal.aborted) throw error;
            await delay(250);
        }
    }
}

async function warmUp(client, s3)
{
    const suffix = '-warmup-' + randomBytes(4).toString('hex');
    const Bucket = s3.bucket.slice(0, 63 - suffix.length) + suffix;
    const object = { Bucket, Key: 'warmup.txt' };
    const bytes = Buffer.from('SeaweedFS warmup\n');

    await client.send(new CreateBucketCommand({
        Bucket,
        ...(s3.region !== 'us-east-1' && { CreateBucketConfiguration: { LocationConstraint: s3.region } })
    }));
    try
    {
        await client.send(new PutObjectCommand({
            ...object, Body: bytes, ContentType: 'text/plain', ContentLength: bytes.length
        }));
        const { Body } = await client.send(new GetObjectCommand(object));
        if (!bytes.equals(await buffer(Body))) throw new Error('Warmup object mismatch');
    }
    finally
    {
        try
        {
            await client.send(new DeleteObjectCommand(object));
        }
        finally
        {
            await client.send(new DeleteBucketCommand({ Bucket }));
        }
    }
}

async function check()
{
    const config = loadConfig({ nodeEnv: 'test', storageDriver: process.env.STORAGE_DRIVER });
    if (config.storageDriver === 'local') return;

    const client = createS3Client(config.s3);
    let reachable = false;
    try
    {
        // Check reachability without creating or writing to the configured test bucket.
        await waitForBucket(client, config.s3.bucket);
        reachable = true;
        await warmUp(client, config.s3);
        console.log('SeaweedFS đã sẵn sàng cho test.');
    }
    catch (error)
    {
        const status = error.$metadata?.httpStatusCode;
        if (status === 401 || status === 403)
        {
            throw new Error('SeaweedFS từ chối truy cập. Kiểm tra thông tin xác thực trong .env.test và seaweedfs/s3.json.');
        }
        if (!reachable)
        {
            throw new Error('SeaweedFS chưa chạy. Chạy: npm run storage:up');
        }
        throw new Error('Không chuẩn bị được SeaweedFS cho test. Kiểm tra cấu hình S3 và chạy: npm run storage:up');
    }
    finally
    {
        client.destroy();
    }
}

check().catch(error =>
{
    console.error(error.message);
    process.exitCode = 1;
});

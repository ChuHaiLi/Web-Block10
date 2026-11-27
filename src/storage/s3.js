const {
    S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
    ListObjectsV2Command, HeadBucketCommand, CreateBucketCommand
} = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const { PassThrough } = require('node:stream');
const { buffer } = require('node:stream/consumers');
const { isObjectKey, validateObjectKey } = require('./objectStore');

function createS3Client({ endpoint, region, forcePathStyle, accessKeyId, secretAccessKey })
{
    return new S3Client({
        endpoint,
        region,
        forcePathStyle,
        credentials: { accessKeyId, secretAccessKey },
        maxAttempts: 3,
        requestHandler: new NodeHttpHandler({
            connectionTimeout: 2000,
            requestTimeout: 15000,
            throwOnRequestTimeout: true
        })
    });
}

function isNotFound(error)
{
    return error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404;
}

function createS3ObjectStore(config)
{
    const { endpoint, bucket, region, accessKeyId, secretAccessKey } = config;
    const client = createS3Client(config);

    function redact(value)
    {
        return [accessKeyId, secretAccessKey].reduce((safe, credential) =>
            credential ? safe.replaceAll(credential, '[redacted]') : safe, value);
    }

    function diagnosticLabel(value, fallback)
    {
        return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? redact(value) : fallback;
    }

    function storageError(error, command, key, { missing = false, startup = false } = {})
    {
        const name = diagnosticLabel(error.name, 'S3Error');
        if (missing && isNotFound(error))
        {
            return Object.assign(new Error('Object not found: ' + redact(key)), { code: 'NOT_FOUND' });
        }

        // SDK errors can contain remote messages and signed request details. Only log these fields.
        console.error('Lỗi S3', { ...describe(), command, key: key === undefined ? undefined : redact(key), error: name });
        const message = startup ? 'Không kết nối được object storage tại ' + redact(endpoint) : 'Lỗi S3: ' + name;
        return Object.assign(new Error(message), { name, code: diagnosticLabel(error.code, name) });
    }

    async function send(command, { key, missing } = {})
    {
        try
        {
            return await client.send(command);
        }
        catch (error)
        {
            throw storageError(error, command.constructor.name, key, { missing });
        }
    }

    async function put(key, body, { contentType })
    {
        validateObjectKey(key);
        await send(new PutObjectCommand({
            Bucket: bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.length
        }), { key });
    }

    async function getStream(key)
    {
        validateObjectKey(key);
        const response = await send(new GetObjectCommand({ Bucket: bucket, Key: key }), { key, missing: true });
        const upstream = response.Body;
        const body = new PassThrough();
        upstream.once('error', error =>
        {
            if (!body.destroyed) body.destroy(storageError(error, 'GetObjectCommand', key));
        });
        upstream.once('close', () =>
        {
            if (!upstream.readableEnded && !body.destroyed)
            {
                body.destroy(storageError({ name: 'PrematureClose' }, 'GetObjectCommand', key));
            }
        });
        body.once('close', () => upstream.destroy());
        upstream.pipe(body);
        return {
            body,
            contentLength: response.ContentLength,
            contentType: response.ContentType,
            lastModified: response.LastModified
        };
    }

    async function getBuffer(key)
    {
        const { body } = await getStream(key);
        return buffer(body);
    }

    async function deleteObject(key)
    {
        validateObjectKey(key);
        await send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { key });
    }

    async function* list(prefix, { pageSize = 1000 } = {})
    {
        let token;
        do
        {
            const page = await send(new ListObjectsV2Command({
                Bucket: bucket, Prefix: prefix, MaxKeys: pageSize, ContinuationToken: token
            }), { key: prefix });
            for (const { Key: key, Size: size, LastModified: lastModified } of page.Contents ?? [])
            {
                if (isObjectKey(key)) yield { key, size, lastModified };
            }
            token = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (token);
    }

    async function ensureReady()
    {
        try
        {
            await client.send(new HeadBucketCommand({ Bucket: bucket }));
            return;
        }
        catch (error)
        {
            if (!isNotFound(error)) throw storageError(error, 'HeadBucketCommand', undefined, { startup: true });
        }

        try
        {
            await client.send(new CreateBucketCommand({
                Bucket: bucket,
                ...(region !== 'us-east-1' && { CreateBucketConfiguration: { LocationConstraint: region } })
            }));
        }
        catch (error)
        {
            if (error.name !== 'BucketAlreadyOwnedByYou')
            {
                throw storageError(error, 'CreateBucketCommand', undefined, { startup: true });
            }
        }
    }

    function describe()
    {
        return { driver: 's3', endpoint: redact(endpoint), bucket: redact(bucket) };
    }

    return { put, getStream, getBuffer, delete: deleteObject, list, ensureReady, describe };
}

module.exports = { createS3Client, createS3ObjectStore };

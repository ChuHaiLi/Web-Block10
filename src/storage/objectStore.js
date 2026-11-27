const variantKeyPattern = /^photos\/[A-Za-z0-9_-]{12}\/v\d+\/\d+\.webp$/;
const originalKeyPattern = /^originals\/[A-Za-z0-9_-]{12}\.png$/;

function isObjectKey(key)
{
    return typeof key === 'string' && key === key.trim() &&
        (variantKeyPattern.test(key) || originalKeyPattern.test(key));
}

function validateObjectKey(key)
{
    if (!isObjectKey(key)) throw Object.assign(new Error('Invalid object key'), { code: 'INVALID_KEY' });
}

/**
 * @typedef {object} ObjectStore
 * @property {(key: string, body: Buffer, options: {contentType: string}) => Promise<void>} put
 * @property {(key: string) => Promise<{body: import('node:stream').Readable, contentLength: number, contentType: string, lastModified: Date}>} getStream
 * @property {(key: string) => Promise<Buffer>} getBuffer
 * @property {(key: string) => Promise<void>} delete
 * @property {(prefix: string, options?: {pageSize?: number}) => AsyncIterable<{key: string, size: number, lastModified: Date}>} list
 * @property {() => Promise<void>} ensureReady
 * @property {() => ({driver: 'local', root: string} | {driver: 's3', endpoint: string, bucket: string})} describe
 */

/** @returns {ObjectStore} */
function createObjectStore({ storageDriver, uploadRoot })
{
    if (storageDriver === 'local') return require('./local').createLocalObjectStore(uploadRoot);
    throw new Error('STORAGE_DRIVER=' + storageDriver + ' chưa được hỗ trợ. Hãy dùng STORAGE_DRIVER=local.');
}

module.exports = { createObjectStore, isObjectKey, validateObjectKey, variantKeyPattern, originalKeyPattern };

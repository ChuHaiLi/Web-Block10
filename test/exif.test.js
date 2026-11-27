const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const sharp = require('sharp');
const { prepareTest } = require('./helpers');

function readGps(exif)
{
    const tiff = exif.subarray(exif.toString('ascii', 0, 4) === 'Exif' ? 6 : 0);
    const littleEndian = tiff.toString('ascii', 0, 2) === 'II';
    const uint16 = offset => littleEndian ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
    const uint32 = offset => littleEndian ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);

    function tagValueOffset(ifd, tag)
    {
        for (let index = 0; index < uint16(ifd); index++)
        {
            const entry = ifd + 2 + index * 12;
            if (uint16(entry) === tag) return entry + 8;
        }
        assert.fail('Thiếu tag EXIF ' + tag.toString(16));
    }

    const gpsIfd = uint32(tagValueOffset(uint32(4), 0x8825));
    function coordinate(refTag, valueTag)
    {
        const reference = String.fromCharCode(tiff[tagValueOffset(gpsIfd, refTag)]);
        const start = uint32(tagValueOffset(gpsIfd, valueTag));
        const values = [0, 8, 16].map(offset => uint32(start + offset) / uint32(start + offset + 4));
        return { reference, values };
    }

    return { latitude: coordinate(1, 2), longitude: coordinate(3, 4) };
}

test('exif xoay pixel theo orientation và loại EXIF khỏi PNG gốc và WebP', async t =>
{
    const { prisma, readObject, uploadFiles } = await prepareTest(t);
    const filename = 'exif-rotated.jpg';
    const source = await sharp(path.join(__dirname, 'fixtures', filename)).metadata();
    assert.deepEqual([source.width, source.height, source.orientation], [1200, 800, 6]);
    assert.ok(source.exif);
    assert.deepEqual(readGps(source.exif), {
        latitude: { reference: 'N', values: [10, 46, 0] },
        longitude: { reference: 'E', values: [106, 42, 0] }
    });

    const response = await uploadFiles([{ filename }]).expect(200);
    const [result] = response.body.results;
    assert.equal(result.ok, true, JSON.stringify(result));

    const photo = await prisma.photo.findUniqueOrThrow({
        where: { id: result.photo.id },
        include: { variants: { orderBy: { width: 'asc' } } }
    });
    assert.deepEqual([photo.originalWidth, photo.originalHeight], [800, 1200]);
    const original = await sharp(await readObject(photo.originalKey)).metadata();
    assert.deepEqual([original.width, original.height], [800, 1200]);
    assert.equal(original.exif, undefined);
    assert.equal(original.orientation, undefined);
    assert.deepEqual(photo.variants.map(variant => variant.width), [320, 800]);

    for (const variant of photo.variants)
    {
        const webp = await sharp(await readObject(variant.storageKey)).metadata();
        assert.ok(webp.width < webp.height);
        assert.equal(webp.exif, undefined);
        assert.equal(webp.orientation, undefined);
    }

    const largest = photo.variants.at(-1);
    const { data, info } = await sharp(await readObject(largest.storageKey)).raw().toBuffer({ resolveWithObject: true });
    function isRed(x, y)
    {
        const offset = (y * info.width + x) * info.channels;
        const [red, green, blue] = data.subarray(offset, offset + 3);
        return red > 150 && red > 2 * green && red > 2 * blue;
    }

    assert.equal(isRed(400, 235), true, 'Có đầu mũi tên ở phía trên');
    assert.equal(isRed(200, 450), true, 'Đầu mũi tên rộng hơn thân');
    assert.equal(isRed(200, 900), false, 'Thân hẹp ở phía dưới');
    assert.equal(isRed(400, 900), true, 'Có thân mũi tên ở phía dưới');
});

const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const fixtures = path.join(__dirname, '..', 'test', 'fixtures');

const tenMiB = 10 * 1024 * 1024;

function crc32(bytes)
{
    let crc = 0xffffffff;
    for (const byte of bytes)
    {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++)
        {
            crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

async function makeSizeFixtures()
{
    const keyword = Buffer.from('Comment\0', 'latin1');
    const minPadding = 12 + keyword.length;
    let png;
    for (let side = 1800; ; side -= 16)
    {
        const raw = { width: side, height: side, channels: 3 };
        png = await sharp(randomBytes(side * side * raw.channels), { raw }).png({ compressionLevel: 0 }).toBuffer();
        if (png.length <= tenMiB - minPadding) break;
    }

    for (const [filename, targetBytes] of [['exactly-10mib.png', tenMiB], ['over-10mib.png', tenMiB + 1]])
    {
        const chunk = Buffer.alloc(targetBytes - png.length, 0x78);
        chunk.writeUInt32BE(chunk.length - 12);
        chunk.write('tEXt', 4, 'ascii');
        keyword.copy(chunk, 8);
        chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
        const exact = Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
        if (exact.length !== targetBytes) throw new Error('Wrong fixture size for ' + filename);
        await sharp(exact, { failOn: 'warning' }).png().toBuffer();
        await fs.writeFile(path.join(fixtures, filename), exact);
    }
}

async function makeFixtures()
{
    await fs.mkdir(fixtures, { recursive: true });

    const gradient = Buffer.from(`
        <svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1333" viewBox="0 0 2000 1333">
            <defs>
                <linearGradient id="sky" x2="100%" y2="100%">
                    <stop offset="0" stop-color="#143849"/>
                    <stop offset="1" stop-color="#25586f"/>
                </linearGradient>
            </defs>
            <rect width="2000" height="1333" fill="url(#sky)"/>
            <text x="1000" y="666" text-anchor="middle" fill="#fff"
                font-family="Arial, sans-serif" font-size="140">Photo JPEG</text>
        </svg>`);

    const leftArrow = Buffer.from(`
        <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
            <rect width="1200" height="800" fill="#fffae5"/>
            <path d="M 160 400 L 500 100 L 500 310 L 1030 310 L 1030 490 L 500 490 L 500 700 Z" fill="#c01828"/>
        </svg>`);

    const jpeg = await sharp(gradient).jpeg().toBuffer();
    await fs.writeFile(path.join(fixtures, 'photo.jpg'), jpeg);
    await fs.writeFile(path.join(fixtures, 'fake.jpg'), 'Tệp văn bản dùng để kiểm thử, không phải ảnh.\n');
    await fs.writeFile(path.join(fixtures, 'truncated.jpg'), jpeg.subarray(0, Math.floor(jpeg.length * 0.7)));

    for (const [filename, width, height] of [
        ['photo.png', 800, 600],
        ['small.png', 200, 150],
        ['too-many-pixels.png', 8000, 5001],
        ['max-pixels.png', 8000, 5000],
        ['too-tall.png', 400, 20000]
    ])
    {
        await sharp({ create: { width, height, channels: 3, background: '#226a62' } })
            .png().toFile(path.join(fixtures, filename));
    }
    await sharp(leftArrow)
        .withMetadata({ orientation: 6 })
        .withExifMerge({
            IFD3: {
                GPSLatitudeRef: 'N',
                GPSLatitude: '10/1 46/1 0/1',
                GPSLongitudeRef: 'E',
                GPSLongitude: '106/1 42/1 0/1'
            }
        })
        .jpeg().toFile(path.join(fixtures, 'exif-rotated.jpg'));

    const corners = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
        '<rect width="200" height="150" fill="red"/>' +
        '<rect x="200" width="200" height="150" fill="lime"/>' +
        '<rect y="150" width="200" height="150" fill="blue"/>' +
        '<rect x="200" y="150" width="200" height="150" fill="yellow"/>' +
        '</svg>'
    );
    await sharp(corners).png().toFile(path.join(fixtures, 'corners.png'));

    await makeSizeFixtures();
    console.log('Đã tạo 12 fixture trong test/fixtures/');
}

makeFixtures().catch(error =>
{
    console.error(error);
    process.exitCode = 1;
});

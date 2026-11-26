const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const fixtures = path.join(__dirname, '..', 'test', 'fixtures');

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

    await sharp(gradient).jpeg().toFile(path.join(fixtures, 'photo.jpg'));
    await sharp({ create: { width: 800, height: 600, channels: 3, background: '#226a62' } })
        .png().toFile(path.join(fixtures, 'photo.png'));
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

    console.log('Đã tạo photo.jpg, photo.png và exif-rotated.jpg trong test/fixtures/');
}

makeFixtures().catch(error =>
{
    console.error(error);
    process.exitCode = 1;
});

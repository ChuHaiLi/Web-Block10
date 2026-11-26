const sharp = require('sharp');
const readExif = require('exif-reader');

async function evidence()
{
    const [file, ...extra] = process.argv.slice(2);
    if (!file || extra.length) throw new Error('Cách dùng: npm run evidence:exif -- <file>');

    const { exif: rawExif, ...metadata } = await sharp(file).metadata();
    const exif = rawExif ? readExif(rawExif) : null;
    const report = {
        file,
        metadata,
        Orientation: exif?.Image?.Orientation ?? metadata.orientation ?? null,
        GPS: exif?.GPSInfo ?? null,
        EXIF: exif
    };

    console.log(JSON.stringify(report, (key, value) =>
    {
        if (value?.type === 'Buffer' && Array.isArray(value.data)) return { bytes: value.data.length };
        return value;
    }, 2));
}

evidence().catch(error =>
{
    console.error(error.message);
    process.exitCode = 1;
});

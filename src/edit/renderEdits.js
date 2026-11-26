const sharp = require('sharp');
const { MAX_PIXELS } = require('../upload/validateImage');

async function renderEdits(original, { rotate, flipH, crop })
{
    const rotated = await sharp(original, { limitInputPixels: MAX_PIXELS, failOn: 'warning' })
        .rotate(rotate)
        .raw()
        .toBuffer({ resolveWithObject: true });

    let pixels = rotated;
    if (flipH)
    {
        pixels = await sharp(rotated.data, { raw: rotated.info })
            .flop()
            .raw()
            .toBuffer({ resolveWithObject: true });
    }

    const image = sharp(pixels.data, { raw: pixels.info });
    if (crop) image.extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height });

    return {
        image,
        width: crop?.width ?? pixels.info.width,
        height: crop?.height ?? pixels.info.height
    };
}

module.exports = { renderEdits };

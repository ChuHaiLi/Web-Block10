const { editError } = require('./errors');
const { variantPlan } = require('../upload/variantPlan');

const IDENTITY = Object.freeze({ rotate: 0, flipH: false, crop: null });

function validateEdits(input, { originalWidth, originalHeight })
{
    const baseVersion = input?.baseVersion;
    if (!Number.isInteger(baseVersion) || baseVersion < 1) throw editError('INVALID_EDITS');
    const { rotate, flipH, crop } = input.restore === true ? IDENTITY : input;
    if (![0, 90, 180, 270].includes(rotate) || typeof flipH !== 'boolean') throw editError('INVALID_EDITS');

    const turned = rotate === 90 || rotate === 270;
    const rotatedWidth = turned ? originalHeight : originalWidth;
    const rotatedHeight = turned ? originalWidth : originalHeight;
    let validatedCrop = null;
    if (crop !== null)
    {
        if (!crop || typeof crop !== 'object' || Array.isArray(crop)) throw editError('INVALID_EDITS');
        const { x, y, width, height } = crop;
        if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width < 1 || height < 1 ||
            x + width > rotatedWidth || y + height > rotatedHeight)
        {
            throw editError('INVALID_EDITS');
        }
        validatedCrop = { x, y, width, height };
    }

    const variantWidths = variantPlan(validatedCrop?.width ?? rotatedWidth, validatedCrop?.height ?? rotatedHeight);
    return { baseVersion, edits: { rotate, flipH, crop: validatedCrop }, variantWidths };
}

module.exports = { validateEdits };

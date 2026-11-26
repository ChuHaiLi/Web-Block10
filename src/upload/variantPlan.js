const { uploadError } = require('./errors');

const WEBP_MAX_DIM = 16383;

function variantPlan(width, height)
{
    const maxWidth = Math.min(width, 1600);
    const widths = [320, 960, 1600].filter(candidate => candidate < maxWidth).concat(maxWidth);
    if (widths.some(candidate => Math.max(1, Math.round(height * candidate / width)) > WEBP_MAX_DIM))
    {
        throw uploadError('UNSUPPORTED_DIMENSIONS');
    }
    return widths;
}

module.exports = { variantPlan };

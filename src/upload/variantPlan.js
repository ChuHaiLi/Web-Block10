const { uploadError } = require('./errors');

function variantPlan(width, height)
{
    const maxWidth = Math.min(width, 1600);
    const widths = [320, 960].filter(candidate => candidate < maxWidth).concat(maxWidth);
    if (widths.some(candidate => Math.max(1, Math.round(height * candidate / width)) > 16383))
    {
        throw uploadError('UNSUPPORTED_DIMENSIONS');
    }
    return widths;
}

module.exports = { variantPlan };

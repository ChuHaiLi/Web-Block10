const PRESET_GROUPS = [
    {
        id: 'desktop',
        label: 'Desktop',
        items: [
            { width: 1366, height: 768, tag: 'HD' },
            { width: 1920, height: 1080, tag: 'Full HD' },
            { width: 1920, height: 1200, tag: 'WUXGA' },
            { width: 2560, height: 1440, tag: '2K QHD' },
            { width: 2560, height: 1600, tag: 'WQXGA' },
            { width: 3440, height: 1440, tag: 'Ultrawide' },
            { width: 3840, height: 2160, tag: '4K UHD' },
            { width: 5120, height: 2880, tag: '5K' }
        ]
    },
    {
        id: 'phone',
        label: 'Điện thoại',
        items: [
            { width: 1080, height: 1920 },
            { width: 1080, height: 2400 },
            { width: 1170, height: 2532 },
            { width: 1290, height: 2796 },
            { width: 1440, height: 3200 }
        ]
    },
    {
        id: 'tablet',
        label: 'Tablet / iPad',
        items: [
            { width: 1620, height: 2160 },
            { width: 1668, height: 2388 },
            { width: 2048, height: 2732 },
            { width: 2560, height: 1600 }
        ]
    }
];

const PRESETS_BY_KEY = new Map();
for (const group of PRESET_GROUPS)
{
    for (const item of group.items)
    {
        const key = item.width + 'x' + item.height;
        if (!PRESETS_BY_KEY.has(key))
        {
            PRESETS_BY_KEY.set(key, { width: item.width, height: item.height, tag: item.tag });
        }
    }
}

function findPreset(size)
{
    if (typeof size !== 'string' || !/^\d+x\d+$/.test(size)) return null;
    return PRESETS_BY_KEY.get(size) ?? null;
}

function isPresetAllowed(size, maxWidth, maxHeight)
{
    const preset = findPreset(size);
    if (!preset) return null;
    if (preset.width > maxWidth || preset.height > maxHeight) return null;
    return preset;
}

function getAvailablePresetGroups(maxWidth, maxHeight)
{
    return PRESET_GROUPS
        .map(group => ({
            id: group.id,
            label: group.label,
            items: group.items.filter(item => item.width <= maxWidth && item.height <= maxHeight)
        }))
        .filter(group => group.items.length > 0);
}

module.exports = { PRESET_GROUPS, findPreset, isPresetAllowed, getAvailablePresetGroups };

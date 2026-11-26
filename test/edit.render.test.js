const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');
const { renderEdits } = require('../src/edit/renderEdits');

const red = [255, 0, 0];
const green = [0, 255, 0];
const blue = [0, 0, 255];
const yellow = [255, 255, 0];

function pixel({ data, info }, x, y)
{
    const start = (y * info.width + x) * info.channels;
    return Array.from(data.subarray(start, start + 3));
}

async function corners()
{
    return fs.readFile(path.join(__dirname, 'fixtures', 'corners.png'));
}

test('edit.render xoay rồi lật, kiểm tra bốn góc cho đủ tám tổ hợp', async () =>
{
    const original = await corners();
    const cases = [
        { rotate: 0, width: 400, height: 300, colors: [red, green, blue, yellow] },
        { rotate: 90, width: 300, height: 400, colors: [blue, red, yellow, green] },
        { rotate: 180, width: 400, height: 300, colors: [yellow, blue, green, red] },
        { rotate: 270, width: 300, height: 400, colors: [green, yellow, red, blue] }
    ];

    for (const { rotate, width, height, colors } of cases)
    {
        for (const flipH of [false, true])
        {
            const rendered = await renderEdits(original, { rotate, flipH, crop: null });
            assert.deepEqual([rendered.width, rendered.height], [width, height]);
            const output = await rendered.image.raw().toBuffer({ resolveWithObject: true });
            assert.deepEqual([output.info.width, output.info.height], [width, height]);
            const actual = [
                pixel(output, 5, 5), pixel(output, width - 6, 5),
                pixel(output, 5, height - 6), pixel(output, width - 6, height - 6)
            ];
            const expected = flipH ? [colors[1], colors[0], colors[3], colors[2]] : colors;
            assert.deepEqual(actual, expected, 'rotate=' + rotate + ' flipH=' + flipH);
        }
    }
});

test('edit.render crop theo tọa độ sau khi đã xoay và lật', async () =>
{
    const edits = { rotate: 90, flipH: true, crop: { x: 180, y: 20, width: 100, height: 85 } };
    const rendered = await renderEdits(await corners(), edits);
    assert.deepEqual([rendered.width, rendered.height], [100, 85]);
    const output = await rendered.image.raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([output.info.width, output.info.height], [100, 85]);
    for (let offset = 0; offset < output.data.length; offset += output.info.channels)
    {
        assert.equal(output.data[offset], 0);
        assert.equal(output.data[offset + 1], 0);
        assert.equal(output.data[offset + 2], 255);
    }
});

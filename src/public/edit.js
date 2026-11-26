const editForm = document.querySelector('#edit-form');
const controls = document.querySelector('#edit-controls');
const flip = document.querySelector('#flip-horizontal');
const stage = document.querySelector('#crop-stage');
const outline = document.querySelector('#crop-outline');
const canvas = document.querySelector('#edit-canvas');
const preview = document.querySelector('#crop-preview');
const cropCanvas = document.querySelector('#crop-canvas');
const status = document.querySelector('#edit-status');
const errorMessage = document.querySelector('#edit-error');
const reload = document.querySelector('#reload-edit');
const context = canvas.getContext('2d');
const cropContext = cropCanvas.getContext('2d');
const source = new Image();

const { baseVersion, originalWidth, originalHeight, edits } = JSON.parse(editForm.dataset.initial);
let { rotate, crop } = edits;
let realWidth;
let realHeight;
let drag;
let firstCorner;

function drawImage()
{
    const sideways = rotate === 90 || rotate === 270;
    realWidth = sideways ? originalHeight : originalWidth;
    realHeight = sideways ? originalWidth : originalHeight;
    canvas.width = sideways ? source.naturalHeight : source.naturalWidth;
    canvas.height = sideways ? source.naturalWidth : source.naturalHeight;
    context.save();
    context.translate(canvas.width / 2, canvas.height / 2);
    // The canvas applies composed transforms to pixels in reverse call order.
    context.scale(flip.checked ? -1 : 1, 1);
    context.rotate(rotate * Math.PI / 180);
    context.drawImage(source, -source.naturalWidth / 2, -source.naturalHeight / 2);
    context.restore();
    drawCrop();
}

function drawOutline(region)
{
    outline.hidden = !region;
    if (!region) return;
    outline.style.left = region.x / realWidth * 100 + '%';
    outline.style.top = region.y / realHeight * 100 + '%';
    outline.style.width = region.width / realWidth * 100 + '%';
    outline.style.height = region.height / realHeight * 100 + '%';
}

function drawCrop()
{
    drawOutline(crop);
    preview.hidden = !crop;
    if (!crop) return;

    const scaleX = canvas.width / realWidth;
    const scaleY = canvas.height / realHeight;
    const width = crop.width * scaleX;
    const height = crop.height * scaleY;
    cropCanvas.width = Math.max(1, Math.round(width));
    cropCanvas.height = Math.max(1, Math.round(height));
    cropContext.drawImage(canvas, crop.x * scaleX, crop.y * scaleY, width, height,
        0, 0, cropCanvas.width, cropCanvas.height);
}

function imagePoint(event)
{
    const bounds = canvas.getBoundingClientRect();
    return {
        x: Math.min(realWidth, Math.max(0, Math.round((event.clientX - bounds.left) * realWidth / bounds.width))),
        y: Math.min(realHeight, Math.max(0, Math.round((event.clientY - bounds.top) * realHeight / bounds.height)))
    };
}

function regionBetween(start, end)
{
    return {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(start.x - end.x),
        height: Math.abs(start.y - end.y)
    };
}

function resetSelection()
{
    drag = null;
    firstCorner = null;
    status.textContent = '';
}

canvas.addEventListener('pointerdown', event =>
{
    if (controls.disabled || drag || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, start: imagePoint(event), moved: false };
    canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', event =>
{
    if (drag?.id !== event.pointerId) return;
    drag.moved ||= Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 3;
    if (drag.moved) drawOutline(regionBetween(drag.start, imagePoint(event)));
});

canvas.addEventListener('pointerup', event =>
{
    if (drag?.id !== event.pointerId) return;
    const end = imagePoint(event);
    const start = drag.moved ? drag.start : firstCorner;
    if (!start)
    {
        firstCorner = end;
        drag = null;
        status.textContent = 'Chọn góc đối diện của vùng crop.';
        return;
    }

    const region = regionBetween(start, end);
    resetSelection();
    if (region.width && region.height) crop = region;
    drawCrop();
});

canvas.addEventListener('lostpointercapture', event =>
{
    if (drag?.id !== event.pointerId) return;
    resetSelection();
    drawCrop();
});

function changeRotation(degrees)
{
    rotate = (rotate + degrees + 360) % 360;
    crop = null;
    resetSelection();
    drawImage();
}

document.querySelector('#rotate-left').addEventListener('click', () => changeRotation(-90));
document.querySelector('#rotate-right').addEventListener('click', () => changeRotation(90));
flip.addEventListener('change', () =>
{
    resetSelection();
    drawImage();
});
document.querySelector('#clear-crop').addEventListener('click', () =>
{
    crop = null;
    resetSelection();
    drawCrop();
});

async function save(restore)
{
    if (controls.disabled) return;
    resetSelection();
    drawOutline(crop);
    controls.disabled = true;
    status.textContent = restore ? 'Đang khôi phục…' : 'Đang lưu…';
    errorMessage.textContent = '';
    const edits = restore ? { restore: true } : { rotate, flipH: flip.checked, crop };
    let keepDisabled = false;
    try
    {
        const response = await fetch(editForm.action, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseVersion, ...edits })
        });
        if (response.status === 200)
        {
            keepDisabled = true;
            window.location.assign(editForm.dataset.detail);
        }
        else if (response.status === 409)
        {
            keepDisabled = true;
            errorMessage.textContent = 'Ảnh đã có phiên bản mới';
            reload.hidden = false;
            reload.focus();
        }
        else
        {
            const body = await response.json();
            errorMessage.textContent = body.error.message;
        }
    }
    catch
    {
        errorMessage.textContent = 'Không lưu được phiên bản ảnh. Vui lòng thử lại.';
    }
    finally
    {
        status.textContent = '';
        controls.disabled = keepDisabled;
    }
}

editForm.addEventListener('submit', event =>
{
    event.preventDefault();
    save(false);
});
document.querySelector('#restore-photo').addEventListener('click', () => save(true));
reload.addEventListener('click', () => window.location.reload());

flip.checked = edits.flipH;
source.addEventListener('load', () =>
{
    drawImage();
    stage.hidden = false;
    controls.disabled = false;
    status.textContent = '';
});
source.addEventListener('error', () =>
{
    status.textContent = '';
    errorMessage.textContent = 'Không tải được ảnh xem trước.';
});
source.src = editForm.dataset.source;

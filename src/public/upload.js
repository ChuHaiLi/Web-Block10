const form = document.querySelector('#upload-form');
const input = form.elements.photos;
const submit = form.querySelector('button');
const fileList = document.querySelector('#upload-files');
const template = document.querySelector('#upload-file');
const statusMessage = document.querySelector('#upload-status');
const warning = document.querySelector('#upload-warning');
const requestError = document.querySelector('#upload-error');
const results = document.querySelector('#upload-results');
const formatSize = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
let entries = [];

form.noValidate = new URLSearchParams(location.search).get('novalidate') === '1';

function setEntryIndex({ row, title, alt, error }, index)
{
    title.id = title.name = 'title_' + index;
    row.querySelector('[data-label="title"]').htmlFor = title.id;

    alt.id = alt.name = 'alt_' + index;
    const hint = row.querySelector('.upload-alt-hint');
    hint.id = 'alt-hint-' + index;
    alt.setAttribute('aria-describedby', hint.id);
    row.querySelector('[data-label="alt"]').htmlFor = alt.id;

    error.id = 'file-error-' + index;
    row.setAttribute('aria-describedby', error.id);
}

function renderFiles()
{
    for (const entry of entries) URL.revokeObjectURL(entry.previewUrl);
    fileList.replaceChildren();

    entries = Array.from(input.files, (file, index) =>
    {
        const row = template.content.firstElementChild.cloneNode(true);
        const title = row.querySelector('.upload-title');
        const alt = row.querySelector('.upload-alt');
        const error = row.querySelector('.upload-file-error');
        const previewUrl = URL.createObjectURL(file);

        row.querySelector('legend').textContent = file.name;
        row.querySelector('img').src = previewUrl;
        row.querySelector('.upload-size').textContent = formatSize.format(file.size / 1024) + ' KiB';

        title.placeholder = file.name;
        const entry = { file, title, alt, error, row, previewUrl };
        setEntryIndex(entry, index);
        fileList.append(row);
        return entry;
    });

    updateWarnings();
}

function updateWarnings()
{
    const warnings = [];
    if (entries.length > 5) warnings.push('Bạn đã chọn quá 5 ảnh.');
    const oversized = entries.filter(entry => entry.file.size > 10 * 1024 * 1024).map(entry => entry.file.name);
    if (oversized.length) warnings.push('Ảnh vượt quá 10 MiB gồm ' + oversized.join(', ') + '.');
    warning.textContent = warnings.join(' ');
}

function applyResults(uploadResults)
{
    const saved = new Set();
    for (const result of uploadResults)
    {
        const entry = entries[result.index];
        if (!result.ok)
        {
            entry.error.textContent = result.error.message;
            continue;
        }

        saved.add(result.index);
        const item = document.createElement('li');
        item.textContent = entry.file.name + ' — ';
        const link = document.createElement('a');
        link.href = result.photo.url;
        link.textContent = 'Xem ảnh';
        item.append(link);
        results.append(item);
    }

    if (saved.size)
    {
        const pending = new DataTransfer();
        entries = entries.filter((entry, index) =>
        {
            if (saved.has(index))
            {
                URL.revokeObjectURL(entry.previewUrl);
                entry.row.remove();
                return false;
            }

            pending.items.add(entry.file);
            return true;
        });
        input.files = pending.files;
        entries.forEach(setEntryIndex);
        updateWarnings();
    }

    return saved.size;
}

input.addEventListener('change', () =>
{
    results.replaceChildren();
    requestError.textContent = '';
    statusMessage.textContent = '';
    renderFiles();
});

form.addEventListener('submit', async event =>
{
    event.preventDefault();
    if (submit.disabled) return;

    const data = new FormData();
    for (const { title, alt } of entries)
    {
        data.append(title.name, title.value);
        data.append(alt.name, alt.value);
    }
    for (const { file } of entries) data.append('photos', file);

    submit.disabled = input.disabled = true;
    for (const { row } of entries) row.disabled = true;
    results.replaceChildren();
    requestError.textContent = '';
    statusMessage.textContent = 'Đang tải ảnh lên…';

    try
    {
        const response = await fetch(form.action, { method: 'POST', body: data });
        const payload = await response.json();
        if (!response.ok)
        {
            requestError.textContent = payload.error.message;
            statusMessage.textContent = '';
            return;
        }

        const succeeded = applyResults(payload.results);
        statusMessage.textContent = 'Đã tải ' + succeeded + '/' + payload.results.length + ' ảnh.';
    }
    catch
    {
        statusMessage.textContent = '';
        requestError.textContent = 'Không tải được ảnh. Vui lòng thử lại.';
    }
    finally
    {
        submit.disabled = input.disabled = false;
        for (const { row } of entries) row.disabled = false;
    }
});

const dropzone = document.querySelector('#dropzone');
let dragDepth = 0;

function hasFiles(event)
{
    return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

dropzone.addEventListener('dragenter', event =>
{
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth++;
    dropzone.classList.add('is-dragover');
});

dropzone.addEventListener('dragover', event =>
{
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = input.disabled ? 'none' : 'copy';
});

dropzone.addEventListener('dragleave', () =>
{
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropzone.classList.remove('is-dragover');
});

dropzone.addEventListener('drop', event =>
{
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    dropzone.classList.remove('is-dragover');
    if (input.disabled || event.dataTransfer.files.length === 0) return;

    input.files = event.dataTransfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
});

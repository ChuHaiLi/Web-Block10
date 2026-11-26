const form = document.querySelector('#upload-form');
const statusMessage = document.querySelector('#upload-status');
const submit = form.querySelector('button');

form.addEventListener('submit', async event =>
{
    event.preventDefault();
    const data = new FormData();
    data.append('title_0', form.elements.title_0.value);
    data.append('alt_0', form.elements.alt_0.value);
    data.append('photos', form.elements.photos.files[0]);

    submit.disabled = true;
    statusMessage.textContent = 'Đang tải ảnh lên…';

    try
    {
        const response = await fetch(form.action, { method: 'POST', body: data });
        const payload = await response.json();
        if (!response.ok)
        {
            statusMessage.textContent = payload.error.message;
            return;
        }

        const [result] = payload.results;
        if (!result.ok)
        {
            statusMessage.textContent = result.error.message;
            return;
        }

        const link = document.createElement('a');
        link.href = `/#photo-${result.photo.id}`;
        link.textContent = 'Xem ảnh trong gallery';
        statusMessage.replaceChildren('Đã tải ảnh lên. ', link);
        form.reset();
    }
    catch
    {
        statusMessage.textContent = 'Không tải được ảnh. Vui lòng thử lại.';
    }
    finally
    {
        submit.disabled = false;
    }
});

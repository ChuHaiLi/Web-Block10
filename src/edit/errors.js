const messages = {
    INVALID_EDITS: 'Thông số chỉnh sửa không hợp lệ',
    NOT_FOUND: 'Không tìm thấy ảnh',
    VERSION_CONFLICT: 'Ảnh đã có phiên bản mới',
    STORAGE_ERROR: 'Không lưu được phiên bản ảnh'
};

function editError(code, { currentVersion, cause } = {})
{
    const error = Object.assign(new Error(messages[code], { cause }), { code });
    if (currentVersion !== undefined) error.currentVersion = currentVersion;
    return error;
}

module.exports = { editError };

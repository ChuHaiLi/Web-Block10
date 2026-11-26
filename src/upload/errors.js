const messages = {
    NOT_MULTIPART: 'Yêu cầu phải dùng multipart/form-data',
    MALFORMED: 'Dữ liệu multipart không hợp lệ',
    NO_FILES: 'Hãy chọn một ảnh để tải lên',
    TOO_MANY_FILES: 'Mỗi lần tải lên chỉ nhận một ảnh',
    REQUEST_TOO_LARGE: 'Yêu cầu vượt quá 55 MiB',
    ABORTED: 'Kết nối đã bị ngắt',
    ALT_REQUIRED: 'Hãy nhập mô tả nội dung ảnh',
    INVALID_FIELD: 'Tiêu đề tối đa 120 ký tự và mô tả tối đa 250 ký tự',
    TOO_LARGE: 'Ảnh vượt quá 10 MiB',
    NOT_IMAGE: 'File không phải JPEG hoặc PNG',
    CORRUPT: 'Không đọc được ảnh',
    TOO_MANY_PIXELS: 'Ảnh vượt quá 40 triệu pixel',
    UNSUPPORTED_DIMENSIONS: 'Kích thước variant vượt giới hạn WebP',
    STORAGE_ERROR: 'Không lưu được ảnh'
};

function uploadError(code, cause)
{
    return Object.assign(new Error(messages[code], { cause }), { code });
}

module.exports = { uploadError };

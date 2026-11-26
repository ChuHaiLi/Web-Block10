# Checklist bằng chứng

Dùng cùng một lần chạy và cùng một `photoId` cho các mục 01–04. Ghi nhận ID ở đây để đối chiếu response upload, DB, file trên đĩa và GET media. Che thông tin xác thực trước khi nộp. [Quy định bằng chứng](../SPEC.md)

**photoId cho mục 01–04** ____________________

- [ ] **01** `01-network-upload.png`. Tab Network cho thấy POST multipart, header `Content-Type` có boundary, payload và response theo từng file.
- [ ] **02** `02-upload-response.json`. JSON của cùng request ở mục 01.
- [ ] **03** `03-db.txt`. Output `npm run evidence:db` có `Photo`, `PhotoVariant`, storage key và danh sách file thật tương ứng.
- [ ] **04** `04-media-get.png` và `04-media-get.txt`. Dòng GET media trong DevTools khi mở gallery và header dạng text. Ghi rõ `200`, `Content-Type` và `Cache-Control`. Dùng `curl.exe -s -D - -o NUL <url>` trên Windows hoặc `curl -s -D - -o /dev/null <url>` trên POSIX để lấy header từ GET.
- [ ] **05** `05-exif-before.txt` và `05-exif-after.txt`. Output `npm run evidence:exif` của `exif-rotated.jpg` có GPS và Orientation, rồi của WebP đã lưu với EXIF đã bị loại.
- [ ] **06** `06-currentsrc-*.png`. Chụp đủ ba cấu hình ở mục 12. Ghi `img.currentSrc`, `window.devicePixelRatio`, viewport và dòng Network tương ứng.
- [ ] **07** `07-dom.png`. Elements panel hiện `srcset`, `sizes`, `width`, `height`, `loading` và `alt` trên `<img>`.
- [ ] **08** `08a-invalid-files.json` và `08b-invalid-files.json`. Chạy `npm run evidence:requests -- --base http://localhost:3000` để gửi hai request. Request A gồm `photo.jpg`, `fake.jpg`, `truncated.jpg`. Request B gồm `photo.png`, `over-10mib.png`, `too-many-pixels.png` và `small.png` thiếu alt. Kèm output `npm run evidence:db -- --photo "<id>"` cho ảnh thành công trong mỗi JSON.
- [ ] **09** `09-request-limits.txt`. Cùng lệnh ở mục 08 gửi sáu file hợp lệ và một request chunked chứa một phần file vượt 55 MiB. File ghi status `400 TOO_MANY_FILES` và `413 REQUEST_TOO_LARGE`, response body và số `Photo` trước và sau từng request. Số `Photo` phải giữ nguyên trong mỗi ca.
- [ ] **10** `10-db-fault.txt`. Dùng `NODE_ENV=test` với `FAULT_INJECT=db-after-write` trong `.env.test`. Liệt kê file trong `UPLOAD_ROOT` sau lỗi, chạy `npm run cleanup`, rồi liệt kê lại. [Cách chạy trong README](../README.md)
- [ ] **11** `11-restart.png` và `11-restart.txt`. Dừng hẳn server, chạy lại với cùng DB và kho. Gallery và cùng URL GET media vẫn trả `200`.
- [ ] **12** `12-delete.txt`. Ghi trạng thái DB trước và sau khi xóa, GET media mới trả `404` và chứng minh file đã được dọn khỏi kho.
- [ ] **13** `13-env-example.txt`. Bản sao nội dung `.env.example` đã kiểm tra thông tin xác thực.
- [ ] **14** `14-bonus-*` nếu làm bonus. Ghi bằng chứng trước và sau chỉnh sửa, URL đổi từ `v1` sang `v2` và response `409` khi lưu đồng thời. Với cleanup, ghi `purgedAt` của version quá hạn, số file `supersededVersionFilesRemoved` từ `npm run cleanup` và kết quả GET mới của version đã dọn (`404`) và version hiện tại (`200`).

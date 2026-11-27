# Photo Gallery

Ứng dụng upload ảnh JPEG/PNG, tạo biến thể WebP và hiển thị gallery responsive. Express và EJS render trang, PostgreSQL lưu metadata qua Prisma, còn file ảnh nằm trên đĩa.

## Cài đặt và chạy

Cần PostgreSQL đang chạy và Node.js 20.6 trở lên để dùng lệnh `--env-file` bên dưới. Chạy các lệnh từ thư mục gốc dự án.

```sh
npm i
```

Tạo `.env` và `.env.test` từ `.env.example` khi chưa có hai file cục bộ. Điền `DATABASE_URL` cho từng DB. Tên DB test phải chứa `test`, ví dụ `photo_gallery_test`. Đặt `UPLOAD_ROOT` riêng cho test, mặc định là `../gallery-uploads-test`. Dev mặc định dùng `../gallery-uploads`. Đường dẫn tương đối được tính từ thư mục gốc dự án.

```sh
npm run fixtures
npx prisma migrate dev
node --env-file=.env.test ./node_modules/prisma/build/index.js migrate deploy
npm run dev
```

Mở `http://localhost:3000` để xem gallery hoặc `/upload` để tải ảnh lên. Các lệnh migration ở trên đọc URL từ file môi trường tương ứng khi terminal chưa đặt `DATABASE_URL`. DB dev và DB test dùng cùng bộ migration.

```sh
npm test
```

Test chạy tuần tự, reset DB test và dùng kho tạm riêng cho từng ca. Test restart đóng HTTP server và kết nối Prisma đầu tiên, rồi mở một app mới với cùng DB và kho để kiểm tra gallery và GET media.

## Giới hạn upload

| Giới hạn | Giá trị |
|---|---|
| Ảnh trong một request multipart | 1–5 file JPEG hoặc PNG |
| Dung lượng mỗi file | Tối đa 10 MiB, chấp nhận đúng 10 MiB |
| Tổng request | Tối đa 55 MiB |
| Số pixel | Tối đa 40.000.000 |
| Kích thước mỗi cạnh WebP | Tối đa 16.383 px sau resize |
| Tiêu đề và mô tả ảnh | Title tối đa 120 ký tự, alt bắt buộc và tối đa 250 ký tự |
| Parser multipart | Tối đa 20 trường văn bản, 4.096 byte mỗi trường và giới hạn 30 part |

Server kiểm tra chữ ký JPEG/PNG và kích thước từ header, rồi giải mã để phát hiện file hỏng. Ảnh được xoay theo EXIF và metadata EXIF, gồm GPS, bị loại khỏi PNG gốc đã chuẩn hóa và các WebP. Mỗi ảnh có tối đa ba variant dựa trên các mốc 320, 960 và 1600 px, giới hạn theo chiều rộng thực để tránh phóng to.

Lỗi cấp request như quá số file, quá tổng dung lượng hoặc multipart hỏng chặn toàn bộ lần upload. Khi request hợp lệ, API trả kết quả theo index và chỉ lưu các file hợp lệ.

## Kho ảnh và xóa

`STORAGE_DRIVER=local` lưu ảnh công bố và PNG gốc qua interface `ObjectStore`. File tạm và hàng đợi dọn dùng kho nháp trên đĩa. Với driver local, cả hai nằm trong `UPLOAD_ROOT` và dùng các prefix riêng.

| Đường dẫn trong `UPLOAD_ROOT` | Nội dung |
|---|---|
| `originals/<id>.png` | Bản gốc đã chuẩn hóa, dùng nội bộ |
| `photos/<id>/v<n>/<width>.webp` | Variant được phục vụ qua `GET /media/<key>` khi DB cho phép |
| `tmp/<uploadId>-<index>` | File tạm trong lúc upload |
| `cleanup-queue/` | Bản ghi JSON chứa storage key cần xóa lại |

DB giữ storage key tương đối. Khi xóa ảnh, trạng thái chuyển sang `DELETING` để ẩn ảnh khỏi gallery, trang chi tiết và media. Sau khi xóa hết file, ứng dụng đánh dấu `Photo.status = PURGED` và đặt `purgedAt` cho ảnh và các phiên bản. Các bản ghi metadata được giữ lại để đối chiếu storage key.

Cleanup chạy khi server khởi động và theo lịch, mặc định mỗi 15 phút. Có thể chạy ngay bằng `npm run cleanup`. Cleanup thử lại các bản ghi trong hàng đợi và các ảnh đang `DELETING`. File tạm, bản ghi `.tmp` đang ghi dở và file mồ côi được xét dọn khi cũ hơn một giờ.

Các bộ đếm cleanup cho object ghi số key đã xử lý thành công, kể cả key đã vắng mặt khi lệnh xóa chạy. `npm run evidence:db` liệt kê driver, key, kích thước và thời điểm sửa cuối của các object.

Version cũ tiếp tục phục vụ trong `VERSION_RETENTION_HOURS`, mặc định 24 giờ tính từ `supersededAt`. Khi hết hạn, cleanup xóa các file variant và đặt `purgedAt`. Nếu xóa gặp lỗi, cleanup thử lại ở lượt sau. Version hiện tại và PNG gốc được giữ lại.

Media dùng `Cache-Control: public, max-age=31536000, immutable`. Sau khi xóa, request mới đến server trả `404`. Bản đã nằm trong cache trình duyệt có thể vẫn hiển thị cho tới khi cache hết hạn hoặc bị xóa. Khi nghiệm thu, dùng GET mới bằng curl hoặc tắt cache trong DevTools.

## Fixture

Chạy `npm run fixtures` để sinh lại các file trong `test/fixtures/`. Tọa độ EXIF là dữ liệu giả dùng cho bài kiểm thử.

| Fixture | Dữ liệu |
|---|---|
| `photo.jpg` | JPEG 2000 × 1333, gradient và chữ |
| `photo.png` | PNG 800 × 600 |
| `small.png` | PNG 200 × 150, một variant 200w |
| `exif-rotated.jpg` | JPEG 1200 × 800 có mũi tên trái, Orientation 6 và GPS giả 10°46′N, 106°42′E. Sau chuẩn hóa, ảnh là 800 × 1200 và mũi tên hướng lên |
| `fake.jpg` | Văn bản mang đuôi JPG |
| `truncated.jpg` | JPEG bị cắt bỏ 30% cuối |
| `exactly-10mib.png` | PNG hợp lệ, đúng 10.485.760 byte |
| `over-10mib.png` | PNG hợp lệ, đúng 10.485.761 byte |
| `max-pixels.png` | PNG 8000 × 5000, đúng 40 triệu pixel |
| `too-many-pixels.png` | PNG 8000 × 5001, vượt 40 triệu pixel |
| `too-tall.png` | PNG 400 × 20000, có variant vượt chiều cao WebP |
| `corners.png` | PNG 400 × 300 có bốn góc đỏ, xanh lá, xanh dương và vàng, dùng cho bonus |

Hai PNG biên dung lượng được tạo từ ảnh RGB nhiễu, thêm chunk `tEXt` có CRC32 hợp lệ trước `IEND` và kiểm tra giải mã lại bằng Sharp.

## Lấy bằng chứng

Dùng cùng một `photoId` cho mục 01–04 và lưu kết quả theo checklist. Che thông tin xác thực nếu xuất hiện trong ảnh chụp hoặc log. [Checklist bằng chứng](evidence/README.md)

```sh
npm run evidence:db
npm run evidence:db -- --photo "<id>"
npm run evidence:exif -- test/fixtures/exif-rotated.jpg
npm run evidence:exif -- "<UPLOAD_ROOT>/photos/<id>/v1/320.webp"
```

Dùng storage key thực tế từ `evidence:db` để chọn WebP của fixture EXIF đã upload. Output trước upload cho thấy Orientation và GPS. Output WebP sau xử lý ghi `null` cho hai giá trị này khi không còn EXIF.

Để lấy header GET trên Windows và lưu vào bằng chứng, thay ví dụ bằng URL variant thực tế.

```powershell
curl.exe -s -D - -o NUL "http://localhost:3000/media/photos/<id>/v1/960.webp"
```

Để lấy bằng chứng restart, lưu `photoId` và URL media, dừng hẳn server rồi chạy lại với cùng DB và `UPLOAD_ROOT`. Mở lại gallery và gửi GET đến cùng URL media để ghi nhận `200` sau restart.

### Bằng chứng 08 và 09 về kiểm tra request

Chạy `npm run fixtures` và khởi động server với `FAULT_INJECT` để trống. Dùng cùng cấu hình DB cho server và terminal chạy lệnh sau.

```sh
npm run evidence:requests -- --base http://localhost:3000
```

- `08a-invalid-files.json` và `08b-invalid-files.json` chứa JSON của hai request trộn file. Mỗi request lưu một ảnh hợp lệ. Dùng `photo.id` trong mỗi JSON để lấy metadata và file tương ứng bằng `npm run evidence:db -- --photo "<id>"`.
- `09-request-limits.txt` ghi HTTP status, response body và số `Photo` trước và sau từng request giới hạn. Request sáu file hợp lệ phải trả `400 TOO_MANY_FILES`. Request chunked gửi một phần file với dữ liệu sinh theo stream vượt 55 MiB và phải trả `413 REQUEST_TOO_LARGE`. Lệnh dùng các fixture có sẵn và sinh phần body lớn trong bộ nhớ theo từng chunk.

### Bằng chứng 10 về lỗi DB sau khi ghi file

1. Trong `.env.test`, đặt `FAULT_INJECT=db-after-write` và kiểm tra DB cùng kho test đã tách riêng. Chọn `PORT` khác trong file này nếu đồng thời chạy server dev. Ở chế độ test, ứng dụng lấy `FAULT_INJECT` từ `.env.test`.
2. Bật chế độ test trước khi chạy server. Upload một JPEG hoặc PNG hợp lệ có alt. Response HTTP `200` có kết quả file `ok: false` với mã `STORAGE_ERROR`.

   ```powershell
   $env:NODE_ENV = 'test'
   npm run dev
   ```

3. Trong terminal thứ hai, chạy ở chế độ test để ghi lại DB và danh sách file thật sau lỗi, thực thi cleanup rồi liệt kê lại. Khi rollback xóa file thành công, số bản ghi ảnh và tập file ảnh giữ như trước lần upload lỗi.

   ```powershell
   $env:NODE_ENV = 'test'
   npm run evidence:db | Tee-Object -FilePath evidence/10-db-fault.txt
   npm run cleanup | Tee-Object -FilePath evidence/10-db-fault.txt -Append
   npm run evidence:db | Tee-Object -FilePath evidence/10-db-fault.txt -Append
   ```

4. Giữ response và đoạn log gây lỗi cùng bằng chứng. Dừng server test, để trống `FAULT_INJECT` trong `.env.test` và thoát terminal test khi xong. Các ca `npm test` chỉ kích hoạt fault injection khi truyền option vào `prepareTest`.

## Ngoài phạm vi

Dự án dùng kho file cục bộ. Đăng nhập, phân quyền, CSRF, object storage như SeaweedFS/MinIO và CDN nằm ngoài phạm vi bài. Người truy cập có thể upload và xóa ảnh qua giao diện. Chỉnh sửa ảnh là phần bonus.

[Thiết kế và tiêu chí kiểm thử](SPEC.md) · [Yêu cầu bài tập](REQUIREMENTS.md)

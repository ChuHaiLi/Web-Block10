# Photo Gallery

Ứng dụng upload ảnh JPEG/PNG, tạo biến thể WebP và hiển thị gallery responsive. Express và EJS render trang, PostgreSQL lưu metadata qua Prisma, còn file ảnh được lưu trong kho ảnh đã cấu hình.

## Cài đặt và chạy

Cần PostgreSQL đang chạy, Node.js 20.6 trở lên và Docker Compose để dùng driver S3. Chạy các lệnh từ thư mục gốc dự án.

```sh
npm i
```

Tạo `.env` và `.env.test` từ `.env.example` khi chưa có hai file cục bộ. Điền `DATABASE_URL` cho từng DB. Tên DB test phải chứa `test`, ví dụ `photo_gallery_test`. Đặt `UPLOAD_ROOT` riêng cho test, mặc định là `../gallery-uploads-test`. Dev mặc định dùng `../gallery-uploads`. Đường dẫn tương đối được tính từ thư mục gốc dự án.

Đặt `SESSION_SECRET` riêng cho từng file môi trường. Có thể tạo giá trị bằng `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Các web server cùng môi trường cần dùng chung secret để đọc cùng cookie. Đặt `COOKIE_SECURE=false` khi chạy HTTP cục bộ và `true` khi chạy HTTPS.

**Nâng cấp DB dev từ trước T15** cần chạy `npx prisma migrate reset` vì migration mới yêu cầu mọi ảnh có chủ sở hữu. Lệnh này xóa toàn bộ dữ liệu trong DB dev. Hãy kiểm tra `DATABASE_URL` và sao lưu dữ liệu cần giữ trước khi chạy.

**Thêm `STORAGE_DRIVER=s3` và đủ các biến `S3_*` từ `.env.example` vào cả `.env` lẫn `.env.test`, kể cả khi hai file đã có sẵn.** Tạo `seaweedfs/s3.json` từ `seaweedfs/s3.example.json`, rồi điền `S3_ACCESS_KEY_ID` và `S3_SECRET_ACCESS_KEY` khớp với file JSON vào cả hai file môi trường. Dùng `S3_BUCKET=photo-gallery` trong `.env` và `S3_BUCKET=photo-gallery-test` trong `.env.test`.

Docker Compose ghim SeaweedFS **4.55**, với S3 API ở `http://localhost:8333` và giao diện filer ở `http://localhost:8888`. [Cờ khởi động SeaweedFS 4.55](https://github.com/seaweedfs/seaweedfs/blob/4.55/weed/command/server.go) · [Định dạng cấu hình S3](https://github.com/seaweedfs/seaweedfs/blob/4.55/weed/command/s3.go)

```sh
npm run storage:up
npm run fixtures
npx prisma migrate dev
node --env-file=.env.test ./node_modules/prisma/build/index.js migrate deploy
npm run dev
```

Mở `http://localhost:3000` để xem gallery hoặc `/upload` để tải ảnh lên. Các lệnh migration ở trên đọc URL từ file môi trường tương ứng khi terminal chưa đặt `DATABASE_URL`. DB dev và DB test dùng cùng bộ migration.

Khách có thể xem gallery, trang chi tiết và ảnh. Đăng ký ở `/register` hoặc đăng nhập trước khi upload. Mở **Ảnh của tôi** để xem ảnh đang công bố của tài khoản. Chỉ người đăng ảnh mới có thể chỉnh sửa và xóa ảnh đó.

Sau 5 lần nhập sai mật khẩu, tài khoản bị khóa 15 phút, kể cả khi nhập đúng trong thời gian này. Nhập sai mật khẩu hiện tại khi đổi mật khẩu cũng được tính. Người khác có thể cố tình nhập sai để khóa tạm tài khoản của bạn. Khi đổi mật khẩu thành công, thiết bị đang dùng vẫn đăng nhập và các phiên khác của cùng tài khoản bị đăng xuất.

```sh
npm test
```

Test chạy tuần tự, reset DB test và dùng kho nháp riêng cho từng ca. Với S3, `npm test` ghi, đọc và dọn một object trong bucket làm nóng trước khi chạy suite. Mỗi ca sau đó dùng bucket riêng có hậu tố ngẫu nhiên rồi dọn object và xóa bucket. Test restart tạo app mới với cùng DB và bucket, dùng kho nháp mới để kiểm tra gallery và GET media.

Dùng `npm run storage:down` để dừng SeaweedFS. Volume `seaweedfs-data` giữ object giữa các lần chạy. Có thể chọn `STORAGE_DRIVER=local` trong cấu hình dev hoặc test khi cần chạy bằng đĩa cục bộ.

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

`ObjectStore` lưu ảnh công bố và PNG gốc trong bucket với driver `s3`, hoặc trên đĩa trong `UPLOAD_ROOT` với driver `local`. File tạm và hàng đợi dọn luôn dùng kho nháp trên đĩa của từng server. Trình duyệt lấy ảnh qua web server để mỗi request media vẫn kiểm tra trạng thái ảnh và phiên bản trong DB.

| Prefix hoặc key | Nội dung |
|---|---|
| `originals/<id>.png` | Object PNG gốc đã chuẩn hóa, dùng nội bộ |
| `photos/<id>/v<n>/<width>.webp` | Object WebP được phục vụ qua `GET /media/<key>` khi DB cho phép |
| `tmp/<uploadId>-<index>` | File tạm trong `UPLOAD_ROOT` lúc upload |
| `cleanup-queue/` | Bản ghi JSON trong `UPLOAD_ROOT` chứa storage key cần xóa lại |

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

Đăng ký và đăng nhập trước khi lấy bằng chứng có thao tác upload, sửa hoặc xóa. Dùng cùng một `photoId` cho mục 01–04 và lưu kết quả theo checklist. Che thông tin xác thực nếu xuất hiện trong ảnh chụp hoặc log, gồm cả giá trị cookie `gallery.sid`. [Checklist bằng chứng](evidence/README.md)

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

### Bằng chứng 08, 09 và 17 về kiểm tra request

Chạy `npm run fixtures` và khởi động server với `FAULT_INJECT` để trống. Dùng cùng cấu hình DB cho server và terminal chạy lệnh sau. Script tự đăng ký hai tài khoản `evidence-<ngẫu nhiên>` và gửi `Origin` cho các request thay đổi dữ liệu.

```sh
npm run evidence:requests -- --base http://localhost:3000
```

- `08a-invalid-files.json` và `08b-invalid-files.json` chứa JSON của hai request trộn file. Mỗi request lưu một ảnh hợp lệ. Dùng `photo.id` trong mỗi JSON để lấy metadata và file tương ứng bằng `npm run evidence:db -- --photo "<id>"`.
- `09-request-limits.txt` ghi HTTP status, response body và số `Photo` trước và sau từng request giới hạn. Request sáu file hợp lệ phải trả `400 TOO_MANY_FILES`. Request chunked gửi một phần file với dữ liệu sinh theo stream vượt 55 MiB và phải trả `413 REQUEST_TOO_LARGE`. Lệnh dùng các fixture có sẵn và sinh phần body lớn trong bộ nhớ theo từng chunk.
- `17-auth-access.txt` ghi khách upload nhận 401, mở trang Upload nhận 303, người khác xóa ảnh nhận 403, khách xem gallery và media nhận 200.

### Bằng chứng 10 về lỗi DB sau khi ghi file

1. Trong `.env.test`, đặt `FAULT_INJECT=db-after-write` và kiểm tra DB cùng kho test đã tách riêng. Chọn `PORT` khác trong file này nếu đồng thời chạy server dev. Ở chế độ test, ứng dụng lấy `FAULT_INJECT` từ `.env.test`.
2. Bật chế độ test trước khi chạy server. Đăng ký hoặc đăng nhập trên server test, rồi upload một JPEG hoặc PNG hợp lệ có alt. Response HTTP `200` có kết quả file `ok: false` với mã `STORAGE_ERROR`.

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

Quên mật khẩu, xác minh email, đăng nhập bên thứ ba, 2FA, vai trò admin, xóa tài khoản và CDN nằm ngoài phạm vi bài. Chỉnh sửa ảnh là phần bonus.

[Thiết kế và tiêu chí kiểm thử](SPEC.md) · [Yêu cầu bài tập](REQUIREMENTS.md)

# Checklist bằng chứng

Mọi bằng chứng phải lấy từ **cùng một lần chạy** (cùng DB, cùng bucket, không reset giữa chừng) và các mục 01–04 phải dùng **cùng một `photoId`** để nối response upload, dòng trong DB, object trong bucket và GET media. Che mọi thông tin xác thực trước khi nộp: giá trị cookie `gallery.sid`, mật khẩu DB trong `DATABASE_URL`, `S3_ACCESS_KEY_ID` và `S3_SECRET_ACCESS_KEY`. Không chụp hay chép `.env`, `.env.test` và `seaweedfs/s3.json`. [Quy định bằng chứng](../SPEC.md)

| Ô ghi nhận | Giá trị |
|---|---|
| **photoId cho mục 01–04** (ảnh `exif-rotated.jpg`) | ____________________ |
| photoId của `photo.jpg` (mục 06, 07 và 19) | ____________________ |
| Ngày giờ bắt đầu lần chạy | ____________________ |

## Chuẩn bị chung

- Khởi động theo [README](../README.md): `npm run storage:up`, `npm run fixtures`, rồi `npm run dev` ở cổng 3000. Đăng ký và đăng nhập trước khi upload.
- Upload **một request hai file**: `test/fixtures/exif-rotated.jpg` (ảnh dùng cho mục 01–05) và `test/fixtures/photo.jpg` (có đủ 320/960/1600, dùng cho mục 06–07 và 19). Điền alt cho cả hai.
- Lưu output lệnh bằng UTF-8 để giữ tiếng Việt và khung bảng. Chạy một lần trong mỗi cửa sổ PowerShell:

  ```powershell
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  ```

  Chạy các lệnh `npm run` với cờ `-s` (như trong danh sách dưới) để npm không chèn dòng tiêu đề `> block10-photo-gallery…` vào file. Rồi dùng dạng `<lệnh> | Out-File -Encoding utf8 evidence/<tên-file>`. Muốn vừa xem vừa lưu thì thay bằng `Tee-Object -FilePath evidence/<tên-file>`.
- Lệnh `curl.exe` lấy header của request **GET**, không dùng `curl -I` vì lệnh đó gửi `HEAD`.
- Khi xem lại ảnh sau khi xóa hay restart, bật **Disable cache** trong DevTools hoặc dùng `curl.exe`, vì media có `Cache-Control: immutable` nên trình duyệt có thể hiện bản trong cache.

## Danh sách

- [ ] **01** `01-network-upload.png`. Upload lúc đã đăng nhập, ở trang `/upload`. DevTools, tab Network: chọn request `POST /api/uploads`. Chụp phần Headers có `Content-Type: multipart/form-data; boundary=…` và `Cookie: gallery.sid=…` (**che giá trị**), phần Payload, và response từng file. Có thể chụp ba ảnh `01a`, `01b`, `01c` nếu không vừa một khung.
- [ ] **02** `02-upload-response.json`. Tab Response của đúng request ở mục 01, chọn Copy response rồi dán vào file. Ghi `photo.id` của `exif-rotated.jpg` vào ô photoId ở đầu file này.
- [ ] **03** `03-db.txt`. Output bắt đầu bằng `Object store { driver: 's3', endpoint, bucket }`, sau đó là bảng `Photo`, `PhotoVariant` (storage key) và **danh sách object trong bucket** (key, size, lastModified).

  ```powershell
  npm run -s evidence:db | Out-File -Encoding utf8 evidence/03-db.txt
  ```

  Chạy một lần không tham số (toàn bộ) là đủ. Có thể thêm lần chạy `npm run -s evidence:db -- --photo "<photoId>"` để chỉ hiện ảnh của mục 01–04.
- [ ] **04** `04-media-get.png` và `04-media-get.txt`. Mở gallery, tab Network, chọn một request `/media/photos/<photoId>/v1/<w>.webp` của đúng `photoId` ở mục 01 và chụp Headers: status `200`, `Content-Type: image/webp`, `Cache-Control: public, max-age=31536000, immutable`. Bản text:

  ```powershell
  curl.exe -s -D - -o NUL "http://localhost:3000/media/photos/<photoId>/v1/320.webp" | Out-File -Encoding utf8 evidence/04-media-get.txt
  ```
- [ ] **05** `05-exif-before.txt` và `05-exif-after.txt`. `before` là fixture gốc (có GPS và Orientation). `after` là variant đã lưu của **cùng ảnh ở mục 01** (không còn EXIF). Variant nằm trong bucket nên tải về qua web server trước:

  ```powershell
  npm run -s evidence:exif -- test/fixtures/exif-rotated.jpg | Out-File -Encoding utf8 evidence/05-exif-before.txt
  curl.exe -s -o "$env:TEMP\variant.webp" "http://localhost:3000/media/photos/<photoId>/v1/320.webp"
  npm run -s evidence:exif -- "$env:TEMP\variant.webp" | Out-File -Encoding utf8 evidence/05-exif-after.txt
  ```

  Trong `after`, `Orientation` và `GPS` phải là `null`.
- [ ] **06** `06-currentsrc-300.png`, `06-currentsrc-1400.png`, `06-currentsrc-1400-dpr2.png` (đặt tên theo cấu hình). Dùng ảnh `photo.jpg` ở mục "Chuẩn bị chung". Mở DevTools, tab Network, tick **Disable cache** và giữ DevTools mở suốt lúc đo. Bật Device Toolbar (Ctrl+Shift+M) để đặt độ rộng viewport và DPR. **Đo từ viewport nhỏ đến lớn** (300 → 1400 DPR 1 → 1400 DPR 2) và **tải lại trang (Ctrl+R) sau mỗi lần đổi cấu hình**, vì trình duyệt có thể dùng lại bản lớn hơn đã tải. Chạy trong Console rồi chụp cả kết quả lẫn dòng Network của ảnh:

  ```js
  const img = document.querySelector('img[srcset*="1600w"]');
  ({ viewport: innerWidth, devicePixelRatio, boxWidth: Math.round(img.getBoundingClientRect().width), currentSrc: img.currentSrc })
  ```

  | Cấu hình | Trang | Ô ảnh (CSS px) | `currentSrc` kỳ vọng |
  |---|---|---|---|
  | Viewport 300 px, DPR 1 | Gallery `/` | `boxWidth` ≈ 268 (lề 16 px mỗi bên; `sizes` dùng `100vw` = 300) | `…/320.webp` (`320w`) |
  | Viewport 1400 px, DPR 1 | Gallery `/` | ≈ 410 | `…/960.webp` (`960w`) |
  | Viewport 1400 px, **DPR 2** | Trang chi tiết `/photos/<id>` | ≈ 916 (cần ≈ 1832 điểm ảnh) | `…/1600.webp` (`1600w`) |

  Ảnh chụp phải hiện rõ `currentSrc`, `devicePixelRatio`, độ rộng viewport và dòng Network tương ứng. Không yêu cầu mọi độ rộng cho URL khác nhau (ví dụ DPR 1 ở 375, 400 và 410 px đều chọn `960w`).
- [ ] **07** `07-dom.png`. Tab Elements: chọn `<img class="photo-image">` của `photo.jpg` và chụp đủ `srcset`, `sizes`, `width`, `height`, `loading`, `alt`. Chụp **cả gallery và trang chi tiết**. `sizes` phải đúng chuỗi:
  - Gallery: `(max-width: 599px) 100vw, (max-width: 999px) 50vw, (max-width: 1279px) 33vw, 410px`, `loading="lazy"`.
  - Chi tiết: `(max-width: 999px) 100vw, (max-width: 1279px) calc(100vw - 412px), 916px`, `loading="eager"`.
- [ ] **08** `08a-invalid-files.json` và `08b-invalid-files.json`. Server đang chạy ở cổng 3000, `FAULT_INJECT` để trống. Lệnh sau tự đăng ký tài khoản `evidence-<ngẫu nhiên>`, gửi hai request rồi ghi file vào `evidence/` (thêm `--out <thư mục>` nếu muốn ghi chỗ khác):

  ```powershell
  npm run fixtures
  npm run -s evidence:requests -- --base http://localhost:3000
  ```

  Request A: `photo.jpg`, `fake.jpg`, `truncated.jpg`. Request B: `photo.png`, `over-10mib.png`, `too-many-pixels.png`, `small.png` thiếu alt. Mỗi JSON có kết quả riêng từng file. Kèm output `evidence:db` cho ảnh thành công của mỗi request (lấy `photo.id` trong JSON), chứng minh chỉ ảnh hợp lệ có bản ghi và object:

  ```powershell
  npm run -s evidence:db -- --photo "<id trong 08a>" | Out-File -Encoding utf8 evidence/08a-db.txt
  npm run -s evidence:db -- --photo "<id trong 08b>" | Out-File -Encoding utf8 evidence/08b-db.txt
  ```
- [ ] **09** `09-request-limits.txt`. Do cùng lệnh ở mục 08 sinh ra: sáu file hợp lệ → `400 TOO_MANY_FILES`, request chunked vượt 55 MiB → `413 REQUEST_TOO_LARGE`, kèm số `Photo` trước và sau mỗi request (phải bằng nhau).
- [ ] **10** `10-db-fault.txt`. Dùng bucket test, **không** dùng bucket dev. Trong `.env.test` đặt `FAULT_INJECT=db-after-write`. Ở chế độ test, ứng dụng chỉ đọc `.env.test`, nên chọn `PORT` khác cổng của server dev trong file này nếu đang chạy cả hai.

  1. Terminal 1: `$env:NODE_ENV = 'test'; npm run dev`. Đăng ký hoặc đăng nhập ở cổng test, upload một ảnh hợp lệ có alt. Response HTTP `200` có file `ok: false`, mã `STORAGE_ERROR`. Giữ response và đoạn log lỗi của server.
  2. Terminal 2: liệt kê **object trong bucket test**, chạy cleanup, rồi liệt kê lại. Kho nháp `tmp/` cũng phải rỗng:

     ```powershell
     $env:NODE_ENV = 'test'
     npm run -s evidence:db | Out-File -Encoding utf8 evidence/10-db-fault.txt
     npm run -s cleanup | Out-File -Encoding utf8 -Append evidence/10-db-fault.txt
     npm run -s evidence:db | Out-File -Encoding utf8 -Append evidence/10-db-fault.txt
     Get-ChildItem ..\gallery-uploads-test\tmp | Out-File -Encoding utf8 -Append evidence/10-db-fault.txt
     ```

     Dòng `Object store` của mỗi lần `evidence:db` phải ghi `bucket: 'photo-gallery-test'`. Số `Photo` và tập object không tăng sau lần upload lỗi. Đổi đường dẫn `..\gallery-uploads-test` nếu `UPLOAD_ROOT` trong `.env.test` khác.
  3. Dừng server test, **xóa giá trị `FAULT_INJECT` trong `.env.test`**, đóng terminal test.
- [ ] **11** `11-restart.png` và `11-restart.txt`. Giữ nguyên DB và bucket. Ghi `photoId` và URL media, rồi lần lượt:

  1. `curl.exe -s -D - -o NUL "<url media>"` → `200` (trước restart).
  2. Dừng hẳn web server (Ctrl+C), chạy lại `npm run dev`. Mở lại gallery (chụp `11-restart.png`) và gửi lại cùng lệnh curl → `200`.
  3. `docker compose restart seaweedfs`, đợi vài giây, gửi lại cùng lệnh curl → `200` (volume `seaweedfs-data` giữ object). Nếu vừa restart mà trả `502`, đợi SeaweedFS khởi động xong rồi gửi lại.

  Ghi từng bước kèm giờ vào `11-restart.txt`, ví dụ:

  ```powershell
  $url = "http://localhost:3000/media/photos/<photoId>/v1/320.webp"
  "== $(Get-Date -Format s) sau restart web server" | Out-File -Encoding utf8 -Append evidence/11-restart.txt
  curl.exe -s -D - -o NUL $url | Out-File -Encoding utf8 -Append evidence/11-restart.txt
  ```
- [ ] **12** `12-delete.txt`. Dùng một ảnh thử (không phải ảnh của mục 01–04 nếu còn cần chụp lại). Đăng nhập bằng chủ ảnh.

  ```powershell
  $id = "<photoId>"
  "== TRƯỚC KHI XÓA" | Out-File -Encoding utf8 evidence/12-delete.txt
  npm run -s evidence:db -- --photo $id | Out-File -Encoding utf8 -Append evidence/12-delete.txt
  curl.exe -s -D - -o NUL "http://localhost:3000/media/photos/$id/v1/320.webp" | Out-File -Encoding utf8 -Append evidence/12-delete.txt
  # Bấm nút "Xóa" ở trang chi tiết (đăng nhập bằng chủ ảnh) rồi xác nhận
  "== SAU KHI XÓA" | Out-File -Encoding utf8 -Append evidence/12-delete.txt
  npm run -s evidence:db -- --photo $id | Out-File -Encoding utf8 -Append evidence/12-delete.txt
  curl.exe -s -D - -o NUL "http://localhost:3000/media/photos/$id/v1/320.webp" | Out-File -Encoding utf8 -Append evidence/12-delete.txt
  ```

  Trước: status `PUBLISHED`, `200`, có object. Sau: status `PURGED` (nếu còn `DELETING`, chạy `npm run -s cleanup` rồi lấy lại), `404`, không còn object nào dưới `photos/<id>/` và không còn `originals/<id>.png` (output ghi `(trống)`).
- [ ] **13** `13-env-example.txt`. Nội dung `.env.example` và `seaweedfs/s3.example.json` (cả hai chỉ có giá trị giả). **Không** đưa `.env`, `.env.test`, `seaweedfs/s3.json` vào.

  ```powershell
  '.env.example', 'seaweedfs/s3.example.json' | ForEach-Object { "=== $_"; Get-Content $_ } | Out-File -Encoding utf8 evidence/13-env-example.txt
  ```
- [ ] **14** `14-bonus-*` nếu làm bonus. Ghi bằng chứng trước và sau chỉnh sửa, URL đổi từ `v1` sang `v2` và response `409` khi lưu đồng thời. Với cleanup, ghi `purgedAt` của version quá hạn, số `supersededVersionFilesRemoved` từ `npm run -s cleanup` (là số key đã xử lý) và kết quả GET mới của version đã dọn (`404`) và version hiện tại (`200`).
- [ ] **15** `15-bucket-objects.txt` và `15-seaweedfs-filer.png`. Dùng bucket **dev** (`photo-gallery`): chạy **không** đặt `NODE_ENV=test` (kiểm tra bằng `echo $env:NODE_ENV` rỗng) và dòng `Object store` của output phải ghi `bucket: 'photo-gallery'`.

  ```powershell
  npm run -s evidence:db | Out-File -Encoding utf8 evidence/15-bucket-objects.txt
  ```

  Ảnh chụp filer UI: mở `http://localhost:8888/buckets/photo-gallery/photos/<photoId>/v1/` (và nếu muốn `http://localhost:8888/buckets/photo-gallery/originals/`). Chụp thấy rõ tên bucket trong URL và các object `320.webp`, `800.webp` (ảnh `exif-rotated.jpg` sau khi xoay chỉ rộng 800 px nên không có `960.webp`). Dùng `photoId` của mục 01–04 để khớp với `03-db.txt`.
- [ ] **16** `16-two-servers.png` và `16-two-servers.txt`. Hai web server cùng DB và cùng bucket, **kho nháp riêng** (SPEC §15.9). Mỗi server một cửa sổ PowerShell riêng, vì `$env:` có hiệu lực cho cả cửa sổ:

  ```powershell
  # Cửa sổ A
  $env:PORT = 3000; $env:UPLOAD_ROOT = '../gallery-uploads-a'; npm start
  ```

  ```powershell
  # Cửa sổ B
  $env:PORT = 3001; $env:UPLOAD_ROOT = '../gallery-uploads-b'; npm start
  ```

  Ba ý cần chứng minh. Chụp `16-two-servers.png` gồm hai cửa sổ trình duyệt cạnh nhau (thấy cổng trên thanh địa chỉ) và ghi các lệnh kèm kết quả vào `16-two-servers.txt`:

  1. **Upload ở 3000, thấy ở 3001.** Đăng nhập và upload ảnh tại `http://localhost:3000/upload`. Mở `http://localhost:3001/` và trang chi tiết của ảnh đó: ảnh hiện. Ghi hai lệnh, đều `200`:

     ```powershell
     curl.exe -s -D - -o NUL "http://localhost:3000/media/photos/<id>/v1/320.webp"
     curl.exe -s -D - -o NUL "http://localhost:3001/media/photos/<id>/v1/320.webp"
     ```
  2. **Đăng nhập ở 3000, 3001 vẫn đăng nhập.** Cookie `gallery.sid` không phân biệt cổng và hai server cùng `SESSION_SECRET` và cùng bảng session trong DB. Sau khi đăng nhập ở 3000, tải `http://localhost:3001/`: header hiện tên người dùng và có link Upload, không phải nút Đăng nhập.
  3. **Xóa ở 3001, 3000 trả 404.** Xóa ảnh trên server 3001 (nút Xóa ở trang chi tiết), rồi:

     ```powershell
     curl.exe -s -D - -o NUL "http://localhost:3000/media/photos/<id>/v1/320.webp"
     ```

     Kết quả phải là `404`.

  Dùng ảnh thử riêng cho phần 3, vì ảnh bị xóa. Hai thư mục `../gallery-uploads-a` và `-b` chỉ chứa `tmp/` và `cleanup-queue/` của từng server (không có `photos/`). Có thể ghi `Get-ChildItem ..\gallery-uploads-a, ..\gallery-uploads-b` vào file để chứng minh. Dừng cả hai server khi xong.
- [ ] **17** `17-auth-access.txt`. Do `npm run -s evidence:requests -- --base http://localhost:3000` sinh ra cùng lúc với mục 08 và 09 (tự đăng ký hai tài khoản tạm). Nội dung: khách `POST /api/uploads` → 401 `UNAUTHENTICATED`, khách mở `/upload` → 303 về `/login?next=/upload`, người khác `POST …/delete` → 403, khách vẫn mở gallery và GET media → 200.
- [ ] **18** `18-auth-ui.png`. Chụp (có thể ghép nhiều ảnh, có thể chụp ở 375 px và 1280 px):
  1. Gallery **khi chưa đăng nhập**: header chỉ có Gallery, nút "Đăng nhập" (viền) và "Đăng ký" (nền xanh chanh), không có Upload hay Ảnh của tôi.
  2. Trang chi tiết **khi là chủ ảnh**: sidebar có nút "Chỉnh sửa" và "Xóa".
  3. Trang chi tiết **khi là người khác** (đăng nhập tài khoản khác): không có hai nút đó.
  4. Trang đăng nhập sau **5 lần nhập sai mật khẩu**: thông báo khóa tạm (khoảng 15 phút) màu đỏ nhạt trong thẻ đăng nhập. Dùng tài khoản thử, không dùng tài khoản đang cần.
- [ ] **19** `19-download.png` và `19-download.txt`. Mở trang chi tiết của `photo.jpg` **khi chưa đăng nhập** (cửa sổ ẩn danh). Chụp nút xanh chanh "⬇ Tải bản gốc (2000×1333)" ở sidebar và panel "Kích thước khác" dưới ảnh (tab Desktop, ô `1920×1080` kèm nhãn "Full HD"). `19-download.txt` gồm header hai request GET, output EXIF của hai file tải về và danh sách object `dl/`:

  ```powershell
  $id = "<photoId của photo.jpg>"
  $base = "http://localhost:3000/photos/$id/v/1/download"
  "== original" | Out-File -Encoding utf8 evidence/19-download.txt
  curl.exe -s -D - -o "$env:TEMP\original.jpg" "$base/original" | Out-File -Encoding utf8 -Append evidence/19-download.txt
  "== 1920x1080" | Out-File -Encoding utf8 -Append evidence/19-download.txt
  curl.exe -s -D - -o "$env:TEMP\1920x1080.jpg" "$base/1920x1080" | Out-File -Encoding utf8 -Append evidence/19-download.txt
  "== evidence:exif original" | Out-File -Encoding utf8 -Append evidence/19-download.txt
  npm run -s evidence:exif -- "$env:TEMP\original.jpg" | Out-File -Encoding utf8 -Append evidence/19-download.txt
  "== evidence:exif 1920x1080" | Out-File -Encoding utf8 -Append evidence/19-download.txt
  npm run -s evidence:exif -- "$env:TEMP\1920x1080.jpg" | Out-File -Encoding utf8 -Append evidence/19-download.txt
  "== object dl/ trong bucket" | Out-File -Encoding utf8 -Append evidence/19-download.txt
  npm run -s evidence:db -- --photo $id | Select-String "Object store|bucket|/dl/" | Out-File -Encoding utf8 -Append evidence/19-download.txt
  ```

  Kỳ vọng: `Content-Type: image/jpeg`, `Content-Disposition` có `filename` và `filename*`, file `1920x1080` đúng 1920×1080 (`width`, `height` trong output EXIF), `Orientation` và `GPS` đều `null`, và có hai object `photos/<id>/v1/dl/original.jpg`, `photos/<id>/v1/dl/1920x1080.jpg`.

## Trước khi nộp

- Mở lại từng file `.txt`, `.json` và ảnh chụp để chắc đã che: cookie `gallery.sid`, mật khẩu trong `DATABASE_URL`, access key và secret key S3.
- Thư mục này chỉ chứa các file của danh sách trên. Ảnh chụp dùng để so sánh trước/sau giao diện (nếu có) lưu ngoài `evidence/`.

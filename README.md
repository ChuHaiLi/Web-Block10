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

Xem thêm [Chạy nhiều web server](#chạy-nhiều-web-server) và [Dùng Cloudflare R2 thay SeaweedFS](#dùng-cloudflare-r2-thay-seaweedfs-tùy-chọn).

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

## Kho ảnh

Ảnh nằm trong **object storage dùng chung** thay vì ổ đĩa của một web server, để nhiều web server cùng đọc và ghi một nơi. Có hai loại kho:

| Kho | Prefix | Nơi lưu | Lý do |
|---|---|---|---|
| **Object store** (dùng chung) | `photos/`, `originals/` | Bucket S3 với driver `s3` (SeaweedFS hoặc R2), hoặc `UPLOAD_ROOT` với driver `local` | Ảnh đã công bố và PNG gốc phải đọc được từ mọi web server |
| **Kho nháp** (riêng từng server) | `tmp/`, `cleanup-queue/` | Luôn là đĩa cục bộ, trong `UPLOAD_ROOT` | File tạm của một request và hàng đợi dọn của một server không cần chia sẻ |

Driver chọn **một lần lúc khởi động** bằng `STORAGE_DRIVER=s3|local`. Bản nộp dùng `s3`. Driver `local` chỉ để chạy nhanh khi không có Docker và để chạy test contract. Server **không bao giờ tự chuyển sang `local` khi S3 lỗi**, vì file sẽ nằm rải ở hai nơi. S3 lỗi thì upload trả `STORAGE_ERROR` và dọn như mọi lỗi lưu trữ khác, còn GET media trả `502` không kèm `Cache-Control`.

| Prefix hoặc key | Nội dung |
|---|---|
| `originals/<id>.png` | Object PNG gốc đã chuẩn hóa, dùng nội bộ |
| `photos/<id>/v<n>/<width>.webp` | Object WebP được phục vụ qua `GET /media/<key>` khi DB cho phép |
| `photos/<id>/v<n>/dl/<kích thước>.jpg` hoặc `.png` | File tải xuống do tính năng [Tải ảnh](#tải-ảnh) tạo và lưu lại. Không có dòng trong DB |
| `tmp/<uploadId>-<index>` | File tạm trong `UPLOAD_ROOT` lúc upload |
| `cleanup-queue/` | Bản ghi JSON trong `UPLOAD_ROOT` chứa storage key cần xóa lại |

**Vì sao ảnh vẫn đi qua web server, không cho trình duyệt tải thẳng từ bucket.** `/media` phải tra DB để trả `404` cho ảnh đã xóa, version chưa commit hoặc object mồ côi, và phải đặt đúng `Cache-Control`. Bucket public hay presigned URL sẽ bỏ qua bước kiểm tra này. Cái giá là web server vẫn phải gửi bytes ảnh. Giảm tải chỗ này là việc của CDN, nằm ngoài phạm vi.

Ảnh 40 triệu pixel có thể chiếm tới khoảng 120 MB RAM khi xử lý, vì PNG gốc được giữ trong bộ nhớ trước khi `put`. Upload xử lý tuần tự từng file nên mỗi request chỉ giữ một ảnh như vậy cùng lúc.

### Xóa và dọn dẹp

DB giữ storage key tương đối. Khi xóa ảnh, trạng thái chuyển sang `DELETING` để ẩn ảnh khỏi gallery, trang chi tiết và media. Sau khi xóa hết object, ứng dụng đánh dấu `Photo.status = PURGED` và đặt `purgedAt` cho ảnh và các phiên bản. Bản ghi metadata được **giữ lại** (đánh dấu `PURGED` thay vì xóa dòng) để còn đối chiếu storage key.

Cleanup chạy khi server khởi động và theo lịch, mặc định mỗi 15 phút. Có thể chạy ngay bằng `npm run cleanup`. Cleanup thử lại các bản ghi trong hàng đợi và các ảnh đang `DELETING`. File tạm, bản ghi `.tmp` đang ghi dở và object mồ côi trong bucket được xét dọn khi cũ hơn một giờ (không có `PhotoVersion` hoặc `Photo` tương ứng).

**Các bộ đếm trong output cleanup** (`deletedPhotoFilesRemoved`, `supersededVersionFilesRemoved`, …) là **số key đã xử lý**, không phải số object thật sự bị xóa. S3 không cho biết object có tồn tại trước lệnh `DeleteObject` hay không, nên key đã vắng mặt vẫn được tính. Muốn biết object còn hay mất, dùng `npm run -s evidence:db`.

**File `dl/` được dọn theo prefix**, không theo danh sách trong DB. Xóa ảnh liệt kê mọi object dưới `photos/<id>/` rồi xóa hết, gồm cả `dl/` của mọi version. Khi version cũ hết hạn, cleanup liệt kê `photos/<id>/v<n>/` và xóa mọi object ở đó, gồm cả `dl/` của version đó. Nếu một lần tải đang render mà ảnh bị xóa, file vừa ghi bị xóa hoặc đưa vào hàng đợi dọn và request trả `404`.

Version cũ tiếp tục phục vụ trong `VERSION_RETENTION_HOURS`, mặc định 24 giờ tính từ `supersededAt`. Khi hết hạn, cleanup xóa các object của version và đặt `purgedAt`. Nếu xóa gặp lỗi, cleanup thử lại ở lượt sau. Version hiện tại và PNG gốc được giữ lại.

Media dùng `Cache-Control: public, max-age=31536000, immutable`. Sau khi xóa, request mới đến server trả `404`. Bản đã nằm trong cache trình duyệt có thể vẫn hiển thị cho tới khi cache hết hạn hoặc bị xóa. Khi nghiệm thu, dùng GET mới bằng curl hoặc tắt cache trong DevTools.

## Tải ảnh

Trang chi tiết có hai cách tải, cả hai dành cho **mọi người**, kể cả khách chưa đăng nhập. Link được dựng từ `currentVersion` nên luôn trỏ đúng bản đang hiển thị (sau khi chỉnh sửa là `v2`, `v3`…).

- **Tải bản gốc.** Nút lớn màu xanh chanh "⬇ Tải bản gốc (W×H)" ở sidebar, trỏ tới `/photos/<id>/v/<version>/download/original`. "Bản gốc" là ảnh của **version hiện tại** (đã xoay, lật, cắt nếu có chỉnh sửa), kích thước đúng bằng `PhotoVersion.width/height`. File là JPEG, hoặc PNG nếu ảnh có kênh alpha, và **không có EXIF hay GPS**. Header `Content-Disposition` có `filename` ASCII và `filename*` UTF-8 để tiêu đề tiếng Việt vẫn đúng.
- **Kích thước khác.** Panel dưới ảnh có ba nhóm theo thiết bị: **Desktop** (HD, Full HD, WUXGA, 2K QHD, WQXGA, Ultrawide, 4K UHD, 5K), **Điện thoại** và **Tablet / iPad**. Mỗi kích thước là một ô ghi `1920×1080` kèm nhãn ngắn nếu có. Chỉ liệt kê kích thước **không lớn hơn** ảnh (không phóng to), nhóm rỗng bị ẩn, và kích thước ngoài danh sách cố định trả `404`. Không có JavaScript thì hiện cả ba nhóm kèm tiêu đề. Có JavaScript thì hiện các tab, chọn được bằng chuột và phím mũi tên.
- **Cắt thông minh.** Khi tỉ lệ khung khác tỉ lệ ảnh, ảnh được phủ kín khung (`fit: cover`, không méo) và phần bị cắt chọn bằng `sharp.strategy.attention`: giữ vùng nhiều chi tiết và tương phản nhất thay vì cắt cứng ở giữa.
- **Tạo khi tải lần đầu và lưu lại.** Không có file tải nào được tạo lúc upload. Lần đầu có người tải một kích thước, server render từ PNG gốc, ghi vào bucket tại `photos/<id>/v<n>/dl/<kích thước>.jpg` rồi trả về. Các lần sau lấy lại object đã lưu, không render lại. Hai request đồng thời cùng một kích thước chỉ render một lần, và tối đa hai render chạy song song để không chiếm hết CPU.

File `dl/` nằm trong bucket nhưng không có dòng trong DB, nên việc dọn dùng prefix (xem [Xóa và dọn dẹp](#xóa-và-dọn-dẹp)).

## Giao diện

Giao diện tối, lấy ảnh làm trung tâm, **tham khảo phong cách** của [4kwallpapers.com](https://4kwallpapers.com/): nền tối, thẻ ảnh bo góc, nút tải màu xanh chanh. Dự án **không sao chép thương hiệu** của trang đó: không dùng logo, tên, hình ảnh, icon hay mã CSS/JS. Wordmark vẫn là "Photo Gallery", icon tự vẽ, không dùng framework CSS hay bước build.

**Font tự host**, phục vụ qua route `/fonts` từ hai gói `@fontsource`, nên trang không gửi request tới Google Fonts hay bên thứ ba nào:

| Dùng cho | Font | Weight | Subset khai báo |
|---|---|---|---|
| Tiêu đề, wordmark, nút | Be Vietnam Pro | 600, 700 | `vietnamese`, `latin-ext`, `latin` |
| Nội dung | Open Sans | 400, 600 | `vietnamese`, `latin-ext`, `latin` |

Ban đầu dự định dùng Outfit giống trang tham khảo, nhưng Outfit chỉ có `latin` và `latin-ext`, thiếu vùng `U+1EA0–1EF9` (ả, ấ, ớ, ự…), nên các chữ đó bị vẽ bằng font dự phòng và tiêu đề tiếng Việt bị trộn hai font. Be Vietnam Pro được thiết kế cho tiếng Việt và có giấy phép OFL.

**Bảng màu** (CSS custom properties trong `:root`, `color-scheme: dark`):

| Biến | Giá trị | Dùng cho |
|---|---|---|
| `--bg` | `#2b2f35` | Nền trang |
| `--surface` | `#353a41` | Thẻ, panel, header |
| `--surface-2` | `#40464e` | Nút phụ, ô nhập, hover |
| `--border` | `#4a515a` | Viền mảnh |
| `--text` | `#eef1f6` | Chữ chính |
| `--muted` | `#b0b8c3` | Chữ phụ (ngày, "Đăng bởi") |
| `--accent` | `#9be22d` | Nút chính, vạch tiêu đề, tab đang chọn, viền focus |
| `--accent-ink` | `#121608` | Chữ trên nền `--accent` |
| `--danger` | `#ff9898` | Nút Xóa, thông báo lỗi |

**Tương phản WCAG AA** (tỉ lệ ≥ 4,5:1 cho chữ thường), tính theo công thức độ chói tương đối của WCAG 2.x:

| Cặp chữ / nền | Tỉ lệ | Kết quả |
|---|---|---|
| `--text` trên `--bg` | 11,88 : 1 | Đạt |
| `--text` trên `--surface` | 10,12 : 1 | Đạt |
| `--muted` trên `--bg` | 6,72 : 1 | Đạt |
| `--muted` trên `--surface` | 5,72 : 1 | Đạt |
| `--muted` trên `--surface-2` | 4,76 : 1 | Đạt |
| `--accent-ink` trên `--accent` | 11,63 : 1 | Đạt |
| `--danger` trên `--bg` | 6,53 : 1 | Đạt |
| `--danger` trên `--surface` | 5,56 : 1 | Đạt |
| `--danger` trên `--surface-2` | 4,63 : 1 | Đạt |

Hai giá trị ban đầu không đạt nên đã chỉnh: `--muted` từ `#a9b1bc` (chỉ 4,40 : 1 trên `--surface-2`) lên **`#b0b8c3`**, và `--danger` từ `#ff6b6b` (chỉ 4,13 : 1 trên `--surface`) lên **`#ff9898`**. Giá trị cuối là hai giá trị in đậm này.

Các điểm khác: viền focus `3px solid var(--accent)` cho mọi phần tử bấm được, và `prefers-reduced-motion: reduce` tắt hiệu ứng phóng ảnh khi hover và chuyển tab. Nội dung rộng tối đa 1280 px (không tính lề), gallery 1 / 2 / 3 cột ở breakpoint 600 / 1000 px, trang chi tiết hai cột từ 1000 px. Vì khung bị giới hạn 1280 px nên `sizes` của ảnh được tính lại theo bố cục này (gallery cuối là `410px`, trang chi tiết cuối là `916px`).

## Chạy nhiều web server

Lý do chính của object storage: nhiều web server cùng đọc ảnh mà một server đã ghi. Hai server dùng **cùng DB, cùng bucket, cùng `SESSION_SECRET`** (cùng `.env`) và **kho nháp riêng** (`UPLOAD_ROOT` khác nhau). Mở hai cửa sổ PowerShell ở thư mục gốc dự án. Mỗi lệnh đặt biến môi trường cho riêng cửa sổ đó nên phải chạy trong cửa sổ riêng, và dùng `npm start` (không dùng `npm run dev`).

```powershell
# Cửa sổ A
$env:PORT = 3000; $env:UPLOAD_ROOT = '../gallery-uploads-a'; npm start
```

```powershell
# Cửa sổ B
$env:PORT = 3001; $env:UPLOAD_ROOT = '../gallery-uploads-b'; npm start
```

Kiểm tra:

1. Đăng nhập và upload ảnh qua `http://localhost:3000/upload`.
2. Mở `http://localhost:3001/` và trang chi tiết của ảnh đó. Ảnh hiện và `GET /media/…` trả `200`, vì bucket dùng chung.
3. Phiên đăng nhập nằm trong DB nên đã đăng nhập ở 3000 thì 3001 vẫn đăng nhập (cookie `gallery.sid` không phân biệt cổng).
4. Xóa ảnh trên server 3001, rồi `curl.exe -s -D - -o NUL "http://localhost:3000/media/photos/<id>/v1/320.webp"` phải trả `404`.

Hai server cùng chạy cleanup định kỳ là an toàn: hàng đợi của mỗi server nằm riêng, các bước dọn trong DB và bucket đều idempotent. Biến `PORT` và `UPLOAD_ROOT` đặt bằng `$env:` chỉ có tác dụng ở chế độ dev. Khi `NODE_ENV=test`, ứng dụng chỉ đọc `.env.test`. Dùng `Remove-Item Env:PORT, Env:UPLOAD_ROOT` để bỏ hai biến trong cửa sổ đang dùng.

## Dùng Cloudflare R2 thay SeaweedFS (tùy chọn)

Code chỉ dùng S3 API, nên đổi sang Cloudflare R2 chỉ cần sửa `.env`, không sửa code. Phần này chưa được chạy thử trên R2 trong dự án.

1. Trong dashboard Cloudflare, tạo một bucket R2 và một API token có quyền đọc và ghi object. Nên tạo bucket sẵn thay vì để server tự tạo.
2. Điền vào `.env` (không phải `.env.example`):

   ```
   STORAGE_DRIVER=s3
   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_BUCKET=<tên bucket R2>
   S3_ACCESS_KEY_ID=<Access Key ID của token>
   S3_SECRET_ACCESS_KEY=<Secret Access Key của token>
   S3_FORCE_PATH_STYLE=true
   ```

3. Chạy lại `npm run dev`. Dòng khởi động in endpoint và bucket đang dùng để bạn kiểm tra.

**Không commit key thật.** `.env`, `.env.test` và `seaweedfs/s3.json` đã nằm trong `.gitignore`, và `.env.example` chỉ chứa giá trị giả. Che key khi chụp màn hình hay dán log. **Không chạy `npm test` trên R2.** Mỗi ca test tạo rồi xóa một bucket riêng và ghi nhiều object, trong khi R2 có hạn mức miễn phí (10 GB lưu trữ mỗi tháng và giới hạn số thao tác). Giữ `.env.test` trỏ về SeaweedFS local (bucket `photo-gallery-test`).

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

Đăng ký và đăng nhập trước khi lấy bằng chứng có thao tác upload, sửa hoặc xóa. Dùng cùng một `photoId` cho mục 01–04 và lưu kết quả theo checklist 01–19 trong [evidence/README.md](evidence/README.md), nơi có lệnh cụ thể cho từng mục. Che thông tin xác thực nếu xuất hiện trong ảnh chụp hoặc log, gồm cả giá trị cookie `gallery.sid`, mật khẩu trong `DATABASE_URL` và key S3.

```sh
npm run -s evidence:db
npm run -s evidence:db -- --photo "<id>"
npm run -s evidence:exif -- test/fixtures/exif-rotated.jpg
```

`evidence:db` in dòng `Object store` (driver, endpoint, bucket) ở đầu output, rồi bảng `Photo`, bảng `PhotoVariant` và **danh sách object trong bucket** (key, size, lastModified, gồm cả `dl/`). Với `--photo` chỉ hiện ảnh đó: sau khi xóa ảnh, output không còn object nào dưới `photos/<id>/` và `originals/<id>.png`. Lệnh đọc `.env`, hoặc `.env.test` khi `NODE_ENV=test`, nên dòng `bucket` cho biết đang xem bucket dev hay bucket test.

Variant WebP nằm trong bucket, không nằm trên đĩa. Tải variant về qua web server rồi chạy `evidence:exif` trên file đó:

```powershell
curl.exe -s -o "$env:TEMP\variant.webp" "http://localhost:3000/media/photos/<id>/v1/320.webp"
npm run -s evidence:exif -- "$env:TEMP\variant.webp"
```

Output của fixture gốc cho thấy Orientation và GPS. Output WebP sau xử lý ghi `null` cho hai giá trị này khi không còn EXIF.

Để lấy header GET trên Windows và lưu vào bằng chứng, thay ví dụ bằng URL variant thực tế.

```powershell
curl.exe -s -D - -o NUL "http://localhost:3000/media/photos/<id>/v1/960.webp"
```

Để lấy bằng chứng restart, lưu `photoId` và URL media, dừng hẳn web server rồi chạy lại với cùng DB và bucket. Mở lại gallery và gửi GET đến cùng URL media để ghi nhận `200`. Sau đó chạy `docker compose restart seaweedfs`, đợi SeaweedFS khởi động xong và gửi lại GET: vẫn `200` vì volume `seaweedfs-data` giữ object.

### Bằng chứng 08, 09 và 17 về kiểm tra request

Chạy `npm run fixtures` và khởi động server với `FAULT_INJECT` để trống. Dùng cùng cấu hình DB cho server và terminal chạy lệnh sau. Script tự đăng ký hai tài khoản `evidence-<ngẫu nhiên>` và gửi `Origin` cho các request thay đổi dữ liệu.

```sh
npm run -s evidence:requests -- --base http://localhost:3000
```

Mặc định các file được ghi vào `evidence/`. Thêm `--out <thư mục>` để ghi chỗ khác, ví dụ khi chạy thử.

- `08a-invalid-files.json` và `08b-invalid-files.json` chứa JSON của hai request trộn file. Mỗi request lưu một ảnh hợp lệ. Dùng `photo.id` trong mỗi JSON để lấy metadata và file tương ứng bằng `npm run -s evidence:db -- --photo "<id>"`.
- `09-request-limits.txt` ghi HTTP status, response body và số `Photo` trước và sau từng request giới hạn. Request sáu file hợp lệ phải trả `400 TOO_MANY_FILES`. Request chunked gửi một phần file với dữ liệu sinh theo stream vượt 55 MiB và phải trả `413 REQUEST_TOO_LARGE`. Lệnh dùng các fixture có sẵn và sinh phần body lớn trong bộ nhớ theo từng chunk.
- `17-auth-access.txt` ghi khách upload nhận 401, mở trang Upload nhận 303, người khác xóa ảnh nhận 403, khách xem gallery và media nhận 200.

### Bằng chứng 10 về lỗi DB sau khi ghi file

1. Trong `.env.test`, đặt `FAULT_INJECT=db-after-write` và kiểm tra DB cùng kho test đã tách riêng. Chọn `PORT` khác trong file này nếu đồng thời chạy server dev. Ở chế độ test, ứng dụng lấy `FAULT_INJECT` từ `.env.test`.
2. Bật chế độ test trước khi chạy server. Đăng ký hoặc đăng nhập trên server test, rồi upload một JPEG hoặc PNG hợp lệ có alt. Response HTTP `200` có kết quả file `ok: false` với mã `STORAGE_ERROR`.

   ```powershell
   $env:NODE_ENV = 'test'
   npm run dev
   ```

3. Trong terminal thứ hai, chạy ở chế độ test để ghi lại DB và danh sách **object trong bucket test** (`photo-gallery-test`) sau lỗi, thực thi cleanup rồi liệt kê lại. Khi rollback xóa object thành công, số bản ghi ảnh và tập object ảnh giữ như trước lần upload lỗi. Kho nháp `tmp/` trong `UPLOAD_ROOT` của test cũng phải rỗng.

   ```powershell
   $env:NODE_ENV = 'test'
   npm run -s evidence:db | Tee-Object -FilePath evidence/10-db-fault.txt
   npm run cleanup | Tee-Object -FilePath evidence/10-db-fault.txt -Append
   npm run -s evidence:db | Tee-Object -FilePath evidence/10-db-fault.txt -Append
   ```

4. Giữ response và đoạn log gây lỗi cùng bằng chứng. Dừng server test, để trống `FAULT_INJECT` trong `.env.test` và thoát terminal test khi xong. Các ca `npm test` chỉ kích hoạt fault injection khi truyền option vào `prepareTest`.

### Bằng chứng 15 và 16 về object storage

- Mục 15 gồm output `npm run -s evidence:db` trên bucket dev (`photo-gallery`) và ảnh chụp filer UI `http://localhost:8888/buckets/photo-gallery/photos/<id>/v1/`.
- Mục 16 dùng hai web server ở cổng 3000 và 3001 như trong [Chạy nhiều web server](#chạy-nhiều-web-server): upload ở 3000 rồi GET cùng URL media ở 3001 → `200`, đăng nhập ở 3000 thì 3001 vẫn đăng nhập, xóa ở 3001 thì 3000 trả `404`.

## Phần mở rộng của nhóm

Đề gốc là một ứng dụng gallery không có tài khoản người dùng, và ảnh nằm trên ổ đĩa của máy chạy server. Các phần sau là **phần nhóm thêm** so với đề gốc:

- **Object storage** (SeaweedFS, tùy chọn R2) thay cho ổ đĩa cục bộ, theo yêu cầu của giảng viên, để nhiều web server dùng chung ảnh.
- **Đăng nhập và phân quyền.** Đề gốc không có tài khoản (speaker note slide 32). Nhóm thêm đăng ký, đăng nhập, phiên lưu trong DB, mỗi ảnh có chủ sở hữu, chỉ chủ ảnh được chỉnh sửa và xóa, trang **Ảnh của tôi**, đổi mật khẩu và khóa tạm sau 5 lần nhập sai.
- **Tải ảnh**: tải bản gốc và các kích thước theo nhóm thiết bị.
- **Giao diện mới** theo phong cách tối, font tự host có tiếng Việt, đạt tương phản AA.
- **Chỉnh sửa ảnh** (xoay, lật, cắt, khôi phục, phiên bản) là phần bonus của đề.

## Ngoài phạm vi

CDN, presigned URL, bucket public cho trình duyệt tải trực tiếp, chuyển dữ liệu cũ từ ổ đĩa sang bucket, quên mật khẩu, xác minh email, đăng nhập bên thứ ba, 2FA, vai trò admin, xóa tài khoản, ô tìm kiếm và nút chuyển giao diện sáng/tối nằm ngoài phạm vi bài. Object storage và đăng nhập **đã nằm trong phạm vi** (xem phần trên).

**Đánh đổi đã chấp nhận ở phần khóa đăng nhập:**

- Thông báo khóa tạm ("Tài khoản tạm khóa do đăng nhập sai nhiều lần. Thử lại sau N phút") chỉ xuất hiện với tên đăng nhập có thật, nên người ngoài có thể suy ra một tên đăng nhập có tồn tại hay không.
- Người khác có thể cố tình nhập sai mật khẩu 5 lần để **khóa tài khoản của bạn trong 15 phút**. Không có cách mở khóa sớm hơn, vì quên mật khẩu và xác minh email nằm ngoài phạm vi.

[Thiết kế và tiêu chí kiểm thử](SPEC.md) · [Yêu cầu bài tập](REQUIREMENTS.md)

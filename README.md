# Photo Gallery

Ứng dụng chia sẻ ảnh: người dùng đăng ký, đăng nhập rồi upload ảnh JPEG/PNG; ai cũng xem và tải ảnh được. Server kiểm tra ảnh, xoay theo EXIF, bỏ metadata (gồm GPS), tạo các bản WebP nhiều kích thước và lưu ảnh trong object storage (SeaweedFS qua S3 API) để nhiều web server dùng chung.

**Công nghệ:** Node.js 20, Express 4 + EJS, PostgreSQL + Prisma, sharp, busboy, SeaweedFS (S3), `node:test` + supertest.

## Tính năng

- **Upload** 1–5 ảnh mỗi lần, kéo thả hoặc chọn file, mỗi ảnh có tiêu đề và mô tả (alt) riêng. Kết quả trả về theo từng file: ảnh hợp lệ được lưu, ảnh lỗi báo lý do ngay tại dòng của nó.
- **Gallery responsive** 1 / 2 / 3 cột. Mỗi ảnh có các bản WebP 320 / 960 / 1600 px (không phóng to ảnh nhỏ), trình duyệt tự chọn bản phù hợp qua `srcset` và `sizes`.
- **Trang chi tiết** hai cột: ảnh và các kích thước tải về bên trái; nút tải bản gốc, thông tin ảnh, nút Chỉnh sửa/Xóa (chỉ chủ ảnh) bên phải.
- **Tải ảnh** cho mọi người, kể cả khách:
  - *Tải bản gốc*: ảnh đầy đủ của phiên bản đang hiển thị, JPEG (PNG nếu ảnh trong suốt), không có EXIF/GPS.
  - *Kích thước khác*: các độ phân giải chuẩn theo nhóm Desktop / Điện thoại / Tablet, chỉ liệt kê kích thước không lớn hơn ảnh. Khi tỉ lệ khác, ảnh được cắt thông minh (giữ vùng nổi bật).
  - File tải về được tạo ở lần tải đầu tiên rồi lưu lại, lần sau trả ngay.
- **Chỉnh sửa ảnh** (chủ ảnh): xoay 90°, lật ngang, cắt bằng chuột hoặc cảm ứng, xem trước trên canvas, khôi phục bản gốc. Mỗi lần lưu tạo một phiên bản mới; hai lần lưu cùng lúc thì một lần nhận lỗi xung đột thay vì ghi đè.
- **Tài khoản**: đăng ký bằng tên đăng nhập + mật khẩu (argon2id), phiên lưu trong PostgreSQL, trang **Ảnh của tôi**, đổi mật khẩu (các thiết bị khác bị đăng xuất), khóa tạm 15 phút sau 5 lần nhập sai mật khẩu.
- **Phân quyền**: khách xem và tải ảnh; chỉ người đã đăng nhập được upload; chỉ chủ ảnh được chỉnh sửa và xóa. Mọi request thay đổi dữ liệu phải có header `Origin`/`Referer` cùng nguồn (chống CSRF), cookie `HttpOnly` + `SameSite=Lax`.
- **Giao diện tối**, font tự host Be Vietnam Pro và Open Sans (có tiếng Việt), màu chữ đạt tương phản WCAG AA, dùng được bằng bàn phím.

## Yêu cầu

- Node.js **20.6** trở lên
- Docker Desktop (chạy PostgreSQL và SeaweedFS)
- Git

## Cài đặt trên máy mới

Chạy các lệnh trong PowerShell ở thư mục gốc dự án.

### 1. Cài thư viện

```powershell
npm install
```

### 2. Chạy PostgreSQL

Nếu máy chưa có PostgreSQL, chạy bằng Docker (thay `<mật-khẩu>` bằng mật khẩu bạn tự đặt) rồi tạo DB test:

```powershell
docker run -d --name pg-gallery -e POSTGRES_PASSWORD=<mật-khẩu> -p 5432:5432 -v pg-gallery:/var/lib/postgresql/data postgres:16
```

```powershell
docker exec pg-gallery psql -U postgres -c "CREATE DATABASE photo_gallery_test;"
```

DB dev (`photo_gallery`) do Prisma tự tạo ở bước 5.

### 3. Tạo file cấu hình

Sao chép các file mẫu:

```powershell
Copy-Item .env.example .env
Copy-Item .env.example .env.test
Copy-Item seaweedfs/s3.example.json seaweedfs/s3.json
```

Ba file này đã nằm trong `.gitignore`, **không commit chúng**. Sau đó sửa giá trị theo bảng ở mục [Cấu hình](#cấu-hình). Tóm tắt những gì bắt buộc phải đổi:

- **Key S3**: tự đặt một access key và một secret key (chuỗi ngẫu nhiên bất kỳ), điền vào `seaweedfs/s3.json` và vào `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` của **cả** `.env` lẫn `.env.test`.
- **`SESSION_SECRET`**: chuỗi ngẫu nhiên ít nhất 32 ký tự, mỗi file một giá trị.
- **`DATABASE_URL`**: `.env` trỏ tới `photo_gallery`, `.env.test` trỏ tới `photo_gallery_test`.
- **Trong `.env.test`**: `S3_BUCKET=photo-gallery-test` và `UPLOAD_ROOT=../gallery-uploads-test`.

Tạo chuỗi ngẫu nhiên:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

### 4. Chạy SeaweedFS

```powershell
npm run storage:up
```

SeaweedFS (bản 4.55, ghim trong `docker-compose.yml`) mở S3 API ở `http://localhost:8333` và giao diện xem file (filer) ở `http://localhost:8888`. Cổng 8333 chỉ nhận request có chữ ký, mở bằng trình duyệt sẽ thấy `AccessDenied`; muốn xem file thì mở cổng 8888, ví dụ `http://localhost:8888/buckets/photo-gallery/`. Bucket được server tự tạo nếu chưa có. Dữ liệu nằm trong Docker volume `seaweedfs-data`, giữ nguyên khi khởi động lại.

### 5. Tạo bảng trong DB

```powershell
npx prisma migrate dev
```

```powershell
node --env-file=.env.test ./node_modules/prisma/build/index.js migrate deploy
```

Lệnh đầu tạo DB dev và áp dụng migration; lệnh sau áp dụng migration cho DB test.

### 6. Chạy

```powershell
npm run dev
```

Mở `http://localhost:3000`. Dòng khởi động cho biết đang dùng kho ảnh nào, ví dụ `storage: s3 http://localhost:8333 bucket photo-gallery`. Nếu thấy cảnh báo "đang dùng driver local mặc định" thì `.env` thiếu `STORAGE_DRIVER=s3`.

`npm run dev` tự khởi động lại khi sửa code; `npm start` chạy một lần (dùng khi chạy nhiều server).

### 7. Chạy test

```powershell
npm run fixtures
```

```powershell
npm test
```

Test cần SeaweedFS đang chạy, dùng DB và bucket test riêng (không đụng dữ liệu dev) và chạy tuần tự. Mỗi ca test tạo một bucket riêng rồi xóa sau khi xong.

## Cấu hình

| Biến | Ví dụ | Ý nghĩa |
|---|---|---|
| `PORT` | `3000` | Cổng web server |
| `DATABASE_URL` | `postgresql://postgres:<mật-khẩu>@localhost:5432/photo_gallery` | DB PostgreSQL. DB test phải có chữ `test` trong tên |
| `SESSION_SECRET` | 64 ký tự hex | Khóa ký cookie phiên, ít nhất 32 ký tự. Các server dùng chung DB phải dùng chung giá trị |
| `COOKIE_SECURE` | `false` | `true` khi chạy qua HTTPS |
| `STORAGE_DRIVER` | `s3` | `s3` (SeaweedFS/R2) hoặc `local` (lưu trên đĩa, chỉ để thử nhanh khi không có Docker) |
| `S3_ENDPOINT` | `http://localhost:8333` | Địa chỉ S3 API |
| `S3_REGION` | `us-east-1` | Region (R2 dùng `auto`) |
| `S3_BUCKET` | `photo-gallery` | Tên bucket. Bucket test phải chứa `test` và khác bucket dev |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | | Key khớp với `seaweedfs/s3.json` |
| `S3_FORCE_PATH_STYLE` | `true` | Giữ `true` với SeaweedFS |
| `UPLOAD_ROOT` | `../gallery-uploads` | Thư mục trên đĩa cho file tạm khi upload và hàng đợi dọn dẹp (với driver `local` thì chứa cả ảnh). Dev và test phải khác nhau |
| `VERSION_RETENTION_HOURS` | `24` | Giữ phiên bản ảnh cũ bao lâu sau khi bị thay |
| `CLEANUP_INTERVAL_MINUTES` | `15` | Chu kỳ chạy dọn dẹp |
| `FAULT_INJECT` | *(trống)* | Chỉ dùng khi kiểm thử lỗi, để trống khi chạy bình thường |

Khi `NODE_ENV=test`, ứng dụng chỉ đọc `.env.test` và bỏ qua biến môi trường của terminal.

## Giới hạn upload

| Giới hạn | Giá trị |
|---|---|
| Số ảnh mỗi lần upload | 1–5, JPEG hoặc PNG |
| Dung lượng mỗi ảnh | Tối đa 10 MiB (đúng 10 MiB vẫn nhận) |
| Tổng dung lượng một lần upload | Tối đa 55 MiB, vượt thì trả `413` |
| Số pixel | Tối đa 40.000.000 |
| Chiều cao bản WebP sau khi thu nhỏ | Tối đa 16.383 px |
| Tiêu đề / mô tả | Tiêu đề tối đa 120 ký tự; mô tả bắt buộc, tối đa 250 ký tự |

Server nhận diện ảnh theo nội dung file (không tin đuôi file), từ chối ảnh hỏng hoặc thiếu dữ liệu. Lỗi của cả lần upload (quá 5 ảnh, quá 55 MiB, dữ liệu gửi lên hỏng) thì không ảnh nào được lưu; lỗi của từng ảnh thì chỉ ảnh đó bị từ chối.

## Lưu trữ ảnh

Ảnh nằm trong **object storage dùng chung** để nhiều web server cùng đọc và ghi một nơi:

| Nội dung | Vị trí |
|---|---|
| Bản gốc đã chuẩn hóa (PNG, dùng nội bộ) | Bucket: `originals/<id>.png` |
| Các bản WebP hiển thị | Bucket: `photos/<id>/v<phiên bản>/<rộng>.webp` |
| File tải về (bản gốc, các kích thước) | Bucket: `photos/<id>/v<phiên bản>/dl/<kích thước>.jpg` |
| File tạm khi upload, hàng đợi dọn dẹp | Đĩa cục bộ trong `UPLOAD_ROOT`, riêng từng server |

- DB chỉ lưu đường dẫn tương đối của ảnh trong bucket (storage key), không lưu đường dẫn ổ đĩa hay nội dung ảnh.
- Ảnh được phục vụ qua `GET /media/<key>`: server kiểm tra trong DB rồi mới gửi ảnh, nên ảnh đã xóa hoặc chưa lưu xong luôn trả `404`. Header `Cache-Control: public, max-age=31536000, immutable`; khi ảnh được chỉnh sửa, URL đổi theo phiên bản nên trình duyệt tải bản mới.
- Nếu SeaweedFS ngừng hoạt động, server **không** tự chuyển sang lưu trên đĩa: upload báo lỗi, ảnh trả `502`, không có file nào bị lưu lẫn chỗ.

## Xóa và dọn dẹp

- **Xóa ảnh**: ảnh bị ẩn ngay khỏi gallery, trang chi tiết và `/media`, rồi mọi file của ảnh trong bucket (mọi phiên bản, bản gốc, file tải về) bị xóa. Bản ghi trong DB được giữ lại với trạng thái `PURGED`.
- **Phiên bản cũ** sau khi chỉnh sửa vẫn mở được trong `VERSION_RETENTION_HOURS` (mặc định 24 giờ), sau đó bị xóa.
- **Dọn dẹp tự động** chạy khi server khởi động và mỗi `CLEANUP_INTERVAL_MINUTES` phút; chạy ngay bằng `npm run cleanup`. Nó xử lý:
  - file xóa bị lỗi trước đó (thử lại theo hàng đợi),
  - ảnh xóa dở,
  - phiên bản cũ quá hạn,
  - file tạm và file trong bucket không thuộc ảnh nào, cũ hơn 1 giờ,
  - phiên đăng nhập đã hết hạn.
- Ảnh đã xóa có thể vẫn hiện trong trình duyệt của người từng xem cho tới khi cache hết hạn; request mới tới server luôn nhận `404`.

## Chạy nhiều web server

Hai server dùng chung `.env` (cùng DB, bucket và `SESSION_SECRET`) nhưng mỗi server một `UPLOAD_ROOT` và một cổng. Mở hai cửa sổ PowerShell:

```powershell
$env:PORT = 3000; $env:UPLOAD_ROOT = '../gallery-uploads-a'; npm start
```

```powershell
$env:PORT = 3001; $env:UPLOAD_ROOT = '../gallery-uploads-b'; npm start
```

Ảnh upload ở server này hiện ngay ở server kia, và đăng nhập ở một server thì server kia cũng nhận (phiên nằm trong DB). Dùng `Remove-Item Env:PORT, Env:UPLOAD_ROOT` để bỏ hai biến khi xong.

## Dùng Cloudflare R2 thay SeaweedFS (tùy chọn)

Code chỉ dùng S3 API nên chỉ cần sửa `.env`:

1. Trong dashboard Cloudflare, tạo bucket R2 và một API token có quyền đọc/ghi object. Nên tạo bucket sẵn trên dashboard.
2. Trong `.env`:

   ```
   STORAGE_DRIVER=s3
   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_BUCKET=<tên bucket>
   S3_ACCESS_KEY_ID=<Access Key ID của token>
   S3_SECRET_ACCESS_KEY=<Secret Access Key của token>
   S3_FORCE_PATH_STYLE=true
   ```

3. Chạy lại `npm run dev` và kiểm tra dòng khởi động.

Giữ `.env.test` trỏ về SeaweedFS local: bộ test tạo và xóa rất nhiều bucket, không nên chạy trên R2. Chưa được chạy thử trên R2.

## Lệnh npm

| Lệnh | Việc |
|---|---|
| `npm run dev` | Chạy server, tự khởi động lại khi sửa code |
| `npm start` | Chạy server |
| `npm test` | Chạy toàn bộ test (cần SeaweedFS) |
| `npm run fixtures` | Tạo ảnh mẫu cho test trong `test/fixtures/` |
| `npm run cleanup` | Chạy dọn dẹp ngay |
| `npm run storage:up` / `storage:down` | Bật / tắt SeaweedFS |
| `npm run -s evidence:db [-- --photo <id>]` | In ảnh, bản WebP trong DB và danh sách file trong bucket |
| `npm run -s evidence:exif -- <file>` | In metadata của một file ảnh (kích thước, Orientation, GPS) |
| `npm run -s evidence:requests -- --base <url>` | Gửi các request mẫu (file lỗi, quá giới hạn, quyền truy cập) và ghi kết quả ra file |

## Dữ liệu kiểm thử

`npm run fixtures` tạo các ảnh trong `test/fixtures/` (thư mục này không commit). Tọa độ GPS là dữ liệu giả.

| File | Nội dung |
|---|---|
| `photo.jpg` | JPEG 2000 × 1333 |
| `photo.png` | PNG 800 × 600 |
| `small.png` | PNG 200 × 150 |
| `exif-rotated.jpg` | JPEG 1200 × 800, EXIF Orientation 6 và GPS giả; sau xử lý là 800 × 1200, đúng chiều |
| `fake.jpg` | File văn bản mang đuôi `.jpg` |
| `truncated.jpg` | JPEG bị cắt mất 30% cuối |
| `exactly-10mib.png` / `over-10mib.png` | PNG hợp lệ, đúng 10.485.760 / 10.485.761 byte |
| `max-pixels.png` / `too-many-pixels.png` | PNG 8000 × 5000 / 8000 × 5001 |
| `too-tall.png` | PNG 400 × 20000 |
| `corners.png` | PNG 400 × 300, bốn góc bốn màu, dùng kiểm tra xoay/lật/cắt |

## Cấu trúc thư mục

```
prisma/            schema và migration
scripts/           tạo fixture, dọn dẹp, in thông tin kiểm tra
seaweedfs/         cấu hình mẫu của SeaweedFS
src/
  auth/            đăng nhập, phiên, kiểm tra Origin, khóa tạm
  cleanup/         xóa ảnh, hàng đợi và dọn dẹp định kỳ
  download/        tải ảnh: danh sách kích thước, tạo file tải về
  edit/            chỉnh sửa ảnh và lưu phiên bản
  routes/          các route trang và API
  storage/         object store (s3, local) và kho nháp
  upload/          nhận multipart, kiểm tra và xử lý ảnh
  views/, public/  giao diện EJS, CSS, JavaScript phía trình duyệt
test/              bộ test
```

Tài liệu thiết kế chi tiết: [SPEC.md](SPEC.md) · Yêu cầu bài tập: [REQUIREMENTS.md](REQUIREMENTS.md)

# Photo Gallery — SPEC

Tài liệu thiết kế để triển khai. Yêu cầu gốc và bảng nghiệm thu: [REQUIREMENTS.md](REQUIREMENTS.md).
Thứ tự làm: **phần cốt lõi (T0–T6) trước, bonus (T7–T9) sau.** Không bắt đầu task sau khi test của task trước chưa qua.
**Cập nhật:** theo yêu cầu của giảng viên, ảnh chuyển sang object storage (SeaweedFS, S3 API). Xem **§15**. Mục đó thay thế các chỗ nói "local filesystem" ở §4, §7, §9.2 bước 5, §12, §13, và thêm task T12–T14.

---

## 1. Stack

| Lớp | Chọn | Ghi chú | Lý do chọn |
|---|---|---|---|
| Runtime | Node.js ≥ 20, CommonJS | Dùng `node:test`, `node --watch` | Cùng nền với các block trước nên không phải học lại. Node 20 có sẵn test runner, `fetch`, `FormData` và chế độ watch, giảm số thư viện phải cài. |
| Web | Express 4 + EJS | SSR, cùng kiểu Block9_SSR | Đã quen từ Block9_SSR. Render phía server giúp HTML gallery có sẵn `srcset`, `sizes`, `width`, `height`, `alt` ngay trong response, nên dễ kiểm bằng test và chụp DOM làm bằng chứng. Không cần dựng thêm SPA và bước build. |
| Multipart | `busboy` 1.6 (dùng trực tiếp) | Không dùng multer: multer hủy cả request khi một file quá cỡ | Đề yêu cầu từ chối riêng file vượt 10 MiB nhưng vẫn lưu các file hợp lệ khác. Busboy báo `truncated` cho từng file và cho tự đếm bytes của cả request (để trả 413 khi vượt 55 MiB), xử lý ngắt kết nối và dọn file tạm theo ý mình. |
| Ảnh | `sharp` (≥ 0.33) | Xoay theo EXIF, bỏ metadata, PNG/WebP, `limitInputPixels`, `failOn` | Một thư viện làm đủ các bước đề yêu cầu: đọc kích thước từ header trước khi giải mã, giới hạn số pixel, báo lỗi ảnh thiếu bytes, xoay pixel theo EXIF rồi bỏ toàn bộ EXIF (gồm GPS), xuất WebP. Dùng libvips nên nhanh và tốn ít RAM. |
| DB | PostgreSQL + Prisma 5 | `prisma migrate dev` | Đã có sẵn cài đặt và kinh nghiệm từ các block trước. Transaction của PostgreSQL cùng câu `UPDATE` có điều kiện đủ để xử lý hai lần lưu chỉnh sửa đồng thời. Prisma cho schema rõ ràng và migration lặp lại được trên DB dev lẫn DB test. |
| Object storage | SeaweedFS (S3 API) qua `@aws-sdk/client-s3`, chạy bằng Docker | Xem §15. Ảnh và PNG gốc nằm trong bucket; file tạm và hàng đợi dọn vẫn ở đĩa local | Giảng viên yêu cầu: nhiều người đăng ảnh thì phải chạy nhiều web server, mà ổ đĩa riêng của một máy thì máy khác không đọc được (slide 19). SeaweedFS là lựa chọn slide 21 đề xuất, miễn phí, chạy bằng Docker, không cần tài khoản. Code chỉ dùng S3 API nên đổi sang Cloudflare R2 chỉ cần sửa `.env`. Không chọn MinIO vì từ 10/2025 bản community không còn Docker image chính thức. |
| Config | `dotenv` | | Tách cấu hình (DB, thư mục lưu ảnh) khỏi code và khỏi git. Dùng hai file `.env` và `.env.test` để dev và test không dùng chung DB hay thư mục ảnh. Có `.env.example` làm cấu hình mẫu để nộp. |
| Test | `node:test` + `supertest` | DB test riêng, `UPLOAD_ROOT` tạm riêng cho mỗi lần chạy | `node:test` có sẵn trong Node, không thêm phụ thuộc. `supertest` gửi request thật vào app mà không cần mở cổng, phù hợp với yêu cầu nghiệm thu qua request thật và trạng thái lưu. |
| Frontend | EJS + CSS + JS thuần | Form upload gửi `fetch` + `FormData`; trang edit dùng `<canvas>` | Giao diện ít màn hình nên không cần framework. `fetch` + `FormData` là đúng cách slide 8 hướng dẫn và cho hiển thị kết quả theo từng file. `<canvas>` đủ để xem trước xoay, lật, crop với cùng thứ tự như server. |

ID ngẫu nhiên: `crypto.randomBytes(9).toString('base64url')` → 12 ký tự `[A-Za-z0-9_-]`. Không cần thêm thư viện.

Ngoài phạm vi: đăng nhập và phân quyền (ai cũng upload/xóa/sửa được), CSRF, CDN, presigned URL. README phải ghi rõ các điểm này. (Object storage **đã nằm trong phạm vi**, xem §15.)

---

## 2. Cấu trúc thư mục

```
Block10/
  package.json
  .env.example            # mẫu cấu hình, không có thông tin xác thực thật
  prisma/schema.prisma
  src/
    server.js             # khởi động: load config, chạy cleanup lúc start + định kỳ, listen
    app.js                # tạo Express app (export để supertest dùng)
    config.js             # đọc env, resolve UPLOAD_ROOT từ thư mục ứng dụng
    db.js                 # PrismaClient dùng chung
    storage.js            # keyToPath, writeFile, deleteKey (ENOENT = thành công), listDir
    ids.js                # newPhotoId()
    upload/
      parseMultipart.js   # busboy → file tạm + field, áp mọi giới hạn cấp request
      validateImage.js    # magic bytes, metadata, giới hạn pixel
      processImage.js     # chuẩn hóa → PNG gốc, sinh variant WebP
      variantPlan.js      # tính danh sách chiều rộng variant
      savePhoto.js        # ghi file + transaction DB + dọn khi lỗi
    edit/
      validateEdits.js
      renderEdits.js      # pipeline xoay → lật → crop
      saveVersion.js      # cấp version, ghi file, transaction có điều kiện
    cleanup/
      queue.js            # cleanup-queue/: mỗi key cần dọn lại là một file JSON
      runCleanup.js       # mọi bước dọn (mục 9)
    routes/
      pages.js            # gallery, chi tiết, upload, edit
      api.js              # POST /api/uploads, POST /api/photos/:id/edits
      media.js            # GET /media/*
    views/                # layout.ejs, gallery.ejs, detail.ejs, upload.ejs, edit.ejs, 404.ejs
    public/               # styles.css, upload.js, edit.js
  scripts/
    cleanup.js            # npm run cleanup
    make-fixtures.js      # npm run fixtures
    evidence-db.js        # npm run evidence:db
  test/
    fixtures/             # sinh bằng npm run fixtures (không commit file lớn)
    helpers.js            # tạo app với UPLOAD_ROOT tạm, reset DB
    *.test.js
```

---

## 3. Cấu hình (`.env.example`)

```
PORT=3000
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/photo_gallery
# Trong .env.test, đặt UPLOAD_ROOT riêng, ví dụ ../gallery-uploads-test.
UPLOAD_ROOT=../gallery-uploads
VERSION_RETENTION_HOURS=24
CLEANUP_INTERVAL_MINUTES=15
# Chỉ có tác dụng khi NODE_ENV=test. Giá trị: db-after-write | edit-db-after-write
FAULT_INJECT=
```

- `UPLOAD_ROOT` tương đối thì resolve theo **thư mục gốc ứng dụng** (`path.resolve(__dirname, '..', value)` trong `config.js`), không theo `process.cwd()`.
- Khi `NODE_ENV=test`, mặc định `UPLOAD_ROOT=../gallery-uploads-test`. Sau khi resolve, thư mục test phải khác `UPLOAD_ROOT` của `.env` (mặc định `../gallery-uploads`). Nếu trùng, `config.js` báo lỗi trước khi server hoặc CLI cleanup truy cập kho ảnh.
- Lúc khởi động, tạo sẵn `UPLOAD_ROOT/{photos,originals,tmp,cleanup-queue}`.
- `UPLOAD_ROOT` không được nằm trong `src/` hay `public/`, và phải có trong `.gitignore` nếu đặt trong repo.

---

## 4. Storage

> **Đã thay đổi ở §15:** `photos/` và `originals/` nằm trong bucket S3 (SeaweedFS). Chỉ `tmp/` và `cleanup-queue/` còn ở đĩa local. Storage key giữ nguyên như bảng dưới.

| Nội dung | Storage key | Công khai? |
|---|---|---|
| Variant WebP | `photos/<photoId>/v<n>/<width>.webp` | Có, qua `/media/<key>` nếu DB cho phép (mục 7) |
| Bản gốc chuẩn hóa | `originals/<photoId>.png` | Không |
| File tạm khi upload | `tmp/<uploadId>-<index>` | Không |

- DB **chỉ lưu storage key**, không lưu đường dẫn tuyệt đối, không lưu bytes.
- `storage.keyToPath(key)`: kiểm tra key khớp regex cho phép, rồi `path.join(UPLOAD_ROOT, key)`, rồi xác nhận kết quả vẫn nằm trong `UPLOAD_ROOT`. Key sai định dạng thì ném lỗi.
- `storage.deleteKey(key)`: `ENOENT` coi là đã xóa (idempotent). Xóa xong thì xóa thư mục `v<n>` và `<photoId>` nếu đã rỗng.
- Bản gốc là PNG vì WebP giới hạn mỗi cạnh ≤ 16383 px, còn ảnh 40 triệu pixel có thể dài hơn.

---

## 5. Schema Prisma

```prisma
enum PhotoStatus {
  PUBLISHED
  DELETING
  PURGED
}

model Photo {
  id             String         @id            // 12 ký tự ngẫu nhiên
  title          String         @db.VarChar(120)
  alt            String         @db.VarChar(250)
  originalKey    String         @unique         // originals/<id>.png
  originalWidth  Int                            // sau khi xoay theo EXIF
  originalHeight Int
  status         PhotoStatus    @default(PUBLISHED)
  currentVersion Int            @default(1)
  nextVersion    Int            @default(2)     // bộ đếm cấp version cho bonus
  createdAt      DateTime       @default(now())
  deletedAt      DateTime?                      // lúc chuyển DELETING
  purgedAt       DateTime?                      // lúc chuyển PURGED
  versions       PhotoVersion[]
  variants       PhotoVariant[]

  @@index([status, createdAt])
}

model PhotoVersion {
  photoId      String
  version      Int
  edits        Json            // {"rotate":0,"flipH":false,"crop":null} với v1 và khi khôi phục
  width        Int             // kích thước ảnh sau chỉnh sửa, trước resize
  height       Int
  createdAt    DateTime        @default(now())
  supersededAt DateTime?       // lúc một version khác thay thế
  purgedAt     DateTime?       // lúc file của version đã bị xóa
  photo        Photo           @relation(fields: [photoId], references: [id])
  variants     PhotoVariant[]

  @@id([photoId, version])
}

model PhotoVariant {
  id         Int          @id @default(autoincrement())
  photoId    String
  version    Int
  width      Int
  height     Int
  mime       String       // "image/webp"
  bytes      Int
  storageKey String       @unique
  photo      Photo        @relation(fields: [photoId], references: [id])
  photoVersion PhotoVersion @relation(fields: [photoId, version], references: [photoId, version])

  @@unique([photoId, version, width])
}
```

**Xóa là đánh dấu, không xóa bản ghi:** `Photo.status = PURGED`, `PhotoVersion.purgedAt` được đặt. Nhờ vậy vẫn truy vấn được danh sách key để làm bằng chứng. README ghi rõ lựa chọn này.

Bảng dùng trong code và tên trong bài đều là `Photo` và `PhotoVariant`. `PhotoVersion` thêm vào để phục vụ bonus. Ở phần cốt lõi, mỗi ảnh có đúng một dòng `v1`.

---

## 6. Upload

### 6.1 Giới hạn

| Tên | Giá trị | Cấp |
|---|---|---|
| `MAX_FILES` | 5 (ít nhất 1) | Request |
| `MAX_FILE_BYTES` | 10 MiB = 10 485 760 | File |
| Ngưỡng parser busboy `fileSize` | `MAX_FILE_BYTES + 1` | (để phân biệt "đúng 10 MiB" và "vượt") |
| `MAX_REQUEST_BYTES` | 55 MiB = 57 671 680 | Request |
| `MAX_PIXELS` | 40 000 000 (rộng × cao, so sánh `>`) | File |
| `WEBP_MAX_DIM` | 16383 | File (kiểm tra trên kích thước variant) |
| Độ dài field | `title` ≤ 120, `alt` ≤ 250 ký tự | File |

### 6.2 Request

`POST /api/uploads`, `Content-Type: multipart/form-data`.

- File: field `photos`, lặp lại 1–5 lần. `index` = thứ tự của phần file `photos` trong body, bắt đầu từ 0.
- Text: `title_<index>`, `alt_<index>`. Client append các field text **trước** các file. Cả hai đều được `trim()`.
  - `title` trống thì lấy tên file đã làm sạch: bỏ phần đường dẫn (`path.basename`, xử lý cả `\`), bỏ đuôi, bỏ ký tự điều khiển, cắt còn 120 ký tự. Còn rỗng thì dùng `"Ảnh không tên"`. Tên file chỉ dùng để hiển thị, **không bao giờ** được ghép vào storage key hay đường dẫn.
  - `alt` là **bắt buộc**, do người dùng nhập và mô tả nội dung ảnh (vd "Chó nằm dưới bàn"). **Không** mặc định bằng `title` hay tên file (speaker note slide 34). Server tự kiểm tra lại: `alt` trống sau `trim()` → lỗi `ALT_REQUIRED` cho **riêng file đó**, các file hợp lệ khác vẫn được lưu.
- Field có tên khác bị bỏ qua.

### 6.3 Các bước trong `parseMultipart`

1. Không phải `multipart/form-data` → `400 NOT_MULTIPART`.
2. `Content-Length` có và lớn hơn `MAX_REQUEST_BYTES` → trả ngay `413 REQUEST_TOO_LARGE`, header `Connection: close`, không đọc body.
3. Tạo busboy với `limits: { files: 5, fileSize: MAX_FILE_BYTES + 1, fields: 20, fieldSize: 4096, parts: 30 }`.
   - Bọc lời gọi `busboy({ headers, limits })` trong `try/catch`: hàm này **ném lỗi đồng bộ** khi header sai, ví dụ thiếu `boundary`. Bắt được lỗi → `400 MALFORMED`.
4. Đếm bytes thực nhận trên `req` (sự kiện `data`). Vượt `MAX_REQUEST_BYTES` → `abort('REQUEST_TOO_LARGE')` (xem 6.3a).
5. Mỗi file `photos`: tạo write stream tới `tmp/<uploadId>-<index>`, đếm bytes. Lưu `{ index, filename, mimeType (chỉ để tham khảo), tmpKey, bytes, truncated }`.
   - Phần file có tên field khác `photos`: `stream.resume()` để bỏ qua.
6. Sự kiện `filesLimit` (có file thứ 6) → đánh dấu `TOO_MANY_FILES` cho cả request.
   - Cũng nghe `partsLimit` và `fieldsLimit` → `MALFORMED`.
7. Busboy `error` → `abort('MALFORMED')`.
8. **Chờ cả hai điều kiện:** busboy đã `close` **và** mọi write stream đã ghi xong. Chờ từng stream bằng `stream.promises.finished(ws)`, không chờ sự kiện `finish`: stream bị hủy chỉ phát `close` chứ không bao giờ phát `finish`, nên chờ `finish` sẽ treo request. `finished()` resolve khi ghi xong và reject khi stream lỗi hoặc bị hủy. Chưa đủ cả hai điều kiện thì không được xử lý hay công bố ảnh nào.
9. Có lỗi cấp request (`TOO_MANY_FILES`, `MALFORMED`, `NO_FILES` khi 0 file, `REQUEST_TOO_LARGE`, `ABORTED`, `STORAGE_ERROR`):
   - Xóa mọi file tạm.
   - Trả lỗi theo bảng mục 6.6 (trừ `ABORTED`: client đã ngắt nên không gửi response).
   - **Không công bố ảnh nào.**

### 6.3a Luồng thoát khi lỗi giữa chừng

`parseMultipart` có **một** hàm `abort(code)` duy nhất, chỉ chạy một lần (có cờ `aborted`). Mọi tình huống dưới đây đều gọi hàm này:

| Tình huống | Phát hiện bằng | Code |
|---|---|---|
| Vượt 55 MiB giữa chừng | Bộ đếm ở bước 4 | `REQUEST_TOO_LARGE` (413) |
| Client ngắt kết nối trước khi busboy `close` | `req` phát `aborted`, hoặc `close` khi `req.complete === false` | `ABORTED` (không gửi response) |
| Ổ đĩa lỗi khi ghi file tạm (ENOSPC, EACCES…) | Write stream phát `error` | `STORAGE_ERROR` (500) |
| Multipart hỏng | Busboy phát `error`, hoặc lỗi ở bước 3 | `MALFORMED` (400) |

`abort(code)` thực hiện theo thứ tự:
1. Đặt cờ `aborted`. Từ đây bỏ qua mọi sự kiện file/field mới. File stream của busboy đến sau thì gọi `resume()` để xả.
2. `req.unpipe(bb)`, rồi `bb.destroy()` (hoặc `removeAllListeners` rồi để GC thu), để parser không phát thêm sự kiện.
3. `ws.destroy()` cho mọi write stream còn mở.
4. Chờ **mọi** write stream đóng hẳn bằng `Promise.allSettled(streams.map(ws => finished(ws)))`. Dùng `allSettled` vì các stream bị hủy sẽ reject.
5. Xóa mọi file tạm đã tạo (`ENOENT` coi là thành công).
6. Nếu client còn kết nối: gửi response lỗi kèm `Connection: close`, rồi `req.resume()` để xả phần body còn lại hoặc để socket đóng.

Test bắt buộc cho phần này (trong `upload.request`):
- Client ngắt giữa chừng → `tmp/` rỗng, 0 Photo, request handler kết thúc (test có timeout).
- Giả lập lỗi ghi (`UPLOAD_ROOT/tmp` chỉ đọc, hoặc stub `fs.createWriteStream`) → 500, `tmp/` rỗng.
- Thiếu `boundary` → 400 `MALFORMED`.

### 6.4 Xử lý từng file (tuần tự, không song song)

Với mỗi file, theo thứ tự `index`. Bất kỳ bước nào lỗi → kết quả `ok:false` cho file đó, dọn mọi file đã tạo cho file đó, rồi chuyển sang file tiếp.

0. **Field:** `alt_<index>` trống → `ALT_REQUIRED`. `title` hoặc `alt` vượt độ dài cho phép → `INVALID_FIELD`. Kiểm tra bước này trước để khỏi tốn công giải mã ảnh.
1. **Bytes:** `bytes > MAX_FILE_BYTES` hoặc `truncated` → `TOO_LARGE`. File đúng 10 MiB thì đi tiếp.
2. **Chữ ký:** đọc 8 byte đầu.
   - JPEG: `FF D8 FF`. PNG: `89 50 4E 47 0D 0A 1A 0A`.
   - Không khớp → `NOT_IMAGE`. Bỏ qua đuôi file và MIME do browser gửi.
3. **Header:** `sharp(tmp).metadata()`.
   - Lỗi → `CORRUPT`.
   - Lấy `width`, `height`, `orientation`. Nếu `orientation` ∈ 5–8 thì hoán đổi rộng/cao để có kích thước sau khi xoay.
   - `width × height > MAX_PIXELS` → `TOO_MANY_PIXELS`. Bước này chỉ đọc header, chưa giải mã toàn bộ ảnh. Phép nhân dùng `Number` của JS là đủ an toàn, vì tích lớn nhất có thể (65535² ≈ 4,3 × 10⁹) còn xa giới hạn 2⁵³. Nếu sau này viết lại bằng ngôn ngữ khác thì phải dùng kiểu số 64 bit.
4. **Chuẩn hóa** (giải mã toàn bộ):
   ```js
   sharp(tmp, { limitInputPixels: MAX_PIXELS, failOn: 'warning' })
     .rotate()   // xoay pixel theo EXIF
     .png()      // không gọi withMetadata/keepExif → mọi EXIF (kể cả GPS) bị bỏ
     .toFile(<path của originals/<id>.png>)
   ```
   - Lỗi → `CORRUPT`. Đây là bước bắt được ảnh thiếu bytes ở cuối, vì `metadata()` chỉ đọc header nên không phát hiện được.
   - `limitInputPixels` là lớp bảo vệ thứ hai, phòng trường hợp bước 3 bị lách.
5. **Kế hoạch variant** (`variantPlan(W, H)`, với W×H là kích thước sau khi xoay):
   ```
   maxW   = min(W, 1600)
   widths = sort(unique([320, 960, 1600].filter(w => w < maxW).concat([maxW])))
   height(w) = max(1, round(H * w / W))
   ```
   - Ví dụ: 2000 px → 320/960/1600. 1000 px → 320/960/1000. 800 px → 320/800. 200 px → 200. Luôn tối đa 3 variant, không bao giờ phóng to.
   - Có variant nào có `height(w) > WEBP_MAX_DIM` → `UNSUPPORTED_DIMENSIONS`. Kiểm tra trên kích thước variant sau resize, không kiểm tra trên ảnh gốc.
6. **Sinh variant:** từ PNG gốc, chạy `sharp(png).resize({ width: w }).webp({ quality: 80 }).toFile(...)` cho từng chiều rộng, ghi vào `photos/<id>/v1/<w>.webp`. Ghi lại `{ width, height, bytes }` thật đọc từ `info` mà sharp trả về.
7. **Lưu DB** (mục 6.5).
8. Xóa file tạm của file này.

Cuối request, dù có lỗi hay không: xóa hết file tạm còn sót lại (dùng `finally`).

### 6.5 Ghi DB và dọn khi lỗi (`savePhoto`)

```
writtenKeys = [originalKey, ...variantKeys]   // đã ghi đủ ở bước 4–6
try:
  prisma.$transaction(async tx => {
    tx.photo.create(...)
    tx.photoVersion.create({ version: 1, edits: IDENTITY, ... })
    tx.photoVariant.createMany(...)
    if (NODE_ENV === 'test' && FAULT_INJECT === 'db-after-write') throw new Error('FAULT_INJECT')
  })
catch:
  for key of writtenKeys: try deleteKey(key) catch → queue.enqueue(key, 'upload-rollback')
  // queue.enqueue ghi một file JSON riêng vào cleanup-queue/ (xem 9.2 bước 1)
  → kết quả file: ok:false, error STORAGE_ERROR
```

- Điểm gây lỗi giả lập nằm **sau khi file đã ghi xong, trước khi commit**.
- Sinh variant lỗi giữa chừng (bước 6) → xóa các key đã ghi của file đó, không ghi DB.

### 6.6 Response

Request hợp lệ ở cấp request → **200**, kể cả khi mọi file đều bị từ chối:

```json
{
  "results": [
    { "index": 0, "filename": "bien.jpg", "ok": true,
      "photo": { "id": "aB3dE5fG7hJ9", "title": "...", "url": "/photos/aB3dE5fG7hJ9",
                 "variants": [{ "width": 320, "height": 213, "url": "/media/photos/aB3dE5fG7hJ9/v1/320.webp" }] } },
    { "index": 1, "filename": "fake.jpg", "ok": false,
      "error": { "code": "NOT_IMAGE", "message": "File không phải JPEG hoặc PNG" } }
  ]
}
```

Lỗi cấp request → `{ "error": { "code", "message" } }`:

| Code | HTTP | Khi nào |
|---|---|---|
| `NOT_MULTIPART` | 400 | Sai Content-Type |
| `MALFORMED` | 400 | Busboy lỗi, vượt `parts`/`fields` |
| `NO_FILES` | 400 | 0 file `photos` |
| `TOO_MANY_FILES` | 400 | > 5 file |
| `REQUEST_TOO_LARGE` | 413 | > 55 MiB (theo header hoặc đếm stream) |
| `STORAGE_ERROR` | 500 | Không ghi được file tạm |
| `ABORTED` | — | Client ngắt kết nối; chỉ ghi log, không gửi response |

Lỗi cấp file: `ALT_REQUIRED`, `INVALID_FIELD`, `TOO_LARGE`, `NOT_IMAGE`, `CORRUPT`, `TOO_MANY_PIXELS`, `UNSUPPORTED_DIMENSIONS`, `STORAGE_ERROR`. Message hiển thị bằng tiếng Việt.

---

## 7. Phục vụ media — `GET /media/*`

1. Key = phần sau `/media/`. Phải khớp `^photos/[A-Za-z0-9_-]{12}/v\d+/\d+\.webp$`, không khớp → 404.
2. Tra DB: `PhotoVariant` có `storageKey = key`, kèm `photo.status = PUBLISHED` và `photoVersion.purgedAt IS NULL`. Không thấy → **404**.
   - Hệ quả: chỉ version **đã commit** mới tải được. File của request thua (mục 10.4) hoặc file mồ côi trên đĩa đều trả 404.
   - Ảnh `DELETING`/`PURGED` → 404 cho mọi version.
   - Version cũ đã bị thay nhưng chưa purge → vẫn phục vụ, để trang đang mở không bị vỡ ảnh.
3. `res.sendFile(key, { root: UPLOAD_ROOT, cacheControl: false, dotfiles: 'deny' })` với header:
   - `Content-Type: image/webp`
   - `Cache-Control: public, max-age=31536000, immutable`
   - `X-Content-Type-Options: nosniff`
4. File thiếu trên đĩa dù DB có → 404 và ghi log cảnh báo.

**Cache sau khi xóa:** đề bài (slide 28) chấp nhận rằng xóa ở origin không xóa bản đã nằm trong cache của browser. **Không** đổi sang `no-cache`. Kiểm thử xóa bằng request mới tới server (supertest/curl). README ghi rõ hành vi này.

---

## 8. Trang (SSR)

Layout chung có nav: Gallery · Upload. Mọi trang `404.ejs` khi ảnh không `PUBLISHED`.

### 8.1 `GET /` — Gallery
- Ảnh `PUBLISHED`, mới nhất trước. Mỗi thẻ là link tới trang chi tiết, kèm `title`.
- Grid CSS: 1 cột khi `< 600px`, 2 cột khi `600–999px`, 3 cột khi `≥ 1000px`.
- `<img>` dùng các variant của `currentVersion`. `srcset` sinh từ **các dòng `PhotoVariant` thật trong DB**, không ghi cứng ba mốc. Ví dụ ảnh rộng 800 px chỉ có `320w, 800w`, ảnh rộng 200 px chỉ có `200w`.
  ```html
  <img src="<variant lớn nhất ≤ 960; nếu không có thì variant nhỏ nhất>"
       srcset="<url> <w>w, ... (mỗi variant một mục, sắp tăng dần)"
       sizes="(max-width: 599px) 100vw, (max-width: 999px) 50vw, 33vw"
       width="<w của src>" height="<h của src>"
       loading="lazy" decoding="async" alt="<alt>">
  ```
  - `width`/`height` là kích thước của variant làm `src`, để browser giữ chỗ đúng tỉ lệ.
  - CSS: `img { width: 100%; height: auto; }`.
- Không có ảnh → thông báo kèm link sang Upload.

### 8.2 `GET /photos/:id` — Chi tiết
- `<img>` cùng srcset, `sizes="(max-width: 1600px) 100vw, 1600px"`, `loading="eager"`.
- Hiển thị title, alt, ngày tạo, version hiện tại, bảng variant (rộng × cao, bytes, link URL).
- Nút **Xóa**: `<form method="post" action="/photos/:id/delete">` có `confirm()` bằng JS.
- Link **Chỉnh sửa** (bonus).

### 8.3 `GET /upload` — Form upload
- `<input type="file" name="photos" accept="image/jpeg,image/png" multiple>`.
- Chọn file → mỗi file một dòng: thumbnail (object URL), tên, dung lượng, ô `title` (placeholder là tên file), ô `alt` có `required` và gợi ý "Mô tả nội dung ảnh, vd: Chó nằm dưới bàn". Ô `alt` để trống, không điền sẵn.
- Khi test, phải gửi được request thiếu alt để kiểm tra server. Ví dụ dùng supertest, hoặc thêm `?novalidate=1` để form bỏ kiểm tra phía client.
- Client kiểm tra trước số file ≤ 5 và dung lượng ≤ 10 MiB. Đây chỉ là gợi ý UX: server luôn kiểm tra lại, và client vẫn gửi được cả file vượt để test.
- Submit bằng `fetch('/api/uploads', { method: 'POST', body: formData })`. Không tự đặt header `Content-Type`.
- Hiển thị kết quả theo `index`: dòng thành công có link tới ảnh, dòng lỗi có message. Lỗi cấp request hiện thành banner.

### 8.4 `POST /photos/:id/delete`
Xem mục 9.1. Xong thì redirect `303` về `/`.

---

## 9. Xóa và dọn dẹp

### 9.1 Xóa ảnh
1. **Ẩn:** `UPDATE Photo SET status=DELETING, deletedAt=now() WHERE id=? AND status=PUBLISHED`. Từ lúc này gallery, trang chi tiết và media trả 404 cho ảnh đó.
2. **Dọn:** gọi `purgePhoto(id)` ngay trong request:
   - Xóa mọi `storageKey` của mọi version và `originalKey`.
   - Gặp `ENOENT` thì coi là đã xóa.
3. **Hoàn tất:** khi xóa hết không lỗi → `status=PURGED, purgedAt=now()`, đặt `purgedAt` cho mọi `PhotoVersion`.
   - Có file xóa lỗi → giữ `DELETING`. Lần cleanup sau sẽ thử lại.

### 9.2 `runCleanup()` — chạy lúc server khởi động, mỗi `CLEANUP_INTERVAL_MINUTES`, và bằng `npm run cleanup`
Mọi bước phải idempotent, chạy lại nhiều lần không sinh lỗi.

**Không dùng khóa giữa các tiến trình.** Trong cùng một tiến trình server, chỉ giữ cờ `running` để timer định kỳ không gọi chồng lên lượt đang chạy. CLI và server có thể cùng chạy `runCleanup`, và điều đó vô hại, vì mọi thao tác bên dưới đều idempotent.

1. **Hàng đợi dọn (`cleanup-queue/`):** mỗi key cần dọn lại là **một file JSON riêng**, không dùng journal chung. Lý do: với journal chung, `appendFile` của một request có thể đã mở file ngay trước lúc cleanup đổi tên nó, rồi ghi vào file mà cleanup sắp xóa, làm mất key.
   - **Ghi (`queue.enqueue(key, reason)`)** từ upload/edit khi `deleteKey` lỗi.
     1. Tên bản ghi: `<Date.now()>-<randomBytes(6).hex>`.
     2. `writeFile('cleanup-queue/<tên>.tmp', JSON.stringify({ key, reason, at }))`.
     3. `rename('<tên>.tmp', '<tên>.json')`. Đổi tên là nguyên tử, nên cleanup chỉ bao giờ thấy file `.json` đã ghi đủ nội dung.
     4. Nếu chính bước ghi hàng đợi cũng lỗi (vd đĩa đầy), ghi `console.error` với key, để còn dấu vết trong log. Bước 5 bên dưới vẫn bắt được file mồ côi.
   - Khi `purgePhoto` xóa file lỗi, luồng purge bỏ qua hàng đợi. Ảnh giữ `DELETING` để bước 3 thử lại.
   - **Xử lý** (trong `runCleanup`):
     1. `readdir('cleanup-queue')`, chỉ lấy các file `*.json`.
     2. Với mỗi bản ghi: đọc nội dung, gọi `deleteKey(key)`. **Đọc gặp `ENOENT`** (lượt cleanup khác đã xử lý xong hoặc đã đổi tên bản ghi giữa lúc `readdir` và lúc đọc) → bỏ qua bản ghi đó, không coi là lỗi.
     3. Xóa thành công hoặc gặp `ENOENT` → `unlink` bản ghi. Bản ghi đã bị lượt khác xóa (`ENOENT`) thì bỏ qua.
     4. Xóa vẫn lỗi → giữ nguyên bản ghi cho lượt sau.
     5. Bản ghi hỏng (JSON lỗi) → đổi tên thành `.bad` và ghi log, không chặn các bản ghi khác. Đổi tên gặp `ENOENT` (lượt khác đã xử lý) → bỏ qua.
   - Quy tắc chung: ở **mọi** thao tác trên bản ghi (đọc, `unlink`, đổi tên sang `.bad`), `ENOENT` đều nghĩa là lượt khác đã xử lý, nên bỏ qua. Mọi lỗi khác thì ghi log và giữ nguyên bản ghi.
   - File `*.tmp` cũ hơn 1 giờ (ghi dở do crash) → xóa.
   - Hai tiến trình cùng xử lý một bản ghi thì cả hai cùng xóa ảnh và cùng `unlink` bản ghi. Cả hai thao tác đều chấp nhận `ENOENT`, nên kết quả vẫn đúng. Không cần khóa, cũng không cần quy tắc "khóa cũ hơn 10 phút".
2. **File tạm:** xóa file trong `tmp/` có mtime cũ hơn 1 giờ.
3. **Ảnh `DELETING`:** gọi `purgePhoto` cho từng ảnh.
4. **Version cũ (bonus):** với mỗi `PhotoVersion` có `supersededAt` cũ hơn `VERSION_RETENTION_HOURS` và `purgedAt IS NULL`, xóa file variant rồi đặt `purgedAt`.
5. **File mồ côi:** thư mục `photos/<id>/v<n>` không có dòng `PhotoVersion` tương ứng, hoặc file `originals/<id>.png` không có `Photo`, và có mtime cũ hơn 1 giờ → xóa.
   - Ngưỡng 1 giờ để tránh xóa nhầm file của một upload hay edit đang chạy.
   - Bước này bắt được file sót lại khi server crash giữa lúc ghi file và commit.
6. In tóm tắt số file đã xóa ở mỗi bước. CLI in ra stdout để làm bằng chứng.

---

## 10. Bonus — chỉnh sửa ảnh

### 10.1 Nguyên tắc
- Mọi chỉnh sửa áp lên **bản gốc chuẩn hóa** `originals/<id>.png`, không áp lên variant.
- Client luôn gửi **toàn bộ** trạng thái chỉnh sửa, không gửi phần thay đổi.
- Thứ tự cố định: **xoay → lật ngang → crop**. Toạ độ crop tính trên ảnh **sau khi xoay và lật**, theo pixel thật.
- Variant sau chỉnh sửa không giữ EXIF (sharp mặc định đã bỏ).

### 10.2 Trang `GET /photos/:id/edit`
- Nguồn xem trước: `GET /photos/:id/edit/source` trả bản thu nhỏ của PNG gốc.
  - Cạnh dài ≤ 1600, WebP, sinh lúc request.
  - `Cache-Control: private, no-store`.
  - Không dùng variant `v1` làm nguồn vì nó có thể đã bị purge sau 24 giờ.
- Trang nạp sẵn `edits` của `currentVersion`, `originalWidth/Height` và `baseVersion = currentVersion`.
- Điều khiển: Xoay trái, Xoay phải (±90°), checkbox Lật ngang, kéo chuột trên canvas để chọn vùng crop, nút Bỏ crop, **Lưu**, **Khôi phục**.
- Canvas vẽ theo cùng thứ tự xoay → lật → crop.
- Toạ độ trên canvas đổi sang pixel thật: `real = round(canvas * (kích thước thật sau xoay) / (kích thước canvas))`, rồi kẹp vào trong biên ảnh.

### 10.3 API `POST /api/photos/:id/edits` (JSON)

```json
{ "baseVersion": 1, "rotate": 90, "flipH": true, "crop": { "x": 10, "y": 20, "width": 400, "height": 300 } }
{ "baseVersion": 3, "restore": true }
```

Kiểm tra (`validateEdits`), sai → `400 INVALID_EDITS`:
- `baseVersion` là số nguyên dương.
- `rotate` ∈ {0, 90, 180, 270}.
- `flipH` là boolean thật, không nhận chuỗi `"true"`.
- `crop` là `null` hoặc gồm các số nguyên `x, y ≥ 0`, `width, height ≥ 1`, với `x + width ≤ W'` và `y + height ≤ H'`. Ở đây `W'×H'` là kích thước sau khi xoay: khi rotate là 90 hoặc 270 thì hoán đổi rộng và cao.
- `restore: true` → bỏ qua `rotate`, `flipH`, `crop`, dùng `IDENTITY = { rotate: 0, flipH: false, crop: null }`. **`baseVersion` vẫn bắt buộc và vẫn được kiểm tra** như một lần Lưu thường. Khôi phục đi qua đúng luồng `saveVersion` và tạo version mới.

Ảnh không `PUBLISHED` → 404.

### 10.4 Lưu version (`saveVersion`)

1. **Cấp version:**
   ```js
   tx.photo.update({ where: { id, status: 'PUBLISHED' }, data: { nextVersion: { increment: 1 } } })
   ```
   Lấy `v = nextVersion mới - 1`. Mỗi lần lưu có một số version riêng, nên hai request đồng thời không ghi chung thư mục.
   Không tìm thấy dòng nào (ảnh không tồn tại hoặc không còn `PUBLISHED`) → `404 NOT_FOUND`, chưa có file nào để dọn.
2. **Render** (`renderEdits`), mỗi bước là một pipeline sharp riêng, truyền nhau bằng raw buffer:
   1. `sharp(png).rotate(rotate).raw().toBuffer({ resolveWithObject: true })`
   2. `sharp(buf, { raw }).flop(flipH).raw().toBuffer(...)` (bỏ qua bước này nếu `flipH = false`)
   3. `sharp(buf, { raw }).extract(crop)` (nếu có crop), rồi resize và xuất WebP theo `variantPlan` của kích thước sau crop.
   - Tách pipeline để tránh việc sharp tự sắp xếp lại thứ tự các phép trong cùng một pipeline.
3. Ghi variant vào `photos/<id>/v<v>/<w>.webp`.
4. **Transaction có điều kiện:**
   ```
   tx.photoVersion.create({ photoId, version: v, edits, width, height })
   tx.photoVariant.createMany(...)
   n = tx.photo.updateMany({ where: { id, status: PUBLISHED, currentVersion: baseVersion },
                             data: { currentVersion: v } }).count
   if n === 0 → throw NotApplied          // rollback: không để lại dòng nào của v
   tx.photoVersion.update({ where: { photoId_version: { photoId: id, version: baseVersion } },
                            data: { supersededAt: now() } })
   FAULT_INJECT === 'edit-db-after-write' (chỉ test) → throw
   ```
5. Lỗi bất kỳ ở bước 2–4 → xóa các file của `v` (lỗi xóa thì `queue.enqueue`). Ảnh đang hiển thị giữ nguyên.
   - `NotApplied`: đọc lại `Photo` **sau khi rollback** để biết lý do:
     - Không còn `PUBLISHED` (bị xóa trong lúc đang render) → `404 NOT_FOUND`.
     - Vẫn `PUBLISHED` nhưng `currentVersion ≠ baseVersion` (đã có lần Lưu/Khôi phục khác thắng) → `409 VERSION_CONFLICT`, kèm `currentVersion` mới để client tải lại.
   - Lỗi khác → `500 STORAGE_ERROR`.
   - Nếu ảnh bị xóa sau khi bước 4 đã commit: `purgePhoto` (mục 9.1) xóa mọi version, gồm cả `v`, nên không cần xử lý riêng.
6. Thành công → `200 { version: v, variants: [...] }`. Client chuyển về trang chi tiết.

Version cũ vẫn phục vụ được cho tới khi cleanup xóa nó, `VERSION_RETENTION_HOURS` (24 giờ) sau `supersededAt`. Thời hạn này ghi trong README.

---

## 11. Dữ liệu kiểm thử — `npm run fixtures`

Script dùng sharp sinh vào `test/fixtures/`:

| File | Cách tạo | Dùng cho |
|---|---|---|
| `photo.jpg` | 2000×1333, gradient + chữ | Upload JPEG, có đủ 3 variant |
| `photo.png` | 800×600 | Upload PNG, variant 320/800 |
| `small.png` | 200×150 | Đúng 1 variant 200 |
| `exif-rotated.jpg` | Pixel lưu ngang 1200×800 có mũi tên chỉ **sang trái**, EXIF `Orientation=6` (nghĩa là khi hiển thị phải xoay 90° theo chiều kim đồng hồ, nên sau chuẩn hóa ảnh thành 800×1200 và mũi tên chỉ **lên**), kèm GPS giả (vd 10°46′N 106°42′E) qua `withExif({ IFD3: ... })` | Xoay đúng hướng, mất GPS |
| `fake.jpg` | File text đổi đuôi | `NOT_IMAGE` |
| `truncated.jpg` | `photo.jpg` cắt bỏ 30% cuối | `CORRUPT` (chữ ký đúng nhưng giải mã lỗi) |
| `exactly-10mib.png` | PNG **hợp lệ**, đúng 10 485 760 byte (cách tạo bên dưới) | `ok: true` |
| `over-10mib.png` | PNG **hợp lệ**, đúng 10 485 761 byte | `TOO_LARGE` |
| `too-many-pixels.png` | 8000×5001 màu đơn (file nhỏ) | `TOO_MANY_PIXELS` |
| `max-pixels.png` | 8000×5000 | Đúng 40 triệu pixel, được chấp nhận |
| `too-tall.png` | 400×20000 (8 triệu pixel) | `UNSUPPORTED_DIMENSIONS` (variant 320 cao 16000 vẫn hợp lệ, nhưng variant 400 cao 20000 thì không) |
| `corners.png` | 400×300, bốn góc bốn màu (đỏ TL, xanh lá TR, xanh dương BL, vàng BR) | Test xoay/lật/crop |

**Cách tạo PNG hợp lệ có kích thước chính xác** (`makeExactPng(targetBytes)`):
1. Tạo ảnh nhiễu ngẫu nhiên khoảng 1800×1800 RGB bằng `sharp({ create })` từ raw buffer ngẫu nhiên, xuất PNG với `compressionLevel: 0`. Nhiễu gần như không nén được, nên file sẽ gần nhưng **dưới** `targetBytes` (≈ 9,7 MiB). Nếu file vượt `targetBytes` thì giảm kích thước rồi tạo lại.
2. Tính `pad = targetBytes - png.length`. Chèn **một chunk phụ hợp lệ** ngay trước chunk `IEND` (12 byte cuối file). Dùng chunk `tEXt`. Cấu trúc chunk gồm: 4 byte length (big-endian, chỉ tính phần data), 4 byte type `tEXt`, phần data, rồi 4 byte CRC32 tính trên **type + data**. Phần data đúng chuẩn PNG phải là `keyword` (1–79 ký tự Latin-1, vd `Comment`) + **một byte 0** + phần text Latin-1 (vd lặp ký tự `x`). Độ dài data = `pad - 12`, nên phần text dài `pad - 12 - keyword.length - 1` byte. Bắt buộc `pad ≥ 12 + keyword.length + 1`, nếu không thì giảm kích thước ảnh ở bước 1 rồi làm lại.
3. Kiểm tra lại: `buf.length === targetBytes`, và `sharp(buf).png().toBuffer()` không lỗi.

Decoder bỏ qua các chunk phụ, và sharp không giữ chúng ở đầu ra, nên ảnh vẫn hợp lệ và không mang metadata ra variant. Test `upload.limits` **phải** nhận `ok: true` cho `exactly-10mib.png`. Chấp nhận `CORRUPT` là không đạt, vì như vậy không chứng minh được file đúng ngưỡng thật sự upload được.

README phải ghi cách tạo toàn bộ fixture (lệnh `npm run fixtures` và bảng trên), để nhóm khác tái hiện được (speaker note slide 33). Toạ độ GPS trong fixture là giá trị giả lập dành riêng cho lớp, không phải vị trí cá nhân thật.

Request > 55 MiB: test tự dựng body stream (không cần file thật) để test cả trường hợp có `Content-Length` lẫn không có (chunked).

---

## 12. Kế hoạch kiểm thử

`npm test` = `node --test --test-concurrency=1 test/`. Các file test **chạy tuần tự** vì cùng dùng một DB test và mỗi test đều reset DB. Test cần chạy song song, như `edit.concurrent`, tự gửi hai request song song bên trong cùng một test.

**Mọi test upload phải gửi `alt` hợp lệ cho từng file**, trừ ca kiểm tra `ALT_REQUIRED`. Nếu thiếu alt, file giả, ảnh hỏng hay ảnh quá cỡ sẽ dừng ở bước 0 với `ALT_REQUIRED` và không bao giờ tới bước cần kiểm tra. Helper `uploadFiles(files, { alt = "Ảnh kiểm thử <index>" })` trong `test/helpers.js` tự điền alt mặc định.

- `NODE_ENV=test`, DB test riêng đọc từ `.env.test` (vd `photo_gallery_test`).
- `UPLOAD_ROOT` là thư mục tạm mới cho mỗi file test.
- Mỗi test reset DB. **Hàm reset phải từ chối chạy** (ném lỗi) nếu `NODE_ENV !== 'test'` hoặc tên database trong `DATABASE_URL` không chứa `test`. Điều này ngăn lỡ tay xóa DB dev.

| Test | Kiểm tra | Mục nghiệm thu |
|---|---|---|
| `upload.happy` | JPEG + PNG → 2 `Photo`, đúng số `PhotoVariant`; file tồn tại theo key; `results[i].index` đúng | Upload JPEG và PNG |
| `upload.mixed` | `photo.jpg` + `fake.jpg` + `truncated.jpg` + `photo.png` **thiếu alt** → chỉ index 0 ok, index 3 `ALT_REQUIRED`; alt đã lưu đúng là chuỗi người dùng nhập, không phải tên file; DB có 1 Photo; đĩa chỉ có file của ảnh đó; `tmp/` rỗng | Trộn file hợp lệ và file giả |
| `upload.limits` | `exactly-10mib.png` → `ok: true` kèm Photo và variant; `over-10mib.png` → `TOO_LARGE`; 40 triệu pixel qua, 40 000 001+ `TOO_MANY_PIXELS`; `too-tall` bị từ chối; không có bản ghi hay file của ảnh bị từ chối | Vượt ngưỡng byte hoặc pixel |
| `upload.request` | 5 file ok; 6 file → 400 `TOO_MANY_FILES` và **0 Photo, 0 file**; > 55 MiB có/không có `Content-Length` → 413 và 0 Photo; 0 file → 400; body hỏng → 400 | Phạm vi lỗi cấp request |
| `upload.fault` | `FAULT_INJECT=db-after-write` → `STORAGE_ERROR`, 0 Photo, `photos/` và `originals/` rỗng; giả lập `deleteKey` lỗi → có một bản ghi trong `cleanup-queue/` chứa key; `runCleanup` dọn sạch file ảnh và xóa bản ghi | DB lỗi sau khi ghi file |
| `exif` | Variant của `exif-rotated.jpg` có rộng < cao; mũi tên chỉ lên (kiểm tra màu pixel); `sharp(variant).metadata()` không có `exif`; PNG gốc cũng không có EXIF | Đúng hướng, không còn GPS |
| `media` | 200 kèm đúng `Content-Type` và `Cache-Control`; key sai định dạng, `../`, key không có trong DB → 404 | Content-Type và Cache-Control |
| `pages` | HTML gallery/chi tiết có `srcset`, `sizes`, `width`, `height`, `loading`, `alt` | DOM |
| `delete` | Xóa → status `PURGED`; mọi media cũ 404; thư mục `photos/<id>` và `originals/<id>.png` không còn; xóa lần 2 không lỗi | Khi dọn xong kho không còn file |
| `restart` | Tạo app, upload, đóng app, tạo app mới cùng DB và `UPLOAD_ROOT` → gallery và media vẫn 200 | Restart web server |
| `edit.render` | `corners.png` với từng tổ hợp rotate × flipH → màu ở 4 góc đúng như kỳ vọng; crop lấy đúng góc | Bonus |
| `edit.validate` | rotate 45, `flipH: "true"`, crop vượt biên → 400 | Bonus |
| `edit.version` | Lưu → v2 phục vụ được, `currentVersion=2`, `v1.supersededAt` được đặt; restore → v3 có edits = IDENTITY | Bonus |
| `edit.concurrent` | Hai request cùng `baseVersion=1` chạy song song (Lưu + Lưu, và Lưu + Khôi phục) → một 200, một 409; URL của version thua → 404; thư mục của nó bị xóa. Xóa ảnh trong lúc render (chặn `renderEdits` bằng một promise trong test) → 404 và thư mục version mới bị xóa | Bonus |
| `edit.fault` | `FAULT_INJECT=edit-db-after-write` → `currentVersion` không đổi, file của version mới bị xóa | Bonus |
| `cleanup.queue` | Hai `runCleanup()` chạy song song trên cùng hàng đợi → không lỗi, mọi key được dọn, hàng đợi rỗng; `enqueue` gọi trong lúc cleanup đang chạy → bản ghi đó vẫn còn hoặc đã được dọn đúng, không bao giờ mất; `deleteKey` vẫn lỗi → bản ghi được giữ; file `.tmp` cũ bị xóa; JSON hỏng → `.bad` | Nếu dọn thất bại, giữ danh sách key |
| `cleanup` | Version superseded quá hạn (giả lập bằng cách lùi `supersededAt`) → file bị xóa và `purgedAt` được đặt; thư mục mồ côi > 1 giờ bị xóa, < 1 giờ còn nguyên; chạy 2 lần liên tiếp không lỗi | Dọn bản cũ |

Kiểm tra thủ công bằng browser (ghi lại để làm bằng chứng):
- Tab Network khi upload multipart.
- Response header của media.
- Restart server thật rồi tải lại gallery.
- **Chọn variant:** dùng ảnh `photo.jpg` (có đủ 320/960/1600), tắt cache trong DevTools, đọc `img.currentSrc` và tab Network ở ba cấu hình sau:

| Cấu hình | Độ rộng ô ảnh (CSS px) | Kỳ vọng |
|---|---|---|
| Gallery, viewport 300 px, DPR 1 | ≈ 300 | `320.webp` |
| Gallery, viewport 1400 px, DPR 1 | ≈ 462 | `960.webp` |
| Trang chi tiết, viewport 1400 px, DPR 1 | ≈ 1400 | `1600.webp` |

  Không yêu cầu mọi độ rộng viewport đều cho URL khác nhau. Ví dụ ở DPR 1, ô rộng 375, 400 và 462 px đều chọn `960w`, và điều đó đúng. Mục tiêu nghiệm thu là gallery **không mặc định tải file lớn nhất**. Browser có thể chọn variant lớn hơn nếu bản đó đã có trong cache, vì vậy phải tắt cache khi kiểm tra.

---

## 13. Bằng chứng nộp

Mọi bằng chứng phải lấy từ **cùng một lần chạy**, và dùng **cùng một `photoId`** để nối response upload, dòng trong DB và key trong storage (speaker note slide 35, 37). Nếu có thông tin nhạy cảm như mật khẩu DB thì che đi.

- `npm run evidence:exif -- <file>`: in metadata của file bằng công cụ đọc metadata (`sharp(file).metadata()`, kèm `exif-reader` để giải mã EXIF nếu có). Chạy trên fixture gốc (thấy GPS và Orientation) rồi chạy trên variant đã lưu (không còn EXIF). Không suy luận việc mất EXIF chỉ từ giao diện.
- Kiểm tra `currentSrc` phải ghi kèm DPR (`window.devicePixelRatio`) và độ rộng viewport.
- Bằng chứng restart: dừng hẳn tiến trình server rồi chạy lại. **Không** xóa storage hay DB giữa hai lần.
- Bằng chứng lỗi DB: sau khi gây lỗi, liệt kê thư mục `UPLOAD_ROOT` (không chỉ đọc log), rồi chạy `npm run cleanup`.
- `npm run evidence:db`: in bảng `Photo` (id, title, status, currentVersion) và `PhotoVariant` (photoId, version, width × height, bytes, storageKey), cùng danh sách file thực tế trong `UPLOAD_ROOT` để đối chiếu.
- Checklist thư mục `evidence/`, đánh dấu từng mục trong `evidence/README.md` khi nộp. Ghi chú cùng một `photoId` chạy xuyên suốt các mục 1–4:

| # | File | Nội dung |
|---|---|---|
| 1 | `01-network-upload.png` | Tab Network: request multipart (header `Content-Type` có boundary, payload) và response kết quả từng file |
| 2 | `02-upload-response.json` | Response JSON của cùng request đó |
| 3 | `03-db.txt` | Output `npm run evidence:db`: Photo, PhotoVariant và key, kèm danh sách file thực trong `UPLOAD_ROOT` |
| 4 | `04-media-get.png` + `04-media-get.txt` | Response header của request **GET** media, không phải `HEAD` (`curl -I` gửi `HEAD`, nên không dùng). Lấy từ DevTools Network khi mở gallery: status 200, `Content-Type`, `Cache-Control`. Bản text lấy bằng `curl.exe -s -D - -o NUL <url>` (Windows) hoặc `curl -s -D - -o /dev/null <url>` |
| 5 | `05-exif-before.txt`, `05-exif-after.txt` | Output `npm run evidence:exif` trên `exif-rotated.jpg` (có GPS và Orientation) và trên variant đã lưu (không còn EXIF) |
| 6 | `06-currentsrc-*.png` | Ảnh chụp DevTools cho từng cấu hình ở mục 12, hiện rõ `img.currentSrc`, `window.devicePixelRatio`, độ rộng viewport và dòng Network tương ứng |
| 7 | `07-dom.png` | Elements panel: `<img>` có `srcset`, `sizes`, `width`, `height`, `loading`, `alt` |
| 8 | `08a-invalid-files.json`, `08b-invalid-files.json` | **Hai request riêng**, mỗi request ≤ 5 file để không chạm giới hạn cấp request: (a) `photo.jpg` + `fake.jpg` + `truncated.jpg`; (b) `photo.png` + `over-10mib.png` + `too-many-pixels.png` + một file thiếu alt. Mỗi response có kết quả riêng cho từng file. Kèm output `npm run evidence:db` sau mỗi request, chứng minh chỉ ảnh hợp lệ có bản ghi và file |
| 9 | `09-request-limits.txt` | 6 file hợp lệ → 400 `TOO_MANY_FILES`, > 55 MiB → 413, kèm số Photo trước và sau (không đổi) |
| 10 | `10-db-fault.txt` | Chạy với `FAULT_INJECT=db-after-write`: liệt kê `UPLOAD_ROOT` sau lỗi, rồi output `npm run cleanup`, rồi liệt kê lại |
| 11 | `11-restart.png` + `11-restart.txt` | Dừng hẳn server, chạy lại (không xóa DB hay storage), gallery và URL media vẫn 200 |
| 12 | `12-delete.txt` | Trước và sau khi xóa: status trong DB, request mới tới URL media → 404, thư mục không còn file |
| 13 | `13-env-example.txt` | Nội dung `.env.example`, không có credential thật |
| 14 | `14-bonus-*` (nếu làm bonus) | Trước và sau khi chỉnh sửa, URL `v1`→`v2`, response 409 khi lưu đồng thời |
- README gồm: cách chạy (`npm i`, `npm run fixtures`, `npx prisma migrate dev`, `npm run dev`, `npm test`), các giới hạn, bố cục storage, lựa chọn đánh dấu `PURGED` thay vì xóa bản ghi, thời hạn giữ version cũ 24 giờ, hành vi cache sau khi xóa, và phần ngoài phạm vi.

---

## 14. Task theo thứ tự

Mỗi task: code → test của task đó qua → chạy lại toàn bộ `npm test` → mới sang task sau.

| # | Task | Xong khi |
|---|---|---|
| T0 | Khung dự án: `package.json` + scripts, `.env.example`, `config.js`, schema Prisma đầy đủ (gồm `PhotoVersion`) + migration, `app.js`/`server.js`, layout EJS, `storage.js`, `ids.js`, test helpers | `npm run dev` mở được trang trống; `npm test` chạy được (0 test) |
| T1 | **Mốc đầu tiên:** upload 1 JPEG/PNG đi hết luồng form → `processImage` → file trên đĩa → DB → gallery + `/media` | Lần được một `photoId` qua cả 4 nơi; test `upload.happy` (1 file), `media`, `exif` qua |
| T2 | Đầy đủ `parseMultipart` + `validateImage` + `variantPlan`; kết quả theo index; `npm run fixtures`; form upload nhiều file trên UI | `upload.happy`, `upload.mixed`, `upload.limits`, `upload.request` qua |
| T3 | Dọn khi lỗi: `FAULT_INJECT`, `queue.js`, `runCleanup` bước 1, 2, 5, `npm run cleanup` | `upload.fault`, `cleanup.queue`, phần mồ côi của `cleanup` qua |
| T4 | Gallery responsive + trang chi tiết đúng mục 8 | `pages` qua (gồm ảnh 800 px chỉ có `320w, 800w` trong `srcset`); kiểm tra `currentSrc` thủ công theo bảng ở mục 12 |
| T5 | Xóa ảnh + `purgePhoto` + `runCleanup` bước 3 | `delete` qua |
| T6 | Test restart, `evidence:db`, README, thư mục `evidence/` cho phần cốt lõi | `restart` qua; README đủ mục 13 |
| T7 | Bonus backend: `validateEdits`, `renderEdits`, `saveVersion`, API edits, `/edit/source` | `edit.render`, `edit.validate`, `edit.version`, `edit.concurrent`, `edit.fault` qua |
| T8 | Bonus UI: trang edit với canvas, crop kéo chuột, Lưu/Khôi phục, xử lý 409 | Thủ công: xem trước khớp với kết quả lưu trên `corners.png` và một ảnh thật |
| T9 | Bonus: `runCleanup` bước 4 (version cũ), cập nhật README và bằng chứng | `cleanup` qua toàn bộ |
| T10 | Rà lại theo bảng nghiệm thu trong REQUIREMENTS.md, mục 4–5 | Mọi dòng nghiệm thu có test hoặc bằng chứng tương ứng |
| T11 | UI polish: gallery ô 4:3, thanh hành động ở trang chi tiết, header có `aria-current` | `npm test` qua; thuộc tính `<img>`, `sizes`, breakpoint không đổi |
| T12 | Tách storage (§15.3–15.5): interface `ObjectStore` + driver `local`, kho nháp riêng, sửa mọi nơi gọi, helper test không phụ thuộc driver | Toàn bộ test qua với `STORAGE_DRIVER=local`; hành vi không đổi; `storage.contract` qua với driver `local` |
| T13 | Driver `s3` + SeaweedFS (§15.4, 15.6–15.8): `docker-compose.yml`, cấu hình, bucket riêng cho mỗi test, test contract và test S3 ngừng hoạt động | `npm run storage:up` rồi `npm test` qua toàn bộ với `STORAGE_DRIVER=s3`; ảnh upload thấy được trong filer UI của SeaweedFS |
| T14 | Bằng chứng và tài liệu (§15.9–15.11): `evidence:db` liệt kê object, README, `.env.example`, checklist mục 15–16, kiểm tra hai web server | Hai server cùng DB và bucket thấy ảnh của nhau; README đủ để dựng từ đầu |

---

## 15. Object storage (SeaweedFS)

Thay đổi theo yêu cầu của giảng viên: Photo Gallery có nhiều người đăng ảnh, nên ảnh phải nằm trong **object storage dùng chung** thay vì ổ đĩa của một web server. Mục này **thay thế** những chỗ nói "local filesystem" ở §4, §7, §9.2 bước 5, §12, §13. Phần còn lại của spec giữ nguyên.

### 15.1 Lý do và phạm vi

- Ổ đĩa riêng gắn với một máy: chạy thêm web server B thì B không đọc được ảnh mà A đã ghi, và dung lượng bị giới hạn ở một ổ đĩa (slide 19). Bucket S3 là kho chung mà mọi web server đọc và ghi qua HTTP API.
- **SeaweedFS** là lựa chọn slide 21 đề xuất, chạy bằng Docker, miễn phí, không cần tài khoản. Code chỉ dùng S3 API, nên đổi sang Cloudflare R2 hay dịch vụ S3 khác chỉ cần sửa `.env` (§15.11).
- **Storage key không đổi** (`photos/<id>/v<n>/<w>.webp`, `originals/<id>.png`). DB, schema Prisma và URL `/media/<key>` giữ nguyên. Chỉ thay nơi lưu bytes.
- Không làm: CDN, presigned URL, bucket public cho browser tải trực tiếp (§15.5 giải thích), chuyển dữ liệu cũ từ ổ đĩa sang bucket (§15.10).

### 15.2 Hai loại kho

| Kho | Prefix | Nơi lưu | Vì sao |
|---|---|---|---|
| **Object store** (dùng chung) | `photos/`, `originals/` | Bucket S3 (driver `s3`), hoặc `UPLOAD_ROOT` (driver `local`) | Ảnh đã công bố và PNG gốc phải đọc được từ mọi web server |
| **Kho nháp** (riêng từng server) | `tmp/`, `cleanup-queue/` | Luôn là đĩa local, trong `UPLOAD_ROOT` | File tạm của một request và hàng đợi dọn của một server không cần chia sẻ. Giữ nguyên thiết kế §6.3 và §9.2 bước 1 |

- Driver chọn **một lần lúc khởi động** bằng `STORAGE_DRIVER=s3|local`. Bản nộp dùng `s3`. Driver `local` chỉ để chạy nhanh khi không có Docker và để chạy test contract.
- **Không bao giờ tự chuyển sang local khi S3 lỗi.** Làm vậy file sẽ nằm rải ở hai nơi (speaker note slide 21). S3 lỗi thì trả lỗi và dọn dẹp như mọi lỗi lưu trữ khác.

### 15.3 Interface `ObjectStore` (`src/storage/objectStore.js`)

```js
put(key, body /* Buffer */, { contentType })   → Promise<void>
getStream(key)  → Promise<{ body /* Readable */, contentLength, contentType, lastModified /* Date */ }>
getBuffer(key)  → Promise<Buffer>
delete(key)     → Promise<void>          // idempotent: key không tồn tại vẫn thành công
list(prefix, { pageSize } = {})  → AsyncIterable<{ key, size, lastModified /* Date */ }>  // tự phân trang
ensureReady()   → Promise<void>          // kiểm tra kết nối, tạo bucket nếu chưa có
describe()      → { driver: 's3', endpoint, bucket } | { driver: 'local', root }   // không bao giờ chứa key bí mật
```

- Mọi hàm kiểm tra key bằng đúng regex hiện có (`variantKeyPattern`, `originalKeyPattern`). Key sai → lỗi `code: 'INVALID_KEY'`, không gửi request nào.
- **Chuẩn hóa lỗi:** object không tồn tại → `code: 'NOT_FOUND'` ở cả hai driver (`NoSuchKey`/404 của S3, `ENOENT` của local). Lỗi khác giữ nguyên. Nơi gọi đổi thành `STORAGE_ERROR` như hiện nay.
- `delete` không cho biết object có tồn tại trước đó hay không (S3 không trả thông tin này). Các bộ đếm trong output cleanup (`deletedPhotoFilesRemoved`, …) từ nay nghĩa là **số key đã xử lý**. README ghi rõ.
- **Kho nháp** (`src/storage/scratch.js`) giữ các hàm hiện có cho `tmp/` và `cleanup-queue/`: `keyToPath`, `writeFile`, `deleteKey`, `listDir`. Hàm `keyToPath` **chỉ** nhận key `tmp/` và `cleanup-queue/`. Gọi nó với key `photos/` hay `originals/` là lỗi lập trình và phải ném lỗi.

### 15.4 Driver

**`local`**: lưu dưới `UPLOAD_ROOT`, giữ nguyên hành vi hiện tại (đường dẫn an toàn, xóa thư mục rỗng, thử lại `EPERM`/`EBUSY` trên Windows). `list` duyệt đệ quy thư mục, trả `lastModified` từ `mtime`. `contentType` suy ra từ đuôi file.

**`s3`**: dùng `@aws-sdk/client-s3`.

```js
new S3Client({
  endpoint: S3_ENDPOINT, region: S3_REGION, forcePathStyle: S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
  maxAttempts: 3,
  requestHandler: new NodeHttpHandler({ connectionTimeout: 2000, requestTimeout: 15000 })  // @smithy/node-http-handler
})
```

| Hàm | Lệnh S3 |
|---|---|
| `put` | `PutObject` với `ContentType`, `ContentLength` |
| `getStream` / `getBuffer` | `GetObject` |
| `delete` | `DeleteObject` (S3 trả thành công cả khi key không tồn tại) |
| `list` | `ListObjectsV2` lặp theo `ContinuationToken`, `MaxKeys = pageSize ?? 1000` |
| `ensureReady` | `HeadBucket`; 404 → `CreateBucket`; lỗi khác → ném lỗi "Không kết nối được object storage tại `<endpoint>`" |

Log lỗi S3 ghi `endpoint`, `bucket`, `key` và tên lỗi. **Không bao giờ** ghi access key hay secret.

### 15.5 Thay đổi theo từng phần

| Phần | Hiện tại | Sau khi đổi |
|---|---|---|
| `processImage` (upload) | `sharp(tmp).rotate().png().toFile(path)`; giữ chỗ bằng `fs.open(..., 'wx')` | `sharp(tmp).rotate().png().toBuffer({ resolveWithObject: true })` → `put(originalKey, png, { contentType: 'image/png' })`. Variant: `sharp(png).resize().webp().toBuffer()` → `put(..., 'image/webp')`. **Đẩy key vào `writtenKeys` trước khi `put`**, để `put` lỗi giữa chừng vẫn được dọn. Bỏ bước giữ chỗ vì ID ngẫu nhiên. |
| `saveVersion`, `/edit/source` | `fs.readFile(originalKey)` | `getBuffer(originalKey)`. `NOT_FOUND` + ảnh không còn `PUBLISHED` → 404 như hiện nay. |
| `/media/*` | `res.sendFile` | Giữ nguyên bước tra DB. Rồi `getStream(key)`, đặt `Content-Type: image/webp`, `Content-Length`, `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, rồi `stream.pipeline(body, res)`. Client ngắt giữa chừng → hủy stream S3. `NOT_FOUND` → 404, không có header cache, ghi log cảnh báo. Lỗi S3 khác trước khi gửi header → **502**, không có header cache. |
| `purgePhoto`, dọn version cũ | `storage.deleteKey` | `objectStore.delete`. Logic giữ `DELETING` / `purgedAt null` khi lỗi không đổi. |
| `cleanup-queue` | Xóa key bằng `storage.deleteKey` | Chọn kho theo prefix của key: `tmp/` → kho nháp; `photos/`, `originals/` → object store |
| `runCleanup` bước 5 (mồ côi) | Quét thư mục, dùng `mtime` | `list('photos/')`, nhóm theo `photos/<id>/v<n>/`. Xóa cả nhóm khi không có dòng `PhotoVersion` **và** mọi object trong nhóm có `lastModified` cũ hơn 1 giờ. `list('originals/')`: xóa khi không có `Photo` và cũ hơn 1 giờ. Tra DB theo lô (`findMany` theo danh sách id), không tra từng object. |
| `parseMultipart` | File tạm trên đĩa | **Không đổi** (kho nháp) |

**Vì sao ảnh vẫn đi qua web server, không cho browser tải thẳng từ bucket:** `/media` phải tra DB để trả 404 cho ảnh đã xóa, version chưa commit hoặc file mồ côi (§7), và phải đặt đúng `Cache-Control`. Bucket public hay presigned URL sẽ bỏ qua bước kiểm tra này. Cái giá là web server vẫn phải gửi bytes ảnh (speaker note slide 18). Giảm tải chỗ này là việc của CDN, nằm ngoài phạm vi.

**Bộ nhớ:** PNG gốc giờ nằm trong RAM trước khi `put`. Ảnh 40 triệu pixel có thể chiếm tới khoảng 120 MB. Upload vẫn xử lý tuần tự từng file (§6.4), nên mỗi request chỉ giữ một ảnh như vậy cùng lúc.

### 15.6 Cấu hình

Thêm vào `.env.example` (giá trị giả, không có credential thật):

```
STORAGE_DRIVER=s3
S3_ENDPOINT=http://localhost:8333
S3_REGION=us-east-1
S3_BUCKET=photo-gallery
S3_ACCESS_KEY_ID=replace-with-local-access-key
S3_SECRET_ACCESS_KEY=replace-with-local-secret-key
S3_FORCE_PATH_STYLE=true
# Khi STORAGE_DRIVER=s3, UPLOAD_ROOT chỉ chứa tmp/ và cleanup-queue/ của server này.
UPLOAD_ROOT=../gallery-uploads
```

- `.env.test`: `S3_BUCKET=photo-gallery-test`, các giá trị khác giống `.env`.
- `loadConfig`:
  - `STORAGE_DRIVER` chỉ nhận `s3` hoặc `local`.
  - Với `s3`, thiếu biến nào thì báo lỗi nêu đúng tên biến, không in giá trị.
  - Tên bucket đúng quy tắc S3: 3–63 ký tự `[a-z0-9-]`, bắt đầu và kết thúc bằng chữ hoặc số.
  - **Quy tắc giống `UPLOAD_ROOT` ở §3:** ở chế độ test, `S3_BUCKET` phải chứa `test` **và** khác `S3_BUCKET` của `.env`. Sai thì báo lỗi trước khi kết nối. Lý do giống hệt: cleanup ở chế độ test đối chiếu bucket với DB test, nên nếu dùng chung bucket dev nó sẽ xóa ảnh dev.

### 15.7 SeaweedFS chạy local

`docker-compose.yml` ở thư mục gốc dự án:

```yaml
services:
  seaweedfs:
    image: chrislusf/seaweedfs:<ghim một version cụ thể>
    command: server -dir=/data -s3 -s3.port=8333 -s3.config=/etc/seaweedfs/s3.json
    ports:
      - "8333:8333"   # S3 API
      - "8888:8888"   # Filer UI, xem object để chụp bằng chứng
    volumes:
      - seaweedfs-data:/data
      - ./seaweedfs/s3.json:/etc/seaweedfs/s3.json:ro
volumes:
  seaweedfs-data:
```

- `seaweedfs/s3.example.json` (commit): một identity với key giả, quyền `Read`, `Write`, `List`, `Tagging`, `Admin` (cần `Admin` để `CreateBucket`).
- `seaweedfs/s3.json` (**thêm vào `.gitignore`**): bản sao người dùng tự tạo, key khớp `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` trong `.env` và `.env.test`.
- Script: `npm run storage:up` = `docker compose up -d seaweedfs`; `npm run storage:down` = `docker compose stop seaweedfs`.
- Volume `seaweedfs-data` giữ object khi restart container. Đây là phần bằng chứng restart của bucket.
- **Người triển khai phải kiểm tra lại** cờ dòng lệnh, định dạng `s3.json` và cổng theo tài liệu SeaweedFS của đúng version đã ghim, rồi ghi version đó vào README.
- Server lúc khởi động gọi `ensureReady()`. Không kết nối được thì **dừng hẳn** với thông báo rõ ràng ("Chạy `npm run storage:up` trước"), không chạy tiếp ở trạng thái lỗi.

### 15.8 Kiểm thử

- `.env.test` dùng `STORAGE_DRIVER=s3`. `prepareTest` tạo **bucket riêng cho mỗi test**: `<S3_BUCKET>-<8 ký tự hex ngẫu nhiên>`. Sau test, xóa mọi object trong bucket rồi `DeleteBucket`. Kho nháp vẫn là thư mục tạm như hiện nay. Nhờ vậy các test không dùng chung dữ liệu, và chạy lại không bị rác từ lần trước.
- SeaweedFS chưa chạy → test đầu tiên dừng ngay với thông báo "SeaweedFS chưa chạy. Chạy: `npm run storage:up`", không để mỗi test tự chờ đến timeout.
- Helper test không phụ thuộc driver: `listObjectKeys(prefix)`, `readObject(key)`, `objectExists(key)`. Thay toàn bộ chỗ test đang dùng `storage.keyToPath` hoặc `listDir('photos'|'originals')`. Test mock lỗi xóa (`upload.fault`, `edit.fault`, `delete`, `cleanup`) mock `objectStore.delete` thay cho `storage.deleteKey`.
- Test mới:

| Test | Kiểm tra |
|---|---|
| `storage.contract` | Chạy **cùng một bộ** cho cả `local` và `s3`: `put` rồi `getBuffer` ra đúng bytes; `getStream` trả `contentLength`, `lastModified`; key không tồn tại → `NOT_FOUND`; `delete` hai lần không lỗi; `list` với `pageSize: 2` trên 5 object vẫn trả đủ 5 (kiểm tra phân trang); key sai định dạng → `INVALID_KEY` và không gửi request |
| `storage.s3-down` | Object store trỏ tới cổng không có ai nghe, timeout ngắn: upload 1 file → kết quả file `STORAGE_ERROR`, 0 Photo, `tmp/` rỗng, **không có file nào trong `UPLOAD_ROOT/photos` hay `originals`** (chứng minh không tự chuyển sang local). GET media khi S3 ngừng → 502, không có `Cache-Control`. |
| `media` (bổ sung) | Có dòng DB nhưng object đã bị xóa khỏi bucket → 404. Response stream đúng bytes và đúng `Content-Length`. |
| `restart` (bổ sung) | App mới cùng DB và **cùng bucket**, kho nháp mới → gallery và media vẫn 200 |
| `cleanup` (bổ sung) | Object mồ côi trong bucket: không có `PhotoVersion` và cũ hơn 1 giờ thì bị xóa, mới hơn thì giữ. Test giả lập "cũ" bằng cách truyền `now` vào `runCleanup` (thêm tham số `now = Date.now()`), không chờ thật. |

- `npm test` vẫn chạy tuần tự (`--test-concurrency=1`).

### 15.9 Kiểm tra nhiều web server

Đây là lý do chính của thay đổi, nên phải có bằng chứng:

1. Chạy hai server cùng DB và cùng bucket, mỗi server có kho nháp riêng:

```powershell
$env:PORT=3000; $env:UPLOAD_ROOT='../gallery-uploads-a'; npm start
```

```powershell
$env:PORT=3001; $env:UPLOAD_ROOT='../gallery-uploads-b'; npm start
```

2. Upload ảnh qua `http://localhost:3000/upload`.
3. Mở `http://localhost:3001/` và trang chi tiết của ảnh đó: ảnh hiện, GET media trả 200.
4. Xóa ảnh trên server 3001 → request mới tới `localhost:3000/media/...` trả 404.

Hai server cùng chạy cleanup định kỳ là an toàn: hàng đợi của mỗi server nằm riêng, các bước dọn trong DB và bucket đều idempotent (§9.2).

### 15.10 Dữ liệu cũ

Không viết script chuyển ảnh từ `../gallery-uploads` sang bucket. Dữ liệu dev hiện có chỉ là ảnh thử. Sau T13, làm sạch DB dev (`npx prisma migrate reset`, lệnh này **xóa toàn bộ dữ liệu dev**) và bắt đầu lại với bucket rỗng. Toàn bộ bằng chứng chụp lại sau T14, để mọi mục cùng một lần chạy.

### 15.11 Bằng chứng và tài liệu

Thay đổi trong checklist §13:

| # | Thay đổi |
|---|---|
| 03 | `evidence:db` liệt kê **object trong bucket** (key, size, lastModified) thay cho file trên đĩa, kèm dòng `describe()` (driver, endpoint, bucket) |
| 10 | Sau khi gây lỗi DB, liệt kê object trong bucket test, không liệt kê thư mục |
| 11 | Restart web server; thêm `docker compose restart seaweedfs` rồi GET lại cùng URL media → 200 (volume giữ dữ liệu) |
| 12 | Sau khi xóa, `evidence:db -- --photo <id>` không còn object nào dưới `photos/<id>/` và không còn `originals/<id>.png` |
| 13 | Thêm `seaweedfs/s3.example.json` (key giả) |
| **15 (mới)** | `15-bucket-objects.txt`: output liệt kê object của bucket dev. `15-seaweedfs-filer.png`: ảnh chụp filer UI `http://localhost:8888/buckets/photo-gallery/photos/<id>/v1/` (speaker note slide 37: nhóm dùng SeaweedFS nộp thêm ảnh hoặc log liệt kê object) |
| **16 (mới)** | `16-two-servers.png` + `.txt`: các bước §15.9, upload ở 3000, GET cùng URL media ở 3001 → 200 |

README:
- Mục cài đặt: `npm run storage:up`, tạo `seaweedfs/s3.json` từ bản mẫu, điền các biến `S3_*` vào `.env` và `.env.test`, version SeaweedFS đã ghim.
- Mục "Kho ảnh": hai loại kho, driver, lý do phục vụ ảnh qua web server, ý nghĩa mới của các bộ đếm cleanup.
- Bỏ "object storage" khỏi mục "Ngoài phạm vi".
- **Dùng Cloudflare R2 thay SeaweedFS** (tùy chọn, không cần sửa code): tạo bucket và API token trong dashboard, đặt `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `S3_REGION=auto`, cùng key của token. Ghi rõ: không commit key thật, và R2 có hạn mức miễn phí (10 GB/tháng) nên không chạy bộ test trên R2.

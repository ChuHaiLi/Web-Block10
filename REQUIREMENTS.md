# Photo Gallery end-to-end — Yêu cầu bài tập

Nguồn: https://pub.nndkhoa9.win/web/week9/block10-photo-gallery-deck.html (slide 31–41; ngữ cảnh từ slide 3–30).

## 1. Sản phẩm cần hoàn thành
- Form upload nhận 1 đến 5 ảnh trong một request (multipart/FormData; các file dùng chung tên trường `photos`, kèm trường text như `title`).
- Server sinh variant và lưu metadata theo từng file.
- Gallery responsive, có trang chi tiết và thao tác xóa.
- Local filesystem giữ file sau khi restart web server.

## 2. Dữ liệu kiểm thử cần chuẩn bị
- JPEG, PNG và ảnh có EXIF orientation.
- Ảnh có GPS trong EXIF (dùng tọa độ giả lập).
- File text đổi đuôi thành ảnh; file ảnh bị thiếu bytes ở cuối.
- Ảnh vượt giới hạn dung lượng hoặc số pixel.

## 3. Yêu cầu cốt lõi
1. Response trả kết quả riêng cho từng file (gắn với index của file trong request).
2. Ảnh hợp lệ được chuẩn hóa (xoay pixel theo EXIF rồi bỏ EXIF, gồm GPS) và sinh tối đa 3 variant WebP: 320 / 960 / 1600 px, giữ tỉ lệ gốc.
3. DB lưu storage key (vd `photos/p01/960.webp`), không lưu đường dẫn tuyệt đối, không lưu bytes ảnh.
4. Gallery dùng `srcset`, `sizes`, `width`, `height`, `loading`, `alt`.
5. Xóa ảnh: ẩn khỏi gallery → xóa mọi variant (và bản gốc nếu có) → xóa metadata hoặc đánh dấu đã dọn.

### Giới hạn tài nguyên
| Giới hạn | Giá trị | Hành vi |
|---|---|---|
| Số file | 1 đến 5 | Kết quả theo từng index |
| Mỗi file | Tối đa 10 MiB | File vượt ngưỡng không được lưu |
| Tổng request | Tối đa 55 MiB | Server trả 413 |
| Số pixel | Tối đa 40 triệu | Từ chối trước khi giải mã toàn bộ |

### Kiểm tra ảnh
- Giới hạn bytes: dừng nhận khi file hoặc request vượt ngưỡng.
- Nhận dạng: đối chiếu chữ ký file với JPEG hoặc PNG.
- Giới hạn pixel: kiểm tra rộng × cao trước khi giải mã toàn bộ.
- Giải mã: từ chối ảnh hỏng dù chữ ký đúng.

### Phạm vi lỗi
- Cấp request (sai cấu trúc, quá số file, quá tổng bytes): không công bố ảnh nào.
- Cấp file (hỏng, vượt giới hạn riêng): từ chối file đó, giữ kết quả file hợp lệ.

### Mô hình dữ liệu
- `Photo`: tiêu đề, alt text.
- `PhotoVariant`: width, height, MIME, số bytes, storage key. Một Photo có một PhotoVariant cho mỗi chiều rộng đã tạo.
- Storage: thư mục gốc đặt ngoài source code, trên ổ đĩa bền vững; web server ánh xạ storage key vào thư mục gốc để tạo URL.

### Luồng ghi và xử lý lỗi
Kiểm tra + tạo `photoId` → sinh variant → ghi đủ file → ghi metadata trong DB transaction → commit → trả thành công.
Transaction DB không hoàn tác file đã ghi, nên phải tự dọn:

| Điểm lỗi | Metadata | File |
|---|---|---|
| Kiểm tra / giải mã | Không ghi | Xóa file tạm |
| Sinh / ghi variant | Không ghi | Xóa variant đã tạo |
| Transaction DB thất bại | Hủy thay đổi | Xóa các file vừa ghi |
| Commit thành công | Đủ bản ghi | Giữ đủ variant |

### Phân phối media
- `Content-Type: image/webp`, `Cache-Control: public, max-age=31536000, immutable`.
- Nội dung ảnh đổi thì gallery dùng URL mới.
- Ví dụ `<img>`: `src`, `srcset="…320.webp 320w, …960.webp 960w, …1600.webp 1600w"`, `sizes="(max-width: 600px) 100vw, 33vw"`, `width`, `height`, `loading="lazy"`, `alt`.

## 4. Nghiệm thu

### Upload
| Thao tác | Kết quả cần quan sát |
|---|---|
| Upload JPEG và PNG | Có Photo và các PhotoVariant tương ứng |
| Trộn file hợp lệ và file giả | Chỉ file hợp lệ được lưu |
| Vượt ngưỡng byte hoặc pixel | Không lưu bản ghi hay file của ảnh bị từ chối |
| DB lỗi sau khi ghi file | Xóa file mới, hoặc lưu key để dọn lại |
| Restart web server | Gallery và URL media vẫn hoạt động |

### Hiển thị
- Network cho thấy gallery tải variant phù hợp, không mặc định tải file lớn nhất.
- Response media có đúng Content-Type và Cache-Control.
- DOM có `srcset`, `sizes`, `width`, `height`, `loading`, `alt`.
- Ảnh sau xử lý hiển thị đúng hướng và không còn tọa độ GPS trong EXIF.
- Khi dọn xong, kho không còn file; DB xóa bản ghi hoặc đánh dấu đã dọn.

## 5. Bằng chứng nộp
- Network của multipart request, response từng file và GET media.
- Truy vấn Photo, PhotoVariant và danh sách key tương ứng.
- Kết quả kiểm tra file giả, file thiếu bytes, ảnh vượt giới hạn.
- Kết quả sau khi khởi động lại và sau khi dọn file do lỗi lưu.
- Cấu hình mẫu cho nơi lưu ảnh, không chứa thông tin xác thực thật.

## 6. Bonus: chỉnh sửa ảnh (tùy chọn)
- Mỗi lần chỉnh sửa bắt đầu từ bản gốc đã chuẩn hóa (không từ variant đã nén) → phải giữ bản gốc chuẩn hóa trong kho.
- Browser xem trước, rồi gửi thông số; server kiểm tra thông số rồi tạo variant mới; variant sau chỉnh sửa không giữ EXIF.
- Phép chỉnh sửa: crop (vùng chữ nhật hợp lệ trong ảnh gốc), xoay (chỉ 0/90/180/270), lật ngang (boolean), khôi phục (sinh lại từ bản gốc chuẩn hóa).
- Version: ghi variant dưới `photos/p01/v2/` → thêm PhotoVariant của version mới → cập nhật `currentVersion` khi đủ file + metadata → dọn bản cũ theo thời hạn ghi trong README.

## 7. Yêu cầu bổ sung từ speaker notes

Deck có ghi chú của giảng viên (speaker notes, mở bằng presenter view). Các ghi chú này bổ sung yêu cầu không có trên mặt slide:

**Phạm vi (slide 32)**
- Ứng dụng mới, không phụ thuộc Restaurant App hay Books.
- Không có tài khoản, album, bình luận, chia sẻ.
- Nghiệm thu qua request thật và trạng thái lưu, không chỉ qua ảnh chụp giao diện.

**Dữ liệu kiểm thử (slide 33)**
- Ảnh có vị trí phải dùng dữ liệu dành riêng cho lớp, không chứa vị trí cá nhân thật.
- Ảnh vượt pixel có thể nhỏ về dung lượng, nên cần một ca riêng.
- **Ghi lại cách tạo dữ liệu kiểm thử để nhóm khác tái hiện được.**

**Yêu cầu cốt lõi (slide 34)**
- Ảnh gốc nhỏ hơn ngưỡng thì có thể không sinh variant lớn hơn, nhưng width descriptor trong `srcset` phải đúng chiều rộng của file thật.
- **Alt text do người dùng nhập hoặc có trong dữ liệu, không mặc định bằng filename.**
- Một file lỗi không làm mất các file hợp lệ khác trong cùng request.
- **Mọi giới hạn và cách xử lý cleanup phải được công bố trong README.**

**Nghiệm thu upload (slide 35)**
- Dùng cùng `photoId` để nối response, dòng trong DB và key trong storage.
- Request multipart và response phải chụp từ tab Network.
- Khi gây lỗi DB, kiểm tra thư mục lưu file, không chỉ đọc log.
- Restart nghĩa là dừng rồi chạy lại web server, không xóa storage hay DB.

**Nghiệm thu hiển thị (slide 36)**
- Kiểm tra `currentSrc` ở **hai độ rộng viewport** và ghi lại DPR.
- **Dùng công cụ đọc metadata để kiểm tra EXIF**, không suy luận từ giao diện.
- Gửi request mới tới origin để không nhầm với response còn trong browser cache.
- Nếu dọn file thất bại, hệ thống phải giữ danh sách key để chạy lại.

**Bằng chứng nộp (slide 37)**
- Bằng chứng phải dùng dữ liệu của cùng một lần chạy để đối chiếu được.
- Che endpoint nội bộ hoặc credential nếu có.
- Nhóm dùng local storage vẫn đạt toàn bộ phần cốt lõi.

**Các slide lý thuyết có ý liên quan**
- Slide 8: không tự đặt `Content-Type` khi gửi `FormData` bằng fetch. `multiple` chỉ là UI, server vẫn phải kiểm tra số lượng và kích thước.
- Slide 12: các ngưỡng là giá trị của bài tập, phải công bố trong README. Phép nhân số pixel phải dùng kiểu số không bị tràn.
- Slide 15: tên file người dùng gửi chỉ dùng để hiển thị sau khi làm sạch, không được ghép vào đường dẫn lưu.
- Slide 21: tự động chuyển sang local khi S3 lỗi có thể làm file nằm rải ở hai nơi. Phải trả lỗi.
- Slide 22: gallery chỉ thấy bản ghi sau khi DB commit.
- Slide 24: không xóa metadata trước khi xóa file. Thao tác xóa phải chạy lại được kể cả khi file đã mất. Gallery không liệt kê ảnh đang chờ dọn.
- Slide 39–41 (bonus): không cắt tiếp từ WebP của lần trước. Server từ chối vùng crop nằm ngoài ảnh. Request không hợp lệ không được thay đổi ảnh đã công bố. Không ghi đè file `v1`. Hai lần chỉnh sửa đồng thời phải có version riêng và điều kiện khi cập nhật `currentVersion`. Dọn file cũ thất bại thì lưu key để chạy lại.

## 8. Ghi chú / điểm cần chốt
- Deck không chỉ định tech stack. Cần thư viện ảnh hỗ trợ xoay theo EXIF, bỏ EXIF, xuất WebP (vd sharp, Pillow).
- Object storage (SeaweedFS, MinIO, S3-compatible) chỉ là tùy chọn; bài cốt lõi dùng ổ đĩa local.
- Chọn "xóa hẳn metadata" hay "đánh dấu đã dọn" và ghi rõ trong README.
- Cần fixture/script sinh bộ ảnh kiểm thử (file giả, thiếu bytes, vượt pixel, EXIF GPS).

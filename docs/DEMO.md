# Kịch bản demo

Hai cảnh. Cảnh 1 là bắt buộc, cảnh 2 dùng lại đúng cấu hình quorum của cảnh 1 nên tốn ít công hơn.

## Chuẩn bị (làm trước, không làm trên sân khấu)

1. `npm run init` xong, 4 tài khoản đã link Tide: `admin`, `admin2`, `admin3`, `nhanvien`.
2. Mỗi tài khoản mở trong **một browser profile riêng**. Quorum tính theo admin và một admin chỉ
   được tính một lần, nên hai lần ký trong cùng session không làm đủ ngưỡng.
3. Đăng nhập `admin` → `/admin/setup` → ký cả hai policy. Kiểm tra cả hai hiện **đã ký**.
4. `npm run dev` đang chạy.

Kiểm tra nhanh trước khi lên: `/governance` ở tài khoản admin **không** hiện cảnh báo
"IGA đang TẮT". Nếu IGA tắt thì mọi thứ còn lại vô nghĩa — thay đổi quyền có hiệu lực ngay.

---

## Cảnh 1 — Nới quy tắc che (bắt buộc)

**Điều cần chứng minh:** một quản trị viên, kể cả người quyền cao nhất trong app, không thể một
mình nới quy tắc che.

| # | Làm gì | Khán giả thấy gì |
|---|---|---|
| 1 | Vào `/` ở profile `nhanvien`, bấm **Dùng ví dụ mẫu** | Ô xem trước: `[SĐT_1]`, `[EMAIL_1]`, `[CCCD_1]`, `[THE_CARD_1]` thay cho dữ liệu thật |
| 2 | Chỉ vào bảng *Quy tắc che đang áp dụng cho bạn* | SĐT/email: "nới được bằng role `ai_export_contact`". CCCD/thẻ: "không role nào nới được — kể cả quản trị viên" |
| 3 | Bấm **Gửi cho AI** | Banner xanh: *máy chủ tính lại và ra đúng bản xem trước*. Khối "Nội dung máy chủ đã gửi đi" là bản đã che |
| 4 | Sang profile `admin` → `/governance`, chọn `nhanvien`, bấm **Đề xuất cấp** ở dòng `ai_export_contact` | Thông báo: *đã đề xuất, nhưng CHƯA có hiệu lực* |
| 5 | Vẫn ở `admin`: bấm **Ký phê duyệt** trên yêu cầu đó | Popup enclave của Tide. Sau khi ký: **1/2 đã ký** — *chưa đủ quorum, cần admin khác ký tiếp* |
| 6 | **Đây là điểm chốt.** Bấm lại lần nữa cùng tài khoản | Không tăng. Một admin đếm một lần. Không có đường nào đi tiếp từ máy này |
| 7 | Sang profile `admin2` → `/governance` → **Ký phê duyệt** | Popup enclave thứ hai, của người khác. Đủ quorum → *thay đổi đã được áp dụng* |
| 8 | Về profile `nhanvien`: **đăng xuất rồi đăng nhập lại** (token phải mang role mới) | Banner đỏ trên `/` : tài khoản đang giữ `ai_export_contact`. Gửi lại ví dụ mẫu: SĐT và email đi **nguyên văn**, còn CCCD và thẻ **vẫn bị che** |

Bước 8 là phần hay bị bỏ: nó cho thấy việc nới là **có giới hạn** — quorum nới được cái đã định
trước là nới được, và không nới được cái không ai được phép nới.

> Nếu bước 8 chưa thấy role mới: token chưa cập nhật. Đăng xuất/đăng nhập lại, hoặc đợi tới 120s.

---

## Cảnh 2 — Mở lịch sử đã mã hóa

**Điều cần chứng minh:** lịch sử nằm đó dưới dạng mã, và *chính người quản trị* cũng không mở được
một mình.

| # | Làm gì | Khán giả thấy gì |
|---|---|---|
| 1 | Profile `nhanvien` → `/history` | Các bản ghi, nội dung là chuỗi mã. Metadata rõ: ai, khi nào, quy tắc nào đã bắn |
| 2 | Profile `admin` → `/history` | Banner vàng: không có `ai_log_reader` nên **chỉ thấy bản mã của chính mình**, dù là `tide-realm-admin` |
| 3 | Bấm **Giải mã** trên một bản ghi | Bị từ chối, kèm lý do thật từ contract — không phải "service unavailable" |
| 4 | `/governance` → chọn `admin`, đề xuất **cả hai**: `ai_log_reader` và `_tide_decryptor` | Hai yêu cầu đang chờ |
| 5 | `admin` ký, rồi `admin2` ký (hai yêu cầu, nên bốn lần ký) | Lần lượt đủ quorum và được áp dụng |
| 6 | `admin` đăng xuất, đăng nhập lại, vào `/history` → **Giải mã** | Mở ra nội dung thật, trong **trình duyệt của admin**. Server vẫn chỉ có bản mã |

Câu nên nói ở bước 6: *"Nó mở được không phải vì app cho phép, mà vì mạng Tide xác nhận credential
này mang role mà policy chỉ định. App không có khóa để lách, và chính tôi vừa phải xin hai người
đồng ý mới có role này."*

---

## Câu hỏi hay bị hỏi

**"Thế admin đi sửa code app thì sao?"**
Sửa được code thì che được UI, nhưng không lấy được khóa: khóa không tồn tại nguyên vẹn ở bất kỳ
đâu app chạm tới. Mở lịch sử cần mạng ORK đồng ý, và nó chỉ đồng ý với credential mang role mà
policy chỉ định. Nới quy tắc thì phải cấp role, mà cấp role là change request cần quorum.

**"Admin vào thẳng Admin Console của TideCloak thì sao?"**
Vẫn là change request, vẫn cần quorum — IGA bật ở mức realm, không phải ở mức app. Panel
`/governance` chỉ là một giao diện khác cho cùng cái API đó.

**"Thế còn dữ liệu nằm ở phía nhà cung cấp AI?"**
Ngoài phạm vi, và nên nói thẳng. Cái này bảo đảm **lịch sử công ty lưu**. Phía nhà cung cấp phụ
thuộc hợp đồng với họ. Điều app làm được là: họ chỉ bao giờ nhận bản đã che.

**"Có cần 3 admin không? 2 được không?"**
Không. Ngưỡng là `max(1, floor(0.7 × số admin))`, nên 2 admin cho ngưỡng 1 — một người vẫn tự
quyết. 3 admin mới ra ngưỡng 2.

---

## Nếu có sự cố

| Hiện tượng | Nguyên nhân thường gặp |
|---|---|
| Đăng nhập lỗi `TIDE-SWE-UNHANDLED` | Trang relay DPoP. Chạy `bash .tide-pack/templates/shared/tide-doctor.sh --url http://localhost:3000` |
| Ký phê duyệt ra `409` | Admin này đã ký rồi, hoặc yêu cầu không còn `PENDING`. Dùng admin khác |
| Giải mã ra `THRESHOLD_FAILURE` | Thường **không** phải mất mạng: contract từ chối. Lý do thật nằm trong `cause`, app đã bóc ra hiển thị |
| `/admin/setup` báo thiếu `vendorId` | Realm chưa license xong. Chạy lại `npm run init` cho hết, export lại adapter |
| Role đã cấp mà app chưa thấy | Token chưa cập nhật. Đăng xuất/đăng nhập lại; có thể chậm tới 120s |
| Ký policy báo không biết contract | Mạng ORK chưa có `RelationshipAttestation:1`. Hỏi Tide team — **không** tự viết contract thay |

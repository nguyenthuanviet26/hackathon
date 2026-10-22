# WorkSafe AI

Many companies ban AI because they cannot guarantee customer data stays safe. Existing tools can
redact data before it reaches the AI, but one administrator still holds every key: one person, or
one hijacked admin account, can quietly loosen the redaction rules or read everything employees
have sent to the AI. So companies ban AI outright, and staff use personal ChatGPT instead.

WorkSafe AI lets companies open AI to employees with confidence. Customer details are redacted
before sending; loosening the rules requires multiple administrators to approve through TideCloak;
and the stored AI history is encrypted, readable only after the same quorum approval. No single
admin can loosen the rules or quietly read the data.

---

## Cách nó hoạt động

Ba câu trong phần giới thiệu, mỗi câu được giữ bởi một cơ chế khác nhau — không câu nào chỉ là UI:

### 1. Che trước khi gửi, và xem trước đúng thứ AI nhận

`src/lib/redact.ts` tìm số điện thoại, email, CCCD/CMND và số thẻ. Trình duyệt chạy nó để **xem
trước**; `POST /api/ai/ask` **chạy lại** nó trên server, từ role trong JWT đã xác thực, và gửi đi
bản của chính nó. Trình duyệt có khai sai role hay gửi lên sẵn một bản "đã che" cũng không đổi được
gì — và nếu hai bản khác nhau, trang nói rõ bản server mới là bản thật.

### 2. Nới quy tắc = cấp một role = cần quorum admin

Một quy tắc không được nới bằng cách bật setting. Nó được nới bằng cách **giữ một role**:

| Quy tắc | Role nới được | Nới bằng cách nào |
|---|---|---|
| Số điện thoại, email | `ai_export_contact` | cấp role → yêu cầu thay đổi → đủ quorum admin ký |
| CCCD/CMND, số thẻ | *không có* | không ai nới được, kể cả `tide-realm-admin` |

Realm bật IGA, nên cấp role là một *change request*: TideCloak trả `202` và thay đổi **chưa** có
hiệu lực. Ngưỡng do TideCloak quyết định, không do app: `max(1, floor(0.7 × số tide-realm-admin))`.
Với 3 admin thì ngưỡng là **2** — nên bootstrap tạo 3 admin. Với 2 admin ngưỡng là 1, tức một người
vẫn tự quyết được, nên đừng demo quorum với 2 admin.

Mỗi admin ký trong **Tide enclave của chính họ**, trên trình duyệt của họ. Panel ở
`/governance` gọi TideCloak **trực tiếp từ trình duyệt** bằng token của admin đó, cố tình không đi
qua server của app: `approve` ghi công cho *ai gửi request HTTP*, nên nếu proxy qua server thì mọi
chữ ký đều được ghi dưới một danh tính và quorum sẽ **không bao giờ** đủ (AP-89).

### 3. Lịch sử mã hóa, mở cũng cần quorum

Mỗi lượt hỏi–đáp được mã hóa **trong trình duyệt nhân viên** rồi gửi bản mã lên. Server giữ bản mã
và metadata (ai, khi nào, quy tắc nào đã bắn) — **không bao giờ** giữ nội dung.

Dùng contract có sẵn trong ORK, `RelationshipAttestation:1`: không phải viết, biên dịch hay deploy
contract nào. Hai policy cho một record, admin ký mỗi cái **một lần** tại `/admin/setup`:

| Policy | Chủ thể | Cho phép | Nghĩa là |
|---|---|---|---|
| ghi | Role `appUser` | `_tide_encryptor` | mọi nhân viên ghi thêm được |
| đọc | Role `ai_log_reader` | `_tide_decryptor` | chỉ người giữ role đó mở được |

Vì chủ thể là **role**, sau khi ký admin ra khỏi vòng: ai đọc được lịch sử hoàn toàn do ai giữ
`ai_log_reader` quyết định — và cấp role đó lại là một change request cần quorum. Không có nút
"mở lịch sử" nào cho một admin bấm một mình: mạng ORK sẽ không giải mã cho credential không mang
role đó, và app không có khóa để lách.

**Phạm vi, nói thẳng:** đây là lịch sử **công ty lưu**. Nhà cung cấp AI giữ gì ở phía họ là chuyện
của hợp đồng với họ, không phải của code này.

---

## Chạy

Cần: Docker, Node 20+, `curl`, `jq`.

```bash
npm install
cp .env.example .env     # điền KC_BOOTSTRAP_ADMIN_PASSWORD, TIDE_LICENSE_EMAIL, TIDE_TERMS_ACCEPTED=yes
npm run init             # dựng TideCloak + realm; sẽ dừng ở các invite link
npm run dev
```

`npm run init` in ra **4 invite link** (3 admin + 1 nhân viên). Mở **mỗi link trong một browser
profile riêng**: quorum tính theo admin, một admin chỉ được tính một lần, nên ký hai lần trong cùng
một session không làm đủ ngưỡng.

Sau khi app chạy:

1. Đăng nhập `admin` → `/admin/setup` → ký **cả hai** policy (2 popup enclave). Làm sớm.
2. Đăng nhập `nhanvien` → `/` → thử gửi nội dung có dữ liệu khách hàng.

### Kiểm tra lại cấu hình

```bash
npm test                                                  # redaction engine
npm run typecheck
bash .tide-pack/templates/shared/tide-doctor.sh           # cấu hình Tide
bash .tide-pack/templates/shared/tide-doctor.sh --url http://localhost:3000
```

---

## Kịch bản demo

Xem [docs/DEMO.md](docs/DEMO.md) — hai cảnh, theo đúng thứ tự ưu tiên, kèm những gì cần kiểm chứng
trước khi nói thành câu khẳng định.

## Trạng thái: cái gì đã kiểm, cái gì chưa

| Phần | Trạng thái |
|---|---|
| Redaction engine | **Đã test** — 11/11 unit test, gồm cả ca role nới và ca không ai nới được |
| App build + typecheck | **Đã chạy** — `next build` sạch, `tsc --noEmit` sạch |
| Cấu hình Tide (DPoP, rewrite, CSP, verify server-side) | **tide-doctor PASS** |
| Realm, login, quorum, mã hóa | **CHƯA chạy** — cần Docker để `npm run init`; hai FAIL còn lại của tide-doctor (`jwk`, `vendorId`) là vì chưa có realm |
| `RelationshipAttestation:1` trên mạng ORK | **Giả định** — contract có trên ORK `main` từ 2026-10-16. Mạng cũ hơn thì ký policy sẽ lỗi; khi đó hỏi Tide team, **không** tự viết contract thay thế |

---

## Bố cục

```
src/lib/redact.ts            quy tắc che; chạy cả hai phía, server là bản thật
src/lib/log/record.ts         tên role/record mà app, realm và policy phải khớp nhau
src/lib/ai/model.ts           gọi AI (mock mặc định; cắm ANTHROPIC_API_KEY là gọi thật)
src/lib/policy/relationship.ts  dựng + ký policy RelationshipAttestation:1
src/lib/policy/aiLog.ts       hai policy của record log, và mã hóa/giải mã
src/lib/iga/client.ts         API change request, gọi từ trình duyệt admin (AP-89)
src/app/page.tsx              màn nhân viên: xem trước, gửi, tự mã hóa lịch sử
src/app/history/page.tsx      lịch sử mã hóa; giải mã được hay không do ORK quyết
src/app/governance/page.tsx   đề xuất nới quyền + ký phê duyệt (cảnh 1)
src/app/admin/setup/page.tsx  ký hai policy, một lần
scripts/init-tidecloak.sh     bootstrap: 3 admin + 1 nhân viên, đúng thứ tự trước "cửa một chiều"
scripts/realm.json.template   role của realm
```

Các file sau là của template Tide và không nên sửa nếu không có lý do nói ra được:
`next.config.ts`, `public/tide_dpop_auth.html`, `public/silent-check-sso.html`,
`src/app/auth/redirect/page.tsx`, `src/app/providers.tsx`, `src/lib/auth/*`.

# WorkSafe AI

[![Built with TideCloak](https://tide.org/badges/built-with-tidecloak.svg)](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked)

## Project overview

_WorkSafe AI is an internal AI gateway that redacts customer data before it reaches the model, and makes loosening those rules, or reading the AI history, need a quorum of administrators instead of one._

Built with [TideCloak](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked).

**Demo video:** [docs/WorkSafeAI_demo.mp4](docs/WorkSafeAI_demo.mp4) (2 min, real prototype footage in simulated mode)

### 1. Vision & originality

Companies either ban AI or trust one administrator with everything. WorkSafe AI makes each privacy rule something no single person can switch off: relaxing redaction, or opening the AI history, needs several admins to sign. National ID and card numbers cannot be unredacted by anyone.

### 2. Trust constraint insight

Redaction tools exist, but one admin, or one hijacked admin account, can quietly loosen the rules or read everything employees asked the AI. So security teams ban AI, and staff paste customer data into personal chatbots. Remove the single trusted admin and AI becomes approvable.

### 3. Value & impact

A customer-service agent drafts an apology to a customer, pasting their phone, email, ID and card number. The model only ever sees `[SĐT_1]`, `[EMAIL_1]`, `[CCCD_1]`, `[THE_CARD_1]`. Compliance gets an encrypted record that no admin can open alone. Employees get approved AI instead of shadow AI.

### 4. Why TideCloak matters

Every rule change is a TideCloak IGA change request. Each admin signs in their own Tide enclave with their own DPoP-bound token, so votes cannot be pooled. History is encrypted in the browser under a `RelationshipAttestation:1` policy, and the ORK network decrypts only for holders of `ai_log_reader`. Our app holds no key to misuse.

### 5. Prototype & storytelling

Tide licensing failed during the event, so the demo runs Plan C: TideCloak simulated with the same rules and API; the live integration switches on once a realm is licensed. Watch for: an admin proposes sending phone numbers raw and signs (1/2 seals). Signing again is refused. A second admin signs, and phone and email now pass, but ID and card stay masked.

## Setup

Needs Node 20+. No Docker is needed for the simulated mode used in the demo.

```bash
npm install
npm run dev          # http://localhost:3000, runs the TideCloak simulation (Plan C)
```

Sign in as `admin`, open **Thiết lập** and sign both policies. Then open `nhanvien`, `admin` and `admin2` in three separate browsers and follow [docs/DEMO.md](docs/DEMO.md).

Live TideCloak (needs Docker, `curl`, `jq`): `cp .env.example .env`, fill it in, then `npm run init`. Once the realm is licensed, `data/tidecloak.json` gains a `jwk` and the app switches to the real TideCloak with no code change.

---

_Tài liệu kỹ thuật chi tiết bên dưới viết bằng tiếng Việt._

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

## Chế độ mô phỏng TideCloak (Plan C)

Mạng Tide đang quá tải nên bước license realm có thể lỗi (`FinalizeWallet … 500`). Ban tổ chức cho
phép mô phỏng, và chấm bản mô phỏng ngang bản chạy thật. App **tự vào chế độ mô phỏng** khi
`data/tidecloak.json` không có `jwk` (tức là chưa có realm được license). Không cần Docker:

```bash
npm install
npm run dev        # tự tạo adapter giữ chỗ nếu chưa có → chế độ mô phỏng
```

Mỗi trang hiện banner vàng báo đang mô phỏng. Đăng nhập là chọn một trong 4 tài khoản `admin`,
`admin2`, `admin3`, `nhanvien`. Kịch bản demo giữ nguyên.

| Phần | Bản thật | Bản mô phỏng (`src/lib/sim/`) |
|---|---|---|
| Đăng nhập, role trong token | TideCloak | JWT do server app ký. Role mới chỉ có sau khi đăng nhập lại, giống bản thật |
| Cấp role = change request | IGA của TideCloak | Cùng API (`/admin/realms/…/iga/…`), cùng mã `202`/`409`/`412` |
| Quorum | `max(1, floor(0.7 × admin))`, mỗi admin một phiếu | Cùng công thức. Phiếu gắn với token của người ký, không dùng lại được dưới tên người khác |
| Ký trong enclave | Popup Tide | Hộp xác nhận ghi rõ ai đang ký |
| Mã hóa theo policy | Mạng ORK, contract `RelationshipAttestation:1` | ORK mô phỏng kiểm cùng điều kiện (tag, role chủ thể, `_tide_decryptor`), báo lỗi cùng câu chữ |
| **Giữ khóa** | **Chia cho nhiều node ORK, không máy nào giải mã một mình** | **Một file `data/sim/ork.key` trên server.** Đây là điểm duy nhất bản mô phỏng yếu hơn bản thật |

Các route `/api/sim/*` trả `404` khi realm thật đã được license, nên bản chạy thật không có cửa
"đăng nhập thành bất kỳ ai". Khi `npm run init` chạy được, nó ghi đè `data/tidecloak.json`, app tự
chuyển sang TideCloak thật mà không phải sửa code.

## Kịch bản demo

Xem [docs/DEMO.md](docs/DEMO.md) — hai cảnh, theo đúng thứ tự ưu tiên, kèm những gì cần kiểm chứng
trước khi nói thành câu khẳng định.

## Trạng thái: cái gì đã kiểm, cái gì chưa

| Phần | Trạng thái |
|---|---|
| Redaction engine | **Đã test** — 11/11 unit test, gồm cả ca role nới và ca không ai nới được |
| App build + typecheck | **Đã chạy** — `next build` sạch, `tsc --noEmit` sạch |
| Cấu hình Tide (DPoP, rewrite, CSP, verify server-side) | **tide-doctor PASS** |
| Realm, login, quorum, mã hóa (bản thật) | **CHƯA chạy được.** `npm run init` dừng ở bước license: mạng Tide trả `FinalizeWallet 500` |
| Login, quorum, mã hóa (bản mô phỏng) | **Đã chạy end-to-end qua API**, 25/25 bước theo kịch bản demo, gồm cả các ca bị từ chối (ký lại 409, dùng lại phiếu của admin khác, sửa policy, sai tag, thiếu role) |
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

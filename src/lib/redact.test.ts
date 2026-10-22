// Run: node --test src/lib/redact.test.ts
// Node strips the types itself; this needs no build step and no test framework.
import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, ruleStateFor } from "./redact.ts";

const EMPLOYEE: string[] = []; // a plain employee relaxes nothing
const LOOSENED = ["ai_export_contact"]; // after a quorum of admins approved the grant

test("a phone number is masked for a plain employee", () => {
  const r = redact("Khách hàng 0912345678 báo lỗi đơn hàng.", EMPLOYEE);
  assert.equal(r.redacted, "Khách hàng [SĐT_1] báo lỗi đơn hàng.");
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].ruleId, "phone");
  assert.equal(r.findings[0].passedThrough, false);
  assert.deepEqual(r.relaxed, []);
});

test("the same phone goes through raw once ai_export_contact is held", () => {
  const r = redact("Khách hàng 0912345678 báo lỗi đơn hàng.", LOOSENED);
  assert.equal(r.redacted, "Khách hàng 0912345678 báo lỗi đơn hàng.");
  assert.equal(r.findings[0].passedThrough, true);
  assert.equal(r.findings[0].viaRole, "ai_export_contact");
  assert.deepEqual(r.relaxed, ["phone"]);
});

test("a card number is never sent, not even with the loosening role", () => {
  const r = redact("Thẻ 4111 1111 1111 1111 bị khoá.", LOOSENED);
  assert.equal(r.redacted, "Thẻ [THE_CARD_1] bị khoá.");
  assert.equal(r.findings[0].ruleId, "card");
  assert.equal(r.findings[0].passedThrough, false);
});

test("a CCCD is never sent either", () => {
  const r = redact("CCCD 001234567890 của khách.", LOOSENED);
  assert.equal(r.redacted, "CCCD [CCCD_1] của khách.");
  assert.equal(r.findings[0].ruleId, "nationalId");
});

test("a card is not shredded into phone fragments (overlap priority)", () => {
  const r = redact("4111111111111111", EMPLOYEE);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].ruleId, "card");
});

test("each value of a kind gets its own numbered placeholder", () => {
  const r = redact("Gọi 0912345678 hoặc 0987654321.", EMPLOYEE);
  assert.equal(r.redacted, "Gọi [SĐT_1] hoặc [SĐT_2].");
});

test("emails are masked, and relaxed by the same role as phones", () => {
  assert.equal(
    redact("Mail an@vidu.vn giúp mình.", EMPLOYEE).redacted,
    "Mail [EMAIL_1] giúp mình."
  );
  assert.equal(
    redact("Mail an@vidu.vn giúp mình.", LOOSENED).redacted,
    "Mail an@vidu.vn giúp mình."
  );
});

test("mixed text keeps the absolute rules enforced while the relaxed one passes", () => {
  const r = redact("SĐT 0912345678, thẻ 4111111111111111, mail an@vidu.vn", LOOSENED);
  assert.equal(r.redacted, "SĐT 0912345678, thẻ [THE_CARD_1], mail an@vidu.vn");
  assert.deepEqual(r.relaxed.sort(), ["email", "phone"]);
});

test("findings never carry the full value", () => {
  const r = redact("0912345678", EMPLOYEE);
  assert.equal(r.findings[0].preview.includes("12345"), false);
  assert.match(r.findings[0].preview, /^09\*+678$/);
});

test("text with nothing sensitive is returned untouched", () => {
  const input = "Tóm tắt giúp mình quy trình đổi hàng.";
  const r = redact(input, EMPLOYEE);
  assert.equal(r.redacted, input);
  assert.deepEqual(r.findings, []);
});

test("ruleStateFor marks which rules a role relaxes and which are absolute", () => {
  const plain = ruleStateFor(EMPLOYEE);
  const loosened = ruleStateFor(LOOSENED);

  assert.equal(plain.find((r) => r.id === "phone")!.relaxed, false);
  assert.equal(loosened.find((r) => r.id === "phone")!.relaxed, true);

  // No role relaxes these, in either state.
  for (const state of [plain, loosened]) {
    assert.equal(state.find((r) => r.id === "card")!.absolute, true);
    assert.equal(state.find((r) => r.id === "card")!.relaxed, false);
    assert.equal(state.find((r) => r.id === "nationalId")!.absolute, true);
  }
});

test("a known customer name is redacted and no role relaxes it", () => {
  for (const roles of [EMPLOYEE, LOOSENED]) {
    const r = redact("Khách hàng Trần Thị Mai, SĐT 0912345678", roles);
    assert.match(r.redacted, /^Khách hàng \[KHACH_HANG_1\], SĐT /);
    assert.equal(r.findings[0].ruleId, "customer");
    assert.equal(r.findings[0].passedThrough, false);
  }
});

test("a name is only redacted as a whole word, and unknown names are left alone", () => {
  assert.equal(redact("Nguyen Minhthu gọi tới", EMPLOYEE).redacted, "Nguyen Minhthu gọi tới");
  assert.equal(redact("Anh Hoàng Long gọi tới", EMPLOYEE).redacted, "Anh Hoàng Long gọi tới");
  assert.equal(redact("nguyen minh gọi tới", EMPLOYEE).redacted, "[KHACH_HANG_1] gọi tới");
});

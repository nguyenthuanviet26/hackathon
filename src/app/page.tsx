"use client";

// The employee's screen. One job: make it impossible to send customer data to the AI by accident,
// and show exactly what will be sent before it is sent.
//
// The preview on this page is computed in the browser from the roles in the token. It is a
// courtesy, not the control — /api/ai/ask re-runs the same engine from the VERIFIED token and
// sends the result of its own run. When the two differ the page says so, loudly, and shows the
// server's version as the truth.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTideCloak } from "@/lib/tide";
import { redact, ruleStateFor, type Finding } from "@/lib/redact";
import { ROLE_EXPORT_CONTACT } from "@/lib/log/record";
import { fetchSignedPolicy, encryptTranscript, explainCryptoError, type PolicyState } from "@/lib/policy/aiLog";
import { Gate, Notice, Pill, RedactedText, Shell, btn, btnGhost, c, card, codeBox, input, mono, useWhoAmI } from "./ui";

interface AskResult {
  sentToModel: string;
  findings: Finding[];
  relaxed: string[];
  rolesUsed: string[];
  answer: string;
  mode: string;
  model: string;
  at: string;
}

const EXAMPLE =
  "Khách hàng Trần Thị Mai, SĐT 0912345678, email mai.tran@vidu.vn, CCCD 001234567890, " +
  "thẻ 4111 1111 1111 1111, phàn nàn đơn hàng #88213 giao chậm 5 ngày. " +
  "Viết giúp mình email xin lỗi và đề xuất bồi thường.";

export default function ConsolePage() {
  return (
    <Gate>
      <Shell>
        <Console />
      </Shell>
    </Gate>
  );
}

function Console() {
  const { secureFetch, doEncrypt, doDecrypt, getValueFromToken } = useTideCloak();
  const me = useWhoAmI();

  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logState, setLogState] = useState<string | null>(null);
  const [writePolicy, setWritePolicy] = useState<PolicyState | null>(null);

  // Roles straight from the token, for the preview only.
  const roles: string[] = useMemo(() => {
    const realmAccess = getValueFromToken("realm_access") as { roles?: string[] } | undefined;
    return Array.isArray(realmAccess?.roles) ? realmAccess!.roles! : [];
  }, [getValueFromToken]);

  const preview = useMemo(() => redact(prompt, roles), [prompt, roles]);
  const rules = useMemo(() => ruleStateFor(roles), [roles]);

  // The write policy for the AI-log record. Without it the transcript cannot be encrypted, so the
  // page says the history is not being recorded rather than silently dropping it.
  useEffect(() => {
    let alive = true;
    fetchSignedPolicy("write", secureFetch as never)
      .then((s) => alive && setWritePolicy(s))
      .catch(() => alive && setWritePolicy({ kind: "write", signed: false, policy: null, reason: "không đọc được policy" }));
    return () => {
      alive = false;
    };
  }, [secureFetch]);

  const send = useCallback(async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setLogState(null);

    try {
      const res = await secureFetch("/api/ai/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Máy chủ trả về HTTP ${res.status}`);
        return;
      }

      const ask = data as AskResult;
      setResult(ask);

      // Encrypt the transcript in THIS browser and store ciphertext. The server never holds the
      // plaintext of what was asked or answered.
      if (!writePolicy?.policy) {
        setLogState("Chưa lưu được lịch sử: policy ghi chưa được admin ký (/admin/setup).");
        return;
      }

      setLogState("Đang mã hóa lịch sử…");
      const transcript = JSON.stringify(
        { at: ask.at, prompt, sentToModel: ask.sentToModel, answer: ask.answer, model: ask.model },
        null,
        2
      );

      const ciphertext = await encryptTranscript(transcript, writePolicy.policy, {
        doEncrypt,
        doDecrypt,
      });

      const stored = await secureFetch("/api/log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ciphertext,
          rulesFired: [...new Set(ask.findings.map((f) => f.ruleId))],
          relaxed: ask.relaxed,
        }),
      });

      setLogState(
        stored.ok
          ? "Đã mã hóa và lưu vào lịch sử (chỉ ai có role ai_log_reader mở được)."
          : `Mã hóa xong nhưng lưu thất bại (HTTP ${stored.status}).`
      );
    } catch (err) {
      setError(explainCryptoError(err));
    } finally {
      setBusy(false);
    }
  }, [prompt, busy, secureFetch, writePolicy, doEncrypt, doDecrypt]);

  // Did the server redact the same way the preview said it would?
  const mismatch = result !== null && result.sentToModel !== redact(prompt, result.rolesUsed).redacted;

  return (
    <>
      <h1 style={{ marginTop: 0, marginBottom: "0.35rem" }}>Hỏi AI</h1>
      <p style={{ color: c.dim, marginTop: 0, marginBottom: "1.5rem" }}>
        Dữ liệu khách hàng được che trước khi rời khỏi công ty. Bạn xem trước đúng nội dung AI sẽ nhận.
      </p>

      {me.canExportContact && (
        <Notice tone="red">
          Tài khoản này đang giữ role <strong>{ROLE_EXPORT_CONTACT}</strong>: số điện thoại và email
          sẽ được gửi <strong>nguyên văn</strong>. Role này chỉ được cấp sau khi đủ số quản trị viên
          phê duyệt.
        </Notice>
      )}

      {writePolicy && !writePolicy.signed && (
        <Notice tone="amber">
          Lịch sử chưa được ghi: policy ghi cho record log chưa được ký. Một quản trị viên cần ký một
          lần tại <a href="/admin/setup" style={{ color: "inherit" }}>/admin/setup</a>. ({writePolicy.reason})
        </Notice>
      )}

      <div style={card}>
        <label style={{ display: "block", color: c.dim, fontSize: "0.88rem", marginBottom: "0.5rem" }}>
          Nội dung bạn muốn hỏi
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={6}
          placeholder="Dán nội dung có thông tin khách hàng vào đây…"
          style={{ ...input, resize: "vertical" }}
        />
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
          <button onClick={send} disabled={busy || !prompt.trim()} style={{ ...btn, opacity: busy || !prompt.trim() ? 0.5 : 1 }}>
            {busy ? "Đang gửi…" : "Gửi cho AI"}
          </button>
          <button onClick={() => setPrompt(EXAMPLE)} style={btnGhost}>
            Dùng ví dụ mẫu
          </button>
        </div>
      </div>

      <RuleLegend rules={rules} />

      {prompt.trim() && (
        <div style={card}>
          <h2 style={{ marginTop: 0, fontSize: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            Xem trước: đúng những gì AI sẽ nhận
            <Pill tone={preview.relaxed.length > 0 ? "red" : "green"}>
              {preview.findings.length} giá trị được tìm thấy
            </Pill>
          </h2>
          <div style={codeBox}>
            {preview.redacted ? <RedactedText text={preview.redacted} /> : <span style={{ color: c.dim }}>(trống)</span>}
          </div>
          {preview.findings.length > 0 && <FindingList findings={preview.findings} />}
        </div>
      )}

      {error && <Notice tone="red">{error}</Notice>}

      {result && (
        <>
          {mismatch ? (
            <Notice tone="red">
              Máy chủ đã che khác với bản xem trước. Bản máy chủ gửi đi mới là bản thật — nó được
              tính lại từ role trong token đã xác thực, không tin nội dung trình duyệt gửi lên.
            </Notice>
          ) : (
            <Notice tone="green">
              Máy chủ tính lại và ra đúng bản xem trước. Role máy chủ dùng:{" "}
              <code>{result.rolesUsed.filter((r) => r.startsWith("ai_") || r === "appUser").join(", ") || "(không có)"}</code>
            </Notice>
          )}

          <div style={card}>
            <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Nội dung máy chủ đã gửi đi</h2>
            <div style={codeBox}>
              <RedactedText text={result.sentToModel} />
            </div>
          </div>

          <div style={card}>
            <h2 style={{ marginTop: 0, fontSize: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              Trả lời <Pill>{result.mode === "mock" ? "mô phỏng" : result.model}</Pill>
            </h2>
            <div style={mono}>{result.answer}</div>
          </div>

          {logState && (
            <p style={{ color: c.dim, fontSize: "0.88rem" }}>
              {logState}{" "}
              {logState.startsWith("Đã mã hóa") && (
                <a href="/history" style={{ color: c.blue }}>
                  Xem lịch sử
                </a>
              )}
            </p>
          )}
        </>
      )}
    </>
  );
}

function RuleLegend({ rules }: { rules: ReturnType<typeof ruleStateFor> }) {
  return (
    <div style={{ ...card, background: c.panelAlt }}>
      <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Quy tắc che đang áp dụng cho bạn</h2>
      <div style={{ display: "grid", gap: "0.5rem" }}>
        {rules.map((r) => (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
            <span style={{ minWidth: 150, fontSize: "0.9rem" }}>{r.labelVi}</span>
            {r.relaxed ? (
              <Pill tone="red">gửi nguyên văn</Pill>
            ) : (
              <Pill tone="green">đang che</Pill>
            )}
            {r.absolute ? (
              <span style={{ color: c.dim, fontSize: "0.82rem" }}>
                không role nào nới được — kể cả quản trị viên
              </span>
            ) : (
              <span style={{ color: c.dim, fontSize: "0.82rem" }}>
                nới được bằng role <code>{r.unlockRole}</code>, cần quorum admin duyệt
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FindingList({ findings }: { findings: Finding[] }) {
  return (
    <div style={{ marginTop: "0.9rem", display: "grid", gap: "0.35rem" }}>
      {findings.map((f, i) => (
        <div key={i} style={{ display: "flex", gap: "0.6rem", alignItems: "center", fontSize: "0.85rem", flexWrap: "wrap" }}>
          <code style={{ color: c.dim }}>{f.preview}</code>
          <span style={{ color: c.dim }}>→</span>
          {f.passedThrough ? (
            <>
              <Pill tone="red">gửi nguyên văn</Pill>
              <span style={{ color: c.dim }}>
                vì có role <code>{f.viaRole}</code>
              </span>
            </>
          ) : (
            <code style={{ color: c.green }}>{f.placeholder}</code>
          )}
        </div>
      ))}
    </div>
  );
}

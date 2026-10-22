"use client";

// The AI history — scene 2.
//
// The server hands out ciphertext. Opening it happens here, in the browser, and only if the Tide
// network agrees: the read policy names the role `ai_log_reader` as its subject, and the caller
// must also hold `_tide_decryptor`. Neither this page nor the server can talk the network out of
// that — there is no key on our side to misuse.
//
// So the honest demo is: log in as an admin with no `ai_log_reader`, press Giải mã, and read the
// refusal. Then have the quorum grant the role, log in again, and the same button works.
//
// Scope: this is the history THE COMPANY keeps. What the AI provider retains on their side is a
// matter of the contract with them, not of this code.

import { useCallback, useEffect, useState } from "react";
import { useTideCloak } from "@/lib/tide";
import { decryptTranscript, explainCryptoError, fetchSignedPolicy, type PolicyState } from "@/lib/policy/aiLog";
import { ROLE_DECRYPTOR, ROLE_LOG_READER } from "@/lib/log/record";
import { Gate, Notice, Pill, Shell, btnSmall, c, card, mono, useWhoAmI } from "../ui";

interface LogEntry {
  id: string;
  username: string;
  at: string;
  ciphertext: string;
  rulesFired: string[];
  relaxed: string[];
  rolesUsed: string[];
}

export default function HistoryPage() {
  return (
    <Gate>
      <Shell>
        <History />
      </Shell>
    </Gate>
  );
}

function History() {
  const { secureFetch, doEncrypt, doDecrypt } = useTideCloak();
  const me = useWhoAmI();

  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [scope, setScope] = useState<"all" | "own">("own");
  const [readPolicy, setReadPolicy] = useState<PolicyState | null>(null);
  const [opened, setOpened] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    void (async () => {
      try {
        const res = await secureFetch("/api/log");
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) {
          setError(data.error ?? `HTTP ${res.status}`);
          return;
        }
        setEntries(data.entries as LogEntry[]);
        setScope(data.scope);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    // Only a reader is handed the read policy at all, so this 403s for everyone else — which is
    // the correct state to show, not an error to hide.
    void fetchSignedPolicy("read", secureFetch as never)
      .then((s) => alive && setReadPolicy(s))
      .catch(() => alive && setReadPolicy({ kind: "read", signed: false, policy: null, reason: "không đọc được" }));

    return () => {
      alive = false;
    };
  }, [secureFetch]);

  const open = useCallback(
    async (entry: LogEntry) => {
      setBusyId(entry.id);
      setFailed((f) => {
        const next = { ...f };
        delete next[entry.id];
        return next;
      });

      try {
        if (!readPolicy?.policy) {
          throw new Error(
            readPolicy?.reason ??
              `Chưa có policy đọc. Cần role ${ROLE_LOG_READER}, và policy phải được admin ký một lần.`
          );
        }
        const plaintext = await decryptTranscript(entry.ciphertext, readPolicy.policy, { doEncrypt, doDecrypt });
        setOpened((o) => ({ ...o, [entry.id]: plaintext }));
      } catch (err) {
        // A contract refusal arrives looking like a network outage. explainCryptoError digs the
        // real message out of the error's cause instead of showing "service unavailable".
        setFailed((f) => ({ ...f, [entry.id]: explainCryptoError(err) }));
      } finally {
        setBusyId(null);
      }
    },
    [readPolicy, doEncrypt, doDecrypt]
  );

  return (
    <>
      <h1 style={{ marginTop: 0, marginBottom: "0.35rem" }}>Lịch sử đã gửi AI</h1>
      <p style={{ color: c.dim, marginTop: 0, marginBottom: "1.5rem" }}>
        Máy chủ chỉ giữ bản mã. Mở được hay không do mạng Tide quyết định, không do app.
      </p>

      {!me.isLogReader && (
        <Notice tone="amber">
          Tài khoản này không có role <code>{ROLE_LOG_READER}</code>, nên chỉ thấy bản mã của chính
          mình và không mở được gì. Kể cả <code>tide-realm-admin</code> cũng vậy: role đó phải được
          đủ số quản trị viên phê duyệt mới cấp được.
        </Notice>
      )}

      {me.isLogReader && readPolicy && !readPolicy.signed && (
        <Notice tone="amber">
          Có role <code>{ROLE_LOG_READER}</code> nhưng policy đọc chưa được ký:{" "}
          {readPolicy.reason}. Một admin cần ký một lần tại{" "}
          <a href="/admin/setup" style={{ color: "inherit" }}>/admin/setup</a>.
        </Notice>
      )}

      {me.isLogReader && readPolicy?.signed && (
        <Notice tone="green">
          Có role <code>{ROLE_LOG_READER}</code> và policy đọc đã ký. Nếu vẫn bị từ chối, tài khoản
          còn thiếu <code>{ROLE_DECRYPTOR}</code> — hoặc token chưa cập nhật, hãy đăng xuất và vào lại.
        </Notice>
      )}

      {error && <Notice tone="red">{error}</Notice>}

      <p style={{ color: c.dim, fontSize: "0.86rem" }}>
        Phạm vi: {scope === "all" ? "toàn công ty" : "chỉ bản ghi của bạn"}
      </p>

      {entries === null && <p style={{ color: c.dim }}>Đang tải…</p>}
      {entries?.length === 0 && <p style={{ color: c.dim }}>Chưa có bản ghi nào.</p>}

      {entries?.map((entry) => (
        <div key={entry.id} style={card}>
          <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.6rem" }}>
            <strong style={{ fontSize: "0.92rem" }}>{entry.username}</strong>
            <span style={{ color: c.dim, fontSize: "0.84rem" }}>
              {new Date(entry.at).toLocaleString("vi-VN")}
            </span>
            {entry.rulesFired.length > 0 && <Pill>{entry.rulesFired.length} giá trị đã che</Pill>}
            {entry.relaxed.length > 0 && <Pill tone="red">gửi nguyên văn: {entry.relaxed.join(", ")}</Pill>}
          </div>

          {opened[entry.id] ? (
            <div
              style={{
                ...mono,
                background: c.greenBg,
                border: `1px solid ${c.green}44`,
                borderRadius: 7,
                padding: "0.9rem",
              }}
            >
              {opened[entry.id]}
            </div>
          ) : (
            <div
              style={{
                ...mono,
                background: "#1a1a1d",
                border: `1px solid ${c.line}`,
                borderRadius: 7,
                padding: "0.9rem",
                color: c.dim,
              }}
            >
              {entry.ciphertext.slice(0, 120)}
              {entry.ciphertext.length > 120 ? "…" : ""}
            </div>
          )}

          {failed[entry.id] && (
            <p style={{ color: c.red, fontSize: "0.86rem", marginBottom: 0 }}>
              Mạng Tide từ chối: {failed[entry.id]}
            </p>
          )}

          <div style={{ marginTop: "0.7rem", display: "flex", gap: "0.5rem" }}>
            {opened[entry.id] ? (
              <button
                onClick={() =>
                  setOpened((o) => {
                    const next = { ...o };
                    delete next[entry.id];
                    return next;
                  })
                }
                style={{ ...btnSmall, background: "transparent", border: `1px solid ${c.line}`, color: c.dim }}
              >
                Ẩn
              </button>
            ) : (
              <button
                onClick={() => open(entry)}
                disabled={busyId !== null}
                style={{ ...btnSmall, opacity: busyId !== null ? 0.5 : 1 }}
              >
                {busyId === entry.id ? "Đang giải mã…" : "Giải mã"}
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

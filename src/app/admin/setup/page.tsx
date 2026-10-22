"use client";

// The one-time ceremony.
//
// Two policies govern the AI-log record, and only a `tide-realm-admin` can have the network sign
// them. This page is where that happens: two enclave popups, once, and then never again.
//
// Do it EARLY — ideally while the realm is still in firstAdmin mode, as part of first-run setup.
// Signing is not the thing that can be automated away: `POST /iga/role-policies` stores a
// signature, it never produces one, and there is no server-side signing endpoint. Leaving it until
// later does not avoid the popup, it just makes it land in the middle of a demo.
//
// What signing here does NOT do: it does not decide who may read the history. The read policy's
// subject is the ROLE `ai_log_reader`, so after this ceremony the admin is out of the loop — who
// can read is whoever holds that role, and granting it is a governed change request needing a
// quorum. Signing the policy once is what makes the quorum the only remaining lever.

import { useCallback, useEffect, useState } from "react";
import { useTideCloak } from "@/lib/tide";
import { fetchSignedPolicy, signAndStoreLogPolicy, type PolicyState } from "@/lib/policy/aiLog";
import {
  AI_LOG_RECORD_ID,
  ROLE_APP_USER,
  ROLE_DECRYPTOR,
  ROLE_ENCRYPTOR,
  ROLE_LOG_READER,
  type PolicyKind,
} from "@/lib/log/record";
import { Gate, Notice, Pill, Shell, btn, c, card, useWhoAmI } from "../../ui";

const POLICIES: {
  kind: PolicyKind;
  title: string;
  subject: string;
  grants: string;
  why: string;
}[] = [
  {
    kind: "write",
    title: "Policy ghi",
    subject: `Role ${ROLE_APP_USER}`,
    grants: ROLE_ENCRYPTOR,
    why: "Cho nhân viên ghi thêm vào lịch sử. Không có nó, app không lưu được gì — và sẽ nói rõ là không lưu.",
  },
  {
    kind: "read",
    title: "Policy đọc",
    subject: `Role ${ROLE_LOG_READER}`,
    grants: ROLE_DECRYPTOR,
    why: "Cho người giữ role đó mở lịch sử. Cố tình KHÔNG cấp quyền ghi, để người đi soát không sửa được bằng chứng.",
  },
];

export default function SetupPage() {
  return (
    <Gate>
      <Shell>
        <Setup />
      </Shell>
    </Gate>
  );
}

function Setup() {
  const { secureFetch, getVendorId, initializeTideRequest, approveTideRequests, executeTideRequest } =
    useTideCloak();
  const me = useWhoAmI();

  const [state, setState] = useState<Record<PolicyKind, PolicyState | null>>({ write: null, read: null });
  const [busy, setBusy] = useState<PolicyKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [write, read] = await Promise.all([
      fetchSignedPolicy("write", secureFetch as never),
      fetchSignedPolicy("read", secureFetch as never),
    ]);
    setState({ write, read });
  }, [secureFetch]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const sign = useCallback(
    async (kind: PolicyKind) => {
      setBusy(kind);
      setError(null);
      setDone(null);
      try {
        await signAndStoreLogPolicy(kind, getVendorId(), secureFetch as never, {
          initializeTideRequest,
          approveTideRequests,
          executeTideRequest,
        });
        setDone(`Đã ký và lưu policy ${kind}.`);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [getVendorId, secureFetch, initializeTideRequest, approveTideRequests, executeTideRequest, refresh]
  );

  if (!me.isAdmin) {
    return (
      <Notice tone="amber">
        Ký policy là việc của <code>tide-realm-admin</code>. Tài khoản của bạn không có role đó —
        và đúng theo thiết kế, không có cách nào để người dùng thường tự ký.
      </Notice>
    );
  }

  const vendorId = getVendorId();

  return (
    <>
      <h1 style={{ marginTop: 0, marginBottom: "0.35rem" }}>Thiết lập một lần</h1>
      <p style={{ color: c.dim, marginTop: 0, marginBottom: "1.5rem" }}>
        Ký hai policy cho record <code>{AI_LOG_RECORD_ID}</code>. Làm một lần, càng sớm càng tốt.
      </p>

      {!vendorId && (
        <Notice tone="red">
          Không đọc được <code>vendorId</code> từ adapter JSON. Realm chưa được license xong — chạy{" "}
          <code>npm run init</code> cho hết, rồi export lại <code>data/tidecloak.json</code>.
        </Notice>
      )}

      {done && <Notice tone="green">{done}</Notice>}
      {error && <Notice tone="red">{error}</Notice>}

      {POLICIES.map((p) => {
        const s = state[p.kind];
        return (
          <div key={p.kind} style={card}>
            <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.6rem" }}>
              <strong>{p.title}</strong>
              {s === null ? (
                <Pill>đang kiểm tra…</Pill>
              ) : s.signed ? (
                <Pill tone="green">đã ký</Pill>
              ) : (
                <Pill tone="amber">chưa ký</Pill>
              )}
            </div>

            <table style={{ fontSize: "0.86rem", color: c.dim, borderSpacing: 0, marginBottom: "0.8rem" }}>
              <tbody>
                <tr>
                  <td style={{ paddingRight: "1rem", verticalAlign: "top" }}>Chủ thể</td>
                  <td style={{ color: c.text }}>
                    <code>{p.subject}</code>
                  </td>
                </tr>
                <tr>
                  <td style={{ paddingRight: "1rem", verticalAlign: "top" }}>Cho phép</td>
                  <td style={{ color: c.text }}>
                    <code>{p.grants}</code>
                  </td>
                </tr>
                <tr>
                  <td style={{ paddingRight: "1rem", verticalAlign: "top" }}>Record</td>
                  <td style={{ color: c.text }}>
                    <code>{AI_LOG_RECORD_ID}</code>
                  </td>
                </tr>
              </tbody>
            </table>

            <p style={{ color: c.dim, fontSize: "0.86rem", marginTop: 0 }}>{p.why}</p>

            {s?.signed ? (
              <p style={{ color: c.dim, fontSize: "0.84rem", marginBottom: 0 }}>
                Không cần ký lại — ký lại sẽ ghi đè bản đang dùng.
              </p>
            ) : (
              <button
                onClick={() => sign(p.kind)}
                disabled={busy !== null || !vendorId}
                style={{ ...btn, opacity: busy !== null || !vendorId ? 0.45 : 1 }}
              >
                {busy === p.kind ? "Đang mở enclave…" : `Ký policy ${p.kind}`}
              </button>
            )}

            {!s?.signed && s?.reason && (
              <p style={{ color: c.dim, fontSize: "0.82rem", marginBottom: 0 }}>{s.reason}</p>
            )}
          </div>
        );
      })}

      <Notice tone="blue">
        Hai policy này chỉ quyết định <strong>loại chủ thể</strong> nào được ghi và được đọc. Ai
        thuộc chủ thể đó thì do role quyết định — và cấp role <code>{ROLE_LOG_READER}</code> là một
        yêu cầu thay đổi cần quorum. Nói cách khác: ký ở đây xong thì chính bạn cũng không tự mở
        được lịch sử.
      </Notice>
    </>
  );
}

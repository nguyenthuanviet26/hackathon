"use client";

// The governance panel — scene 1.
//
// An admin proposes loosening a redaction rule (granting `ai_export_contact`) and discovers they
// cannot finish it. The grant becomes a change request, and the request needs a quorum of
// admins, each signing in their own Tide enclave. One admin, including the most privileged one,
// gets as far as "1/2 đã ký" and stops there.
//
// Every call on this page goes straight from this browser to TideCloak with THIS admin's own
// token. It deliberately does not pass through the app server: `approve` credits whoever
// authenticated the request, so a server-side proxy would record every admin's signature under one
// identity and the quorum could never be met (AP-89).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTideCloak } from "@/lib/tide";
import {
  IgaClient,
  approveWithEnclave,
  isDestructive,
  tally,
  type ChangeRequest,
} from "@/lib/iga/client";
import { ROLE_EXPORT_CONTACT, ROLE_LOG_READER, ROLE_DECRYPTOR } from "@/lib/log/record";
import { Gate, Notice, Pill, QuorumSeals, Shell, btn, btnSmall, c, card, input, useWhoAmI } from "../ui";

/** The roles this panel can propose. Each one is a loosening that needs a quorum. */
const GRANTABLE = [
  {
    role: ROLE_EXPORT_CONTACT,
    title: "Nới quy tắc che: gửi SĐT + email nguyên văn",
    detail: "Sau khi đủ admin duyệt, người này gửi số điện thoại và email của khách hàng nguyên văn cho AI.",
  },
  {
    role: ROLE_LOG_READER,
    title: "Mở lịch sử AI đã mã hóa",
    detail: `Cho phép giải mã lịch sử. Cần cấp kèm ${ROLE_DECRYPTOR} để ORK chịu giải mã.`,
  },
  {
    role: ROLE_DECRYPTOR,
    title: `Quyền giải mã (${ROLE_DECRYPTOR})`,
    detail: "Khả năng giải mã ở mức ORK. Không có policy thì vẫn không mở được gì.",
  },
] as const;

interface UserRow {
  id: string;
  username: string;
  roles: string[];
}

/** "Cấp ai_export_contact cho nhanvien", when the request says which user and role it touches. */
function describe(cr: ChangeRequest, users: UserRow[] | null): string | null {
  const rows = cr.rows as { userId?: string; role?: string } | undefined;
  if (!rows?.role) return null;
  const who = users?.find((u) => u.id === rows.userId)?.username ?? "người dùng";
  return `${cr.actionType === "REVOKE_ROLE" ? "Thu hồi" : "Cấp"} ${rows.role} cho ${who}`;
}

export default function GovernancePage() {
  return (
    <Gate>
      <Shell>
        <Governance />
      </Shell>
    </Gate>
  );
}

function Governance() {
  const { secureFetch, approveTideRequests, baseURL, getConfig } = useTideCloak();
  const me = useWhoAmI();

  const realm = useMemo(() => (getConfig() as { realm?: string })?.realm ?? "", [getConfig]);
  const iga = useMemo(
    () => (baseURL && realm ? new IgaClient(baseURL, realm, secureFetch as never) : null),
    [baseURL, realm, secureFetch]
  );

  const [pending, setPending] = useState<ChangeRequest[] | null>(null);
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [igaOn, setIgaOn] = useState<boolean | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workingOn, setWorkingOn] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState("");

  // Re-read everything after every mutation: `authorizationCount`, `readyToCommit` and `status`
  // all change, and a stale list offers Commit on a request that answers 412 (AP-G04).
  const refresh = useCallback(async () => {
    if (!iga) return;
    try {
      const [crs, people, status] = await Promise.all([iga.listPending(), iga.listUsers(), iga.igaStatus()]);
      setPending(crs);
      setIgaOn(status.enabled);

      const withRoles = await Promise.all(
        people.map(async (u) => ({
          id: u.id,
          username: u.username,
          roles: await iga
            .userRealmRoles(u.id)
            .then((rs) => rs.map((r) => r.name))
            .catch(() => []),
        }))
      );
      setUsers(withRoles);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [iga]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const propose = useCallback(
    async (role: string) => {
      if (!iga || !selectedUser) return;
      setWorkingOn(`propose:${role}`);
      setStatus(null);
      setError(null);
      try {
        const roleObj = await iga.getRealmRole(role);
        await iga.proposeRoleGrant(selectedUser, roleObj);
        setStatus(
          `Đã đề xuất cấp "${role}". Nó CHƯA có hiệu lực: giờ là một yêu cầu thay đổi, ` +
            `phải đủ số admin ký mới được áp dụng.`
        );
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setWorkingOn(null);
      }
    },
    [iga, selectedUser, refresh]
  );

  const approve = useCallback(
    async (cr: ChangeRequest) => {
      if (!iga) return;
      setWorkingOn(cr.id);
      setStatus(null);
      setError(null);
      try {
        const out = await approveWithEnclave(iga, cr.id, approveTideRequests);
        const of = out.threshold ? `/${out.threshold}` : "";
        setStatus(
          out.committed
            ? `Đủ quorum — thay đổi đã được áp dụng (${out.authCount ?? "?"}${of} chữ ký).`
            : `Đã ghi nhận chữ ký của bạn (${out.authCount ?? "?"}${of}). ` +
              `Chưa đủ quorum, cần admin khác ký tiếp — bạn không ký thay được.`
        );
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setWorkingOn(null);
      }
    },
    [iga, approveTideRequests, refresh]
  );

  const deny = useCallback(
    async (cr: ChangeRequest) => {
      if (!iga) return;
      setWorkingOn(cr.id);
      setError(null);
      try {
        await iga.deny(cr.id, "Từ chối từ panel WorkSafe AI");
        setStatus("Đã từ chối yêu cầu.");
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setWorkingOn(null);
      }
    },
    [iga, refresh]
  );

  if (!me.isAdmin) {
    return (
      <Notice tone="amber">
        Trang này cần role <code>tide-realm-admin</code> (client role trên{" "}
        <code>realm-management</code>). Tài khoản của bạn không có.
      </Notice>
    );
  }

  return (
    <>
      <h1 style={{ marginTop: 0, marginBottom: "0.35rem" }}>Phê duyệt thay đổi</h1>
      <p style={{ color: c.dim, marginTop: 0, marginBottom: "1.5rem" }}>
        Mọi thay đổi quyền trong realm này đều thành một yêu cầu cần đủ số quản trị viên cùng ký.
      </p>

      {igaOn === false && (
        <Notice tone="red">
          IGA đang TẮT trên realm này. Khi IGA tắt, thay đổi quyền có hiệu lực ngay và panel này
          không bảo vệ gì cả. Bật lại bằng <code>toggle-iga</code> trước khi demo.
        </Notice>
      )}
      {igaOn === null && (
        <Notice tone="amber">
          Không đọc được trạng thái IGA (endpoint <code>/tide-admin/iga-status</code>). Kiểm tra
          trước khi tin vào panel này.
        </Notice>
      )}

      {status && <Notice tone="blue">{status}</Notice>}
      {error && <Notice tone="red">{error}</Notice>}

      <div style={card}>
        <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Đề xuất nới quyền</h2>
        <label style={{ display: "block", color: c.dim, fontSize: "0.88rem", marginBottom: "0.4rem" }}>
          Cấp cho người dùng
        </label>
        <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} style={input}>
          <option value="">— chọn người dùng —</option>
          {(users ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.username}
              {u.roles.length > 0 ? ` — ${u.roles.filter((r) => r.startsWith("ai_") || r.startsWith("_tide_")).join(", ")}` : ""}
            </option>
          ))}
        </select>

        <div style={{ display: "grid", gap: "0.6rem", marginTop: "1rem" }}>
          {GRANTABLE.map((g) => {
            const target = users?.find((u) => u.id === selectedUser);
            const already = target?.roles.includes(g.role) ?? false;
            return (
              <div
                key={g.role}
                style={{
                  background: c.panelAlt,
                  border: `1px solid ${c.line}`,
                  borderRadius: 8,
                  padding: "0.8rem",
                }}
              >
                <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
                  <strong style={{ fontSize: "0.92rem" }}>{g.title}</strong>
                  <code style={{ color: c.dim, fontSize: "0.8rem" }}>{g.role}</code>
                  {already && <Pill tone="green">đã có</Pill>}
                </div>
                <p style={{ color: c.dim, fontSize: "0.85rem", margin: "0.45rem 0 0.7rem" }}>{g.detail}</p>
                <button
                  onClick={() => propose(g.role)}
                  disabled={!selectedUser || already || workingOn !== null}
                  style={{
                    ...btnSmall,
                    opacity: !selectedUser || already || workingOn !== null ? 0.45 : 1,
                  }}
                >
                  {workingOn === `propose:${g.role}` ? "Đang đề xuất…" : "Đề xuất cấp"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>
        Yêu cầu đang chờ {pending ? `(${pending.length})` : ""}
      </h2>

      {pending === null && <p style={{ color: c.dim }}>Đang tải…</p>}
      {pending?.length === 0 && (
        <p style={{ color: c.dim }}>Không có yêu cầu nào đang chờ.</p>
      )}

      {pending?.map((cr) => {
        const t = tally(cr);
        const destructive = isDestructive(cr);
        return (
          <div
            key={cr.id}
            style={{
              ...card,
              borderColor: destructive ? `${c.red}66` : c.line,
            }}
          >
            <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.5rem" }}>
              <strong style={{ fontSize: "0.95rem" }}>{cr.actionType}</strong>
              <Pill>{cr.entityType}</Pill>
              {destructive && <Pill tone="red">phá huỷ realm — đọc kỹ</Pill>}
              {cr.blocked && <Pill tone="red">bị chặn: {cr.blockedReason ?? "phụ thuộc yêu cầu khác"}</Pill>}
            </div>

            {describe(cr, users) && (
              <p style={{ margin: "0 0 0.9rem", fontSize: "0.95rem" }}>{describe(cr, users)}</p>
            )}

            <div style={{ margin: "0 0 0.9rem" }}>
              <QuorumSeals
                count={t.count}
                threshold={t.threshold}
                ready={t.ready}
                names={(cr.authorizers ?? []).map((a) => a.username ?? "")}
              />
            </div>

            <div style={{ color: c.dim, fontSize: "0.82rem", marginBottom: "0.9rem", lineHeight: 1.6 }}>
              {cr.requestedBy && <div>Đề xuất bởi {cr.requestedBy}</div>}
              {(cr.authorizers?.length ?? 0) > 0 && (
                <div>Đã ký: {cr.authorizers!.map((a) => a.username ?? "?").join(", ")}</div>
              )}
              <div>Mã yêu cầu <code>{cr.id}</code></div>
            </div>

            {destructive ? (
              <Notice tone="red">
                Yêu cầu này vô hiệu hóa IGA hoặc xoá/offboard realm. Panel cố tình không cho duyệt
                một nhấn — nếu thật sự muốn, làm trong Admin Console của TideCloak.
              </Notice>
            ) : (
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  onClick={() => approve(cr)}
                  disabled={workingOn !== null || cr.blocked === true}
                  style={{ ...btn, opacity: workingOn !== null || cr.blocked ? 0.45 : 1 }}
                >
                  {workingOn === cr.id ? "Đang ký trong enclave…" : "Ký phê duyệt"}
                </button>
                <button
                  onClick={() => deny(cr)}
                  disabled={workingOn !== null}
                  style={{ ...btn, background: "transparent", border: `1px solid ${c.red}66`, color: c.red, opacity: workingOn !== null ? 0.45 : 1 }}
                >
                  Từ chối
                </button>
              </div>
            )}
          </div>
        );
      })}

      <p style={{ color: c.dim, fontSize: "0.84rem", marginTop: "1.5rem", lineHeight: 1.6 }}>
        Ngưỡng quorum do TideCloak quyết định, không do app:{" "}
        <code>max(1, floor(0.7 × số tide-realm-admin đang hoạt động))</code>. Với 3 admin thì ngưỡng
        là 2 — một người không tự duyệt xong được. Với 2 admin ngưỡng là 1, nên demo quorum cần ít
        nhất 3 admin đã liên kết tài khoản Tide.
      </p>
    </>
  );
}

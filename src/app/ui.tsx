"use client";

// Shared chrome and styles. One file so the four pages look like one app and nothing is restyled
// by hand per page.
//
// Direction: a bank's internal tool. Cool paper, navy ink, one confident blue. Hierarchy comes from
// surface and rule, not from shadows: white bordered panels are where work happens, tinted panels
// carry context, notices hang off a left rule. The one expressive element is the quorum, drawn as
// company seals being stamped — the thing the whole product is about.

import { usePathname } from "next/navigation";
import { useTideCloak } from "@/lib/tide";
import { ADMIN_ROLE, ADMIN_ROLE_CLIENT, ROLE_LOG_READER, ROLE_EXPORT_CONTACT } from "@/lib/log/record";

export const c = {
  bg: "#F5F7FA",
  panel: "#FFFFFF",
  panelAlt: "#EEF3FA",
  line: "#DCE3EC",
  text: "#0E1B2E",
  dim: "#5B6B82",
  blue: "#1D4ED8",
  blueDeep: "#1E3A8A",
  blueSoft: "#E8EEFC",
  code: "#F8FAFD",
  green: "#0F7B5A",
  greenBg: "#E7F5EF",
  amber: "#9A5B00",
  amberBg: "#FFF5E1",
  red: "#B42318",
  redBg: "#FDECEA",
} as const;

export const font = {
  ui: "'Be Vietnam Pro', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

export const card: React.CSSProperties = {
  background: c.panel,
  border: `1px solid ${c.line}`,
  borderRadius: 14,
  padding: "1.25rem 1.4rem",
  marginBottom: "1rem",
};

export const btn: React.CSSProperties = {
  background: c.blue,
  color: "#fff",
  border: `1px solid ${c.blue}`,
  borderRadius: 8,
  padding: "0.6rem 1.1rem",
  fontSize: "0.95rem",
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

export const btnGhost: React.CSSProperties = {
  ...btn,
  background: c.panel,
  border: `1px solid ${c.line}`,
  color: c.text,
};

export const btnSmall: React.CSSProperties = { ...btn, padding: "0.4rem 0.8rem", fontSize: "0.86rem" };

export const input: React.CSSProperties = {
  width: "100%",
  padding: "0.7rem 0.8rem",
  background: c.panel,
  border: `1px solid ${c.line}`,
  borderRadius: 8,
  color: c.text,
  fontSize: "0.95rem",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

export const mono: React.CSSProperties = {
  fontFamily: font.mono,
  fontSize: "0.84rem",
  lineHeight: 1.7,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

/** The box that shows text exactly as a machine sees it: what goes to the AI, or ciphertext. */
export const codeBox: React.CSSProperties = {
  ...mono,
  background: c.code,
  border: `1px solid ${c.line}`,
  borderRadius: 8,
  padding: "0.9rem 1rem",
};

type Tone = "dim" | "green" | "amber" | "red" | "blue";

const TONES: Record<Tone, { fg: string; bg: string }> = {
  dim: { fg: c.dim, bg: "#EEF1F5" },
  green: { fg: c.green, bg: c.greenBg },
  amber: { fg: c.amber, bg: c.amberBg },
  red: { fg: c.red, bg: c.redBg },
  blue: { fg: c.blue, bg: c.blueSoft },
};

export function Pill({ tone = "dim", children }: { tone?: Tone; children: React.ReactNode }) {
  const t = TONES[tone];
  return (
    <span
      style={{
        display: "inline-block",
        background: t.bg,
        color: t.fg,
        borderRadius: 999,
        padding: "0.15rem 0.6rem",
        fontSize: "0.78rem",
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function Notice({ tone, children }: { tone: Exclude<Tone, "dim">; children: React.ReactNode }) {
  const t = TONES[tone];
  return (
    <div
      role={tone === "red" ? "alert" : "status"}
      style={{
        background: t.bg,
        borderLeft: `3px solid ${t.fg}`,
        color: c.text,
        borderRadius: "0 8px 8px 0",
        padding: "0.75rem 1rem",
        fontSize: "0.9rem",
        marginBottom: "1rem",
        lineHeight: 1.55,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Text as the AI receives it, with every redaction placeholder drawn as a chip so the audience can
 * see at a glance what never left the company.
 */
export function RedactedText({ text }: { text: string }) {
  const parts = text.split(/(\[[A-ZĐ_]+_\d+\])/u);
  return (
    <>
      {parts.map((part, i) =>
        /^\[[A-ZĐ_]+_\d+\]$/u.test(part) ? (
          <span
            key={i}
            style={{
              background: c.blueSoft,
              color: c.blueDeep,
              border: `1px solid ${c.blue}33`,
              borderRadius: 5,
              padding: "0 0.3rem",
              fontWeight: 600,
            }}
          >
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

/**
 * The quorum as company seals: one stamped seal per admin who signed, a dashed ring for each
 * signature still missing. `names` are the signers, in order.
 */
export function QuorumSeals({
  count,
  threshold,
  names = [],
  ready,
}: {
  count: number | null;
  threshold: number | null;
  names?: string[];
  ready?: boolean;
}) {
  const need = threshold ?? Math.max(count ?? 0, 1);
  const have = count ?? 0;
  const slots = Array.from({ length: Math.max(need, have) }, (_, i) => i);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: "0.4rem" }} aria-hidden>
        {slots.map((i) => {
          const signed = i < have;
          const who = names[i] ?? "";
          return (
            <span
              key={i}
              title={signed ? `Đã ký: ${who}` : "Chờ ký"}
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                fontSize: "0.72rem",
                fontWeight: 700,
                letterSpacing: "0.02em",
                color: signed ? c.blue : c.dim,
                border: signed ? `2px solid ${c.blue}` : `2px dashed ${c.line}`,
                boxShadow: signed ? `inset 0 0 0 3px ${c.panel}, inset 0 0 0 4px ${c.blue}66` : "none",
                background: signed ? c.blueSoft : "transparent",
                transform: signed ? `rotate(${i % 2 ? 8 : -8}deg)` : "none",
              }}
            >
              {signed ? (who ? who.slice(0, 1).toUpperCase() + (who.match(/\d+$/)?.[0] ?? "") : "✓") : ""}
            </span>
          );
        })}
      </div>
      <span style={{ fontSize: "0.88rem", color: ready ? c.green : c.text, fontWeight: 600 }}>
        {count === null ? "Chưa rõ số chữ ký" : `${have}/${need} chữ ký`}
        <span style={{ color: c.dim, fontWeight: 400 }}>
          {ready ? ", đủ quorum" : need > have ? `, cần thêm ${need - have} quản trị viên` : ""}
        </span>
      </span>
    </div>
  );
}

/** What this session can do. Read from the token by the SDK; the server re-checks everything. */
export function useWhoAmI() {
  const { authenticated, hasRealmRole, hasClientRole, getValueFromIdToken } = useTideCloak();
  return {
    authenticated,
    username: (getValueFromIdToken("preferred_username") as string) ?? "",
    isAdmin: hasClientRole(ADMIN_ROLE, ADMIN_ROLE_CLIENT),
    isLogReader: hasRealmRole(ROLE_LOG_READER),
    canExportContact: hasRealmRole(ROLE_EXPORT_CONTACT),
  };
}

/** The mark: a shield with a redaction bar across it. */
function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
      <path d="M13 2 L22 5.5 V12.5 C22 18 18.2 22.3 13 24 C7.8 22.3 4 18 4 12.5 V5.5 Z" fill={c.blue} />
      <rect x="8" y="11" width="10" height="3.6" rx="1.2" fill="#fff" />
    </svg>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { logout } = useTideCloak();
  const me = useWhoAmI();
  const path = usePathname();

  const links = [
    { href: "/", label: "Hỏi AI", show: true },
    { href: "/history", label: "Lịch sử", show: true },
    { href: "/governance", label: "Phê duyệt", show: me.isAdmin },
    { href: "/admin/setup", label: "Thiết lập", show: me.isAdmin },
  ];

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1.25rem",
          flexWrap: "wrap",
          marginBottom: "2rem",
          borderBottom: `1px solid ${c.line}`,
        }}
      >
        <a
          href="/"
          style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: c.text, textDecoration: "none", fontWeight: 700, fontSize: "1.05rem", padding: "0.9rem 0" }}
        >
          <Mark />
          WorkSafe AI
        </a>
        <nav style={{ display: "flex", gap: "0.25rem", flex: 1, flexWrap: "wrap" }}>
          {links
            .filter((l) => l.show)
            .map((l) => {
              const active = l.href === "/" ? path === "/" : path?.startsWith(l.href);
              return (
                <a
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  style={{
                    color: active ? c.blue : c.dim,
                    fontWeight: active ? 600 : 500,
                    textDecoration: "none",
                    fontSize: "0.93rem",
                    padding: "1.05rem 0.7rem 0.95rem",
                    borderBottom: `2px solid ${active ? c.blue : "transparent"}`,
                    marginBottom: -1,
                  }}
                >
                  {l.label}
                </a>
              );
            })}
        </nav>
        {me.authenticated && (
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", padding: "0.6rem 0" }}>
            <span
              aria-hidden
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: me.isAdmin ? c.blueDeep : c.blueSoft,
                color: me.isAdmin ? "#fff" : c.blueDeep,
                display: "grid",
                placeItems: "center",
                fontSize: "0.8rem",
                fontWeight: 700,
              }}
            >
              {me.username.slice(0, 1).toUpperCase()}
            </span>
            <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>{me.username}</span>
            {me.isAdmin && <Pill tone="blue">quản trị viên</Pill>}
            {me.isLogReader && <Pill tone="amber">{ROLE_LOG_READER}</Pill>}
            {me.canExportContact && <Pill tone="red">{ROLE_EXPORT_CONTACT}</Pill>}
            <button onClick={logout} style={{ ...btnSmall, ...btnGhost, padding: "0.35rem 0.75rem", fontSize: "0.84rem", fontWeight: 500 }}>
              Đăng xuất
            </button>
          </div>
        )}
      </header>
      <main>{children}</main>
    </div>
  );
}

const PROMISES = [
  {
    title: "Che trước khi gửi",
    body: "Số điện thoại, email, CCCD và số thẻ được thay bằng nhãn trước khi rời công ty. Bạn xem trước đúng thứ AI nhận.",
  },
  {
    title: "Nới quy tắc cần nhiều người duyệt",
    body: "Không quản trị viên nào tự nới được. Mỗi thay đổi cần đủ chữ ký của các quản trị viên khác.",
  },
  {
    title: "Lịch sử được mã hóa",
    body: "Máy chủ chỉ giữ bản mã. Muốn mở cũng phải được nhiều quản trị viên đồng ý.",
  },
];

/** The gate every page shares: loading, then login, then the page. */
export function Gate({ children }: { children: React.ReactNode }) {
  const { isInitializing, authenticated, login, initError } = useTideCloak();

  if (isInitializing) {
    return <p style={{ color: c.dim, maxWidth: 960, margin: "0 auto" }}>Đang khởi tạo…</p>;
  }

  if (initError) {
    return (
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <Notice tone="red">
          Không khởi tạo được TideCloak: {initError.message}
          <br />
          Kiểm tra <code>data/tidecloak.json</code> đã được export chưa (<code>npm run init</code>).
        </Notice>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          display: "flex",
          flexWrap: "wrap",
          gap: "3rem",
          alignItems: "center",
          padding: "2.5rem 0",
        }}
      >
        <div style={{ flex: "1 1 360px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 700, marginBottom: "1.75rem" }}>
            <Mark />
            WorkSafe AI
          </div>
          <h1 style={{ fontSize: "clamp(1.9rem, 4vw, 2.6rem)", lineHeight: 1.15, letterSpacing: "-0.02em", margin: "0 0 1rem", maxWidth: "16ch" }}>
            Dùng AI cho công việc mà không lộ dữ liệu khách hàng
          </h1>
          <p style={{ color: c.dim, fontSize: "1.02rem", lineHeight: 1.6, margin: "0 0 2rem", maxWidth: "52ch" }}>
            Cổng AI nội bộ của công ty. Không một quản trị viên nào, kể cả người có quyền cao nhất, tự
            mình nới quy tắc hay đọc được lịch sử.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "1rem", maxWidth: "54ch" }}>
            {PROMISES.map((p) => (
              <li key={p.title} style={{ borderLeft: `2px solid ${c.blue}`, paddingLeft: "0.9rem" }}>
                <div style={{ fontWeight: 600, marginBottom: "0.15rem" }}>{p.title}</div>
                <div style={{ color: c.dim, fontSize: "0.9rem", lineHeight: 1.55 }}>{p.body}</div>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ ...card, flex: "0 1 340px", padding: "1.75rem", marginBottom: 0 }}>
          <h2 style={{ margin: "0 0 0.4rem", fontSize: "1.15rem" }}>Đăng nhập</h2>
          <p style={{ color: c.dim, fontSize: "0.9rem", margin: "0 0 1.25rem", lineHeight: 1.55 }}>
            Dùng tài khoản công ty. Danh tính được xác thực qua Tide.
          </p>
          <button onClick={login} style={{ ...btn, width: "100%", padding: "0.75rem" }}>
            Đăng nhập
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

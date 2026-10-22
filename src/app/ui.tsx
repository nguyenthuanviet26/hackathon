"use client";

// Shared chrome and styles. One file so the four pages look like one app and nothing is restyled
// by hand per page.

import { useTideCloak } from "@/lib/tide";
import { ADMIN_ROLE, ADMIN_ROLE_CLIENT, ROLE_LOG_READER, ROLE_EXPORT_CONTACT } from "@/lib/log/record";

export const c = {
  bg: "#0a0a0a",
  panel: "#111113",
  panelAlt: "#16161a",
  line: "#2a2a30",
  text: "#ededed",
  dim: "#8b8b94",
  blue: "#2563eb",
  green: "#22c55e",
  greenBg: "#0f2417",
  amber: "#f59e0b",
  amberBg: "#2a1f06",
  red: "#ef4444",
  redBg: "#2a1113",
} as const;

export const card: React.CSSProperties = {
  background: c.panel,
  border: `1px solid ${c.line}`,
  borderRadius: 10,
  padding: "1.25rem",
  marginBottom: "1rem",
};

export const btn: React.CSSProperties = {
  background: c.blue,
  color: "#fff",
  border: "none",
  borderRadius: 7,
  padding: "0.6rem 1.1rem",
  fontSize: "0.95rem",
  cursor: "pointer",
  fontFamily: "inherit",
};

export const btnGhost: React.CSSProperties = {
  ...btn,
  background: "transparent",
  border: `1px solid ${c.line}`,
  color: c.text,
};

export const btnSmall: React.CSSProperties = { ...btn, padding: "0.35rem 0.7rem", fontSize: "0.85rem" };

export const input: React.CSSProperties = {
  width: "100%",
  padding: "0.7rem",
  background: "#1a1a1d",
  border: `1px solid ${c.line}`,
  borderRadius: 7,
  color: c.text,
  fontSize: "0.95rem",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

export const mono: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "0.85rem",
  lineHeight: 1.6,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

export function Pill({
  tone = "dim",
  children,
}: {
  tone?: "dim" | "green" | "amber" | "red" | "blue";
  children: React.ReactNode;
}) {
  const tones = {
    dim: { fg: c.dim, bg: "#1a1a1d" },
    green: { fg: c.green, bg: c.greenBg },
    amber: { fg: c.amber, bg: c.amberBg },
    red: { fg: c.red, bg: c.redBg },
    blue: { fg: "#93c5fd", bg: "#111c33" },
  }[tone];

  return (
    <span
      style={{
        display: "inline-block",
        background: tones.bg,
        color: tones.fg,
        border: `1px solid ${tones.fg}33`,
        borderRadius: 999,
        padding: "0.15rem 0.6rem",
        fontSize: "0.78rem",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function Notice({
  tone,
  children,
}: {
  tone: "green" | "amber" | "red" | "blue";
  children: React.ReactNode;
}) {
  const tones = {
    green: { fg: c.green, bg: c.greenBg },
    amber: { fg: c.amber, bg: c.amberBg },
    red: { fg: c.red, bg: c.redBg },
    blue: { fg: "#93c5fd", bg: "#111c33" },
  }[tone];

  return (
    <div
      style={{
        background: tones.bg,
        border: `1px solid ${tones.fg}44`,
        color: tones.fg,
        borderRadius: 8,
        padding: "0.7rem 0.9rem",
        fontSize: "0.9rem",
        marginBottom: "1rem",
        lineHeight: 1.5,
      }}
    >
      {children}
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

export function Shell({ children }: { children: React.ReactNode }) {
  const { logout } = useTideCloak();
  const me = useWhoAmI();

  const link: React.CSSProperties = {
    color: c.dim,
    textDecoration: "none",
    fontSize: "0.92rem",
    padding: "0.35rem 0.6rem",
    borderRadius: 6,
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          flexWrap: "wrap",
          paddingBottom: "1rem",
          marginBottom: "1.5rem",
          borderBottom: `1px solid ${c.line}`,
        }}
      >
        <a href="/" style={{ ...link, color: c.text, fontWeight: 600, fontSize: "1rem" }}>
          WorkSafe AI
        </a>
        <nav style={{ display: "flex", gap: "0.15rem", flex: 1, flexWrap: "wrap" }}>
          <a href="/" style={link}>
            Hỏi AI
          </a>
          <a href="/history" style={link}>
            Lịch sử
          </a>
          {me.isAdmin && (
            <>
              <a href="/governance" style={link}>
                Phê duyệt
              </a>
              <a href="/admin/setup" style={link}>
                Thiết lập
              </a>
            </>
          )}
        </nav>
        {me.authenticated && (
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: c.dim, fontSize: "0.85rem" }}>{me.username}</span>
            {me.isAdmin && <Pill tone="blue">admin</Pill>}
            {me.isLogReader && <Pill tone="amber">{ROLE_LOG_READER}</Pill>}
            {me.canExportContact && <Pill tone="red">{ROLE_EXPORT_CONTACT}</Pill>}
            <button onClick={logout} style={{ ...btnSmall, background: "transparent", border: `1px solid ${c.line}`, color: c.dim }}>
              Đăng xuất
            </button>
          </div>
        )}
      </header>
      {children}
    </div>
  );
}

/** The gate every page shares: loading, then login, then the page. */
export function Gate({ children }: { children: React.ReactNode }) {
  const { isInitializing, authenticated, login, initError } = useTideCloak();

  if (isInitializing) {
    return <p style={{ color: c.dim }}>Đang khởi tạo…</p>;
  }

  if (initError) {
    return (
      <Notice tone="red">
        Không khởi tạo được TideCloak: {initError.message}
        <br />
        Kiểm tra <code>data/tidecloak.json</code> đã được export chưa (<code>npm run init</code>).
      </Notice>
    );
  }

  if (!authenticated) {
    return (
      <div style={{ textAlign: "center", padding: "3rem 0" }}>
        <h1 style={{ marginBottom: "0.5rem" }}>WorkSafe AI</h1>
        <p style={{ color: c.dim, maxWidth: 420, margin: "0 auto 2rem" }}>
          Cổng AI nội bộ. Dữ liệu khách hàng được che trước khi gửi; nới quy tắc hay mở lịch sử đều
          cần nhiều quản trị viên cùng phê duyệt.
        </p>
        <button onClick={login} style={btn}>
          Đăng nhập bằng Tide
        </button>
      </div>
    );
  }

  return <>{children}</>;
}

"use client";

// client.tsx — the simulated TideCloak provider (Plan C). Browser side.
//
// Exposes the same hook surface the pages already use from @tidecloak/nextjs, so no page needs to
// know which mode it is in. Every decision is still made on the server: this file only holds the
// token, attaches it, and stands in for the two things that need a person — choosing an account to
// log in as, and the enclave's "sign this?" prompt.
//
// The token lives in localStorage, so each browser profile is its own session — the demo still
// uses one profile per admin, and one admin still counts once.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { TideLike } from "@/lib/tide";

const STORAGE_KEY = "worksafe-sim-token";
const SIM_CLIENT_ROLE_HOLDER = "realm-management";

type Payload = Record<string, unknown> & { exp?: number };

function decode(token: string): Payload | null {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      Array.from(atob(part), (ch) => "%" + ch.charCodeAt(0).toString(16).padStart(2, "0")).join("")
    );
    const payload = JSON.parse(json) as Payload;
    return payload.exp && payload.exp * 1000 < Date.now() ? null : payload;
  } catch {
    return null;
  }
}

const toB64 = (bytes?: Uint8Array) => {
  if (!bytes) return "";
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

const SimContext = createContext<TideLike | null>(null);

export function useSimTideCloak(): TideLike {
  const ctx = useContext(SimContext);
  if (!ctx) throw new Error("useTideCloak must be used inside <Providers>");
  return ctx;
}

export function SimProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && decode(stored)) setToken(stored);
    } catch {
      /* storage blocked: start logged out */
    }
    setInitializing(false);
  }, []);

  const payload = useMemo(() => (token ? decode(token) : null), [token]);

  const signIn = useCallback((t: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* session-only */
    }
    setToken(t);
    setPicking(false);
  }, []);

  const secureFetch = useCallback(
    (url: string | URL | RequestInfo, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (token) headers.set("authorization", `Bearer ${token}`);
      return fetch(url, { ...init, headers });
    },
    [token]
  );

  const ork = useCallback(
    async (op: "encrypt" | "decrypt", items: unknown, policy?: Uint8Array) => {
      const res = await secureFetch(`/api/sim/ork/${op}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items, policy: toB64(policy) }),
      });
      const data = (await res.json().catch(() => ({}))) as { out?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      return data.out;
    },
    [secureFetch]
  );

  const value = useMemo<TideLike>(() => {
    const realmRoles = ((payload?.realm_access as { roles?: string[] } | undefined)?.roles ?? []).map(String);
    const clientRoles = (resource: string) =>
      ((payload?.resource_access as Record<string, { roles?: string[] }> | undefined)?.[resource]?.roles ?? []).map(String);
    const username = String(payload?.preferred_username ?? "");

    return {
      isInitializing: initializing,
      initError: null,
      authenticated: payload !== null,
      baseURL: "/api/sim",
      getConfig: () => ({ realm: "worksafe-ai", simulated: true }),
      getVendorId: () => "simulated-vendor",
      login: async () => setPicking(true),
      logout: async () => {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* nothing stored */
        }
        setToken(null);
      },
      hasRealmRole: (role) => realmRoles.includes(role),
      hasClientRole: (role, resource) => clientRoles(resource ?? SIM_CLIENT_ROLE_HOLDER).includes(role),
      getValueFromToken: (key) => payload?.[key],
      getValueFromIdToken: (key) => payload?.[key],
      secureFetch,
      doEncrypt: (data, policy) => ork("encrypt", data, policy),
      doDecrypt: (data, policy) => ork("decrypt", data, policy),
      // The enclave: in the live system a Tide popup in this admin's own browser. Here, a prompt
      // that names who is signing — the server still binds the signature to this token.
      approveTideRequests: async (requests) => {
        const yes = window.confirm(
          `[Enclave Tide — MÔ PHỎNG]\n\nKý phê duyệt với tư cách "${username}"?\n\n` +
            "Bản thật mở popup enclave Tide trên trình duyệt của chính bạn."
        );
        return requests.map((r) => (yes ? { id: r.id, approved: { request: r.request } } : { id: r.id, denied: true }));
      },
      initializeTideRequest: async (request) => request,
      executeTideRequest: async () => {
        throw new Error("executeTideRequest is not simulated");
      },
    };
  }, [payload, initializing, secureFetch, ork]);

  return (
    <SimContext.Provider value={value}>
      <SimBanner />
      {children}
      {picking && !payload && <LoginPicker onToken={signIn} onClose={() => setPicking(false)} />}
    </SimContext.Provider>
  );
}

function SimBanner() {
  return (
    <div
      style={{
        maxWidth: 900,
        margin: "0 auto 1.25rem",
        background: "#2a1f06",
        border: "1px solid #f59e0b55",
        color: "#f59e0b",
        borderRadius: 8,
        padding: "0.55rem 0.9rem",
        fontSize: "0.84rem",
        lineHeight: 1.5,
      }}
    >
      <strong>Chế độ mô phỏng TideCloak (Plan C).</strong> Mạng Tide đang quá tải nên realm chưa được
      license. Đăng nhập, role, quorum admin và mã hóa theo policy đang chạy bằng bản mô phỏng trên máy
      chủ app, theo đúng luật của bản thật. Khác biệt duy nhất: khóa nằm ở một máy thay vì chia cho
      các node ORK.
    </div>
  );
}

function LoginPicker({ onToken, onClose }: { onToken: (t: string) => void; onClose: () => void }) {
  const [users, setUsers] = useState<{ username: string; admin: boolean }[] | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/sim/users");
    const data = await res.json();
    setUsers(data.users ?? []);
    setThreshold(data.threshold ?? null);
  }, []);

  useEffect(() => {
    load().catch((e) => setError(String(e)));
  }, [load]);

  const pick = async (username: string) => {
    setError(null);
    const res = await fetch("/api/sim/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username }),
    });
    const data = await res.json();
    if (res.ok && data.token) onToken(data.token);
    else setError(data.error ?? `HTTP ${res.status}`);
  };

  const reset = async () => {
    if (!window.confirm("Xóa toàn bộ role đã cấp, policy đã ký và lịch sử để demo lại từ đầu?")) return;
    await fetch("/api/sim/reset", { method: "POST" });
    await load();
  };

  const button: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    width: "100%",
    padding: "0.7rem 0.9rem",
    background: "#16161a",
    border: "1px solid #2a2a30",
    borderRadius: 7,
    color: "#ededed",
    fontSize: "0.95rem",
    cursor: "pointer",
    fontFamily: "inherit",
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "#000a", display: "grid", placeItems: "center", padding: 16, zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 380, background: "#111113", border: "1px solid #2a2a30", borderRadius: 10, padding: "1.25rem" }}
      >
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Đăng nhập (mô phỏng Tide)</h2>
        <p style={{ color: "#8b8b94", fontSize: "0.85rem", marginTop: 0 }}>
          Mỗi tài khoản nên mở trong một browser profile riêng, như bản thật.
          {threshold !== null && <> Ngưỡng quorum hiện tại: <strong>{threshold}</strong>.</>}
        </p>
        {error && <p style={{ color: "#ef4444", fontSize: "0.85rem" }}>{error}</p>}
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {users === null && <span style={{ color: "#8b8b94" }}>Đang tải…</span>}
          {users?.map((u) => (
            <button key={u.username} onClick={() => pick(u.username)} style={button}>
              <span>{u.username}</span>
              <span style={{ color: "#8b8b94", fontSize: "0.82rem" }}>{u.admin ? "tide-realm-admin" : "nhân viên"}</span>
            </button>
          ))}
        </div>
        <button
          onClick={reset}
          style={{ marginTop: "1rem", background: "none", border: "none", color: "#8b8b94", fontSize: "0.8rem", cursor: "pointer", padding: 0, textDecoration: "underline" }}
        >
          Đặt lại dữ liệu demo
        </button>
      </div>
    </div>
  );
}

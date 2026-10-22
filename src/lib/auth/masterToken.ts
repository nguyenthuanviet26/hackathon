// masterToken.ts — mint a master-admin token, server-side, on demand.
//
// Used for exactly ONE thing in this app: reading the realm's signed `tide-realm-admin` policy
// bytes, which the enclave signing flow has to attach. That is a read, and the realm allows any
// authenticated caller to make it — but the browser cannot, because TideCloak is a different
// origin and the app's tokens are DPoP-bound to a key this server does not hold.
//
// It is NOT used to perform governed changes. Approving a change request with a credential like
// this is the bug AP-89 describes: `approve` credits whoever authenticated the HTTP request, so a
// server-side proxy would record every admin's enclave signature under one service identity and
// the quorum would never be reached. Governance approvals go straight from the admin's browser to
// TideCloak with the admin's own token. See src/app/governance/page.tsx.
//
// The password is read from the environment and has no default (AP-41). Tokens live ~60 seconds,
// so nothing is cached beyond that.

import { loadTideConfig } from "./tidecloakConfig";

interface CachedToken {
  token: string;
  /** ms since epoch */
  expiresAt: number;
}

let cached: CachedToken | null = null;

export function tidecloakBaseUrl(): string {
  // A trailing slash here produces `//admin/realms/...`, which answers with HTML instead of JSON.
  return loadTideConfig()["auth-server-url"].replace(/\/+$/, "");
}

export function realmName(): string {
  return loadTideConfig().realm;
}

async function mint(): Promise<CachedToken> {
  const username = process.env.KC_BOOTSTRAP_ADMIN_USERNAME;
  const password = process.env.KC_BOOTSTRAP_ADMIN_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "KC_BOOTSTRAP_ADMIN_USERNAME / KC_BOOTSTRAP_ADMIN_PASSWORD are not set. " +
        "They belong in .env (gitignored), never in code."
    );
  }

  // --data-urlencode equivalent: a password containing & = or + must survive the form encoding.
  const body = new URLSearchParams();
  body.set("grant_type", "password");
  body.set("client_id", "admin-cli");
  body.set("username", username);
  body.set("password", password);

  const res = await fetch(`${tidecloakBaseUrl()}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Could not mint a master-admin token (HTTP ${res.status})`);
  }

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Token endpoint returned no access_token");

  // Expire it early: a token that dies between the check and the call is a 401 for no reason.
  const lifetime = (data.expires_in ?? 60) * 1000;
  return { token: data.access_token, expiresAt: Date.now() + Math.max(5_000, lifetime - 10_000) };
}

export async function masterToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  cached = await mint();
  return cached.token;
}

/** Call the realm admin API with a master token, re-minting once on a 401 (the token is short-lived). */
export async function adminApi(path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${tidecloakBaseUrl()}/admin/realms/${realmName()}${path}`;

  const send = async (token: string) =>
    fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });

  let res = await send(await masterToken());
  if (res.status === 401) {
    cached = null;
    res = await send(await masterToken());
  }
  return res;
}

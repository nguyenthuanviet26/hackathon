// client.ts — the IGA (QEA) change-request API, called from the admin's BROWSER.
//
// Why the browser and not our server, which would be easier:
//
//   `approve` credits the approval to whoever authenticated the HTTP request. Proxy it through an
//   app server and every admin's enclave signature is recorded under that one server identity —
//   each caller counts once, so the tally sticks below quorum forever and later admins are never
//   even shown a challenge to sign. A service account that can both propose and approve holds two
//   of the votes the quorum exists to split. That is AP-89, and it is a security bug, not a
//   cosmetic one.
//
// So these calls go straight to TideCloak with the admin's own DPoP-bound token. The realm's CORS
// permits the app origin and the DPoP header. `secureFetch` attaches the proof; a plain fetch with
// a manual `Bearer` header is rejected by a `dpop.bound.access.tokens` realm.

export type AuthedFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The change-request shape this app reads. Field names matter — see the warnings below. */
export interface ChangeRequest {
  id: string;
  entityType: string;
  actionType: string;
  status: "PENDING" | "APPROVED" | "DENIED" | "CANCELLED";
  requestedBy?: string;
  createdAt?: string | number;
  /**
   * The approval tally. The LIST object uses `authorizationCount`, NOT `authCount` — reading the
   * wrong one and defaulting to 0 renders "0/2 signed" next to a request that is ready to commit.
   * Never default this to zero; fall back to `readyToCommit`.
   */
  authorizationCount?: number;
  authorizers?: { username?: string; timestamp?: string | number }[];
  threshold?: number;
  readyToCommit?: boolean;
  blocked?: boolean;
  blockedReason?: string;
  dependsOn?: string | null;
  rows?: unknown;
}

/** Reply from `/approve`. One endpoint, two shapes. */
export type ApproveReply =
  | {
      mode: "recorded";
      committed?: boolean;
      authCount?: number;
      threshold?: number;
      readyToCommit?: boolean;
      status?: string;
    }
  | {
      mode: "needs-approval";
      changeRequestId: string;
      actionType?: string;
      /** base64 — decode, sign in the enclave, POST back. */
      requestModel: string;
      authCount?: number;
      threshold?: number;
    };

/**
 * Change requests a drain must never touch. Approving one of these is approving the realm's own
 * destruction, and an unfiltered "approve everything" loop will happily do it.
 */
export const DESTRUCTIVE_ACTIONS = ["DISABLE_IGA", "DELETE_REALM", "OFFBOARD_REALM"] as const;

export function isDestructive(cr: ChangeRequest): boolean {
  return (DESTRUCTIVE_ACTIONS as readonly string[]).includes(cr.actionType);
}

const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

const bytesToB64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export class IgaClient {
  /**
   * @param baseUrl TideCloak origin, no trailing slash (a trailing slash gives `//admin/...`,
   *                which answers with HTML instead of JSON)
   * @param realm   the governed realm
   * @param fetcher `secureFetch` from useTideCloak — the admin's own token, with a DPoP proof
   */
  constructor(
    private baseUrl: string,
    private realm: string,
    private fetcher: AuthedFetch
  ) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, "")}/admin/realms/${this.realm}${path}`;
  }

  private async call(path: string, init?: RequestInit): Promise<Response> {
    return this.fetcher(this.url(path), {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  }

  private static async fail(res: Response, what: string): Promise<never> {
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body?.error === "string" ? body.error : JSON.stringify(body);
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(`${what} thất bại (HTTP ${res.status}) ${detail}`.trim());
  }

  /** Pending change requests. Re-fetch after EVERY mutation: the tally changes under you. */
  async listPending(): Promise<ChangeRequest[]> {
    const res = await this.call("/iga/change-requests?status=PENDING");
    if (!res.ok) return IgaClient.fail(res, "Đọc danh sách yêu cầu");
    const data = await res.json();
    return Array.isArray(data) ? (data as ChangeRequest[]) : [];
  }

  /** Requests in another state, e.g. APPROVED, to show what the quorum has just applied. */
  async listByStatus(status: ChangeRequest["status"]): Promise<ChangeRequest[]> {
    const res = await this.call(`/iga/change-requests?status=${status}`);
    if (!res.ok) return IgaClient.fail(res, "Đọc danh sách yêu cầu");
    const data = await res.json();
    return Array.isArray(data) ? (data as ChangeRequest[]) : [];
  }

  async get(id: string): Promise<ChangeRequest> {
    const res = await this.call(`/iga/change-requests/${id}`);
    if (!res.ok) return IgaClient.fail(res, "Đọc yêu cầu");
    return (await res.json()) as ChangeRequest;
  }

  /** Phase 1, and phase 2 when `signedRequestModel` is given. `/approve` commits by itself. */
  async approve(id: string, signedRequestModel?: Uint8Array): Promise<ApproveReply> {
    const res = await this.call(`/iga/change-requests/${id}/approve`, {
      method: "POST",
      body: JSON.stringify(signedRequestModel ? { requestModel: bytesToB64(signedRequestModel) } : {}),
    });
    if (!res.ok) return IgaClient.fail(res, "Phê duyệt");
    return (await res.json()) as ApproveReply;
  }

  async deny(id: string, reason?: string): Promise<void> {
    const res = await this.call(`/iga/change-requests/${id}/deny`, {
      method: "POST",
      body: JSON.stringify(reason ? { reason } : {}),
    });
    // 204 No Content on success.
    if (!res.ok) await IgaClient.fail(res, "Từ chối");
  }

  /** Explicit commit. `/approve` normally does this once quorum is met; this is the fallback. */
  async commit(id: string): Promise<void> {
    const res = await this.call(`/iga/change-requests/${id}/commit`, { method: "POST" });
    if (!res.ok) await IgaClient.fail(res, "Áp dụng thay đổi");
  }

  // --- the governed write this demo is about -------------------------------------------------

  async listUsers(): Promise<{ id: string; username: string; firstName?: string; lastName?: string }[]> {
    const res = await this.call("/users?max=100");
    if (!res.ok) return IgaClient.fail(res, "Đọc danh sách người dùng");
    return (await res.json()) as { id: string; username: string }[];
  }

  async getRealmRole(name: string): Promise<{ id: string; name: string }> {
    const res = await this.call(`/roles/${encodeURIComponent(name)}`);
    if (!res.ok) return IgaClient.fail(res, `Đọc role ${name}`);
    return (await res.json()) as { id: string; name: string };
  }

  /** Which realm roles a user already has. */
  async userRealmRoles(userId: string): Promise<{ id: string; name: string }[]> {
    const res = await this.call(`/users/${userId}/role-mappings/realm`);
    if (!res.ok) return IgaClient.fail(res, "Đọc role của người dùng");
    return (await res.json()) as { id: string; name: string }[];
  }

  /**
   * Propose granting a realm role. On an IGA realm this does NOT take effect: it answers 202 and
   * files a change request, which then needs the quorum. That is the entire point of the demo —
   * the admin who clicks this cannot complete it alone.
   */
  async proposeRoleGrant(userId: string, role: { id: string; name: string }): Promise<void> {
    const res = await this.call(`/users/${userId}/role-mappings/realm`, {
      method: "POST",
      body: JSON.stringify([role]),
    });
    // 202 = captured as a change request. 204/200 would mean IGA is OFF and it applied immediately.
    if (!res.ok) await IgaClient.fail(res, "Đề xuất cấp role");
  }

  /** Propose removing a realm role — equally governed. */
  async proposeRoleRevoke(userId: string, role: { id: string; name: string }): Promise<void> {
    const res = await this.call(`/users/${userId}/role-mappings/realm`, {
      method: "DELETE",
      body: JSON.stringify([role]),
    });
    if (!res.ok) await IgaClient.fail(res, "Đề xuất thu hồi role");
  }

  /** Whether IGA is actually on. If it is off, nothing on this page means anything. */
  async igaStatus(): Promise<{ enabled: boolean | null; raw: unknown }> {
    const res = await this.call("/tide-admin/iga-status");
    if (!res.ok) return { enabled: null, raw: `HTTP ${res.status}` };
    const data = await res.json().catch(() => null);
    const enabled =
      typeof data === "object" && data !== null
        ? (data as Record<string, unknown>).enabled ?? (data as Record<string, unknown>).isIGAEnabled
        : null;
    return { enabled: enabled === true || enabled === "true" ? true : enabled === false || enabled === "false" ? false : null, raw: data };
  }
}

/**
 * Drive one approval all the way through, in whichever mode the realm is in.
 *
 * Phase 1 tells us which ceremony applies. `recorded` means it is done (FirstAdmin/Tideless, or
 * this admin had already signed). `needs-approval` is Tide MultiAdmin: the returned model is
 * signed in the enclave and posted back. Treating the `needs-approval` reply as success is the
 * mistake that makes approvals silently not count (AP-G05).
 */
export async function approveWithEnclave(
  iga: IgaClient,
  id: string,
  enclave: (
    requests: { id: string; request: Uint8Array }[]
  ) => Promise<{ id: string; approved?: { request: Uint8Array }; denied?: boolean; pending?: boolean }[]>
): Promise<{ committed: boolean; authCount?: number; threshold?: number; usedEnclave: boolean }> {
  const first = await iga.approve(id);

  if (first.mode === "recorded") {
    return {
      committed: first.committed === true,
      authCount: first.authCount,
      threshold: first.threshold,
      usedEnclave: false,
    };
  }

  const [signed] = await enclave([{ id, request: b64ToBytes(first.requestModel) }]);
  if (!signed?.approved) {
    throw new Error(signed?.denied ? "Bạn đã từ chối trong enclave." : "Enclave không trả về chữ ký.");
  }

  const second = await iga.approve(id, signed.approved.request);
  if (second.mode !== "recorded") {
    throw new Error("Máy chủ vẫn yêu cầu ký lại sau khi đã gửi chữ ký — dừng để không ký vòng lặp.");
  }

  return {
    committed: second.committed === true,
    authCount: second.authCount,
    threshold: second.threshold,
    usedEnclave: true,
  };
}

/**
 * How many approvals a request has, and out of how many.
 *
 * `authorizationCount` is the list object's field. If it is absent, fall back to `readyToCommit`
 * rather than to 0 — otherwise the UI claims no one has signed at the exact moment the server
 * says the request is ready.
 */
export function tally(cr: ChangeRequest): { count: number | null; threshold: number | null; ready: boolean } {
  const count =
    typeof cr.authorizationCount === "number"
      ? cr.authorizationCount
      : Array.isArray(cr.authorizers)
        ? cr.authorizers.length
        : null;

  return {
    count,
    threshold: typeof cr.threshold === "number" ? cr.threshold : null,
    ready: cr.readyToCommit === true,
  };
}

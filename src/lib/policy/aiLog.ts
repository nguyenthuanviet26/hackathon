// aiLog.ts — the app's layer over the generic relationship helper.
//
// Two policies govern the one AI-log record, and they are what make the claim true:
//
//   write  subject Role `appUser`        grants ["_tide_encryptor"]  → every employee may append
//   read   subject Role `ai_log_reader`  grants ["_tide_decryptor"]  → only readers may open
//
// A realm admin signs each ONCE, in the enclave, from /admin/setup. After that the admin is out of
// the loop: who can read the history is decided purely by who holds `ai_log_reader`, and on an IGA
// realm that grant is a change request needing a quorum. So there is no "open the log" button for
// an admin to press alone — not because the UI hides it, but because the ORK network will not
// decrypt for a credential that does not carry the role.
//
// Browser only. Every function here needs the logged-in user's credential, which lives in the Tide
// enclave; a server cannot run any of it.

import { AI_LOG_RECORD_ID, ROLE_APP_USER, ROLE_LOG_READER, type PolicyKind } from "@/lib/log/record";
import {
  signRelationshipPolicy,
  describeRelationshipPolicy,
  encryptForRecord,
  decryptForRecord,
  type RelationshipGrant,
  type SigningBridge,
  type CryptoBridge,
} from "./relationship";

/** A fetch that carries the logged-in user's token (and its DPoP proof). */
export type AuthedFetch = (input: string, init?: RequestInit) => Promise<Response>;

const GRANTS: Record<PolicyKind, Pick<RelationshipGrant, "subject" | "access">> = {
  write: { subject: { type: "Role", id: ROLE_APP_USER }, access: "write" },
  read: { subject: { type: "Role", id: ROLE_LOG_READER }, access: "read" },
};

export interface PolicyState {
  kind: PolicyKind;
  signed: boolean;
  /** base64 signed policy, when it exists. */
  policy: string | null;
  /** Why it is not available, when it is not. */
  reason: string | null;
}

/** Fetch one signed policy from our own server. */
export async function fetchSignedPolicy(kind: PolicyKind, authedFetch: AuthedFetch): Promise<PolicyState> {
  const res = await authedFetch(`/api/policy?kind=${kind}`);
  const data = (await res.json().catch(() => ({}))) as { policy?: string; error?: string };

  if (res.ok && typeof data.policy === "string") {
    return { kind, signed: true, policy: data.policy, reason: null };
  }
  return { kind, signed: false, policy: null, reason: data.error ?? `HTTP ${res.status}` };
}

/** The realm's admin policy bytes, which the signing flow must attach. Admin-only route. */
async function fetchAdminPolicyBytes(authedFetch: AuthedFetch): Promise<Uint8Array> {
  const res = await authedFetch("/api/policy/admin");
  const data = (await res.json().catch(() => ({}))) as { policyBytes?: number[]; error?: string };

  if (!res.ok || !Array.isArray(data.policyBytes)) {
    throw new Error(data.error ?? `Could not read the realm's admin policy (HTTP ${res.status})`);
  }
  return new Uint8Array(data.policyBytes);
}

/**
 * Sign one of the two policies and store it. Opens the Tide enclave: the admin approves there,
 * and that approval is the grant.
 *
 * Runs in a `tide-realm-admin`'s browser. `vendorId` comes from the adapter JSON — the SDK's
 * in-memory config does not carry it.
 */
export async function signAndStoreLogPolicy(
  kind: PolicyKind,
  vendorId: string,
  authedFetch: AuthedFetch,
  sdk: SigningBridge
): Promise<void> {
  if (!vendorId) {
    throw new Error("vendorId is missing from data/tidecloak.json — the realm is not licensed.");
  }

  const adminPolicy = await fetchAdminPolicyBytes(authedFetch);

  const signedB64 = await signRelationshipPolicy(
    { vendorId, recordId: AI_LOG_RECORD_ID, ...GRANTS[kind] },
    adminPolicy,
    sdk
  );

  // Read back what was actually signed and send it with the bytes. The server checks this against
  // what it expects before handing the policy to anyone (AP-RA08).
  const descriptor = describeRelationshipPolicy(signedB64);

  const res = await authedFetch("/api/policy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, policy: signedB64, descriptor }),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Storing the ${kind} policy failed (HTTP ${res.status})`);
  }
}

/** Encrypt a transcript for the log. The record id is the only tag the contract permits. */
export function encryptTranscript(
  text: string,
  writePolicyB64: string,
  crypto: CryptoBridge
): Promise<string> {
  return encryptForRecord(text, AI_LOG_RECORD_ID, writePolicyB64, crypto);
}

/** Open a stored transcript. Works only in a browser whose credential satisfies the read policy. */
export function decryptTranscript(
  ciphertext: string,
  readPolicyB64: string,
  crypto: CryptoBridge
): Promise<string> {
  return decryptForRecord(ciphertext, AI_LOG_RECORD_ID, readPolicyB64, crypto);
}

/**
 * Turn a network error from an encrypt/decrypt into something true.
 *
 * A refusal by the contract arrives as `TIDE-TIDEJS-NET-THRESHOLD_FAILURE` — "could not reach
 * enough VVK ORKs" — which reads like an outage and is not one: every ORK answered, and they all
 * said no. Retrying cannot help, and telling the user "service unavailable" is the wrong thing
 * (AP-RA18). The contract's own message is in the error's `cause`.
 */
export function explainCryptoError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && err.cause ? String((err.cause as Error).message ?? err.cause) : "";
  const all = `${message} ${cause}`;

  const refusals: [RegExp, string][] = [
    [/role not found in doken/i, `Tài khoản này chưa có role ${ROLE_LOG_READER} — cần quorum admin duyệt mới cấp được.`],
    [/_tide_decryptor.*not found/i, "Tài khoản này chưa có quyền giải mã (_tide_decryptor)."],
    [/_tide_encryptor.*not found/i, "Tài khoản này chưa có quyền ghi log (_tide_encryptor)."],
    [/not found in list of roles/i, "Policy đã ký không cho phép thao tác này."],
    [/subjectId does not match/i, "Policy này không dành cho tài khoản đang đăng nhập."],
    [/Tags do not contain assignmentId|must be tagged/i, "Sai tag: mỗi bản ghi chỉ được mang đúng một tag là id của record."],
    [/Policy supplied has not been signed/i, "Policy chưa được ký — admin cần ký ở /admin/setup."],
  ];

  for (const [pattern, vi] of refusals) {
    if (pattern.test(all)) return vi;
  }

  if (/THRESHOLD_FAILURE|reach enough/i.test(all)) {
    // Unmatched threshold failure: could be a genuine refusal whose message we did not recognise,
    // or a real outage. Say both rather than picking one.
    return (
      "Mạng ORK từ chối yêu cầu. Thường đây là contract từ chối (thiếu role/sai tag), không phải mất mạng. " +
      `Chi tiết: ${cause || message}`
    );
  }

  return message;
}

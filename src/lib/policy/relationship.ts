// relationship.ts — give a role (or a user, or a group) access to ONE record's encrypted data,
// enforced by the Tide network rather than by this app.
//
// Uses the ORK's built-in contract `RelationshipAttestation:1` (revision 3). There is no contract
// to write, compile or deploy: a policy names the contract by id, a realm admin approves the
// policy once in the enclave, and from then on the network lets only that SUBJECT encrypt (realm
// role `_tide_encryptor`) or decrypt (realm role `_tide_decryptor`) data tagged with that
// record's id — and only the operations the policy grants.
//
// Derived from the Tide pack's reference file (templates/relationship-attestation/relationship.ts).
// The policy construction below is kept byte-for-byte equivalent to it, because every field is
// load-bearing and the ORK rejects anything else. What IS changed: the pack's version reaches into
// `IAMService._tc` for the three signing calls, and this SDK (@tidecloak/react 0.14.17) exposes
// them as supported hook functions — `initializeTideRequest`, `approveTideRequests`,
// `executeTideRequest` — with a different approval-result shape. They are passed in rather than
// reached for, so this file has no hidden dependency on SDK internals and is testable.
//
// Browser only: every call needs the logged-in user's credential, which lives in the Tide enclave.
//
// STATUS: the contract's rules are VERIFIED from the ORK source (ORK main @ c69fc4f6, 2026-10-16)
// and were MEASURED end to end on 2026-10-16 (User, Group and realm/client Role policies, plus the
// refusals). This adaptation has not itself been run against a network.

import { Models } from "@tideorg/js";
import { PolicySignRequest } from "heimdall-tide";

// Fixed by the contract. Changing any of these makes the network refuse the policy or the request.
export const RELATIONSHIP_CONTRACT_ID = "RelationshipAttestation:1";
export const RELATIONSHIP_MODEL_IDS = ["PolicyEnabledEncryption:1", "PolicyEnabledDecryption:1"];
export const ENCRYPT_ROLE = "_tide_encryptor"; // REALM roles, not client roles
export const DECRYPT_ROLE = "_tide_decryptor";

const SIGN_REQUEST_EXPIRY_SECONDS = 604800; // one week to complete the signing request itself

/** Who a policy is for. */
export type RelationshipSubject =
  | { type: "User"; id: string } // id: the grantee's tideuserkey claim, verbatim
  | { type: "Group"; id: string } // id: the FULL PATH, exactly as the `groups` claim carries it
  | { type: "Role"; id: string; clientId?: string }; // realm role, or a client role of clientId

/** What a policy lets its subject do with the record. */
export type RelationshipAccess = "read" | "write" | "read-write";

const ROLES_FOR: Record<RelationshipAccess, string[]> = {
  read: [DECRYPT_ROLE],
  write: [ENCRYPT_ROLE],
  "read-write": [ENCRYPT_ROLE, DECRYPT_ROLE],
};

export interface RelationshipGrant {
  /** The realm's vendorId, from the adapter JSON (the hook's `getVendorId()`). */
  vendorId: string;
  /** Who gets the record. For a User subject: the GRANTEE's tideuserkey — not the admin's (AP-RA02). */
  subject: RelationshipSubject;
  /** The record this subject may open. It is also the only tag every item must carry. */
  recordId: string;
  /** What the subject may do. Read-only is the safe default for a reviewer (AP-RA16). */
  access: RelationshipAccess;
  /** Optional: seconds since the epoch after which the policy stops working. Prefer a short one. */
  expiry?: number;
}

/** The three SDK calls the signing flow needs, as the hook provides them. */
export interface SigningBridge {
  initializeTideRequest: <T extends { encode: () => Uint8Array }>(request: T) => Promise<T>;
  approveTideRequests: (
    requests: { id: string; request: Uint8Array }[]
  ) => Promise<{ id: string; approved?: { request: Uint8Array }; denied?: boolean; pending?: boolean }[]>;
  executeTideRequest: (
    request: { encode: () => Uint8Array } | Uint8Array,
    waitForAll?: boolean
  ) => Promise<Uint8Array[]>;
}

const toBase64 = (bytes: Uint8Array) => {
  let s = "";
  // Chunked: String.fromCharCode(...bytes) blows the argument limit on a large policy.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
};

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function buildRelationshipPolicy(grant: RelationshipGrant) {
  const subject = grant.subject;
  if (!subject || !["User", "Group", "Role"].includes(subject.type)) {
    throw new Error('subject.type must be "User", "Group" or "Role"');
  }
  if (!subject.id) {
    throw new Error(
      subject.type === "User"
        ? "the grantee has no tideuserkey: they must sign in once first"
        : `subject.id (the ${subject.type.toLowerCase()}) is required`
    );
  }
  if (!grant.recordId) throw new Error("recordId is required");
  if (!ROLES_FOR[grant.access]) throw new Error('access must be "read", "write" or "read-write"');

  return new Models.Policy({
    // The SDK only writes its own latest policy version. Never hard-code it (AP-RA09).
    version: Models.Policy.latestVersion,
    contractId: RELATIONSHIP_CONTRACT_ID,
    modelId: RELATIONSHIP_MODEL_IDS,
    keyId: grant.vendorId,
    approvalType: Models.ApprovalType.IMPLICIT,
    executionType: Models.ExecutionType.PRIVATE,
    // All params are STRINGS. `roles` is a JSON array written as a string, not an array (AP-RA10).
    params: new Map<string, string>([
      ["subjectType", subject.type],
      ["subjectId", subject.id],
      ...(subject.type === "Role" && subject.clientId
        ? ([["clientId", subject.clientId]] as [string, string][])
        : []),
      ["assignmentId", grant.recordId],
      ["roles", JSON.stringify(ROLES_FOR[grant.access])],
    ]),
    ...(grant.expiry ? { expiry: grant.expiry } : {}),
  });
}

/**
 * Sign a relationship policy. Runs in a realm admin's browser: it opens the Tide enclave, where
 * the admin approves. **That approval is the grant.**
 *
 * `adminPolicy` is the realm's signed `tide-realm-admin` policy bytes, which authorise the
 * signing. Without them the ORKs answer "Policy supplied has not been signed".
 *
 * Returns the signed policy as base64.
 */
export async function signRelationshipPolicy(
  grant: RelationshipGrant,
  adminPolicy: Uint8Array,
  sdk: SigningBridge
): Promise<string> {
  const policy = buildRelationshipPolicy(grant);

  // The contract is built into the ORK, so the request carries the policy and NO contract source.
  const request = PolicySignRequest.New(policy);
  request.setCustomExpiry(SIGN_REQUEST_EXPIRY_SECONDS);

  // 1. Initialise: the network stamps the request. The hook decodes the result back for us.
  const initialised = await sdk.initializeTideRequest(request);

  // 2. Approve: the admin signs in the enclave popup.
  const [approval] = await sdk.approveTideRequests([
    { id: initialised.getUniqueId(), request: initialised.encode() },
  ]);
  if (!approval?.approved) {
    throw new Error(
      approval?.denied
        ? "the admin denied the grant in the enclave"
        : "the grant was not approved (the enclave returned no signature)"
    );
  }

  // 3. Attach the realm's admin policy to the APPROVED request, as raw bytes. Attaching anything
  //    during construction instead makes step 1 fail outright.
  const approved = Models.BaseTideRequest.decode(approval.approved.request);
  approved.addPolicy(adminPolicy);

  // 4. Execute. waitForAll MUST be true: a partial set of signatures is not a signed policy.
  const signatures = await sdk.executeTideRequest(approved, true);
  if (!signatures?.[0]) throw new Error("the network returned no signature");

  // 5. Only now does toBytes() carry the VVK signature.
  policy.signature = signatures[0];
  return toBase64(policy.toBytes());
}

/** What a stored policy says — for showing an admin, and for checking it before storing it. */
export function describeRelationshipPolicy(signedPolicyB64: string) {
  const p = Models.Policy.from(fromBase64(signedPolicyB64));
  const param = (k: string) => String(p.params.entries.get(k) ?? "");
  return {
    contractId: p.contractId,
    subjectType: param("subjectType"),
    subjectId: param("subjectId"),
    clientId: param("clientId"),
    recordId: param("assignmentId"),
    roles: param("roles"),
    signed: !!p.signature && p.signature.length > 0,
    isRelationshipPolicy: p.contractId === RELATIONSHIP_CONTRACT_ID,
  };
}

/** The encrypt/decrypt pair from the hook. Policy-governed, so the policy is always passed. */
export interface CryptoBridge {
  doEncrypt: (data: unknown, decryptionPolicy?: Uint8Array) => Promise<unknown>;
  doDecrypt: (data: unknown, decryptionPolicy?: Uint8Array) => Promise<unknown>;
}

/**
 * Encrypt one item for a record. The record id is the ONLY tag — a second tag, or a different
 * one, is refused by the contract (AP-RA03).
 */
export async function encryptForRecord(
  data: string,
  recordId: string,
  signedPolicyB64: string,
  crypto: CryptoBridge
): Promise<string> {
  const out = (await crypto.doEncrypt(
    [{ data, tags: [recordId] }],
    fromBase64(signedPolicyB64)
  )) as (string | Uint8Array)[] | null;

  const first = out?.[0];
  if (first === undefined || first === null) throw new Error("encryption returned nothing");
  return typeof first === "string" ? first : toBase64(first);
}

export async function decryptForRecord(
  encrypted: string,
  recordId: string,
  signedPolicyB64: string,
  crypto: CryptoBridge
): Promise<string> {
  const out = (await crypto.doDecrypt(
    [{ encrypted, tags: [recordId] }],
    fromBase64(signedPolicyB64)
  )) as (string | Uint8Array)[] | null;

  const first = out?.[0];
  if (first === undefined || first === null) throw new Error("decryption returned nothing");
  return typeof first === "string" ? first : new TextDecoder().decode(first);
}

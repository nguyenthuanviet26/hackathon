// record.ts — the names the app, the realm and the signed policies all have to agree on.
//
// Change one of these and you must re-sign the policies and re-bootstrap the realm, so they live
// in one file rather than being typed in five places.

/**
 * The AI log is ONE record in the `RelationshipAttestation:1` sense: one `assignmentId`, and
 * therefore the ONE tag every encrypted transcript carries. The contract rejects an item with any
 * other tag, or with a second tag, so per-entry tags are not an option — entry metadata stays
 * outside the ciphertext.
 *
 * Two policies are signed against this record, once each, by an admin in the enclave:
 *   - write: subject Role `appUser`,      roles ["_tide_encryptor"]  → employees may append
 *   - read:  subject Role `ai_log_reader`, roles ["_tide_decryptor"] → only readers may open
 *
 * Because the subjects are ROLES, the admin signs once and never again: after that, who can read
 * the history is decided purely by who holds `ai_log_reader` — and on an IGA realm that grant is a
 * change request needing a quorum. That is the whole claim.
 */
export const AI_LOG_RECORD_ID = "worksafe-ai-log";

/** Held by every employee (default composite). Subject of the write policy. */
export const ROLE_APP_USER = "appUser";

/**
 * The loosening. Holding it makes the server send raw phone numbers and emails to the model.
 * Not in the default composite: it is granted one user at a time, through a governed change
 * request, and the quorum is what stops a single admin granting it.
 */
export const ROLE_EXPORT_CONTACT = "ai_export_contact";

/** Subject of the read policy. Holding it (plus `_tide_decryptor`) opens the encrypted history. */
export const ROLE_LOG_READER = "ai_log_reader";

/** Capability roles, names fixed by the ORK contract. Granted per user, never by default. */
export const ROLE_ENCRYPTOR = "_tide_encryptor";
export const ROLE_DECRYPTOR = "_tide_decryptor";

/** The client role that marks a realm admin. A CLIENT role on `realm-management` (AP-G09). */
export const ADMIN_ROLE = "tide-realm-admin";
export const ADMIN_ROLE_CLIENT = "realm-management";

/** Which policy a stored row is. */
export type PolicyKind = "write" | "read";

/** The key a signed policy is stored under. */
export function policyKey(kind: PolicyKind): string {
  return `${AI_LOG_RECORD_ID}:${kind}`;
}

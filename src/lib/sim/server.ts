// server.ts — the simulated TideCloak + ORK network (Plan C). Server only.
//
// Stands in for the three things the live realm would do, keeping the rules the live realm
// enforces, so the app above it runs unchanged:
//
//   identity   users, realm roles and the `tide-realm-admin` client role, in signed tokens. Roles
//              are copied into the token at login, so — exactly as live — a newly granted role is
//              only seen after logging out and in again.
//   IGA        a role grant is a change request. Each admin counts once, the approval is credited
//              to the caller's own token (AP-89), and the threshold is TideCloak's own formula:
//              max(1, floor(0.7 × admins)).
//   ORK        signs RelationshipAttestation-shaped policies and does policy-gated encrypt and
//              decrypt. The key lives here, in data/sim/ork.key, never next to the log store, and
//              decrypt refuses a caller who lacks the policy's subject role or `_tide_decryptor`.
//
// What it does NOT simulate, said plainly: in the live system the key is split across independent
// ORK nodes and no single machine — this one included — can decrypt alone. Here one process holds
// it. That is the honest cost of Plan C, and the banner on every page says so.

import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import {
  ADMIN_ROLE,
  ADMIN_ROLE_CLIENT,
  ROLE_APP_USER,
  ROLE_DECRYPTOR,
  ROLE_ENCRYPTOR,
} from "@/lib/log/record";
import { SIMULATED, SIM_REALM } from "@/lib/tide/mode";

const DATA = join(process.cwd(), "data");
const SIM_DIR = join(DATA, "sim");
const STATE_FILE = join(SIM_DIR, "state.json");

export const SIM_CLIENT = `${SIM_REALM}-client`;
const ISSUER = `simulated-tidecloak/realms/${SIM_REALM}`;
const TOKEN_TTL = "8h";

export const RELATIONSHIP_CONTRACT_ID = "RelationshipAttestation:1";

// --- persistence ---------------------------------------------------------------------------------

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(SIM_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, file);
}

/** A random secret, created once and kept on disk so tokens and ciphertext survive a restart. */
function secret(name: string): Buffer {
  const file = join(SIM_DIR, name);
  if (existsSync(file)) return Buffer.from(readFileSync(file, "utf-8").trim(), "base64");
  const key = randomBytes(32);
  mkdirSync(SIM_DIR, { recursive: true });
  writeFileSync(file, key.toString("base64"), { mode: 0o600 });
  return key;
}

const tokenKey = () => secret("token.key");
const orkKey = () => secret("ork.key");

// --- realm state ---------------------------------------------------------------------------------

export interface SimUser {
  id: string;
  username: string;
  realmRoles: string[];
  admin: boolean;
}

export interface SimChangeRequest {
  id: string;
  entityType: "USER_ROLE_MAPPING";
  actionType: "GRANT_ROLE" | "REVOKE_ROLE";
  status: "PENDING" | "APPROVED" | "DENIED" | "CANCELLED";
  requestedBy: string;
  createdAt: string;
  userId: string;
  role: string;
  authorizers: { userId: string; username: string; timestamp: string }[];
}

interface SimState {
  users: SimUser[];
  changeRequests: SimChangeRequest[];
}

/** The same four accounts `npm run init` creates. Admins get encryptor too, so they can log. */
function seed(): SimState {
  const base = [ROLE_APP_USER, ROLE_ENCRYPTOR];
  return {
    users: [
      { id: randomUUID(), username: "admin", realmRoles: base, admin: true },
      { id: randomUUID(), username: "admin2", realmRoles: base, admin: true },
      { id: randomUUID(), username: "admin3", realmRoles: base, admin: true },
      { id: randomUUID(), username: "nhanvien", realmRoles: base, admin: false },
    ],
    changeRequests: [],
  };
}

export function readState(): SimState {
  const state = readJson<SimState | null>(STATE_FILE, null);
  if (state && Array.isArray(state.users)) return state;
  const fresh = seed();
  writeJson(STATE_FILE, fresh);
  return fresh;
}

export function writeState(state: SimState): void {
  writeJson(STATE_FILE, state);
}

/** Wipe the realm, the stored policies and the log, for a clean demo run. Keys are kept. */
export function resetAll(): void {
  writeJson(STATE_FILE, seed());
  rmSync(join(DATA, "ailog"), { recursive: true, force: true });
  rmSync(join(DATA, "policies"), { recursive: true, force: true });
}

/** TideCloak's own formula. Three admins → 2; two admins → 1, which is why the demo uses three. */
export function threshold(state: SimState): number {
  const admins = state.users.filter((u) => u.admin).length;
  return Math.max(1, Math.floor(0.7 * admins));
}

// --- tokens --------------------------------------------------------------------------------------

export async function issueToken(user: SimUser): Promise<string> {
  return new SignJWT({
    preferred_username: user.username,
    azp: SIM_CLIENT,
    realm_access: { roles: [...user.realmRoles] },
    resource_access: user.admin ? { [ADMIN_ROLE_CLIENT]: { roles: [ADMIN_ROLE] } } : {},
    simulated: true,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(tokenKey());
}

export async function verifySimToken(token: string): Promise<JWTPayload> {
  if (!SIMULATED) throw new Error("Simulated tokens are not accepted against a live realm");
  const { payload } = await jwtVerify(token, tokenKey(), { issuer: ISSUER, algorithms: ["HS256"] });
  if (payload.azp !== SIM_CLIENT) throw new Error("Token azp does not match client");
  return payload;
}

/** Every simulation route starts with this: no simulation endpoints on a live realm. */
export function simOnly(): Response | null {
  return SIMULATED ? null : Response.json({ error: "Not found" }, { status: 404 });
}

// --- simulated ORK: policies ---------------------------------------------------------------------

export interface SimPolicyParams {
  subjectType: "Role";
  subjectId: string;
  assignmentId: string;
  /** JSON array as a string, as the real contract carries it. */
  roles: string;
}

interface SimPolicy {
  contractId: string;
  simulated: true;
  params: SimPolicyParams;
  signedBy: string;
  signature: string;
}

function policyMac(p: Omit<SimPolicy, "signature">): string {
  const canonical = JSON.stringify([p.contractId, p.params.subjectType, p.params.subjectId, p.params.assignmentId, p.params.roles, p.signedBy]);
  return createHmac("sha256", orkKey()).update(canonical).digest("base64");
}

export function signPolicy(params: SimPolicyParams, signedBy: string): string {
  const unsigned = { contractId: RELATIONSHIP_CONTRACT_ID, simulated: true as const, params, signedBy };
  const policy: SimPolicy = { ...unsigned, signature: policyMac(unsigned) };
  return Buffer.from(JSON.stringify(policy)).toString("base64");
}

/** Parse and verify a policy. Throws with the contract's own wording on anything wrong. */
export function openPolicy(b64: string): SimPolicy {
  let p: SimPolicy;
  try {
    p = JSON.parse(Buffer.from(b64, "base64").toString("utf-8")) as SimPolicy;
  } catch {
    throw new Error("Policy supplied has not been signed");
  }
  const expected = Buffer.from(policyMac(p));
  const given = Buffer.from(String(p.signature ?? ""));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new Error("Policy supplied has not been signed");
  }
  return p;
}

export function describePolicy(b64: string) {
  const p = openPolicy(b64);
  return {
    contractId: p.contractId,
    subjectType: p.params.subjectType,
    subjectId: p.params.subjectId,
    clientId: "",
    recordId: p.params.assignmentId,
    roles: p.params.roles,
    signed: true,
    isRelationshipPolicy: p.contractId === RELATIONSHIP_CONTRACT_ID,
  };
}

// --- simulated ORK: encrypt / decrypt ------------------------------------------------------------

/**
 * The contract's checks, in the contract's order and with its wording, so the app's existing
 * error explainer (explainCryptoError) maps them exactly as it would the live refusals.
 */
function authorise(policy: SimPolicy, jwtRoles: string[], tags: unknown, capability: string): string {
  const { subjectId, assignmentId, roles } = policy.params;

  if (!Array.isArray(tags) || tags.length !== 1 || tags[0] !== assignmentId) {
    throw new Error(`Tags do not contain assignmentId ${assignmentId}: items must be tagged with exactly the record id`);
  }
  if (!jwtRoles.includes(subjectId)) {
    throw new Error(`Role ${subjectId} not found in doken`);
  }
  if (!(JSON.parse(roles) as string[]).includes(capability)) {
    throw new Error(`${capability} not found in list of roles the policy grants`);
  }
  if (!jwtRoles.includes(capability)) {
    throw new Error(`${capability} not found in doken`);
  }
  return assignmentId;
}

export function orkEncrypt(items: { data?: unknown; tags?: unknown }[], policyB64: string, jwtRoles: string[]): string[] {
  const policy = openPolicy(policyB64);
  return items.map((item) => {
    const recordId = authorise(policy, jwtRoles, item.tags, ROLE_ENCRYPTOR);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", orkKey(), iv);
    cipher.setAAD(Buffer.from(recordId));
    const body = Buffer.concat([cipher.update(String(item.data ?? ""), "utf-8"), cipher.final()]);
    return "simtide1:" + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
  });
}

export function orkDecrypt(items: { encrypted?: unknown; tags?: unknown }[], policyB64: string, jwtRoles: string[]): string[] {
  const policy = openPolicy(policyB64);
  return items.map((item) => {
    const recordId = authorise(policy, jwtRoles, item.tags, ROLE_DECRYPTOR);
    const text = String(item.encrypted ?? "");
    if (!text.startsWith("simtide1:")) throw new Error("Not a ciphertext this network produced");
    const raw = Buffer.from(text.slice("simtide1:".length), "base64");
    const decipher = createDecipheriv("aes-256-gcm", orkKey(), raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(recordId));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf-8");
  });
}

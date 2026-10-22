import { NextRequest } from "next/server";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { withAuth, withRole } from "@/lib/auth/middleware";
import { hasRole } from "@/lib/auth/tideJWT";
import {
  ADMIN_ROLE,
  AI_LOG_RECORD_ID,
  ROLE_APP_USER,
  ROLE_LOG_READER,
  policyKey,
  type PolicyKind,
} from "@/lib/log/record";

// The two signed policies for the AI-log record: one that lets employees append, one that lets
// `ai_log_reader` holders open it. An admin signs each once in the enclave (/admin/setup) and the
// signed bytes are stored here so every browser can fetch the one it needs.
//
// Storing them is not a security boundary — a policy only works for a caller who already matches
// its subject and holds the capability role. It is still kept tight: only an admin may write one
// (otherwise anyone could overwrite a good policy with junk and lock the company out, AP-RA08),
// and a caller is only handed the policy that could work for them (AP-RA07 — the bytes name who
// has access, so they are not public reading).

const DATA_DIR = join(process.cwd(), "data", "policies");
const FILE = join(DATA_DIR, "signed.json");

interface StoredPolicy {
  kind: PolicyKind;
  recordId: string;
  /** Subject role the policy names. */
  subjectRole: string;
  /** The signed policy, base64 — exactly what the SDK returned. */
  policy: string;
  storedAt: string;
  storedBy: string;
}

type Store = Record<string, StoredPolicy>;

/** What each policy must say. The server checks the client's claim against this, not the reverse. */
const EXPECTED: Record<PolicyKind, { subjectRole: string }> = {
  write: { subjectRole: ROLE_APP_USER },
  read: { subjectRole: ROLE_LOG_READER },
};

function readStore(): Store {
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2));
  renameSync(tmp, FILE);
}

function isKind(v: unknown): v is PolicyKind {
  return v === "read" || v === "write";
}

/** Base64 that decodes to something policy-shaped. Not a signature check — the ORKs do that. */
function looksLikePolicyBytes(b64: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return false;
  const len = Buffer.from(b64, "base64").length;
  return len >= 64 && len <= 64 * 1024;
}

// GET /api/policy?kind=read|write
//
// `write` goes to any authenticated employee; it is what lets them append to the log.
// `read` goes only to a caller who holds `ai_log_reader` — the only caller it could work for.
export const GET = withAuth(async (req: NextRequest, jwt) => {
  const kind = new URL(req.url).searchParams.get("kind");
  if (!isKind(kind)) {
    return Response.json({ error: "kind must be 'read' or 'write'" }, { status: 400 });
  }

  if (kind === "read" && !hasRole(jwt, ROLE_LOG_READER) && !hasRole(jwt, ADMIN_ROLE)) {
    // Not "not found": say what is missing, so a reader waiting on a quorum knows where they stand.
    return Response.json(
      { error: `Reading the AI history needs the ${ROLE_LOG_READER} role.` },
      { status: 403 }
    );
  }

  const stored = readStore()[policyKey(kind)];
  if (!stored) {
    return Response.json(
      {
        error:
          `The ${kind} policy for this record has not been signed yet. ` +
          `A realm admin signs it once, in the enclave, at /admin/setup.`,
        signed: false,
      },
      { status: 409 }
    );
  }

  return Response.json({
    signed: true,
    kind: stored.kind,
    recordId: stored.recordId,
    subjectRole: stored.subjectRole,
    policy: stored.policy,
    storedAt: stored.storedAt,
  });
});

// POST /api/policy — store a policy an admin has just had the network sign.
// Body: { kind, policy (base64), descriptor: { recordId, subjectType, subjectId, roles, signed } }
export const POST = withRole(ADMIN_ROLE, async (req: NextRequest, jwt) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { kind, policy, descriptor } = (body ?? {}) as Record<string, unknown>;

  if (!isKind(kind)) {
    return Response.json({ error: "kind must be 'read' or 'write'" }, { status: 400 });
  }
  if (typeof policy !== "string" || !looksLikePolicyBytes(policy)) {
    return Response.json({ error: "policy must be base64 policy bytes" }, { status: 400 });
  }

  // The descriptor is read back out of the signed bytes by the admin's browser
  // (describeRelationshipPolicy). Checking it here catches the mistakes that actually happen —
  // the wrong record, the wrong subject, an unsigned policy, a read policy stored as the write
  // one — before they are handed to every employee. It is a sanity check on an already
  // admin-authenticated call, not the authorization: the ORKs enforce the policy itself.
  const d = (descriptor ?? {}) as Record<string, unknown>;
  const expected = EXPECTED[kind];
  const problems: string[] = [];

  if (d.isRelationshipPolicy !== true) problems.push("not a RelationshipAttestation:1 policy");
  if (d.signed !== true) problems.push("the policy carries no signature");
  if (d.recordId !== AI_LOG_RECORD_ID) {
    problems.push(`recordId is ${JSON.stringify(d.recordId)}, expected ${AI_LOG_RECORD_ID}`);
  }
  if (d.subjectType !== "Role") problems.push(`subjectType is ${JSON.stringify(d.subjectType)}, expected Role`);
  if (d.subjectId !== expected.subjectRole) {
    problems.push(`subjectId is ${JSON.stringify(d.subjectId)}, expected ${expected.subjectRole}`);
  }

  const roles = typeof d.roles === "string" ? d.roles : "";
  const wantsEncrypt = roles.includes("_tide_encryptor");
  const wantsDecrypt = roles.includes("_tide_decryptor");
  if (kind === "write" && !wantsEncrypt) problems.push("the write policy does not grant _tide_encryptor");
  if (kind === "read" && !wantsDecrypt) problems.push("the read policy does not grant _tide_decryptor");
  // A read policy that also grants writing lets a reviewer edit the evidence (AP-RA16).
  if (kind === "read" && wantsEncrypt) problems.push("the read policy must not grant _tide_encryptor");

  if (problems.length > 0) {
    return Response.json({ error: `Refused: ${problems.join("; ")}` }, { status: 400 });
  }

  const store = readStore();
  store[policyKey(kind)] = {
    kind,
    recordId: AI_LOG_RECORD_ID,
    subjectRole: expected.subjectRole,
    policy,
    storedAt: new Date().toISOString(),
    storedBy: typeof jwt.preferred_username === "string" ? jwt.preferred_username : jwt.sub!,
  };
  writeStore(store);

  return Response.json({ stored: true, kind }, { status: 201 });
});

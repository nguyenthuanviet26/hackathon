import { NextRequest } from "next/server";
import type { JWTPayload } from "jose";
import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { withAuth } from "@/lib/auth/middleware";
import { hasRole } from "@/lib/auth/tideJWT";
import { ADMIN_ROLE, ROLE_LOG_READER, AI_LOG_RECORD_ID } from "@/lib/log/record";
import type { RuleId } from "@/lib/redact";

// The AI history. This server stores CIPHERTEXT and metadata, never a transcript.
//
// The ciphertext was produced in the employee's browser under the record's write policy, and can
// only be opened in a browser whose credential satisfies the read policy — subject role
// `ai_log_reader`, plus the `_tide_decryptor` capability. Neither this process nor whoever holds
// the database has a key, so "read the employees' AI history" is not an operation this server can
// perform for anybody, however they ask.
//
// Scope, stated plainly: this is the history THE COMPANY keeps. What the AI provider keeps on
// their own side is a matter of the contract with them, not of this code.

const DATA_DIR = join(process.cwd(), "data", "ailog");
const FILE = join(DATA_DIR, "entries.json");

/** Cleartext metadata. Enough to audit and to notice a pattern; not enough to read the content. */
export interface LogEntry {
  id: string;
  /** Realm user id (`sub`) of the employee who sent it. */
  userId: string;
  username: string;
  at: string;
  /** The transcript, encrypted under the record's write policy. The only copy. */
  ciphertext: string;
  /** Always the record id — the single tag the contract permits. Stored so a reader knows it. */
  recordId: string;
  /** Which rules fired, for audit. No values. */
  rulesFired: RuleId[];
  /** Rules whose raw values were sent because the sender held the unlocking role. */
  relaxed: RuleId[];
  /** Roles the server used when it redacted. Shows WHY a value was let through. */
  rolesUsed: string[];
}

function readAll(): LogEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(entries: LogEntry[]): void {
  mkdirSync(DATA_DIR, { recursive: true });
  // Write-then-rename: a crash mid-write leaves the previous log intact rather than a truncated file.
  const tmp = `${FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(entries, null, 2));
  renameSync(tmp, FILE);
}

function usernameOf(jwt: JWTPayload): string {
  const name = jwt.preferred_username;
  return typeof name === "string" ? name : "(unknown)";
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

// GET /api/log — list entries.
//
// A log reader and a realm admin see the whole company's log: the reader to open it, the admin to
// audit who used the AI and when — as ciphertext, which an admin cannot open without the reader
// role. Everyone else sees only their own, because the metadata alone says who consulted the AI.
export const GET = withAuth(async (_req, jwt) => {
  const all = readAll();
  const wide = hasRole(jwt, ROLE_LOG_READER) || hasRole(jwt, ADMIN_ROLE);
  const entries = wide ? all : all.filter((e) => e.userId === jwt.sub);

  return Response.json({
    entries: entries.slice().reverse(),
    /** Whether the CALLER is allowed the full log. The UI reflects this; the filter above enforces it. */
    scope: wide ? "all" : "own",
    recordId: AI_LOG_RECORD_ID,
    total: entries.length,
  });
});

// POST /api/log — append one encrypted transcript.
// Body: { ciphertext, rulesFired?, relaxed?, rolesUsed? }
export const POST = withAuth(async (req: NextRequest, jwt) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { ciphertext, rulesFired, relaxed, rolesUsed } = (body ?? {}) as Record<string, unknown>;

  if (typeof ciphertext !== "string" || ciphertext.length === 0) {
    return Response.json({ error: "ciphertext is required" }, { status: 400 });
  }
  if (ciphertext.length > 2_000_000) {
    return Response.json({ error: "ciphertext is too large" }, { status: 413 });
  }

  const entry: LogEntry = {
    id: randomUUID(),
    userId: jwt.sub!,
    username: usernameOf(jwt),
    at: new Date().toISOString(),
    ciphertext,
    recordId: AI_LOG_RECORD_ID,
    rulesFired: (isStringArray(rulesFired) ? rulesFired : []) as RuleId[],
    relaxed: (isStringArray(relaxed) ? relaxed : []) as RuleId[],
    // Taken from the token, not from the body: the client does not get to describe its own roles.
    rolesUsed: ((jwt.realm_access as { roles?: string[] } | undefined)?.roles ?? []).map(String),
  };
  void rolesUsed; // accepted in the body for symmetry with the preview, deliberately ignored

  const all = readAll();
  all.push(entry);
  writeAll(all);

  return Response.json({ id: entry.id }, { status: 201 });
});

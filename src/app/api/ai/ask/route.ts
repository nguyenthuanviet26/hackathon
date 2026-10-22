import { NextRequest } from "next/server";
import type { JWTPayload } from "jose";
import { withAuth } from "@/lib/auth/middleware";
import { redact, type Finding, type RuleId } from "@/lib/redact";
import { askModel, type ModelMode } from "@/lib/ai/model";
import { AI_LOG_RECORD_ID } from "@/lib/log/record";

// POST /api/ai/ask — the only way a prompt leaves this company.
//
// The browser shows the employee a preview of what will be sent, but the preview is not what is
// sent: this route re-runs the redaction from the roles in the VERIFIED, DPoP-bound JWT and sends
// the result of ITS OWN run. A browser that lies about its roles, or posts a pre-redacted string,
// changes nothing here (AP-G06: a client-side check is not authorization).
//
// Nothing on this path is persisted. The transcript is encrypted in the employee's browser and
// stored as ciphertext by /api/log, so this server has no plaintext history to leak and no
// plaintext history to be compelled for.

/** Realm roles from the verified token. The redaction rules are driven by these and nothing else. */
function realmRolesOf(jwt: JWTPayload): string[] {
  const realmAccess = jwt.realm_access as { roles?: unknown } | undefined;
  return Array.isArray(realmAccess?.roles) ? realmAccess!.roles!.map(String) : [];
}

export interface AskResponse {
  /** Verbatim what was sent to the model. */
  sentToModel: string;
  /** What the engine found, with values masked. */
  findings: Finding[];
  /** Rule ids whose raw values were let through, because the caller holds the unlocking role. */
  relaxed: RuleId[];
  /** The realm roles the SERVER used to decide. Shown in the UI so the decision is auditable. */
  rolesUsed: string[];
  answer: string;
  mode: ModelMode;
  model: string;
  /** The record the transcript must be tagged with when the browser encrypts it. */
  recordId: string;
  at: string;
}

export const POST = withAuth(async (req: NextRequest, jwt) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const prompt = (body as { prompt?: unknown })?.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return Response.json({ error: "prompt is required" }, { status: 400 });
  }
  if (prompt.length > 20_000) {
    return Response.json({ error: "prompt is too long (max 20000 characters)" }, { status: 413 });
  }

  const rolesUsed = realmRolesOf(jwt);
  const { redacted, findings, relaxed } = redact(prompt, rolesUsed);

  let reply;
  try {
    reply = await askModel(redacted);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "AI provider unreachable" },
      { status: 502 }
    );
  }

  const payload: AskResponse = {
    sentToModel: redacted,
    findings,
    relaxed,
    rolesUsed,
    answer: reply.answer,
    mode: reply.mode,
    model: reply.model,
    recordId: AI_LOG_RECORD_ID,
    at: new Date().toISOString(),
  };

  return Response.json(payload);
});

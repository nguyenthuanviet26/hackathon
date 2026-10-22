import { NextRequest } from "next/server";
import type { JWTPayload } from "jose";
import { withAuth } from "@/lib/auth/middleware";
import { hasRole } from "@/lib/auth/tideJWT";
import { ADMIN_ROLE } from "@/lib/log/record";
import { describePolicy, orkDecrypt, orkEncrypt, signPolicy, simOnly, type SimPolicyParams } from "@/lib/sim/server";

// POST /api/sim/ork/{sign-policy|encrypt|decrypt} — the simulated ORK network. Simulation only.
//
// Decisions are made from the VERIFIED token's roles, never from anything the browser says about
// itself — the same place the live network takes them from.

function realmRoles(jwt: JWTPayload): string[] {
  return ((jwt.realm_access as { roles?: unknown[] } | undefined)?.roles ?? []).map(String);
}

const handle = withAuth(async (req: NextRequest, jwt) => {
  const op = new URL(req.url).pathname.split("/").pop();
  const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

  try {
    if (op === "sign-policy") {
      // Only a realm admin can have a policy signed — the live network checks the admin policy.
      if (!hasRole(jwt, ADMIN_ROLE)) {
        return Response.json({ error: "Policy supplied has not been signed: caller is not a realm admin" }, { status: 403 });
      }
      const params = body.params as SimPolicyParams | undefined;
      if (!params || params.subjectType !== "Role" || !params.subjectId || !params.assignmentId || !params.roles) {
        return Response.json({ error: "params must name a Role subject, an assignmentId and roles" }, { status: 400 });
      }
      const signedBy = typeof jwt.preferred_username === "string" ? jwt.preferred_username : jwt.sub!;
      const policy = signPolicy(params, signedBy);
      return Response.json({ policy, descriptor: describePolicy(policy) });
    }

    const items = Array.isArray(body.items) ? body.items : [];
    const policy = typeof body.policy === "string" ? body.policy : "";

    if (op === "encrypt") return Response.json({ out: orkEncrypt(items, policy, realmRoles(jwt)) });
    if (op === "decrypt") return Response.json({ out: orkDecrypt(items, policy, realmRoles(jwt)) });

    return Response.json({ error: "Unknown operation" }, { status: 404 });
  } catch (err) {
    // A refusal, not an outage. The message is the contract's own wording.
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 403 });
  }
});

export async function POST(req: NextRequest) {
  return simOnly() ?? handle(req);
}

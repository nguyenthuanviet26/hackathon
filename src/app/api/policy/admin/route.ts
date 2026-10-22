import { withRole } from "@/lib/auth/middleware";
import { adminApi } from "@/lib/auth/masterToken";
import { ADMIN_ROLE } from "@/lib/log/record";

// GET /api/policy/admin — the realm's signed `tide-realm-admin` policy bytes.
//
// The enclave signing flow has to attach these to the approved request, or the ORKs answer
// "Policy supplied has not been signed". The browser cannot fetch them itself: TideCloak is
// another origin and this is an admin route, so it is proxied here.
//
// Admin-only, and a read. It mints nothing governed — see src/lib/auth/masterToken.ts for why
// approvals deliberately do NOT come through this server.
export const GET = withRole(ADMIN_ROLE, async () => {
  const res = await adminApi("/iga/role-policies/name/tide-realm-admin");

  if (!res.ok) {
    return Response.json(
      {
        error:
          res.status === 404
            ? "The realm has no tide-realm-admin policy yet. It is created when the first " +
              "tide-realm-admin grant commits — finish the bootstrap first."
            : `TideCloak refused the request (HTTP ${res.status})`,
      },
      { status: res.status === 404 ? 409 : 502 }
    );
  }

  const data = (await res.json()) as { policy?: unknown };

  if (typeof data.policy !== "string" || data.policy.length === 0) {
    return Response.json(
      { error: "The admin policy row has no `policy` field — nothing to sign with." },
      { status: 502 }
    );
  }

  // The field is base64. Decoding it here, once, is the difference between real policy bytes and
  // the ASCII of the base64 text, which the ORK rejects with an index error that reads like a bug.
  const bytes = Buffer.from(data.policy, "base64");
  if (bytes.length === 0) {
    return Response.json({ error: "The admin policy decoded to zero bytes." }, { status: 502 });
  }

  return Response.json({ policyBytes: Array.from(bytes) });
});

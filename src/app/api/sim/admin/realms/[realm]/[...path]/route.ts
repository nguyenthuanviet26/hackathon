import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import type { JWTPayload } from "jose";
import { withRole } from "@/lib/auth/middleware";
import { ADMIN_ROLE } from "@/lib/log/record";
import { readState, simOnly, threshold, writeState, type SimChangeRequest } from "@/lib/sim/server";

// /api/sim/admin/realms/{realm}/... — the slice of TideCloak's admin + IGA API that IgaClient
// calls, simulated. Simulation only, admin only.
//
// The rules are the live realm's:
//   - a role grant or revoke answers 202 and files a change request; nothing changes yet
//   - `approve` is credited to the CALLER's token, each admin counts once (a second approval from
//     the same admin is a 409), and the request applies itself when the tally reaches
//     max(1, floor(0.7 × admins))
//   - approving is two-phase, like Tide MultiAdmin: phase 1 answers `needs-approval` with a request
//     model, which the admin's (simulated) enclave signs and posts back bound to their own identity

type Ctx = { params: Promise<{ realm: string; path: string[] }> };

const ok = (body: unknown, status = 200) => Response.json(body, { status });
const err = (status: number, error: string) => Response.json({ error }, { status });

function whoami(jwt: JWTPayload) {
  return { userId: jwt.sub!, username: typeof jwt.preferred_username === "string" ? jwt.preferred_username : jwt.sub! };
}

/** The list object TideCloak returns, with the fields IgaClient reads. */
function view(cr: SimChangeRequest, t: number) {
  return {
    id: cr.id,
    entityType: cr.entityType,
    actionType: cr.actionType,
    status: cr.status,
    requestedBy: cr.requestedBy,
    createdAt: cr.createdAt,
    authorizationCount: cr.authorizers.length,
    authorizers: cr.authorizers.map((a) => ({ username: a.username, timestamp: a.timestamp })),
    threshold: t,
    readyToCommit: cr.status === "PENDING" && cr.authorizers.length >= t,
    rows: { userId: cr.userId, role: cr.role },
  };
}

/** Apply a request that has reached quorum. */
function commit(cr: SimChangeRequest, state: ReturnType<typeof readState>) {
  const user = state.users.find((u) => u.id === cr.userId);
  if (user) {
    const roles = new Set(user.realmRoles);
    if (cr.actionType === "GRANT_ROLE") roles.add(cr.role);
    else roles.delete(cr.role);
    user.realmRoles = [...roles];
  }
  cr.status = "APPROVED";
}

/** The bytes the enclave signs: which request, and which admin is signing it. */
const requestModel = (crId: string, userId: string) =>
  Buffer.from(JSON.stringify({ simulated: true, changeRequestId: crId, approver: userId })).toString("base64");

async function route(req: NextRequest, jwt: JWTPayload, path: string[]): Promise<Response> {
  const state = readState();
  const t = threshold(state);
  const me = whoami(jwt);
  const method = req.method;
  const [a, b, c, d] = path;

  // GET /users
  if (method === "GET" && a === "users" && !b) {
    return ok(state.users.map((u) => ({ id: u.id, username: u.username })));
  }

  // GET /roles/{name}
  if (method === "GET" && a === "roles" && b) {
    return ok({ id: b, name: b });
  }

  // /users/{id}/role-mappings/realm
  if (a === "users" && b && c === "role-mappings" && d === "realm") {
    const user = state.users.find((u) => u.id === b);
    if (!user) return err(404, "User not found");

    if (method === "GET") return ok(user.realmRoles.map((r) => ({ id: r, name: r })));

    if (method === "POST" || method === "DELETE") {
      const roles = ((await req.json().catch(() => [])) ?? []) as { name?: string }[];
      for (const role of roles) {
        if (!role?.name) continue;
        state.changeRequests.push({
          id: randomUUID(),
          entityType: "USER_ROLE_MAPPING",
          actionType: method === "POST" ? "GRANT_ROLE" : "REVOKE_ROLE",
          status: "PENDING",
          requestedBy: me.username,
          createdAt: new Date().toISOString(),
          userId: user.id,
          role: role.name,
          authorizers: [],
        });
      }
      writeState(state);
      // 202: captured as a change request. Not applied.
      return new Response(null, { status: 202 });
    }
  }

  // GET /tide-admin/iga-status
  if (method === "GET" && a === "tide-admin" && b === "iga-status") {
    return ok({ enabled: true, simulated: true });
  }

  // /iga/change-requests...
  if (a === "iga" && b === "change-requests") {
    if (method === "GET" && !c) {
      const status = new URL(req.url).searchParams.get("status");
      return ok(state.changeRequests.filter((cr) => !status || cr.status === status).map((cr) => view(cr, t)));
    }

    const cr = state.changeRequests.find((x) => x.id === c);
    if (!cr) return err(404, "Change request not found");

    if (method === "GET" && !d) return ok(view(cr, t));

    if (method === "POST" && d === "approve") {
      if (cr.status !== "PENDING") return err(409, `Change request is ${cr.status}, not PENDING`);
      if (cr.authorizers.some((x) => x.userId === me.userId)) {
        return err(409, "This admin has already approved this request. Each admin counts once.");
      }

      const { requestModel: signed } = ((await req.json().catch(() => ({}))) ?? {}) as { requestModel?: string };

      // Phase 1: hand the enclave something to sign, bound to this admin.
      if (!signed) {
        return ok({
          mode: "needs-approval",
          changeRequestId: cr.id,
          actionType: cr.actionType,
          requestModel: requestModel(cr.id, me.userId),
          authCount: cr.authorizers.length,
          threshold: t,
        });
      }

      // Phase 2: the signed model must be for THIS request and THIS admin — a model signed by
      // someone else cannot be replayed to add a vote under another identity.
      let model: { changeRequestId?: string; approver?: string } = {};
      try {
        model = JSON.parse(Buffer.from(signed, "base64").toString("utf-8"));
      } catch {
        /* falls through to the check below */
      }
      if (model.changeRequestId !== cr.id || model.approver !== me.userId) {
        return err(400, "Signed request model does not match this request and this admin");
      }

      cr.authorizers.push({ ...me, timestamp: new Date().toISOString() });
      const committed = cr.authorizers.length >= t;
      if (committed) commit(cr, state);
      writeState(state);

      return ok({
        mode: "recorded",
        committed,
        authCount: cr.authorizers.length,
        threshold: t,
        readyToCommit: committed,
        status: cr.status,
      });
    }

    if (method === "POST" && d === "deny") {
      if (cr.status !== "PENDING") return err(409, `Change request is ${cr.status}, not PENDING`);
      cr.status = "DENIED";
      writeState(state);
      return new Response(null, { status: 204 });
    }

    if (method === "POST" && d === "commit") {
      if (cr.status !== "PENDING" || cr.authorizers.length < t) return err(412, "Quorum not reached");
      commit(cr, state);
      writeState(state);
      return new Response(null, { status: 204 });
    }
  }

  return err(404, `Not simulated: ${method} /${path.join("/")}`);
}

async function dispatch(req: NextRequest, ctx: Ctx): Promise<Response> {
  const blocked = simOnly();
  if (blocked) return blocked;
  const { path } = await ctx.params;
  return withRole(ADMIN_ROLE, (r, jwt) => route(r, jwt, path))(req);
}

export const GET = dispatch;
export const POST = dispatch;
export const DELETE = dispatch;

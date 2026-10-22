import { NextRequest } from "next/server";
import { issueToken, readState, simOnly } from "@/lib/sim/server";

// POST /api/sim/login { username } — stands in for the Tide login. Simulation only.
//
// The token carries the roles the user holds RIGHT NOW. A role granted later is not in it until
// the user logs in again — the same behaviour as the live realm, and the demo relies on it.
export async function POST(req: NextRequest) {
  const blocked = simOnly();
  if (blocked) return blocked;

  const { username } = ((await req.json().catch(() => ({}))) ?? {}) as { username?: unknown };
  const user = readState().users.find((u) => u.username === username);
  if (!user) return Response.json({ error: "Unknown user" }, { status: 404 });

  return Response.json({ token: await issueToken(user) });
}

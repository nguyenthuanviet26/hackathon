import { readState, simOnly, threshold } from "@/lib/sim/server";

// GET /api/sim/users — the accounts the simulated login screen offers. Simulation only.
export async function GET() {
  const blocked = simOnly();
  if (blocked) return blocked;

  const state = readState();
  return Response.json({
    users: state.users.map((u) => ({ username: u.username, admin: u.admin })),
    threshold: threshold(state),
  });
}

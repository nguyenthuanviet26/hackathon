import { resetAll, simOnly } from "@/lib/sim/server";

// POST /api/sim/reset — back to the four seeded accounts, no policies, empty log. Simulation only.
export async function POST() {
  const blocked = simOnly();
  if (blocked) return blocked;

  resetAll();
  return Response.json({ reset: true });
}

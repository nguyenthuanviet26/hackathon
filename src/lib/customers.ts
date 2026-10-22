// customers.ts — the names the redaction engine knows to be customers.
//
// A name cannot be found by pattern the way a phone number can: "Mai" is a customer in one sentence
// and a month in another. So the engine only redacts names it KNOWS, the way a real deployment
// would load them from the CRM. These are synthetic, for the demo.

export const KNOWN_CUSTOMERS: readonly string[] = [
  "Nguyễn Minh",
  "Nguyen Minh",
  "Trần Thị Mai",
  "Tran Thi Mai",
  "Lê Văn Hùng",
  "Le Van Hung",
  "Phạm Thu Hà",
  "Pham Thu Ha",
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One regex for the whole directory. Longest first, so "Trần Thị Mai" wins over a shorter entry it
 * contains; letter-aware boundaries, because `\b` does not understand Vietnamese letters.
 */
export function customerNamePattern(names: readonly string[] = KNOWN_CUSTOMERS): RegExp {
  const alternatives = [...names].sort((a, b) => b.length - a.length).map(escape).join("|");
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives})(?![\\p{L}\\p{N}_])`, "giu");
}

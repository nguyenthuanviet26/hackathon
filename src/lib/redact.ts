// redact.ts — the redaction engine.
//
// Runs in two places, deliberately:
//
//   * in the browser, to show the employee EXACTLY what the AI will receive (the preview)
//   * on the server, to produce what is actually sent
//
// The server re-runs it from the roles in the VERIFIED JWT and ignores whatever the browser
// claims. The preview is a courtesy; the server's run is the control. If the two ever disagree,
// the server's is what reached the model.
//
// A rule is relaxed by holding a ROLE, not by flipping a setting. That is the whole point: on an
// IGA realm, granting that role is a change request, so loosening a rule costs a quorum of admins
// and no single one of them can do it. See docs/THREAT-MODEL.md.

/** Which rule found something. Stable ids — they are stored with the log and shown in the UI. */
export type RuleId = "card" | "nationalId" | "phone" | "email";

export interface RedactionRule {
  id: RuleId;
  /** Shown in the preview legend. */
  label: string;
  labelVi: string;
  /**
   * The realm role that lets raw values of this kind through to the model.
   * `null` means no role unlocks it — it is never sent, by anyone, including a realm admin.
   */
  unlockRole: string | null;
  /** What replaces the value when the rule is enforced. */
  placeholder: (n: number) => string;
  pattern: RegExp;
}

/**
 * Rules in priority order. Earlier rules win an overlap, so the longest/most sensitive digit
 * patterns come first: a 16-digit card must not be shredded into phone fragments.
 */
export const RULES: readonly RedactionRule[] = [
  {
    id: "card",
    label: "Payment card",
    labelVi: "Số thẻ",
    unlockRole: null, // never sent, by anybody
    placeholder: (n) => `[THE_CARD_${n}]`,
    // 13-19 digits in groups, optionally separated by space or dash
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
  },
  {
    id: "nationalId",
    label: "National ID (CCCD/CMND)",
    labelVi: "Số CCCD/CMND",
    unlockRole: null, // never sent, by anybody
    placeholder: (n) => `[CCCD_${n}]`,
    // Vietnamese CCCD is 12 digits; the older CMND is 9. Both as a standalone run of digits.
    pattern: /\b(?:\d{12}|\d{9})\b/g,
  },
  {
    id: "phone",
    label: "Phone number",
    labelVi: "Số điện thoại",
    unlockRole: "ai_export_contact",
    placeholder: (n) => `[SĐT_${n}]`,
    // Vietnamese mobile: 0xx or +84xx, 9-10 digits after the prefix, optional . - or space
    pattern: /(?:\+84|0084|0)(?:[ .-]?\d){8,10}\b/g,
  },
  {
    id: "email",
    label: "Email address",
    labelVi: "Địa chỉ email",
    unlockRole: "ai_export_contact",
    placeholder: (n) => `[EMAIL_${n}]`,
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
] as const;

/** One value the engine found and what it did about it. */
export interface Finding {
  ruleId: RuleId;
  /** Where it was in the ORIGINAL text. */
  start: number;
  end: number;
  /** The placeholder it was replaced with, or null when it was let through raw. */
  placeholder: string | null;
  /**
   * The original value, masked for display (`09*****89`). Never the full value: findings travel
   * to the UI and into the log's metadata, and a "redaction report" that quotes the secret in
   * full is not a redaction.
   */
  preview: string;
  /** True when a role let this value through to the model unredacted. */
  passedThrough: boolean;
  /** The role that let it through, when one did. */
  viaRole: string | null;
}

export interface RedactionResult {
  /** Exactly what the model receives. */
  redacted: string;
  findings: Finding[];
  /** Rule ids that were relaxed for this run, i.e. raw values were sent. */
  relaxed: RuleId[];
}

/** `0912345678` → `09*****678`. Keeps enough to recognise, not enough to use. */
function maskForDisplay(value: string): string {
  if (value.length <= 4) return "*".repeat(value.length);
  const head = value.slice(0, 2);
  const tail = value.slice(-3);
  return `${head}${"*".repeat(Math.max(1, value.length - 5))}${tail}`;
}

interface RawMatch {
  rule: RedactionRule;
  start: number;
  end: number;
  value: string;
}

/**
 * Find every match of every rule, then drop the ones that overlap an earlier-priority match.
 * Done in one place so the preview and the server agree on the boundaries.
 */
function collectMatches(text: string): RawMatch[] {
  const all: RawMatch[] = [];

  for (const rule of RULES) {
    // Fresh regex per call: a shared /g regex carries lastIndex between calls.
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++; // guard against a zero-length match spinning forever
        continue;
      }
      all.push({ rule, start: m.index, end: m.index + m[0].length, value: m[0] });
    }
  }

  const rulePriority = new Map(RULES.map((r, i) => [r.id, i]));
  // Sort by position, then by rule priority, so the winner of an overlap is deterministic.
  all.sort((a, b) =>
    a.start - b.start ||
    rulePriority.get(a.rule.id)! - rulePriority.get(b.rule.id)! ||
    b.end - a.end
  );

  const kept: RawMatch[] = [];
  for (const candidate of all) {
    const overlaps = kept.some((k) => candidate.start < k.end && k.start < candidate.end);
    if (!overlaps) kept.push(candidate);
  }
  return kept;
}

/**
 * Redact `text` for a caller holding `roles`.
 *
 * @param roles realm roles of the caller. On the server these MUST come from the verified JWT.
 */
export function redact(text: string, roles: readonly string[]): RedactionResult {
  const held = new Set(roles);
  const matches = collectMatches(text);

  const counters = new Map<RuleId, number>();
  const findings: Finding[] = [];
  const relaxed = new Set<RuleId>();

  let out = "";
  let cursor = 0;

  for (const match of matches) {
    const { rule, start, end, value } = match;
    const unlocked = rule.unlockRole !== null && held.has(rule.unlockRole);

    out += text.slice(cursor, start);

    if (unlocked) {
      out += value; // let through raw — a quorum of admins decided this is allowed
      relaxed.add(rule.id);
      findings.push({
        ruleId: rule.id,
        start,
        end,
        placeholder: null,
        preview: maskForDisplay(value),
        passedThrough: true,
        viaRole: rule.unlockRole,
      });
    } else {
      const n = (counters.get(rule.id) ?? 0) + 1;
      counters.set(rule.id, n);
      const placeholder = rule.placeholder(n);
      out += placeholder;
      findings.push({
        ruleId: rule.id,
        start,
        end,
        placeholder,
        preview: maskForDisplay(value),
        passedThrough: false,
        viaRole: null,
      });
    }

    cursor = end;
  }

  out += text.slice(cursor);

  return { redacted: out, findings, relaxed: [...relaxed] };
}

/** For the UI: which rules this caller's roles relax, and which are absolute. */
export function ruleStateFor(roles: readonly string[]) {
  const held = new Set(roles);
  return RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    labelVi: rule.labelVi,
    unlockRole: rule.unlockRole,
    /** true when raw values of this kind would be sent as typed */
    relaxed: rule.unlockRole !== null && held.has(rule.unlockRole),
    /** true when nothing can relax it */
    absolute: rule.unlockRole === null,
  }));
}

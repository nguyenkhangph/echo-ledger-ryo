import type { EvidenceBook, EvidenceId } from "./evidence";
import { readPath } from "./evidence";
import { asNumber } from "./facts";

/**
 * A claim made in the debate must cite a piece of RYO evidence and, when it states a number, the payload path that
 * number comes from. Claims whose number does not match the payload, whose evidence is not live, or that cite
 * nothing are removed from the card, and the reason is kept.
 */
export type Claim = { by: "bull" | "bear" | "judge"; text: string; evidence: EvidenceId[]; path?: string; value?: number | string };
export type CheckedClaim = Claim & { kept: boolean; reason: string };

/** Relative tolerance for numbers that the debate rounded. */
export const CLAIM_TOLERANCE = 0.005;

export function verifyClaims(claims: Claim[], book: EvidenceBook): CheckedClaim[] {
  return claims.map((claim) => {
    if (claim.evidence.length === 0) return { ...claim, kept: false, reason: "cites no RYO evidence" };
    const unknown = claim.evidence.find((id) => !book.get(id));
    if (unknown) return { ...claim, kept: false, reason: `cites ${unknown}, which does not exist` };
    const first = book.get(claim.evidence[0]!)!;
    if (first.status !== "live") return { ...claim, kept: false, reason: `${first.id} is ${first.status}, not live data` };
    if (claim.value === undefined) return { ...claim, kept: true, reason: `backed by ${claim.evidence.join(", ")}` };
    if (!claim.path) return { ...claim, kept: false, reason: "states a number without the payload field it came from" };
    const raw = readPath(first.payload, claim.path);
    if (raw === undefined) return { ...claim, kept: false, reason: `${first.id}.${claim.path} does not exist` };
    const want = asNumber(claim.value);
    const have = asNumber(raw);
    if (want !== undefined && have !== undefined) {
      const ok = have === 0 ? want === 0 : Math.abs(want - have) / Math.abs(have) <= CLAIM_TOLERANCE;
      return { ...claim, kept: ok, reason: ok ? `matches ${first.id}.${claim.path} (${have})` : `says ${want}, ${first.id}.${claim.path} is ${have}` };
    }
    const ok = String(raw).toLowerCase() === String(claim.value).toLowerCase();
    return { ...claim, kept: ok, reason: ok ? `matches ${first.id}.${claim.path}` : `says "${claim.value}", ${first.id}.${claim.path} is "${String(raw)}"` };
  });
}

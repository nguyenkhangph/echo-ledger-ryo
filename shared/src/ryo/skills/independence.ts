import { dominant, pivotalVoices, type VoteSource } from "../../echo";
import { envelope, statusFrom, type Availability, type SkillDefinition, type SkillEnvelope } from "./envelope";

/**
 * Skill `narrative_independence` (Track 3). RYO measures the market; nothing in RYO measures whether the people
 * talking about a token are independent of each other. This skill does: given the posts about one symbol, it folds
 * declared reposts and near-duplicate texts into the voice they repeat, keeps one voice per account, and reports the
 * independent agreement score next to the naive post-count score.
 *
 * Inputs are the caller's own posts (RYO publishes no social feed). Posts without a sentiment are excluded and make
 * the result partial; posts without a timestamp still count but leave the timeline partial. Nothing is invented.
 */
export const INDEPENDENCE_TOOL = "narrative_independence";

export type IndependencePost = {
  id: string;
  handle: string;
  sentiment?: "bullish" | "bearish" | "neutral" | null;
  conviction?: number | null;
  posted_at?: string | null;
  /** Id (or handle) of the post this one repeats, when the caller already knows. */
  echo_of?: string | null;
  is_echo?: boolean | null;
  text?: string | null;
};

export type IndependenceArgs = { symbol: string; posts: IndependencePost[]; market_risk?: "low" | "medium" | "high" | null; as_of?: string };

export type IndependenceData = {
  symbol: string;
  threshold: number;
  threshold_reason: string;
  independent: { score: number; voices: number; agreeing: number; side: string | null; passes: boolean };
  naive: { score: number; posts: number; agreeing: number; side: string | null; passes: boolean };
  echo_ratio: number;
  originators: string[];
  clusters: Array<{ origin_post: string; origin_handle: string; echoes: Array<{ post: string; handle: string; how: "declared" | "near_duplicate" | "same_account"; lag_min: number | null }> }>;
  pivotal_voices: string[];
  excluded: Array<{ post: string; reason: string }>;
  timeline: Array<{ post: string; handle: string; posted_at: string; role: "first" | "independent" | "echo" }> | null;
};

export const MIN_VOICES = 2;
export const NEAR_DUPLICATE = 0.8;

const words = (t: string) => new Set(t.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[^\p{L}\p{N}$#@ ]+/gu, " ").split(/\s+/).filter((w) => w.length > 1));
export function jaccard(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both += 1;
  return both / (A.size + B.size - both);
}

const scoreOf = (vs: VoteSource[]) => {
  const side = dominant(vs);
  const agreeing = side ? vs.filter((v) => v.sentiment === side).length : 0;
  return { score: vs.length ? Number((agreeing / vs.length).toFixed(4)) : 0, agreeing, side };
};

export function narrativeIndependence(args: IndependenceArgs): SkillEnvelope<IndependenceData> {
  const asOf = args.as_of ?? new Date().toISOString();
  const request = { symbol: args.symbol, posts: Array.isArray(args.posts) ? args.posts.length : 0, market_risk: args.market_risk ?? null };
  const symbol = String(args.symbol ?? "").trim().toUpperCase();
  if (!symbol || !Array.isArray(args.posts) || args.posts.length === 0) {
    return envelope<IndependenceData>({
      tool: INDEPENDENCE_TOOL, status: "unavailable", data_mode: "unknown", as_of: asOf, request, data: null,
      summary: { headline: "No posts supplied: independence cannot be measured.", key_points: [] },
      availability: { independence: "unavailable", timeline: "unavailable" },
      warnings: [!symbol ? "symbol is required" : "posts must be a non-empty array"],
    });
  }

  const excluded: IndependenceData["excluded"] = [];
  const posts = args.posts.filter((p) => {
    if (!p || !p.id || !p.handle) return excluded.push({ post: String(p?.id ?? "?"), reason: "missing id or handle" }), false;
    if (!p.sentiment) return excluded.push({ post: p.id, reason: "no sentiment: not counted, not guessed" }), false;
    return true;
  });
  const time = (p: IndependencePost) => (p.posted_at && Number.isFinite(Date.parse(p.posted_at)) ? Date.parse(p.posted_at) : null);
  const ordered = [...posts].sort((a, b) => (time(a) ?? Infinity) - (time(b) ?? Infinity) || a.id.localeCompare(b.id));

  // Fold: declared echoes, then near-duplicate text of an earlier post by another account, then repeat posts by one account.
  const originOf = new Map<string, { origin: IndependencePost; how: "declared" | "near_duplicate" | "same_account" }>();
  const byId = new Map(ordered.map((p) => [p.id, p]));
  const firstByHandle = new Map<string, IndependencePost>();
  for (const [i, p] of ordered.entries()) {
    const declared = p.echo_of ? byId.get(p.echo_of) ?? ordered.find((q) => q.handle === p.echo_of && q.id !== p.id) : undefined;
    if (declared || p.is_echo) {
      const origin = declared ?? ordered.slice(0, i).find((q) => q.handle !== p.handle && !originOf.has(q.id));
      if (origin) {
        originOf.set(p.id, { origin: originOf.get(origin.id)?.origin ?? origin, how: "declared" });
        continue;
      }
    }
    if (p.text) {
      const dup = ordered.slice(0, i).find((q) => q.handle !== p.handle && q.text && jaccard(q.text, p.text!) >= NEAR_DUPLICATE);
      if (dup) {
        originOf.set(p.id, { origin: originOf.get(dup.id)?.origin ?? dup, how: "near_duplicate" });
        continue;
      }
    }
    const own = firstByHandle.get(p.handle);
    if (own) originOf.set(p.id, { origin: own, how: "same_account" });
    else firstByHandle.set(p.handle, p);
  }

  const originals = ordered.filter((p) => !originOf.has(p.id));
  // An account that only ever echoed is not a voice; an account with an original post is one voice.
  const voices: VoteSource[] = originals.map((p) => ({ handle: p.handle, sentiment: p.sentiment!, conviction: p.conviction ?? 0.5, is_echo: false }));
  const all: VoteSource[] = ordered.map((p) => ({ handle: p.handle, sentiment: p.sentiment!, conviction: p.conviction ?? 0.5, is_echo: originOf.has(p.id) }));
  const threshold = args.market_risk === "medium" ? 0.67 : 0.6;
  const ind = scoreOf(voices);
  const nai = scoreOf(all);

  const clusters = originals
    .map((o) => ({
      origin_post: o.id,
      origin_handle: o.handle,
      echoes: ordered
        .filter((p) => originOf.get(p.id)?.origin.id === o.id)
        .map((p) => {
          const a = time(o);
          const b = time(p);
          return { post: p.id, handle: p.handle, how: originOf.get(p.id)!.how, lag_min: a !== null && b !== null ? Math.round((b - a) / 60_000) : null };
        }),
    }))
    .filter((c) => c.echoes.length);

  const timed = ordered.filter((p) => time(p) !== null);
  const timeline: IndependenceData["timeline"] = timed.length
    ? timed.map((p, i) => ({ post: p.id, handle: p.handle, posted_at: p.posted_at!, role: originOf.has(p.id) ? "echo" : i === 0 ? "first" : "independent" }))
    : null;

  const availability: Record<string, Availability> = {
    independence: excluded.length === 0 ? "available" : voices.length ? "partial" : "unavailable",
    timeline: timed.length === ordered.length && ordered.length ? "available" : timed.length ? "partial" : "unavailable",
  };
  const warnings = [
    ...(excluded.length ? [`${excluded.length} post(s) excluded (no sentiment or id); see data.excluded`] : []),
    ...(availability.timeline !== "available" ? ["some posts have no timestamp: timeline and echo lags incomplete"] : []),
    ...(args.market_risk === undefined || args.market_risk === null ? ["no market_risk given: base threshold 0.60 used"] : []),
  ];
  const passes = voices.length >= MIN_VOICES && ind.score >= threshold && ind.side !== "neutral" && ind.side !== null;
  const naivePasses = all.length >= MIN_VOICES && nai.score >= threshold && nai.side !== "neutral" && nai.side !== null;
  const data: IndependenceData = {
    symbol,
    threshold,
    threshold_reason: args.market_risk === "medium" ? "raised: market risk medium" : "base",
    independent: { score: ind.score, voices: voices.length, agreeing: ind.agreeing, side: ind.side, passes },
    naive: { score: nai.score, posts: all.length, agreeing: nai.agreeing, side: nai.side, passes: naivePasses },
    echo_ratio: ordered.length ? Number(((ordered.length - originals.length) / ordered.length).toFixed(4)) : 0,
    originators: [...new Set(originals.map((p) => p.handle))],
    clusters,
    pivotal_voices: pivotalVoices(voices),
    excluded,
    timeline,
  };
  const status = statusFrom([availability.independence!]);
  return envelope({
    tool: INDEPENDENCE_TOOL,
    status,
    data_mode: "live",
    as_of: asOf,
    request,
    data,
    summary: {
      headline: `${symbol}: ${voices.length} independent voice(s) behind ${ordered.length} post(s); independent agreement ${ind.score.toFixed(2)} ${passes ? "passes" : "does not pass"} the ${threshold.toFixed(2)} bar.`,
      key_points: [
        `Naive count ${nai.score.toFixed(2)} over ${all.length} posts${naivePasses !== passes ? " — counting reposts would flip the result" : ""}.`,
        `${Math.round(data.echo_ratio * 100)}% of posts repeat another voice.`,
        data.pivotal_voices.length ? `Pivotal: removing ${data.pivotal_voices.join(", ")} alone would flip it.` : "No single voice decides the result.",
      ],
    },
    availability,
    warnings,
  });
}

export const INDEPENDENCE_DEFINITION: SkillDefinition = {
  name: INDEPENDENCE_TOOL,
  description:
    "Measures whether the accounts talking about a token are independent. Folds declared reposts, near-duplicate texts and repeat posts into the voice they repeat, then returns the independent agreement score, the naive post-count score, echo clusters, pivotal voices and a timeline. Read-only; uses only the posts you pass.",
  inputSchema: {
    type: "object",
    required: ["symbol", "posts"],
    properties: {
      symbol: { type: "string", description: "Token symbol, e.g. SOL" },
      market_risk: { type: ["string", "null"], enum: ["low", "medium", "high", null], description: "From market_overview; medium raises the bar to 0.67" },
      posts: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "handle"],
          properties: {
            id: { type: "string" },
            handle: { type: "string" },
            sentiment: { type: ["string", "null"], enum: ["bullish", "bearish", "neutral", null] },
            conviction: { type: ["number", "null"] },
            posted_at: { type: ["string", "null"], format: "date-time" },
            echo_of: { type: ["string", "null"], description: "Post id or handle this post repeats" },
            is_echo: { type: ["boolean", "null"] },
            text: { type: ["string", "null"], description: "Used for near-duplicate detection" },
          },
        },
      },
    },
  },
};

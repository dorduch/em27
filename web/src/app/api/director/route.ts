// AI director: picks next week's demands from the engine's candidate pool.
// Claude only chooses ids; the client re-validates against the engine before using them,
// and falls back to the seeded random draw on any error.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { DirectorBrief } from "@/engine/director";

const MODEL = process.env.DIRECTOR_MODEL ?? "claude-haiku-5-5";
const MAX_BODY = 24_000;
const ID_PATTERN = /^[a-z0-9_]+:\d$/;

// Stable, cacheable instructions. Keep volatile data out of this string.
const SYSTEM = `You are the director of EM27, a Championship Manager-style game where the player is an engineering manager.
Each week the player gets a handful of "demands" (events) and a limited calendar. You choose which demands appear next week, from a list of candidates the game engine already approved. You never change mechanics or numbers; you only choose and order.

Aim for a quarter that feels like a story:
- Pacing over 12 weeks: weeks 1-2 settle in, 3-5 build pressure, week 6 is the mid-quarter check-in, 7-10 escalate, 11-12 are the crunch before the review. After a bad week, ease off slightly; after calm weeks, raise the stakes.
- Respond to the player: lean on their weak spots (low trust, a project behind schedule, a tired engineer, a promise coming due) so their choices matter.
- Spread the load: avoid picking two candidates about the same person (candidate.person or candidate.from) in one week.
- Variety: mix categories (PEOPLE, DELIVERY, POLITICS) and avoid event types in recentEventTypes unless there's a strong story reason.
- Must-respond: choose exactly one picked candidate with canBeMustRespond=true as the must-respond demand: the one with the highest stakes this week.
- Company flavor: Vercel builds toward a fixed keynote in week 8; Stripe treats incidents and reliability as sacred; Google runs on promo packets and politics.

Write each reason as one short sentence (under 16 words) for a game designer reading a debug view. A reason may only cite facts that appear in the brief, and only about that candidate's own person, sender or project; never attribute a number to someone else. Write arcNote as one sentence on where the quarter is heading.`;

function schemaFor(brief: DirectorBrief) {
  const ids = brief.candidates.map((c) => c.id) as [string, ...string[]];
  return z.object({
    picks: z
      .array(z.object({ id: z.enum(ids), reason: z.string() }))
      .describe(`Exactly ${brief.pick} candidates with different event types, in the order the player should see them.`),
    mustRespondId: z.enum(ids).describe("One of the picked ids whose candidate has canBeMustRespond=true."),
    arcNote: z.string(),
  });
}

function isBrief(b: unknown): b is DirectorBrief {
  const x = b as DirectorBrief;
  return (
    !!x &&
    Number.isInteger(x.week) &&
    Number.isInteger(x.quarter) &&
    Number.isInteger(x.pick) &&
    x.pick > 0 &&
    x.pick <= 8 &&
    Array.isArray(x.candidates) &&
    x.candidates.length > 0 &&
    x.candidates.length <= 40 &&
    x.candidates.every((c) => typeof c.id === "string" && ID_PATTERN.test(c.id))
  );
}

// Best-effort per-instance rate limit: 30 requests a minute per IP.
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 30;
}

const fallback = (reason: string, status = 503) => Response.json({ fallback: "random", reason }, { status });

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(ip)) return fallback("Rate limited", 429);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return fallback("Request too large", 413);
  let brief: unknown;
  try {
    brief = JSON.parse(raw);
  } catch {
    return fallback("Body must be JSON", 400);
  }
  if (!isBrief(brief)) return fallback("Malformed brief", 400);
  try {
    // Credentials come from the environment (ANTHROPIC_API_KEY, or an `ant auth login` profile in dev).
    const client = new Anthropic({ timeout: 15_000, maxRetries: 1 });
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 2000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `Choose next week's demands. Game state and candidates as JSON:\n${JSON.stringify(brief)}`,
        },
      ],
      output_config: { effort: "low", format: zodOutputFormat(schemaFor(brief)) },
    });
    if (response.stop_reason === "refusal") return fallback("Model declined", 502);
    const out = response.parsed_output;
    if (!out) return fallback("Unparseable reply", 502);
    return Response.json({
      plan: {
        quarter: brief.quarter,
        week: brief.week,
        picks: out.picks.map((p) => p.id),
        requiredId: out.mustRespondId,
        rationale: Object.fromEntries(out.picks.map((p) => [p.id, p.reason])),
        arcNote: out.arcNote,
      },
      usage: {
        input: response.usage.input_tokens,
        cacheRead: response.usage.cache_read_input_tokens,
        output: response.usage.output_tokens,
      },
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return fallback("Upstream rate limit", 429);
    if (error instanceof Anthropic.AuthenticationError) return fallback("Bad API key");
    if (error instanceof Anthropic.APIError) return fallback(`Upstream error ${error.status}`, 502);
    // Missing credentials surface as a plain Error from the SDK, so they land here too.
    return fallback("Director unavailable (is ANTHROPIC_API_KEY set?)", 502);
  }
}

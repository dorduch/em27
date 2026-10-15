// LLM proxy (milestone M2). Today it only validates the request shape and tells the
// client to keep the deterministic template text. The engine never depends on this route.
//
// Contract for M2:
//   POST /api/llm  { kind: "weekTurn" | "newGame" | "quarterlyReview" | "careerMoment" | "recapHeadline", payload: {...} }
//   → 200 { text: {...} }            reworded strings for ids the engine supplied
//   → 503 { fallback: "template" }   no key, rate-limited or slow: the client keeps template text
// The prompt is built here on the server from structured payloads. It is never a free-form chat endpoint.

const KINDS = new Set(["weekTurn", "newGame", "quarterlyReview", "careerMoment", "recapHeadline"]);
const MAX_BODY = 16_000;

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "Request too large" }, { status: 413 });
  let body: { kind?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (typeof body.kind !== "string" || !KINDS.has(body.kind)) {
    return Response.json({ error: "Unknown kind" }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ fallback: "template", reason: "LLM not configured" }, { status: 503 });
  }
  // M2: build the prompt for body.kind, call Claude with a cached system prefix,
  // validate the JSON reply against the engine-supplied ids, and return it.
  return Response.json({ fallback: "template", reason: "LLM layer not implemented yet" }, { status: 503 });
}

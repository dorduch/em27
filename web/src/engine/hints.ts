// Classifies hint segments ("Tech Debt ↑", "Leave risk", "Promise due wk 9") as good,
// bad or neutral for the player, so the UI can colour them. Every hint used by an
// event is covered by a test; an unknown segment fails the test instead of guessing.

export type Valence = "good" | "bad" | "neutral";

// Meters where going up is bad for the player.
const BAD_WHEN_UP = ["tech debt", "stress", "on-call load", "scope", "incident cost"];

const GOOD_PHRASES = [
  "protected",
  "time saved",
  "packet evidence",
  "promise kept",
  "hiring chance",
  "chance they stay",
  "reveals a trait",
  "likely promoted",
  "trust back",
  "✓",
];
const BAD_PHRASES = ["risk", "leaves", "promise broken"];
const NEUTRAL_PHRASES = ["promise due", "depends on", "coin flip", "long shot", "chance coding", "may fade away", "deadline +"];

export function classifyHint(segment: string): Valence | "unknown" {
  const s = segment.trim().toLowerCase();
  if (!s) return "unknown";
  if (NEUTRAL_PHRASES.some((p) => s.startsWith(p) || s.includes(p))) return "neutral";
  if (BAD_PHRASES.some((p) => s.includes(p))) return "bad";
  if (GOOD_PHRASES.some((p) => s.includes(p))) return "good";
  const up = s.endsWith("↑") || s.endsWith("↑↑") || s.includes("↑ for");
  const down = s.endsWith("↓") || s.endsWith("↓↓") || s.includes("↓ for");
  if (!up && !down) return "unknown";
  const badWhenUp = BAD_WHEN_UP.some((m) => s.includes(m));
  if (up) return badWhenUp ? "bad" : "good";
  return badWhenUp ? "good" : "bad";
}

export function splitHints(hints: string): { text: string; valence: Valence }[] {
  return hints
    .split(" · ")
    .filter(Boolean)
    .map((text) => {
      const v = classifyHint(text);
      return { text, valence: v === "unknown" ? "neutral" : v };
    });
}

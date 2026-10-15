import { it } from "vitest";
import { newGame } from "./setup";
import { blockingItem, choose, planCost, setOncall } from "./plan";
import type { GameState } from "./types";
function smart(s: GameState): GameState {
  const req = blockingItem(s);
  if (req) s = choose(s, req.id, [...req.intents].sort((a, b) => a.cost - b.cost)[0].id);
  for (const item of s.inbox) {
    if (s.plan.choices[item.id]) continue;
    const opts = [...item.intents].sort((a, b) => b.cost - a.cost).filter((i) => planCost(s) + i.cost <= s.capacity);
    if (opts.length) s = choose(s, item.id, opts[Math.floor(opts.length / 2)].id);
  }
  const best = [...s.engineers].sort((a, b) => b.attrs.energy + b.attrs.debugging - a.attrs.energy - a.attrs.debugging)[0];
  if (best) s = setOncall(s, best.id);
  return s;
}
import { advanceFromBackPage, finishCheckin, finishFriday, resolveWeek } from "./resolve";
it.skipIf(!process.env.SIM)("balance sim (SIM=1 to run)", () => {
  const out: Record<string, number> = {};
  const sc: number[][] = [];
  for (const policy of ["passive", "smart"]) {
  for (const k of Object.keys(out)) delete out[k]; sc.length = 0;
  for (const co of ["Vercel","Stripe","Google"] as const) for (let seed = 1; seed <= 15; seed++) {
    let s = newGame(co, seed);
    while (s.phase !== "review") {
      if (policy === "smart") s = smart(s);
      else { const req = blockingItem(s); if (req) s = choose(s, req.id, req.intents[0].id); }
      s = advanceFromBackPage(finishFriday(resolveWeek(s)));
      if (s.phase === "checkin") s = finishCheckin(s, 0);
    }
    out[s.review!.grade] = (out[s.review!.grade] ?? 0) + 1;
    sc.push([s.review!.delivery, s.review!.team, s.review!.trust, s.projects.filter(p=>p.status.includes("shipped")).length]);
  }
  console.log(policy, JSON.stringify(out));
  const avg = (i: number) => (sc.reduce((a, b) => a + b[i], 0) / sc.length).toFixed(1);
  console.log("delivery", avg(0), "team", avg(1), "trust", avg(2), "shipped", avg(3));
  }
});

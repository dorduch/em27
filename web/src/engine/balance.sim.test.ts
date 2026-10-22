import { it } from "vitest";
import { newGame } from "./setup";
import { blockingItem, choose, planCost, setOncall } from "./plan";
import type { GameState } from "./types";
function smart(s: GameState): GameState {
  const req = blockingItem(s);
  if (req) s = choose(s, req.id, [...req.intents].sort((a, b) => a.cost - b.cost)[0].id);
  for (const item of s.inbox) {
    if (s.plan.choices[item.id]) continue;
    if (item.type === "promise_due" && planCost(s) + 2 <= s.capacity) {
      s = choose(s, item.id, "deliver");
      continue;
    }
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

import { applyReview } from "./career";
import { toggleOneOnOne } from "./plan";
it.skipIf(!process.env.SIM)("growth sim: skills and promotions over three quarters (SIM=1 to run)", () => {
  const grew: number[] = [];
  const perQuarter: number[][] = [[], [], []];
  let promos = 0;
  let ready = 0;
  let people = 0;
  for (const co of ["Vercel", "Stripe", "Google"] as const)
    for (let seed = 1; seed <= 10; seed++) {
      let s = newGame(co, seed);
      const start = new Map(s.engineers.map((e) => [e.id, e.attrs.coding + e.attrs.debugging + e.attrs.communication]));
      for (let q = 0; q < 3 && s.phase !== "recap"; q++) {
        while (s.phase !== "review") {
          // A manager who fights for their people in calibration.
          for (const item of s.inbox) if (item.arc?.beat === "calibration") s = choose(s, item.id, "allin");
          s = smart(s);
          // Coach two people a week, rotating, when there is room.
          for (const e of s.engineers.slice((s.week * 2) % s.engineers.length).slice(0, 2)) if (planCost(s) + 1 <= s.capacity) s = toggleOneOnOne(s, e.id);
          s = advanceFromBackPage(finishFriday(resolveWeek(s)));
          if (s.phase === "checkin") s = finishCheckin(s, 0);
        }
        for (const e of s.engineers) perQuarter[q].push(e.attrs.coding + e.attrs.debugging + e.attrs.communication - (e.qStart.coding + e.qStart.debugging + e.qStart.communication));
        promos += s.engineers.filter((e) => e.level > e.qStart.level).length;
        s = applyReview(s);
        if (s.phase === "offer" || s.phase === "hunt") break;
      }
      for (const e of s.engineers) {
        people++;
        if (e.attrs.coding + e.attrs.debugging + e.attrs.communication >= 0 && start.has(e.id)) grew.push(e.attrs.coding + e.attrs.debugging + e.attrs.communication - start.get(e.id)!);
        if (e.level < 7 && (e.attrs.coding + e.attrs.debugging + e.attrs.communication) / 3 >= e.level + 10) ready++;
      }
    }
  const avg = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)).toFixed(2);
  console.log("skill points per engineer per quarter", perQuarter.map(avg).join(" / "));
  console.log("max in a quarter", Math.max(...perQuarter.flat()), "zero-growth share", avg(perQuarter.flat().map((x) => (x <= 0 ? 1 : 0))));
  console.log("survivors' total growth", avg(grew), "promotions", promos, "promo-ready at end", ready, "of", people);
});

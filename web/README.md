# EM27 web

The playable game. Design and rules live one level up in `DESIGN.md` and `design-assets/handoff.md`.

```
npm install
npm run dev      # http://localhost:3000
npm test         # engine tests (Vitest)
npm run lint
SIM=1 npx vitest run src/engine/balance.sim.test.ts   # passive vs. sensible-player grade spread
```

## Layout

- `src/engine/`: the deterministic simulation. Pure TypeScript, seeded RNG, no DOM. Plan rules, Friday resolution, quarterly review, career.
- `src/content/`: companies, event types (intents, costs, effects, template text), name pools.
- `src/game/`: React screens. Markup and class names follow the design prototype; styles are in `src/app/game.css`.
- `src/app/api/llm/route.ts`: LLM proxy stub. Returns 503 `{ fallback: "template" }` until M2.

Saves are one JSON blob in localStorage (`em27.save.v1`), with copy/paste save codes in Office. Theme choice is `em27.theme`.

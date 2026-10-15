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
- `src/engine/director.ts` + `src/app/api/director/route.ts`: the AI director. While Friday plays, the client sends a brief of the game state and next week's candidate demands; Claude Haiku 5.5 picks which ones appear, which is must-respond, and why. The engine re-validates the picks and falls back to its seeded random draw on any error. The reasons show in the Week screen's "Picked by the AI director" panel.

## AI director setup

Create `web/.env.local` (git-ignored):

```
ANTHROPIC_API_KEY=sk-ant-...
# optional, defaults to claude-haiku-5-5
DIRECTOR_MODEL=claude-haiku-5-5
```

Without a key the game plays normally with the random draw, and the Week panel says why.

Saves are one JSON blob in localStorage (`em27.save.v1`), with copy/paste save codes in Office. Theme choice is `em27.theme`.

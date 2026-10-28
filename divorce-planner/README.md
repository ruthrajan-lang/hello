# Colorado Divorce Planner

Served at `/divorce-planner/` by the repo-root `hello` Worker (see `wrangler.jsonc` and `worker.js` at the root). Data is stored centrally in the Worker's KV namespace via `/divorce-planner/api/state`, with localStorage as an offline cache.

Three tabs: Planner (Colorado process checklist with computed 21/42/91-day deadlines), Worksheet (assets, debts, maintenance guideline estimate, budget), Documents (disclosure tracker, issues, printable summary).

Organizational aid, not legal advice. Verify forms at https://www.coloradojudicial.gov/self-help/divorce-family-matters.

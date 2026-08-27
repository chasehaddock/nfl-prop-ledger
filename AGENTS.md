# Repository operating instructions

Read `CONTINUATION_GUIDE.md` before changing this project. Treat it as the canonical product and data-policy reference.

- Work from the default `source` branch using a short-lived `codex/*` branch and a pull request.
- Preserve the separation between season, Week 1, and Sleeper data.
- Never weaken capture validation, include PrizePicks Demon/Goblin lines, invent unsupported Week 1 values, place bets, or modify sportsbook accounts.
- Never commit `.private`, browser data, cookies, credentials, raw captures, logs, `node_modules`, or `dist`.
- Run `npm run typecheck`, `npm run lint`, and `npm test` before merging.
- GitHub Pages deploys automatically after a verified merge to `source`.


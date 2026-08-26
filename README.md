# NFL Prop Ledger

A local-first NFL player-projection ledger with a public GitHub Pages dashboard.

- Public dashboard: https://chasehaddock.github.io/nfl-prop-ledger/
- Editable code: GitHub branch `source`
- Compiled public site: GitHub branch `main`
- Complete continuation instructions: [CONTINUATION_GUIDE.md](CONTINUATION_GUIDE.md)

## What it tracks

- Season-long and Week 1 QB, RB, WR, and TE player props.
- DraftKings, FanDuel, BetMGM, standard PrizePicks projections, and Underdog TD markets.
- Verified daily line history with source-colored charts and sportsbook averages.
- Full-PPR fantasy projections with 4/6-point passing-TD and TE-premium toggles.
- Sleeper 12-team full-PPR redraft ADP, ADP history, and coverage-adjusted positional value gaps.

The collector requires matching primary and confirmation passes. Failed or incomplete sources cannot overwrite verified data. PrizePicks Demon and Goblin rows are ignored. For Week 1 touchdown scoring, Underdog Higher/Lower modifiers are normalized together and preferred over slower one-sided touchdown markets; they are labeled as normalized pick'em modifiers rather than sportsbook no-vig odds.

## Install and verify

Use Node.js 22.13 or newer; Node 24 is the known-good version.

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run test:ui
npm run dev
```

The development site uses `http://127.0.0.1:5173/`. The installed private local dashboard uses `http://127.0.0.1:4173/`.

## New computer or GitHub account

Clone the editable branch, not the compiled Pages branch:

```bash
git clone --branch source https://github.com/chasehaddock/nfl-prop-ledger.git
cd nfl-prop-ledger
npm ci
```

Then follow [CONTINUATION_GUIDE.md](CONTINUATION_GUIDE.md). A new operator must authorize GitHub and set up the unpacked Chrome extension and sportsbook sessions locally. Credentials, cookies, browser profiles, raw captures, logs, and private machine files are intentionally not stored in GitHub.

## Daily collection

The supported installer creates machine-specific schedules:

```bash
npm run operator:install -- --dry-run
npm run operator:install
npm run operator:health -- --require-today
```

The configured morning flow opens Chrome, captures and validates every source once, retries only failed sources, processes valid evidence, rebuilds the public JSON and site, and publishes. The computer must be awake, logged in, online, and allowed to access the configured pages.

## Important projection rules

- Current displayed main lines are arithmetic averages of all current sources.
- Season and Week 1 data never mix.
- RB/WR/TE touchdown totals use current market data only—never prior-season touchdowns.
- Missing WR/TE receptions stay blank.
- The intentional season-only historical fallbacks are RB receptions/receiving yards and QB rushing yards/rushing TDs; all are labeled.
- Week 1 uses no season-history substitutions.
- Sleeper value gaps compare ranks within the exact same projection-complete positional pool.

See the continuation guide for the complete current contract.

## Repository safety

Committed to `source`:

- application and collector source;
- unpacked Chrome extension;
- processing and publishing scripts;
- tests;
- accepted snapshots and public history;
- operating documentation.

Never committed:

- `node_modules/`, `dist/`, `.private/`, `.env*`;
- raw capture evidence;
- Chrome profiles, cookies, or account credentials;
- logs, tokens, private keys, or sportsbook account data.

This project is for personal research. It never places bets or changes sportsbook account data.

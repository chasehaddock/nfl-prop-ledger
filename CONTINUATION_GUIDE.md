# NFL Prop Ledger continuation guide

This repository uses the following GitHub layout:

- `source`: the default branch and canonical editable application, collector, extension, tests, accepted snapshots, and operating documentation.
- Short-lived `codex/*` branches: one focused change per branch, merged into `source` through a pull request.
- GitHub Pages: built, tested, and deployed automatically by `.github/workflows/pages.yml` after a merge to `source`.
- `main`: legacy compiled output retained for history; do not edit it.

To continue from another GitHub account, first give that account write access to `chasehaddock/nfl-prop-ledger`, then clone the source branch:

```bash
git clone https://github.com/chasehaddock/nfl-prop-ledger.git
cd nfl-prop-ledger
npm ci
npm run typecheck
npm test
npm run test:ui
```

Use Node.js 22.13 or newer. Node 24 is the known-good version.

## What is included

- React/Vite dashboard in `app/` and `src/`.
- Five-market-source Chrome collector plus Sleeper ADP collection in `extension/` and `collector/`.
- Accepted season and Week 1 history in `data/` and generated public JSON in `public/data/`.
- Sleeper redraft ADP history and coverage-adjusted value analysis.
- Processing, validation, automation, and GitHub publishing scripts in `lib/` and `scripts/`.
- Full automated regression suite in `tests/`.

The source branch deliberately excludes `node_modules`, `dist`, `.private`, `.env` files, raw captures, browser profiles, cookies, account credentials, and logs.

## Current product rules

### Market collection

- Sources: DraftKings, FanDuel, BetMGM, PrizePicks, and fallback Underdog Week 1 player markets; Sleeper is collected separately for ADP.
- Season and Week 1 data are stored separately.
- Every capture requires a matching primary and confirmation pass.
- PrizePicks Demon and Goblin projections are ignored.
- Failed sources carry the previous observation as stale instead of deleting it.
- Current main lines are arithmetic averages of available current non-Underdog sources. Underdog fills a stat only when none of those sources carry it.
- Line-movement graphs retain each source and emphasize the sportsbook average.

### Fantasy scoring and inference

- Full PPR is the default.
- Passing touchdowns are 4 points, with a UI toggle for 6-point passing TDs.
- Rushing and receiving touchdowns are 6 points.
- Week 1 QBs keep passing-TD expectation and rushing/receiving TD probability separate. Underdog or standard PrizePicks `Rush + Rec TDs`/any-TD markets may supply the latter, which contributes 6 points and is shown separately in the TD cell.
- TE premium toggles: 0.0, 0.5, or 1.0 extra point per TE reception.
- RB/WR/TE touchdown totals never use prior-season touchdown statistics. Only current market projections are used.
- A positive rushing/receiving TD component may be derived only from a current total-TD market minus another current TD component from the same source.
- Zero or negative inferred components are hidden.
- Missing WR/TE receptions are left blank; prior-season reception guesses are not used.
- The intentional season-only historical exceptions are RB receptions/receiving yards and QB rushing yards/rushing TDs. They are labeled with their sample and method.
- Week 1 never substitutes season history.
- Week 1 QB passing-TD priority is FanDuel or another complete two-sided sportsbook market with vig removed, then Underdog normalized Higher/Lower modifiers. For one-way anytime-TD markets, the two-sided Underdog estimate remains preferable to a raw one-sided price. Underdog modifiers are normalized against each other but must not be described as true sportsbook no-vig odds.

### Sleeper redraft

- Format: 12 teams, full PPR, four-point passing TDs, no K/DST, top 250 maximum.
- Value gaps are position-specific.
- Comparable Sleeper rank and model rank use exactly the same projection-complete player pool.
- Players missing required fantasy inputs receive no value gap and appear under `Needs data` with the missing inputs listed.

## Chrome collector setup on a new computer

1. Run `npm run operator:install -- --dry-run` and inspect the proposed machine-specific setup.
2. Run `npm run operator:install`.
3. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this checkout's `extension` folder.
4. Open and sign in to legally available source pages in Chrome. PrizePicks and Underdog may require logged-in tabs for some boards.
5. Click the gray NFL Prop Ledger extension icon and run **Capture now** once.
6. Verify with `npm run operator:health -- --require-today`.

Chrome sessions and sportsbook logins cannot be transferred through GitHub. The new operator must authorize them locally. Never place bets or change sportsbook account data through this project.

## Daily operation

- Capture is currently started manually from the Chrome extension when the operator is available and connected to an unrestricted network.
- The installer removes legacy Chrome-opener and daily-processor schedules by default. `npm run operator:install -- --automatic` is available only as an explicit processor-scheduling opt-in; it still cannot bypass Chrome logins or start the extension capture.
- The collector performs one complete validated pass per source and retries only failed sources. It writes a compatible primary/confirmation pair for the processor.
- After capture, run `npm run operator:run`, verify with `npm run operator:health -- --require-today`, then commit the accepted `data/` and `public/data/` updates on a branch and merge them to `source`.
- The computer must be awake, logged in, online, and able to open Chrome during collection.

Raw capture evidence stays local under the configured intake directory and must not be committed.

## Publishing

Normal publishing is automatic: merge a verified pull request into `source`, and the Pages workflow tests, builds, and deploys the public site. Check the workflow in the repository's **Actions** tab.

The API publisher remains an emergency fallback:

```bash
GITHUB_ACTIONS=true npm run build
node scripts/publish-github-pages.mjs /absolute/path/to/gh dist chasehaddock/nfl-prop-ledger
```

The legacy sanitized-source publisher also remains available for recovery:

```bash
node scripts/publish-source-branch.mjs /absolute/path/to/gh chasehaddock/nfl-prop-ledger source
```

Run all checks before either publication:

```bash
npm run typecheck
npm run lint
npm test
npm run test:ui
```

## Safe migration to another account

1. Add the new GitHub account as a collaborator with write access.
2. Clone `source` and complete the Chrome/operator setup above.
3. Perform one supervised capture and verify the local build.
4. Publish once and confirm GitHub Pages.
5. Observe two successful manual capture/process/publish cycles before retiring the original computer.
6. Do not let two computers publish the same daily capture during the permanent handoff.

If the repository itself is transferred or renamed, update `vite.config.ts`, every repository argument in the publishing commands, GitHub Pages settings, and the documented public URL.

# NFL Prop Ledger handoff

The active, current computer-to-computer and account-to-account instructions are in [CONTINUATION_GUIDE.md](CONTINUATION_GUIDE.md).

Do not rely on older copies of this handoff that reference `statsleuthgame`, Cody, only three live sources, a private repository, or “highest-line” selection. Those descriptions predate the current Chase Haddock deployment and are obsolete.

Current anchors:

- Repository: `https://github.com/chasehaddock/nfl-prop-ledger`
- Editable branch: `source`
- Deployment: GitHub Actions builds Pages from verified `source` commits
- Public site: `https://chasehaddock.github.io/nfl-prop-ledger/`
- Sources: DraftKings, FanDuel, BetMGM, PrizePicks, Underdog fallback markets, and Sleeper ADP
- Node: 22.13+; Node 24 recommended
- Capture: manually started from the Chrome extension
- Private local site: `http://127.0.0.1:4173/`

A handoff is complete only after the new computer:

1. clones the `source` branch;
2. passes typecheck, lint, core tests, build, and UI tests;
3. loads the unpacked Chrome extension locally;
4. completes one verified two-pass capture;
5. publishes successfully to GitHub Pages; and
6. completes two verified manual capture/process/publish cycles.

GitHub deliberately excludes browser sessions, sportsbook credentials, raw capture evidence, and machine-private files. Those must be authorized or generated on the new computer and must never be uploaded.

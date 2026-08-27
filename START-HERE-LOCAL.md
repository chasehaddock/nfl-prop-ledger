# Start Here: Private Local NFL Prop Ledger

> This file describes the optional GitHub-free installation. For the active shared GitHub workflow, use `CONTINUATION_GUIDE.md` and `CONTRIBUTING.md` instead.

This folder is the complete GitHub-free handoff. It contains the application, the accepted historical ledger, the current public dashboard data, roster data, and an archive of every available raw browser capture included at packaging time.

The dashboard is private to this laptop. It runs at:

```text
http://127.0.0.1:4173/
```

`127.0.0.1` means the server accepts connections only from this computer. There is no GitHub account, public website, domain, cloud database, or paid API requirement.

## Instruction for the receiving ChatGPT/Codex

Open this extracted folder as the local workspace. Read this file and `BUDDY_CHATGPT_HANDOFF.md`, but use **local-only mode** wherever the longer handoff discusses GitHub. Do not create a GitHub account or remote unless the owner later asks for one.

Execute the setup for the detected operating system:

```bash
npm run operator:install -- --local
```

The installer discovers the machine's paths, installs exact dependencies, runs typecheck/lint/tests/build, creates the private dashboard service, opens Chrome before each collection, schedules the collector processor, and writes a local-only marker. It must never request GitHub credentials in this mode.

If Node is not installed, install Node 24 from the official Node.js distribution first. Google Chrome and an internet connection are required for sportsbook collection. Git is not required.

The only supervised security steps are:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this folder's `extension` directory.
4. Open each configured sportsbook page and confirm it is legally available in the operator's physical location.
5. Click **Capture now** once for the acceptance test.

After that capture finishes, run:

```bash
npm run operator:run
npm run operator:health -- --require-today
```

The health command must confirm the Chrome opener, daily processor, local dashboard service, today's evidence/snapshot, and local-only storage. Open `http://127.0.0.1:4173/` and verify the player table and inline ledgers.

## Normal daily behavior

- 8:10 AM local: the laptop opens Chrome.
- 8:17 AM local: the extension captures DraftKings, FanDuel, BetMGM, and PrizePicks twice.
- 8:32 AM local: the processor waits for complete or settled valid evidence.
- The processor updates `data/snapshots/`, `public/data/`, and the private `dist/` website.
- The local dashboard immediately reflects the new build after refresh.
- Nothing is committed, pushed, uploaded, or published.

The computer must be awake, logged in, online, and allowed to open Chrome. Configuring an automatic wake schedule requires the laptop owner's explicit approval because it changes system power settings.

## Included history

At packaging time the accepted ledger includes snapshots for August 19–22, 2026. The August 22 snapshot contains 653 observations: 296 DraftKings, 140 FanDuel, and 207 BetMGM. The `raw-captures/` directory is an audit archive and is not automatically re-ingested; new captures are written to the operator's normal `Downloads/nfl-prop-ledger/YYYY-MM-DD/` directory.

## Making changes with Codex

Tell Codex:

> This is a private local NFL Prop Ledger with no GitHub. Read START-HERE-LOCAL.md and BUDDY_CHATGPT_HANDOFF.md. Preserve the two-pass accuracy rules and local-only mode. Implement my requested change, run typecheck, lint, and all tests, rebuild the local site, and verify it at http://127.0.0.1:4173/.

Useful commands:

```bash
npm run site:local                    # serve the private dashboard manually
npm run build                         # rebuild after a display/code change
npm test                              # full logic/build/render verification
npm run operator:run                  # process today's fresh browser capture
npm run operator:health               # inspect local automation
npm run operator:health -- --require-today
```

Keep the entire extracted folder. The daily historical snapshots live inside it. Periodically copy the folder to an external drive if the history matters; without GitHub, the laptop is the primary copy.

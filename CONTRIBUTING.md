# Working together

The editable project lives on the default `source` branch. GitHub Pages is built automatically from verified `source` commits; do not edit the compiled `main` branch.

## Start a change

```bash
git switch source
git pull --ff-only origin source
git switch -c codex/short-description
npm ci
```

Make one focused change, then verify it:

```bash
npm run typecheck
npm run lint
npm test
```

Commit, push, and open a pull request into `source`:

```bash
git add -A
git commit -m "Describe the change"
git push -u origin HEAD
```

Merge only after the **Test and deploy Prop Ledger** check passes. After merging, GitHub automatically deploys the public site.

## Avoid conflicts

- Always pull `source` before starting.
- Use a separate branch for each change; do not have two people edit directly on `source` simultaneously.
- Keep generated browser captures, logins, cookies, `.private`, `dist`, and secrets off GitHub.
- Public accepted snapshots in `data/` and `public/data/` may be committed when they are part of a verified capture.
- Never place bets or modify sportsbook account data through this project.

Read `CONTINUATION_GUIDE.md` before changing collection, scoring, inference, or publishing rules.


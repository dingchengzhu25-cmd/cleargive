# Contributing to ClearGive

Thank you for your interest. ClearGive is a research prototype. Contributions that improve correctness, clarity, tests and documentation are especially welcome.

## Ground rules

- **Keep the money rules intact unless a change is explicitly discussed first.** Please open an issue before proposing any change to:
  - the 1% added fee or its 60/40 split;
  - the two-reviewer approval rule;
  - fixed supplier payment;
  - refund eligibility or pro-rata calculation;
  - reviewer credits.
- **Never weaken or delete a test to make a change pass.** If behaviour changes on purpose, update the test and explain why in the pull request.
- **Keep demo data fictional.** Do not add real personal data, real private keys, mnemonics, API tokens or account identifiers anywhere, including demo checkpoints and fixtures.
- **Add third-party assets only with a confirmed licence.** Record the source and licence in `THIRD_PARTY_NOTICES.md`. Do not re-add the original stock photographs (see that file).
- Report security issues privately, as described in [SECURITY.md](SECURITY.md).

## Development setup

You need Node.js 24 or newer and pnpm 11.25.0 (`corepack enable`, or `npm install --global pnpm@11.25.0`).

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm start   # http://127.0.0.1:4173/demo
```

- `pnpm build` regenerates `artifacts/contracts.json`, `public/assets/demo-chain.json` and `dist/`. These files are not committed.
- If you change the contracts or the prepared scenarios, the checkpoint is rebuilt automatically when it no longer matches the compiled contracts. To force a rebuild, delete `public/assets/demo-chain.json`.
- Do not upgrade dependencies casually. If an upgrade is needed, update `pnpm-lock.yaml` in the same pull request and explain the reason.

## Pull requests

1. Fork the repository and create a topic branch from `main`.
2. Keep each change focused, and add or adjust tests in `tests/`.
3. Make sure `pnpm build` and `pnpm test` pass locally. CI runs the same steps.
4. In the pull request description, state what changed, why, and how you verified it. Mention any user-visible or rule-related effects.

By contributing, you agree that your contribution is licensed under the repository's MIT License (see `LICENSE`).

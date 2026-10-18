# Verification guide

This guide maps ClearGive's implementation claims to executable tests, and records the verification run for the first public release of this repository.

## Implementation under test

The current demo uses:

- `DemoUSD` (CGUSD) from `contracts/ClearGive.sol`;
- `ClearGiveFeeFactory`, `ClearGiveFeeCampaign` and `ClearGiveFeeVault` from `contracts/ClearGiveFees.sol`.

The fee campaign inherits the base escrow's approval, fixed-payment and deadline/refund guards. The contract-control fixtures in `tests/contracts.test.mjs` deploy the **current fee factory and fee campaigns**, not only the earlier zero-fee factory.

Browser deployment and token/account setup are in `src/chain.js`; the prepared example transactions are in `src/demo-scenarios.js`. The browser starts its own Ganache EVM, so no external node or bank account needs configuring.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm build      # must run before tests on a fresh clone (generates artifacts/ and the demo checkpoint)
pnpm test
pnpm start      # http://127.0.0.1:4173/demo
```

## Claim-to-test evidence

| Claim | Executable evidence |
| --- | --- |
| SGD 100 + SGD 1 sends SGD 100 to escrow and SGD 1 to the fee vault, allocating SGD 0.60/0.40 | `tests/fees.test.mjs`: “a 1% fee is atomic, separately backed, correctly allocated and excluded from donation refunds” |
| Inadequate funds/allowance roll back principal, fee and counters | `tests/fees.test.mjs`: “insufficient total balance or allowance rolls back the donation, fee and all counters” |
| Payment fails without full funding, and with zero or one approval | `tests/contracts.test.mjs`: “current 1% supplier payment requires full funding and two distinct approvals; organiser receives nothing” |
| Both reviewers must approve the same evidence revision; stale evidence cannot approve a replacement | `tests/contracts.test.mjs`: “rejection resets both approvals and stale evidence signatures cannot approve revised evidence” |
| Revised evidence has zero approvals; another review cycle is required | The same revision test explicitly checks revision 2 and approvals 0 before recording two new approvals. The current workflow permits replacement following rejection, rather than arbitrary edits to an approved invoice. |
| Payment goes to the immutable fixed supplier, not the organiser | The first current 1% supplier-payment test checks both recipient balance changes. |
| The same milestone cannot be paid twice | `tests/contracts.test.mjs`: “duplicate approvals and duplicate milestone payments revert” |
| Refunds cannot open before the applicable deadline | `tests/contracts.test.mjs`: “failed fundraising refunds contributions in full and cannot open refunds early”; “partial spending refunds only the remainder, proportionally; no double claims or later releases” also tests early opening in the fully funded case. |
| Open refunds block subsequent supplier payments | The partial-spending test approves the second order, opens refunds after the delivery deadline, and verifies that its release fails. |
| Donors receive their share of the unspent balance; supplier payments are excluded | The partial-spending test checks SGD 360/240 refunds from SGD 600 unspent; `tests/fees.test.mjs` separately checks the same result with SGD 10 fees retained as SGD 6/4 reserves. |
| Duplicate claims and non-donor claims fail | The partial-spending test checks a second donor claim and an organiser/non-donor claim both fail. |
| Refund rounding settles the entire pool | `tests/contracts.test.mjs`: “refund rounding settles the full pool with the last claimant” |
| Reviewers share credits once after both participate, including rejection; no revision farming or cash refund | `tests/fees.test.mjs`: “both reviews award equal donation-only credits once, including rejection; credit refunds cannot cash out” |
| Per-gift figures reconcile without counting whole campaign payments as a donor's payment | `tests/demo-scenarios.test.mjs` and `tests/donation-flow.test.mjs` check multiple gifts, proportional payments, pending/settled refunds, fees and rounding. |
| Governance chart changes amounts as funds progress | `tests/admin-governance.test.mjs` checks collecting → evidence → review/rejection → ready → paid/delivery → deadline/refund transitions; `tests/demo-scenarios.test.mjs` checks the stages against actual prepared EVM state. |
| Replay/resume does not duplicate the twelve prepared cases or 29 donations | `tests/demo-scenarios.test.mjs` checks idempotence, reload, scenario states and financial totals. |

## Scope of the evidence

The complete suite includes legacy migration, browser workflows, sharing, signed statements and safeguards for the separate public-network setup. Tests concerning optional gateway/public-network code do not mean those services are activated. Approval/refund claims in the table above are tested against current fee-enabled local contracts.

The demonstration does not prove real cash settlement, public-chain deployment, independent human identity, invoice truth, physical delivery, random reviewer assignment, legal readiness, production security or commercial cost coverage.

## Verification record — first public release (18 October 2026)

**Inputs.** The source ZIP of the final code submission (v2.0.0). The repository was assembled from a fresh extraction of that ZIP.

**Release changes, none of which alter the fee, approval, payment or refund rules:**

- the photographs were replaced by placeholders;
- `scripts/build.mjs` now copies dependency licence notices into `dist/licenses/`;
- generated files and the packaging script were removed;
- documentation was added.

### Environment

The release environment had no direct registry access and no Node.js 24.

- **Node.js:** v22.22.0, not the documented 24+. GitHub Actions runs the same steps on Node.js 24 (see CI).
- **Dependencies:** installed from npm tarballs matching `pnpm-lock.yaml`. All 55 tarballs needed on Linux passed their lockfile `sha512` integrity checks, and the files were laid out in pnpm's `node_modules/.pnpm` structure.
- **Scripts:** run directly (`node scripts/build.mjs`, `node --test tests/*.test.mjs`, `node scripts/serve.mjs`), exactly as `pnpm build` / `pnpm test` / `pnpm start` define them. `pnpm install --frozen-lockfile` itself is exercised in CI.

### Build

The build succeeded from a clean copy of the repository contents, with no `dist/`, `artifacts/` or checkpoint present.

- It regenerated `artifacts/contracts.json` and `public/assets/demo-chain.json`: 12 campaigns and 115 journal requests, with an artifacts hash matching the original package.
- `artifacts/contracts.json`, `dist/app.js`, `dist/live.js`, `dist/_worker.js`, `dist/styles.css` and `dist/ganache.min.js` were byte-identical to the files in the original submission.

### Tests

`node --test tests/*.test.mjs` gave **78 tests, 78 passed, 0 failed, 0 skipped, 0 cancelled**, in about 4.5 minutes.

The run was repeated on the unmodified original package, with the same result: 78/78. The only warnings were Ganache's optional native bindings falling back to JavaScript, and Node's `node:sqlite` experimental notice.

### Server

`scripts/serve.mjs` returned HTTP 200 for:

- `/demo` and `/`;
- `/app.js`, `/styles.css` and `/ganache.min.js`;
- `/assets/demo-chain.json`, a placeholder photo and `/assets/mark.svg`;
- `/photo-credits.html`, `/licenses/ganache.txt` and `/config.json`.

### Browser

Headless Chromium (Playwright) loaded `/demo` from the local server. There were no page errors and no failed same-origin requests. The only failed requests were Google Fonts, which were blocked by the sandbox network. The following flows were then carried out through the UI:

| Flow | Observed result |
| --- | --- |
| Donation with fee | Alex Morgan donated SGD 100 to Fresh Groceries for Bedok Families. Escrow went from SGD 800 to SGD 900, fees collected from SGD 8 to SGD 9, and the wallet from SGD 899.60 to SGD 798.60 (SGD 101 deducted). The review dialog showed the SGD 0.60 / SGD 0.40 split. |
| Evidence approval | As Daniel Wong (Reviewer 2), approved revision 2 on A Reading Corner for Tampines Children. "Approval recorded on-chain" appeared, both reviewers were marked approved, and no second reviewer award was made. |
| Supplier payment | "Release supplier payment" paid SGD 1,000 to the fixed supplier (Bright Books). Escrow became SGD 0, supplier payments SGD 1,000, and no further release control remained. Delivery stayed "not recorded" and separate from payment. |
| Refund | As Mei Tan, claimed the refund on Learning Kits for a Fresh Start: SGD 240 refunded, "still held for refunds" became SGD 0, and the original pool was SGD 600 (Alex SGD 360 + Mei SGD 240). The SGD 400 already paid stayed paid, and the SGD 10 fee stayed separate. |

### Not verified here

- Running under Node.js 24 and running `pnpm install` against the live registry (covered by CI).
- Other browsers, mobile layouts, and the hosted site's own build.

No public blockchain transactions and no real-money payments were made by any of these checks.

### Earlier figures

Earlier project documents reported 72 tests (17 October 2026 submission) and 74 tests (refund-rounding update). Those numbers describe earlier code versions. The current suite has 78 tests.

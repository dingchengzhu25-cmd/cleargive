# Prepared demonstration scenarios

The site installs twelve current 1% fee and reviewer-credit scenarios once per workspace. Existing campaign generations move outside the presentation views; their immutable history stays in the export archive. Setup records actual local-EVM transactions, and sample registration/delivery checks are signed statements. Reloading or resuming setup does not duplicate contributions or awards.

Use **Demo controls → Prepared presentation scenarios** to open a campaign or Alex's money flow. Switch to **Mei's donations** for the pending refund. **Rebuild prepared examples** restores a fresh set after a confirmation; it advances the workspace clock by two days. The initial refund scenarios are prepared before the active campaigns, so their deadlines do not expire the active examples.

| Prepared starting point | Principal collected | Platform fee | What to demonstrate |
| --- | ---: | ---: | --- |
| Funding in progress | SGD 800 | SGD 8 | Donate more; see the fee and personal held amount change |
| Fully funded, invoice needed | SGD 1,000 | SGD 10 | Organiser submits evidence |
| Revised invoice, one approval | SGD 1,000 | SGD 10 | Second reviewer approves; no second campaign reward |
| Two approvals, ready to pay | SGD 1,500 | SGD 15 | Release a fixed supplier payment |
| Changes requested | SGD 1,000 | SGD 10 | Payment blocked even though reviewer participation earned credits |
| First supplier paid, second held | SGD 1,000 | SGD 10 | Alex's two gifts have distinct personal allocations |
| Supplier paid, delivery pending | SGD 500 | SGD 5 | Payment does not establish delivery |
| Delivery confirmed | SGD 1,200 | SGD 12 | Separate signed supplier and organiser delivery statements |
| Partial refund | SGD 1,000 | SGD 10 | Alex received SGD 360; Mei still has SGD 240 to claim |
| Funding target missed | SGD 600 | SGD 6 | Full principal returned; fees retained |
| Credit-funded refund | SGD 32 | SGD 0.32 | Reviewers recover credits, not cash; wallet donors recover wallet principal |
| Reviewer credits donated onward | SGD 160 | SGD 1.60 | Credits fund an unrelated campaign and its 1% fee |

Initial current-generation totals: SGD 9,792 contributed, SGD 6,300 held, SGD 2,500 paid to suppliers, SGD 992 refunded, SGD 97.92 fees. These are a starting state, not fixed dashboard values. Participant actions update all views.

## Personal accounting

**Held principal + proportional supplier-payment share + refunded principal = that donor's contributed principal.** Add the donor's fee to reconcile the full charge. Operations and reviewer portions are subdivisions of this fee, not additional charges.

For Alex's SGD 600 partial-refund gift: SGD 240 paid + SGD 360 refunded + SGD 0 held + SGD 6 fee = SGD 606 charged. Mei's SGD 400 gift initially shows SGD 160 paid + SGD 240 held for refund + SGD 4 fee = SGD 404 charged. Claiming moves her SGD 240 from held to refunded, without changing the charge.

My donations, receipts and personal flow diagrams use this same model. Tokens pool in campaign escrow: the personal splits are proportional accounting allocations, not token provenance. Settled refund events override estimates, including micro-unit rounding. Multiple deposits by one donor share any aggregate refund proportionally, with integer allocation keeping each row and donor total reconciled. Full campaign context is separately labelled and collapsed in the personal flow.

Reviewer credits have no cash-out or transfer function. Credit-funded principal refunds restore credits. Both assigned reviewers split the campaign's 40% reviewer allocation once after participation, including rejection; revisions and later milestones cannot farm additional rewards.

## Public campaign presentation

Each of the twelve examples has a distinct cause name, cause-specific story and a unique real photograph. Cards and campaign pages identify the actual organiser account. These are fictional initiatives, not claims of partnerships with real charities; the photography credits explain that images are representative.

Public editorial copy is maintained in `src/campaign-content.js`. Existing signed metadata, contract names, campaign addresses and transaction history are preserved. The fixed-terms dialog identifies the original registered name whenever it differs from the clearer public name. A future rebuild fingerprints the updated copy at creation. Updating the presentation does not rotate factories or reset donations. Scenario explanations remain in Demo controls.

## Live governance chart

Rules & responsibilities shows exclusive current principal locations for all current campaigns or a selected campaign: collecting, awaiting invoice, awaiting reviewer decisions, changes requested, ready for release, claimable after a missed funding deadline, claimable after the payment/delivery deadline, already paid and already refunded. Rejection remains held and can return to review after resubmission; it does not open refunds. Completed payments have separate delivery-pending/confirmed subdivisions. The chart uses current chain data on each render, distinguishes cumulative fees from vault holdings, and reconciles principal plus fees without double counting stage subtotals.

Rare micro-unit refund differences are shown as a signed rounding adjustment beside actual held, paid and refunded outcomes. The prepared whole-cent examples have zero adjustment. Final claim order can change the smallest token units in unclaimed estimates. No deployed campaign refund rule is rewritten.

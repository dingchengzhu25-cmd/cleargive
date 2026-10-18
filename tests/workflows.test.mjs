import { test } from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { WorkflowChain, verifyAttestation, isReviewer } from '../src/workflows.js';
import { identities, fingerprint } from '../src/chain.js';

const registration = { registration: 'SAMPLE-ORG-2026', purpose: 'Provide fictional community learning resources for local families.', document: 'Sample registration certificate', conflicts: 'No declared supplier or reviewer relationships.' };
const delivery = { reference: 'DELIVERY-001', quantity: '5 learning kits', receivedOn: '2026-10-15', notes: 'Fictional delivery receipt checked against the agreed order.' };

test('organisation oversight, independent campaign rules and delivery remain distinct from payment', async t => {
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  globalThis.window = { Ganache: ganache };
  let chain = new WorkflowChain(() => {}), disconnected = false;
  await chain.init();
  try {
    const donor = await chain.createAccount('Jordan Donor', 'personal', 1000);
    const organiser = await chain.createAccount('Reading Together', 'business', 0);
    const supplier = await chain.createAccount('Community Books Supplier', 'business', 0);
    const reviewer1 = await chain.createAccount('Independent Reviewer One', 'reviewer', 0);
    const reviewer2 = await chain.createAccount('Independent Reviewer Two', 'reviewer', 0);
    const reviewers = [chain.accounts[reviewer1], chain.accounts[reviewer2]];
    const plan = overrides => ({ title: 'Books for our neighbourhood', description: 'Learning kits and books for a fictional community reading corner.', fundingDays: 1, deliveryDays: 1, reviewers, milestones: [{ title: 'First book order', supplier: chain.accounts[supplier], amount: 50 }, { title: 'Second book order', supplier: chain.accounts[supplier], amount: 50 }], ...overrides });
    const find = address => chain.campaigns.find(c => c.address.toLowerCase() === address.toLowerCase());
    const approveRegistration = async target => { await chain.requestVerification(target, registration); await chain.reviewVerification(target, reviewer1, true, 'Checked fictional registration details and declared interests.', true); };
    const pay = async (address, id) => { await chain.submit(address, id, { name: 'Sample invoice', invoiceNumber: `INV-${id}`, quantity: '5', unitPrice: '10', supplierChecks: 'Supplier registration reviewed', note: 'Five fictional learning kits at SGD 10 each.' }, organiser); await chain.review(address, id, reviewer1, true); await chain.review(address, id, reviewer2, true); await chain.release(address, id, organiser); await chain.refresh(); };

    await t.test('reviewer profiles persist and conflicting assignments are refused before a campaign opens', async () => {
      assert.equal(isReviewer(reviewer1), true); assert.equal(identities[reviewer1].role, 'Reviewer');
      for (const bad of [[reviewers[0], reviewers[0]], [chain.accounts[organiser], reviewers[1]], [chain.accounts[donor], reviewers[1]], [chain.accounts[supplier], reviewers[1]]]) await assert.rejects(() => chain.create(plan({ reviewers: bad }), organiser));
      const address = await chain.create(plan(), organiser); const contract = chain.contract(address);
      assert.equal((await contract.reviewer1()).toLowerCase(), reviewers[0].toLowerCase());
      assert.equal((await contract.reviewer2()).toLowerCase(), reviewers[1].toLowerCase());
      await chain.donate(address, donor, 100); await chain.submit(address, 0, { name: 'Independent review invoice', note: 'Fictional order supporting the first agreed milestone.' }, organiser);
      await assert.rejects(() => chain.review(address, 0, 3, true));
      await chain.review(address, 0, reviewer1, true); await assert.rejects(() => chain.release(address, 0, organiser));
      await chain.review(address, 0, reviewer2, true); await chain.release(address, 0, organiser);
    });

    await t.test('registrations require independent reviewer decisions and a conflict declaration', async () => {
      await assert.rejects(() => chain.requestVerification(donor, registration));
      const entry = await chain.requestVerification(organiser, registration);
      assert.equal(verifyAttestation(entry), true); assert.equal(chain.verification(chain.accounts[organiser]).status, 'Pending review');
      await assert.rejects(() => chain.requestVerification(organiser, registration));
      await assert.rejects(() => chain.reviewVerification(organiser, organiser, true, 'Self assessment is not independent.', true));
      await assert.rejects(() => chain.reviewVerification(organiser, donor, true, 'Not a registered reviewer.', true));
      await assert.rejects(() => chain.reviewVerification(organiser, reviewer1, true, 'Undeclared conflict must prevent approval.', false));
      await chain.reviewVerification(organiser, reviewer1, false, 'Please supply a clearer sample certificate.', true);
      assert.equal(chain.verification(chain.accounts[organiser]).status, 'Changes requested');
      await chain.requestVerification(organiser, registration);
      await chain.reviewVerification(organiser, reviewer2, true, 'Replacement fictional certificate checked.', true);
      assert.equal(chain.verification(chain.accounts[organiser]).status, 'Review approved');
    });

    await t.test('signed attestations reject changed signatures, payloads and unsigned message rebinding', async () => {
      const entry = chain.verification(chain.accounts[organiser]).submission;
      assert.equal(verifyAttestation({ ...entry, signature: '0x1234' }), false);
      const payload = { ...entry.payload, registration: 'FORGED-REGISTRATION' };
      assert.equal(verifyAttestation({ ...entry, payload }), false);
      assert.equal(verifyAttestation({ ...entry, payload, payloadHash: fingerprint(payload) }), false, 'signature must bind the exact payload hash, not an unrelated message');
      assert.equal(verifyAttestation({ ...entry, kind: 'Registration approved' }), false, 'statement kind must be signed');
    });

    await t.test('new governed projects require approved organiser and supplier, not a forged status', async () => {
      await assert.rejects(() => chain.create(plan({ requireVerification: true, conflictsConfirmed: true }), organiser));
      await approveRegistration(supplier);
      await assert.rejects(() => chain.create(plan({ requireVerification: true, conflictsConfirmed: false }), organiser));
      const v = chain.verification(chain.accounts[supplier]), original = v.review;
      v.review = { ...original, signature: '0x1234' };
      await assert.rejects(() => chain.create(plan({ requireVerification: true, conflictsConfirmed: true }), organiser), /approval|registration|signature|valid|attestation/i);
      v.review = original;
      const address = await chain.create(plan({ requireVerification: true, conflictsConfirmed: true, costs: [{ label: 'Project administration', amount: 5, payer: 'Organisation sponsor' }] }), organiser);
      await chain.refresh(); assert.equal(find(address).costs[0].payer, 'Organisation sponsor');
    });

    await t.test('operating costs reject missing payers and invalid amounts without consuming donations', async () => {
      for (const cost of [{ amount: -1, payer: 'Sponsor' }, { amount: Infinity, payer: 'Sponsor' }, { amount: 1000001, payer: 'Sponsor' }, { amount: 1, payer: ' ' }]) await assert.rejects(() => chain.create(plan({ costs: [cost] }), organiser));
      const address = await chain.create(plan({ costs: [{ label: 'Administration', amount: 10, payer: 'Sponsor' }] }), organiser);
      await chain.refresh(); assert.equal(find(address).target, 100); assert.equal(find(address).costs[0].amount, 10);
    });

    await t.test('payment does not confirm delivery; supplier submits and assigned people accept signed statements', async () => {
      const address = await chain.create(plan(), organiser); await chain.refresh();
      await assert.rejects(() => chain.submitDelivery(address, 0, delivery, supplier), /payment/i);
      await chain.donate(address, donor, 100); await pay(address, 0);
      assert.equal(find(address).milestones[0].paid, true); assert.equal(find(address).milestones[0].delivery.status, 'Not recorded'); assert.equal(find(address).deliveryStatus, 'Delivery pending');
      const paidBalance = await chain.token.balanceOf(chain.accounts[supplier]); const escrowBalance = await chain.token.balanceOf(address);
      await assert.rejects(() => chain.submitDelivery(address, 0, delivery, donor), /supplier/i);
      await chain.submitDelivery(address, 0, delivery, supplier); await chain.refresh(); assert.equal(find(address).milestones[0].delivery.status, 'Awaiting acceptance');
      await assert.rejects(() => chain.acceptDelivery(address, 0, supplier, true, 'Supplier cannot accept its own delivery.'), /organiser|reviewer/i);
      await assert.rejects(() => chain.acceptDelivery(address, 0, donor, true, 'Unassigned donor cannot accept delivery.'), /organiser|reviewer/i);
      await chain.acceptDelivery(address, 0, reviewer1, false, 'Please clarify the recorded quantities.');
      await chain.submitDelivery(address, 0, { ...delivery, quantity: '5 complete kits' }, supplier);
      await chain.acceptDelivery(address, 0, organiser, true, 'Fictional quantity and receipt checked.');
      await assert.rejects(() => chain.submitDelivery(address, 0, delivery, supplier), /confirmed/i);
      assert.equal(await chain.token.balanceOf(chain.accounts[supplier]), paidBalance); assert.equal(await chain.token.balanceOf(address), escrowBalance);
      await pay(address, 1); await chain.refresh(); assert.equal(find(address).status, 'Completed'); assert.equal(find(address).deliveryStatus, 'Delivery pending');
      await chain.submitDelivery(address, 1, { ...delivery, reference: 'DELIVERY-002' }, supplier); await chain.acceptDelivery(address, 1, reviewer2, true, 'Reviewed delivery statement and sample receipt.'); await chain.refresh();
      assert.equal(find(address).deliveryStatus, 'Delivery confirmed');
      for (const milestone of find(address).milestones) for (const statement of milestone.delivery.history) assert.equal(verifyAttestation(statement), true);
    });

    await t.test('funding deadlines refund partial funding; delivery refunds preserve previously paid supplier funds', async () => {
      const underfunded = await chain.create(plan(), organiser); await chain.donate(underfunded, donor, 30); await chain.refresh();
      const before = chain.balances[donor]; await chain.advanceDeadline(underfunded, 'funding'); await chain.claim(underfunded, donor); await chain.refresh(); assert.equal(chain.balances[donor], before + 30); assert.equal(await chain.token.balanceOf(underfunded), 0n);
      const partial = await chain.create(plan(), organiser); await chain.donate(partial, donor, 100); await pay(partial, 0);
      const supplierBefore = await chain.token.balanceOf(chain.accounts[supplier]), donorBefore = chain.balances[donor];
      await chain.advanceDeadline(partial, 'delivery'); await chain.claim(partial, donor); await chain.refresh();
      assert.equal(chain.balances[donor], donorBefore + 50); assert.equal(await chain.token.balanceOf(chain.accounts[supplier]), supplierBefore); assert.equal(await chain.token.balanceOf(partial), 0n);
      await assert.rejects(() => chain.release(partial, 1, organiser));
    });

    await t.test('reload and report preserve signed registration and delivery histories plus reviewer identities', async () => {
      const report = await chain.exportReport(); assert.ok(report.registrations); assert.ok(Object.keys(report.deliveries).length >= 2); assert.match(report.attestationNotice, /not blockchain events/i);
      const registrations = JSON.stringify(report.registrations), deliveries = JSON.stringify(report.deliveries);
      await chain.ganache.disconnect(); disconnected = true; chain = new WorkflowChain(() => {}); await chain.init(); disconnected = false;
      const restored = await chain.exportReport(); assert.equal(JSON.stringify(restored.registrations), registrations); assert.equal(JSON.stringify(restored.deliveries), deliveries); assert.equal(isReviewer(reviewer1), true);
      for (const v of Object.values(restored.registrations)) for (const entry of v.history) assert.equal(verifyAttestation(entry), true);
      for (const d of Object.values(restored.deliveries)) for (const entry of d.history) assert.equal(verifyAttestation(entry), true);
    });
  } finally { if (!disconnected) await chain.ganache.disconnect(); delete globalThis.window; delete globalThis.localStorage; }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleSharedApi, MAX_RECORD_BYTES } from '../src/shared-api.js';
import { SharedWorkspace } from '../src/shared-workspace.js';

const journal = () => ({ genesis: 123456, rpc: [], metadata: {}, evidence: {}, deployments: {} });
function fixture() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(readFileSync(new URL('../docs/shared-schema.sql', import.meta.url), 'utf8'));
  const db = { prepare(sql) {
    const query = sqlite.prepare(sql); let values = [];
    const statement = { bind(...args) { values = args; return statement; }, async first() { return query.get(...values) || null; }, async run() { const r = query.run(...values); return { success: true, meta: { changes: r.changes } }; } };
    return statement;
  }, async batch(queries) { sqlite.exec('BEGIN'); try { const result = []; for (const q of queries) result.push(await q.run()); sqlite.exec('COMMIT'); return result; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } };
  let now = 1700000000000;
  const fetcher = (url, init) => handleSharedApi(new Request(new URL(url, 'https://cleargive.example'), init), { SANDBOX_DB: db }, { now: () => now });
  const client = () => new SharedWorkspace({ fetcher, storage: { getItem: () => null, setItem() {}, removeItem() {} } });
  return { db, sqlite, fetcher, client, advance(seconds) { now += seconds * 1000; } };
}

test('shared clients see committed money and concurrent edits cannot overwrite each other', async () => {
  const f = fixture(), alice = f.client(), bob = f.client();
  const created = await alice.create(journal(), 'Community group');
  await bob.join(created.id, created.inviteCode);
  await alice.acquire(0);
  await assert.rejects(bob.acquire(0), { status: 409 });
  const updated = journal(); updated.metadata.campaign = { raised: 50, held: 50 };
  await alice.commit(updated);
  await assert.rejects(bob.acquire(0), { status: 409 });
  const pulled = await bob.pull(); assert.equal(pulled.revision, 1); assert.equal(pulled.record.metadata.campaign.held, 50);
  await bob.acquire(); await bob.commit(pulled.record);
  assert.equal((await alice.pull()).revision, 2);
  f.sqlite.close();
});

test('expired editor cannot commit after another participant takes the lease', async () => {
  const f = fixture(), a = f.client(), b = f.client(); const created = await a.create(journal(), 'Lease recovery'); await b.join(created.id, created.inviteCode);
  await a.acquire(); f.advance(91); await b.acquire();
  await assert.rejects(a.commit(journal()), { status: 409 });
  await b.commit(journal()); assert.equal((await a.pull()).revision, 1);
  f.sqlite.close();
});

test('renewal protects a long action, release allows the next action', async () => {
  const f = fixture(), a = f.client(), b = f.client(); const created = await a.create(journal(), 'Long action'); await b.join(created.id, created.inviteCode);
  await a.acquire(); f.advance(60); await a.renew(); f.advance(60);
  await assert.rejects(b.acquire(), { status: 409 });
  await a.release(); await b.acquire(); await b.release();
  f.sqlite.close();
});

test('invites grant workspace access only and rotating an invite prevents future joins', async () => {
  const f = fixture(), a = f.client(), b = f.client(); const created = await a.create(journal(), 'Invitations');
  const unauthorised = await f.fetcher(`/api/workspaces/${created.id}`); assert.equal(unauthorised.status, 401);
  await assert.rejects(b.join(created.id, '0'.repeat(64)), { status: 403 });
  await b.join(created.id, created.inviteCode);
  await assert.rejects(b.rotateInvite(), { status: 403 });
  const next = await a.rotateInvite(); const c = f.client();
  await assert.rejects(c.join(created.id, created.inviteCode), { status: 403 });
  await c.join(created.id, next.inviteCode); assert.equal((await b.pull()).id, created.id);
  const rows = f.sqlite.prepare('SELECT owner_hash,invite_hash FROM sandbox_workspaces').get();
  assert.notEqual(rows.owner_hash, created.token); assert.notEqual(rows.invite_hash, next.inviteCode);
  f.sqlite.close();
});

test('journal bounds and unknown replay methods are rejected; unconfigured storage is explicit', async () => {
  const f = fixture(), a = f.client(); const huge = journal(); huge.metadata.large = 'a'.repeat(MAX_RECORD_BYTES);
  await assert.rejects(a.create(huge, 'Oversized'), { status: 413 });
  const invalid = journal(); invalid.rpc.push({ method: 'evm_setAccountCode', params: [] });
  await assert.rejects(a.create(invalid, 'Unsupported'), { status: 400 });
  const status = await handleSharedApi(new Request('https://a.example/api/workspaces/status'), {}); assert.equal((await status.json()).ready, false);
  assert.equal((await handleSharedApi(new Request('https://a.example/api/workspaces'), {})).status, 503);
  assert.equal(await handleSharedApi(new Request('https://a.example/api/other'), {}), null);
  f.sqlite.close();
});

test('session credentials are not placed in request URLs and leaving removes session access', async () => {
  const f = fixture(), saved = new Map(), urls = [];
  const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  const a = new SharedWorkspace({ storage, fetcher: (url, init) => { urls.push(url); return f.fetcher(url, init); } });
  const created = await a.create(journal(), 'Session storage');
  const restored = new SharedWorkspace({ storage, fetcher: f.fetcher }); assert.equal(restored.connected, true); await restored.pull();
  assert.ok(urls.every(url => !url.includes(created.token) && !url.includes(created.inviteCode)));
  a.leave(); assert.equal(saved.size, 0); assert.equal(a.connected, false);
  f.sqlite.close();
});

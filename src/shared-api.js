// Capability-based access to a shared fictional journal, not production authentication.
export const MAX_RECORD_BYTES = 2 * 1024 * 1024;
export const LEASE_SECONDS = 90;
const encoder = new TextEncoder();
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
const secret = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), n => n.toString(16).padStart(2, '0')).join('');
class ApiError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const fail = (message, status) => { throw new ApiError(message, status); };
function recordText(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || !Number.isFinite(record.genesis) || !Array.isArray(record.rpc) || record.rpc.length > 10000 || !record.metadata || !record.evidence || !record.deployments) fail('Invalid workspace journal.');
  const allowed = ['eth_sendTransaction', 'eth_sendRawTransaction', 'evm_increaseTime', 'evm_mine'];
  if (record.rpc.some(item => !item || !allowed.includes(item.method) || !Array.isArray(item.params))) fail('Unsupported journal operation.');
  const text = JSON.stringify(record);
  if (encoder.encode(text).length > MAX_RECORD_BYTES) fail('Workspace exceeds the 2 MB shared storage limit. Use smaller sample attachments.', 413);
  return text;
}
const snapshot = row => ({ id: row.id, name: row.name, revision: row.revision, record: JSON.parse(row.record), leaseExpires: row.lease_expires, updatedAt: row.updated_at });
async function bodyOf(request) {
  if (Number(request.headers.get('Content-Length') || 0) > MAX_RECORD_BYTES + 4096) fail('Request too large.', 413);
  const text = await request.text();
  if (encoder.encode(text).length > MAX_RECORD_BYTES + 4096) fail('Request too large.', 413);
  try { const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Invalid request.'); return value; } catch { fail('Invalid JSON request.'); }
}
export async function handleSharedApi(request, env, dependencies = {}) {
  const path = new URL(request.url).pathname;
  if (path !== '/api/workspaces' && !path.startsWith('/api/workspaces/')) return null;
  if (path === '/api/workspaces/status' && request.method === 'GET') return response({ ready: !!env.SANDBOX_DB, maxRecordBytes: MAX_RECORD_BYTES, leaseSeconds: LEASE_SECONDS, mode: 'shared-fictional-sandbox' });
  if (!env.SANDBOX_DB) return response({ error: 'Shared workspaces are not configured. Your personal browser workspace is still available.' }, 503);
  const db = env.SANDBOX_DB, now = Math.floor((dependencies.now?.() ?? Date.now()) / 1000);
  try {
    const parts = path.slice('/api/workspaces'.length).split('/').filter(Boolean);
    if (!parts.length && request.method === 'POST') {
      const body = await bodyOf(request), name = String(body.name || '').trim(), record = recordText(body.record);
      if (name.length < 2 || name.length > 80) fail('Use a workspace name between 2 and 80 characters.');
      const count = await db.prepare('SELECT COUNT(*) AS count FROM sandbox_workspaces WHERE created_at > ?').bind(now - 86400).first();
      if (count.count >= 1000) fail('Workspace creation is temporarily limited. Please try again later.', 429);
      const id = crypto.randomUUID(), token = secret(), inviteCode = secret(), tokenHash = await hash(token);
      await db.batch([
        db.prepare('INSERT INTO sandbox_workspaces (id,name,record,owner_hash,invite_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(id, name, record, tokenHash, await hash(inviteCode), now, now),
        db.prepare('INSERT INTO sandbox_members (workspace_id,token_hash,created_at) VALUES (?,?,?)').bind(id, tokenHash, now),
      ]);
      const row = await db.prepare('SELECT * FROM sandbox_workspaces WHERE id = ?').bind(id).first();
      return response({ ...snapshot(row), token, inviteCode, owner: true }, 201);
    }
    const [id, operation] = parts;
    if (!/^[0-9a-f-]{36}$/.test(id || '') || parts.length > 2) fail('Unknown workspace route.', 404);
    let row = await db.prepare('SELECT * FROM sandbox_workspaces WHERE id = ?').bind(id).first();
    if (!row) fail('Workspace not found.', 404);
    if (operation === 'join' && request.method === 'POST') {
      const body = await bodyOf(request);
      const attempt = await db.prepare('UPDATE sandbox_workspaces SET join_attempts = CASE WHEN join_window <= ? THEN 1 ELSE join_attempts + 1 END, join_window = CASE WHEN join_window <= ? THEN ? ELSE join_window END WHERE id = ? AND (join_window <= ? OR join_attempts < 60)').bind(now - 3600, now - 3600, now, id, now - 3600).run();
      if (!attempt.meta.changes) fail('Too many join attempts. Please try again later.', 429);
      if (!/^[a-f0-9]{64}$/.test(body.inviteCode || '') || await hash(body.inviteCode) !== row.invite_hash) fail('Invalid workspace invitation.', 403);
      const token = secret();
      await db.prepare('INSERT INTO sandbox_members (workspace_id,token_hash,created_at) VALUES (?,?,?)').bind(id, await hash(token), now).run();
      // Fetch again: another member may have committed while the invitation was checked.
      row = await db.prepare('SELECT * FROM sandbox_workspaces WHERE id = ?').bind(id).first();
      return response({ ...snapshot(row), token, owner: false });
    }
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
    if (!/^[a-f0-9]{64}$/.test(token)) fail('Workspace access code required. Join the workspace again.', 401);
    const memberHash = await hash(token);
    if (!await db.prepare('SELECT token_hash FROM sandbox_members WHERE workspace_id = ? AND token_hash = ?').bind(id, memberHash).first()) fail('Workspace access code is invalid.', 401);
    if (!operation && request.method === 'GET') return response({ ...snapshot(row), owner: memberHash === row.owner_hash });
    const body = await bodyOf(request);
    if (operation === 'invite' && request.method === 'POST') {
      if (memberHash !== row.owner_hash) fail('Only the workspace creator can replace its invitation.', 403);
      const inviteCode = secret();
      await db.prepare('UPDATE sandbox_workspaces SET invite_hash = ? WHERE id = ? AND owner_hash = ?').bind(await hash(inviteCode), id, memberHash).run();
      return response({ inviteCode });
    }
    if (operation === 'lease' && request.method === 'POST') {
      if (!Number.isSafeInteger(body.revision) || body.revision < 0) fail('Invalid workspace revision.');
      const leaseToken = secret(), expiresAt = now + LEASE_SECONDS;
      const result = await db.prepare('UPDATE sandbox_workspaces SET lease_hash = ?, lease_member = ?, lease_expires = ? WHERE id = ? AND revision = ? AND lease_expires <= ?').bind(await hash(leaseToken), memberHash, expiresAt, id, body.revision, now).run();
      if (!result.meta.changes) fail('Workspace changed or another participant is making a change. Refresh and try again.', 409);
      return response({ leaseToken, revision: body.revision, expiresAt });
    }
    if (!/^[a-f0-9]{64}$/.test(body.leaseToken || '')) fail('Workspace editing lease required.', 409);
    const leaseHash = await hash(body.leaseToken);
    if (operation === 'renew' && request.method === 'POST') {
      const expiresAt = now + LEASE_SECONDS;
      const result = await db.prepare('UPDATE sandbox_workspaces SET lease_expires = ? WHERE id = ? AND lease_hash = ? AND lease_member = ? AND lease_expires > ?').bind(expiresAt, id, leaseHash, memberHash, now).run();
      if (!result.meta.changes) fail('Editing lease expired. Reload the shared workspace.', 409);
      return response({ expiresAt });
    }
    if (operation === 'lease' && request.method === 'DELETE') {
      await db.prepare('UPDATE sandbox_workspaces SET lease_hash = NULL, lease_member = NULL, lease_expires = 0 WHERE id = ? AND lease_hash = ? AND lease_member = ?').bind(id, leaseHash, memberHash).run();
      return response({ released: true });
    }
    if (!operation && request.method === 'PUT') {
      if (!Number.isSafeInteger(body.revision) || body.revision < 0) fail('Invalid workspace revision.');
      const record = recordText(body.record);
      const result = await db.prepare('UPDATE sandbox_workspaces SET record = ?, revision = revision + 1, updated_at = ?, lease_hash = NULL, lease_member = NULL, lease_expires = 0 WHERE id = ? AND revision = ? AND lease_hash = ? AND lease_member = ? AND lease_expires > ?').bind(record, now, id, body.revision, leaseHash, memberHash, now).run();
      if (!result.meta.changes) fail('Editing lease expired or the workspace changed. Reload before continuing.', 409);
      row = await db.prepare('SELECT * FROM sandbox_workspaces WHERE id = ?').bind(id).first();
      return response({ ...snapshot(row), owner: memberHash === row.owner_hash });
    }
    fail('Unknown workspace route.', 404);
  } catch (error) {
    if (error instanceof ApiError) return response({ error: error.message }, error.status);
    return response({ error: 'Shared workspace service is unavailable. Please retry; your browser workspace has not been removed.' }, 503);
  }
}

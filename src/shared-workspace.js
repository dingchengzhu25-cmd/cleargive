// Workspace codes are capabilities: keep them out of URLs and logs.
const SESSION_KEY = 'cleargive-shared-session-v1';
export class SharedWorkspace {
  constructor({ fetcher = globalThis.fetch?.bind(globalThis), storage = globalThis.sessionStorage, baseUrl = '/api/workspaces' } = {}) {
    this.fetcher = fetcher; this.storage = storage; this.baseUrl = baseUrl;
    this.id = null; this.token = null; this.owner = false; this.revision = null; this.name = ''; this.lease = null; this.snapshot = null;
    try {
      const saved = JSON.parse(storage?.getItem(SESSION_KEY) || 'null');
      if (/^[a-f0-9-]{36}$/.test(saved?.id) && /^[a-f0-9]{64}$/.test(saved?.token)) { this.id = saved.id; this.token = saved.token; this.owner = !!saved.owner; }
    } catch { /* A new session can always join again. */ }
  }
  get connected() { return !!(this.id && this.token); }
  async request(path = '', { method = 'GET', body, anonymous = false } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (!anonymous && this.token) headers.Authorization = `Bearer ${this.token}`;
    let result;
    try { result = await this.fetcher(`${this.baseUrl}${path}`, { method, headers, credentials: 'same-origin', cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch { throw new Error('Cannot reach the shared workspace. Check your connection before making another change.'); }
    let data;
    try { data = await result.json(); } catch { throw new Error('Shared workspace service returned an invalid response.'); }
    if (!result.ok) { const error = new Error(data.error || 'Shared workspace request failed.'); error.status = result.status; throw error; }
    return data;
  }
  accept(data, credentials = false) {
    if (credentials) {
      this.id = data.id; this.token = data.token; this.owner = !!data.owner;
      this.storage?.setItem(SESSION_KEY, JSON.stringify({ id: this.id, token: this.token, owner: this.owner }));
    }
    if (data.revision !== undefined) {
      this.revision = data.revision; this.name = data.name; this.snapshot = data;
      if (data.owner !== undefined) this.owner = data.owner;
    }
    return data;
  }
  status() { return this.request('/status', { anonymous: true }); }
  async create(record, name) { const data = await this.request('', { method: 'POST', body: { record, name }, anonymous: true }); this.lease = null; return this.accept(data, true); }
  async join(id, inviteCode) {
    if (!/^[a-f0-9-]{36}$/.test(id || '')) throw new Error('Enter the workspace ID supplied by its creator.');
    const data = await this.request(`/${id}/join`, { method: 'POST', body: { inviteCode: String(inviteCode || '').trim() }, anonymous: true });
    this.lease = null; return this.accept(data, true);
  }
  assertConnected() { if (!this.connected) throw new Error('Join a shared workspace first.'); }
  async pull() { this.assertConnected(); return this.accept(await this.request(`/${this.id}`)); }
  async acquire(revision = this.revision) {
    this.assertConnected();
    if (this.lease) throw new Error('Finish the current shared change before starting another.');
    this.lease = await this.request(`/${this.id}/lease`, { method: 'POST', body: { revision } }); return this.lease;
  }
  async renew() {
    this.assertConnected(); if (!this.lease) throw new Error('No editing lease is active.');
    const lease = this.lease;
    const data = await this.request(`/${this.id}/renew`, { method: 'POST', body: { leaseToken: lease.leaseToken } });
    if (this.lease === lease) this.lease.expiresAt = data.expiresAt; return data;
  }
  async commit(record) {
    this.assertConnected(); if (!this.lease) throw new Error('Acquire an editing lease before saving.');
    const data = await this.request(`/${this.id}`, { method: 'PUT', body: { record, revision: this.lease.revision, leaseToken: this.lease.leaseToken } });
    this.lease = null; return this.accept(data);
  }
  async release() {
    if (!this.connected || !this.lease) return;
    const leaseToken = this.lease.leaseToken;
    try { return await this.request(`/${this.id}/lease`, { method: 'DELETE', body: { leaseToken } }); } finally { this.lease = null; }
  }
  async rotateInvite() { this.assertConnected(); return this.request(`/${this.id}/invite`, { method: 'POST', body: {} }); }
  leave() {
    // Caller should await release() first if an editing action was active.
    this.storage?.removeItem(SESSION_KEY); this.id = null; this.token = null; this.owner = false; this.revision = null; this.name = ''; this.snapshot = null; this.lease = null;
  }
}

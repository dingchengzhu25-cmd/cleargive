import { SharedWorkspace } from './shared-workspace.js';
const BACKUP = 'cleargive-local-before-shared';

/** Shared fictional classroom journal. All participants may operate all roles. */
export class SharedUI {
  constructor(context) {
    this.ctx = context; this.client = new SharedWorkspace(); this.syncing = false; this.mutating = false;
    this.ready = null; this.loadedRevision = null; this.invite = null; this.renewTimer = null; this.pollTimer = null; this.leaseFailure = null; this.needsReconcile = false;
  }
  get connected() { return this.client.connected; }
  backup() { if (localStorage.getItem(BACKUP) === null) localStorage.setItem(BACKUP, JSON.stringify({ record: localStorage.getItem(this.ctx.KEY) })); }
  async prepare() {
    // Optional classroom availability must not block a personal workspace.
    this.statusPromise=this.client.status().then(data=>{this.ready=data.ready;},()=>{this.ready=false;}).then(()=>{if(this.pollTimer&&!this.syncing&&!this.ctx.isBusy())this.ctx.render();});
    if (this.connected) {
      this.backup(); const data = await this.client.pull();
      localStorage.setItem(this.ctx.KEY, JSON.stringify(data.record)); this.loadedRevision = data.revision;
    }
  }
  async restore(data) {
    if (this.ctx.chain.ganache?.disconnect) await this.ctx.chain.ganache.disconnect();
    localStorage.setItem(this.ctx.KEY, JSON.stringify(data.record));
    await this.ctx.chain.init(); this.loadedRevision = data.revision; this.needsReconcile = false;
    this.ctx.setActor(Math.max(0, Math.min(this.ctx.getActor(), this.ctx.identities.length - 1)));
  }
  async task(fn) {
    if (this.syncing || this.mutating || this.ctx.isBusy()) { this.ctx.toast('Finish the current change first.', true); return; }
    this.syncing = true;
    try { await fn(); } catch (error) { this.ctx.toast(error.message || 'Unable to update the shared workspace.', true); }
    finally { this.syncing = false; this.ctx.render(); }
  }
  page() {
    const { heading, esc, button } = this.ctx, active = this.connected, disabled = this.ready !== true ? 'disabled' : '';
    return `${heading('Give together, wherever you are.','Share a project workspace with your group and follow the same accounts, balances and payment records.')}
      <div class="notice"><strong>Shared classroom workspace</strong><br>Only use fictional account details and sample documents. Demo controls are publicly available to people with access to this fictional workspace. Participant view keeps balance and clock controls out of the main flow. This is a shared sandbox journal, not secure account sign-in or a public Ethereum deployment.</div>
      ${this.ready === false ? '<section class="panel"><h2>Shared workspaces are unavailable.</h2><p>Cloud storage is not connected or cannot currently be reached. Your personal browser workspace remains available.</p></section>' : this.ready === null ? '<p>Checking shared workspace availability…</p>' : ''}
      ${active ? `<section class="panel"><span class="eyebrow">Connected workspace</span><h2>${esc(this.client.name || 'Group workspace')}</h2><p>Workspace ID: <span class="hash">${esc(this.client.id)}</span></p><p>Saved revision ${this.loadedRevision ?? '…'} · changes synchronize while no form is open.</p><div class="buttons">${button('Refresh workspace','shared-refresh','','refresh')}${this.client.owner ? button('Create a new invitation','shared-invite','primary') : ''}${button('Return to my browser workspace','shared-leave','')}</div><p class="section-copy">Your original browser workspace is kept separately. Leaving this group restores it.</p></section>` : `<div class="form-grid"><section class="panel"><h2>Start a group workspace</h2><p>Copy your current browser workspace into a shared group. Campaign history and account balances are preserved.</p><form id="shared-create-form"><div class="field"><label for="shared-name">Group name</label><input id="shared-name" name="name" minlength="2" maxlength="80" placeholder="e.g. Community project team" required ${disabled}></div><button class="btn primary" ${disabled}>Create shared workspace</button></form></section><section class="panel"><h2>Join your group</h2><p>Ask the workspace creator for its ID and invitation code. Keep the code private within your group.</p><form id="shared-join-form"><div class="field"><label for="shared-id">Workspace ID</label><input id="shared-id" name="workspace" autocomplete="off" required ${disabled}></div><div class="field"><label for="shared-code">Invitation code</label><input id="shared-code" name="invite" type="password" autocomplete="off" required ${disabled}></div><button class="btn primary" ${disabled}>Join workspace</button></form></section></div>`}
      ${this.invite ? `<section class="panel"><h2>Your group invitation</h2><p>Copy these details for your group now. The invitation code disappears when you leave this page or reload. Anyone with the code can access and change this fictional workspace.</p><div class="field"><label>Workspace ID</label><input readonly value="${esc(this.client.id)}" aria-label="Workspace ID"></div><div class="field"><label>Invitation code</label><input readonly value="${esc(this.invite)}" aria-label="Invitation code" autocomplete="off"></div><p>A replacement invitation stops new joins using the old code. People who already joined keep access.</p></section>` : ''}
      <section class="panel"><h2>One group, one money trail.</h2><p>When one participant donates, the shared donor balance falls and campaign escrow rises by the same amount. Other devices receive the committed workspace automatically. Only one participant can save a change at a time; if someone else is editing, refresh before trying again.</p><p class="section-copy">Connection details stay in this browser tab’s session storage. Invitation and access codes are never included in shared URLs. Evidence attachments are part of the shared journal; the workspace has a 2 MB limit.</p></section>`;
  }
  async submit(form) {
    if (!['shared-create-form', 'shared-join-form'].includes(form.id)) return false;
    await this.task(async () => {
      if (this.ready !== true) throw new Error('Shared workspaces are unavailable. Try refreshing the page.');
      if (this.connected) throw new Error('Leave the current shared workspace before joining another.');
      const data = form.id === 'shared-create-form'
        ? await this.client.create(this.ctx.chain.record, form.elements.name.value.trim())
        : await this.client.join(form.elements.workspace.value.trim(), form.elements.invite.value.trim());
      this.backup(); this.invite = data.inviteCode || null;
      await this.restore(data); this.ctx.toast(form.id === 'shared-create-form' ? 'Shared workspace created. Save your invitation details.' : 'Joined your group workspace.');
    });
    return true;
  }
  async action(action, args = []) {
    if (action === 'nav' && args[0] !== 'workspaces') this.invite = null;
    if (action === 'confirm-reset' && this.connected) { this.ctx.toast('Leave the shared workspace before resetting your personal browser workspace.', true); return true; }
    if (!['shared-refresh', 'shared-invite', 'shared-leave'].includes(action)) return false;
    await this.task(async () => {
      if (action === 'shared-refresh') { await this.restore(await this.client.pull()); this.ctx.toast('Your group workspace is up to date.'); }
      else if (action === 'shared-invite') { this.invite = (await this.client.rotateInvite()).inviteCode; this.ctx.toast('New invitation created. Copy it for your group.'); }
      else {
        await this.client.release();
        const backup = JSON.parse(localStorage.getItem(BACKUP) || '{"record":null}');
        if (this.ctx.chain.ganache?.disconnect) await this.ctx.chain.ganache.disconnect();
        this.client.leave(); this.invite = null; this.loadedRevision = null;
        if (backup.record === null) localStorage.removeItem(this.ctx.KEY); else localStorage.setItem(this.ctx.KEY, backup.record);
        localStorage.removeItem(BACKUP); await this.ctx.chain.init();
        this.ctx.setActor(Math.max(0, Math.min(this.ctx.getActor(), this.ctx.identities.length - 1)));
        this.ctx.toast('Your personal browser workspace has been restored.');
      }
    });
    return true;
  }
  async beforeMutation() {
    if (this.syncing) throw new Error('The group workspace is refreshing. Try again in a moment.');
    if (!this.connected) return;
    if (this.mutating) throw new Error('Finish the current shared change first.');
    this.mutating = true; this.leaseFailure = null;
    try {
      if (this.needsReconcile) await this.restore(await this.client.pull());
      await this.client.acquire(this.loadedRevision);
      this.renewTimer = setInterval(() => {
        if (!this.renewing) {
          this.renewing = true;
          this.client.renew().catch(error => { this.leaseFailure = error; }).finally(() => { this.renewing = false; });
        }
      }, 30000);
    } catch (error) { this.mutating = false; throw error; }
  }
  stopRenewal() { if (this.renewTimer) clearInterval(this.renewTimer); this.renewTimer = null; }
  async afterMutation() {
    if (!this.connected) return;
    this.stopRenewal();
    if (this.leaseFailure) throw this.leaseFailure;
    const data = await this.client.commit(this.ctx.chain.record); this.loadedRevision = data.revision; this.mutating = false;
  }
  async failedMutation() {
    this.stopRenewal();
    if (!this.connected) { this.mutating = false; return; }
    this.syncing = true;
    try {
      try { await this.client.release(); } catch { /* An expired lease needs no cleanup. */ }
      await this.restore(await this.client.pull());
      this.ctx.toast('The change was not saved. Reloaded the authoritative group workspace; any incomplete local work was discarded.', true);
    } catch {
      this.needsReconcile = true;
      this.ctx.toast('Cannot reload the group workspace. Reconnect and refresh before continuing; local changes have not been confirmed.', true);
      // Reconcile before any subsequent mutation, even when the revision has not changed.
    } finally { this.mutating = false; this.syncing = false; }
  }
  startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(async () => {
      if (!this.connected || this.syncing || this.mutating || this.ctx.isBusy() || this.ctx.modalOpen()) return;
      this.syncing = true;
      try { const data = await this.client.pull(); if (data.revision !== this.loadedRevision) { await this.restore(data); this.ctx.render(); } }
      catch { /* Manual refresh reports errors; background reconnect stays quiet. */ }
      finally { this.syncing = false; }
    }, 7000);
  }
  stopPolling() { if (this.pollTimer) clearInterval(this.pollTimer); this.pollTimer = null; this.stopRenewal(); }
}

import {checkpointDatabase,validCheckpoint} from './chain-checkpoint.js';
import {campaignPresentation} from './campaign-content.js';
import { BrowserProvider, Contract, ContractFactory, parseUnits, formatUnits, keccak256, toUtf8Bytes, ZeroHash } from 'ethers';
import {currentFeeRecords,feeAllocation,donationQuote} from './fees.js';
import artifacts from '../artifacts/contracts.json' with { type: 'json' };

export const KEY = 'cleargive-chain-v1';
export const identities = [
  { name: 'Alex Morgan', role: 'Donor', initials: 'AM' },
  { name: 'Mei Tan', role: 'Donor', initials: 'MT' },
  { name: 'Asha Lim', role: 'Organiser', initials: 'AL' },
  { name: 'Priya Shah', role: 'Reviewer 1', initials: 'PS' },
  { name: 'Daniel Wong', role: 'Reviewer 2', initials: 'DW' },
  { name: 'Bright Books', role: 'Supplier', initials: 'BB' },
  { name: 'Community Pantry', role: 'Supplier', initials: 'CP' },
  { name: 'Green Roots', role: 'Supplier', initials: 'GR' },
];
export const units = amount => parseUnits(String(amount), 6);
export const dollars = amount => Number(formatUnits(amount, 6));
export const fingerprint = value => keccak256(toUtf8Bytes(JSON.stringify(value)));
export const short = value => `${value.slice(0, 6)}…${value.slice(-4)}`;
export const statuses = ['Funding', 'Active', 'Completed', 'Refunds'];

export class Chain {
  constructor(onProgress) { this.onProgress = onProgress; this.accounts = []; this.signers = []; this.campaigns = []; this.audit = []; this.record = null; }
  save() { localStorage.setItem(KEY, JSON.stringify(this.record)); }
  async init({skipSeed=false,checkpoint=null,database}={}) {
    const stored = localStorage.getItem(KEY);
    const prepared=!stored&&validCheckpoint(checkpoint,artifacts)?checkpoint:null;
    if(prepared){this.onProgress('Opening prepared campaign records…');database=await checkpointDatabase(prepared.entries);}
    this.record = stored ? JSON.parse(stored) : prepared ? structuredClone(prepared.record) : { genesis: Date.now(), rpc: [], metadata: {}, evidence: {}, deployments: {} };
    this.ganache = window.Ganache.provider({
      logging: { quiet: true },
      ...(database?{database:{db:database}}:{}),
      wallet: { deterministic: true, totalAccounts: 64, defaultBalance: 1000 },
      chain: { chainId: 1337, hardfork: 'shanghai', time: new Date(this.record.genesis) },
      miner: { timestampIncrement: 1 },
    });
    if (stored) {
      for (let i = 0; i < this.record.rpc.length; i++) {
        if(i%10===0||i===this.record.rpc.length-1){this.onProgress(`Restoring your workspace · ${i + 1}/${this.record.rpc.length}`);await new Promise(resolve=>setTimeout(resolve,0));}
        const item = this.record.rpc[i];
        await this.ganache.request(item);
      }
    }
    const recorded = { request: async request => {
      const result = await this.ganache.request(request);
      if (['eth_sendTransaction', 'eth_sendRawTransaction', 'evm_increaseTime', 'evm_mine'].includes(request.method)) {
        this.record.rpc.push(JSON.parse(JSON.stringify(request))); this.save();
      }
      return result;
    } };
    this.provider = new BrowserProvider(recorded, undefined, { cacheTimeout: -1, batchStallTime: 0 });
    this.provider.pollingInterval = 100;
    this.accountPool = await this.ganache.request({ method: 'eth_accounts', params: [] });
    identities.splice(8);
    identities.push(...(this.record.profiles || []));
    this.accounts = this.accountPool.slice(0, identities.length);
    this.signers = await Promise.all(this.accounts.map(a => this.provider.getSigner(a)));
    identities.forEach((id, i) => { id.address = this.accounts[i]; });
    if (!this.record.deployments.token) {
      this.onProgress('Deploying ClearGive contracts…');
      const token = await new ContractFactory(artifacts.DemoUSD.abi, artifacts.DemoUSD.bytecode, this.signers[2]).deploy();
      await token.waitForDeployment();
      this.record.deployments.token = await token.getAddress(); this.save();
    }
    this.token = new Contract(this.record.deployments.token, artifacts.DemoUSD.abi, this.provider);
    if (!this.record.deployments.factory) {
      const factory = await new ContractFactory(artifacts.ClearGiveFeeFactory.abi, artifacts.ClearGiveFeeFactory.bytecode, this.signers[2]).deploy(this.record.deployments.token);
      await factory.waitForDeployment();
      this.record.deployments.factory = await factory.getAddress(); this.save();
    }
    this.factory = new Contract(this.record.deployments.factory, artifacts.ClearGiveFeeFactory.abi, this.provider);
    // Deployed bytecode is immutable. Preserve earlier factories and vaults for historical proofs.
    try { await this.factory.rewardVersion(); } catch {
      this.record.deployments.legacyFactories ||= [];
      if(!this.record.deployments.legacyFactories.includes(this.record.deployments.factory))this.record.deployments.legacyFactories.push(this.record.deployments.factory);
      try{const vault=await this.factory.feeVault();this.record.deployments.historicFeeVaults ||= [];if(!this.record.deployments.historicFeeVaults.includes(vault))this.record.deployments.historicFeeVaults.push(vault);}catch{}
      const factory=await new ContractFactory(artifacts.ClearGiveFeeFactory.abi,artifacts.ClearGiveFeeFactory.bytecode,this.signers[2]).deploy(this.record.deployments.token);
      await factory.waitForDeployment();this.record.deployments.factory=await factory.getAddress();this.record.feeExamplesReady=false;this.record.feeExamples={};this.save();
      this.factory=new Contract(this.record.deployments.factory,artifacts.ClearGiveFeeFactory.abi,this.provider);
    }
    this.record.deployments.feeVault=await this.factory.feeVault();this.save();
    this.feeVault=new Contract(this.record.deployments.feeVault,artifacts.ClearGiveFeeVault.abi,this.provider);
    await this.ensureCommunityReviewers();
    if (!skipSeed&&!this.record.seeded) await this.seed();
    else if(!skipSeed&&this.record.deployments.legacyFactories?.length&&!this.record.feeExamplesReady)await this.feeExamples();
    await this.refresh();
  }
  quoteDonation(address,amount){return donationQuote(amount,!!this.campaigns.find(c=>c.address.toLowerCase()===address.toLowerCase())?.feeEnabled);}
  contract(address, actor) { return new Contract(address, artifacts.ClearGiveFeeCampaign.abi, actor === undefined ? this.provider : this.signers[actor]); }
  async send(tx) { const result = await tx; return await result.wait(); }
  async now() { return Number((await this.ganache.request({ method: 'eth_getBlockByNumber', params: ['latest', false] })).timestamp); }
  async mint(actor, amount = 10000) { return this.send(this.token.connect(this.signers[actor]).mint(this.accounts[actor], units(amount))); }
  async createAccount(name, kind, initialBalance = 0) {
    name = String(name).trim();
    if (name.length < 2 || name.length > 60) throw new Error('Use an account name between 2 and 60 characters.');
    if (!['personal', 'business'].includes(kind)) throw new Error('Choose personal or organisation.');
    if (identities.length >= 60) throw new Error('This sandbox supports up to 60 accounts.');
    const amount = Number(initialBalance);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1000000 || Math.abs(amount * 100 - Math.round(amount * 100)) > .00001) throw new Error('Choose a balance from 0 to 1,000,000 SGD, with at most two decimal places.');
    const index = identities.length, address = this.accountPool[index];
    const profile = { name, kind, role: kind === 'business' ? 'Organisation' : 'Donor', initials: name.split(/\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase(), address };
    this.record.profiles ||= []; this.record.profiles.push(profile); this.save();
    identities.push(profile); this.accounts.push(address); this.signers.push(await this.provider.getSigner(address));
    if (amount) await this.mint(index, amount);
    await this.refresh(); return index;
  }
  async setBalance(actor, desired) {
    const amount = Number(desired);
    if (!this.accounts[actor] || !Number.isFinite(amount) || amount < 0 || amount > 1000000 || Math.abs(amount * 100 - Math.round(amount * 100)) > .00001) throw new Error('Choose a valid wallet balance from 0 to 1,000,000 SGD with at most two decimals.');
    const current = await this.token.balanceOf(this.accounts[actor]), next = units(desired);
    if (next > current) return this.mint(actor, dollars(next - current));
    if (next < current) return this.send(this.token.connect(this.signers[actor]).transfer('0x000000000000000000000000000000000000dEaD', current - next));
  }
  async create(input, actor = 2) {
    const now = await this.now();
    const funding = now + input.fundingDays * 86400;
    const delivery = funding + input.deliveryDays * 86400;
    const terms = { ...input, feePolicy:'1% added to donation, rounded to cents; fee retained on campaign refund; 60% operations / 40% donation-only reviewer credits, equal split once both assigned reviewers participate; one reward per campaign', organiser: this.accounts[actor], reviewers: input.reviewers || [this.accounts[3], this.accounts[4]], fundingDeadline: funding, deliveryDeadline: delivery };
    const tx = await this.factory.connect(this.signers[actor]).createCampaign(
      terms.reviewers, input.title, funding, delivery, fingerprint(terms),
      input.milestones.map(m => m.title), input.milestones.map(m => m.supplier), input.milestones.map(m => units(m.amount)),
    );
    const receipt = await tx.wait();
    const event = receipt.logs.map(l => { try { return this.factory.interface.parseLog(l); } catch { return null; } }).find(e => e?.name === 'CampaignCreated');
    const address = event.args.campaign;
    this.record.metadata[address.toLowerCase()] = { ...terms, termsHash: fingerprint(terms), createdAt: now, image: input.image || 'school' };
    this.save(); return address;
  }
  async donate(address, actor, amount) {
    const c=this.contract(address,actor);let fee=0n;try{await c.rewardVersion();fee=await c.feeFor(units(amount));}catch{throw new Error('This historical zero-fee campaign is closed to new donations. Choose a current 1% campaign.');}
    await this.send(this.token.connect(this.signers[actor]).approve(address, units(amount)+fee));
    return this.send(this.contract(address, actor).donate(units(amount)));
  }
  async submit(address, milestone, data, actor = 2) {
    const salt = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(v => v.toString(16).padStart(2, '0')).join('');
    const envelope = { ...data, salt };
    const hash = fingerprint(envelope);
    this.record.evidence[hash] = envelope; this.save();
    return this.send(this.contract(address, actor).submitEvidence(milestone, hash));
  }
  async review(address, id, actor, approve, reason = '') {
    const c = this.contract(address, actor); const m = await c.getMilestone(id);
    const rejection = {note:reason,salt:Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,'0')).join('')};
    if (!approve) { this.record.evidence[fingerprint(rejection)] = rejection; this.save(); }
    return this.send(c.review(id, m.revision, m.evidenceHash, approve, approve ? ZeroHash : fingerprint(rejection)));
  }
  async donateCredits(address,actor,amount){return this.send(this.contract(address,actor).donateCredits(units(amount)));}
  async release(address, id, actor = 0) { return this.send(this.contract(address, actor).release(id)); }
  async advanceToRefund(address) {
    const c = this.contract(address); const deadline = Number(await c.deliveryDeadline());
    await this.provider.send('evm_increaseTime', [Math.max(0, deadline + 1 - await this.now())]);
    await this.provider.send('evm_mine', []);
    return this.send(this.contract(address, 0).openRefunds());
  }
  async claim(address, actor) { return this.send(this.contract(address, actor).claimRefund()); }
  async seed() {
    this.onProgress('Preparing wallets and community projects…');
    for (const actor of [0, 1]) if (await this.token.balanceOf(this.accounts[actor]) === 0n) await this.mint(actor, 50000);
    // Resume safely after an interrupted first launch; each seed transaction is mined before its flag is saved.
    const seed = this.record.seed || (this.record.seed = {});
    if (!seed.school) { seed.school = await this.create({ title: 'A brighter start for 100 students', category: 'Education', location: 'Tampines, Singapore', description: 'Help 100 students start the school year with books, backpacks and classroom essentials. Every payment goes directly to an approved supplier.', fundingDays: 14, deliveryDays: 30, image: 'school', milestones: [{title:'Books & learning materials',supplier:this.accounts[5],amount:1000},{title:'Backpacks & stationery',supplier:this.accounts[5],amount:2500},{title:'Classroom essentials',supplier:this.accounts[5],amount:1500}] }); this.save(); }
    const school = this.contract(seed.school);
    if (await school.contributions(this.accounts[0]) === 0n) await this.donate(seed.school, 0, 3250);
    if (await school.contributions(this.accounts[1]) === 0n) await this.donate(seed.school, 1, 1750);
    if ((await school.getMilestone(0)).revision === 0n) await this.submit(seed.school, 0, {name:'Bright Books quotation.pdf',note:'Quotation BB-2026-014: 100 book sets × 10 CGUSD. Supplier and order independently checked.',type:'Sample quotation',sample:true});
    if (!seed.pantry) { seed.pantry = await this.create({title:'Good food, stronger neighbourhoods',category:'Food security',location:'Bedok, Singapore',reviewers:this.record.communityReviewers.length===2?this.record.communityReviewers.map(i=>this.accounts[i]):[this.accounts[3],this.accounts[4]],description:'Stock a community pantry with nutritious essentials for 80 families. Donations fund two supplier orders with independently reviewed quotations.',fundingDays:21,deliveryDays:30,image:'pantry',milestones:[{title:'Dry goods & pantry staples',supplier:this.accounts[6],amount:5000},{title:'Fresh produce boxes',supplier:this.accounts[6],amount:3000}]}); this.save(); }
    if (await this.contract(seed.pantry).raised() === 0n) await this.donate(seed.pantry, 0, 2400);
    if (!seed.garden) { seed.garden = await this.create({title:'Grow a greener shared space',category:'Environment',location:'Punggol, Singapore',description:'A resident-led garden with raised beds, seedlings and shared tools. This completed sample shows the full approval and payment trail.',fundingDays:7,deliveryDays:14,image:'garden',milestones:[{title:'Garden beds, seeds & tools',supplier:this.accounts[7],amount:1200}]}); this.save(); }
    const garden = this.contract(seed.garden);
    if (await garden.raised() === 0n) await this.donate(seed.garden, 1, 1200);
    if ((await garden.getMilestone(0)).revision === 0n) await this.submit(seed.garden, 0, {name:'Green Roots quotation.pdf',note:'Sample quotation and delivery confirmation for raised beds, seedlings and tools.',sample:true});
    for (const actor of [3,4]) { const m = await garden.getMilestone(0); if (!m.paid && (Number(m.approvals) & (actor === 3 ? 1 : 2)) === 0) await this.review(seed.garden,0,actor,true); }
    if (!(await garden.getMilestone(0)).paid) await this.release(seed.garden,0);
    this.record.seeded = true; this.save();
  }
  async ensureCommunityReviewers(){
    this.record.communityReviewers ||= [];
    for(const name of ['Amir Rahman','Grace Ng']){
      const saved=this.record.communityReviewers.find(i=>identities[i]?.name===name);
      if(saved!==undefined)continue;
      if(identities.length>=60)break;
      const i=await this.createAccount(name,'personal',0);
      Object.assign(identities[i],{reviewer:true,role:'Reviewer'});Object.assign(this.record.profiles[i-8],{reviewer:true,role:'Reviewer'});
      this.record.communityReviewers.push(i);this.save();
    }
  }
  async feeExamples(){
    const examples=[['Learning essentials for our community','school','Education',this.accounts[5]],['Good food for our neighbours','pantry','Food security',this.accounts[6]],['A greener community space','garden','Environment',this.accounts[7]]];
    this.record.feeExamples ||= {};
    for(const [title,image,category,supplier] of examples){if(this.record.feeExamples[image])continue;
      this.record.feeExamples[image]=await this.create({title,description:'A community project with a fixed supplier order, two reviewer approvals and a separately recorded 1% platform fee.',image,category,location:'Singapore',fundingDays:21,deliveryDays:30,reviewers:image==='pantry'&&this.record.communityReviewers.length===2?this.record.communityReviewers.map(i=>this.accounts[i]):[this.accounts[3],this.accounts[4]],milestones:[{title:'Community supplies',supplier,amount:100}]});this.save();
    }
    this.record.feeExamplesReady=true;this.save();
  }
  async refresh() {
    this.campaigns = [];
    for(const factoryAddress of [this.record.deployments.factory,...(this.record.deployments.legacyFactories||[])]){
    const factory=new Contract(factoryAddress,artifacts.ClearGiveFeeFactory.abi,this.provider);
    const count=Number(await factory.campaignCount());
    const addresses=await Promise.all(Array.from({length:count},(_,i)=>factory.campaigns(i)));
    const campaigns=await Promise.all(addresses.map(async address=>{
      const c = this.contract(address);
      const [title,target,raised,released,status,funding,delivery,organiser,r1,r2,termsHash,n,refundPool,refundPaid] = await Promise.all([c.title(),c.getFunction('target')(),c.raised(),c.released(),c.status(),c.fundingDeadline(),c.deliveryDeadline(),c.organiser(),c.reviewer1(),c.reviewer2(),c.termsHash(),c.milestoneCount(),c.refundPool(),c.refundPaid()]);
      const milestones = [];
      for (let j = 0; j < Number(n); j++) {
        const m = await c.getMilestone(j);
        milestones.push({id:j,title:m.title,supplier:m.supplier,amount:dollars(m.amount),hash:m.evidenceHash,revision:Number(m.revision),approvals:Number(m.approvals),rejected:m.rejected,paid:m.paid});
      }
      const [contributions,refunds] = await Promise.all([Promise.all(this.accounts.map(a => c.contributions(a))),Promise.all(this.accounts.map(a => c.refunded(a)))]);
      let feeEnabled=false,feesCollected=0,rewardEnabled=false,rewardReviewMask=0,reviewerAwarded=false,reviewerBudget=0;try{rewardEnabled=Number(await c.rewardVersion())===1;rewardReviewMask=Number(await c.rewardReviewMask());const v=new Contract(await c.feeVault(),artifacts.ClearGiveFeeVault.abi,this.provider);reviewerAwarded=await v.campaignAwarded(address);reviewerBudget=dollars(await v.campaignReviewerReserve(address));}catch{}try{feeEnabled=Number(await c.feeBps())===100;feesCollected=dollars(await c.feesCollected());}catch{}
      return {...campaignPresentation(this.record.metadata[address.toLowerCase()],title),feeEnabled,legacy:!feeEnabled,archived:!rewardEnabled||factoryAddress.toLowerCase()!==this.record.deployments.factory.toLowerCase(),rewardEnabled,rewardReviewMask,reviewerAwarded,reviewerBudget,feesCollected,feeAllocation:feeAllocation(feesCollected),address,target:dollars(target),raised:dollars(raised),released:dollars(released),status:statuses[Number(status)],fundingDeadline:Number(funding),deliveryDeadline:Number(delivery),organiser,reviewers:[r1,r2],termsHash,milestones,contributions:contributions.map(dollars),refunded:refunds,refundPool:dollars(refundPool),refundPaid:dollars(refundPaid)};
    }));
    this.campaigns.push(...campaigns);
    }
    this.reviewerCredits=await Promise.all(this.accounts.map(async a=>dollars(await this.feeVault.creditBalance(a))));
    this.feeReserves={address:this.record.deployments.feeVault,total:dollars(await this.feeVault.totalFees()),operations:dollars(await this.feeVault.operationsReserve()),reviewerCredits:dollars(await this.feeVault.reviewerReserve()),balance:dollars(await this.token.balanceOf(this.record.deployments.feeVault)),unawarded:dollars(await this.feeVault.unawardedReviewerReserve()),awarded:dollars(await this.feeVault.totalCreditsAwarded()),outstanding:dollars(await this.feeVault.outstandingCredits()),spent:dollars(await this.feeVault.totalCreditsSpent()),restored:dollars(await this.feeVault.totalCreditsRestored())};
    await Promise.all(this.campaigns.flatMap(c=>c.rewardEnabled?c.milestones.map(async m=>{m.reviewParticipation=Number(await this.contract(c.address).reviewParticipation(m.id,m.revision));}):[]));
    const logs = await this.provider.getLogs({fromBlock:0,toBlock:'latest'});
    this.audit = [];
    const campaignInterfaces=new Map(this.campaigns.map(c=>[c.address.toLowerCase(),this.contract(c.address).interface]));
    for (const log of logs) {
      let event; let campaign = this.campaigns.find(c => c.address.toLowerCase() === log.address.toLowerCase());
      try { event = [this.record.deployments.feeVault,...(this.record.deployments.historicFeeVaults||[])].some(a=>a.toLowerCase()===log.address.toLowerCase())?this.feeVault.interface.parseLog(log):campaign ? campaignInterfaces.get(campaign.address.toLowerCase()).parseLog(log) : this.factory.interface.parseLog(log);if(['FeeAllocated','ReviewerCreditsAwarded','ReviewerCreditsSpent','ReviewerCreditsRestored'].includes(event?.name))campaign=this.campaigns.find(c=>c.address.toLowerCase()===event.args.campaign.toLowerCase()); } catch { continue; }
      if (!event) continue;
      const args = Object.fromEntries(event.fragment.inputs.map((input,i) => [input.name, typeof event.args[i] === 'bigint' ? event.args[i].toString() : event.args[i]]));
      this.audit.push({name:event.name,args,hash:log.transactionHash,block:log.blockNumber,index:log.index,campaign:campaign?.address || args.campaign,title:campaign?.title || args.title});
    }
    this.walletHistory = logs.filter(l => l.address.toLowerCase() === this.record.deployments.token.toLowerCase()).map(l => {
      try { const e = this.token.interface.parseLog(l); if(e?.name !== 'Transfer') return null; return {from:e.args.from,to:e.args.to,amount:dollars(e.args.value),hash:l.transactionHash,block:l.blockNumber}; } catch { return null; }
    }).filter(Boolean).reverse();
    this.audit.reverse();
    for (const c of this.campaigns) for (const m of c.milestones) {
      if (!m.rejected) continue;
      const rejection = this.audit.find(e => e.name === 'Reviewed' && e.args.approved === false && e.campaign?.toLowerCase() === c.address.toLowerCase() && Number(e.args.milestone) === m.id && Number(e.args.revision) === m.revision);
      m.rejectionNote = rejection ? this.record.evidence[rejection.args.reasonHash]?.note || '' : '';
    }
    const visible=currentFeeRecords(this.campaigns,this.audit,this.walletHistory);
    this.campaigns=visible.campaigns;this.audit=visible.audit;this.walletHistory=visible.walletTransfers;this.retiredCampaignRecords=visible.retired;
    this.balances = await Promise.all(this.accounts.map(async a => dollars(await this.token.balanceOf(a))));
    this.timestamp = await this.now();
  }
  async transaction(hash) {
    const [tx,receipt] = await Promise.all([this.provider.getTransaction(hash), this.provider.getTransactionReceipt(hash)]);
    const block = await this.provider.getBlock(receipt.blockNumber);
    return {hash,from:tx.from,to:tx.to,block:receipt.blockNumber,timestamp:block.timestamp,status:receipt.status,gasUsed:receipt.gasUsed.toString(),events:this.audit.filter(e => e.hash === hash)};
  }
  async exportReport() {
    return { platform:'ClearGive',network:'Browser-local Ganache Ethereum test chain (1337). Not a public blockchain.',exportedAt:new Date().toISOString(),contracts:this.record.deployments,feeReserves:this.feeReserves,feePolicy:{rate:'1% added',rounding:'nearest cent',refund:'platform fee retained',operationsShare:'60%',reviewerReserveShare:'40%',reviewerAwards:'40% split equally once both assigned reviewers participate; one award per campaign; donation-only credits',operationsPayouts:'not implemented; reserve held in vault'},campaigns:this.campaigns,audit:this.audit,walletTransfers:this.walletHistory,retiredCampaignRecords:this.retiredCampaignRecords,scenarioLibrary:this.record.scenarioLibrary||null,reviewerCredits:this.reviewerCredits,testWallets:identities.map((id,i) => ({...id,balance:this.balances[i]})) };
  }
}

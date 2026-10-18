import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { BrowserProvider, Contract, ContractFactory, parseUnits, id, ZeroHash } from 'ethers';
import { compile } from '../scripts/compile.mjs';
let artifacts;
before(() => { artifacts = compile(); });
const u = value => parseUnits(String(value), 6);

async function fixture(amounts = [400,600]) {
  const rpc=ganache.provider({logging:{quiet:true},wallet:{deterministic:true,totalAccounts:8},chain:{hardfork:'shanghai'},miner:{timestampIncrement:1}});
  const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
  const signers=await Promise.all(Array.from({length:8},(_,i)=>provider.getSigner(i)));
  const accounts=await Promise.all(signers.map(s=>s.getAddress()));
  const token=await new ContractFactory(artifacts.DemoUSD.abi,artifacts.DemoUSD.bytecode,signers[2]).deploy();await token.waitForDeployment();
  const factory=await new ContractFactory(artifacts.ClearGiveFeeFactory.abi,artifacts.ClearGiveFeeFactory.bytecode,signers[2]).deploy(await token.getAddress());await factory.waitForDeployment();
  const now=Number((await rpc.request({method:'eth_getBlockByNumber',params:['latest',false]})).timestamp);
  const funding=now+1000,delivery=now+2000;
  await (await factory.createCampaign([accounts[3],accounts[4]],'Test school',funding,delivery,id('fixed terms'),amounts.map((_,i)=>`Milestone ${i+1}`),amounts.map(()=>accounts[5]),amounts.map(u))).wait();
  const address=await factory.campaigns(0);const campaign=new Contract(address,artifacts.ClearGiveFeeCampaign.abi,provider);
  for(const i of [0,1,2,3,4,5])await (await token.mint(accounts[i],u(10000))).wait();
  const donate=async(i,n)=>{await(await token.connect(signers[i]).approve(address,u(n)+await campaign.feeFor(u(n)))).wait();await(await campaign.connect(signers[i]).donate(u(n))).wait();};
  const submit=async(i=0,hash=id('sample evidence'))=>{await(await campaign.connect(signers[2]).submitEvidence(i,hash)).wait();};
  const approve=async(actor,i=0)=>{const m=await campaign.getMilestone(i);await(await campaign.connect(signers[actor]).review(i,m.revision,m.evidenceHash,true,ZeroHash)).wait();};
  const advance=async deadline=>{const now=Number((await rpc.request({method:'eth_getBlockByNumber',params:['latest',false]})).timestamp);await rpc.request({method:'evm_increaseTime',params:[deadline-now+2]});await rpc.request({method:'evm_mine',params:[]});};
  return {rpc,provider,signers,accounts,token,factory,campaign,address,funding,delivery,donate,submit,approve,advance};
}
async function withFixture(t,fn,amounts){const f=await fixture(amounts);try{await fn(f);}finally{await f.rpc.disconnect();}}

test('current 1% supplier payment requires full funding and two distinct approvals; organiser receives nothing',async t=>withFixture(t,async f=>{
  await f.donate(0,600);assert.equal(await f.campaign.status(),0n);
  await assert.rejects(()=>f.submit());await f.donate(1,400);await f.submit();
  await assert.rejects(()=>f.campaign.connect(f.signers[0]).release(0));
  await f.approve(3);await assert.rejects(()=>f.campaign.connect(f.signers[0]).release(0));
  await f.approve(4);const supplierBefore=await f.token.balanceOf(f.accounts[5]),organiserBefore=await f.token.balanceOf(f.accounts[2]);
  const receipt=await(await f.campaign.connect(f.signers[0]).release(0)).wait();
  assert.equal(await f.token.balanceOf(f.accounts[5])-supplierBefore,u(400));
  assert.equal(await f.token.balanceOf(f.accounts[2]),organiserBefore);
  assert.equal(await f.token.balanceOf(f.address),u(600));
  assert.equal((await f.campaign.getMilestone(0)).paid,true);
  assert.ok(receipt.logs.some(l=>{try{return f.campaign.interface.parseLog(l)?.name==='SupplierPaid';}catch{return false;}}));
}));
test('donors and organiser cannot review; reviewers cannot submit organiser evidence',async t=>withFixture(t,async f=>{
  await f.donate(0,1000);await f.submit();const m=await f.campaign.getMilestone(0);
  for(const actor of [0,2,5])await assert.rejects(()=>f.campaign.connect(f.signers[actor]).review(0,m.revision,m.evidenceHash,true,ZeroHash));
  await assert.rejects(()=>f.campaign.connect(f.signers[3]).submitEvidence(1,id('x')));
}));
test('duplicate approvals and duplicate milestone payments revert',async t=>withFixture(t,async f=>{
  await f.donate(0,1000);await f.submit();await f.approve(3);await assert.rejects(()=>f.approve(3));await f.approve(4);
  await(await f.campaign.connect(f.signers[0]).release(0)).wait();
  await assert.rejects(()=>f.campaign.connect(f.signers[0]).release(0));
  assert.equal(await f.campaign.released(),u(400));
}));
test('rejection resets both approvals and stale evidence signatures cannot approve revised evidence',async t=>withFixture(t,async f=>{
  await f.donate(0,1000);await f.submit();await f.approve(3);
  const old=await f.campaign.getMilestone(0);
  await assert.rejects(()=>f.submit(0,id('replacement without rejection')));
  await(await f.campaign.connect(f.signers[4]).review(0,old.revision,old.evidenceHash,false,id('missing receipt'))).wait();
  assert.equal((await f.campaign.getMilestone(0)).approvals,0n);
  await assert.rejects(()=>f.approve(3));await f.submit(0,id('revised evidence'));
  await assert.rejects(()=>f.campaign.connect(f.signers[3]).review(0,old.revision,old.evidenceHash,true,ZeroHash));
  const revised=await f.campaign.getMilestone(0);assert.equal(revised.revision,2n);assert.equal(revised.approvals,0n);
  await f.approve(3);await f.approve(4);await(await f.campaign.connect(f.signers[0]).release(0)).wait();
}));
test('zero donations, overfunding and donations after target are rejected',async t=>withFixture(t,async f=>{
  await assert.rejects(()=>f.donate(0,0));await assert.rejects(()=>f.donate(0,1001));
  await f.donate(0,1000);await assert.rejects(()=>f.donate(1,1));assert.equal(await f.campaign.raised(),u(1000));
}));
test('failed fundraising refunds contributions in full and cannot open refunds early',async t=>withFixture(t,async f=>{
  await f.donate(0,100);await f.donate(1,200);
  await assert.rejects(()=>f.campaign.connect(f.signers[0]).openRefunds());await f.advance(f.funding);
  await assert.rejects(()=>f.donate(0,1));assert.equal(await f.campaign.status(),3n);
  const before=await f.token.balanceOf(f.accounts[0]);await(await f.campaign.connect(f.signers[0]).claimRefund()).wait();
  assert.equal(await f.token.balanceOf(f.accounts[0])-before,u(100));
  await(await f.campaign.connect(f.signers[1]).claimRefund()).wait();assert.equal(await f.token.balanceOf(f.address),0n);
}));
test('partial spending refunds only the remainder, proportionally; no double claims or later releases',async t=>withFixture(t,async f=>{
  await f.donate(0,600);await f.donate(1,400);await f.submit();await f.approve(3);await f.approve(4);await(await f.campaign.connect(f.signers[0]).release(0)).wait();
  await f.submit(1);await f.approve(3,1);await f.approve(4,1);
  await assert.rejects(()=>f.campaign.connect(f.signers[0]).openRefunds());
  await f.advance(f.delivery);await(await f.campaign.connect(f.signers[2]).openRefunds()).wait();
  const before0=await f.token.balanceOf(f.accounts[0]),before1=await f.token.balanceOf(f.accounts[1]);
  await(await f.campaign.connect(f.signers[0]).claimRefund()).wait();await assert.rejects(()=>f.campaign.connect(f.signers[0]).claimRefund());
  await assert.rejects(()=>f.campaign.connect(f.signers[2]).claimRefund());await assert.rejects(()=>f.campaign.connect(f.signers[0]).release(1));
  await(await f.campaign.connect(f.signers[1]).claimRefund()).wait();
  assert.equal(await f.token.balanceOf(f.accounts[0])-before0,u(360));assert.equal(await f.token.balanceOf(f.accounts[1])-before1,u(240));assert.equal(await f.token.balanceOf(f.address),0n);
}));
test('refund rounding settles the full pool with the last claimant',async t=>withFixture(t,async f=>{
  await f.donate(0,.000002);await f.donate(1,.000001);await f.submit();await f.approve(3);await f.approve(4);await(await f.campaign.connect(f.signers[0]).release(0)).wait();
  await f.advance(f.delivery);await(await f.campaign.connect(f.signers[0]).claimRefund()).wait();await(await f.campaign.connect(f.signers[1]).claimRefund()).wait();
  assert.equal(await f.campaign.refundPool(),2n);assert.equal(await f.campaign.refundPaid(),2n);assert.equal(await f.token.balanceOf(f.address),0n);
},[.000001,.000002]));
test('completed campaigns close donations and refunds permanently',async t=>withFixture(t,async f=>{
  await f.donate(0,1000);for(const i of [0,1]){await f.submit(i);await f.approve(3,i);await f.approve(4,i);await(await f.campaign.connect(f.signers[0]).release(i)).wait();}
  await f.advance(f.delivery);assert.equal(await f.campaign.status(),2n);await assert.rejects(()=>f.campaign.connect(f.signers[0]).claimRefund());await assert.rejects(()=>f.donate(0,1));
}));
test('factory rejects conflicted reviewers, suppliers, invalid deadlines and empty budgets',async t=>withFixture(t,async f=>{
  const create=(reviewers,suppliers,amounts,deadline=f.funding)=>f.factory.createCampaign(reviewers,'Invalid campaign',deadline,f.delivery,id('terms'),amounts.map(()=> 'Purchase'),suppliers,amounts.map(u));
  await assert.rejects(()=>create([f.accounts[3],f.accounts[3]],[f.accounts[5]],[100]));
  await assert.rejects(()=>create([f.accounts[2],f.accounts[4]],[f.accounts[5]],[100]));
  await assert.rejects(()=>create([f.accounts[3],f.accounts[4]],[f.accounts[3]],[100]));
  await assert.rejects(()=>create([f.accounts[3],f.accounts[4]],[f.accounts[2]],[100]));
  await assert.rejects(()=>create([f.accounts[3],f.accounts[4]],[f.accounts[5]],[0]));
  await assert.rejects(()=>create([f.accounts[3],f.accounts[4]],[],[]));
  await assert.rejects(()=>create([f.accounts[3],f.accounts[4]],[f.accounts[5]],[100],1));
  assert.equal(await f.factory.campaignCount(),1n);
}));
test('separate campaigns cannot spend each other’s balances',async t=>withFixture(t,async f=>{
  await f.donate(0,600);
  await(await f.factory.createCampaign([f.accounts[3],f.accounts[4]],'Second campaign',f.funding,f.delivery,id('second terms'),['Order'],[f.accounts[6]],[u(100)])).wait();
  const secondAddr=await f.factory.campaigns(1),second=new Contract(secondAddr,artifacts.ClearGiveFeeCampaign.abi,f.signers[0]);
  await(await f.token.connect(f.signers[0]).approve(secondAddr,u(101))).wait();await(await second.donate(u(100))).wait();
  assert.equal(await f.token.balanceOf(f.address),u(600));assert.equal(await f.token.balanceOf(secondAddr),u(100));
  await assert.rejects(()=>second.release(0));assert.equal(await f.campaign.raised(),u(600));
}));
test('a transaction replay restores contract addresses, balances and evidence',async()=>{
  const options={logging:{quiet:true},wallet:{deterministic:true,totalAccounts:8},chain:{hardfork:'shanghai',time:new Date('2026-10-13T12:00:00Z')},miner:{timestampIncrement:1}};
  const rpc=ganache.provider(options),journal=[];
  const recorder={request:async r=>{const result=await rpc.request(r);if(['eth_sendTransaction','evm_increaseTime','evm_mine'].includes(r.method))journal.push(JSON.parse(JSON.stringify(r)));return result;}};
  const provider=new BrowserProvider(recorder,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
  const signer=await provider.getSigner(0);const token=await new ContractFactory(artifacts.DemoUSD.abi,artifacts.DemoUSD.bytecode,signer).deploy();await token.waitForDeployment();const address=await token.getAddress();await(await token.mint(await signer.getAddress(),u(123))).wait();
  const hashes=await Promise.all(journal.filter(r=>r.method==='eth_sendTransaction').map(async(r,i)=>{return (await provider.getBlock(i+1)).transactions[0];}));
  await rpc.disconnect();const restored=ganache.provider(options);
  const replayHashes=[];for(const r of journal)replayHashes.push(await restored.request(r));
  const restoredProvider=new BrowserProvider(restored,undefined,{cacheTimeout:-1});const restoredToken=new Contract(address,artifacts.DemoUSD.abi,restoredProvider);
  assert.equal(await restoredToken.balanceOf(await signer.getAddress()),u(123));assert.deepEqual(replayHashes,hashes);await restored.disconnect();
});

test('the production browser controller seeds, reads on-chain targets, and restores all campaign state',async()=>{
  const {Chain}=await import('../src/chain.js');
  const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
  globalThis.window={Ganache:ganache};
  const first=new Chain(()=>{});await first.init();
  assert.equal(first.campaigns.length,3);
  assert.equal(first.campaigns[0].target,5000);
  assert.equal(first.campaigns[0].status,'Active');
  assert.equal(first.campaigns[0].milestones[0].revision,1);
  assert.equal(first.campaigns[2].status,'Completed');
  assert.equal(first.campaigns[2].released,1200);
  assert.ok(first.audit.some(e=>e.name==='SupplierPaid'));
  const school=first.campaigns[0];await first.review(school.address,0,3,true);await first.review(school.address,0,4,true);await first.release(school.address,0);await first.refresh();
  assert.equal(first.campaigns[0].milestones[0].paid,true);
  assert.equal(first.campaigns[0].released,1000);
  await first.submit(school.address,1,{name:'Sample quotation',note:'Fictional quote for backpacks',sample:true});
  await first.review(school.address,1,3,false,'Please clarify the item quantities.');await first.refresh();
  assert.equal(first.campaigns[0].milestones[1].rejectionNote,'Please clarify the item quantities.');
  const state=JSON.stringify(first.campaigns),events=JSON.stringify(first.audit);
  await first.ganache.disconnect();
  const restored=new Chain(()=>{});await restored.init();
  assert.equal(JSON.stringify(restored.campaigns),state);assert.equal(JSON.stringify(restored.audit),events);
  await restored.ganache.disconnect();delete globalThis.window;delete globalThis.localStorage;
});

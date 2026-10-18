import {test} from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,Contract,parseUnits,id} from 'ethers';
import artifacts from '../artifacts/contracts.json' with {type:'json'};
import {Chain,KEY} from '../src/chain.js';
import {donationQuote} from '../src/fees.js';
const u=v=>parseUnits(String(v),6);
async function fixture(){
 const rpc=ganache.provider({logging:{quiet:true},wallet:{deterministic:true,totalAccounts:8},chain:{hardfork:'shanghai'},miner:{timestampIncrement:1}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 const signers=await Promise.all(Array.from({length:8},(_,i)=>provider.getSigner(i))),accounts=await Promise.all(signers.map(s=>s.getAddress()));
 const token=await new ContractFactory(artifacts.DemoUSD.abi,artifacts.DemoUSD.bytecode,signers[2]).deploy();await token.waitForDeployment();
 const factory=await new ContractFactory(artifacts.ClearGiveFeeFactory.abi,artifacts.ClearGiveFeeFactory.bytecode,signers[2]).deploy(await token.getAddress());await factory.waitForDeployment();
 const now=Number((await rpc.request({method:'eth_getBlockByNumber',params:['latest',false]})).timestamp),funding=now+1000;
 await(await factory.createCampaign([accounts[3],accounts[4]],'Fee campaign',funding,now+2000,id('fee terms'),['Supplies'],[accounts[5]],[u(200)])).wait();
 const address=await factory.campaigns(0),campaign=new Contract(address,artifacts.ClearGiveFeeCampaign.abi,signers[0]),vault=new Contract(await factory.feeVault(),artifacts.ClearGiveFeeVault.abi,signers[0]);
 return {rpc,provider,signers,accounts,token,factory,campaign,vault,address,funding};
}
test('a 1% fee is atomic, separately backed, correctly allocated and excluded from donation refunds',async()=>{
 const f=await fixture();try{
 await(await f.token.mint(f.accounts[0],u(200))).wait();await(await f.token.connect(f.signers[0]).approve(f.address,u(101))).wait();
 const receipt=await(await f.campaign.donate(u(100))).wait();assert.equal(await f.token.balanceOf(f.accounts[0]),u(99));assert.equal(await f.token.balanceOf(f.address),u(100));assert.equal(await f.token.balanceOf(await f.vault.getAddress()),u(1));
 assert.equal(await f.vault.totalFees(),u(1));assert.equal(await f.vault.operationsReserve(),u(.6));assert.equal(await f.vault.reviewerReserve(),u(.4));assert.equal(await f.campaign.feesCollected(),u(1));assert.equal(await f.campaign.contributions(f.accounts[0]),u(100));
 const event=receipt.logs.map(l=>{try{return f.campaign.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='FeeCharged');assert.equal(event.args.fee,u(1));assert.equal(event.args.total,u(101));
 await f.rpc.request({method:'evm_increaseTime',params:[1005]});await f.rpc.request({method:'evm_mine',params:[]});await(await f.campaign.claimRefund()).wait();assert.equal(await f.token.balanceOf(f.accounts[0]),u(199));assert.equal(await f.token.balanceOf(f.address),0n);assert.equal(await f.vault.totalFees(),u(1));assert.equal(await f.token.balanceOf(await f.vault.getAddress()),u(1));
 await assert.rejects(()=>f.vault.allocate(f.accounts[0],u(1)));await assert.rejects(()=>f.vault.register(f.accounts[0]));
 }finally{await f.rpc.disconnect();}
});
test('insufficient total balance or allowance rolls back the donation, fee and all counters',async()=>{
 const f=await fixture();try{
 await(await f.token.mint(f.accounts[0],u(100))).wait();await(await f.token.connect(f.signers[0]).approve(f.address,u(101))).wait();
 await assert.rejects(async()=>{await(await f.campaign.donate(u(100),{gasLimit:1000000})).wait();});
 assert.equal(await f.campaign.raised(),0n);assert.equal(await f.campaign.donorCount(),0n);assert.equal(await f.campaign.feesCollected(),0n);assert.equal(await f.vault.totalFees(),0n);assert.equal(await f.token.balanceOf(f.address),0n);assert.equal(await f.token.balanceOf(f.accounts[0]),u(100));
 await(await f.token.mint(f.accounts[0],u(1))).wait();await(await f.token.connect(f.signers[0]).approve(f.address,u(100))).wait();await assert.rejects(async()=>{await(await f.campaign.donate(u(100),{gasLimit:1000000})).wait();});assert.equal(await f.campaign.raised(),0n);assert.equal(await f.vault.totalFees(),0n);
 }finally{await f.rpc.disconnect();}
});
test('fee quotes match Solidity rounding and cannot be redirected by a donor',async()=>{
 const f=await fixture();try{for(const n of [.01,.49,.5,1,1.49,1.5,3.33,49.99,100,1000000])assert.equal(await f.campaign.feeFor(u(n)),u(donationQuote(n).fee));assert.equal(await f.campaign.feeBps(),100n);assert.equal(await f.campaign.feeVault(),await f.vault.getAddress());}finally{await f.rpc.disconnect();}
});
test('legacy journal migration preserves old donations and balances, then new 1% records survive reload',async()=>{
 const genesis=Date.now(),journal={genesis,rpc:[],metadata:{},evidence:{},deployments:{},seeded:true};
 const rpc=ganache.provider({logging:{quiet:true},wallet:{deterministic:true,totalAccounts:64,defaultBalance:1000},chain:{chainId:1337,hardfork:'shanghai',time:new Date(genesis)},miner:{timestampIncrement:1}});
 const recorded={request:async request=>{const result=await rpc.request(request);if(['eth_sendTransaction','eth_sendRawTransaction','evm_increaseTime','evm_mine'].includes(request.method))journal.rpc.push(JSON.parse(JSON.stringify(request)));return result;}};
 const provider=new BrowserProvider(recorded,undefined,{cacheTimeout:-1});provider.pollingInterval=10;const signers=await Promise.all(Array.from({length:8},(_,i)=>provider.getSigner(i))),accounts=await Promise.all(signers.map(s=>s.getAddress()));
 const token=await new ContractFactory(artifacts.DemoUSD.abi,artifacts.DemoUSD.bytecode,signers[2]).deploy();await token.waitForDeployment();journal.deployments.token=await token.getAddress();
 const factory=await new ContractFactory(artifacts.ClearGiveFactory.abi,artifacts.ClearGiveFactory.bytecode,signers[2]).deploy(journal.deployments.token);await factory.waitForDeployment();journal.deployments.factory=await factory.getAddress();const oldFactory=journal.deployments.factory;
 const now=Number((await rpc.request({method:'eth_getBlockByNumber',params:['latest',false]})).timestamp);await(await factory.createCampaign([accounts[3],accounts[4]],'Earlier campaign',now+1000,now+2000,id('old terms'),['Supplies'],[accounts[5]],[u(200)])).wait();const address=await factory.campaigns(0);journal.metadata[address.toLowerCase()]={title:'Earlier campaign'};
 await(await token.mint(accounts[0],u(500))).wait();await(await token.connect(signers[0]).approve(address,u(100))).wait();const oldReceipt=await(await new Contract(address,artifacts.ClearGiveCampaign.abi,signers[0]).donate(u(100))).wait();await rpc.disconnect();
 const store=new Map([[KEY,JSON.stringify(journal)]]);globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};globalThis.window={Ganache:ganache};let c=new Chain(()=>{});
 try{await c.init();assert.equal(c.balances[0],400);assert.deepEqual(c.record.deployments.legacyFactories,[oldFactory]);assert.equal(c.campaigns.some(x=>x.address===address),false);assert.equal(c.retiredCampaignRecords.campaigns.find(x=>x.address===address).raised,100);assert.ok(c.retiredCampaignRecords.audit.some(e=>e.name==='Donated'&&e.hash===oldReceipt.hash));assert.ok(!c.audit.some(e=>e.campaign===address));const report=await c.exportReport();assert.equal(report.retiredCampaignRecords.campaigns.length,1);await assert.rejects(()=>c.donate(address,0,1),/historical/);
 const current=c.campaigns.find(x=>x.feeEnabled);await c.donate(current.address,0,100);await c.refresh();assert.equal(c.balances[0],299);assert.equal(c.feeReserves.total,1);assert.ok(c.audit.some(e=>e.name==='FeeCharged'&&e.campaign===current.address));assert.ok(c.audit.some(e=>e.name==='FeeAllocated'&&e.campaign===current.address));
 await c.ganache.disconnect();c=new Chain(()=>{});await c.init();assert.equal(c.balances[0],299);assert.equal(c.feeReserves.total,1);assert.equal(c.campaigns.filter(x=>x.feeEnabled).length,3);assert.equal(c.retiredCampaignRecords.campaigns.find(x=>x.address===address).raised,100);
 }finally{await c.ganache.disconnect();delete globalThis.localStorage;delete globalThis.window;}
});

test('partial supplier payment refunds only the remaining principal and leaves the 60/40 fee reserves intact',async()=>{
 const f=await fixture();try{
 const now=Number((await f.rpc.request({method:'eth_getBlockByNumber',params:['latest',false]})).timestamp);
 await(await f.factory.createCampaign([f.accounts[3],f.accounts[4]],'Partial refund with fee',now+1000,now+2000,id('partial terms'),['First order','Second order'],[f.accounts[5],f.accounts[5]],[u(400),u(600)])).wait();
 const address=await f.factory.campaigns(1),c=new Contract(address,artifacts.ClearGiveFeeCampaign.abi,f.signers[2]);
 for(const [actor,principal] of [[0,600],[1,400]]){await(await f.token.mint(f.accounts[actor],u(principal*1.01))).wait();await(await f.token.connect(f.signers[actor]).approve(address,u(principal*1.01))).wait();await(await c.connect(f.signers[actor]).donate(u(principal))).wait();}
 await(await c.submitEvidence(0,id('invoice'))).wait();
 for(const actor of [3,4]){const m=await c.getMilestone(0);await(await c.connect(f.signers[actor]).review(0,m.revision,m.evidenceHash,true,id('review'))).wait();}
 await(await c.release(0)).wait();
 await f.rpc.request({method:'evm_increaseTime',params:[2005]});await f.rpc.request({method:'evm_mine',params:[]});
 for(const actor of [0,1])await(await c.connect(f.signers[actor]).claimRefund()).wait();
 assert.equal(await c.refundPool(),u(600));assert.equal(await c.refundPaid(),u(600));assert.equal(await c.released(),u(400));
 assert.equal(await f.token.balanceOf(f.accounts[0]),u(360));assert.equal(await f.token.balanceOf(f.accounts[1]),u(240));assert.equal(await f.token.balanceOf(f.accounts[5]),u(400));
 assert.equal(await f.vault.totalFees(),u(10));assert.equal(await f.vault.operationsReserve(),u(6));assert.equal(await f.vault.reviewerReserve(),u(4));assert.equal(await f.token.balanceOf(await f.vault.getAddress()),u(10));
 }finally{await f.rpc.disconnect();}
});

test('both reviews award equal donation-only credits once, including rejection; credit refunds cannot cash out',async()=>{
 const f=await fixture();try{
 const now=Number((await f.rpc.request({method:'eth_getBlockByNumber',params:['latest',false]})).timestamp);
 await(await f.factory.createCampaign([f.accounts[3],f.accounts[4]],'Reward source',now+1000,now+2000,id('source'),['Supplies'],[f.accounts[5]],[u(1000)])).wait();
 const address=await f.factory.campaigns(1),source=new Contract(address,artifacts.ClearGiveFeeCampaign.abi,f.signers[2]);
 await(await f.token.mint(f.accounts[0],u(1010))).wait();await(await f.token.connect(f.signers[0]).approve(address,u(1010))).wait();await(await source.connect(f.signers[0]).donate(u(1000))).wait();
 await(await source.submitEvidence(0,id('invoice'))).wait();let m=await source.getMilestone(0);
 await(await source.connect(f.signers[3]).review(0,m.revision,m.evidenceHash,false,id('changes required'))).wait();assert.equal(await f.vault.creditBalance(f.accounts[3]),0n);
 await(await source.connect(f.signers[4]).review(0,m.revision,m.evidenceHash,true,id('review'))).wait();
 assert.equal(await f.vault.creditBalance(f.accounts[3]),u(2));assert.equal(await f.vault.creditBalance(f.accounts[4]),u(2));assert.equal(await f.vault.totalCreditsAwarded(),u(4));
 await assert.rejects(()=>source.release(0));await assert.rejects(()=>source.connect(f.signers[4]).review(0,m.revision,m.evidenceHash,true,id('again')));
 await(await source.submitEvidence(0,id('revised invoice'))).wait();m=await source.getMilestone(0);
 for(const actor of [3,4])await(await source.connect(f.signers[actor]).review(0,m.revision,m.evidenceHash,true,id('review'))).wait();
 assert.equal(await f.vault.totalCreditsAwarded(),u(4),'new revisions must not farm rewards');
 await(await f.factory.createCampaign([f.accounts[0],f.accounts[1]],'Unrelated recipient',now+1000,now+2000,id('dest'),['Books'],[f.accounts[5]],[u(100)])).wait();
 const destAddress=await f.factory.campaigns(2),dest=new Contract(destAddress,artifacts.ClearGiveFeeCampaign.abi,f.signers[3]);
 await assert.rejects(()=>f.campaign.connect(f.signers[3]).donateCredits(u(1)),'assigned reviewers cannot donate credits to their own campaigns');
 await(await dest.donateCredits(u(1))).wait();assert.equal(await f.vault.creditBalance(f.accounts[3]),u(.99));assert.equal(await f.token.balanceOf(f.accounts[3]),0n);assert.equal(await f.token.balanceOf(destAddress),u(1));
 assert.equal(await f.vault.operationsReserve(),u(6.006));assert.equal(await f.vault.reviewerReserve(),u(4.004));assert.equal(await f.vault.unawardedReviewerReserve(),u(.004));
 await(await f.token.mint(f.accounts[3],u(.51))).wait();await(await f.token.connect(f.signers[3]).approve(destAddress,u(.51))).wait();await(await dest.donate(u(.5))).wait();
 await f.rpc.request({method:'evm_increaseTime',params:[1005]});await f.rpc.request({method:'evm_mine',params:[]});await(await dest.claimRefund()).wait();
 assert.equal(await f.vault.creditBalance(f.accounts[3]),u(1.99));assert.equal(await f.token.balanceOf(f.accounts[3]),u(.5));assert.equal(await f.token.balanceOf(destAddress),0n);
 assert.equal(await f.vault.accountedBalance(),await f.token.balanceOf(await f.vault.getAddress()));
 assert.equal(await f.vault.accountedBalance(),(await f.vault.operationsReserve())+(await f.vault.unawardedReviewerReserve())+(await f.vault.outstandingCredits()));
 await assert.rejects(()=>f.vault.awardReviewers());await assert.rejects(()=>f.vault.spend(f.accounts[3],u(1),0));await assert.rejects(()=>f.vault.restore(f.accounts[3],u(100)));
 }finally{await f.rpc.disconnect();}
});

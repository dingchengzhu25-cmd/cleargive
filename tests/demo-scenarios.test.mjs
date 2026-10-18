import {governanceStages} from '../src/governance.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {WorkflowChain} from '../src/workflows.js';
import {ensureDemoScenarios} from '../src/demo-scenarios.js';
import {donationPositions,donationPosition,proportionalShares} from '../src/donor-accounting.js';

test('personal accounting reconciles individual gifts across payments, pending refunds, settled rounding and fees',()=>{
 const event=(name,args,hash,block=1)=>({name,args,hash,block,campaign:'c'});
 const gifts=[event('Donated',{donor:'alex',amount:'400000000'},'a'),event('Donated',{donor:'alex',amount:'200000000'},'b',2),event('Donated',{donor:'mei',amount:'400000000'},'m',3)];
 const fees=gifts.map(e=>event('FeeCharged',{donor:e.args.donor,fee:String(BigInt(e.args.amount)/100n),total:String(BigInt(e.args.amount)*101n/100n)},e.hash));
 const c={address:'c',raised:1000,released:400,refundPaid:0,refundPool:0,status:'Active'};
 let own=donationPositions(c,[...gifts,...fees],'alex');assert.equal(own.principal,600);assert.equal(own.paid,240);assert.equal(own.held,360);assert.equal(own.total,606);assert.deepEqual(own.entries.map(e=>[e.principal,e.paid,e.held,e.fee]),[[400,160,240,4],[200,80,120,2]]);
 const audit=[...gifts,...fees,event('Refunded',{donor:'alex',amount:'360000000'},'r',4)];Object.assign(c,{status:'Refunds',refundPool:600,refundPaid:360});
 own=donationPositions(c,audit,'alex');assert.deepEqual([own.paid,own.held,own.refunded,own.fee,own.total],[240,0,360,6,606]);
 const mei=donationPositions(c,audit,'mei');assert.deepEqual([mei.paid,mei.held,mei.refundAvailable,mei.refunded,mei.total],[160,240,240,0,404]);
 for(const e of [...own.entries,...mei.entries])assert.equal(e.principal,e.paid+e.held+e.refunded);
 const rounding={address:'c',raised:.000003,released:.000001,refundPool:.000002,refundPaid:.000002,status:'Refunds'};
 const tiny=[event('Donated',{donor:'a',amount:'2'},'x'),event('Donated',{donor:'b',amount:'1'},'y'),event('Refunded',{donor:'a',amount:'1'},'r1'),event('Refunded',{donor:'b',amount:'1'},'r2')];
 assert.equal(donationPositions(rounding,tiny,'a').paid,.000001);assert.equal(donationPositions(rounding,tiny,'b').paid,0);
 assert.deepEqual(proportionalShares(2n,[1n,1n,1n]),[1n,1n,0n]);
});

test('twelve prepared scenarios use mined 1% transactions and retain exact personal accounting through reload and resume',async()=>{
 const store=new Map();globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};globalThis.window={Ganache:ganache};
 let chain=new WorkflowChain(()=>{});
 try{
 await chain.init({skipSeed:true});await ensureDemoScenarios(chain);
 const lib=chain.record.scenarioLibrary,find=key=>chain.campaigns.find(c=>c.scenarioKey===key);
 assert.equal(chain.campaigns.length,12);for(const actor of [2,5,6,7])assert.equal(chain.registrationApproved(chain.accounts[actor]),true);assert.ok(chain.campaigns.every(c=>c.rewardEnabled&&c.feeEnabled&&!c.archived));
 assert.equal(chain.audit.filter(e=>e.name==='Donated').length,29);assert.equal(Math.round(chain.campaigns.reduce((n,c)=>n+c.raised,0)*100),979200);assert.equal(chain.feeReserves.total,97.92);
 const stages=governanceStages(chain.campaigns);assert.deepEqual(stages,{funding:960,evidence:1000,review:1600,changes:1000,ready:1500,refundFunding:0,refundDeadline:240,paid:2500,refunded:992,deliveryPending:1300,deliveryConfirmed:1200});
 const states={collecting:'Funding',funded:'Active',revised:'Active',ready:'Active',rejected:'Active','partial-paid':'Active','delivery-pending':'Completed',delivered:'Completed','partial-refund':'Refunds','funding-refund':'Refunds','credit-refund':'Refunds','credit-onward':'Funding'};
 for(const [key,status] of Object.entries(states))assert.equal(find(key).status,status,key);
 assert.equal(find('revised').milestones[0].revision,2);assert.equal(find('revised').milestones[0].approvals,1);assert.equal(find('ready').milestones[0].approvals,3);assert.equal(find('rejected').milestones[0].rejected,true);
 assert.equal(find('delivered').deliveryStatus,'Delivery confirmed');assert.equal(find('delivery-pending').deliveryStatus,'Delivery pending');
 const a=donationPositions(find('partial-refund'),chain.audit,chain.accounts[0]),m=donationPositions(find('partial-refund'),chain.audit,chain.accounts[1]);
 assert.deepEqual([a.principal,a.paid,a.refunded,a.held,a.fee,a.total],[600,240,360,0,6,606]);assert.deepEqual([m.principal,m.paid,m.refunded,m.held,m.refundAvailable],[400,160,0,240,240]);
 const multi=donationPositions(find('partial-paid'),chain.audit,chain.accounts[0]);assert.equal(multi.entries.length,2);assert.deepEqual(multi.entries.map(e=>e.paid),[160,80]);
 for(const c of chain.campaigns){let held=0,paid=0,refunded=0;for(const donor of chain.accounts){const p=donationPositions(c,chain.audit,donor);held+=Math.round(p.held*1e6);paid+=Math.round(p.paid*1e6);refunded+=Math.round(p.refunded*1e6);for(const e of p.entries){assert.equal(Math.round(e.total*1e6),Math.round(e.held*1e6)+Math.round(e.paid*1e6)+Math.round(e.refunded*1e6)+Math.round(e.fee*1e6));assert.ok(chain.audit.some(x=>x.name==='FeeCharged'&&x.hash===e.hash));}}
 assert.equal(paid,Math.round(c.released*1e6));assert.equal(refunded,Math.round(c.refundPaid*1e6));assert.equal(held,Math.round((c.raised-c.released-c.refundPaid)*1e6));}
 assert.ok(chain.audit.some(e=>e.name==='ReviewerCreditsRestored'));assert.ok(chain.audit.some(e=>e.name==='ReviewerCreditsSpent'&&e.campaign===find('credit-onward').address));
 assert.equal(chain.feeReserves.balance,Math.round((chain.feeReserves.operations+chain.feeReserves.unawarded+chain.feeReserves.outstanding)*1e6)/1e6);
 const count=chain.record.rpc.length,addresses=structuredClone(lib.addresses);await ensureDemoScenarios(chain);assert.equal(chain.record.rpc.length,count);
 lib.complete=false;chain.save();await ensureDemoScenarios(chain);assert.equal(chain.record.rpc.length,count,'resuming must not duplicate donations or awards');assert.deepEqual(lib.addresses,addresses);
 await chain.ganache.disconnect();chain=new WorkflowChain(()=>{});await chain.init();await ensureDemoScenarios(chain);assert.equal(chain.record.rpc.length,count);assert.equal(chain.campaigns.length,12);
 }finally{await chain.ganache?.disconnect();delete globalThis.localStorage;delete globalThis.window;}
});

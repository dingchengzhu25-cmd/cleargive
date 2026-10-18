import test from 'node:test';
import assert from 'node:assert/strict';
import {donationPositions} from '../src/donor-accounting.js';
import {donationFlow} from '../src/donation-flow.js';
const u=n=>Math.round(n*1e6);
const gifts=[1000,1000,1000,.01].map((amount,i)=>({name:'Donated',campaign:'campaign',hash:'gift'+i,block:i+1,args:{donor:'donor'+i,amount:String(u(amount))}}));
const base={address:'campaign',raised:3000.01,target:3000.01,released:.01,refundPool:3000,refundPaid:0,status:'Refunds',reviewers:['r1','r2'],milestones:[{id:0,title:'First',amount:.01,supplier:'s',paid:true,approvals:3,revision:1,hash:'invoice'},{id:1,title:'Second',amount:3000,supplier:'s',paid:false,approvals:0,revision:0,hash:'0x'+'0'.repeat(64)}]};
const payment={name:'SupplierPaid',campaign:'campaign',hash:'payment',block:5,args:{milestone:0,amount:'10000'}};
function check(c,audit){
 const rows=[0,1,2,3].map(i=>donationPositions(c,audit,'donor'+i));
 for(const row of rows)for(const e of row.entries){assert.ok(e.paid>=0&&e.refunded>=0&&e.held>=0);assert.equal(u(e.principal),u(e.paid)+u(e.refunded)+u(e.held)+u(e.roundingAdjustment));assert.equal(e.reconciled,true);}
 for(const [field,total] of [['paid',c.released],['refunded',c.refundPaid],['held',c.raised-c.released-c.refundPaid]])assert.equal(rows.reduce((n,r)=>n+u(r[field]),0),u(total));
 assert.equal(rows.reduce((n,r)=>n+u(r.roundingAdjustment),0),0);
 return rows;
}
test('tiny donor renders before and after last-claim refund exceeds principal by two micro-units',()=>{
 let c={...base},audit=[...gifts,payment];check(c,audit);
 for(let i=0;i<3;i++){audit.push({name:'Refunded',campaign:'campaign',hash:'refund'+i,block:6+i,args:{donor:'donor'+i,amount:'999996666'}});c.refundPaid+=999.996666;}
 const pending=check(c,audit);assert.equal(u(pending[3].held),10002);assert.equal(u(pending[3].roundingAdjustment),-2);
 assert.doesNotThrow(()=>donationFlow([c],audit,'gift3'));
 audit.push({name:'Refunded',campaign:'campaign',hash:'last',block:9,args:{donor:'donor3',amount:'10002'}});c.refundPaid=3000;
 const settled=check(c,audit);assert.equal(u(settled[3].refunded),10002);assert.equal(settled[3].held,0);assert.equal(u(settled[3].roundingAdjustment),-2);
});
test('every claimant order preserves actual totals and signed rounding without negative allocations',()=>{
 const permutations=a=>a.length?a.flatMap((v,i)=>permutations(a.filter((_,j)=>j!==i)).map(t=>[v,...t])):[[]];
 for(const order of permutations([0,1,2,3])){
  const c={...base},audit=[...gifts,payment];let remaining=3000000000n;
  order.forEach((donor,index)=>{const principal=BigInt(gifts[donor].args.amount),amount=index===3?remaining:3000000000n*principal/3000010000n;remaining-=amount;c.refundPaid=Number(3000000000n-remaining)/1e6;audit.push({name:'Refunded',campaign:'campaign',hash:'r'+index,block:6+index,args:{donor:'donor'+donor,amount:String(amount)}});check(c,audit);});
 }
});

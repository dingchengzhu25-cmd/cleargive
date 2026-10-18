import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ZeroHash} from 'ethers';
import {donationFlow} from '../src/donation-flow.js';
const donated=(hash,donor,amount,campaign='campaign')=>({name:'Donated',hash,block:1,campaign,args:{donor,amount:String(amount*1e6)}});
const event=(name,args,hash='proof',campaign='campaign')=>({name,args,hash,block:2,campaign});
const milestone=(id,overrides={})=>({id,title:`Order ${id}`,supplier:`supplier-${id}`,amount:id===0?400:600,hash:ZeroHash,revision:0,approvals:0,paid:false,delivery:{status:'Not recorded',history:[]},...overrides});
const campaign=(overrides={})=>({address:'campaign',status:'Funding',raised:500,released:0,refundPaid:0,refundPool:0,target:1000,reviewers:['r1','r2'],milestones:[milestone(0),milestone(1)],...overrides});
test('selected donation is distinct from a donor’s other deposits and the campaign pool',()=>{
 const c=campaign(),audit=[donated('first','donor',25),donated('second','donor',75),donated('other','someone',400),donated('elsewhere','donor',900,'different')];
 const f=donationFlow([c],audit,'first');assert.equal(f.donationAmount,25);assert.equal(f.donorTotal,100);assert.equal(f.donorDepositCount,2);assert.equal(f.held,500);assert.equal(f.otherDonations,475);assert.equal(f.released,0);assert.equal(f.releaseReady,false);assert.equal(f.refundState,'Not open');assert.equal(f.reconciled,true);
 assert.equal(donationFlow([c],audit,'missing'),null);assert.equal(donationFlow([],audit,'first'),null);
});
test('conditions follow the selected milestone and approvals match its evidence revision',()=>{
 const c=campaign({status:'Active',raised:1000,milestones:[milestone(0,{hash:'evidence',revision:2,approvals:3}),milestone(1,{hash:'another',revision:1,approvals:1})]});
 const audit=[donated('gift','donor',1000),event('Reviewed',{milestone:'0',revision:'1',reviewer:'r1',approved:true},'old'),event('Reviewed',{milestone:'0',revision:'2',reviewer:'r1',approved:true},'r1-proof'),event('Reviewed',{milestone:'0',revision:'2',reviewer:'r2',approved:true},'r2-proof')];
 const ready=donationFlow([c],audit,'gift',0);assert.equal(ready.releaseReady,true);assert.equal(ready.chosen.reviewerProofs[0].event.hash,'r1-proof');assert.equal(ready.chosen.reviewerProofs[1].event.hash,'r2-proof');
 const waiting=donationFlow([c],audit,'gift',1);assert.equal(waiting.releaseReady,false);assert.equal(waiting.chosen.approvalCount,1);assert.equal(waiting.chosen.reviewerProofs[1].event,null);
 c.milestones[0].rejected=true;assert.equal(donationFlow([c],audit,'gift',0).releaseReady,false);
});
test('partial supplier payment remains separate from delivery and unspent escrow',()=>{
 const c=campaign({status:'Active',raised:1000,released:400,milestones:[milestone(0,{paid:true,hash:'invoice',revision:1,approvals:3}),milestone(1)]});
 const audit=[donated('gift','donor',1000),event('SupplierPaid',{milestone:'0',supplier:'supplier-0',amount:'400000000'},'payment')];
 const f=donationFlow([c],audit,'gift');assert.equal(f.held,600);assert.equal(f.released,400);assert.equal(f.milestones[0].paymentAmount,400);assert.equal(f.milestones[0].deliveryStatus,'Not recorded');assert.equal(f.chosen.id,1);assert.equal(f.reconciled,true);
 c.milestones[0].delivery.status='Delivery confirmed';assert.equal(donationFlow([c],audit,'gift').released,400);
});
test('refunds are the donor’s aggregate actual refund, never allocated to one gift',()=>{
 const c=campaign({status:'Refunds',raised:1000,released:400,refundPool:600,refundPaid:360,milestones:[milestone(0,{paid:true}),milestone(1)]});
 const audit=[donated('first','donor',100),donated('second','donor',500),donated('other','another',400),event('SupplierPaid',{milestone:'0',amount:'400000000'},'payment'),event('Refunded',{donor:'donor',amount:'360000000'},'refund'),event('Refunded',{donor:'donor',amount:'999000000'},'unrelated','different')];
 const f=donationFlow([c],audit,'first');assert.equal(f.donationAmount,100);assert.equal(f.donorTotal,600);assert.equal(f.donorRefund,360);assert.equal(f.donorDepositCount,2);assert.equal(f.refundState,'Returned');assert.equal(f.refundRemaining,240);assert.equal(f.held,240);assert.equal(f.releaseReady,false);assert.equal(f.donorRefunds[0].hash,'refund');assert.equal(f.reconciled,true);
 const other=donationFlow([c],audit,'other');assert.equal(other.refundState,'Claim available');assert.equal(other.donorRefund,0);
});
test('final refund uses the recorded micro-unit rounding and fully paid campaigns close refunds',()=>{
 const c=campaign({status:'Refunds',raised:1,released:0,refundPool:1,refundPaid:1,milestones:[milestone(0,{amount:1})]});
 const audit=[donated('gift','donor',.333334),donated('other','another',.666666),event('Refunded',{donor:'another',amount:'666666'},'a'),event('Refunded',{donor:'donor',amount:'333334'},'b')];
 const f=donationFlow([c],audit,'gift');assert.equal(f.donorRefund,.333334);assert.equal(f.held,0);assert.equal(f.refundRemaining,0);assert.equal(f.reconciled,true);
 const completed=campaign({status:'Completed',raised:1000,released:1000,milestones:[milestone(0,{paid:true,amount:1000,delivery:{status:'Awaiting acceptance'}})]});
 const done=donationFlow([completed],[donated('gift','donor',1000),event('SupplierPaid',{milestone:'0',amount:'1000000000'})],'gift');assert.equal(done.refundState,'Closed');assert.equal(done.progress.stage,4);assert.equal(done.released,1000);assert.equal(done.chosen.deliveryStatus,'Awaiting acceptance');
});
test('inconsistent outgoing events are flagged rather than presented as reconciled',()=>{
 const f=donationFlow([campaign({status:'Active',raised:1000,released:400})],[donated('gift','donor',1000)],'gift');assert.equal(f.reconciled,false);
});

test('fee proof follows the exact donation and stays outside principal and refunds',()=>{
 const c=campaign({raised:100});const audit=[donated('gift','donor',100),event('FeeCharged',{donor:'someone',fee:'99000000',total:'199000000'},'gift','different'),event('FeeCharged',{donor:'donor',fee:'1000000',total:'101000000'},'gift')];
 const f=donationFlow([c],audit,'gift');assert.equal(f.fee,1);assert.equal(f.totalCharged,101);assert.equal(f.held,100);assert.equal(f.reconciled,true);
 audit[2].args.total='102000000';assert.equal(donationFlow([c],audit,'gift').reconciled,false);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {ZeroHash} from 'ethers';
import {WorkflowChain} from '../src/workflows.js';
import {identities} from '../src/chain.js';
import {advanceJourney,runRefundJourney} from '../src/journey.js';
import {campaignProgress,accountRole,relatedCampaigns} from '../src/experience.js';

test('campaign timeline follows unfinished milestones, rejection, delivery and refunds honestly',()=>{
 const milestone={title:'Books',hash:ZeroHash,approvals:0,paid:false,delivery:{status:'Not recorded'}};
 const c={status:'Funding',milestones:[milestone],reviewers:['a','b']};
 assert.equal(campaignProgress(c).stage,0);c.status='Active';assert.equal(campaignProgress(c).stage,1);
 milestone.hash='invoice';assert.deepEqual(campaignProgress(c).waiting,['a','b']);
 milestone.approvals=1;assert.deepEqual(campaignProgress(c).waiting,['b']);
 milestone.approvals=3;assert.equal(campaignProgress(c).stage,3);
 milestone.rejected=true;assert.equal(campaignProgress(c).stage,1);milestone.rejected=false;
 milestone.paid=true;assert.equal(campaignProgress(c).stage,4);
 milestone.delivery.status='Delivery confirmed';assert.equal(campaignProgress(c).stage,5);
 c.milestones.push({...milestone,title:'Second order',paid:false,hash:ZeroHash,approvals:0});assert.equal(campaignProgress(c).stage,1);
 c.status='Refunds';assert.equal(campaignProgress(c).stage,-1);
});
test('role task selection shows only the selected participant’s assignments',()=>{
 assert.equal(accountRole({kind:'business'},9),'organisation');assert.equal(accountRole({reviewer:true},10),'reviewer');assert.equal(accountRole({},11),'donor');
 const campaigns=[{organiser:'ORG',reviewers:['R1','R2'],milestones:[{supplier:'SUP'}],contributions:[5,0]},{organiser:'OTHER',reviewers:['R3','R4'],milestones:[],contributions:[0,10]}];
 assert.equal(relatedCampaigns(campaigns,'r1','reviewer',0).length,1);assert.equal(relatedCampaigns(campaigns,'sup','organisation',0).length,1);assert.equal(relatedCampaigns(campaigns,'x','donor',1)[0],campaigns[1]);
});
test('guided journey persists fresh zero-balance accounts, exact receipt, approvals, delivery and a separate full refund',async()=>{
 const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};globalThis.window={Ganache:ganache};
 let chain=new WorkflowChain(()=>{});await chain.init();
 try{
  const genesisClock=await chain.now();let j=await advanceJourney(chain);await chain.refresh();
  for(const i of [j.donor,j.organiser,j.supplier])assert.equal(chain.balances[i],0);
  assert.equal(accountRole(identities[j.donor],j.donor),'donor');
  await advanceJourney(chain);assert.equal(chain.registrationApproved(chain.accounts[j.organiser]),true);assert.equal(chain.registrationApproved(chain.accounts[j.supplier]),true);
  j=await advanceJourney(chain);await chain.refresh();assert.equal(chain.campaigns.find(c=>c.address===j.address).target,100);
  await chain.setBalance(j.donor,200);await chain.contribute(j.address,j.donor,100);
  j=await advanceJourney(chain);await chain.refresh();assert.equal(chain.audit.filter(e=>e.name==='Donated'&&e.campaign===j.address).length,1,'resuming after a manual contribution must not donate twice');const r=chain.record.donationReceipts[j.receipt];
  assert.equal(r.balanceBefore,200);assert.equal(r.balanceAfter,99);assert.equal(r.amount,100);assert.equal(chain.balances[j.donor],99);
  assert.equal((await chain.transaction(r.hash)).block,r.block);
  await chain.ganache.disconnect();chain=new WorkflowChain(()=>{});await chain.init();j=chain.record.guidedJourney;assert.equal(j.step,4);assert.equal(chain.record.donationReceipts[j.receipt].balanceAfter,99);
  await advanceJourney(chain);await advanceJourney(chain);await chain.refresh();let c=chain.campaigns.find(c=>c.address===j.address);assert.equal(campaignProgress(c).stage,3);
  await advanceJourney(chain);await chain.refresh();c=chain.campaigns.find(c=>c.address===j.address);assert.equal(campaignProgress(c).stage,4);assert.equal(chain.balances[j.supplier],100);
  j=await advanceJourney(chain);await chain.refresh();c=chain.campaigns.find(c=>c.address===j.address);assert.equal(campaignProgress(c).stage,5);assert.equal(chain.balances[j.supplier],100);assert.ok((await chain.now())-genesisClock<86400,'main story must not advance scenario deadlines');
  j=await runRefundJourney(chain);await chain.refresh();const refund=chain.campaigns.find(c=>c.address===j.refundAddress);
  assert.equal(campaignProgress(refund).heading,'Refunds settled');assert.equal(refund.raised,50);assert.equal(refund.released,0);assert.equal(refund.refundPaid,50);assert.equal(refund.refunded[j.donor],true);assert.equal(chain.balances[j.donor],98.5);assert.equal(chain.balances[j.supplier],100);assert.equal(c.deliveryStatus,'Delivery confirmed');
  await assert.rejects(()=>runRefundJourney(chain),/already has/);
  const report=await chain.exportReport();assert.equal(report.donationReceipts[r.hash].amount,100);assert.equal(report.guidedJourney.step,8);
 }finally{await chain.ganache.disconnect();}
});

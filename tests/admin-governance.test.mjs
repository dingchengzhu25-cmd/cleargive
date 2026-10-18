import {ExperienceUI} from '../src/experience-ui.js';
import {donationQuote} from '../src/fees.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {PresenterMode,ADMIN_ACTIONS,ADMIN_FORMS} from '../src/admin.js';
import {feeScenario,governanceTotals,governanceStages} from '../src/governance.js';
test('public demo mode opens without credentials and returning to participant view hides presenter controls',()=>{
 const mode=new PresenterMode();assert.equal(mode.unlocked,false);assert.throws(()=>mode.require(),/No password/);mode.open();assert.doesNotThrow(()=>mode.require());mode.close();assert.equal(mode.unlocked,false);assert.throws(()=>mode.require());
 const directLink=new PresenterMode({enabled:true});assert.doesNotThrow(()=>directLink.require());assert.equal(new PresenterMode().unlocked,false);
});
test('balance, funding and clock actions remain separate from participant view',()=>{
 assert.ok(['balance','fund','account','scenario-open','run-tour','refund-tour-run','confirm-reset'].every(a=>ADMIN_ACTIONS.has(a)));assert.ok(ADMIN_FORMS.has('scenario-form')&&ADMIN_FORMS.has('balance-form'));
});
test('current 1% quote preserves a full donation and separately accounts for its fee',()=>{
 const q=feeScenario(100);assert.deepEqual(q,{donation:100,actualFee:1,actualTotal:101,operations:.6,credits:.4});
 for(const amount of [.01,.49,.5,1,3.33,49.99,1000000]){const q=feeScenario(amount);assert.equal(Math.round((q.operations+q.credits)*100),Math.round(q.actualFee*100));assert.equal(Math.round((q.donation+q.actualFee)*100),Math.round(q.actualTotal*100));assert.equal(q.actualFee,Math.round(amount)/100);}
 for(const amount of [0,-1,NaN,Infinity,'bad',.001,1000001])assert.throws(()=>feeScenario(amount));
});
test('live governance totals reconcile held, paid and refunded balances with zero fees',()=>{
 const t=governanceTotals([{raised:100,released:60,refundPaid:20},{raised:50,released:0,refundPaid:50}]);assert.deepEqual(t,{collected:150,held:20,paid:60,refunded:70,fees:0});assert.equal(t.collected,t.held+t.paid+t.refunded);assert.equal(governanceTotals([]).held,0);
});

test('checkout validates the total including fees and refuses new donations to historical contracts',()=>{
 const chain={balances:[100],quoteDonation:(_address,amount)=>donationQuote(amount)};const ui=new ExperienceUI({chain});const c={address:'current',status:'Funding',target:200,raised:0};assert.throws(()=>ui.validateDonation(c,0,100),/plus its 1% fee/);chain.balances[0]=101;assert.doesNotThrow(()=>ui.validateDonation(c,0,100));assert.throws(()=>ui.validateDonation({...c,legacy:true},0,100),/earlier zero-fee/);
});

test('recorded fee allocation follows the selected transaction, including small rounded fees and historical records',async()=>{
 const {recordedDonation}=await import('../src/fees.js');
 const donation={hash:'gift',campaign:'campaign',args:{donor:'donor',amount:'600000000'}};
 const event=(fee,total,campaign='campaign')=>({name:'FeeCharged',hash:'gift',campaign,args:{donor:'donor',fee,total}});
 let r=recordedDonation([event('999000000','1599000000','other'),event('6000000','606000000')],donation);
 assert.deepEqual([r.amount,r.fee,r.total,r.operations,r.credits,r.historical],[600,6,606,3.6,2.4,false]);
 r=recordedDonation([],donation);assert.deepEqual([r.fee,r.operations,r.credits,r.total,r.historical],[0,0,0,600,true]);
 r=recordedDonation([event('10000','510000')],{...donation,args:{donor:'donor',amount:'500000'}});assert.deepEqual([r.fee,r.operations,r.credits,r.total],[.01,.006,.004,.51]);
});

test('reviewer credit checkout validates credit funds and excludes the reviewer’s own campaign',()=>{
 const address='reviewer',chain={balances:[0],reviewerCredits:[2],quoteDonation:(_a,n)=>donationQuote(n)};
 const ui=new ExperienceUI({chain,identities:[{address}]});
 const c={address:'dest',rewardEnabled:true,status:'Funding',target:100,raised:0,reviewers:['a','b'],organiser:'org',milestones:[{supplier:'supplier'}]};
 assert.doesNotThrow(()=>ui.validateDonation(c,0,1,'credits'));
 assert.throws(()=>ui.validateDonation(c,0,2,'credits'),/balance/);
 assert.throws(()=>ui.validateDonation({...c,reviewers:[address,'b']},0,1,'credits'),/unrelated/);
 assert.throws(()=>ui.validateDonation({...c,archived:true},0,1,'credits'),/current/);
});

test('zero-fee campaigns and their transactions disappear across views while 1% campaigns with no collected fees remain',async()=>{
 const {currentFeeRecords}=await import('../src/fees.js');
 const campaigns=[{address:'OLD',feeEnabled:false},{address:'NEW',feeEnabled:true,feesCollected:0},{address:'EARLIER-FEE',feeEnabled:true,archived:true}];
 const audit=[{hash:'old-gift',campaign:'old'},{hash:'old-paid',campaign:'OLD'},{hash:'new-gift',campaign:'new'},{hash:'earlier-fee',campaign:'earlier-fee'}];
 const walletTransfers=[{hash:'old-gift',from:'donor',to:'old'},{hash:'old-paid',from:'old',to:'supplier'},{hash:'mint',from:'zero',to:'donor'},{hash:'new-gift',from:'donor',to:'new'}];
 const r=currentFeeRecords(campaigns,audit,walletTransfers);
 assert.deepEqual(r.campaigns.map(c=>c.address),['NEW']);assert.deepEqual(r.audit.map(e=>e.hash),['new-gift']);assert.deepEqual(r.walletTransfers.map(e=>e.hash),['mint','new-gift']);
 assert.equal(r.retired.campaigns.length,2);assert.equal(r.retired.audit.length,3);assert.equal(r.retired.walletTransfers.length,2);assert.equal(campaigns.length,3);
});

test('governance totals follow recorded amounts and visibly distinguish an empty selected campaign from all campaigns',async()=>{
 const {GovernanceUI}=await import('../src/governance.js');
 const chain={campaigns:[{address:'funded',title:'Funded cause',feeEnabled:true,raised:100,released:0,refundPaid:0,feesCollected:1,reviewers:['a','b']},{address:'empty',title:'Empty cause',feeEnabled:true,raised:0,released:0,refundPaid:0,feesCollected:0,reviewers:['a','b']}],feeReserves:{total:1,operations:.6,reviewerCredits:.4,unawarded:.4,awarded:0,outstanding:0,spent:0,restored:0,balance:1,address:'vault'}};
 const ui=new GovernanceUI({chain,money:n=>`SGD ${n}`,esc:String,who:String,heading:()=>'',button:()=>''});
 const totals=()=>ui.page().split('governance-live')[1].split('</section>')[0];
 assert.match(totals(),/Contributed<\/span><strong>SGD 100/);assert.match(totals(),/Platform fees collected<\/span><strong>SGD 1/);
 ui.campaign='empty';assert.match(totals(),/Showing: Empty cause/);assert.match(totals(),/Contributed<\/span><strong>SGD 0/);assert.match(ui.page(),/No donations recorded for this campaign yet/);
 chain.campaigns[1].raised=50;chain.campaigns[1].feesCollected=.5;
 assert.match(totals(),/Contributed<\/span><strong>SGD 50/);assert.doesNotMatch(ui.page(),/No donations recorded for this campaign yet/);
 ui.campaign=null;assert.match(totals(),/Contributed<\/span><strong>SGD 150/);assert.match(totals(),/Platform fees collected<\/span><strong>SGD 1.5/);
});


test('governance money stages move principal without conflating rejection, release, delivery or refunds',()=>{
 const c={raised:600,target:1000,released:0,refundPaid:0,status:'Funding',milestones:[{amount:400,revision:0,approvals:0},{amount:600,revision:0,approvals:0}]};
 assert.equal(governanceStages([c]).funding,600);
 Object.assign(c,{raised:1000,status:'Active'});assert.equal(governanceStages([c]).evidence,1000);
 Object.assign(c.milestones[0],{revision:1,approvals:1});let t=governanceStages([c]);assert.equal(t.review,400);assert.equal(t.evidence,600);
 Object.assign(c.milestones[0],{rejected:true,approvals:0});t=governanceStages([c]);assert.equal(t.changes,400);assert.equal(t.refundDeadline,0);assert.equal(t.refundFunding,0);
 Object.assign(c.milestones[0],{rejected:false,revision:2,approvals:3});assert.equal(governanceStages([c]).ready,400);
 Object.assign(c.milestones[0],{paid:true});c.released=400;t=governanceStages([c]);assert.equal(t.ready,0);assert.equal(t.paid,400);assert.equal(t.deliveryPending,400);
 c.milestones[0].delivery={status:'Delivery confirmed'};t=governanceStages([c]);assert.equal(t.deliveryPending,0);assert.equal(t.deliveryConfirmed,400);
 c.status='Refunds';t=governanceStages([c]);assert.equal(t.evidence,0);assert.equal(t.refundDeadline,600);
 c.refundPaid=360;t=governanceStages([c]);assert.equal(t.refundDeadline,240);assert.equal(t.refunded,360);
 assert.equal(t.funding+t.evidence+t.review+t.changes+t.ready+t.refundFunding+t.refundDeadline+t.paid+t.refunded,c.raised);
 const missed={raised:200,target:500,released:0,refundPaid:50,status:'Refunds',milestones:[]};t=governanceStages([missed]);assert.equal(t.refundFunding,150);assert.equal(t.refundDeadline,0);
 const decimal={raised:.3,target:.3,released:.1,refundPaid:.1,status:'Refunds',milestones:[]};assert.equal(governanceStages([decimal]).refundDeadline,.1);
});

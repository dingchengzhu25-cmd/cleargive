import {identities} from './chain.js';
export const JOURNEY_STEPS=['Create accounts','Review organisations','Create campaign','Donate','Submit invoice','Record approvals','Pay supplier','Confirm delivery'];
// Each stage is a separate committed workspace action. Resuming uses persisted progress.
export async function advanceJourney(chain){
 const previous=chain.record.guidedJourney;
 const j=previous&&previous.step<8&&(!previous.address||chain.campaigns.find(c=>c.address===previous.address)?.rewardEnabled)?structuredClone(previous):{step:0,logs:[],run:(previous?.run||0)+1};
 const note=t=>j.logs.push(t);
 const checkpoint=()=>{chain.record.guidedJourney=j;chain.save();};
 if(j.step===0){
  if(j.donor===undefined&&identities.length>57)throw new Error('This walkthrough needs space for three new accounts. Export your work and use a fresh workspace.');
  if(j.donor===undefined){j.donor=await chain.createAccount(`Sam Lee ${j.run}`,'personal',0);checkpoint();}
  if(j.organiser===undefined){j.organiser=await chain.createAccount(`Neighbourhood Learning ${j.run}`,'business',0);checkpoint();}
  if(j.supplier===undefined){j.supplier=await chain.createAccount(`Learning Supplies ${j.run}`,'business',0);checkpoint();}
  j.actor=j.donor;note('Created a new donor, organiser and supplier, each with an automatic wallet and SGD 0.');
 }else if(j.step===1){
  for(const index of [j.organiser,j.supplier]){
   if(chain.registrationApproved(chain.accounts[index]))continue;
   if(chain.verification(chain.accounts[index]).status!=='Pending review')await chain.requestVerification(index,{registration:`CG-${j.run}-${index}`,purpose:'Fictional community learning project and supplier registration, checked against this sample project plan.',document:'Sample organisation details.txt',conflicts:'No ownership or family relationship with the sample reviewers declared.'});
   await chain.reviewVerification(index,3,true,'Checked the fictional registration, purpose, supplier details and conflict declaration.',true);
  }
  j.actor=j.organiser;note('Priya signed registration reviews for the organiser and supplier. These are human statements, not external accreditation.');
 }else if(j.step===2){
  j.address=await chain.create({title:`Reading kits for our community · ${j.run}`,description:'Ten reading kits for a fictional community reading corner. Fixed supplier payment and separately confirmed delivery.',category:'Education',location:'Singapore',image:'school',fundingDays:14,deliveryDays:30,reviewers:[chain.accounts[3],chain.accounts[4]],requireVerification:true,conflictsConfirmed:true,costs:[{category:'Administration',amount:5,payer:'Project sponsor'},{category:'Review',amount:3,payer:'Project sponsor'},{category:'Gas',amount:0,payer:'Project sponsor'},{category:'Storage',amount:0,payer:'Project sponsor'}],milestones:[{title:'10 reading kits',supplier:chain.accounts[j.supplier],amount:100}]},j.organiser);
  j.actor=j.organiser;note('Created a SGD 100 campaign with a fixed supplier, two reviewer addresses and a separately sponsored cost plan.');
 }else if(j.step===3){
  let receipt=Object.values(chain.record.donationReceipts||{}).find(r=>r.campaign.toLowerCase()===j.address.toLowerCase()&&r.donor.toLowerCase()===chain.accounts[j.donor].toLowerCase()&&r.amount===100);
  if(!receipt){await chain.setBalance(j.donor,200);note('Presenter setup allocated SGD 200 virtual funds to the new donor. Registration itself added no money.');receipt=await chain.contribute(j.address,j.donor,100);}
  j.receipt=receipt.hash;j.actor=j.donor;
  note(`Donor gave SGD 100 plus SGD ${receipt.fee||0} platform fee: wallet SGD ${receipt.balanceBefore} → SGD ${receipt.balanceAfter}; escrow received SGD 100. The fee stays in the separate platform vault: 60% operations reserve and 40% reviewer-credit reserve. Credits unlock equally once both assigned reviewers participate.`);
 }else if(j.step===4){
  const today=new Date((await chain.now())*1000).toISOString().slice(0,10);
  const milestone=await chain.contract(j.address).getMilestone(0);
  if(milestone.revision===0n||milestone.rejected)await chain.submit(j.address,0,{name:'Reading kits quotation.txt',note:'Fictional supplier quotation for ten reading kits, checked against the agreed recipient and fixed budget.',invoiceNumber:`CG-QUOTE-${j.run}`,invoiceDate:today,items:'Reading kits',quantity:10,unitPrice:10,expectedDelivery:today,supplierCheck:'Approved sample registration and fixed supplier address checked.',conflictsDeclared:true,sample:true},j.organiser);
  j.actor=j.organiser;note('Submitted a structured invoice: 10 kits × SGD 10 = SGD 100. Its salted fingerprint is on the local chain.');
 }else if(j.step===5){
  for(const [reviewer,bit] of [[3,1],[4,2]]){const m=await chain.contract(j.address).getMilestone(0);if(!(Number(m.approvals)&bit))await chain.review(j.address,0,reviewer,true);}
  j.actor=4;note('Priya and Daniel approved the same evidence revision. The contract awarded SGD 0.20 donation-only credits to each reviewer from this campaign’s SGD 0.40 reviewer allocation. One award per campaign.');
 }else if(j.step===6){
  if(!(await chain.contract(j.address).getMilestone(0)).paid)await chain.release(j.address,0,j.organiser);j.actor=j.supplier;
  note('Contract paid SGD 100 directly to the supplier. Escrow is SGD 0; delivery is still awaiting confirmation.');
 }else if(j.step===7){
  const today=new Date((await chain.now())*1000).toISOString().slice(0,10);
  const delivery=chain.record.deliveries?.[`${j.address.toLowerCase()}:0`];
  if(!delivery||delivery.status==='Changes requested')await chain.submitDelivery(j.address,0,{reference:`CG-DELIVERY-${j.run}`,quantity:'10 reading kits',receivedOn:today,notes:'Fictional supplier delivery statement: all ten kits supplied to the community reading corner.'},j.supplier);
  if(delivery?.status!=='Delivery confirmed')await chain.acceptDelivery(j.address,0,j.organiser,true,'Checked the sample delivery note and confirmed all ten kits match the order.');
  j.actor=j.organiser;note('Supplier submitted a delivery statement; organiser separately accepted it. Delivery confirmation moved no additional funds.');
 }
 j.step++;chain.record.guidedJourney=j;chain.save();return j;
}
export async function runRefundJourney(chain){
 const j=chain.record.guidedJourney;if(!j||j.step<8)throw new Error('Finish the main journey before the separate refund example.');
 if(j.refundAddress)throw new Error('This journey already has a refund example. Inspect its saved campaign.');
 const address=await chain.create({title:`Unfunded reading corner · ${j.run}`,description:'Separate fictional example: the campaign misses its full funding target and returns the donor contribution.',category:'Education',location:'Singapore',image:'school',fundingDays:1,deliveryDays:1,reviewers:[chain.accounts[3],chain.accounts[4]],requireVerification:true,conflictsConfirmed:true,milestones:[{title:'Additional reading kits',supplier:chain.accounts[j.supplier],amount:100}]},j.organiser);
 // Persist the address before subsequent actions, so a retry can never create a hidden duplicate.
 j.refundAddress=address;chain.save();return finishRefundJourney(chain);
}
export async function finishRefundJourney(chain){
 const j=chain.record.guidedJourney;if(!j?.refundAddress)throw new Error('Start the refund example first.');
 const address=j.refundAddress;const c=chain.contract(address);
 if(Number(await c.raised())===0){await chain.contribute(address,j.donor,50);j.logs.push('Separate example: donor contributed SGD 50 plus SGD 0.50 platform fee towards a SGD 100 target. Only the donation principal is refundable.');}
 if(!await c.refunded(chain.accounts[j.donor])){await chain.advanceDeadline(address,'funding');await chain.claim(address,j.donor);}
 j.refundDone=true;j.actor=j.donor;chain.save();return j;
}

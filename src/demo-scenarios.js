import {CAMPAIGN_CONTENT} from './campaign-content.js';
import {Contract,ContractFactory} from 'ethers';
import artifacts from '../artifacts/contracts.json' with {type:'json'};
import {donationQuote} from './fees.js';
export const SCENARIO_VERSION=2;
export async function ensureDemoScenarios(chain,{force=false}={}){
 if(!force&&chain.record.scenarioLibrary?.version===SCENARIO_VERSION&&chain.record.scenarioLibrary.complete)return;
 if(force||chain.record.scenarioLibrary?.version!==SCENARIO_VERSION){
  const old=chain.record.deployments.factory,oldVault=chain.record.deployments.feeVault;
  const factory=await new ContractFactory(artifacts.ClearGiveFeeFactory.abi,artifacts.ClearGiveFeeFactory.bytecode,chain.signers[2]).deploy(chain.record.deployments.token);await factory.waitForDeployment();
  chain.record.deployments.legacyFactories ||= [];if(!chain.record.deployments.legacyFactories.includes(old))chain.record.deployments.legacyFactories.push(old);
  chain.record.deployments.historicFeeVaults ||= [];if(!chain.record.deployments.historicFeeVaults.includes(oldVault))chain.record.deployments.historicFeeVaults.push(oldVault);
  chain.record.deployments.factory=await factory.getAddress();chain.record.deployments.feeVault=await factory.feeVault();
  chain.record.seeded=true;chain.record.feeExamplesReady=true;
  chain.record.scenarioLibrary={version:SCENARIO_VERSION,complete:false,addresses:{},logs:[]};chain.save();
 }
 chain.factory=new Contract(chain.record.deployments.factory,artifacts.ClearGiveFeeFactory.abi,chain.provider);
 chain.feeVault=new Contract(chain.record.deployments.feeVault,artifacts.ClearGiveFeeVault.abi,chain.provider);
 const lib=chain.record.scenarioLibrary;
 for(const actor of [2,5,6,7]){
  if(chain.registrationApproved(chain.accounts[actor]))continue;
  if(chain.verification(chain.accounts[actor]).status!=='Pending review')await chain.requestVerification(actor,{registration:`PREPARED-COMMUNITY-${actor}`,purpose:'Fictional organisation registration for the prepared community donation scenarios.',document:'Prepared sample organisation details.txt',conflicts:'No ownership or family relationship with the assigned sample reviewers declared.'});
  await chain.reviewVerification(actor,3,true,'Prepared fictional registration, supplier role and conflict declaration checked for the presentation examples.',true);
 }

 const note=t=>{if(!lib.logs.includes(t))lib.logs.push(t);chain.save();chain.onProgress(t);};
 const alt=chain.record.communityReviewers.map(i=>chain.accounts[i]);
 const make=async(key,title,scenario,order,{amounts=[1000],supplier=5,reviewers=[chain.accounts[3],chain.accounts[4]],days=30,image='school'}={})=>{
  if(!lib.addresses[key]){
   const saved=Object.entries(chain.record.metadata).find(([,m])=>m.scenarioKey===key&&m.scenarioLibraryVersion===SCENARIO_VERSION&&m.scenarioGeneration===chain.record.deployments.factory);
   lib.addresses[key]=saved?saved[0]:await chain.create({title,description:`A community giving project demonstrating ${scenario.toLowerCase()}. Its donations, fees, reviews, supplier payments and refunds are recorded through the current contracts.`,category:image==='pantry'?'Food security':image==='garden'?'Environment':'Education',image,location:'Singapore',...CAMPAIGN_CONTENT[key],fundingDays:days,deliveryDays:days,reviewers,scenarioKey:key,scenarioLibraryVersion:SCENARIO_VERSION,scenarioGeneration:chain.record.deployments.factory,scenarioLabel:scenario,scenarioOrder:order,milestones:amounts.map((amount,i)=>({title:amounts.length===1?'Community supplies':i===0?'First supplier order':'Second supplier order',supplier:chain.accounts[supplier],amount}))});chain.save();
  }
  return lib.addresses[key];
 };
 const give=async(address,actor,total,source='wallet')=>{
  const existing=Number(await chain.contract(address).contributions(chain.accounts[actor]))/1e6;
  if(existing>=total)return;
  const amount=total-existing;
  if(source==='wallet'){const quote=donationQuote(amount).total,available=Number(await chain.token.balanceOf(chain.accounts[actor]))/1e6;if(available<quote)await chain.mint(actor,Math.ceil(quote-available)+1000);}
  await chain.contribute(address,actor,amount,source);
 };
 const invoice=async(address,id=0)=>{if((await chain.contract(address).getMilestone(id)).revision===0n)await chain.submit(address,id,{name:'Community supplier quotation.txt',note:'Fictional quotation for the fixed supplier order. Recipient, budget and sample conflict declaration checked.',sample:true});};
 const reviews=async(address,id=0)=>{for(const actor of [3,4]){const m=await chain.contract(address).getMilestone(id);const bit=actor===3?1:2;if(!(Number(await chain.contract(address).reviewParticipation(id,m.revision))&bit))await chain.review(address,id,actor,true);}};
 const pay=async(address,id=0)=>{await invoice(address,id);await reviews(address,id);if(!(await chain.contract(address).getMilestone(id)).paid)await chain.release(address,id);};
 const claim=async(address,actor)=>{if(!await chain.contract(address).refunded(chain.accounts[actor]))await chain.claim(address,actor);};
 note('Preparing missed-deadline and refund examples…');
 const partial=await make('partial-refund','Learning essentials: unspent funds returned','Partial refund · one donor still to claim',8,{amounts:[400,600],days:1});
 await give(partial,0,600);await give(partial,1,400);await pay(partial);
 const failed=await make('funding-refund','Neighbourhood pantry appeal','Funding target missed · full principal refunded',9,{days:1,image:'pantry',supplier:6});await give(failed,0,400);await give(failed,1,200);
 const creditRefund=await make('credit-refund','Community food packs supported by reviewers','Credit-funded donation refunded as credits',10,{reviewers:alt,days:1,image:'pantry',supplier:6});
 await give(creditRefund,3,1,'credits');await give(creditRefund,4,1,'credits');await give(creditRefund,0,20);await give(creditRefund,1,10);
 if(!lib.clockAdvanced){if(!await chain.contract(partial).refundsOpened())await chain.advanceDeadline(partial,'delivery');lib.clockAdvanced=true;chain.save();}
 await claim(partial,0);for(const actor of [0,1])await claim(failed,actor);for(const actor of [3,4,0,1])await claim(creditRefund,actor);
 note('Preparing live funding, evidence and reviewer examples…');
 const collecting=await make('collecting','Good food for our neighbours','Funding in progress',0,{amounts:[2000],image:'pantry',supplier:6,reviewers:alt});await give(collecting,0,500);await give(collecting,1,300);
 const funded=await make('funded','Warm meals for older neighbours','Fully funded · invoice needed',1,{image:'pantry',supplier:6});await give(funded,0,600);await give(funded,1,400);
 const revised=await make('revised','Reading kits for young learners','Revised invoice · one approval remaining',2);await give(revised,0,400);await give(revised,1,600);await invoice(revised);
 let m=await chain.contract(revised).getMilestone(0);
 if(m.revision===1n){if(!m.rejected)await chain.review(revised,0,3,false,'Please clarify the fictional quantity and supplier quotation.');if(!(Number(await chain.contract(revised).reviewParticipation(0,1))&2))await chain.review(revised,0,4,true);await chain.submit(revised,0,{name:'Revised reading kits quotation.txt',note:'Fictional revised quotation correcting quantity and supplier details while retaining the fixed budget.',sample:true});}
 m=await chain.contract(revised).getMilestone(0);if(!(Number(m.approvals)&1))await chain.review(revised,0,3,true);
 const ready=await make('ready','Books for a neighbourhood reading corner','Two approvals · ready to pay',3,{amounts:[1500]});await give(ready,0,900);await give(ready,1,600);await invoice(ready);await reviews(ready);
 const rejected=await make('rejected','A safer community kitchen','Changes requested · payment blocked',4,{image:'pantry',supplier:6});await give(rejected,0,600);await give(rejected,1,400);await invoice(rejected);
 m=await chain.contract(rejected).getMilestone(0);if(!m.rejected)await chain.review(rejected,0,3,false,'The fictional quotation needs a clearer item breakdown before payment.');if(!(Number(await chain.contract(rejected).reviewParticipation(0,m.revision))&2))await chain.review(rejected,0,4,false,'Please provide the requested fictional item breakdown.');
 note('Recording supplier payments, delivery and onward credit donations…');
 const partPaid=await make('partial-paid','Classroom essentials for students','First supplier paid · second order held',5,{amounts:[400,600]});
 // Two gifts by Alex demonstrate per-transaction accounting as well as per-donor totals.
 await give(partPaid,0,400);await give(partPaid,0,600);await give(partPaid,1,400);await pay(partPaid);await invoice(partPaid,1);
 const pending=await make('delivery-pending','School backpacks for students','Supplier paid · delivery awaiting confirmation',6,{amounts:[500]});await give(pending,0,300);await give(pending,1,200);await pay(pending);
 const complete=await make('delivered','Grow a greener shared space','Paid and delivery confirmed',7,{amounts:[1200],image:'garden',supplier:7});await give(complete,0,720);await give(complete,1,480);await pay(complete);await chain.refresh();
 const date=new Date((await chain.now())*1000).toISOString().slice(0,10),delivery=chain.record.deliveries?.[`${complete.toLowerCase()}:0`];
 if(!delivery)await chain.submitDelivery(complete,0,{reference:'COMMUNITY-GARDEN-DELIVERY',quantity:'Community garden supplies',receivedOn:date,notes:'Fictional delivery statement confirming that the agreed garden supplies arrived.'},7);
 if(chain.record.deliveries[`${complete.toLowerCase()}:0`].status!=='Delivery confirmed')await chain.acceptDelivery(complete,0,2,true,'Fictional delivery checked against the agreed supplier order and confirmed received.');
 const onward=await make('credit-onward','Reviewer-supported food parcels','Earned reviewer credits donated onward',11,{reviewers:alt,image:'pantry',supplier:6});await give(onward,0,100);await give(onward,1,50);await give(onward,3,5,'credits');await give(onward,4,5,'credits');
 lib.complete=true;lib.completedAt=await chain.now();note('Twelve current 1% scenarios ready. Every example amount has matching contract transactions.');await chain.refresh();
}

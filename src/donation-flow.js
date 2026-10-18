import {donationPosition,proportionalShares} from './donor-accounting.js';
import {ZeroHash} from 'ethers';
import {sameAddress,approvals,campaignProgress} from './experience.js';
const micros=value=>BigInt(Math.round(Number(value||0)*1e6));
const amount=value=>Number(value)/1e6;
// A donation is identifiable; its tokens subsequently share a campaign pool.
// Never attribute a supplier payment or an aggregate refund to a single deposit.
export function donationFlow(campaigns,audit,hash,selectedMilestone){
 const donation=audit.find(e=>e.name==='Donated'&&e.hash===hash);
 if(!donation)return null;
 const creditFunding=audit.find(e=>e.name==='ReviewerCreditsSpent'&&e.hash===hash&&sameAddress(e.campaign,donation.campaign));
 const charge=audit.find(e=>e.name==='FeeCharged'&&e.hash===hash&&sameAddress(e.campaign,donation.campaign)&&sameAddress(e.args.donor,donation.args.donor));
 const campaign=campaigns.find(c=>sameAddress(c.address,donation.campaign));
 if(!campaign)return null;
 const events=audit.filter(e=>sameAddress(e.campaign,campaign.address));
 const donorEvents=events.filter(e=>e.name==='Donated'&&sameAddress(e.args.donor,donation.args.donor));
 const refundEvents=events.filter(e=>e.name==='Refunded');
 const donorRefunds=refundEvents.filter(e=>sameAddress(e.args.donor,donation.args.donor));
 const donorTotal=donorEvents.reduce((n,e)=>n+BigInt(e.args.amount),0n);
 const refundTotal=refundEvents.reduce((n,e)=>n+BigInt(e.args.amount),0n);
 const paid=events.filter(e=>e.name==='SupplierPaid');
 const milestones=campaign.milestones.map(m=>{
  const payment=paid.find(e=>Number(e.args.milestone)===m.id);
  return {...m,approvalCount:approvals(m),payment,paymentAmount:payment?amount(BigInt(payment.args.amount)):0,
   reviewerProofs:campaign.reviewers.map((address,i)=>({address,approved:!!(m.approvals&(1<<i)),event:(m.approvals&(1<<i))?events.find(e=>e.name==='Reviewed'&&Number(e.args.milestone)===m.id&&Number(e.args.revision)===m.revision&&e.args.approved===true&&sameAddress(e.args.reviewer,address)):null})),
   evidence:events.find(e=>e.name==='EvidenceSubmitted'&&Number(e.args.milestone)===m.id&&Number(e.args.revision)===m.revision),
   deliveryStatus:m.delivery?.status||'Not recorded'};
 });
 const chosen=milestones.find(m=>m.id===selectedMilestone)||milestones.find(m=>!m.paid)||milestones[0];
 const refundsOpen=campaign.status==='Refunds';
 const raised=micros(campaign.raised),released=micros(campaign.released);
 // Totals come from contract reads; per-wallet refunds and proof links come from events.
 const refundPaid=micros(campaign.refundPaid);
 const held=raised-released-refundPaid;
 const pool=refundsOpen?micros(campaign.refundPool||campaign.raised-campaign.released):0n;
 const fullyFunded=raised===micros(campaign.target);
 const invoice=!!chosen&&chosen.hash!==ZeroHash;
 const twoApprovals=!!chosen&&!chosen.rejected&&chosen.approvalCount===2;
 const refundState=donorRefunds.length?'Returned':refundsOpen&&donorTotal>0n?'Claim available':campaign.status==='Completed'?'Closed':'Not open';
 const own=donationPosition(campaign,audit,hash);
 const ownSupplierShares=proportionalShares(micros(own.paid),milestones.map(m=>micros(m.paymentAmount)));
 milestones.forEach((m,i)=>m.ownPaymentAmount=amount(ownSupplierShares[i]));
 return {own,donation,creditFunding,fundingSource:creditFunding?'credits':'wallet',charge,fee:charge?amount(BigInt(charge.args.fee)):0,totalCharged:charge?amount(BigInt(charge.args.total)):amount(BigInt(donation.args.amount)),campaign,events,donor:donation.args.donor,donationAmount:amount(BigInt(donation.args.amount)),donorTotal:amount(donorTotal),donorDepositCount:donorEvents.length,
  raised:amount(raised),otherDonations:amount(raised-BigInt(donation.args.amount)),released:amount(released),refunded:amount(refundPaid),held:amount(held),refundPool:amount(pool),refundRemaining:amount(pool-refundPaid),
  donorRefund:amount(donorRefunds.reduce((n,e)=>n+BigInt(e.args.amount),0n)),donorRefunds,refundEvents,refundState,refundsOpen,
  milestones,chosen,fullyFunded,invoice,twoApprovals,releaseReady:campaign.status==='Active'&&fullyFunded&&invoice&&twoApprovals&&!chosen?.paid,
  progress:campaignProgress(campaign),
  // Supports integrity checks without manufacturing donation-level allocations.
  reconciled:(!charge||BigInt(charge.args.total)===BigInt(donation.args.amount)+BigInt(charge.args.fee))&&held>=0n&&refundTotal===refundPaid&&paid.reduce((n,e)=>n+BigInt(e.args.amount),0n)===released};
}

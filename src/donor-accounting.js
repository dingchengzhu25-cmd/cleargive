import {recordedDonation} from './fees.js';
const same=(a,b)=>a?.toLowerCase()===b?.toLowerCase();
const units=n=>BigInt(Math.round(Number(n||0)*1e6));
const value=n=>Number(n)/1e6;
// Largest remainders keep every micro-unit accounted for without exceeding an input weight.
function weightedShares(total,weights){
 total=BigInt(total);weights=weights.map(BigInt);const sum=weights.reduce((a,b)=>a+b,0n);
 if(!sum)return weights.map(()=>0n);
 if(total<0n)throw new Error('Allocation cannot be negative.');
 const shares=weights.map(w=>total*w/sum),order=weights.map((w,i)=>({i,r:total*w%sum})).sort((a,b)=>a.r===b.r?a.i-b.i:a.r>b.r?-1:1);
 let rest=total-shares.reduce((a,b)=>a+b,0n);for(const {i} of order){if(!rest)break;shares[i]++;rest--;}
 return shares;
}
export function proportionalShares(total,weights){
 const sum=weights.map(BigInt).reduce((a,b)=>a+b,0n);
 if(sum&&BigInt(total)>sum)throw new Error('Allocation exceeds available principal.');
 return weightedShares(total,weights);
}
export function donationPositions(campaign,audit,donor){
 const events=audit.filter(e=>same(e.campaign,campaign.address));
 const gifts=events.filter(e=>e.name==='Donated').sort((a,b)=>a.block-b.block||(a.index||0)-(b.index||0));
 const donors=[...new Set(gifts.map(e=>e.args.donor.toLowerCase()))];
 const weights=donors.map(d=>gifts.filter(e=>same(e.args.donor,d)).reduce((n,e)=>n+BigInt(e.args.amount),0n));
 const refunds=donors.map(d=>events.filter(e=>e.name==='Refunded'&&same(e.args.donor,d)).reduce((n,e)=>n+BigInt(e.args.amount),0n));
 const paid=proportionalShares(units(campaign.released),weights);
 const held=weights.map((w,i)=>w-paid[i]);
 if(campaign.status==='Refunds'){
  // Actual refunds can differ from proportional shares by micro-units. Keep
  // real payments/refunds nonnegative and disclose their signed adjustment.
  const pool=units(campaign.refundPool||campaign.raised-campaign.released);
  const remaining=pool-refunds.reduce((a,b)=>a+b,0n);
  const pending=donors.map((d,i)=>({d,i})).filter(({d})=>!events.some(e=>e.name==='Refunded'&&same(e.args.donor,d)));
  held.fill(0n);
  const shares=weightedShares(remaining,pending.map(({i})=>weights[i]));
  pending.forEach(({i},j)=>{held[i]=shares[j];});
 }
 const index=donors.findIndex(d=>same(d,donor)),own=gifts.filter(e=>same(e.args.donor,donor));
 if(index<0)return {entries:[],principal:0,held:0,paid:0,refunded:0,fee:0,total:0,refundAvailable:0,roundingAdjustment:0};
 const amounts=own.map(e=>BigInt(e.args.amount)),ownPaid=proportionalShares(paid[index],amounts);
 const ownRefunded=weightedShares(refunds[index],amounts),ownHeld=weightedShares(held[index],amounts);
 const entries=own.map((e,i)=>{const q=recordedDonation(audit,e),held=ownHeld[i],rounding=amounts[i]-ownPaid[i]-ownRefunded[i]-held;return {...q,event:e,hash:e.hash,principal:q.amount,paid:value(ownPaid[i]),refunded:value(ownRefunded[i]),held:value(held),roundingAdjustment:value(rounding),refundAvailable:campaign.status==='Refunds'?value(held):0,source:events.some(x=>x.name==='ReviewerCreditsSpent'&&x.hash===e.hash)?'credits':'wallet',reconciled:amounts[i]===ownPaid[i]+ownRefunded[i]+held+rounding};});
 return {entries,...Object.fromEntries(['principal','held','paid','refunded','fee','total','operations','credits','refundAvailable','roundingAdjustment'].map(k=>[k,value(entries.reduce((n,e)=>n+units(e[k]),0n))]))};
}
export function donationPosition(campaign,audit,hash){const gift=audit.find(e=>e.name==='Donated'&&e.hash===hash&&same(e.campaign,campaign.address));return gift?donationPositions(campaign,audit,gift.args.donor).entries.find(e=>e.hash===hash):null;}

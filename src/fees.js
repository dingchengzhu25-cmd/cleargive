export function donationQuote(amount,enabled=true){
 const value=Number(amount),cents=Math.round(value*100);
 if(!Number.isFinite(value)||value<.01||value>1000000||Math.abs(value*100-cents)>.00001)throw new Error('Use SGD 0.01–1,000,000, with at most two decimal places.');
 const feeCents=enabled?Math.floor((cents+50)/100):0;
 const feeMicros=BigInt(feeCents)*10000n,operationsMicros=feeMicros*60n/100n;
 return {amount:cents/100,fee:feeCents/100,total:(cents+feeCents)/100,operations:Number(operationsMicros)/1e6,credits:Number(feeMicros-operationsMicros)/1e6};
}

// Split the fee actually recorded, rather than recalculating a historical rate.
export function feeAllocation(fee){
 const micros=BigInt(Math.round(Number(fee)*1e6)),operations=micros*60n/100n;
 return {operations:Number(operations)/1e6,credits:Number(micros-operations)/1e6};
}
export function recordedDonation(audit,event){
 const same=(a,b)=>a?.toLowerCase()===b?.toLowerCase();
 const charge=audit.find(e=>e.name==='FeeCharged'&&e.hash===event.hash&&same(e.campaign,event.campaign)&&same(e.args.donor,event.args.donor));
 const amount=Number(event.args.amount)/1e6,fee=charge?Number(charge.args.fee)/1e6:0;
 return {amount,fee,total:charge?Number(charge.args.total)/1e6:amount,...feeAllocation(fee),historical:!charge,charge};
}

// Only the current fee-and-reviewer-credit generation appears in presentation views.
export function currentFeeRecords(campaigns,audit,walletTransfers){
 const retiredCampaigns=campaigns.filter(c=>!c.feeEnabled||c.archived),retiredAddresses=new Set(retiredCampaigns.map(c=>c.address.toLowerCase()));
 const retiredAudit=audit.filter(e=>retiredAddresses.has(e.campaign?.toLowerCase())),retiredTransactions=new Set(retiredAudit.map(e=>e.hash));
 const isRetiredTransfer=t=>retiredTransactions.has(t.hash)||retiredAddresses.has(t.from?.toLowerCase())||retiredAddresses.has(t.to?.toLowerCase());
 return {campaigns:campaigns.filter(c=>c.feeEnabled&&!c.archived),audit:audit.filter(e=>!retiredAddresses.has(e.campaign?.toLowerCase())),walletTransfers:walletTransfers.filter(t=>!isRetiredTransfer(t)),retired:{campaigns:retiredCampaigns,audit:retiredAudit,walletTransfers:walletTransfers.filter(isRetiredTransfer)}};
}

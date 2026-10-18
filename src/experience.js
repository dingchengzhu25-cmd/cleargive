import {ZeroHash} from 'ethers';
export const sameAddress=(a,b)=>a?.toLowerCase()===b?.toLowerCase();
export const approvals=m=>(m.approvals&1?1:0)+(m.approvals&2?1:0);
export const TIMELINE_LABELS=['Collecting donations','Fully funded','Evidence submitted','Two approvals','Supplier paid','Delivery confirmed'];
export function campaignProgress(c){
 if(c.status==='Refunds'){const settled=c.refundPool>0&&c.refundPaid>=c.refundPool;return {stage:-1,heading:settled?'Refunds settled':'Refunds available',next:settled?'All eligible unspent funds have been returned. Supplier payments are closed.':'Donors can claim their share of eligible unspent funds. Supplier payments are closed.'};}
 if(c.status==='Funding')return {stage:0,heading:'Collecting donations',next:'Reach the full campaign target before evidence can be approved for payment.'};
 const m=c.milestones.find(m=>!m.paid);
 if(m){
  if(m.rejected)return {stage:1,heading:'Evidence changes requested',next:`The organiser must revise evidence for “${m.title}”. Both reviewers must approve the new revision.`};
  if(m.hash===ZeroHash)return {stage:1,heading:'Waiting for evidence',next:`The organiser must submit the invoice for “${m.title}”.`};
  if(approvals(m)<2){const waiting=c.reviewers.filter((_,i)=>!(m.approvals&(1<<i)));return {stage:2,heading:'Waiting for reviewer approval',next:`${approvals(m)} of 2 approvals for “${m.title}”.`,waiting};}
  return {stage:3,heading:'Ready for supplier payment',next:`Release the agreed payment for “${m.title}” to its fixed supplier.`};
 }
 const pending=c.milestones.filter(m=>m.delivery?.status!=='Delivery confirmed');
 if(pending.length)return {stage:4,heading:'Payment complete · delivery pending',next:`${pending.length} delivery ${pending.length===1?'confirmation remains':'confirmations remain'}. The supplier records delivery; the organiser or an assigned reviewer checks receipt.`};
 return {stage:5,heading:'Delivery confirmed',next:'All supplier payments and delivery acceptances are recorded. View the report and payment trail.'};
}
export function accountRole(id,index){if(id?.reviewer||/^Reviewer/.test(id?.role||''))return 'reviewer';return id?.kind==='business'||[2,5,6,7].includes(index)?'organisation':'donor';}
export function relatedCampaigns(campaigns,address,role,index){return campaigns.filter(c=>role==='reviewer'?c.reviewers.some(r=>sameAddress(r,address)):role==='organisation'?sameAddress(c.organiser,address)||c.milestones.some(m=>sameAddress(m.supplier,address)):c.contributions[index]>0);}

import {handleSharedApi} from './shared-api.js';
import { JsonRpcProvider, Contract, verifyMessage, keccak256, toUtf8Bytes } from 'ethers';
const registryAbi=['function isCampaign(address) view returns (bool)'];
const campaignAbi=['function organiser() view returns (address)','function reviewer1() view returns (address)','function reviewer2() view returns (address)','function milestoneCount() view returns (uint256)','function getMilestone(uint256) view returns ((string title,address supplier,uint256 amount,bytes32 evidenceHash,uint32 revision,uint8 approvals,bool rejected,bool paid))'];
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const digest=data=>keccak256(toUtf8Bytes(JSON.stringify(data)));
const equal=(a,b)=>a?.toLowerCase()===b?.toLowerCase();
async function encryptionKey(env){
  if(!/^[a-f0-9]{64}$/i.test(env.EVIDENCE_KEY||''))throw new Error('Private evidence storage is not configured.');
  const bytes=Uint8Array.from(env.EVIDENCE_KEY.match(/../g),b=>parseInt(b,16));
  return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);
}
export async function seal(data,env){const iv=crypto.getRandomValues(new Uint8Array(12)),key=await encryptionKey(env);const value=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(data)));return{iv:Array.from(iv),cipher:Array.from(new Uint8Array(value))};}
export async function unseal(data,env){const key=await encryptionKey(env);const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:Uint8Array.from(data.iv)},key,Uint8Array.from(data.cipher));return JSON.parse(new TextDecoder().decode(plain));}
export function validateProof(proof,expected){
  if(!proof||!Number.isInteger(proof.expires)||proof.expires<Math.floor(Date.now()/1000)||proof.expires>Math.floor(Date.now()/1000)+180)throw new Error('Evidence signature expired.');
  const message=`ClearGive evidence access\nOrigin: ${expected.origin}\nChain: ${expected.chainId}\nFactory: ${expected.factory.toLowerCase()}\nCampaign: ${expected.campaign.toLowerCase()}\nEvidence: ${expected.evidenceHash}\nAction: ${expected.action}\nPayload: ${expected.payloadHash||''}\nExpires: ${proof.expires}`;
  if(proof.message!==message)throw new Error('Signature scope does not match this request.');
  return verifyMessage(message,proof.signature);
}
export class StraitsXClient {
  constructor(env,fetcher=fetch){this.env=env;this.fetcher=fetcher;}
  async payment(id){
    if(!this.env.STRAITSX_API_KEY)throw new Error('StraitsX API approval and credentials are required.');
    if(!/^[a-zA-Z0-9_-]{1,160}$/.test(id))throw new Error('Invalid payment reference.');
    const base=this.env.STRAITSX_ENV==='production'?'https://api.straitsx.com':'https://api-sandbox.straitsx.com';
    const res=await this.fetcher(`${base}/v1/payments/${encodeURIComponent(id)}`,{headers:{'X-XFERS-APP-API-KEY':this.env.STRAITSX_API_KEY,'Accept':'application/json'},signal:AbortSignal.timeout(15000)});
    if(!res.ok)throw new Error(`StraitsX payment lookup failed (${res.status}).`);
    return res.json();
  }
}
export async function handleApi(request,env,dependencies={}){
  const shared=await handleSharedApi(request,env);if(shared)return shared;
  const url=new URL(request.url),route=url.pathname.replace(/^\/api\/?/,'');
  if(route==='status')return json({evidenceAvailable:!!env.EVIDENCE&&/^[a-f0-9]{64}$/i.test(env.EVIDENCE_KEY||'')&&!!env.FACTORY_ADDRESS&&!!env.RPC_URL,paymentProvider:'StraitsX',providerLookupConfigured:!!env.STRAITSX_API_KEY,fiatCheckoutEnabled:false,reason:'Bank checkout requires approved third-party collection/payout routing, customer profiles, reconciliation and a production signer. No live payment requests are issued by this release.'});
  if(route.startsWith('provider/payment/')&&request.method==='GET'){
    if(!env.OPS_TOKEN||request.headers.get('Authorization')!==`Bearer ${env.OPS_TOKEN}`)return json({error:'Operator authentication required.'},401);
    try{return json(await new StraitsXClient(env).payment(route.slice('provider/payment/'.length)));}catch(error){return json({error:error.message},502);}
  }
  if(route==='checkout')return json({error:'SGD bank checkout is not activated. No money has been collected. StraitsX must approve the third-party flow and provide its collection/payout configuration.'},503);
  if(route==='evidence'&&request.method==='POST'){
    try{
      if(Number(request.headers.get('Content-Length')||0)>600000)return json({error:'Sample evidence exceeds 250 KB file limit.'},413);
      const bodyText=await request.text();if(bodyText.length>600000)return json({error:'Evidence too large.'},413);
      const body=JSON.parse(bodyText),{campaign,evidenceHash,action,proof,envelope}=body;
      if(!/^0x[0-9a-f]{40}$/i.test(campaign||'')||!/^0x[0-9a-f]{64}$/i.test(evidenceHash||''))throw new Error('Invalid campaign or evidence address.');
      if(!env.EVIDENCE||!env.FACTORY_ADDRESS||!env.RPC_URL)throw new Error('Private evidence service is not configured.');
      const origin=env.APP_ORIGIN||url.origin;if(url.origin!==origin)throw new Error('Application origin mismatch.');
      const signer=validateProof(proof,{origin,chainId:Number(env.CHAIN_ID||11155111),factory:env.FACTORY_ADDRESS,campaign,evidenceHash,action,payloadHash:action==='write'?digest(envelope):''});
      const provider=dependencies.provider||new JsonRpcProvider(env.RPC_URL),factory=new Contract(env.FACTORY_ADDRESS,registryAbi,provider);
      if(Number((await provider.getNetwork()).chainId)!==Number(env.CHAIN_ID||11155111))throw new Error('Evidence RPC chain mismatch.');
      if(!await factory.isCampaign(campaign))throw new Error('Unrecognised campaign.');
      const c=new Contract(campaign,campaignAbi,provider);
      const organiser=await c.organiser(),r1=await c.reviewer1(),r2=await c.reviewer2();
      const key=`${env.CHAIN_ID||11155111}:${campaign.toLowerCase()}:${evidenceHash}`;
      if(action==='write'){
        if(!equal(signer,organiser))return json({error:'Only the campaign organiser can upload evidence.'},403);
        if(!envelope||digest(envelope)!==evidenceHash||typeof envelope.salt!=='string'||!/^[a-f0-9]{64}$/i.test(envelope.salt))throw new Error('Evidence fingerprint or salt is invalid.');
        await env.EVIDENCE.put(key,JSON.stringify(await seal(envelope,env)));return json({evidenceHash,stored:true});
      }
      if(action!=='read')throw new Error('Unknown evidence operation.');
      if(![organiser,r1,r2].some(a=>equal(a,signer)))return json({error:'Only the organiser and assigned reviewers can read evidence.'},403);
      if(!equal(signer,organiser)){
        let linked=false;const n=Number(await c.milestoneCount());for(let i=0;i<n;i++)if((await c.getMilestone(i)).evidenceHash===evidenceHash)linked=true;
        if(!linked)return json({error:'Evidence has not been submitted to this campaign.'},403);
      }
      const record=await env.EVIDENCE.get(key);if(!record)return json({error:'Evidence not found.'},404);
      return json({envelope:await unseal(JSON.parse(record),env)});
    }catch(error){return json({error:error.message},400);}
  }
  return json({error:'Unknown API route.'},404);
}
export default {async fetch(request,env){const url=new URL(request.url);if(url.pathname.startsWith('/api/'))return handleApi(request,env);return env.ASSETS.fetch(request);}};

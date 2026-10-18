import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,Contract,parseUnits,id,ZeroHash,Wallet} from 'ethers';
import {compile} from '../scripts/compile.mjs';
import {handleApi,StraitsXClient,seal,unseal,validateProof} from '../src/worker.js';
let artifacts;
before(()=>{artifacts=compile();});
const u=v=>parseUnits(String(v),6);
async function fixture(){
  const rpc=ganache.provider({logging:{quiet:true},wallet:{deterministic:true,totalAccounts:8},chain:{chainId:1337,hardfork:'shanghai'},miner:{timestampIncrement:1}});
  const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
  const signers=await Promise.all(Array.from({length:8},(_,i)=>provider.getSigner(i))),accounts=await Promise.all(signers.map(s=>s.getAddress()));
  const token=await new ContractFactory(artifacts.TestSGD.abi,artifacts.TestSGD.bytecode,signers[0]).deploy();await token.waitForDeployment();
  const factory=await new ContractFactory(artifacts.XSGDFactory.abi,artifacts.XSGDFactory.bytecode,signers[0]).deploy(await token.getAddress(),accounts[0]);await factory.waitForDeployment();
  const now=Number((await provider.getBlock('latest')).timestamp),deadline=now+2000;
  const create=async title=>{await(await factory.connect(signers[2]).createCampaign([accounts[3],accounts[4]],title,now+1000,deadline,['Books','Equipment'],[accounts[5],accounts[5]],[u(400),u(600)],JSON.stringify({description:'Public sample metadata',location:'Singapore'}))).wait();return new Contract(await factory.campaigns(Number(await factory.campaignCount())-1),artifacts.XSGDCampaign.abi,provider);};
  const c=await create('SGD community drive'),address=await c.getAddress();
  for(const i of [0,1])await(await token.mint(accounts[i],u(10000))).wait();
  const approve=async actor=>{const m=await c.getMilestone(0);await(await c.connect(signers[actor]).review(0,m.revision,m.evidenceHash,true,ZeroHash)).wait();};
  const fiat=async(ref,payment,n)=>{await(await token.approve(address,u(n))).wait();return(await c.connect(signers[0]).depositFiat(ref,payment,u(n))).wait();};
  const expire=async()=>{const now=Number((await provider.getBlock('latest')).timestamp);await rpc.request({method:'evm_increaseTime',params:[deadline-now+1]});await rpc.request({method:'evm_mine',params:[]});};
  return{rpc,provider,signers,accounts,token,factory,c,address,create,fiat,approve,expire};
}
async function use(fn){const f=await fixture();try{await fn(f);}finally{await f.rpc.disconnect();}}
test('walletless fiat credits require transferred tokens and only the configured gateway can record them',async()=>use(async f=>{
  await assert.rejects(()=>f.c.connect(f.signers[1]).depositFiat(id('donor'),id('payment'),u(100)));
  await assert.rejects(()=>f.c.connect(f.signers[0]).depositFiat(id('donor'),id('payment'),u(100)));
  assert.equal(await f.factory.paymentUsed(id('payment')),false);
  await f.fiat(id('donor'),id('payment'),600);
  const ref=await f.c.fiatRef(id('donor'));assert.equal(await f.c.contributions(ref),u(600));assert.equal(await f.c.refundRecipients(ref),f.accounts[0]);assert.equal(await f.token.balanceOf(f.address),u(600));
}));
test('payment references cannot be reused within a campaign or across the platform',async()=>use(async f=>{
  await f.fiat(id('donor'),id('settled-provider-payment'),100);
  await assert.rejects(()=>f.fiat(id('another donor'),id('settled-provider-payment'),100));
  const other=await f.create('Another campaign');await(await f.token.approve(await other.getAddress(),u(100))).wait();
  await assert.rejects(()=>other.connect(f.signers[0]).depositFiat(id('donor'),id('settled-provider-payment'),u(100)));
  await assert.rejects(()=>f.factory.consumePayment(id('unregistered caller')));
  assert.equal(await f.c.raised(),u(100));assert.equal(await other.raised(),0n);
}));
test('mixed fiat and wallet donations retain distinct refund rights after an approved supplier release',async()=>use(async f=>{
  await f.fiat(id('fiat donor'),id('provider payment'),600);
  await(await f.token.connect(f.signers[1]).approve(f.address,u(400))).wait();await(await f.c.connect(f.signers[1]).donate(u(400))).wait();
  await(await f.c.connect(f.signers[2]).submitEvidence(0,id('evidence'))).wait();
  await assert.rejects(()=>f.c.connect(f.signers[0]).release(0));await f.approve(3);await assert.rejects(()=>f.c.connect(f.signers[0]).release(0));await f.approve(4);
  await(await f.c.connect(f.signers[0]).release(0)).wait();assert.equal(await f.token.balanceOf(f.accounts[5]),u(400));
  await f.expire();const before=await f.token.balanceOf(f.accounts[0]);
  const fiatRef=await f.c.fiatRef(id('fiat donor'));
  await assert.rejects(()=>f.c.connect(f.signers[1]).claimRefund(fiatRef));
  await(await f.c.connect(f.signers[0]).claimRefund(fiatRef)).wait();assert.equal(await f.token.balanceOf(f.accounts[0])-before,u(360));
  const ref=await f.c.walletRef(f.accounts[1]);await(await f.c.connect(f.signers[1]).claimRefund(ref)).wait();assert.equal(await f.c.refundPaid(),u(600));assert.equal(await f.token.balanceOf(f.address),0n);
  await assert.rejects(()=>f.c.connect(f.signers[0]).claimRefund(fiatRef));
}));
test('gateway cannot act as an independent reviewer and campaign narrative stays on-chain',async()=>use(async f=>{
  const now=Number((await f.provider.getBlock('latest')).timestamp);
  await assert.rejects(()=>f.factory.connect(f.signers[2]).createCampaign([f.accounts[0],f.accounts[4]],'Conflicted',now+1000,now+2000,['Purchase'],[f.accounts[5]],[u(100)],'{}'));
  assert.match(await f.c.metadata(),/Public sample metadata/);assert.notEqual(await f.c.termsHash(),ZeroHash);
}));
test('public controller uses one wallet and shared contract state, with no demo seeding or impersonation',async()=>use(async f=>{
  const {PublicChain}=await import('../src/public-chain.js');
  const injected={request:r=>f.rpc.request(r.method==='eth_requestAccounts'?{method:'eth_accounts',params:[]}:r)};
  const controller=new PublicChain({chainId:1337,rpcUrl:'http://unused',factoryAddress:await f.factory.getAddress()},injected);
  await controller.connect();assert.equal(controller.account.toLowerCase(),f.accounts[0].toLowerCase());assert.equal(controller.campaigns.length,1);
  await controller.depositFiat(f.address,id('new donor'),id('another payment'),100);
  assert.equal(controller.campaigns[0].raised,100);assert.equal(controller.campaigns[0].target,1000);
  assert.ok(controller.events.some(e=>e.name==='Donated'));
  assert.equal(await f.factory.campaignCount(),1n);
}));
test('test token cannot be deployed to mainnet and factory rejects non-XSGD tokens there',async()=>{
  const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:1,hardfork:'shanghai'}}),p=new BrowserProvider(rpc),s=await p.getSigner();
  try{await assert.rejects(()=>new ContractFactory(artifacts.TestSGD.abi,artifacts.TestSGD.bytecode,s).deploy());await assert.rejects(()=>new ContractFactory(artifacts.XSGDFactory.abi,artifacts.XSGDFactory.bytecode,s).deploy(awaitAddress(s),awaitAddress(s)));}finally{await rpc.disconnect();}
});
function awaitAddress(s){return s.getAddress();}
test('encrypted evidence survives a round trip and cannot decrypt with a different key',async()=>{
  const env={EVIDENCE_KEY:'a'.repeat(64)},data={name:'Private quotation',note:'Fictional evidence',salt:'b'.repeat(64)};
  const encrypted=await seal(data,env);assert.ok(!JSON.stringify(encrypted).includes('Private quotation'));assert.deepEqual(await unseal(encrypted,env),data);await assert.rejects(()=>unseal(encrypted,{EVIDENCE_KEY:'c'.repeat(64)}));
});
test('evidence signatures bind origin, chain, campaign, action, payload and expiry',async()=>{
  const wallet=Wallet.createRandom(),expires=Math.floor(Date.now()/1000)+60;
  const expected={origin:'https://cleargive.example',chainId:11155111,factory:'0x'+'1'.repeat(40),campaign:'0x'+'2'.repeat(40),evidenceHash:id('doc'),action:'read',payloadHash:''};
  const message=`ClearGive evidence access\nOrigin: ${expected.origin}\nChain: ${expected.chainId}\nFactory: ${expected.factory}\nCampaign: ${expected.campaign}\nEvidence: ${expected.evidenceHash}\nAction: read\nPayload: \nExpires: ${expires}`;
  const proof={message,signature:await wallet.signMessage(message),expires};assert.equal(validateProof(proof,expected),wallet.address);
  for(const patch of [{origin:'https://attacker.example'},{chainId:1},{action:'write'},{payloadHash:id('changed')}])assert.throws(()=>validateProof(proof,{...expected,...patch}));
  assert.throws(()=>validateProof({...proof,expires:1},expected));
});
test('unconfigured bank checkout never issues payment instructions or reports a collected donation',async()=>{
  const status=await(await handleApi(new Request('https://cleargive.example/api/status'),{})).json();assert.equal(status.fiatCheckoutEnabled,false);assert.equal(status.evidenceAvailable,false);
  const checkout=await handleApi(new Request('https://cleargive.example/api/checkout',{method:'POST'}),{});assert.equal(checkout.status,503);assert.match((await checkout.json()).error,/No|not activated/);
  const lookup=await handleApi(new Request('https://cleargive.example/api/provider/payment/contract_1'),{});assert.equal(lookup.status,401);
});
test('StraitsX adapter uses the documented server-side payment lookup and rejects malformed IDs',async()=>{
  let request;const client=new StraitsXClient({STRAITSX_API_KEY:'test-only-key'},async(url,options)=>{request={url,options};return new Response(JSON.stringify({data:{id:'contract_123',attributes:{status:'completed'}}}),{status:200});});
  const result=await client.payment('contract_123');assert.equal(result.data.id,'contract_123');assert.equal(request.url,'https://api-sandbox.straitsx.com/v1/payments/contract_123');assert.equal(request.options.headers['X-XFERS-APP-API-KEY'],'test-only-key');await assert.rejects(()=>client.payment('../secrets'));await assert.rejects(()=>new StraitsXClient({}).payment('contract_123'));
});

test('private evidence API enforces real campaign roles and submitted hashes before reviewer access',async()=>use(async f=>{
  const env={EVIDENCE_KEY:'a'.repeat(64),FACTORY_ADDRESS:await f.factory.getAddress(),RPC_URL:'http://test-only',CHAIN_ID:'1337',APP_ORIGIN:'https://cleargive.example'};
  const store=new Map();env.EVIDENCE={put:async(k,v)=>store.set(k,v),get:async k=>store.get(k)||null};
  const envelope={name:'Fictional quote',note:'Private fictional supplier evidence',salt:'b'.repeat(64)};
  const {keccak256,toUtf8Bytes}=await import('ethers');const evidenceHash=keccak256(toUtf8Bytes(JSON.stringify(envelope)));
  const keys=f.rpc.getInitialAccounts();
  async function request(actor,action){
    const expires=Math.floor(Date.now()/1000)+60,payload=action==='write'?evidenceHash:'';
    const message=`ClearGive evidence access\nOrigin: ${env.APP_ORIGIN}\nChain: 1337\nFactory: ${env.FACTORY_ADDRESS.toLowerCase()}\nCampaign: ${f.address.toLowerCase()}\nEvidence: ${evidenceHash}\nAction: ${action}\nPayload: ${payload}\nExpires: ${expires}`;
    const wallet=new Wallet(keys[f.accounts[actor].toLowerCase()].secretKey);
    const proof={message,signature:await wallet.signMessage(message),expires};
    return handleApi(new Request(env.APP_ORIGIN+'/api/evidence',{method:'POST',body:JSON.stringify({campaign:f.address,evidenceHash,action,proof,envelope:action==='write'?envelope:undefined})}),env,{provider:f.provider});
  }
  assert.equal((await request(0,'write')).status,403);
  assert.equal((await request(2,'write')).status,200);
  assert.ok(!Array.from(store.values()).join('').includes(envelope.note));
  assert.equal((await request(1,'read')).status,403);
  assert.equal((await request(3,'read')).status,403);
  await f.fiat(id('settled fiat'),id('proof payment'),1000);
  await(await f.c.connect(f.signers[2]).submitEvidence(0,evidenceHash)).wait();
  const response=await request(3,'read');assert.equal(response.status,200);assert.deepEqual((await response.json()).envelope,envelope);
}));

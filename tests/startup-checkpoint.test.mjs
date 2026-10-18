import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {WorkflowChain} from '../src/workflows.js';
import {ensureDemoScenarios} from '../src/demo-scenarios.js';
import {validCheckpoint,loadStartupCheckpoint} from '../src/chain-checkpoint.js';
import artifacts from '../artifacts/contracts.json' with {type:'json'};
const fixture=()=>JSON.parse(fs.readFileSync('public/assets/demo-chain.json','utf8'));
test('prepared blockchain restores real contract state, receipts and mutable rules without replaying its journal',async()=>{
 const store=new Map();globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};globalThis.window={Ganache:ganache};
 let chain=new WorkflowChain(()=>{});
 try{
 const data=fixture(),count=data.record.rpc.length;assert.equal(validCheckpoint(data,artifacts),true);
 const t=performance.now();await chain.init({skipSeed:true,checkpoint:data});await ensureDemoScenarios(chain);console.log(`Prepared startup: ${Math.round(performance.now()-t)} ms; ${count} historical requests not replayed.`);
 assert.equal(chain.record.rpc.length,count);assert.equal(chain.campaigns.length,12);assert.equal(chain.audit.filter(e=>e.name==='Donated').length,29);assert.equal(chain.feeReserves.total,97.92);
 assert.equal(chain.campaigns.reduce((s,c)=>s+c.raised,0),9792);assert.equal(chain.campaigns.reduce((s,c)=>s+c.released,0),2500);
 const gift=chain.audit.find(e=>e.name==='Donated');const proof=await chain.transaction(gift.hash);assert.equal(proof.status,1);assert.equal(proof.hash,gift.hash);
 const ready=chain.campaigns.find(c=>c.scenarioKey==='ready');await chain.release(ready.address,0);await assert.rejects(chain.release(ready.address,0));
 const receipt=chain.audit.find(e=>e.name==='FeeCharged');assert.ok(receipt);
 const changed=chain.record.rpc.length;await chain.ganache.disconnect();chain=new WorkflowChain(()=>{});await chain.init({skipSeed:true,checkpoint:data});assert.equal(chain.record.rpc.length,changed);assert.equal(chain.campaigns.find(c=>c.address===ready.address).released,1500,'existing modified journal takes precedence');
 }finally{await chain.ganache?.disconnect();delete globalThis.localStorage;delete globalThis.window;}
});
test('checkpoint loading preserves existing workspaces and falls back for missing or corrupt downloads',async()=>{
 let requests=0;const args={key:'journal',artifacts,storage:{getItem:()=> 'existing'},fetcher:async()=>{requests++;throw Error('network');}};
 assert.equal(await loadStartupCheckpoint(args),null);assert.equal(requests,0);
 args.storage={getItem:()=>null};assert.equal(await loadStartupCheckpoint(args),null);assert.equal(requests,1);
 const bad=fixture();bad.record.genesis++;assert.equal(validCheckpoint(bad,artifacts),false);
 args.fetcher=async()=>({ok:true,json:async()=>bad});assert.equal(await loadStartupCheckpoint(args),null);
 args.fetcher=async()=>({ok:false});assert.equal(await loadStartupCheckpoint(args),null);
});

import fs from 'node:fs';
import ganache from 'ganache';
import artifacts from '../artifacts/contracts.json' with {type:'json'};
import {WorkflowChain} from '../src/workflows.js';
import {ensureDemoScenarios} from '../src/demo-scenarios.js';
import {checkpointHash,validCheckpoint,checkpointDatabase,databaseEntries} from '../src/chain-checkpoint.js';
export async function ensureStartupCheckpoint(){
 const path='public/assets/demo-chain.json';
 try{if(validCheckpoint(JSON.parse(fs.readFileSync(path,'utf8')),artifacts))return;}catch{}
 const oldStorage=globalThis.localStorage,oldWindow=globalThis.window,store=new Map();
 globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};globalThis.window={Ganache:ganache};
 const chain=new WorkflowChain(()=>{});
 try{
 const database=await checkpointDatabase();await chain.init({skipSeed:true,database});await ensureDemoScenarios(chain);
 const record=structuredClone(chain.record),entries=await databaseEntries(database);
 const data={version:1,artifactsHash:checkpointHash(artifacts),record,entries,stateHash:checkpointHash({record,entries})};
 fs.mkdirSync('public/assets',{recursive:true});fs.writeFileSync(path,JSON.stringify(data));console.log('Prepared local blockchain checkpoint generated.');
 }finally{await chain.ganache?.disconnect();if(oldStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=oldStorage;if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;}
}

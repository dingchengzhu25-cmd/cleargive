import memdown from 'memdown';
import {Buffer} from 'buffer';
import {keccak256,toUtf8Bytes} from 'ethers';
export const checkpointHash=value=>keccak256(toUtf8Bytes(JSON.stringify(value)));
export function validCheckpoint(data,artifacts){
 return data?.version===1&&data.artifactsHash===checkpointHash(artifacts)&&data.record?.scenarioLibrary?.complete===true&&Array.isArray(data.entries)&&data.entries.length>0&&data.stateHash===checkpointHash({record:data.record,entries:data.entries});
}
export async function checkpointDatabase(entries=[]){
 const db=memdown();
 await new Promise((resolve,reject)=>db.open(error=>error?reject(error):resolve()));
 if(entries.length)await new Promise((resolve,reject)=>db.batch(entries.map(([key,value])=>({type:'put',key:Buffer.from(key,'hex'),value:Buffer.from(value,'hex')})),error=>error?reject(error):resolve()));
 return db;
}
export async function databaseEntries(db){
 const iterator=db.iterator({keyAsBuffer:true,valueAsBuffer:true}),entries=[];
 try{while(true){const pair=await new Promise((resolve,reject)=>iterator.next((error,key,value)=>error?reject(error):resolve([key,value])));if(pair[0]===undefined)break;entries.push(pair.map(v=>Buffer.from(v).toString('hex')));}}
 finally{await new Promise((resolve,reject)=>iterator.end(error=>error?reject(error):resolve()));}
 return entries;
}
export async function loadStartupCheckpoint({storage,key,artifacts,fetcher=globalThis.fetch?.bind(globalThis)}={}){
 // Existing personal and shared journals always take precedence over the prepared examples.
 if(storage.getItem(key)||!fetcher)return null;
 try{const response=await fetcher('/assets/demo-chain.json',{signal:AbortSignal.timeout(8000)});if(!response.ok)return null;const data=await response.json();return validCheckpoint(data,artifacts)?data:null;}catch{return null;}
}

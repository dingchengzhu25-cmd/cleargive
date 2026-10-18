import {test} from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {Chain,identities} from '../src/chain.js';

test('custom sandbox wallets conserve campaign funds through balance edits, supplier payment, refunds and reload',async()=>{
 const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};globalThis.window={Ganache:ganache};
 const c=new Chain(()=>{});await c.init();let closed=false;
 try{
  const donor=await c.createAccount('Jamie Test','personal',200),owner=await c.createAccount('Test Foundation','business',0),supplier=await c.createAccount('Test Books','business',0);
  assert.equal(c.balances[donor],200);assert.equal(c.balances[supplier],0);
  const address=await c.create({title:'A community reading corner',description:'Fictional books and shelves for a shared community space.',fundingDays:1,deliveryDays:1,milestones:[{title:'Books',supplier:c.accounts[supplier],amount:50},{title:'Shelves',supplier:c.accounts[supplier],amount:50}]},owner);
  await c.donate(address,donor,100);await c.refresh();assert.equal(c.balances[donor],99);
  await c.setBalance(donor,300);await c.refresh();assert.equal(c.balances[donor],300);assert.equal((await c.token.balanceOf(address)).toString(),'100000000');
  await c.setBalance(donor,80);await c.refresh();assert.equal(c.balances[donor],80);assert.equal((await c.token.balanceOf(address)).toString(),'100000000');
  await assert.rejects(()=>c.release(address,0,owner));
  await c.submit(address,0,{name:'Fictional book quote',note:'Five sample books at ten test units each.'},owner);await c.review(address,0,3,true);await assert.rejects(()=>c.release(address,0,owner));await c.review(address,0,4,true);await c.release(address,0,owner);await c.refresh();
  assert.equal(c.balances[supplier],50);assert.equal(c.balances[owner],0);await assert.rejects(()=>c.release(address,0,owner));
  await c.advanceToRefund(address);await c.claim(address,donor);await c.refresh();assert.equal(c.balances[donor],130);assert.equal((await c.token.balanceOf(address)).toString(),'0');
  assert.ok(c.walletHistory.some(t=>t.from.toLowerCase()===c.accounts[donor].toLowerCase()&&t.to.toLowerCase()===address.toLowerCase()&&t.amount===100));
  const balances=[...c.balances],profileNames=identities.map(i=>i.name),walletHistory=JSON.stringify(c.walletHistory);await c.ganache.disconnect();closed=true;
  const restored=new Chain(()=>{});await restored.init();try{assert.deepEqual(restored.balances,balances);assert.deepEqual(identities.map(i=>i.name),profileNames);assert.equal(JSON.stringify(restored.walletHistory),walletHistory);}finally{await restored.ganache.disconnect();}
 }finally{if(!closed)await c.ganache.disconnect();delete globalThis.window;delete globalThis.localStorage;}
});

test('sandbox rejects invalid account types and balances before creating tokens or profiles',async()=>{
 const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};globalThis.window={Ganache:ganache};const c=new Chain(()=>{});await c.init();
 try{const count=identities.length;for(const value of [-1,Infinity,NaN,1000001,.001])await assert.rejects(()=>c.createAccount('Test','personal',value));await assert.rejects(()=>c.createAccount('Test','bank',100));assert.equal(identities.length,count);const before=c.balances[0];await assert.rejects(()=>c.setBalance(0,-10));await c.refresh();assert.equal(c.balances[0],before);}finally{await c.ganache.disconnect();delete globalThis.window;delete globalThis.localStorage;}
});

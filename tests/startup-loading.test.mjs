import test from 'node:test';
import assert from 'node:assert/strict';
import {SharedUI} from '../src/shared-ui.js';
test('unavailable optional classroom status never blocks personal startup and updates availability after readiness',{timeout:1000},async()=>{
 let done,renders=0;const pending=new Promise(resolve=>{done=resolve;});
 const ui=new SharedUI({isBusy:()=>false,render:()=>{renders++;},modalOpen:()=>false});ui.client={connected:false,status:()=>pending};
 try{await ui.prepare();assert.equal(ui.ready,null);assert.equal(renders,0);ui.startPolling();done({ready:true});await ui.statusPromise;assert.equal(ui.ready,true);assert.equal(renders,1);}finally{ui.stopPolling();}
});
test('classroom status failure leaves personal workspace available',{timeout:1000},async()=>{
 const ui=new SharedUI({isBusy:()=>false,render:()=>{},modalOpen:()=>false});ui.client={connected:false,status:async()=>{throw Error('offline');}};
 await ui.prepare();await ui.statusPromise;assert.equal(ui.ready,false);
});

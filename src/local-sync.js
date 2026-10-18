// One local journal across tabs. Shared classrooms retain their server lease.
export class LocalSync{
 constructor({locks,read,current,restore,isShared=()=>false,onChange=()=>{}}){Object.assign(this,{locks,read,current,restore,isShared,onChange});this.release=null;this.scheduled=false;}
 async reconcile(){const latest=this.read();if(latest&&latest!==this.current()){await this.restore();this.onChange();}}
 async acquire(){if(this.isShared())return;if(this.locks){await new Promise((ready,reject)=>{this.locks.request('cleargive-local-journal',async()=>{await new Promise(release=>{this.release=release;ready();});}).catch(reject);});}try{await this.reconcile();}catch(error){this.finish();throw error;}}
 finish(){if(this.release){const release=this.release;this.release=null;release();}}
 async changed(){if(this.isShared()||this.scheduled)return;this.scheduled=true;try{if(this.locks)await this.locks.request('cleargive-local-journal',()=>this.reconcile());else await this.reconcile();}finally{this.scheduled=false;}}
}

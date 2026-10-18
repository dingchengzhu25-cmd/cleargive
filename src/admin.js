// Public presentation mode for fictional demo funds. No authentication required.
export const ADMIN_ACTIONS=new Set(['presenter-select','account','balance','fund','switch-reviewer','scenario-open','run-tour','refund-tour-confirm','refund-tour-run','reset','confirm-reset','examples-confirm','examples-rebuild','example-donor']);
export const ADMIN_FORMS=new Set(['balance-form','scenario-form']);
export class PresenterMode{
 constructor({enabled=false}={}){this.enabled=enabled;}
 get unlocked(){return this.enabled;}
 open(){this.enabled=true;}
 close(){this.enabled=false;}
 require(){if(!this.enabled)throw new Error('Open Demo controls to adjust balances or run presenter actions. No password is needed.');}
}

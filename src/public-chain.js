import { BrowserProvider, JsonRpcProvider, Contract, ContractFactory, parseUnits, formatUnits, keccak256, toUtf8Bytes, ZeroHash, isAddress } from 'ethers';
import artifacts from '../artifacts/contracts.json' with { type: 'json' };
export const NETWORKS={
  11155111:{name:'Sepolia',explorer:'https://sepolia.etherscan.io',rpc:'https://ethereum-sepolia-rpc.publicnode.com',test:true},
  1:{name:'Ethereum',explorer:'https://etherscan.io',rpc:'https://ethereum-rpc.publicnode.com',test:false},
};
export const XSGD='0x70e8de73ce538da2beed35d14187f6959a8eca96';
export const amount=value=>parseUnits(String(value),6);
export const numeric=value=>Number(formatUnits(value,6));
export const hash=value=>keccak256(toUtf8Bytes(JSON.stringify(value)));
export const same=(a,b)=>a?.toLowerCase()===b?.toLowerCase();
export const short=value=>value?`${value.slice(0,6)}…${value.slice(-4)}`:'Not connected';
export class PublicChain {
  constructor(config, injected=null) {
    this.config=config;this.network=NETWORKS[config.chainId];if(!this.network&&config.chainId!==1337)throw new Error('Unsupported network');
    this.injected=injected;this.provider=null;this.signer=null;this.account=null;this.campaigns=[];this.events=[];this.balances=0;
  }
  async init(){
    this.provider=new JsonRpcProvider(this.config.rpcUrl,undefined,{cacheTimeout:-1});
    if(this.config.factoryAddress)await this.attach(this.config.factoryAddress);
  }
  async connect(){
    const injected=this.injected||window.ethereum;if(!injected)throw new Error('Install a compatible Ethereum wallet, then open ClearGive in that browser. Never enter a private key here.');
    const chainId=Number(await injected.request({method:'eth_chainId'}));
    if(chainId!==Number(this.config.chainId)){
      try{await injected.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x'+Number(this.config.chainId).toString(16)}]});}
      catch{throw new Error(`Switch your wallet to ${this.network?.name||'the selected network'} and try again.`);}
    }
    await injected.request({method:'eth_requestAccounts'});
    this.walletProvider=new BrowserProvider(injected,undefined,{cacheTimeout:-1});
    this.walletProvider.pollingInterval=300;
    this.signer=await this.walletProvider.getSigner();this.account=await this.signer.getAddress();
    this.provider=this.walletProvider;
    if(this.config.factoryAddress)await this.attach(this.config.factoryAddress);
    return this.account;
  }
  async assertWrite(){
    if(!this.signer)throw new Error('Connect your own wallet first.');
    const id=Number((await this.walletProvider.getNetwork()).chainId);
    if(id!==Number(this.config.chainId))throw new Error('Wallet network changed. Reconnect on the selected network.');
    if(id===1&&!this.config.allowMainnetTransactions)throw new Error('Mainnet writes are disabled in this release. Complete security review and payment-provider setup before enabling real funds.');
  }
  async attach(address){
    if(!isAddress(address))throw new Error('Enter a valid factory contract address.');
    const net=await this.provider.getNetwork();if(Number(net.chainId)!==Number(this.config.chainId))throw new Error('RPC network does not match configuration.');
    if(await this.provider.getCode(address)==='0x')throw new Error('No deployed contract exists at this address on the selected network.');
    const factory=new Contract(address,artifacts.XSGDFactory.abi,this.provider);
    const tokenAddress=await factory.token();
    if(Number(net.chainId)===1&&!same(tokenAddress,XSGD))throw new Error('This factory does not use official Ethereum XSGD.');
    this.factory=factory;this.config.factoryAddress=address;this.token=new Contract(tokenAddress,artifacts.TestSGD.abi,this.provider);
    this.tokenAddress=tokenAddress;this.gateway=await factory.gateway();this.startBlock=Number(await factory.deploymentBlock());
    await this.refresh();
  }
  campaign(address,write=false){return new Contract(address,artifacts.XSGDCampaign.abi,write?this.signer:this.provider);}
  async deployTest(gateway){
    await this.assertWrite();if(Number(this.config.chainId)===1)throw new Error('Test deployment cannot run on Ethereum mainnet.');
    if(!isAddress(gateway))throw new Error('Enter the public payment-operator wallet address.');
    const token=await new ContractFactory(artifacts.TestSGD.abi,artifacts.TestSGD.bytecode,this.signer).deploy();await token.waitForDeployment();
    const factory=await new ContractFactory(artifacts.XSGDFactory.abi,artifacts.XSGDFactory.bytecode,this.signer).deploy(await token.getAddress(),gateway);await factory.waitForDeployment();
    await this.attach(await factory.getAddress());return this.config.factoryAddress;
  }
  async mintTest(){
    await this.assertWrite();if(Number(this.config.chainId)===1)throw new Error('No mainnet faucet exists.');
    if(await this.token.symbol()!=='TESTSGD')throw new Error('Faucet works only with ClearGive’s explicitly labelled test token.');
    await(await this.token.connect(this.signer).mint(this.account,amount(10000))).wait();await this.refresh();
  }
  async deployMainnet(gateway){
    await this.assertWrite();
    if(Number(this.config.chainId)!==1||!isAddress(gateway))throw new Error('Ethereum mainnet and a valid operator address are required.');
    const factory=await new ContractFactory(artifacts.XSGDFactory.abi,artifacts.XSGDFactory.bytecode,this.signer).deploy(XSGD,gateway);
    await factory.waitForDeployment();await this.attach(await factory.getAddress());return this.config.factoryAddress;
  }
  async now(){return Number((await this.provider.getBlock('latest')).timestamp);}
  async create(input){
    await this.assertWrite();if(!this.factory)throw new Error('Configure or deploy the shared platform contract first.');
    const now=await this.now();
    const metadata=JSON.stringify({version:2,description:input.description,category:input.category,location:input.location,image:input.image||'school'});
    const tx=await this.factory.connect(this.signer).createCampaign(input.reviewers,input.title,now+input.fundingDays*86400,now+(input.fundingDays+input.deliveryDays)*86400,input.milestones.map(m=>m.title),input.milestones.map(m=>m.supplier),input.milestones.map(m=>amount(m.amount)),metadata);
    const receipt=await tx.wait();
    const created=receipt.logs.map(l=>{try{return this.factory.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='CampaignCreated');
    await this.refresh();return created.args.campaign;
  }
  async donate(address,value){await this.assertWrite();await(await this.token.connect(this.signer).approve(address,amount(value))).wait();return this.send(this.campaign(address,true).donate(amount(value)));}
  async depositFiat(address,donorRef,paymentRef,value){await this.assertWrite();if(!same(this.account,this.gateway))throw new Error('Only the configured payment operator can settle fiat deposits.');await(await this.token.connect(this.signer).approve(address,amount(value))).wait();return this.send(this.campaign(address,true).depositFiat(donorRef,paymentRef,amount(value)));}
  async submit(address,id,evidenceHash){await this.assertWrite();return this.send(this.campaign(address,true).submitEvidence(id,evidenceHash));}
  async review(address,id,approve,reason=ZeroHash){await this.assertWrite();const c=this.campaign(address,true);const m=await c.getMilestone(id);return this.send(c.review(id,m.revision,m.evidenceHash,approve,reason));}
  async release(address,id){await this.assertWrite();return this.send(this.campaign(address,true).release(id));}
  async refund(address,ref){await this.assertWrite();const c=this.campaign(address,true);return this.send(c.claimRefund(ref||await c.walletRef(this.account)));}
  async send(tx){const receipt=await(await tx).wait();await this.refresh();return receipt;}
  async refresh(){
    if(!this.factory)return;
    const count=Number(await this.factory.campaignCount());if(count>250)throw new Error('This deployment needs an indexer before displaying more than 250 campaigns.');
    const all=[];
    for(let i=0;i<count;i++){
      const address=await this.factory.campaigns(i),c=this.campaign(address);
      const [title,meta,target,raised,released,status,organiser,r1,r2,n,funding,delivery,terms,pool,refundPaid]=await Promise.all([c.title(),c.metadata(),c.getFunction('target')(),c.raised(),c.released(),c.status(),c.organiser(),c.reviewer1(),c.reviewer2(),c.milestoneCount(),c.fundingDeadline(),c.deliveryDeadline(),c.termsHash(),c.refundPool(),c.refundPaid()]);
      let metadata={};try{metadata=JSON.parse(meta);}catch{}
      const milestones=[];for(let j=0;j<Number(n);j++){const m=await c.getMilestone(j);milestones.push({id:j,title:m.title,supplier:m.supplier,amount:numeric(m.amount),evidenceHash:m.evidenceHash,revision:Number(m.revision),approvals:Number(m.approvals),rejected:m.rejected,paid:m.paid});}
      let contribution=0,refunded=false;if(this.account){const ref=await c.walletRef(this.account);contribution=numeric(await c.contributions(ref));refunded=await c.refunded(ref);}
      all.push({...metadata,address,title,target:numeric(target),raised:numeric(raised),released:numeric(released),status:['Funding','Active','Completed','Refunds'][Number(status)],organiser,reviewers:[r1,r2],milestones,fundingDeadline:Number(funding),deliveryDeadline:Number(delivery),termsHash:terms,refundPool:numeric(pool),refundPaid:numeric(refundPaid),contribution,refunded});
    }
    this.campaigns=all;
    this.balance=this.account?numeric(await this.token.balanceOf(this.account)):0;
    const addresses=[this.config.factoryAddress,...all.map(c=>c.address)];
    const latest=await this.provider.getBlockNumber();const logs=[];
    for(let block=this.startBlock;block<=latest;block+=2000)logs.push(...await this.provider.getLogs({address:addresses,fromBlock:block,toBlock:Math.min(block+1999,latest)}));
    this.events=logs.map(l=>{try{const isFactory=same(l.address,this.config.factoryAddress);const parsed=(isFactory?this.factory:this.campaign(l.address)).interface.parseLog(l);if(!parsed)return null;const args=Object.fromEntries(parsed.fragment.inputs.map((v,i)=>[v.name,typeof parsed.args[i]==='bigint'?parsed.args[i].toString():parsed.args[i]]));return{name:parsed.name,args,block:l.blockNumber,hash:l.transactionHash,address:l.address,index:l.index};}catch{return null;}}).filter(Boolean).sort((a,b)=>b.block-a.block||b.index-a.index);
  }
  async proof(address,evidenceHash,action,payloadHash=''){
    await this.assertWrite();const expires=Math.floor(Date.now()/1000)+120;
    const message=`ClearGive evidence access\nOrigin: ${location.origin}\nChain: ${this.config.chainId}\nFactory: ${this.config.factoryAddress.toLowerCase()}\nCampaign: ${address.toLowerCase()}\nEvidence: ${evidenceHash}\nAction: ${action}\nPayload: ${payloadHash}\nExpires: ${expires}`;
    return{message,signature:await this.signer.signMessage(message),expires};
  }
}

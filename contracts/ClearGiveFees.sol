// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {ClearGiveCampaign} from "./ClearGive.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface ICreditCampaign {
    function organiser() external view returns(address);
    function reviewer1() external view returns(address);
    function reviewer2() external view returns(address);
    function isSupplier(address account) external view returns(bool);
}
/// @notice Virtual operations reserves and non-transferable, donation-only reviewer credits.
contract ClearGiveFeeVault {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
    address public immutable factory;
    mapping(address => bool) public campaigns;
    mapping(address => uint256) public campaignReviewerReserve;
    mapping(address => bool) public campaignAwarded;
    mapping(address => uint256) public creditBalance;
    uint256 public totalFees;
    uint256 public operationsReserve;
    uint256 public reviewerReserve;
    uint256 public totalCreditsAwarded;
    uint256 public totalCreditsSpent;
    uint256 public totalCreditsRestored;
    uint256 public outstandingCredits;
    event FeeAllocated(address indexed campaign,address indexed donor,uint256 fee,uint256 operations,uint256 reviewerCredits);
    event ReviewerCreditsAwarded(address indexed campaign,address indexed reviewer,uint256 amount);
    event ReviewerCreditsSpent(address indexed campaign,address indexed reviewer,uint256 donation,uint256 fee,uint256 total);
    event ReviewerCreditsRestored(address indexed campaign,address indexed reviewer,uint256 amount);
    constructor(address token_) { token=IERC20(token_);factory=msg.sender; }
    modifier onlyCampaign(){require(campaigns[msg.sender],"Campaign only");_;}
    function register(address campaign) external {require(msg.sender==factory,"Factory only");campaigns[campaign]=true;}
    function accountedBalance() public view returns(uint256){return totalFees+totalCreditsRestored-totalCreditsSpent;}
    function unawardedReviewerReserve() public view returns(uint256){return reviewerReserve-totalCreditsAwarded;}
    function allocate(address donor,uint256 fee) external onlyCampaign {
        require(token.balanceOf(address(this))>=accountedBalance()+fee,"Fee not received");_allocate(donor,fee);
    }
    function _allocate(address donor,uint256 fee) private {
        uint256 operations=fee*60/100;
        totalFees+=fee;operationsReserve+=operations;reviewerReserve+=fee-operations;
        campaignReviewerReserve[msg.sender]+=fee-operations;
        emit FeeAllocated(msg.sender,donor,fee,operations,fee-operations);
    }
    function awardReviewers() external onlyCampaign {
        require(!campaignAwarded[msg.sender],"Already awarded");campaignAwarded[msg.sender]=true;
        uint256 reserve=campaignReviewerReserve[msg.sender];uint256 half=reserve/2;
        address r1=ICreditCampaign(msg.sender).reviewer1();address r2=ICreditCampaign(msg.sender).reviewer2();
        creditBalance[r1]+=half;creditBalance[r2]+=reserve-half;
        totalCreditsAwarded+=reserve;outstandingCredits+=reserve;
        emit ReviewerCreditsAwarded(msg.sender,r1,half);emit ReviewerCreditsAwarded(msg.sender,r2,reserve-half);
    }
    function spend(address donor,uint256 amount,uint256 fee) external onlyCampaign {
        ICreditCampaign c=ICreditCampaign(msg.sender);
        require(donor!=c.organiser()&&donor!=c.reviewer1()&&donor!=c.reviewer2()&&!c.isSupplier(donor),"Unrelated campaigns only");
        uint256 total=amount+fee;require(creditBalance[donor]>=total,"Insufficient donation credits");
        creditBalance[donor]-=total;outstandingCredits-=total;totalCreditsSpent+=total;
        token.safeTransfer(msg.sender,amount);_allocate(donor,fee);
        emit ReviewerCreditsSpent(msg.sender,donor,amount,fee,total);
    }
    function restore(address donor,uint256 amount) external onlyCampaign {
        require(token.balanceOf(address(this))>=accountedBalance()+amount,"Refund not received");
        creditBalance[donor]+=amount;outstandingCredits+=amount;totalCreditsRestored+=amount;
        emit ReviewerCreditsRestored(msg.sender,donor,amount);
    }
}
contract ClearGiveFeeCampaign is ClearGiveCampaign {
    using SafeERC20 for IERC20;
    ClearGiveFeeVault public immutable feeVault;
    uint256 public constant feeBps=100;
    uint256 public constant rewardVersion=1;
    uint256 public feesCollected;
    uint8 public rewardReviewMask;
    mapping(uint256=>mapping(uint32=>uint8)) public reviewParticipation;
    mapping(address=>uint256) public creditContributions;
    event FeeCharged(address indexed donor,uint256 donation,uint256 fee,uint256 total,address indexed vault);
    event CreditRefunded(address indexed donor,uint256 credits,uint256 wallet);
    constructor(address token_,address vault_,address organiser_,address[2] memory reviewers_,string memory title_,uint256 funding_,uint256 delivery_,bytes32 terms_,string[] memory titles_,address[] memory suppliers_,uint256[] memory amounts_)
        ClearGiveCampaign(token_,organiser_,reviewers_,title_,funding_,delivery_,terms_,titles_,suppliers_,amounts_){feeVault=ClearGiveFeeVault(vault_);}
    function isSupplier(address account) external view returns(bool){for(uint256 i;i<this.milestoneCount();++i)if(this.getMilestone(i).supplier==account)return true;return false;}
    function feeFor(uint256 amount) public pure returns(uint256){return ((amount/100+5000)/10000)*10000;}
    function _contribute(uint256 amount) private returns(uint256 fee){
        require(status()==Status.Funding,"Funding closed");require(amount>0&&raised+amount<=target,"Invalid donation amount");
        if(contributions[msg.sender]==0)donorCount++;
        contributions[msg.sender]+=amount;raised+=amount;fee=feeFor(amount);feesCollected+=fee;
    }
    function _events(uint256 amount,uint256 fee) private{emit Donated(msg.sender,amount,raised);emit FeeCharged(msg.sender,amount,fee,amount+fee,address(feeVault));}
    function donate(uint256 amount) public override nonReentrant {
        uint256 fee=_contribute(amount);token.safeTransferFrom(msg.sender,address(this),amount);
        if(fee>0){token.safeTransferFrom(msg.sender,address(feeVault),fee);feeVault.allocate(msg.sender,fee);}_events(amount,fee);
    }
    function donateCredits(uint256 amount) external nonReentrant {
        uint256 fee=_contribute(amount);creditContributions[msg.sender]+=amount;
        feeVault.spend(msg.sender,amount,fee);_events(amount,fee);
    }
    function review(uint256 id,uint32 revision,bytes32 hash,bool approve,bytes32 reasonHash) public override {
        uint8 bit=msg.sender==reviewer1?1:msg.sender==reviewer2?2:0;
        require(bit!=0,"Reviewer only");require((reviewParticipation[id][revision]&bit)==0,"Already reviewed revision");
        Milestone memory m=this.getMilestone(id);
        if(m.rejected){
            require(status()==Status.Active&&!m.paid,"Campaign not active");require(m.revision==revision&&m.evidenceHash==hash&&hash!=bytes32(0),"Evidence changed");
            require(approve||reasonHash!=bytes32(0),"Rejection reason required");
            // Records the second review without reviving a rejected invoice or permitting payment.
            emit Reviewed(id,msg.sender,revision,approve,reasonHash);
        }else{super.review(id,revision,hash,approve,reasonHash);}
        reviewParticipation[id][revision]|=bit;rewardReviewMask|=bit;
        if(rewardReviewMask==3&&!feeVault.campaignAwarded(address(this)))feeVault.awardReviewers();
    }
    function claimRefund() public override nonReentrant {
        if(!refundsOpened)openRefunds();uint256 contribution=contributions[msg.sender];
        require(contribution>0&&!refunded[msg.sender],"No refund available");refunded[msg.sender]=true;claims++;
        uint256 amount=claims==donorCount?refundPool-refundPaid:Math.mulDiv(refundPool,contribution,raised);refundPaid+=amount;
        uint256 cash=Math.mulDiv(amount,contribution-creditContributions[msg.sender],contribution);uint256 credits=amount-cash;
        if(cash>0)token.safeTransfer(msg.sender,cash);
        if(credits>0){token.safeTransfer(address(feeVault),credits);feeVault.restore(msg.sender,credits);emit CreditRefunded(msg.sender,credits,cash);}
        emit Refunded(msg.sender,amount);
    }
}
contract ClearGiveFeeFactory {
    address public immutable token;
    ClearGiveFeeVault public immutable feeVault;
    uint256 public constant rewardVersion=1;
    address[] public campaigns;
    event CampaignCreated(address indexed campaign,address indexed organiser,string title);
    constructor(address token_){require(token_!=address(0),"Invalid token");token=token_;feeVault=new ClearGiveFeeVault(token_);}
    function campaignCount() external view returns(uint256){return campaigns.length;}
    function createCampaign(address[2] calldata reviewers,string calldata title,uint256 fundingDeadline,uint256 deliveryDeadline,bytes32 termsHash,string[] calldata milestoneTitles,address[] calldata suppliers,uint256[] calldata amounts) external returns(address){
        ClearGiveFeeCampaign campaign=new ClearGiveFeeCampaign(token,address(feeVault),msg.sender,reviewers,title,fundingDeadline,deliveryDeadline,termsHash,milestoneTitles,suppliers,amounts);
        address addr=address(campaign);campaigns.push(addr);feeVault.register(addr);emit CampaignCreated(addr,msg.sender,title);return addr;
    }
}

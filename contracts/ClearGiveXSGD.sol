// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @notice Valueless test currency, NOT issued by StraitsX. Mainnet deployment forbidden.
contract TestSGD is ERC20 {
    constructor() ERC20("ClearGive Test SGD - NOT XSGD", "TESTSGD") { require(block.chainid != 1, "Test currency only"); }
    function decimals() public pure override returns(uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to,amount); }
}
interface IXSGDRegistry { function consumePayment(bytes32 ref) external; }
contract XSGDCampaign is ReentrancyGuard {
    using SafeERC20 for IERC20;
    enum Status { Funding, Active, Completed, Refunds }
    struct Milestone {
        string title;
        address supplier;
        uint256 amount;
        bytes32 evidenceHash;
        uint32 revision;
        uint8 approvals;
        bool rejected;
        bool paid;
    }
    IERC20 public immutable token;
    address public immutable organiser;
    address public immutable reviewer1;
    address public immutable reviewer2;
    uint256 public immutable target;
    uint256 public immutable fundingDeadline;
    uint256 public immutable deliveryDeadline;
    bytes32 public immutable termsHash;
    string public title;
    Milestone[] private milestones;
    uint256 public raised;
    uint256 public released;
    uint256 public donorCount;
    mapping(bytes32 => uint256) public contributions;
    mapping(bytes32 => address) public refundRecipients;
    address public immutable gateway;
    address public immutable registry;
    string public metadata;
    mapping(bytes32 => bool) public refunded;
    bool public refundsOpened;
    uint256 public refundPool;
    uint256 public refundPaid;
    uint256 public claims;

    event Donated(bytes32 indexed donorRef, address indexed refundTo, uint256 amount, bytes32 indexed paymentRef);
    event EvidenceSubmitted(uint256 indexed milestone, uint32 revision, bytes32 evidenceHash);
    event Reviewed(uint256 indexed milestone, address indexed reviewer, uint32 revision, bool approved, bytes32 reasonHash);
    event SupplierPaid(uint256 indexed milestone, address indexed supplier, uint256 amount, bytes32 evidenceHash);
    event RefundsOpened(uint256 pool);
    event Refunded(bytes32 indexed donorRef, address indexed refundTo, uint256 amount);

    constructor(
        address token_, address organiser_, address[2] memory reviewers_,
        string memory title_, uint256 fundingDeadline_, uint256 deliveryDeadline_,
        bytes32 termsHash_, string[] memory milestoneTitles_,
        address[] memory suppliers_, uint256[] memory amounts_, address gateway_, string memory metadata_
    ) {
        require(token_ != address(0) && organiser_ != address(0), "Invalid address");
        require(reviewers_[0] != address(0) && reviewers_[1] != address(0), "Invalid reviewers");
        require(reviewers_[0] != reviewers_[1] && reviewers_[0] != organiser_ && reviewers_[1] != organiser_, "Independent reviewers required");
        require(fundingDeadline_ > block.timestamp && deliveryDeadline_ > fundingDeadline_, "Invalid deadlines");
        require(bytes(title_).length > 0 && bytes(title_).length <= 160 && termsHash_ != bytes32(0), "Invalid terms");
        uint256 length = amounts_.length;
        require(length > 0 && length <= 12 && suppliers_.length == length && milestoneTitles_.length == length, "Invalid milestones");
        uint256 total;
        for (uint256 i; i < length; ++i) {
            address supplier = suppliers_[i];
            require(supplier != address(0) && supplier != address(this) && supplier != organiser_ && supplier != reviewers_[0] && supplier != reviewers_[1], "Independent supplier required");
            require(amounts_[i] > 0 && bytes(milestoneTitles_[i]).length > 0, "Invalid milestone");
            total += amounts_[i];
            milestones.push(Milestone(milestoneTitles_[i], supplier, amounts_[i], bytes32(0), 0, 0, false, false));
        }
        require(gateway_ != address(0) && reviewers_[0] != gateway_ && reviewers_[1] != gateway_, "Independent gateway required");
        require(bytes(metadata_).length <= 8192, "Metadata too large");
        gateway = gateway_; registry = msg.sender; metadata = metadata_;
        token = IERC20(token_); organiser = organiser_;
        reviewer1 = reviewers_[0]; reviewer2 = reviewers_[1];
        title = title_; target = total;
        termsHash = keccak256(abi.encode(token_, organiser_, gateway_, reviewers_, title_, fundingDeadline_, deliveryDeadline_, milestoneTitles_, suppliers_, amounts_, metadata_));
        fundingDeadline = fundingDeadline_; deliveryDeadline = deliveryDeadline_;
    }

    function status() public view returns (Status) {
        if (refundsOpened) return Status.Refunds;
        if (released == target) return Status.Completed;
        if (raised < target && block.timestamp > fundingDeadline) return Status.Refunds;
        if (block.timestamp > deliveryDeadline) return Status.Refunds;
        return raised == target ? Status.Active : Status.Funding;
    }
    function milestoneCount() external view returns (uint256) { return milestones.length; }
    function getMilestone(uint256 id) external view returns (Milestone memory) { return milestones[id]; }
    function walletRef(address donor) public pure returns(bytes32) { return keccak256(abi.encodePacked("wallet:", donor)); }
    function fiatRef(bytes32 donor) public pure returns(bytes32) { return keccak256(abi.encodePacked("fiat:", donor)); }
    function donate(uint256 amount) external nonReentrant { _deposit(walletRef(msg.sender), msg.sender, amount, bytes32(0)); }
    function depositFiat(bytes32 donorRef, bytes32 paymentRef, uint256 amount) external nonReentrant {
        require(msg.sender == gateway, "Gateway only");
        require(donorRef != 0 && paymentRef != 0, "Reference required");
        IXSGDRegistry(registry).consumePayment(paymentRef);
        _deposit(fiatRef(donorRef), gateway, amount, paymentRef);
    }
    function _deposit(bytes32 ref, address refundTo, uint256 amount, bytes32 paymentRef) private {
        require(status() == Status.Funding, "Funding closed");
        require(amount > 0 && raised + amount <= target, "Invalid donation amount");
        if (contributions[ref] == 0) { donorCount++; refundRecipients[ref] = refundTo; }
        else require(refundRecipients[ref] == refundTo, "Reference conflict");
        contributions[ref] += amount; raised += amount;
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        require(token.balanceOf(address(this)) - beforeBalance == amount, "Exact settlement required");
        emit Donated(ref, refundTo, amount, paymentRef);
    }
    function submitEvidence(uint256 id, bytes32 hash) external {
        require(msg.sender == organiser, "Organiser only");
        require(status() == Status.Active, "Campaign not active");
        Milestone storage m = milestones[id];
        require(!m.paid && hash != bytes32(0), "Invalid evidence");
        require(m.evidenceHash == bytes32(0) || m.rejected, "Reject before replacing evidence");
        m.evidenceHash = hash; m.revision++; m.approvals = 0; m.rejected = false;
        emit EvidenceSubmitted(id, m.revision, hash);
    }
    function review(uint256 id, uint32 revision, bytes32 hash, bool approve, bytes32 reasonHash) external {
        uint8 bit = msg.sender == reviewer1 ? 1 : msg.sender == reviewer2 ? 2 : 0;
        require(bit != 0, "Reviewer only");
        require(status() == Status.Active, "Campaign not active");
        Milestone storage m = milestones[id];
        require(!m.paid && !m.rejected && m.evidenceHash != bytes32(0), "Request not reviewable");
        require(m.revision == revision && m.evidenceHash == hash, "Evidence changed");
        if (approve) {
            require((m.approvals & bit) == 0, "Already approved");
            m.approvals |= bit;
        } else {
            require(reasonHash != bytes32(0), "Rejection reason required");
            m.rejected = true; m.approvals = 0;
        }
        emit Reviewed(id, msg.sender, revision, approve, reasonHash);
    }
    /// @notice Anyone can execute a fully approved payment; they cannot change its recipient or amount.
    function release(uint256 id) external nonReentrant {
        require(status() == Status.Active, "Campaign not active");
        Milestone storage m = milestones[id];
        require(!m.paid && !m.rejected && m.approvals == 3, "Two approvals required");
        m.paid = true; released += m.amount;
        token.safeTransfer(m.supplier, m.amount);
        emit SupplierPaid(id, m.supplier, m.amount, m.evidenceHash);
    }
    /// @notice Permissionless after immutable deadlines. Snapshot freezes all further payments.
    function openRefunds() public {
        require(!refundsOpened && status() == Status.Refunds, "Refunds not available");
        refundsOpened = true; refundPool = raised - released;
        emit RefundsOpened(refundPool);
    }
    function claimRefund(bytes32 ref) external nonReentrant {
        if (!refundsOpened) openRefunds();
        uint256 contribution = contributions[ref];
        require(contribution > 0 && !refunded[ref] && msg.sender == refundRecipients[ref], "No authorised refund");
        refunded[ref] = true; claims++;
        uint256 amount = claims == donorCount ? refundPool - refundPaid : Math.mulDiv(refundPool, contribution, raised);
        refundPaid += amount;
        token.safeTransfer(msg.sender, amount);
        emit Refunded(ref, msg.sender, amount);
    }
}


contract XSGDFactory {
    address public constant ETHEREUM_XSGD = address(bytes20(hex"70e8de73ce538da2beed35d14187f6959a8eca96"));
    address public immutable token;
    address public immutable gateway;
    uint256 public immutable deploymentBlock;
    address[] public campaigns;
    mapping(address=>bool) public isCampaign;
    mapping(bytes32=>bool) public paymentUsed;
    event CampaignCreated(address indexed campaign,address indexed organiser,string title);
    constructor(address token_,address gateway_) {
        require(token_!=address(0) && gateway_!=address(0),"Invalid configuration");
        require(block.chainid!=1 || token_==ETHEREUM_XSGD,"Official Ethereum XSGD required");
        require(IERC20Metadata(token_).decimals()==6,"Six decimals required");
        token=token_;gateway=gateway_;deploymentBlock=block.number;
    }
    function campaignCount() external view returns(uint256){ return campaigns.length; }
    function createCampaign(address[2] calldata reviewers,string calldata title,uint256 fundingDeadline,uint256 deliveryDeadline,string[] calldata milestoneTitles,address[] calldata suppliers,uint256[] calldata amounts,string calldata metadata) external returns(address) {
        XSGDCampaign c=new XSGDCampaign(token,msg.sender,reviewers,title,fundingDeadline,deliveryDeadline,keccak256(bytes(metadata)),milestoneTitles,suppliers,amounts,gateway,metadata);
        address a=address(c);campaigns.push(a);isCampaign[a]=true;emit CampaignCreated(a,msg.sender,title);return a;
    }
    function consumePayment(bytes32 ref) external {
        require(isCampaign[msg.sender] && ref!=0 && !paymentUsed[ref],"Payment used or caller unauthorised");paymentUsed[ref]=true;
    }
}

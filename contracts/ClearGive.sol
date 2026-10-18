// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Demonstration currency ONLY. Anyone can mint. Never use as real money.
contract DemoUSD is ERC20 {
    constructor() ERC20("ClearGive Demo Dollars", "CGUSD") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice Fixed-purpose escrow. No admin withdrawal or upgrade route.
/// @dev Supports the factory's fixed, standard ERC20 only (not fee-on-transfer tokens).
contract ClearGiveCampaign is ReentrancyGuard {
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
    mapping(address => uint256) public contributions;
    mapping(address => bool) public refunded;
    bool public refundsOpened;
    uint256 public refundPool;
    uint256 public refundPaid;
    uint256 public claims;

    event Donated(address indexed donor, uint256 amount, uint256 raised);
    event EvidenceSubmitted(uint256 indexed milestone, uint32 revision, bytes32 evidenceHash);
    event Reviewed(uint256 indexed milestone, address indexed reviewer, uint32 revision, bool approved, bytes32 reasonHash);
    event SupplierPaid(uint256 indexed milestone, address indexed supplier, uint256 amount, bytes32 evidenceHash);
    event RefundsOpened(uint256 pool);
    event Refunded(address indexed donor, uint256 amount);

    constructor(
        address token_, address organiser_, address[2] memory reviewers_,
        string memory title_, uint256 fundingDeadline_, uint256 deliveryDeadline_,
        bytes32 termsHash_, string[] memory milestoneTitles_,
        address[] memory suppliers_, uint256[] memory amounts_
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
        token = IERC20(token_); organiser = organiser_;
        reviewer1 = reviewers_[0]; reviewer2 = reviewers_[1];
        title = title_; target = total; termsHash = termsHash_;
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
    function donate(uint256 amount) public virtual nonReentrant {
        require(status() == Status.Funding, "Funding closed");
        require(amount > 0 && raised + amount <= target, "Invalid donation amount");
        if (contributions[msg.sender] == 0) donorCount++;
        contributions[msg.sender] += amount; raised += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Donated(msg.sender, amount, raised);
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
    function review(uint256 id, uint32 revision, bytes32 hash, bool approve, bytes32 reasonHash) public virtual {
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
    function claimRefund() public virtual nonReentrant {
        if (!refundsOpened) openRefunds();
        uint256 contribution = contributions[msg.sender];
        require(contribution > 0 && !refunded[msg.sender], "No refund available");
        refunded[msg.sender] = true; claims++;
        uint256 amount = claims == donorCount ? refundPool - refundPaid : Math.mulDiv(refundPool, contribution, raised);
        refundPaid += amount;
        token.safeTransfer(msg.sender, amount);
        emit Refunded(msg.sender, amount);
    }
}

contract ClearGiveFactory {
    address public immutable token;
    address[] public campaigns;
    event CampaignCreated(address indexed campaign, address indexed organiser, string title);
    constructor(address token_) { require(token_ != address(0), "Invalid token"); token = token_; }
    function campaignCount() external view returns (uint256) { return campaigns.length; }
    function createCampaign(
        address[2] calldata reviewers, string calldata title,
        uint256 fundingDeadline, uint256 deliveryDeadline, bytes32 termsHash,
        string[] calldata milestoneTitles, address[] calldata suppliers, uint256[] calldata amounts
    ) external returns (address) {
        ClearGiveCampaign campaign = new ClearGiveCampaign(token, msg.sender, reviewers, title, fundingDeadline, deliveryDeadline, termsHash, milestoneTitles, suppliers, amounts);
        address addr = address(campaign); campaigns.push(addr);
        emit CampaignCreated(addr, msg.sender, title);
        return addr;
    }
}

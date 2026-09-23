// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IChips} from "./interfaces/IChips.sol";
import {MatchPool} from "./MatchPool.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";

/// @title ClaimHub
/// @notice Batch pull router over MatchPool credits (and future mission/season sources).
/// @dev Funds stay in source contracts; this only orchestrates `claimFor` under allowlist.
contract ClaimHub is ReentrancyGuard {
    error OnlyOwner();
    error BadParam();
    error TooManyRefs();

    IChips public immutable chips;
    MatchPool public immutable matchPool;
    address public owner;

    /// @notice Extra sources (MissionClaim / SeasonClaim) allowed to be batched later.
    mapping(address => bool) public allowedSource;

    uint256 public constant MAX_CLAIM_REFS = 25;

    event OwnerUpdated(address owner);
    event SourceUpdated(address source, bool allowed);
    event ClaimBatch(address indexed player, uint256 total, uint256 refs);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(IChips chips_, MatchPool matchPool_, address owner_) {
        if (address(chips_) == address(0) || address(matchPool_) == address(0) || owner_ == address(0)) {
            revert BadParam();
        }
        chips = chips_;
        matchPool = matchPool_;
        owner = owner_;
    }

    function setOwner(address owner_) external onlyOwner {
        if (owner_ == address(0)) revert BadParam();
        owner = owner_;
        emit OwnerUpdated(owner_);
    }

    function setSource(address source, bool allowed) external onlyOwner {
        if (source == address(0)) revert BadParam();
        allowedSource[source] = allowed;
        emit SourceUpdated(source, allowed);
    }

    /// @notice Claim a single match prize via the router.
    function claimMatch(bytes32 poolId) external nonReentrant {
        matchPool.claimFor(poolId, msg.sender);
        emit ClaimBatch(msg.sender, 0, 1);
    }

    /// @notice Bounded batch claim of match pool refs (paginated; HIGH-quality CEI lives in MatchPool).
    /// @dev `poolIds.length <= MAX_CLAIM_REFS`. Failed individual refs revert the batch (all-or-nothing).
    function claimMany(bytes32[] calldata poolIds) external nonReentrant {
        uint256 n = poolIds.length;
        if (n > MAX_CLAIM_REFS) revert TooManyRefs();
        if (n == 0) revert BadParam();

        uint256 totalBefore = chips.balanceOf(msg.sender);
        for (uint256 i = 0; i < n; i++) {
            matchPool.claimFor(poolIds[i], msg.sender);
        }
        uint256 total = chips.balanceOf(msg.sender) - totalBefore;
        emit ClaimBatch(msg.sender, total, n);
    }

    /// @notice Client-side pagination helper: claim nothing if empty; same as claimMany.
    function claimAll(bytes32[] calldata poolIds) external nonReentrant {
        uint256 n = poolIds.length;
        if (n > MAX_CLAIM_REFS) revert TooManyRefs();
        if (n == 0) revert BadParam();
        uint256 totalBefore = chips.balanceOf(msg.sender);
        for (uint256 i = 0; i < n; i++) {
            matchPool.claimFor(poolIds[i], msg.sender);
        }
        uint256 total = chips.balanceOf(msg.sender) - totalBefore;
        emit ClaimBatch(msg.sender, total, n);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IChips} from "./interfaces/IChips.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";

/// @title LegacyClaim
/// @notice 100:1 legacy coins → CHIPS conversion (capped Treasury pool, 90-day window).
/// @dev Leaves: keccak256(abi.encodePacked(chainId, address(this), wallet, chipsAmount)).
contract LegacyClaim is ReentrancyGuard {
    IChips public immutable chips;
    address public owner;
    address public snapshotSetter;

    bytes32 public snapshotRoot;
    bool public rootFrozen;
    uint256 public windowEndsAt;
    uint256 public constant WINDOW_SECONDS = 90 days;
    uint256 public totalClaimed;
    uint256 public poolCap;

    mapping(address => bool) public claimed;

    event RootSet(bytes32 root, uint256 windowEndsAt, uint256 poolCap);
    event LegacyClaimed(address indexed wallet, uint256 amount);

    error OnlyOwner();
    error OnlySetter();
    error BadParam();
    error Frozen();
    error NotOpen();
    error WindowOver();
    error Used();
    error BadProof();
    error Cap();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(IChips chips_, address snapshotSetter_, address owner_, uint256 poolCap_) {
        if (address(chips_) == address(0) || owner_ == address(0) || poolCap_ == 0) revert BadParam();
        chips = chips_;
        snapshotSetter = snapshotSetter_;
        owner = owner_;
        poolCap = poolCap_;
    }

    /// @notice Publish snapshot root and open the 90-day window (after 7d off-chain challenge).
    function setSnapshotRoot(bytes32 root) external {
        if (msg.sender != snapshotSetter && msg.sender != owner) revert OnlySetter();
        if (rootFrozen) revert Frozen();
        if (root == bytes32(0)) revert BadParam();
        snapshotRoot = root;
        windowEndsAt = block.timestamp + WINDOW_SECONDS;
        rootFrozen = true;
        emit RootSet(root, windowEndsAt, poolCap);
    }

    function leafHash(address wallet, uint256 chipsAmount) public view returns (bytes32) {
        return keccak256(abi.encodePacked(block.chainid, address(this), wallet, chipsAmount));
    }

    function claim(uint256 chipsAmount, bytes32[] calldata proof) external nonReentrant {
        if (!rootFrozen || windowEndsAt == 0) revert NotOpen();
        if (block.timestamp > windowEndsAt) revert WindowOver();
        if (claimed[msg.sender]) revert Used();
        if (chipsAmount == 0) revert BadParam();
        if (totalClaimed + chipsAmount > poolCap) revert Cap();

        bytes32 node = leafHash(msg.sender, chipsAmount);
        if (!_verify(proof, snapshotRoot, node)) revert BadProof();

        claimed[msg.sender] = true;
        totalClaimed += chipsAmount;
        bool ok = chips.transferWithMemo(msg.sender, chipsAmount, keccak256("legacy:convert"));
        if (!ok) revert BadParam();
        emit LegacyClaimed(msg.sender, chipsAmount);
    }

    function _verify(bytes32[] calldata proof, bytes32 root, bytes32 leaf) private pure returns (bool) {
        bytes32 node = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 p = proof[i];
            if (node <= p) node = keccak256(abi.encodePacked(node, p));
            else node = keccak256(abi.encodePacked(p, node));
        }
        return node == root;
    }
}

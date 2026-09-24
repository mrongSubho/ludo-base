// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IChips} from "./interfaces/IChips.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";

/// @title SeasonClaim
/// @notice Pull-based season rank rewards via frozen merkle root (CHIPS_PLANNING 6.2).
/// @dev Leaves: keccak256(abi.encodePacked(chainId, address(this), epoch, wallet, amount)).
contract SeasonClaim is ReentrancyGuard {
    IChips public immutable chips;
    address public owner;
    address public rootSetter;

    /// @notice Frozen root per epoch — set once, never replaced (HIGH-quality root rug prevention).
    mapping(uint256 => bytes32) public epochRoot;
    mapping(uint256 => uint256) public epochBudget;
    mapping(uint256 => uint256) public epochClaimed;
    mapping(uint256 => mapping(address => bool)) public claimed;
    mapping(uint256 => bool) public epochFrozen;

    uint256 public constant CHALLENGE_SECONDS = 48 hours;

    uint256 public pendingEpoch;
    bytes32 public pendingRoot;
    uint256 public pendingBudget;
    uint256 public pendingEta;

    event RootProposed(uint256 indexed epoch, bytes32 root, uint256 budget, uint256 eta);
    event RootActivated(uint256 indexed epoch, bytes32 root, uint256 budget);
    event SeasonClaimed(uint256 indexed epoch, address indexed wallet, uint256 amount);

    error OnlyOwner();
    error OnlySetter();
    error BadParam();
    error Frozen();
    error NotReady();
    error WrongEpoch();
    error Used();
    error BadProof();
    error Budget();
    error Paused();

    bool public paused;

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlySetter() {
        if (msg.sender != rootSetter && msg.sender != owner) revert OnlySetter();
        _;
    }

    constructor(IChips chips_, address rootSetter_, address owner_) {
        if (address(chips_) == address(0) || owner_ == address(0)) revert BadParam();
        chips = chips_;
        rootSetter = rootSetter_;
        owner = owner_;
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
    }

    function setRootSetter(address s) external onlyOwner {
        if (s == address(0)) revert BadParam();
        rootSetter = s;
    }

    /// @notice Propose a root. Activation waits CHALLENGE_SECONDS (public leaf window).
    function proposeRoot(uint256 epoch, bytes32 root, uint256 budget) external onlySetter {
        if (epochRoot[epoch] != bytes32(0) || epochFrozen[epoch]) revert Frozen();
        if (root == bytes32(0) || budget == 0) revert BadParam();
        pendingEpoch = epoch;
        pendingRoot = root;
        pendingBudget = budget;
        pendingEta = block.timestamp + CHALLENGE_SECONDS;
        emit RootProposed(epoch, root, budget, pendingEta);
    }

    /// @notice Activate after the challenge window. Root is frozen forever for this epoch.
    function activateRoot(uint256 epoch) external onlySetter {
        if (epoch != pendingEpoch || pendingRoot == bytes32(0)) revert WrongEpoch();
        if (block.timestamp < pendingEta) revert NotReady();
        if (epochRoot[epoch] != bytes32(0)) revert Frozen();
        epochRoot[epoch] = pendingRoot;
        epochBudget[epoch] = pendingBudget;
        epochFrozen[epoch] = true;
        pendingRoot = bytes32(0);
        emit RootActivated(epoch, epochRoot[epoch], epochBudget[epoch]);
    }

    function leafHash(uint256 epoch, address wallet, uint256 amount) public view returns (bytes32) {
        return keccak256(abi.encodePacked(block.chainid, address(this), epoch, wallet, amount));
    }

    function claim(uint256 epoch, uint256 amount, bytes32[] calldata proof) external nonReentrant {
        if (paused) revert Paused();
        if (epochRoot[epoch] == bytes32(0)) revert WrongEpoch();
        if (claimed[epoch][msg.sender]) revert Used();
        if (amount == 0) revert BadParam();
        if (epochClaimed[epoch] + amount > epochBudget[epoch]) revert Budget();

        bytes32 node = leafHash(epoch, msg.sender, amount);
        if (!_verify(proof, epochRoot[epoch], node)) revert BadProof();

        claimed[epoch][msg.sender] = true;
        epochClaimed[epoch] += amount;
        bool ok = chips.transferWithMemo(msg.sender, amount, keccak256("season:claim"));
        if (!ok) revert BadParam();
        emit SeasonClaimed(epoch, msg.sender, amount);
    }

    function _verify(bytes32[] calldata proof, bytes32 root, bytes32 leaf) private pure returns (bool) {
        bytes32 node = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 p = proof[i];
            if (node <= p) {
                node = keccak256(abi.encodePacked(node, p));
            } else {
                node = keccak256(abi.encodePacked(p, node));
            }
        }
        return node == root;
    }
}

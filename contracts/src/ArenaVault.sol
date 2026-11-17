// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IChips} from "./interfaces/IChips.sol";
import {ECDSA} from "./lib/ECDSA.sol";
import {EIP712} from "./lib/EIP712.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";

/// @title ArenaVault
/// @notice Non-custodial reusable match vault + EIP-712 pull claims for Quick Match & TeamUp wagers.
/// @dev Players top up once (`depositVault`), play across matches / cancelled searches with zero repeat
///      on-chain fees, and pull winnings or idle balances anytime via `claimReward` / `claimBatch` (user pays gas).
contract ArenaVault is ReentrancyGuard {
    using ECDSA for bytes32;

    error OnlyOwner();
    error OnlyOracle();
    error BadParam();
    error Expired();
    error AlreadyClaimed();
    error Unauthorized();
    error ArrayLengthMismatch();

    bytes32 public constant VAULT_CLAIM_TYPEHASH = keccak256(
        "VaultVoucher(bytes32 claimId,address recipient,uint256 amount,uint8 claimType,uint256 nonce,uint64 deadline)"
    );

    enum ClaimType {
        MatchPrize,
        VaultWithdraw,
        MatchRefund
    }

    struct VaultVoucher {
        bytes32 claimId;
        address recipient;
        uint256 amount;
        uint8 claimType;
        uint256 nonce;
        uint64 deadline;
    }

    IChips public immutable chips;
    address public owner;
    address public settlementOracle;
    address public protocolTreasury;

    mapping(address => uint256) public totalDeposited;
    mapping(bytes32 => bool) public claimExecuted;

    event OwnerUpdated(address indexed newOwner);
    event OracleUpdated(address indexed newOracle);
    event ProtocolTreasuryUpdated(address indexed newTreasury);
    event VaultDeposited(address indexed player, uint256 amount);
    event VaultClaimed(bytes32 indexed claimId, address indexed recipient, uint256 amount, uint8 claimType);
    event ProtocolRakeWithdrawn(address indexed treasury, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyOracleOrOwner() {
        if (msg.sender != settlementOracle && msg.sender != owner) revert OnlyOracle();
        _;
    }

    constructor(
        IChips chips_,
        address owner_,
        address settlementOracle_,
        address protocolTreasury_
    ) {
        if (
            address(chips_) == address(0) ||
            owner_ == address(0) ||
            settlementOracle_ == address(0) ||
            protocolTreasury_ == address(0)
        ) revert BadParam();

        chips = chips_;
        owner = owner_;
        settlementOracle = settlementOracle_;
        protocolTreasury = protocolTreasury_;
    }

    function setOwner(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert BadParam();
        owner = newOwner;
        emit OwnerUpdated(newOwner);
    }

    function setSettlementOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert BadParam();
        settlementOracle = newOracle;
        emit OracleUpdated(newOracle);
    }

    function setProtocolTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert BadParam();
        protocolTreasury = newTreasury;
        emit ProtocolTreasuryUpdated(newTreasury);
    }

    /// @notice Top up the caller's reusable Arena Match Vault.
    function depositVault(uint256 amount) external nonReentrant {
        if (amount == 0) revert BadParam();
        totalDeposited[msg.sender] += amount;

        bool success = chips.transferFrom(msg.sender, address(this), amount);
        if (!success) revert BadParam();

        emit VaultDeposited(msg.sender, amount);
    }

    /// @notice Pull-claim an individual match prize, match refund, or vault withdrawal voucher.
    function claimReward(VaultVoucher calldata voucher, bytes calldata signature) external nonReentrant {
        _executeClaim(voucher, signature);
    }

    /// @notice Batch pull-claim multiple match prizes / withdrawals in a single transaction.
    function claimBatch(VaultVoucher[] calldata vouchers, bytes[] calldata signatures) external nonReentrant {
        if (vouchers.length != signatures.length) revert ArrayLengthMismatch();
        for (uint256 i = 0; i < vouchers.length; i++) {
            _executeClaim(vouchers[i], signatures[i]);
        }
    }

    /// @notice Sweep accrued protocol rake to the protocol treasury.
    function withdrawRake(uint256 amount) external onlyOracleOrOwner nonReentrant {
        if (amount == 0) revert BadParam();
        bool success = chips.transfer(protocolTreasury, amount);
        if (!success) revert BadParam();
        emit ProtocolRakeWithdrawn(protocolTreasury, amount);
    }

    function _executeClaim(VaultVoucher calldata voucher, bytes calldata signature) internal {
        if (block.timestamp > voucher.deadline) revert Expired();
        if (claimExecuted[voucher.claimId]) revert AlreadyClaimed();
        if (msg.sender != voucher.recipient) revert Unauthorized();
        if (voucher.amount == 0) revert BadParam();

        bytes32 structHash = keccak256(
            abi.encode(
                VAULT_CLAIM_TYPEHASH,
                voucher.claimId,
                voucher.recipient,
                voucher.amount,
                voucher.claimType,
                voucher.nonce,
                voucher.deadline
            )
        );

        bytes32 domainSeparator = EIP712.domainHash("ArenaVault", address(this));
        bytes32 digest = EIP712.digest(domainSeparator, structHash);
        address recoveredSigner = digest.recover(signature);

        if (recoveredSigner != settlementOracle) revert Unauthorized();

        claimExecuted[voucher.claimId] = true;

        bool success = chips.transfer(voucher.recipient, voucher.amount);
        if (!success) revert BadParam();

        emit VaultClaimed(voucher.claimId, voucher.recipient, voucher.amount, voucher.claimType);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IChips} from "./interfaces/IChips.sol";
import {ECDSA} from "./lib/ECDSA.sol";
import {EIP712} from "./lib/EIP712.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";

/// @title ClanClaim
/// @notice Non-custodial war escrow, Clan Treasury sub-ledger, and pull-based reward claims for Ludo Base Clans.
/// @dev Implements EIP-712 voucher validation for instant user pull-claims and batch execution.
///      Users pay gas on Base Sepolia (`84532`) for their own claims (D16).
contract ClanClaim is ReentrancyGuard {
    using ECDSA for bytes32;

    error OnlyOwner();
    error OnlyOracle();
    error BadParam();
    error Expired();
    error AlreadyClaimed();
    error AlreadySettled();
    error WarNotSettled();
    error Unauthorized();
    error InsufficientTreasury();
    error InsufficientEscrow();
    error ArrayLengthMismatch();

    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "ClaimVoucher(bytes32 claimId,bytes32 clanId,address recipient,uint256 amount,uint8 claimType,uint256 nonce,uint64 deadline)"
    );

    enum ClaimType {
        WarPrincipal,
        WarProfitMerit,
        WarGovShare,
        WarRefund,
        WeeklyVault,
        TreasuryGrant
    }

    struct ClaimVoucher {
        bytes32 claimId;
        bytes32 clanId;
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

    // Clan Treasury sub-ledger: clanId => balance
    mapping(bytes32 => uint256) public clanTreasuryBalance;

    // War Escrow tracking: warId => total locked stake
    mapping(bytes32 => uint256) public warEscrowBalance;
    mapping(bytes32 => bool) public warSettled;

    // Replay protection for pull claims: claimId => executed
    mapping(bytes32 => bool) public claimExecuted;

    event OwnerUpdated(address indexed newOwner);
    event OracleUpdated(address indexed newOracle);
    event ProtocolTreasuryUpdated(address indexed newTreasury);
    event WarStakeDeposited(bytes32 indexed warId, bytes32 indexed clanId, address indexed contributor, uint256 amount);
    event WarStakeDepositedFromTreasury(bytes32 indexed warId, bytes32 indexed clanId, uint256 amount);
    event WarSettled(bytes32 indexed warId, bytes32 indexed winningClanId, uint256 netPot, uint256 protocolRake);
    event ClanTreasuryFunded(bytes32 indexed clanId, address indexed contributor, uint256 amount);
    event ClanTreasuryCredited(bytes32 indexed clanId, uint256 amount, bytes32 reason);
    event ClanTreasuryDebited(bytes32 indexed clanId, address indexed recipient, uint256 amount, bytes32 reason);
    event VaultReserveFunded(address indexed funder, uint256 amount);
    event RewardClaimed(bytes32 indexed claimId, bytes32 indexed clanId, address indexed recipient, uint256 amount, uint8 claimType);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyOracle() {
        if (msg.sender != settlementOracle) revert OnlyOracle();
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

    // ── Admin Functions ────────────────────────────────────────────────────────

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

    // ── Non-Custodial War Escrow ───────────────────────────────────────────────

    /// @notice Lock an individual player or officer's war fee stake into the contract.
    function depositWarStake(bytes32 warId, bytes32 clanId, uint256 amount) external nonReentrant {
        if (amount == 0 || warSettled[warId]) revert BadParam();
        warEscrowBalance[warId] += amount;

        bool success = chips.transferFrom(msg.sender, address(this), amount);
        if (!success) revert BadParam();

        emit WarStakeDeposited(warId, clanId, msg.sender, amount);
    }

    /// @notice Lock a portion of a war stake directly from the Clan's on-chain treasury balance.
    function depositWarStakeFromTreasury(bytes32 warId, bytes32 clanId, uint256 amount) external onlyOracle {
        if (amount == 0 || warSettled[warId]) revert BadParam();
        if (clanTreasuryBalance[clanId] < amount) revert InsufficientTreasury();

        clanTreasuryBalance[clanId] -= amount;
        warEscrowBalance[warId] += amount;

        emit WarStakeDepositedFromTreasury(warId, clanId, amount);
    }

    /// @notice Settle a war on-chain: transfers the 5% protocol rake to the treasury and credits the winning clan treasury.
    function settleWar(
        bytes32 warId,
        bytes32 winningClanId,
        uint256 protocolRake,
        uint256 winningClanTreasuryCut
    ) external onlyOracle nonReentrant {
        if (warSettled[warId]) revert AlreadySettled();
        uint256 totalEscrow = warEscrowBalance[warId];
        if (totalEscrow < protocolRake + winningClanTreasuryCut) revert InsufficientEscrow();

        warSettled[warId] = true;

        if (protocolRake > 0) {
            bool rakeSuccess = chips.transfer(protocolTreasury, protocolRake);
            if (!rakeSuccess) revert BadParam();
        }

        if (winningClanTreasuryCut > 0) {
            clanTreasuryBalance[winningClanId] += winningClanTreasuryCut;
            emit ClanTreasuryCredited(winningClanId, winningClanTreasuryCut, keccak256("war_profit_cut"));
        }

        uint256 netPot = totalEscrow - protocolRake;
        emit WarSettled(warId, winningClanId, netPot, protocolRake);
    }

    // ── Clan Treasury Operations ───────────────────────────────────────────────

    /// @notice Anyone (e.g. clan members) can voluntarily fund their clan's treasury.
    function fundTreasury(bytes32 clanId, uint256 amount) external nonReentrant {
        if (amount == 0) revert BadParam();
        clanTreasuryBalance[clanId] += amount;

        bool success = chips.transferFrom(msg.sender, address(this), amount);
        if (!success) revert BadParam();

        emit ClanTreasuryFunded(clanId, msg.sender, amount);
    }

    /// @notice Oracle credits treasury (e.g., from external fee distribution or season rewards).
    function creditTreasury(bytes32 clanId, uint256 amount, bytes32 reason) external onlyOracle {
        if (amount == 0) revert BadParam();
        clanTreasuryBalance[clanId] += amount;
        emit ClanTreasuryCredited(clanId, amount, reason);
    }

    /// @notice Oracle debits treasury for member grants, rename fees, or tag upgrades.
    function debitTreasury(bytes32 clanId, uint256 amount, address recipient, bytes32 reason) external onlyOracle nonReentrant {
        if (amount == 0 || recipient == address(0)) revert BadParam();
        if (clanTreasuryBalance[clanId] < amount) revert InsufficientTreasury();

        clanTreasuryBalance[clanId] -= amount;

        bool success = chips.transfer(recipient, amount);
        if (!success) revert BadParam();

        emit ClanTreasuryDebited(clanId, recipient, amount, reason);
    }

    /// @notice Fund vault reward reserve from Playing Rewards / Protocol emissions.
    function fundVaultReserve(uint256 amount) external nonReentrant {
        if (amount == 0) revert BadParam();

        bool success = chips.transferFrom(msg.sender, address(this), amount);
        if (!success) revert BadParam();

        emit VaultReserveFunded(msg.sender, amount);
    }

    // ── Pull-Based Claims (100% User Gas — D16) ────────────────────────────────

    /// @notice Claim an individual reward, principal return, or refund voucher.
    function claimReward(ClaimVoucher calldata voucher, bytes calldata signature) external nonReentrant {
        _executeClaim(voucher, signature);
    }

    /// @notice Batch claim multiple rewards/refunds in a single gas-efficient transaction.
    function claimBatch(ClaimVoucher[] calldata vouchers, bytes[] calldata signatures) external nonReentrant {
        if (vouchers.length != signatures.length) revert ArrayLengthMismatch();
        for (uint256 i = 0; i < vouchers.length; i++) {
            _executeClaim(vouchers[i], signatures[i]);
        }
    }

    function _executeClaim(ClaimVoucher calldata voucher, bytes calldata signature) internal {
        if (block.timestamp > voucher.deadline) revert Expired();
        if (claimExecuted[voucher.claimId]) revert AlreadyClaimed();
        if (msg.sender != voucher.recipient) revert Unauthorized();
        if (voucher.amount == 0) revert BadParam();

        bytes32 structHash = keccak256(
            abi.encode(
                CLAIM_TYPEHASH,
                voucher.claimId,
                voucher.clanId,
                voucher.recipient,
                voucher.amount,
                voucher.claimType,
                voucher.nonce,
                voucher.deadline
            )
        );

        bytes32 domainSeparator = EIP712.domainHash("ClanClaim", address(this));
        bytes32 digest = EIP712.digest(domainSeparator, structHash);
        address recoveredSigner = digest.recover(signature);

        if (recoveredSigner != settlementOracle) revert Unauthorized();

        claimExecuted[voucher.claimId] = true;

        bool success = chips.transfer(voucher.recipient, voucher.amount);
        if (!success) revert BadParam();

        emit RewardClaimed(voucher.claimId, voucher.clanId, voucher.recipient, voucher.amount, voucher.claimType);
    }
}

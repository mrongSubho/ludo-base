// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IChips} from "./interfaces/IChips.sol";
import {ECDSA} from "./lib/ECDSA.sol";
import {EIP712} from "./lib/EIP712.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";

/// @title MissionClaim
/// @notice Pull-based mission / social / onboarding vouchers (EIP-712 + op-key registry).
/// @dev Scorer eligibility is off-chain at voucher mint time for Phase 1 scaffold;
///      match prizes never route through this contract (scorer rewards-only, section 4.8).
contract MissionClaim is ReentrancyGuard {
    using ECDSA for bytes32;

    bytes32 public constant VOUCHER_TYPEHASH = keccak256(
        "MissionVoucher(address wallet,bytes32 missionId,uint256 amount,bytes32 periodId,uint64 deadline,uint256 nonce)"
    );
    bytes32 public constant MEMO_CLAIM = keccak256("mission:claim");

    IChips public immutable chips;
    address public owner;
    address public opKey;
    bool public paused;

    /// @notice Lifetime + per-period issuance ceilings (Strix / section 5.3).
    uint256 public perPeriodCeiling;
    uint256 public periodIssued;

    mapping(bytes32 => bool) public usedVoucher;
    mapping(bytes32 => bool) public opKeyRevoked; // digest-keyed revoke (optional)

    event OpKeyUpdated(address opKey);
    event MissionClaimed(address indexed wallet, bytes32 indexed missionId, bytes32 periodId, uint256 amount);
    event PausedSet(bool paused);
    event CeilingSet(uint256 perPeriodCeiling);

    error OnlyOwner();
    error BadParam();
    error Used();
    error BadSig();
    error Expired();
    error Ceiling();
    error IsPaused();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(IChips chips_, address opKey_, address owner_) {
        if (address(chips_) == address(0) || opKey_ == address(0) || owner_ == address(0)) {
            revert BadParam();
        }
        chips = chips_;
        opKey = opKey_;
        owner = owner_;
        perPeriodCeiling = 1_000_000e18; // placeholder; set from TOKEN_PARAMS season sub-budget
    }

    function setOpKey(address opKey_) external onlyOwner {
        if (opKey_ == address(0)) revert BadParam();
        opKey = opKey_;
        emit OpKeyUpdated(opKey_);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    function setPerPeriodCeiling(uint256 c) external onlyOwner {
        perPeriodCeiling = c;
        emit CeilingSet(c);
    }

    function voucherDigest(
        address wallet,
        bytes32 missionId,
        uint256 amount,
        bytes32 periodId,
        uint64 deadline,
        uint256 nonce
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(VOUCHER_TYPEHASH, wallet, missionId, amount, periodId, deadline, nonce)
        );
        return EIP712.digest(EIP712.domainHash("LudoBase MissionClaim", address(this)), structHash);
    }

    /// @notice Pull claim — never a push from a hot wallet.
    function claim(
        address wallet,
        bytes32 missionId,
        uint256 amount,
        bytes32 periodId,
        uint64 deadline,
        uint256 nonce,
        bytes calldata sig
    ) external nonReentrant {
        if (paused) revert IsPaused();
        if (block.timestamp > deadline) revert Expired();
        if (msg.sender != wallet && tx.origin != wallet) {
            // Allow ClaimHub later via onlyWallet; Phase 1: claimant must be wallet.
            revert BadParam();
        }

        bytes32 d = voucherDigest(wallet, missionId, amount, periodId, deadline, nonce);
        if (ECDSA.recover(d, sig) != opKey) revert BadSig();

        bytes32 usedKey = keccak256(
            abi.encode(block.chainid, address(this), wallet, missionId, periodId, amount, nonce)
        );
        if (usedVoucher[usedKey]) revert Used();
        usedVoucher[usedKey] = true;

        if (periodIssued + amount > perPeriodCeiling) revert Ceiling();
        periodIssued += amount;

        // CEI: effects above, interaction below.
        bool ok = chips.transferWithMemo(wallet, amount, MEMO_CLAIM);
        if (!ok) revert BadParam();

        emit MissionClaimed(wallet, missionId, periodId, amount);
    }

    /// @notice Roll period budget (owner / ops job between periods).
    function rollPeriod() external onlyOwner {
        periodIssued = 0;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IChips} from "./interfaces/IChips.sol";
import {ECDSA} from "./lib/ECDSA.sol";
import {EIP712} from "./lib/EIP712.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";

/// @title MissionClaim
/// @notice Pull-based mission / social / onboarding vouchers (EIP-712 + op-key registry),
///         with on-chain eligibility, amount rules and a funded reward reserve.
/// @dev Scorer progress stays off-chain (the server signs what the player earned); this
///      contract is the enforcement + payout layer: it refuses anything the server's own
///      database would also refuse, and it cannot pay out more than it holds.
///
///      Claim lifecycle — every gate below must pass before a single token moves:
///        1. not paused, voucher not past its `deadline`, amount non-zero
///        2. sender is the wallet (or an owner-allowlisted relayer — ECO-05)
///        3. mission registered and `active`; amount matches the mission's fixed reward
///           or falls inside the global claim bounds
///        4. the mission's period window is open (if one is set)
///        5. signature recovers to the current `opKey`
///        6. this exact voucher (nonce) has not been spent
///        7. this wallet has not already claimed this mission in this period
///        8. the period's issuance ceiling has room
///        9. the reserve can pay `amount` and still hold `minReserve`
///
///      Funding: the contract holds no privilege to mint. Rewards are `fund()`-ed in by
///      the treasury via `transferFrom`; `withdrawSurplus()` lets the owner take back only
///      what exceeds `minReserve`, so a claim can never be starved by an unrelated withdrawal.
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
    /// @dev Keyed by periodId (UTC day / ISO week), so the daily bucket and the weekly
    ///      bucket have independent budgets; `totalIssued` is the lifetime figure for
    ///      reporting and is never reset.
    uint256 public perPeriodCeiling;
    mapping(bytes32 => uint256) public periodIssued;
    uint256 public totalIssued;

    // ── Claim reservation (funding) ────────────────────────────────────────────
    /// @notice Rewards the treasury has pushed in via `fund()`.
    uint256 public totalDeposited;
    /// @notice Lifetime rewards paid out.
    uint256 public totalClaimed;
    /// @notice Lifetime surplus withdrawn by the owner.
    uint256 public totalWithdrawn;
    /// @notice Reserve floor. Two different jobs, deliberately:
    ///         - withdrawals: HARD — the owner can never take the reserve below it,
    ///           so a claim can never be starved by an unrelated withdrawal;
    ///         - claims: SOFT — a claim pays while the balance covers it, and emits
    ///           ReservesLow when the payout dips under the floor, so ops tops up
    ///           before the reserve is actually empty. A hard floor here would brick
    ///           every claim the moment funding slipped, which is worse than a
    ///           warning: players would see "claim failed" with funds still present.
    ///         Set 0 to disable.
    uint256 public minReserve;

    /// @notice Amount bounds for missions with no fixed reward (`reward == 0`).
    uint256 public minClaimAmount = 1;
    uint256 public maxClaimAmount = type(uint256).max;

    /// @notice Per-mission payout + kill switch.
    /// @param registered False = never configured, so payouts fall back to the global
    ///        claim bounds (keeps the pre-registry voucher flow working).
    /// @param reward Fixed payout in 1e18 CHIPS. 0 = free-form (bounded by min/max).
    /// @param active Only meaningful when registered; false refuses the mission.
    struct Mission {
        bool registered;
        uint256 reward;
        bool active;
    }
    /// @notice Per-period claim window (periodId = keccak of the UTC day / ISO week label).
    /// @dev start == 0 means "no lower bound"; end == 0 means "no upper bound". A period
    ///      that was never registered has no window and is always open.
    struct Period {
        uint64 start;
        uint64 end;
    }

    mapping(bytes32 => Mission) public missions;
    mapping(bytes32 => Period) public periods;

    mapping(bytes32 => bool) public usedVoucher;
    mapping(bytes32 => bool) public opKeyRevoked; // digest-keyed revoke (optional)
    /// @notice One claim per wallet per mission per period — the on-chain mirror of the
    ///         `mission_vouchers` uniqueness the server already enforces (defence in depth:
    ///         a leaked or double-issued voucher cannot be spent twice).
    mapping(bytes32 => bool) public claimedInPeriod;
    /// @notice Contracts allowed to relay a claim on a wallet's behalf.
    /// @dev ECO-05: makes ClaimHub.allowedSource live code, not dead config.
    ///      Only addresses the owner has explicitly allowed can submit a
    ///      voucher signed for someone else.
    mapping(address => bool) public claimRelayer;

    event OpKeyUpdated(address opKey);
    event MissionClaimed(address indexed wallet, bytes32 indexed missionId, bytes32 periodId, uint256 amount);
    event ClaimRelayerSet(address indexed relayer, bool allowed);
    event PausedSet(bool paused);
    event CeilingSet(uint256 perPeriodCeiling);
    event MissionSet(bytes32 indexed missionId, uint256 reward, bool active);
    event PeriodSet(bytes32 indexed periodId, uint64 start, uint64 end);
    event ClaimBoundsSet(uint256 minClaimAmount, uint256 maxClaimAmount);
    event Funded(address indexed from, uint256 amount, uint256 contractBalance);
    event Withdrawn(address indexed to, uint256 amount, uint256 contractBalance);
    event MinReserveSet(uint256 minReserve);
    event ReservesLow(uint256 balance, uint256 minReserve);

    error OnlyOwner();
    error BadParam();
    error Used();
    error BadSig();
    error Expired();
    error Ceiling();
    error IsPaused();
    error AlreadyClaimed();
    error OutsideWindow();
    error MissionInactive();
    error AmountOutOfRange();
    error InsufficientReserves();
    error ReserveFloor();

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

    // ── Owner / ops configuration ──────────────────────────────────────────────

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

    function setClaimRelayer(address relayer, bool allowed) external onlyOwner {
        if (relayer == address(0)) revert BadParam();
        claimRelayer[relayer] = allowed;
        emit ClaimRelayerSet(relayer, allowed);
    }

    /// @notice Register a mission's payout and availability.
    /// @dev Reward semantics: non-zero = the voucher amount must equal it exactly (one
    ///      on-chain source of truth, so a compromised op key cannot inflate a payout);
    ///      zero = free-form, bounded by minClaimAmount / maxClaimAmount.
    function setMission(bytes32 missionId, uint256 reward, bool active) external onlyOwner {
        if (missionId == bytes32(0)) revert BadParam();
        missions[missionId] = Mission({registered: true, reward: reward, active: active});
        emit MissionSet(missionId, reward, active);
    }

    /// @notice Open (or close) the claim window for one period.
    function setPeriod(bytes32 periodId, uint64 start, uint64 end) external onlyOwner {
        if (periodId == bytes32(0)) revert BadParam();
        if (end != 0 && start != 0 && end <= start) revert BadParam();
        periods[periodId] = Period({start: start, end: end});
        emit PeriodSet(periodId, start, end);
    }

    /// @notice Bounds for free-form (unregistered / reward == 0) mission payouts.
    function setClaimBounds(uint256 minAmount, uint256 maxAmount) external onlyOwner {
        if (minAmount == 0 || maxAmount < minAmount) revert BadParam();
        minClaimAmount = minAmount;
        maxClaimAmount = maxAmount;
        emit ClaimBoundsSet(minAmount, maxAmount);
    }

    // ── Funding ────────────────────────────────────────────────────────────────

    /// @notice Pull `amount` CHIPS from the caller into the reward reserve.
    /// @dev Requires `approve(address(this), amount)` first. Anyone may fund (the
    ///      treasury, a sponsor, a season partner) — funding is permissionless because
    ///      it only adds claim capacity and nothing can be taken out but surplus.
    function fund(uint256 amount) external nonReentrant {
        if (amount == 0) revert BadParam();
        bool ok = chips.transferFrom(msg.sender, address(this), amount);
        if (!ok) revert BadParam();
        totalDeposited += amount;
        emit Funded(msg.sender, amount, chips.balanceOf(address(this)));
    }

    /// @notice Withdraw reserve funds that are not needed to honour `minReserve`.
    /// @dev Cannot drain the floor: a claim can never be starved by an unrelated
    ///      withdrawal. `minReserve` is the single knob; 0 = freely withdrawable.
    function withdrawSurplus(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert BadParam();
        uint256 bal = chips.balanceOf(address(this));
        if (bal < amount || bal - amount < minReserve) revert ReserveFloor();
        totalWithdrawn += amount;
        bool ok = chips.transfer(owner, amount);
        if (!ok) revert BadParam();
        emit Withdrawn(owner, amount, chips.balanceOf(address(this)));
    }

    function setMinReserve(uint256 r) external onlyOwner {
        minReserve = r;
        emit MinReserveSet(r);
    }

    /// @notice Reserve headroom above the floor — what new claims can collectively pay.
    function availableReserves() public view returns (uint256) {
        uint256 bal = chips.balanceOf(address(this));
        return bal > minReserve ? bal - minReserve : 0;
    }

    /// @notice Roll one period's issuance budget (owner / ops job between periods).
    /// @param periodId keccak of the period label (UTC day `YYYY-MM-DD`, ISO week `YYYY-Www`).
    function rollPeriod(bytes32 periodId) external onlyOwner {
        if (periodId == bytes32(0)) revert BadParam();
        periodIssued[periodId] = 0;
    }

    // ── Views ──────────────────────────────────────────────────────────────────

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

    function periodClaimKey(address wallet, bytes32 missionId, bytes32 periodId) public pure returns (bytes32) {
        return keccak256(abi.encode(wallet, missionId, periodId));
    }

    /// @notice Whether a wallet already claimed a mission in a period (server + UI read this).
    function hasClaimed(address wallet, bytes32 missionId, bytes32 periodId) external view returns (bool) {
        return claimedInPeriod[periodClaimKey(wallet, missionId, periodId)];
    }

    // ── Claim ──────────────────────────────────────────────────────────────────

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
        if (amount == 0) revert BadParam();
        // ECO-05: claimant identity is msg.sender only. `tx.origin` was
        // removed — it allowed any contract a wallet interacted with to
        // submit that wallet's voucher, which is the master-phishing path.
        // Relaying is now an explicit, owner-allowlisted role (ClaimHub).
        if (msg.sender != wallet && !claimRelayer[msg.sender]) revert BadParam();

        // Eligibility: mission registration, amount rule, period window.
        Mission memory m = missions[missionId];
        if (m.registered) {
            if (!m.active) revert MissionInactive();
            if (m.reward != 0 && amount != m.reward) revert AmountOutOfRange();
        }
        if ((!m.registered || m.reward == 0) && (amount < minClaimAmount || amount > maxClaimAmount)) {
            revert AmountOutOfRange();
        }

        Period memory p = periods[periodId];
        if (p.start != 0 && block.timestamp < p.start) revert OutsideWindow();
        if (p.end != 0 && block.timestamp > p.end) revert OutsideWindow();

        bytes32 d = voucherDigest(wallet, missionId, amount, periodId, deadline, nonce);
        if (ECDSA.recover(d, sig) != opKey) revert BadSig();

        bytes32 usedKey = keccak256(
            abi.encode(block.chainid, address(this), wallet, missionId, periodId, nonce)
        );
        if (usedVoucher[usedKey]) revert Used();
        usedVoucher[usedKey] = true;

        // One claim per wallet per mission per period.
        bytes32 claimKey = periodClaimKey(wallet, missionId, periodId);
        if (claimedInPeriod[claimKey]) revert AlreadyClaimed();
        claimedInPeriod[claimKey] = true;

        if (periodIssued[periodId] + amount > perPeriodCeiling) revert Ceiling();
        periodIssued[periodId] += amount;
        totalIssued += amount;

        // Insolvency is the only claim-side funding failure: never pay what the
        // reserve does not hold. The floor itself is a withdrawal guard + a warning
        // line (see minReserve), so a claim still succeeds while any balance remains.
        uint256 bal = chips.balanceOf(address(this));
        if (bal < amount) revert InsufficientReserves();

        // CEI: effects above, interaction below.
        bool ok = chips.transferWithMemo(wallet, amount, MEMO_CLAIM);
        if (!ok) revert BadParam();
        totalClaimed += amount;

        // Loud, non-blocking: ops funds again before the floor bites.
        uint256 left = bal - amount;
        if (left < minReserve) emit ReservesLow(left, minReserve);

        emit MissionClaimed(wallet, missionId, periodId, amount);
    }
}

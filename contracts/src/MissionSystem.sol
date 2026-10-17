// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IChips} from "./interfaces/IChips.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";

/// @title MissionSystem
/// @notice Fully on-chain mission authority. Mission definitions, day/week
///         scheduling, per-wallet progress, completion, and CHIPS payout all
///         live here — the off-chain layer is only an *event reporter* (the
///         progress oracle), never the judge of completion or eligibility.
/// @dev Lifecycle:
///   1. Owner creates a mission on-chain via `setMission` (kind ONCE/DAY/WEEK,
///      reward in 1e18 CHIPS base units, progress `target`, optional
///      `prerequisite`).
///   2. The active period is derived from `block.timestamp`: ONCE -> constant,
///      DAY -> UTC-day index, WEEK -> rolling 7-day index. (A Monday-aligned ISO
///      week can replace the WEEK branch if desired; rolling-7 is self-consistent
///      and avoids a brittle on-chain calendar.)
///   3. The trusted `progressOracle` calls `recordProgress(wallet, missionId,
///      delta)`. The contract — not the oracle — is the authority: it only flips
///      `completed` once recorded progress reaches `target`, then pays `reward`
///      from its own CHIPS reserve.
///   4. One completion (and one payout) per (wallet, missionId, period). If the
///      reserve cannot cover the reward at completion time, the mission is still
///      marked completed on-chain and the payout is queued for `claimPayout`
///      once funded — progress / completion state is never lost to a short reserve.
///   Funding is permissionless via `fund()` (only adds capacity); `minReserve`
///   protects the floor for surplus withdrawal, mirroring MissionClaim.
contract MissionSystem is ReentrancyGuard {
    IChips public immutable chips;
    address public owner;
    address public progressOracle;
    bool public paused;

    enum MissionKind { ONCE, DAY, WEEK }

    struct Mission {
        bool exists;
        MissionKind kind;
        uint256 reward; // CHIPS base units (1e18) paid on completion; 0 = track-only
        uint256 target; // progress threshold (0 = completes on first progress event)
        bytes32 prerequisite; // missionId that must be completed first (0 = none)
        bool active;
    }

    /// @dev A constant, non-colliding period for one-time missions.
    bytes32 private constant ONCE_PERIOD = bytes32(uint256(1));
    bytes32 private constant MEMO = keccak256("mission:complete");

    mapping(bytes32 => Mission) public missions;

    /// @dev progress[wallet][missionId][period] -> accumulated progress.
    mapping(address => mapping(bytes32 => mapping(bytes32 => uint256))) public progress;
    /// @dev completed[wallet][missionId][period] -> done (and paid or queued).
    mapping(address => mapping(bytes32 => mapping(bytes32 => bool))) public completed;
    /// @dev pendingPayout[wallet|missionId|period] -> reward queued because the
    ///      reserve was short at completion; cleared by `claimPayout`.
    mapping(bytes32 => uint256) public pendingPayout;

    // Funding / reserve (MissionClaim conventions).
    uint256 public totalDeposited;
    uint256 public totalClaimed;
    uint256 public totalWithdrawn;
    uint256 public minReserve;

    event MissionSet(
        bytes32 indexed missionId, MissionKind kind, uint256 reward, uint256 target, bytes32 prerequisite, bool active
    );
    event ProgressRecorded(
        address indexed wallet, bytes32 indexed missionId, bytes32 period, uint256 progress, bool completed
    );
    event MissionCompleted(address indexed wallet, bytes32 indexed missionId, bytes32 period, uint256 reward);
    event PayoutPending(address indexed wallet, bytes32 indexed missionId, bytes32 period, uint256 reward);
    event PayoutClaimed(address indexed wallet, bytes32 indexed missionId, bytes32 period, uint256 reward);
    event ProgressOracleSet(address indexed oracle);
    event PausedSet(bool paused);
    event Funded(address indexed from, uint256 amount, uint256 contractBalance);
    event Withdrawn(address indexed to, uint256 amount, uint256 contractBalance);
    event MinReserveSet(uint256 minReserve);
    event ReservesLow(uint256 balance, uint256 minReserve);

    error OnlyOwner();
    error OnlyOracle();
    error BadParam();
    error Paused();
    error NotFound();
    error NotActive();
    error AlreadyCompleted();
    error PrerequisiteNotMet();
    error InsufficientReserves();
    error ReserveFloor();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(IChips chips_, address progressOracle_, address owner_) {
        if (address(chips_) == address(0) || owner_ == address(0)) revert BadParam();
        chips = chips_;
        owner = owner_;
        // No oracle at deploy? The owner wears the oracle hat.
        progressOracle = progressOracle_ == address(0) ? owner_ : progressOracle_;
    }

    // ── Owner config ──────────────────────────────────────────────────────────

    function setProgressOracle(address oracle) external onlyOwner {
        if (oracle == address(0)) revert BadParam();
        progressOracle = oracle;
        emit ProgressOracleSet(oracle);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    function setMinReserve(uint256 r) external onlyOwner {
        minReserve = r;
        emit MinReserveSet(r);
    }

    /// @notice Create or update a mission's on-chain definition.
    /// @param reward CHIPS base units (1e18). 0 = track-only mission (no payout).
    /// @param target Progress threshold; 0 means the first progress event completes it.
    /// @param prerequisite missionId (bytes32) that must be completed first; 0 = none.
    function setMission(
        bytes32 missionId,
        MissionKind kind,
        uint256 reward,
        uint256 target,
        bytes32 prerequisite,
        bool active
    ) external onlyOwner {
        if (missionId == bytes32(0)) revert BadParam();
        missions[missionId] = Mission({
            exists: true,
            kind: kind,
            reward: reward,
            target: target,
            prerequisite: prerequisite,
            active: active
        });
        emit MissionSet(missionId, kind, reward, target, prerequisite, active);
    }

    // ── Period math (the on-chain schedule) ────────────────────────────────────

    /// @notice Active period for a mission, derived from `block.timestamp`.
    function currentPeriod(bytes32 missionId) public view returns (bytes32) {
        MissionKind kind = missions[missionId].kind;
        if (kind == MissionKind.ONCE) return ONCE_PERIOD;
        if (kind == MissionKind.DAY) return bytes32(block.timestamp / 1 days);
        return bytes32(block.timestamp / 7 days); // WEEK: rolling 7-day bucket
    }

    function periodKey(address wallet, bytes32 missionId, bytes32 period)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(wallet, missionId, period));
    }

    // ── Progress (oracle) ──────────────────────────────────────────────────────

    /// @notice Report gameplay progress for `wallet` on `missionId`.
    /// @dev Callable only by the trusted `progressOracle` (or the owner). The
    ///      contract decides completion: once progress >= target it flips
    ///      `completed` and pays (or queues) the reward. Idempotent after
    ///      completion — further calls for the same period are no-ops.
    function recordProgress(address wallet, bytes32 missionId, uint256 delta) external nonReentrant {
        if (paused) revert Paused();
        if (msg.sender != progressOracle && msg.sender != owner) revert OnlyOracle();
        if (delta == 0) revert BadParam();
        if (wallet == address(0)) revert BadParam();

        Mission storage m = missions[missionId];
        if (!m.exists) revert NotFound();
        if (!m.active) revert NotActive();

        bytes32 period = currentPeriod(missionId);

        // Already completed this period — nothing more to record.
        if (completed[wallet][missionId][period]) return;

        uint256 next = progress[wallet][missionId][period] + delta;
        if (next > m.target) next = m.target; // cap at target
        progress[wallet][missionId][period] = next;

        bool done = next >= m.target;
        if (done) _complete(wallet, missionId, period, m.prerequisite, m.reward);
        emit ProgressRecorded(wallet, missionId, period, next, done);
    }

    function _complete(
        address wallet,
        bytes32 missionId,
        bytes32 period,
        bytes32 prerequisite,
        uint256 reward
    ) private {
        bytes32 key = periodKey(wallet, missionId, period);
        // Prerequisite gate, evaluated in the prerequisite's own current period
        // (so an ONCE prereq is "ever completed", a DAY prereq "completed today").
        if (prerequisite != bytes32(0)) {
            bytes32 prereqPeriod = currentPeriod(prerequisite);
            if (!completed[wallet][prerequisite][prereqPeriod]) revert PrerequisiteNotMet();
        }

        completed[wallet][missionId][period] = true;

        if (reward == 0) {
            emit MissionCompleted(wallet, missionId, period, 0);
            return;
        }

        uint256 bal = chips.balanceOf(address(this));
        if (bal >= reward) {
            totalClaimed += reward;
            if (!chips.transferWithMemo(wallet, reward, MEMO)) revert BadParam();
            uint256 left = bal - reward;
            if (left < minReserve) emit ReservesLow(left, minReserve);
            emit MissionCompleted(wallet, missionId, period, reward);
        } else {
            // Reserve short: completion is recorded on-chain; payout is queued.
            pendingPayout[key] = reward;
            emit PayoutPending(wallet, missionId, period, reward);
        }
    }

    /// @notice Claim a payout that was queued because the reserve was short at
    ///         completion. Callable by the wallet, the oracle, or the owner.
    function claimPayout(address wallet, bytes32 missionId, bytes32 period) external nonReentrant {
        bytes32 key = periodKey(wallet, missionId, period);
        uint256 amt = pendingPayout[key];
        if (amt == 0) revert BadParam();
        if (msg.sender != wallet && msg.sender != progressOracle && msg.sender != owner) revert OnlyOracle();

        uint256 bal = chips.balanceOf(address(this));
        if (bal < amt) revert InsufficientReserves();

        pendingPayout[key] = 0;
        totalClaimed += amt;
        if (!chips.transferWithMemo(wallet, amt, MEMO)) revert BadParam();
        uint256 left = bal - amt;
        if (left < minReserve) emit ReservesLow(left, minReserve);
        emit PayoutClaimed(wallet, missionId, period, amt);
    }

    // ── Views ──────────────────────────────────────────────────────────────────

    /// @notice Progress + completion for an explicit period.
    function getProgress(address wallet, bytes32 missionId, bytes32 period)
        external
        view
        returns (uint256 p, bool done)
    {
        return (progress[wallet][missionId][period], completed[wallet][missionId][period]);
    }

    /// @notice Whether `wallet` has completed `missionId` in its current period.
    function isCompleted(address wallet, bytes32 missionId) external view returns (bool) {
        return completed[wallet][missionId][currentPeriod(missionId)];
    }

    // ── Funding / reserve ───────────────────────────────────────────────────────

    function fund(uint256 amount) external nonReentrant {
        if (amount == 0) revert BadParam();
        bool ok = chips.transferFrom(msg.sender, address(this), amount);
        if (!ok) revert BadParam();
        totalDeposited += amount;
        emit Funded(msg.sender, amount, chips.balanceOf(address(this)));
    }

    function availableReserves() public view returns (uint256) {
        uint256 bal = chips.balanceOf(address(this));
        return bal > minReserve ? bal - minReserve : 0;
    }

    function withdrawSurplus(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert BadParam();
        uint256 bal = chips.balanceOf(address(this));
        if (bal < amount || bal - amount < minReserve) revert ReserveFloor();
        totalWithdrawn += amount;
        bool ok = chips.transfer(owner, amount);
        if (!ok) revert BadParam();
        emit Withdrawn(owner, amount, chips.balanceOf(address(this)));
    }
}

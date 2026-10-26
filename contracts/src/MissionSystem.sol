// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IChips} from "./interfaces/IChips.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";
import {ECDSA} from "./lib/ECDSA.sol";
import {EIP712} from "./lib/EIP712.sol";

/// @title MissionSystem
/// @notice Fully on-chain mission authority with user pull claims and lazy free-match sync.
/// @dev Lifecycle:
///   1. Owner configures missions (kind ONCE/DAY/WEEK, reward in 1e18 CHIPS base units, target, prerequisite).
///   2. Paid matches and Arena betting pools report progress via oracle / server relayer.
///   3. Free matches are signed off-chain and batch-synced on-chain by the player via `syncFreeMatches` (player pays gas).
///   4. Reaching target marks the mission completed and claimable.
///   5. Player calls `claimMission(missionId)` individually to pull their reward (player pays gas).
///   6. Period rolls over every UTC midnight (DAY) or Sunday 00:00 UTC (WEEK). Past unclaimed rewards are forfeited.
contract MissionSystem is ReentrancyGuard {
    IChips public immutable chips;
    address public owner;
    address public progressOracle;
    bool public paused;

    enum MissionKind { ONCE, DAY, WEEK }

    struct Mission {
        bool exists;
        MissionKind kind;
        uint256 reward; // CHIPS base units (1e18); 0 = track-only
        uint256 target; // progress threshold (0 = completes on first progress event)
        bytes32 prerequisite; // missionId that must be completed first (0 = none)
        bool active;
    }

    struct FreeMatchAttestation {
        bytes32 matchId;
        address player;
        uint8 won;         // 1 = won, 0 = lost
        uint8 isPvp;       // 1 = pvp, 0 = bot/casual
        uint16 captures;   // number of opponent pawns captured
        uint64 playedAt;   // unix timestamp
        uint64 deadline;   // signature deadline
    }

    bytes32 public constant FREE_MATCH_TYPEHASH = keccak256(
        "FreeMatchAttestation(bytes32 matchId,address player,uint8 won,uint8 isPvp,uint16 captures,uint64 playedAt,uint64 deadline)"
    );

    // Canonical missionId bytes32 (keccak256 of string mission_id)
    bytes32 public constant DAILY_PLAY_3 = keccak256("daily_play_3");
    bytes32 public constant DAILY_WIN_1 = keccak256("daily_win_1");
    bytes32 public constant DAILY_CAPTURE_2 = keccak256("daily_capture_2");

    bytes32 public constant WEEKLY_PLAY_10 = keccak256("weekly_play_10");
    bytes32 public constant WEEKLY_WIN_3 = keccak256("weekly_win_3");
    bytes32 public constant WEEKLY_CAPTURE_10 = keccak256("weekly_capture_10");
    bytes32 public constant WEEKLY_PVP_2 = keccak256("weekly_pvp_2");

    /// @dev A constant, non-colliding period for one-time missions.
    bytes32 private constant ONCE_PERIOD = bytes32(uint256(1));
    bytes32 private constant MEMO = keccak256("mission:complete");

    mapping(bytes32 => Mission) public missions;

    /// @dev progress[wallet][missionId][period] -> accumulated progress.
    mapping(address => mapping(bytes32 => mapping(bytes32 => uint256))) public progress;
    /// @dev completed[wallet][missionId][period] -> done / eligible.
    mapping(address => mapping(bytes32 => mapping(bytes32 => bool))) public completed;
    /// @dev claimableReward[wallet][missionId][period] -> reward due.
    mapping(address => mapping(bytes32 => mapping(bytes32 => uint256))) public claimableReward;
    /// @dev claimed[periodKey] -> true if claimed.
    mapping(bytes32 => bool) public claimed;
    /// @dev matchSynced[matchId][player] -> true once free match is synced on-chain.
    mapping(bytes32 => mapping(address => bool)) public matchSynced;

    /// @dev pendingPayout[wallet|missionId|period] -> legacy short-reserve queue.
    mapping(bytes32 => uint256) public pendingPayout;

    // Funding / reserve accounting.
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
    event MissionClaimed(address indexed wallet, bytes32 indexed missionId, bytes32 period, uint256 reward);
    event FreeMatchSynced(
        address indexed player, bytes32 indexed matchId, uint8 won, uint8 isPvp, uint16 captures, uint64 playedAt
    );
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
    error AlreadyClaimed();
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
    /// DAY resets at UTC midnight; WEEK resets on Sunday 00:00:00 UTC.
    function currentPeriod(bytes32 missionId) public view returns (bytes32) {
        MissionKind kind = missions[missionId].kind;
        if (kind == MissionKind.ONCE) return ONCE_PERIOD;
        if (kind == MissionKind.DAY) return bytes32(block.timestamp / 1 days);
        // Epoch day 3 was Sunday, Jan 4 1970. (block.timestamp / 1 days + 4) / 7 rolls every Sunday 00:00 UTC.
        return bytes32((block.timestamp + 4 days) / 7 days);
    }

    function periodKey(address wallet, bytes32 missionId, bytes32 period)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(wallet, missionId, period));
    }

    // ── Progress recording (server relayer / oracle) ──────────────────────────

    /// @notice Report gameplay progress for `wallet` on `missionId`.
    /// @dev Called by progressOracle / server relayer upon Paid Match settle or Bet resolution.
    function recordProgress(address wallet, bytes32 missionId, uint256 delta) external nonReentrant {
        if (paused) revert Paused();
        if (msg.sender != progressOracle && msg.sender != owner) revert OnlyOracle();
        if (delta == 0) revert BadParam();
        if (wallet == address(0)) revert BadParam();

        _recordProgressInternal(wallet, missionId, delta);
    }

    function _recordProgressInternal(address wallet, bytes32 missionId, uint256 delta) internal {
        if (delta == 0) return;
        Mission storage m = missions[missionId];
        if (!m.exists || !m.active) return;

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
        if (prerequisite != bytes32(0)) {
            bytes32 prereqPeriod = currentPeriod(prerequisite);
            if (!completed[wallet][prerequisite][prereqPeriod]) revert PrerequisiteNotMet();
        }

        completed[wallet][missionId][period] = true;
        claimableReward[wallet][missionId][period] = reward;
        emit MissionCompleted(wallet, missionId, period, reward);
    }

    // ── Free match batch sync (Option 3: player-paid) ─────────────────────────

    /// @notice Batch-sync unsynced free matches onto the blockchain with server EIP-712 signatures.
    /// @dev Player submits this transaction and pays the gas.
    function syncFreeMatches(
        FreeMatchAttestation[] calldata matchAttestations,
        bytes[] calldata sigs
    ) external nonReentrant {
        if (paused) revert Paused();
        uint256 n = matchAttestations.length;
        if (n == 0 || n != sigs.length) revert BadParam();

        bytes32 domainSep = EIP712.domainHash("LudoBase MissionSystem", address(this));

        for (uint256 i = 0; i < n; i++) {
            FreeMatchAttestation calldata m = matchAttestations[i];
            if (m.player != msg.sender) revert BadParam();
            if (block.timestamp > m.deadline) revert BadParam();
            if (matchSynced[m.matchId][msg.sender]) revert AlreadyCompleted();

            bytes32 structHash = keccak256(
                abi.encode(
                    FREE_MATCH_TYPEHASH,
                    m.matchId,
                    m.player,
                    m.won,
                    m.isPvp,
                    m.captures,
                    m.playedAt,
                    m.deadline
                )
            );
            bytes32 digest = EIP712.digest(domainSep, structHash);
            address signer = ECDSA.recover(digest, sigs[i]);
            if (signer != progressOracle && signer != owner) revert OnlyOracle();

            matchSynced[m.matchId][msg.sender] = true;
            emit FreeMatchSynced(msg.sender, m.matchId, m.won, m.isPvp, m.captures, m.playedAt);

            // Daily missions: credited only if played in the current UTC day
            if (m.playedAt / 1 days == block.timestamp / 1 days) {
                _recordProgressInternal(msg.sender, DAILY_PLAY_3, 1);
                if (m.won > 0) _recordProgressInternal(msg.sender, DAILY_WIN_1, 1);
                if (m.captures > 0) _recordProgressInternal(msg.sender, DAILY_CAPTURE_2, uint256(m.captures));
            }

            // Weekly missions: credited only if played in the current Sunday-aligned week
            if ((m.playedAt + 4 days) / 7 days == (block.timestamp + 4 days) / 7 days) {
                _recordProgressInternal(msg.sender, WEEKLY_PLAY_10, 1);
                if (m.won > 0) _recordProgressInternal(msg.sender, WEEKLY_WIN_3, 1);
                if (m.captures > 0) _recordProgressInternal(msg.sender, WEEKLY_CAPTURE_10, uint256(m.captures));
                if (m.isPvp > 0) _recordProgressInternal(msg.sender, WEEKLY_PVP_2, 1);
            }
        }
    }

    // ── Pull claims (1:1 individual user claims) ──────────────────────────────

    /// @notice Pull claim for an individual mission in its current period.
    /// @dev Player calls this and pays the gas. Past periods roll over and unclaimed rewards are forfeited.
    function claimMission(bytes32 missionId) external nonReentrant {
        if (paused) revert Paused();
        bytes32 period = currentPeriod(missionId);
        bytes32 key = periodKey(msg.sender, missionId, period);

        if (!completed[msg.sender][missionId][period]) revert NotFound();
        if (claimed[key]) revert AlreadyClaimed();

        uint256 reward = claimableReward[msg.sender][missionId][period];
        if (reward == 0) revert BadParam();

        uint256 bal = chips.balanceOf(address(this));
        if (bal < reward) revert InsufficientReserves();

        claimed[key] = true;
        totalClaimed += reward;

        if (!chips.transferWithMemo(msg.sender, reward, MEMO)) revert BadParam();
        uint256 left = bal - reward;
        if (left < minReserve) emit ReservesLow(left, minReserve);

        emit MissionClaimed(msg.sender, missionId, period, reward);
    }

    /// @notice Legacy short-reserve fallback claim.
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

    function getProgress(address wallet, bytes32 missionId, bytes32 period)
        external
        view
        returns (uint256 p, bool done)
    {
        return (progress[wallet][missionId][period], completed[wallet][missionId][period]);
    }

    function isCompleted(address wallet, bytes32 missionId) external view returns (bool) {
        return completed[wallet][missionId][currentPeriod(missionId)];
    }

    function isClaimed(address wallet, bytes32 missionId) external view returns (bool) {
        return claimed[periodKey(wallet, missionId, currentPeriod(missionId))];
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

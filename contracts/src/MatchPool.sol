// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IChips} from "./interfaces/IChips.sol";
import {IERC1271} from "./interfaces/IERC1271.sol";
import {ECDSA} from "./lib/ECDSA.sol";
import {EIP712} from "./lib/EIP712.sol";
import {ReentrancyGuard} from "./lib/ReentrancyGuard.sol";

/// @title MatchPool
/// @notice Visible on-chain pots for paid Ludo Base matches (CHIPS_PLANNING v4.3).
contract MatchPool is ReentrancyGuard {
    enum Status {
        Open,
        Funded,
        Locked,
        Settled,
        Cancelled,
        Expired
    }

    enum PoolKind {
        Match,
        Predict
    }

    struct LobbyTicket {
        bytes32 roomCode;
        bytes32 matchId;
        address host;
        bytes32 seatsHash;
        uint8 gameMode;
        uint8 maxSeats;
        uint64 issuedAt;
    }

    struct PoolConfig {
        bytes32 poolId;
        bytes32 roomCode;
        bytes32 matchId;
        address host;
        bytes32 seatsHash;
        uint8 gameMode;
        uint8 maxSeats;
        uint8 poolKind;
        uint128 entryFee;
        uint128 protocolBps;
        uint128 burnBps;
        uint64 windowClosedAt;
        bytes32 parentPoolId;
        uint64 ticketIssuedAt;
    }

    struct Pool {
        bytes32 poolId;
        uint8 gameMode;
        uint8 poolKind;
        uint8 maxSeats;
        uint8 filledSeats;
        Status status;
        address authority;
        bytes32 ticketHash;
        uint128 entryFee;
        uint128 gross;
        uint128 protocolBps;
        uint128 burnBps;
        uint128 prizeFund;
        uint128 protocolAmount;
        uint128 burnAmount;
        uint128 hostBond;
        bytes32 resultHash;
        uint64 createdAt;
        uint64 lockedAt;
        uint64 settleBy;
        uint64 pauseDelta;
        uint64 refundGrace;
        uint64 settledAt;
        uint64 claimUnlockAt;
        uint64 windowClosedAt;
        bytes32 parentPoolId;
        uint256 settleNonce;
        bool bondSlashed;
    }

    struct Payout {
        address addr;
        uint256 amount;
    }

    bytes32 public constant LOBBY_TYPEHASH = keccak256(
        "LobbyTicket(bytes32 roomCode,bytes32 matchId,address host,bytes32 seatsHash,uint8 gameMode,uint8 maxSeats,uint64 issuedAt)"
    );
    bytes32 public constant SETTLE_TYPEHASH = keccak256(
        "ChipsMatchSettle(bytes32 poolId,bytes32 planHash,uint256 nonce,uint64 deadline,address authority)"
    );
    bytes32 public constant ABANDON_TYPEHASH = keccak256(
        "ChipsMatchAbandon(bytes32 poolId,address accusedSeat,uint64 seqAtDisconnect,uint8 afkStrikes,uint64 deadline)"
    );

    bytes32 public constant MEMO_FEE = keccak256("match:fee");
    bytes32 public constant MEMO_BURN = keccak256("match:burn");
    bytes32 public constant MEMO_PRIZE = keccak256("match:prize");
    bytes32 public constant MEMO_ABANDON = keccak256("match:abandon");
    bytes32 public constant MEMO_BOND = keccak256("match:bond");

    uint256 public constant MAX_PROTOCOL_BPS = 500;
    uint256 public constant MAX_BURN_BPS = 200;
    uint256 public constant DEFAULT_REFUND_GRACE = 180;
    uint256 public constant MAX_PREDICT_CUTOFF_EXTRA = 10 minutes;
    uint256 public constant BOND_BPS_OF_PRIZE = 200;
    uint256 public constant BOND_BPS_OF_GROSS = 100;

    IChips public immutable chips;
    address public owner;
    address public edgeSigner;
    address public claimHub;

    mapping(uint256 => bool) public entryTierAllowed;
    mapping(bytes32 => Pool) internal _pools;
    mapping(bytes32 => address[]) private _seats;
    mapping(bytes32 => uint8[]) private _seatColors;
    mapping(bytes32 => mapping(address => uint256)) public seatIndex;
    mapping(bytes32 => mapping(address => uint256)) public credit;
    mapping(bytes32 => mapping(address => bool)) public creditedJoin;
    mapping(bytes32 => mapping(address => bool)) public claimed;

    uint256 public cumulativeBurned;
    uint256 public cumulativeFees;

    event PoolCreated(bytes32 indexed poolId, address indexed authority, uint128 entryFee, uint8 maxSeats);
    event PoolJoined(bytes32 indexed poolId, address indexed player, uint8 seatIndex, uint128 entryFee);
    event PoolLocked(bytes32 indexed poolId, uint128 hostBond);
    event PoolSettled(bytes32 indexed poolId, uint8 mode, bytes32 resultHash, uint256 prizeFund);
    event PoolCancelled(bytes32 indexed poolId, string reason, bool bondSlashed);
    event PoolExpired(bytes32 indexed poolId);
    event PrizeClaimed(bytes32 indexed poolId, address indexed player, uint256 amount);
    event RefundClaimed(bytes32 indexed poolId, address indexed player, uint256 amount);
    event AbandonResolved(bytes32 indexed poolId, address indexed accusedSeat, bool dual, uint256 burned);
    event BondSlashed(bytes32 indexed poolId, uint256 amount);
    event EdgeSignerUpdated(address edgeSigner);
    event ClaimHubUpdated(address claimHub);
    event EntryTierSet(uint256 entryFee, bool allowed);

    error OnlyOwner();
    error OnlyHost();
    error OnlyClaimHub();
    error InvalidParam();
    error BadStatus();
    error NotSeated();
    error AlreadyJoined();
    error BadTicket();
    error BadFeeTier();
    error BadSignature();
    error BadDeadline();
    error TooEarly();
    error TooLate();
    error NotSettled();
    error NothingToClaim();
    error AlreadyClaimed();
    error SeatSquat();
    error TeamPairing();
    error SumMismatch();
    error DisputeLocked();
    error NoBond();
    error PredictCutoff();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(IChips chips_, address edgeSigner_, address owner_) {
        if (address(chips_) == address(0) || edgeSigner_ == address(0) || owner_ == address(0)) {
            revert InvalidParam();
        }
        chips = chips_;
        edgeSigner = edgeSigner_;
        owner = owner_;
        entryTierAllowed[1_000e18] = true;
        entryTierAllowed[10_000e18] = true;
    }

    function setEdgeSigner(address edgeSigner_) external onlyOwner {
        if (edgeSigner_ == address(0)) revert InvalidParam();
        edgeSigner = edgeSigner_;
        emit EdgeSignerUpdated(edgeSigner_);
    }

    function setClaimHub(address claimHub_) external onlyOwner {
        claimHub = claimHub_;
        emit ClaimHubUpdated(claimHub_);
    }

    function setEntryTier(uint256 entryFee, bool allowed) external onlyOwner {
        if (entryFee == 0) revert InvalidParam();
        entryTierAllowed[entryFee] = allowed;
        emit EntryTierSet(entryFee, allowed);
    }

    /// @notice Extend effective settleBy while TRANSFER|BURN is paused (section 4.3).
    /// @dev Phase 1: owner/Security multisig reports duration after unpause. Locked
    ///      pools only. Never shortens the deadline. `deltaSec` = unpauseAt - pauseAt.
    function addPauseDelta(bytes32 poolId, uint64 deltaSec) external onlyOwner {
        Pool storage p = _pools[poolId];
        if (p.status != Status.Locked) revert BadStatus();
        if (deltaSec == 0) revert InvalidParam();
        p.pauseDelta += deltaSec;
    }

    function seatsOf(bytes32 poolId) external view returns (address[] memory) {
        return _seats[poolId];
    }

    function seatColorsOf(bytes32 poolId) external view returns (uint8[] memory) {
        return _seatColors[poolId];
    }

    function effectiveSettleBy(bytes32 poolId) public view returns (uint64) {
        Pool storage p = _pools[poolId];
        return p.settleBy + p.pauseDelta;
    }

    function burnRatioInputs() external view returns (uint256 burned, uint256 fees) {
        return (cumulativeBurned, cumulativeFees);
    }

    /// @notice Compact pool summary (avoids auto-getter stack blowup on the full struct).
    function getPoolSummary(bytes32 poolId)
        external
        view
        returns (
            uint8 status,
            uint8 maxSeats,
            uint8 filledSeats,
            address authority,
            uint128 entryFee,
            uint128 gross,
            uint128 prizeFund,
            uint128 hostBond,
            uint64 settleBy,
            uint64 claimUnlockAt
        )
    {
        Pool storage p = _pools[poolId];
        return (
            uint8(p.status),
            p.maxSeats,
            p.filledSeats,
            p.authority,
            p.entryFee,
            p.gross,
            p.prizeFund,
            p.hostBond,
            p.settleBy + p.pauseDelta,
            p.claimUnlockAt
        );
    }

    function createPool(
        PoolConfig calldata a,
        address[] calldata seatWallets,
        uint8[] calldata seatColors,
        bytes calldata edgeTicketSig
    ) external {
        openPoolShell(a);
        bindPoolSeats(a, seatWallets, seatColors, edgeTicketSig);
    }

    function openPoolShell(PoolConfig calldata a) public {
        bytes32 poolId = a.poolId;
        if (_pools[poolId].createdAt != 0) revert BadStatus();
        if (a.maxSeats != 2 && a.maxSeats != 4) revert InvalidParam();
        if (a.gameMode > 2) revert InvalidParam();
        if (a.poolKind == uint8(PoolKind.Match) && a.entryFee == 0) revert InvalidParam();
        if (a.poolKind == uint8(PoolKind.Predict) && a.parentPoolId == bytes32(0)) revert InvalidParam();
        if (a.entryFee != 0 && !entryTierAllowed[a.entryFee]) revert BadFeeTier();
        if (a.protocolBps > MAX_PROTOCOL_BPS || a.burnBps > MAX_BURN_BPS) revert InvalidParam();
        if (a.host == address(0)) revert BadTicket();

        Pool storage p = _pools[poolId];
        p.poolId = poolId;
        p.gameMode = a.gameMode;
        p.poolKind = a.poolKind;
        p.maxSeats = a.maxSeats;
        p.status = Status.Open;
        p.authority = a.host;
        p.entryFee = a.entryFee;
        p.protocolBps = a.protocolBps;
        p.burnBps = a.burnBps;
        p.createdAt = uint64(block.timestamp);
        p.refundGrace = uint64(DEFAULT_REFUND_GRACE);
        p.windowClosedAt = a.windowClosedAt;
        p.parentPoolId = a.parentPoolId;
        p.settleNonce = 1;
    }

    function bindPoolSeats(
        PoolConfig calldata a,
        address[] calldata seatWallets,
        uint8[] calldata seatColors,
        bytes calldata edgeTicketSig
    ) public {
        bytes32 poolId = a.poolId;
        Pool storage p = _pools[poolId];
        if (p.createdAt == 0 || p.status != Status.Open) revert BadStatus();
        if (_seats[poolId].length != 0) revert BadStatus();
        if (seatWallets.length != p.maxSeats || seatColors.length != p.maxSeats) revert InvalidParam();

        bytes32 seatsHash = keccak256(abi.encode(seatWallets, seatColors));
        if (a.seatsHash != seatsHash) revert BadTicket();

        LobbyTicket memory t = LobbyTicket({
            roomCode: a.roomCode,
            matchId: a.matchId,
            host: a.host,
            seatsHash: a.seatsHash,
            gameMode: a.gameMode,
            maxSeats: a.maxSeats,
            issuedAt: a.ticketIssuedAt
        });
        bytes32 th = lobbyTicketHash(t);
        if (_recover(th, edgeTicketSig) != edgeSigner) revert BadTicket();
        p.ticketHash = th;

        if (p.poolKind == uint8(PoolKind.Predict)) {
            Pool storage parent = _pools[p.parentPoolId];
            if (parent.createdAt == 0) revert InvalidParam();
            uint64 bound = parent.lockedAt != 0
                ? parent.lockedAt + uint64(MAX_PREDICT_CUTOFF_EXTRA)
                : parent.createdAt + 1 hours;
            if (p.windowClosedAt == 0 || p.windowClosedAt > bound) revert PredictCutoff();
        }

        _seats[poolId] = seatWallets;
        _seatColors[poolId] = seatColors;
        for (uint256 i = 0; i < seatWallets.length; i++) {
            if (seatWallets[i] == address(0)) revert InvalidParam();
        }

        emit PoolCreated(poolId, p.authority, p.entryFee, p.maxSeats);
    }

    function joinPool(bytes32 poolId) external nonReentrant {
        Pool storage p = _pools[poolId];
        if (p.status != Status.Open) revert BadStatus();
        if (_seats[poolId].length == 0) revert BadStatus();
        if (p.poolKind == uint8(PoolKind.Predict) && block.timestamp > p.windowClosedAt) {
            revert PredictCutoff();
        }

        address[] storage seats = _seats[poolId];
        uint256 idx = type(uint256).max;
        for (uint256 i = 0; i < seats.length; i++) {
            if (seats[i] == msg.sender) {
                idx = i;
                break;
            }
        }
        if (idx == type(uint256).max) revert SeatSquat();
        if (seatIndex[poolId][msg.sender] != 0) revert AlreadyJoined();

        uint128 fee = p.entryFee;
        if (fee != 0) {
            bool ok = chips.transferFrom(msg.sender, address(this), fee);
            if (!ok) revert InvalidParam();
            p.gross += fee;
            creditedJoin[poolId][msg.sender] = true;
        }

        p.filledSeats += 1;
        seatIndex[poolId][msg.sender] = idx + 1;
        if (p.filledSeats == p.maxSeats) {
            p.status = Status.Funded;
        }
        emit PoolJoined(poolId, msg.sender, uint8(idx), fee);
    }

    function lockPool(bytes32 poolId, uint64 settleWindow) external {
        Pool storage p = _pools[poolId];
        if (msg.sender != p.authority) revert OnlyHost();
        if (p.status != Status.Funded) revert BadStatus();
        if (settleWindow < 5 minutes || settleWindow > 24 hours) revert InvalidParam();

        p.protocolAmount = uint128((uint256(p.gross) * p.protocolBps) / 10_000);
        p.burnAmount = uint128((uint256(p.gross) * p.burnBps) / 10_000);
        p.prizeFund = p.gross - p.protocolAmount - p.burnAmount;

        if (p.entryFee >= 1_000e18) {
            uint256 bond = (uint256(p.prizeFund) * BOND_BPS_OF_PRIZE) / 10_000;
            uint256 floorBond = (uint256(p.gross) * BOND_BPS_OF_GROSS) / 10_000;
            if (floorBond > bond) bond = floorBond;
            p.hostBond = uint128(bond);
            bool ok = chips.transferFrom(msg.sender, address(this), bond);
            if (!ok) revert NoBond();
        }

        p.status = Status.Locked;
        p.lockedAt = uint64(block.timestamp);
        p.settleBy = p.lockedAt + settleWindow;
        emit PoolLocked(poolId, p.hostBond);
    }

    function cancelOpen(bytes32 poolId) external {
        Pool storage p = _pools[poolId];
        if (msg.sender != p.authority) revert OnlyHost();
        if (p.status != Status.Open && p.status != Status.Funded) revert BadStatus();
        p.status = Status.Cancelled;
        emit PoolCancelled(poolId, "host-pre-lock", false);
    }

    function expirePool(bytes32 poolId, uint64 lobbyTtl) external {
        Pool storage p = _pools[poolId];
        if (p.status != Status.Open && p.status != Status.Funded) revert BadStatus();
        if (block.timestamp < p.createdAt + lobbyTtl) revert TooEarly();
        p.status = Status.Expired;
        emit PoolExpired(poolId);
    }

    function settlePool(
        bytes32 poolId,
        Payout[] memory payoutPlan,
        uint64 deadline,
        uint256 nonce,
        bytes memory hostSig,
        bytes memory edgeSig
    ) external nonReentrant {
        Pool storage p = _pools[poolId];
        if (p.status != Status.Locked) revert BadStatus();
        uint64 eff = p.settleBy + p.pauseDelta;
        bool modeB = block.timestamp > eff;
        if (!modeB && block.timestamp > deadline) revert BadDeadline();
        if (!modeB && block.timestamp > eff) revert TooLate();
        if (modeB && block.timestamp > eff + p.refundGrace + 24 hours) revert TooLate();

        bytes32 structHash = settleStructHash(poolId, payoutPlan, deadline, nonce, p.authority);
        bytes32 d = EIP712.digest(_domainSep(), structHash);
        if (!modeB) {
            if (!_verifyHost(d, hostSig, p.authority)) revert BadSignature();
        }
        if (_recover(d, edgeSig) != edgeSigner) revert BadSignature();
        if (nonce != p.settleNonce) revert BadSignature();
        p.settleNonce += 1;
        _applySettle(poolId, p, payoutPlan, modeB);
    }

    function submitAbandon(
        bytes32 poolId,
        address accusedSeat,
        uint64 seqAtDisconnect,
        uint8 afkStrikes,
        uint64 deadline,
        bytes calldata edgeSig
    ) external nonReentrant {
        _abandon(poolId, accusedSeat, seqAtDisconnect, afkStrikes, deadline, edgeSig, "", false);
    }

    function submitAbandonDual(
        bytes32 poolId,
        address accusedSeat,
        uint64 seqAtDisconnect,
        uint8 afkStrikes,
        uint64 deadline,
        bytes calldata edgeSig,
        bytes calldata hostSig
    ) external nonReentrant {
        _abandon(poolId, accusedSeat, seqAtDisconnect, afkStrikes, deadline, edgeSig, hostSig, true);
    }

    function claimMatch(bytes32 poolId) external nonReentrant {
        _claim(poolId, msg.sender);
    }

    function claimFor(bytes32 poolId, address player) external nonReentrant {
        if (msg.sender != claimHub) revert OnlyClaimHub();
        _claim(poolId, player);
    }

    function claimable(bytes32 poolId, address player) external view returns (uint256) {
        return credit[poolId][player];
    }

    function refundJoin(bytes32 poolId) external nonReentrant {
        Pool storage p = _pools[poolId];
        uint256 amt;
        if (p.status == Status.Settled) {
            if (block.timestamp < p.claimUnlockAt) revert DisputeLocked();
            amt = credit[poolId][msg.sender];
        } else if (p.status == Status.Cancelled || p.status == Status.Expired) {
            amt = creditedJoin[poolId][msg.sender] ? uint256(p.entryFee) : credit[poolId][msg.sender];
        } else {
            revert BadStatus();
        }
        if (amt == 0) revert NothingToClaim();
        if (claimed[poolId][msg.sender]) revert AlreadyClaimed();
        claimed[poolId][msg.sender] = true;
        credit[poolId][msg.sender] = 0;
        bool ok = chips.transferWithMemo(msg.sender, amt, MEMO_PRIZE);
        if (!ok) revert InvalidParam();
        emit RefundClaimed(poolId, msg.sender, amt);
    }

    function timeoutRefund(bytes32 poolId, bool unresolvable, bytes memory attestationSig)
        external
        nonReentrant
    {
        Pool storage p = _pools[poolId];
        if (p.status != Status.Locked) revert BadStatus();
        uint64 refundAt = p.settleBy + p.pauseDelta + p.refundGrace;
        if (block.timestamp < refundAt) revert TooEarly();
        if (!unresolvable) revert BadSignature();
        bytes32 msgHash =
            keccak256(abi.encodePacked("Ludo unresolvable", poolId, block.chainid, address(this)));
        if (_recover(msgHash, attestationSig) != edgeSigner) revert BadSignature();
        if (p.hostBond != 0 && !p.bondSlashed) {
            p.bondSlashed = true;
            emit BondSlashed(poolId, p.hostBond);
        }
        p.status = Status.Cancelled;
        _refundAllJoins(poolId, p);
        emit PoolCancelled(poolId, "unresolvable", p.bondSlashed);
    }

    function settleStructHash(
        bytes32 poolId,
        Payout[] memory payoutPlan,
        uint64 deadline,
        uint256 nonce,
        address authority
    ) public pure returns (bytes32) {
        bytes32 planHash = keccak256(abi.encode(payoutPlan));
        return keccak256(abi.encode(SETTLE_TYPEHASH, poolId, planHash, nonce, deadline, authority));
    }

    function lobbyTicketHash(LobbyTicket memory t) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                LOBBY_TYPEHASH,
                t.roomCode,
                t.matchId,
                t.host,
                t.seatsHash,
                t.gameMode,
                t.maxSeats,
                t.issuedAt
            )
        );
        return EIP712.digest(_domainSep(), structHash);
    }

    function _applySettle(bytes32 poolId, Pool storage p, Payout[] memory payoutPlan, bool modeB)
        private
    {
        uint256 sum;
        for (uint256 i = 0; i < payoutPlan.length; i++) {
            sum += payoutPlan[i].amount;
            if (seatIndex[poolId][payoutPlan[i].addr] == 0) revert NotSeated();
        }
        if (sum != p.prizeFund) revert SumMismatch();

        // 4-seat, 2 winners: 2v2 teammates (50/50) OR 4P podium (75/25).
        // Infer mode: TEAM_PAIRINGS pair → equal split; otherwise 4P rank split.
        if (p.maxSeats == 4 && payoutPlan.length == 2) {
            address w0 = payoutPlan[0].addr;
            address w1 = payoutPlan[1].addr;
            bool isTeam = _isTeamPair(poolId, w0, w1);
            address first = w0;
            address second = w1;
            if (seatIndex[poolId][first] > seatIndex[poolId][second]) {
                (first, second) = (second, first);
            }
            uint256 aAmt;
            uint256 bAmt;
            for (uint256 i = 0; i < payoutPlan.length; i++) {
                if (payoutPlan[i].addr == first) aAmt = payoutPlan[i].amount;
                else bAmt = payoutPlan[i].amount;
            }
            if (isTeam) {
                // 2v2: exact 50-50, dust to first winning seat (section 4.5 / M2).
                uint256 half = uint256(p.prizeFund) / 2;
                uint256 dust = uint256(p.prizeFund) % 2;
                if (aAmt != half + dust || bAmt != half) revert SumMismatch();
            } else {
                // 4P top-2: 1st 75%, 2nd 25% (remainder to 2nd keeps sum exact).
                uint256 firstDue = (uint256(p.prizeFund) * 75) / 100;
                uint256 secondDue = uint256(p.prizeFund) - firstDue;
                // Rank order: first (lower seatIndex) is 1st place unless payout order says otherwise.
                // Payout amounts encode rank: larger share = 1st. Enforce either assignment.
                uint256 hi = aAmt >= bAmt ? aAmt : bAmt;
                uint256 lo = aAmt >= bAmt ? bAmt : aAmt;
                if (hi != firstDue || lo != secondDue) revert SumMismatch();
            }
        }

        bool slashBond = modeB && p.hostBond != 0 && !p.bondSlashed;
        if (slashBond) {
            p.bondSlashed = true;
            emit BondSlashed(poolId, p.hostBond);
        }

        p.resultHash = keccak256(abi.encode(payoutPlan));
        p.status = Status.Settled;
        p.settledAt = uint64(block.timestamp);
        uint64 dw = p.entryFee >= 10_000e18 ? 10 minutes : p.entryFee >= 1_000e18 ? 5 minutes : 2 minutes;
        p.claimUnlockAt = p.settledAt + dw;

        for (uint256 i = 0; i < payoutPlan.length; i++) {
            credit[poolId][payoutPlan[i].addr] = payoutPlan[i].amount;
        }
        if (slashBond && payoutPlan.length == 1) {
            credit[poolId][payoutPlan[0].addr] += p.hostBond;
        }

        if (p.burnAmount != 0) {
            chips.burnWithMemo(p.burnAmount, MEMO_BURN);
            cumulativeBurned += p.burnAmount;
        }
        if (p.protocolAmount != 0) {
            chips.transferWithMemo(owner, p.protocolAmount, MEMO_FEE);
            cumulativeFees += p.protocolAmount;
        }
        if (p.hostBond != 0 && !p.bondSlashed) {
            chips.transferWithMemo(p.authority, p.hostBond, MEMO_BOND);
            p.hostBond = 0;
        }
        emit PoolSettled(poolId, modeB ? 1 : 0, p.resultHash, p.prizeFund);
    }

    function _claim(bytes32 poolId, address player) private {
        Pool storage p = _pools[poolId];
        if (p.status != Status.Settled) revert NotSettled();
        if (block.timestamp < p.claimUnlockAt) revert DisputeLocked();
        if (claimed[poolId][player]) revert AlreadyClaimed();
        uint256 amt = credit[poolId][player];
        if (amt == 0) revert NothingToClaim();
        claimed[poolId][player] = true;
        credit[poolId][player] = 0;
        bool ok = chips.transferWithMemo(player, amt, MEMO_PRIZE);
        if (!ok) revert InvalidParam();
        emit PrizeClaimed(poolId, player, amt);
    }

    function _abandon(
        bytes32 poolId,
        address accusedSeat,
        uint64 seqAtDisconnect,
        uint8 afkStrikes,
        uint64 deadline,
        bytes memory edgeSig,
        bytes memory hostSig,
        bool dual
    ) private {
        Pool storage p = _pools[poolId];
        if (p.status != Status.Locked) revert BadStatus();
        if (block.timestamp > deadline) revert BadDeadline();
        if (seatIndex[poolId][accusedSeat] == 0) revert NotSeated();

        bytes32 structHash = keccak256(
            abi.encode(ABANDON_TYPEHASH, poolId, accusedSeat, seqAtDisconnect, afkStrikes, deadline)
        );
        bytes32 d = EIP712.digest(_domainSep(), structHash);
        if (_recover(d, edgeSig) != edgeSigner) revert BadSignature();
        if (dual) {
            if (hostSig.length == 0 || !_verifyHost(d, hostSig, p.authority)) revert BadSignature();
        }

        uint256 burned;
        if (!dual) {
            p.status = Status.Cancelled;
            _refundAllJoins(poolId, p);
        } else {
            uint256 stake = p.entryFee;
            burned = stake / 2;
            p.prizeFund += uint128(stake - burned);
            if (burned != 0) {
                chips.burnWithMemo(burned, MEMO_ABANDON);
                cumulativeBurned += burned;
            }
            creditedJoin[poolId][accusedSeat] = false;
        }
        emit AbandonResolved(poolId, accusedSeat, dual, burned);
    }

    function _refundAllJoins(bytes32 poolId, Pool storage p) private {
        address[] storage seats = _seats[poolId];
        for (uint256 i = 0; i < seats.length; i++) {
            if (creditedJoin[poolId][seats[i]] && !claimed[poolId][seats[i]]) {
                credit[poolId][seats[i]] = p.entryFee;
            }
        }
        if (p.hostBond != 0 && !p.bondSlashed) {
            chips.transferWithMemo(p.authority, p.hostBond, MEMO_BOND);
            p.hostBond = 0;
        }
    }

    /// @dev TEAM_PAIRINGS Green+Blue vs Red+Yellow. Colors: 1=G, 2=Y, 3=R, 4=B.
    function _isTeamPair(bytes32 poolId, address a, address b) private view returns (bool) {
        uint8 ca = _seatColors[poolId][seatIndex[poolId][a] - 1];
        uint8 cb = _seatColors[poolId][seatIndex[poolId][b] - 1];
        bool teamGB = (ca == 1 && cb == 4) || (ca == 4 && cb == 1);
        bool teamRY = (ca == 3 && cb == 2) || (ca == 2 && cb == 3);
        return teamGB || teamRY;
    }

    function _domainSep() private view returns (bytes32) {
        return EIP712.domainHash("LudoBase MatchPool", address(this));
    }

    function _recover(bytes32 digestHash, bytes memory sig) private pure returns (address) {
        return ECDSA.recover(digestHash, sig);
    }

    /// @dev Host may be an EOA (ECDSA) or a deployed smart wallet (ERC-1271).
    ///      Counterfactual ERC-6492 wrappers are not unwrapped on-chain — deploy first.
    function _verifyHost(bytes32 digestHash, bytes memory sig, address host) private view returns (bool) {
        if (ECDSA.recover(digestHash, sig) == host) return true;
        if (host.code.length == 0) return false;
        try IERC1271(host).isValidSignature(digestHash, sig) returns (bytes4 magic) {
            return magic == IERC1271.isValidSignature.selector;
        } catch {
            return false;
        }
    }
}

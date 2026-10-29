/**
 * Pre-Flight Telemetry & Transaction Simulator.
 *
 * Simulates on-chain contract interactions and value transfers before the user
 * confirms in their wallet. Provides zero-gas revert protection, asset flow
 * analysis (You Send vs You Receive), and contract safety verification.
 */

import {
    createPublicClient,
    http,
    decodeFunctionData,
    formatUnits,
    formatEther,
    type Hex,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { MISSION_SYSTEM_ABI, missionSystemAddress } from './missionSystem';
import {
    CHIPS_ERC20_ABI,
    MATCH_POOL_ABI,
    CLAIM_HUB_ABI,
    SEASON_CLAIM_ABI,
    chipsAddress,
    matchPoolAddress,
    claimHubAddress,
    seasonClaimAddress,
    legacyClaimAddress,
} from './chips';
import { missionClaimAddress } from './missionVoucher';
import { MISSION_CLAIM_ABI } from '@/hooks/useMissionVoucher';
import { formatWeb3Error } from './web3Error';

export interface AssetMovement {
    label: string;
    amount: string;
    isGas?: boolean;
}

export interface PreflightTelemetry {
    status: 'idle' | 'simulating' | 'passed' | 'reverted';
    contractName: string;
    contractAddress: `0x${string}`;
    isVerifiedCore: boolean;
    methodName: string;
    revertReason?: string;
    estimatedGasEth?: string;
    assetFlow: {
        sending: AssetMovement[];
        receiving: AssetMovement[];
    };
    approvalSafety?: 'safe' | 'caution' | 'warning';
}

function getSimulationClient() {
    return createPublicClient({
        chain: baseSepolia,
        transport: http(),
    });
}

function resolveCoreContract(toAddr?: string): { name: string; isCore: boolean } {
    if (!toAddr) return { name: 'Unknown Target', isCore: false };
    const lower = toAddr.toLowerCase();

    if (lower === missionSystemAddress()?.toLowerCase()) {
        return { name: 'MissionSystem (Core)', isCore: true };
    }
    if (lower === chipsAddress()?.toLowerCase()) {
        return { name: 'CHIPS Token (Core)', isCore: true };
    }
    const usdcAddr = (process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e").toLowerCase();
    if (lower === usdcAddr) {
        return { name: 'USDC Token (Circle)', isCore: true };
    }
    if (lower === matchPoolAddress()?.toLowerCase()) {
        return { name: 'MatchPool (Ranked)', isCore: true };
    }
    if (lower === claimHubAddress()?.toLowerCase()) {
        return { name: 'ClaimHub (Rewards)', isCore: true };
    }
    if (lower === missionClaimAddress()?.toLowerCase()) {
        return { name: 'MissionClaim (Voucher)', isCore: true };
    }
    if (lower === seasonClaimAddress()?.toLowerCase()) {
        return { name: 'SeasonClaim (Airdrop)', isCore: true };
    }
    if (lower === legacyClaimAddress()?.toLowerCase()) {
        return { name: 'LegacyClaim (Snapshot)', isCore: true };
    }
    return { name: `${toAddr.slice(0, 6)}…${toAddr.slice(-4)}`, isCore: false };
}

interface DecodedCall {
    methodName: string;
    sending: AssetMovement[];
    receiving: AssetMovement[];
    approvalSafety?: 'safe' | 'caution' | 'warning';
}

function decodeCalldata(to: `0x${string}`, data: `0x${string}`, value?: bigint): DecodedCall {
    // 1. Native ETH transfer
    if (!data || data === '0x' || data === '0x0') {
        const valEth = value ? formatEther(value) : '0';
        return {
            methodName: 'Native ETH Transfer',
            sending: [{ label: 'Transfer Amount', amount: `${valEth} ETH` }],
            receiving: [{ label: 'Transfer Confirmation', amount: 'Payment Received' }],
        };
    }

    // 2. Try MissionSystem ABI
    try {
        const decoded = decodeFunctionData({ abi: MISSION_SYSTEM_ABI, data });
        if (decoded.functionName === 'claimMission') {
            return {
                methodName: 'Claim Mission Reward',
                sending: [],
                receiving: [{ label: 'Mission Payout', amount: '+Reward CHIPS' }],
            };
        }
        if (decoded.functionName === 'syncFreeMatches') {
            const attestations = (decoded.args?.[0] as unknown[]) || [];
            const count = attestations.length;
            return {
                methodName: 'Batch Match Sync',
                sending: [],
                receiving: [
                    {
                        label: 'Attestation Records',
                        amount: `+${count} Match${count === 1 ? '' : 'es'} On-Chain`,
                    },
                ],
            };
        }
    } catch { /* try next */ }

    // 3. Try ERC-20 ABI (CHIPS / USDC)
    try {
        const decoded = decodeFunctionData({ abi: CHIPS_ERC20_ABI, data });
        if (decoded.functionName === 'approve') {
            const rawAmount = decoded.args?.[1] as bigint | undefined;
            const isUsdc = to.toLowerCase() === (process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e").toLowerCase();
            const decimals = isUsdc ? 6 : 18;
            const symbol = isUsdc ? 'USDC' : 'CHIPS';
            const amount = rawAmount != null ? formatUnits(rawAmount, decimals) : '0';
            const isUnlimited = rawAmount != null && rawAmount >= (BigInt(1) << BigInt(250));
            const displayAmount = isUnlimited ? `Unlimited ${symbol}` : isUsdc ? `$${amount} USDC` : `${amount} CHIPS`;
            return {
                methodName: 'Token Allowance Approval',
                sending: [
                    {
                        label: 'Allowance Limit',
                        amount: displayAmount,
                    },
                ],
                receiving: [
                    {
                        label: 'Spender Authorization',
                        amount: isUnlimited ? 'High Allowance' : 'Exact Allowance',
                    },
                ],
                approvalSafety: isUnlimited ? 'warning' : 'safe',
            };
        }
        if (decoded.functionName === 'transfer') {
            const rawAmount = decoded.args?.[1] as bigint | undefined;
            const amount = rawAmount != null ? formatUnits(rawAmount, 18) : '0';
            return {
                methodName: 'Transfer CHIPS',
                sending: [{ label: 'Token Amount', amount: `${amount} CHIPS` }],
                receiving: [{ label: 'Recipient Delivery', amount: 'Transfer Receipt' }],
            };
        }
    } catch { /* try next */ }

    // 4. Try MatchPool ABI
    try {
        const decoded = decodeFunctionData({ abi: MATCH_POOL_ABI, data });
        if (decoded.functionName === 'joinPool') {
            return {
                methodName: 'Join Ranked Pool',
                sending: [{ label: 'Entry Fee', amount: 'Pool Stake' }],
                receiving: [{ label: 'Pool Registration', amount: 'Active Contestant' }],
            };
        }
        if (decoded.functionName === 'claimMatch') {
            return {
                methodName: 'Claim Pool Winnings',
                sending: [],
                receiving: [{ label: 'Prize Distribution', amount: '+Pool Winnings' }],
            };
        }
        if (decoded.functionName === 'settlePool') {
            return {
                methodName: 'Settle Match Pool',
                sending: [],
                receiving: [{ label: 'Payout Distribution', amount: 'Verified Payouts' }],
            };
        }
        if (decoded.functionName === 'refundJoin') {
            return {
                methodName: 'Refund Pool Entry',
                sending: [],
                receiving: [{ label: 'Stake Return', amount: '+Refunded Stake' }],
            };
        }
    } catch { /* try next */ }

    // 5. Try ClaimHub ABI
    try {
        const decoded = decodeFunctionData({ abi: CLAIM_HUB_ABI, data });
        if (decoded.functionName === 'claimMany') {
            const poolIds = (decoded.args?.[0] as unknown[]) || [];
            return {
                methodName: 'Batch Claim Pools',
                sending: [],
                receiving: [
                    {
                        label: 'Batch Payout',
                        amount: `+${poolIds.length} Pools Claimed`,
                    },
                ],
            };
        }
    } catch { /* try next */ }

    // 6. Try MissionClaim ABI
    try {
        const decoded = decodeFunctionData({ abi: MISSION_CLAIM_ABI, data });
        if (decoded.functionName === 'claim') {
            const rawAmount = decoded.args?.[2] as bigint | undefined;
            const amount = rawAmount != null ? formatUnits(rawAmount, 18) : '';
            return {
                methodName: 'Claim Voucher Reward',
                sending: [],
                receiving: [
                    {
                        label: 'Voucher Payout',
                        amount: amount ? `+${amount} CHIPS` : '+CHIPS',
                    },
                ],
            };
        }
    } catch { /* try next */ }

    // 7. Try SeasonClaim / LegacyClaim ABI
    try {
        const decoded = decodeFunctionData({ abi: SEASON_CLAIM_ABI, data });
        if (decoded.functionName === 'claim') {
            return {
                methodName: 'Redeem Season Reward',
                sending: [],
                receiving: [{ label: 'Airdrop Payout', amount: '+CHIPS' }],
            };
        }
    } catch { /* try next */ }

    // Fallback generic call
    return {
        methodName: 'Contract Execution',
        sending: value && value > BigInt(0) ? [{ label: 'Value Attached', amount: `${formatEther(value)} ETH` }] : [],
        receiving: [{ label: 'State Transition', amount: 'On-Chain Mutation' }],
    };
}

/**
 * Computes immediate, static pre-flight telemetry from calldata and addresses (zero-latency).
 */
export function getInitialTelemetry(req: {
    to: `0x${string}`;
    data?: `0x${string}`;
    value?: bigint;
}): PreflightTelemetry {
    const { to, data = '0x' as Hex, value = BigInt(0) } = req;
    const { name: contractName, isCore: isVerifiedCore } = resolveCoreContract(to);
    const decoded = decodeCalldata(to, data, value);

    return {
        status: 'simulating',
        contractName,
        contractAddress: to,
        isVerifiedCore,
        methodName: decoded.methodName,
        approvalSafety: decoded.approvalSafety,
        assetFlow: {
            sending: [...decoded.sending],
            receiving: [...decoded.receiving],
        },
    };
}

/**
 * Runs a pre-flight simulation against Base Sepolia.
 * Returns immediate static telemetry, then validates execution via RPC call.
 */
export async function simulatePreflight(req: {
    from?: `0x${string}`;
    to: `0x${string}`;
    data?: `0x${string}`;
    value?: bigint;
}): Promise<PreflightTelemetry> {
    const { to, data = '0x' as Hex, value = BigInt(0), from } = req;
    const baseTelemetry = getInitialTelemetry({ to, data, value });

    try {
        const client = getSimulationClient();

        // Run dry-run execution and gas estimation concurrently
        const [gasEstimate, gasPrice] = await Promise.all([
            client.estimateGas({
                account: from,
                to,
                data,
                value,
            }).catch(async (estErr) => {
                // If estimateGas throws, run eth_call to get the precise revert reason
                await client.call({
                    account: from,
                    to,
                    data,
                    value,
                });
                throw estErr;
            }),
            client.getGasPrice().catch(() => BigInt(10_000_000)), // 0.01 gwei fallback
        ]);

        const gasWei = gasEstimate * gasPrice;
        const gasEth = `~${Number(formatEther(gasWei)).toFixed(6)} ETH`;

        // Prepend network gas fee to outgoing asset flow
        const sendingWithGas: AssetMovement[] = [
            ...baseTelemetry.assetFlow.sending,
            { label: 'Network Gas Fee', amount: gasEth, isGas: true },
        ];

        return {
            ...baseTelemetry,
            status: 'passed',
            estimatedGasEth: gasEth,
            assetFlow: {
                sending: sendingWithGas,
                receiving: baseTelemetry.assetFlow.receiving,
            },
        };
    } catch (err: unknown) {
        const revertReason = formatWeb3Error(err);
        return {
            ...baseTelemetry,
            status: 'reverted',
            revertReason,
        };
    }
}

import { NextResponse } from 'next/server';
import { serviceDb } from './serverAuth';
import {
    assertFeatureEnabled,
    getServerConfig,
    type ConfigBuckets,
    type FeatureFlagKey,
} from './configRegistry';

export interface ConsentRecord {
    wallet_address: string;
    tos_version: string;
    privacy_version: string;
    age_18_confirmed: boolean;
    region_code: string;
    analytics_consent: boolean;
    eu_dma_acknowledged: boolean;
    ip_hash: string | null;
    accepted_at: string;
    updated_at: string;
}

export interface ComplianceStatus {
    compliant: boolean;
    country: string;
    isBlocked: boolean;
    isEuDma: boolean;
    missing: string[];
    requiredTosVersion: string;
    requiredPrivacyVersion: string;
    consent: ConsentRecord | null;
}

export type PaidPlayComplianceVerdict =
    | { ok: true; country: string; isEuDma: boolean }
    | {
          ok: false;
          status: 403 | 451 | 503;
          code: 'GEO_RESTRICTED' | 'FEATURE_DISABLED' | 'COMPLIANCE_REQUIRED';
          error: string;
          country?: string;
          missing?: string[];
      };

export function extractCountryCode(request: Request): string {
    const raw =
        request.headers.get('cf-ipcountry') ||
        request.headers.get('x-vercel-ip-country') ||
        request.headers.get('x-country-code') ||
        'XX';
    const upper = raw.trim().toUpperCase();
    return /^[A-Z]{2}$/.test(upper) ? upper : 'XX';
}

export async function hashClientIp(request: Request): Promise<string | null> {
    const raw =
        request.headers.get('cf-connecting-ip') ||
        request.headers.get('x-forwarded-for')?.split(',')[0] ||
        request.headers.get('x-real-ip') ||
        '';
    const ip = raw.trim();
    if (!ip) return null;

    const salt = process.env.COMPLIANCE_IP_SALT || 'ludo-compliance-ip-v1';
    const bytes = new TextEncoder().encode(`${salt}:${ip}`);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

export function isBlockedCountry(country: string, cfg: ConfigBuckets): boolean {
    const normalized = country.trim().toUpperCase();
    return cfg[1005].blockedCountries.some((c) => c.toUpperCase() === normalized);
}

export function isEuDmaCountry(country: string, cfg: ConfigBuckets): boolean {
    const normalized = country.trim().toUpperCase();
    return cfg[1005].euDmaCountries.some((c) => c.toUpperCase() === normalized);
}

export async function getComplianceStatus(
    request: Request,
    walletAddress: string,
    cfgOverride?: ConfigBuckets,
): Promise<ComplianceStatus> {
    const cfg = cfgOverride ?? (await getServerConfig());
    const country = extractCountryCode(request);
    const isBlocked = isBlockedCountry(country, cfg);
    const isEuDma = isEuDmaCountry(country, cfg);
    const requiredTosVersion = cfg[1005].tosVersion;
    const requiredPrivacyVersion = cfg[1005].privacyVersion;

    const wallet = walletAddress.trim().toLowerCase();
    let consent: ConsentRecord | null = null;
    if (wallet) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- player_consents row query
        const db = serviceDb() as any;
        const { data } = await db
            .from('player_consents')
            .select(
                'wallet_address, tos_version, privacy_version, age_18_confirmed, region_code, analytics_consent, eu_dma_acknowledged, ip_hash, accepted_at, updated_at',
            )
            .eq('wallet_address', wallet)
            .maybeSingle();
        if (data) consent = data as ConsentRecord;
    }

    const missing: string[] = [];
    if (!consent || !consent.age_18_confirmed) missing.push('age_18');
    if (!consent || consent.tos_version !== requiredTosVersion) missing.push('tos');
    if (!consent || consent.privacy_version !== requiredPrivacyVersion) missing.push('privacy');
    if (isEuDma && (!consent || !consent.eu_dma_acknowledged)) missing.push('eu_dma');

    return {
        compliant: !isBlocked && missing.length === 0,
        country,
        isBlocked,
        isEuDma,
        missing,
        requiredTosVersion,
        requiredPrivacyVersion,
        consent,
    };
}

export async function requirePaidPlayCompliance(
    request: Request,
    walletAddress: string,
    featureFlag?: FeatureFlagKey,
    cfgOverride?: ConfigBuckets,
): Promise<PaidPlayComplianceVerdict> {
    const cfg = cfgOverride ?? (await getServerConfig());
    const country = extractCountryCode(request);
    if (isBlockedCountry(country, cfg)) {
        return {
            ok: false,
            status: 451,
            code: 'GEO_RESTRICTED',
            error: `Paid play and wagers are restricted in your region (${country}).`,
            country,
        };
    }

    if (featureFlag) {
        const flagGate = await assertFeatureEnabled(featureFlag, cfg);
        if (!flagGate.ok) {
            return {
                ok: false,
                status: 503,
                code: 'FEATURE_DISABLED',
                error: flagGate.error,
                country,
            };
        }
    }

    const status = await getComplianceStatus(request, walletAddress, cfg);
    if (!status.compliant) {
        return {
            ok: false,
            status: 403,
            code: 'COMPLIANCE_REQUIRED',
            error: 'Age verification (18+) and Terms acceptance required before paid play.',
            country: status.country,
            missing: status.missing,
        };
    }

    return { ok: true, country: status.country, isEuDma: status.isEuDma };
}

export function complianceErrorResponse(
    verdict: Extract<PaidPlayComplianceVerdict, { ok: false }>,
): NextResponse {
    return NextResponse.json(
        {
            error: verdict.error,
            code: verdict.code,
            ...(verdict.country ? { country: verdict.country } : {}),
            ...(verdict.missing ? { missing: verdict.missing } : {}),
        },
        { status: verdict.status },
    );
}

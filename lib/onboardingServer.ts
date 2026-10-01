/**
 * Server-only onboarding helpers.
 * Shared catalog/validation lives in onboardingShared so client components
 * never pull Node's crypto module into the browser bundle.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export * from './onboardingShared';

export function verifyGalxeHmac(
    rawBody: string,
    signatureHeader: string | null | undefined,
    secret: string | null | undefined,
): boolean {
    if (!rawBody || !signatureHeader || !secret) return false;
    const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
    const cleaned = signatureHeader.trim().replace(/^sha256=/i, '');
    if (!cleaned) return false;
    const provided = /^[0-9a-fA-F]{64}$/.test(cleaned)
        ? Buffer.from(cleaned, 'hex')
        : Buffer.from(cleaned, 'base64');
    if (provided.length !== expected.length || provided.length === 0) return false;
    return timingSafeEqual(provided, expected);
}

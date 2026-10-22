#!/usr/bin/env node
/**
 * check:no-p2p-formation gate (Phase S4)
 *
 * Verifies that legacy P2P formation mechanisms are completely removed from
 * gameplay code in hooks/ and app/:
 * - seatGuestPlayer
 * - JOIN_REQUEST
 * - resolveRoomHost
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const bannedPatterns = [
  { name: 'seatGuestPlayer', pattern: /\bseatGuestPlayer\b/ },
  { name: 'JOIN_REQUEST', pattern: /\bJOIN_REQUEST\b/ },
];

const bannedClientPatterns = [
  { name: 'resolveRoomHost', pattern: /\bresolveRoomHost\b/ },
];

function scanDir(dir) {
  let hasViolations = false;
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (scanDir(fullPath)) hasViolations = true;
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      const content = readFileSync(fullPath, 'utf8');
      for (const { name, pattern } of bannedPatterns) {
        if (pattern.test(content)) {
          console.error(`✗ P2P formation violation [${name}] in ${fullPath}`);
          hasViolations = true;
        }
      }
      if (!fullPath.startsWith('app/api/')) {
        for (const { name, pattern } of bannedClientPatterns) {
          if (pattern.test(content)) {
            console.error(`✗ P2P formation client violation [${name}] in ${fullPath}`);
            hasViolations = true;
          }
        }
      }
    }
  }
  return hasViolations;
}

const failedHooks = scanDir('hooks');
const failedApp = scanDir('app');

if (failedHooks || failedApp) {
  console.error('\n❌ check:no-p2p-formation failed: legacy P2P formation found');
  process.exit(1);
} else {
  console.log('✓ check:no-p2p-formation clean: zero P2P formation in hooks/ and app/');
  process.exit(0);
}

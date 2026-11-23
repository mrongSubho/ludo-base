import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEPLOY_THEMES, isDeployModeId } from '../lib/deployTheme';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('3077 Tactical Command Console & Deployment-Mode Theme', () => {
    it('defines Quick (Cyan), Team (Amber), and Offline (Emerald) deployment themes', () => {
        assert.equal(DEPLOY_THEMES.quick.hex, '#00E5FF');
        assert.equal(DEPLOY_THEMES.team.hex, '#F59E0B');
        assert.equal(DEPLOY_THEMES.offline.hex, '#00FF66');
        assert.equal(isDeployModeId('quick'), true);
        assert.equal(isDeployModeId('team'), true);
        assert.equal(isDeployModeId('offline'), true);
        assert.equal(isDeployModeId('invalid'), false);
    });

    it('places POWER mode first on the armed slide-breaker, supports Retro palette, and uses TerminalTypeText', () => {
        const deck = read('app/components/LobbyCommandDeck.tsx');
        assert.match(deck, /const MODE_ORDER:\s*readonly LobbyGameMode\[\]\s*=\s*\['power',\s*'classic'\]/);
        assert.match(deck, /useDeployTheme\(/);
        assert.match(deck, /themeVariant\s*=\s*'retro'/);
        assert.match(deck, /RETRO_DECK_PALETTES/);
        assert.match(deck, /<TerminalTypeText/);
        assert.doesNotMatch(deck, /lobby-deck-rivet/);
        assert.match(deck, /role="radiogroup"/);
        assert.match(deck, /aria-label="Select Game Mode"/);
        assert.match(deck, /aria-label="Match Type"/);
        assert.match(deck, /prefersReducedMotion/);
        assert.match(deck, /setPointerCapture/);
    });

    it('uses TEAM_PAIRINGS and seatedColorsFor as single source of truth for formation radar glyphs', () => {
        const deck = read('app/components/LobbyCommandDeck.tsx');
        assert.match(deck, /import \{ TEAM_PAIRINGS \} from '@\/lib\/constants'/);
        assert.match(deck, /import \{ seatedColorsFor \} from '@\/lib\/engine\/core'/);
        assert.match(deck, /seatedColorsFor\(type\)/);
        assert.match(deck, /TEAM_PAIRINGS\.green/);
        assert.match(deck, /TEAM_PAIRINGS\.red/);
    });

    it('wires OrbitalCanopyDeck + OrbitalFeeDock + EntryFeeKnob into 3077 and LobbyCommandDeck + RetroSynthFeeFader into Retro', () => {
        const lobby = read('app/components/GameLobby.tsx');
        assert.match(lobby, /import \{ OrbitalCanopyDeck \} from '\.\/OrbitalCanopyDeck'/);
        assert.match(lobby, /import \{ OrbitalFeeDock \} from '\.\/OrbitalFeeDock'/);
        assert.match(lobby, /import \{ LobbyCommandDeck \} from '\.\/LobbyCommandDeck'/);
        assert.match(lobby, /import \{ RetroSynthFeeFader \} from '\.\/RetroSynthFeeFader'/);
        assert.match(lobby, /<OrbitalCanopyDeck[\s\S]*themeVariant="3077"/);
        assert.match(lobby, /<OrbitalFeeDock[\s\S]*expandedClassName="fee-tier-expanded-3077"/);
        assert.match(lobby, /<EntryFeeKnob/);
        assert.match(lobby, /<LobbyCommandDeck[\s\S]*themeVariant="retro"/);
        assert.match(lobby, /fee-tier-expanded-retro/);
        assert.match(lobby, /<RetroSynthFeeFader/);
        assert.match(lobby, /\{formatEntryFee\(wager\)\}/);
        assert.match(lobby, /\{formatEntryFee\(dialWager\)\}/);
        assert.doesNotMatch(lobby, /getEntryFeeTierName/);
    });

    it('defaults lobby boot to Power + 1v1 + Quick Match and syncs full HUD colors to ActionDice mode', () => {
        const page = read('app/page.tsx');
        assert.match(page, /useState<'classic' \| 'power'>\('power'\)/);
        assert.match(page, /useState<'1v1' \| '2v2' \| '4P'>\('1v1'\)/);

        const canopy = read('app/components/OrbitalCanopyDeck.tsx');
        assert.match(canopy, /CANOPY_MODES[\s\S]*id:\s*'power'[\s\S]*id:\s*'classic'/);

        const lobby = read('app/components/GameLobby.tsx');
        assert.match(lobby, /<DaybreakStudioDeck/);

        const studioDeck = read('app/components/DaybreakStudioDeck.tsx');
        assert.match(studioDeck, /DAYBREAK_MODE_ORDER:\s*readonly LobbyGameMode\[\]\s*=\s*\['power',\s*'classic'\]/);

        const dice = read('app/components/ActionDice.tsx');
        assert.match(dice, /setDeployModeTheme\(/);
        assert.match(dice, /-left-24 sm:-left-28/);
        assert.match(dice, /-right-24 sm:-right-28/);
        assert.match(dice, /<TerminalTypeText/);

        const css = read('app/styles/themes/theme-3077.css');
        assert.match(css, /body\.theme-3077\[data-deploy-mode="team"\]/);
        assert.match(css, /body\.theme-3077\[data-deploy-mode="offline"\]/);
        assert.match(css, /--accent-rgb/);
        assert.match(css, /\.hud-header-coins-3077/);
        assert.match(css, /\.hud-header-name-3077/);
        assert.match(css, /\.hud-header-rank-3077/);
        assert.match(css, /\.hud-header-action-3077/);
        assert.match(css, /\.panel-child-rail-3077/);
    });

    it('prints TerminalTypeText strictly left-to-right from a locked left edge', () => {
        const typeText = read('app/components/TerminalTypeText.tsx');
        assert.match(typeText, /className="invisible select-none whitespace-pre/);
        assert.match(typeText, /left-0 right-0 flex items-center justify-start text-left whitespace-pre/);
    });

    it('drives Settings preference icons, Wallet More/Hub, Marketplace CHIPS, ThinkingOrb, and shared HUD components via reactive accent tokens', () => {
        const settings = read('app/components/SettingsPanel.tsx');
        assert.match(settings, /icon=\{<MusicIcon \/>\}[ \t]*tint="bg-accent-soft text-accent"/);
        assert.match(settings, /icon=\{<HapticIcon \/>\}[ \t]*tint="bg-accent-soft text-accent"/);
        assert.match(settings, /icon=\{<LockIcon \/>\}[ \t]*tint="bg-accent-soft text-accent"[\s\S]*Transaction approval/);
        assert.doesNotMatch(settings, /tint="bg-warn\/15 text-warn"/);

        const wallet = read('app/components/WalletPanel.tsx');
        const walletMoreSlice = wallet.slice(
            wallet.indexOf('{screen === "more" && ('),
            wallet.indexOf('{screen === "allowance" && ('),
        );
        assert.match(walletMoreSlice, /className="w-5 h-5 text-accent"[\s\S]*?title="Vault & Claim Hub"/);
        assert.doesNotMatch(walletMoreSlice, /text-warn/);

        const claimHub = read('app/components/ClaimHubSheet.tsx');
        assert.match(claimHub, /bg-accent-soft border border-accent\/30 flex items-center justify-center text-accent shrink-0/);

        const panels = read('app/styles/panels.css');
        assert.match(panels, /\.cb-more-icon\s*\{[\s\S]*color:\s*var\(--accent\)/);
        assert.match(panels, /body\.theme-daybreak \.cb-more-icon\s*\{[\s\S]*color:\s*var\(--accent\)/);
        const retroCss = read('app/styles/themes/retro.css');
        assert.match(retroCss, /body\.theme-retro-futurism \.cb-more-icon/);

        for (const chipsFile of [
            'app/components/MarketplacePanel.tsx',
            'app/components/HeaderNavPanel.tsx',
            'app/components/BoardHeaderCompact.tsx',
            'app/components/QuickMatchPanel.tsx',
            'app/components/MatchStatsOverlay.tsx',
        ]) {
            const src = read(chipsFile);
            assert.doesNotMatch(src, /<ChipsHexIcon[^>]*text-warn/, `${chipsFile} must drive ChipsHexIcon with reactive accent`);
        }
        assert.doesNotMatch(read('app/components/HeaderNavPanel.tsx'), /showChips\s*\?\s*'text-accent'\s*:\s*'text-warn'/);

        const orb = read('app/components/ThinkingOrb.tsx');
        assert.match(orb, /useDeployTheme/);
        assert.match(orb, /deployTheme\.edge/);

        const reactiveComponents = [
            'app/components/ActionDice.tsx',
            'app/components/QuickMatchPanel.tsx',
            'app/components/TeamUpMatchPanel.tsx',
            'app/components/AllowanceHubSheet.tsx',
            'app/components/ClaimHubSheet.tsx',
            'app/components/SignWaitModal.tsx',
            'app/components/SessionAuthBanner.tsx',
            'app/components/WalletLinkPanel.tsx',
            'app/components/BoardHeaderCompact.tsx',
            'app/components/Board.tsx',
            'app/components/BoardGrid.tsx',
        ];
        for (const file of reactiveComponents) {
            const src = read(file);
            assert.doesNotMatch(src, /rgba\(0,\s*229,\s*255/, `${file} must not hardcode cyan rgba(0, 229, 255, ...)`);
            assert.doesNotMatch(src, /rgba\(34,\s*211,\s*238/, `${file} must not hardcode cyan rgba(34, 211, 238, ...)`);
        }
    });
});

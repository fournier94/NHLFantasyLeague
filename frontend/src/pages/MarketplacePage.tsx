import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import {
    acceptTradeOfferResponse,
    cancelTradeOffer,
    cancelTradeOfferResponse,
    createTradeOffer,
    rejectTradeOfferResponse,
    getTeamRoster,
    listReceivedResponses,
    listSentResponses,
    listTradeOffers,
    markOffersSeen,
    respondToTradeOffer,
    type CreateTradeOfferSlotRequest,
    type PlayerContractLine,
    type RespondToTradeOfferPick,
    type RosterEntry,
    type SeasonStatLine,
    type TeamRoster,
    type TradeOffer,
    type TradeOfferResponse,
    type TradeOfferSlot,
} from '@/api/client';
import { NhlTeamLogo } from '@/components/nhl/NhlTeamLogo';
import { NeonTitle } from '@/components/ui/NeonTitle';
import {
    clearMarketplacePopupRestore,
    consumeMarketplacePopupRestore,
    setMarketplacePopupRestore,
} from '@/lib/marketplacePopupRestoration';
import {
    clearPicksForOffer,
    getPicksForOffer,
    setPicksForOffer,
} from '@/lib/marketplaceTradeState';

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

type View = 'add' | 'browse' | 'received' | 'sent';

type PositionGroup = 'F' | 'D' | 'G';

interface SlotState {
    positionGroup: PositionGroup | '';
    offeringPlayerId: number | null;
    firstHandled: 'player' | 'position' | null;
    minContractYears: string;
    maxSalary: string;
    maxAge: string;
    minPointsLastYear: string;
}

const EMPTY_SLOT: SlotState = {
    positionGroup: '',
    offeringPlayerId: null,
    firstHandled: null,
    minContractYears: '',
    maxSalary: '',
    maxAge: '',
    minPointsLastYear: '',
};

const MAX_SLOTS = 10;

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function toPositionGroup(raw: string | null | undefined): PositionGroup {
    if (!raw) return 'F';

    const n = raw
        .trim()
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    if (
        n === 'G' ||
        n === 'GK' ||
        n === 'GB' ||
        n === 'GOALIE' ||
        n === 'GOALTENDER' ||
        n === 'GARDIEN' ||
        n === 'GARDIEN DE BUT'
    ) {
        return 'G';
    }

    if (
        n === 'D' ||
        n === 'LD' ||
        n === 'RD' ||
        n === 'DEFENSE' ||
        n === 'DEFENCE' ||
        n === 'DEFENSEMAN' ||
        n === 'DEFENCEMAN' ||
        n === 'LEFT DEFENSE' ||
        n === 'RIGHT DEFENSE' ||
        n === 'DEFENSEUR' ||
        n === 'ARRIERE'
    ) {
        return 'D';
    }

    return 'F';
}

function groupLabel(g: PositionGroup): string {
    switch (g) {
        case 'F':
            return 'Attaquant';
        case 'D':
            return 'Défenseur';
        case 'G':
            return 'Gardien';
    }
}

function groupLabelPlural(g: PositionGroup): string {
    switch (g) {
        case 'F':
            return 'Attaquants';
        case 'D':
            return 'Défenseurs';
        case 'G':
            return 'Gardiens';
    }
}

function parseOptionalInt(raw: string): number | null {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.floor(n);
}

function parseOptionalMoney(raw: string): number | null {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) return null;
    return n < 1000 ? Math.round(n * 1_000_000) : Math.round(n);
}

function compactSalary(raw: number | null): string {
    if (raw == null) return '—';
    const millions = raw / 1_000_000;
    return `${millions.toFixed(2).replace(/\.?0+$/, '')}M`;
}

function contractLabel(
    contract: PlayerContractLine | null,
): string | null {
    if (!contract) return null;

    const salary = compactSalary(contract.salary);
    const years =
        contract.yearsRemaining > 1
            ? `${contract.yearsRemaining} ans`
            : '1 an';

    return `${salary} · ${years}`;
}

function slotIsComplete(slot: SlotState): boolean {
    return slot.positionGroup !== '' && slot.firstHandled !== null;
}

function slotToRequest(slot: SlotState): CreateTradeOfferSlotRequest {
    return {
        positionGroup: slot.positionGroup,
        offeringPlayerId: slot.offeringPlayerId,
        demandMinContractYears: parseOptionalInt(slot.minContractYears),
        demandMaxSalary: parseOptionalMoney(slot.maxSalary),
        demandMaxAge: parseOptionalInt(slot.maxAge),
        demandMinPointsLastYear: parseOptionalInt(slot.minPointsLastYear),
    };
}

/**
 * Compact one-line summary of a slot, used by the collapsed state of
 * a slot in the "Ajouter une offre" panel. Shows the offered player
 * (if any) and the demanded position (if any):
 *
 *   - Both          : "Nick Suzuki · F · MTL → Défenseur"
 *   - Player only   : "Nick Suzuki · F · MTL"
 *   - Position only : "Cherche : Défenseur"
 *   - Neither       : "Aucune information"
 */
function slotSummary(
    slot: SlotState,
    entries: RosterEntry[],
): string {
    const pieces: string[] = [];

    if (slot.offeringPlayerId != null) {
        const entry = entries.find(
            (e) => e.playerId === slot.offeringPlayerId,
        );

        if (entry) {
            pieces.push(
                `${entry.firstName} ${entry.lastName} · ` +
                `${toPositionGroup(entry.position)} · ` +
                `${entry.nhlTeamAbbreviation}`,
            );
        }
    }

    if (slot.positionGroup !== '') {
        pieces.push(
            slot.offeringPlayerId != null
                ? `→ ${groupLabel(slot.positionGroup)}`
                : `Cherche : ${groupLabel(slot.positionGroup)}`,
        );
    }

    return pieces.length > 0 ? pieces.join(' ') : 'Aucune information';
}

/**
 * Compact one-line summary of the criteria currently set on a slot's
 * "Critères recherchés" form. Returns null when no criterion is set,
 * so the caller can fall back to the plain "Ajouter des critères"
 * label.
 *
 * Ex: "Contrat ≥ 3 ans · Salaire ≤ 8.5M · Âge ≤ 25 · Pts ≥ 40"
 */
function filterSummary(slot: SlotState): string | null {
    const pieces: string[] = [];

    const years = parseOptionalInt(slot.minContractYears);
    if (years != null) {
        pieces.push(`Contrat ≥ ${years} an${years > 1 ? 's' : ''}`);
    }

    const salary = parseOptionalMoney(slot.maxSalary);
    if (salary != null) {
        pieces.push(`Salaire ≤ ${compactSalary(salary)}`);
    }

    const age = parseOptionalInt(slot.maxAge);
    if (age != null) {
        pieces.push(`Âge ≤ ${age}`);
    }

    const pts = parseOptionalInt(slot.minPointsLastYear);
    if (pts != null) {
        pieces.push(`Pts ≥ ${pts}`);
    }

    return pieces.length > 0 ? pieces.join(' · ') : null;
}

/**
 * Reason a raw integer-looking input is invalid, or null when it's
 * fine. Empty string is always valid (means "no constraint").
 */
function invalidIntReason(raw: string): string | null {
    const t = raw.trim();
    if (t === '') return null;

    const n = Number(t);
    if (!Number.isFinite(n)) return 'Valeur non numérique';
    if (!Number.isInteger(n)) return 'Doit être un nombre entier';
    if (n < 0) return 'Doit être positif ou nul';
    return null;
}

/**
 * Same as invalidIntReason, but for money fields (decimals allowed).
 */
function invalidMoneyReason(raw: string): string | null {
    const t = raw.trim();
    if (t === '') return null;

    const n = Number(t);
    if (!Number.isFinite(n)) return 'Valeur non numérique';
    if (n < 0) return 'Doit être positif ou nul';
    return null;
}

/**
 * One invalid-criterion report, ready to be displayed in the
 * validation popup. `slotIndex` is the original index in the form's
 * `slots` array.
 */
interface CriteriaError {
    slotIndex: number;
    fieldLabel: string;
    rawValue: string;
    reason: string;
}

/**
 * Returns every invalid criteria field on the given slot. Empty
 * fields (no constraint) are ignored.
 */
function validateSlotCriteria(
    slot: SlotState,
    slotIndex: number,
): CriteriaError[] {
    const errors: CriteriaError[] = [];

    const salaryErr = invalidMoneyReason(slot.maxSalary);
    if (salaryErr) {
        errors.push({
            slotIndex,
            fieldLabel: 'Salaire max',
            rawValue: slot.maxSalary,
            reason: salaryErr,
        });
    }

    const ageErr = invalidIntReason(slot.maxAge);
    if (ageErr) {
        errors.push({
            slotIndex,
            fieldLabel: 'Âge max',
            rawValue: slot.maxAge,
            reason: ageErr,
        });
    }

    const ptsErr = invalidIntReason(slot.minPointsLastYear);
    if (ptsErr) {
        errors.push({
            slotIndex,
            fieldLabel: 'Points min. (an dernier)',
            rawValue: slot.minPointsLastYear,
            reason: ptsErr,
        });
    }

    return errors;
}

/**
 * Returns true when the given roster entry satisfies every criterion
 * on the given offer slot.
 *
 * Rules, in order:
 *   - Position group must match the slot's demanded position (F/D/G).
 *   - If a min contract years is required, the SUM of the player's
 *     current + second contract `yearsRemaining` must be >= that
 *     value. A player with a single contract uses just that one.
 *   - If a max salary is required, EVERY contract on the player
 *     (current AND second, if any) must have `salary` <= that value.
 *   - If a max age is required, the player's age must be <= that
 *     value. Players with no birth date on file are treated as
 *     ineligible for age-filtered demands.
 *   - If a min points-last-year is required, the player's last-season
 *     points must be >= that value.
 *
 * All filters are optional: a slot with only a position matches every
 * player of that position group.
 */
function playerMatchesSlotDemand(
    entry: RosterEntry,
    slot: TradeOfferSlot,
): boolean {
    if (toPositionGroup(entry.position) !== slot.positionGroup) {
        return false;
    }

    if (slot.demandMinContractYears != null) {
        const totalYears =
            (entry.currentContract?.yearsRemaining ?? 0) +
            (entry.secondContract?.yearsRemaining ?? 0);

        if (totalYears < slot.demandMinContractYears) {
            return false;
        }
    }

    if (slot.demandMaxSalary != null) {
        for (const c of [entry.currentContract, entry.secondContract]) {
            if (c && c.salary > slot.demandMaxSalary) {
                return false;
            }
        }
    }

    if (slot.demandMaxAge != null) {
        if (entry.age == null || entry.age > slot.demandMaxAge) {
            return false;
        }
    }

    if (slot.demandMinPointsLastYear != null) {
        const points = entry.lastSeason?.points ?? 0;
        if (points < slot.demandMinPointsLastYear) {
            return false;
        }
    }

    return true;
}

/**
 * Smooth-scrolls the element with the given DOM id so it lands just
 * below the sticky top bar. Deferred to the next tick so React can
 * commit any state change that expanded or created the target before
 * we measure its position. Every target carries a matching
 * `scroll-mt-[calc(var(--header-height,...))]` class, so the target
 * ends up under the nav bar instead of behind it.
 */
function scrollElementIntoView(elementId: string): void {
    window.setTimeout(() => {
        document
            .getElementById(elementId)
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
}

// ---------------------------------------------------------------------
// Shared inline styles
// ---------------------------------------------------------------------

const FRAME_BG = '#080D1A';
const FRAME_BORDER = 'rgba(0, 168, 255, 0.6)';
const FRAME_GLOW =
    '0 0 22px rgba(0, 168, 255, 0.35), inset 0 0 18px rgba(0, 168, 255, 0.08)';
const HEADER_GRADIENT =
    'linear-gradient(180deg, rgba(0, 168, 255, 0.12), rgba(0, 168, 255, 0.02))';

/**
 * Colors for the highlighted stat columns on every offer card's
 * stat table. Every entry uses the exact same hex as the matching
 * column on the Classement page, so a stat that reads a certain
 * way there reads the same way on the marketplace:
 *
 *   PTS -> PTS_HIGHLIGHT on ClassementPage (#00F0FF)
 *   FP  -> GOLD          on ClassementPage (#FFC72C)
 *
 * A column whose label is not in this map renders in the table's
 * default foreground color.
 */
const STAT_COLUMN_COLORS: Record<string, string> = {
    PTS: '#00F0FF',
    FP: '#FFC72C',
};

function statColumnColor(columnLabel: string): string | undefined {
    return STAT_COLUMN_COLORS[columnLabel];
}

/**
 * Offer card neon frame (contained filament technique).
 *
 * Thick cyan tube + thin pale-cyan filament + inward bloom. Nothing
 * extends outside the card's own bounding box.
 *
 * Filament color note: this used to be a warm near-white
 * (rgba(255, 253, 240, 0.95)) which read as a pure-white line
 * sitting inside the cyan tube. It is now a pale cyan so the whole
 * frame reads as a single cyan material — a bright core inside a
 * thicker cyan tube — rather than cyan-with-a-white-line-through-it.
 * Matches the search popup frame in TopBar.tsx.
 */
const OFFER_TUBE_COLOR = '#00C8FF';
const OFFER_TUBE_PX = 2;
const OFFER_FILAMENT = 'rgba(200, 245, 255, 0.9)';
const OFFER_BLOOM_NEAR = 'rgba(0, 200, 255, 0.55)';
const OFFER_BLOOM_FAR = 'rgba(0, 200, 255, 0.15)';

/**
 * Accepted-offer overrides for the contained-filament frame.
 *
 * Same two-layer build as the default cyan frame — a thick gold
 * tube under a thin pale-gold filament with an inward bloom — with
 * every color swapped from cyan to gold. Nothing extends past the
 * card's own bounding box: no drop-shadow, no blur, all light
 * stays inside the frame.
 *
 * Only the outer frame changes. The inner dividers, the ⇄ glyph,
 * and the demand-side text keep their original palette, so the
 * gold swap reads as a border-only cue.
 */
const ACCEPTED_TUBE_COLOR = '#FFC72C';
const ACCEPTED_FILAMENT = 'rgba(255, 250, 220, 0.95)';
const ACCEPTED_BLOOM_NEAR = 'rgba(255, 199, 44, 0.55)';
const ACCEPTED_BLOOM_FAR = 'rgba(255, 199, 44, 0.15)';

/**
 * Publish button neon. Same contained filament technique as the
 * offer card, applied to the button's own bounding box:
 *
 *   Layer 1 (outer)   : thick cyan border -- the tube.
 *   Layer 2 (middle)  : thin pale-cyan inset ring -- the filament.
 *   Layer 3 (inner)   : soft cyan inset bloom -- light spilling in.
 *
 * All contained. Nothing extends past the button's own box.
 *
 * Filament color note: previously #FFFDF0 (a warm near-white) which
 * read as a pure-white line inside the cyan tube. Now a pale cyan so
 * the button reads as one continuous cyan material, matching the
 * offer card and the search popup frame.
 */
const PUBLISH_TUBE_COLOR = '#00C8FF';
const PUBLISH_FILAMENT = 'rgba(200, 245, 255, 0.9)';
const PUBLISH_BLOOM_NEAR = 'rgba(0, 200, 255, 0.55)';
const PUBLISH_BLOOM_FAR = 'rgba(0, 200, 255, 0.2)';

const inputClass =
    'w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60';

const labelClass =
    'text-xs font-semibold uppercase tracking-wider text-[#7DD3FC]';

/**
 * Middle column width so the arrow sits on the divider cleanly.
 * On mobile it is deliberately narrow (20px) so the stat tables on
 * both sides get as much horizontal room as possible and the
 * rightmost stat column sits close to the middle divider. The
 * arrow glyph and the divider line are both absolutely
 * positioned, so neither depends on this width. Desktop keeps the
 * original 48px so the layout there is unchanged.
 */
const SLOT_ARROW_COL = 'w-5 md:w-12';

/**
 * How long the browse list must stay on screen before the frontend
 * fires markOffersSeen.
 */
const MARK_SEEN_DELAY_MS = 2000;

// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------

export default function MarketplacePage() {
    const { user } = useAuth();

    // Default view: browse (Regarder les offres).
    const [view, setView] = useState<View>('browse');
    const [browseRefreshTick, setBrowseRefreshTick] = useState(0);

    /**
 * When non-null, the ManagerRosterPopup is open for the team
 * described by this object. One popup at a time: a subsequent
 * click overwrites the value, and onClose resets it to null.
 *
 * Kept at the page level (not inside OfferCard) so two cards
 * can never show two popups simultaneously.
 *
 * initialPositionFilter is only read the first time the popup
 * mounts, i.e. right after the page itself mounts. It is set
 * when we restore from a pending popup restore (the user came
 * back from a PlayerPage he reached from inside the popup) and
 * left undefined on a fresh open so the popup falls back to
 * 'F'. Switching teams while the popup is already open does
 * NOT reset the filter, which is deliberate.
 */
    const [rosterPopupTeam, setRosterPopupTeam] = useState<{
        id: number;
        name: string;
        initialPositionFilter?: 'F' | 'D' | 'G';
    } | null>(null);

    /**
     * If the user just came back from a PlayerPage he reached by
     * clicking a player name inside the popup, reopen the popup on
     * the same team and with the same position filter. Consumes
     * the pending restore so it is only applied once.
     */
    useEffect(() => {
        const pending = consumeMarketplacePopupRestore();
        if (!pending) return;

        setRosterPopupTeam({
            id: pending.teamId,
            name: pending.teamName,
            initialPositionFilter: pending.positionFilter,
        });
    }, []);

    /**
  * Sub-view inside the "Marché" tab. Only relevant when
  * `view === 'browse'`.
  *
  *   'view'    → other managers' active offers (the default)
  *   'mine'    → only the offers the current user has published
  *   'publish' → the create-a-public-offer panel. Moved here from
  *               the old "Créer" sub-toggle so every action that
  *               targets the public marketplace lives under one
  *               tab: look at the market, see your listings, or
  *               add one.
  */
    const [browseSubView, setBrowseSubView] = useState<
        'view' | 'mine' | 'publish'
    >('view');

    // The "Créer" tab no longer has a sub-toggle. Its only remaining
    // option ("Envoyer une offre", not built yet) renders directly.
    // The old "Publier une annonce" sub-view now lives in the Marché
    // tab.

    return (
        <section className='-mt-4 space-y-4 sm:-mt-6'>
            <div className='mt-2 flex flex-col items-center gap-2'>
                <h2 className='text-center'>
                    <NeonTitle keepPulseOnMobile>Marketplace</NeonTitle>
                </h2>

                <div className='flex w-full flex-col items-center gap-3'>
                    <div
                        className='flex w-full items-center rounded-full border border-[#00A8FF] bg-[#050A18] p-0.5'
                        style={{
                            boxShadow:
                                '0 0 8px rgba(0, 168, 255, 0.7), 0 0 18px rgba(0, 168, 255, 0.45), 0 0 30px rgba(0, 168, 255, 0.2), inset 0 0 8px rgba(0, 168, 255, 0.15)',
                        }}
                    >
                        {/* Four tabs. Labels are responsive: a short
                            version on narrow screens so the four fit
                            in one row, the full label from sm up. */}

                        <button
                            type='button'
                            onClick={() => setView('browse')}
                            className={`flex-1 cursor-pointer whitespace-nowrap rounded-full px-1.5 py-0.5 text-[0.7rem] font-bold transition-all duration-200 sm:px-3 sm:text-sm ${view === 'browse'
                                ? 'bg-white text-[#1D1B61]'
                                : 'bg-transparent text-[#F2F5FA] hover:bg-[#00A8FF]/15 hover:text-white'
                                }`}
                            style={
                                view === 'browse'
                                    ? {
                                        boxShadow:
                                            '0 0 6px rgba(255, 255, 255, 0.9), 0 0 14px rgba(0, 168, 255, 0.75), 0 0 28px rgba(0, 168, 255, 0.45), 0 0 44px rgba(0, 168, 255, 0.2), inset 0 0 4px rgba(0, 168, 255, 0.35)',
                                        textShadow:
                                            '0 0 3px rgba(0, 168, 255, 0.9), 0 0 6px rgba(0, 168, 255, 0.5)',
                                    }
                                    : undefined
                            }
                        >
                            Marché
                        </button>

                        <button
                            type='button'
                            onClick={() => setView('add')}
                            className={`flex-1 cursor-pointer whitespace-nowrap rounded-full px-1.5 py-0.5 text-[0.7rem] font-bold transition-all duration-200 sm:px-3 sm:text-sm ${view === 'add'
                                ? 'bg-white text-[#1D1B61]'
                                : 'bg-transparent text-[#F2F5FA] hover:bg-[#00A8FF]/15 hover:text-white'
                                }`}
                            style={
                                view === 'add'
                                    ? {
                                        boxShadow:
                                            '0 0 6px rgba(255, 255, 255, 0.9), 0 0 14px rgba(0, 168, 255, 0.75), 0 0 28px rgba(0, 168, 255, 0.45), 0 0 44px rgba(0, 168, 255, 0.2), inset 0 0 4px rgba(0, 168, 255, 0.35)',
                                        textShadow:
                                            '0 0 3px rgba(0, 168, 255, 0.9), 0 0 6px rgba(0, 168, 255, 0.5)',
                                    }
                                    : undefined
                            }
                        >
                            <span className='hidden sm:inline'>Créer une offre</span>
                            <span className='sm:hidden'>Créer</span>
                        </button>

                        <button
                            type='button'
                            onClick={() => setView('received')}
                            className={`flex-1 cursor-pointer whitespace-nowrap rounded-full px-1.5 py-0.5 text-[0.7rem] font-bold transition-all duration-200 sm:px-3 sm:text-sm ${view === 'received'
                                ? 'bg-white text-[#1D1B61]'
                                : 'bg-transparent text-[#F2F5FA] hover:bg-[#00A8FF]/15 hover:text-white'
                                }`}
                            style={
                                view === 'received'
                                    ? {
                                        boxShadow:
                                            '0 0 6px rgba(255, 255, 255, 0.9), 0 0 14px rgba(0, 168, 255, 0.75), 0 0 28px rgba(0, 168, 255, 0.45), 0 0 44px rgba(0, 168, 255, 0.2), inset 0 0 4px rgba(0, 168, 255, 0.35)',
                                        textShadow:
                                            '0 0 3px rgba(0, 168, 255, 0.9), 0 0 6px rgba(0, 168, 255, 0.5)',
                                    }
                                    : undefined
                            }
                        >
                            <span className='hidden sm:inline'>Offres reçues</span>
                            <span className='sm:hidden'>Reçues</span>
                        </button>

                        <button
                            type='button'
                            onClick={() => setView('sent')}
                            className={`flex-1 cursor-pointer whitespace-nowrap rounded-full px-1.5 py-0.5 text-[0.7rem] font-bold transition-all duration-200 sm:px-3 sm:text-sm ${view === 'sent'
                                ? 'bg-white text-[#1D1B61]'
                                : 'bg-transparent text-[#F2F5FA] hover:bg-[#00A8FF]/15 hover:text-white'
                                }`}
                            style={
                                view === 'sent'
                                    ? {
                                        boxShadow:
                                            '0 0 6px rgba(255, 255, 255, 0.9), 0 0 14px rgba(0, 168, 255, 0.75), 0 0 28px rgba(0, 168, 255, 0.45), 0 0 44px rgba(0, 168, 255, 0.2), inset 0 0 4px rgba(0, 168, 255, 0.35)',
                                        textShadow:
                                            '0 0 3px rgba(0, 168, 255, 0.9), 0 0 6px rgba(0, 168, 255, 0.5)',
                                    }
                                    : undefined
                            }
                        >
                            <span className='hidden sm:inline'>Offres envoyées</span>
                            <span className='sm:hidden'>Envoyées</span>
                        </button>
                    </div>

                    {/*
                     * Sub-toggle, only visible while browsing offers.
                     *
                     *   Voir les offres → other managers' active offers
                     *   Vos offres      → only the offers I published
                     *
                     * Deliberately smaller and less glowy than the main
                     * segmented button so it reads as a subordinate
                     * filter, not as a fifth top-level tab.
                     */}
                    {view === 'browse' && (
                        <div className='flex items-center justify-center'>
                            <div
                                className='marketplace-sub-toggle flex items-center rounded-full border border-[#00E5FF]/60 bg-[#050A18]/80 p-0.5 text-xs'
                                style={{
                                    boxShadow:
                                        '0 0 6px rgba(0, 229, 255, 0.35), inset 0 0 6px rgba(0, 229, 255, 0.08)',
                                }}
                            >
                                <button
                                    type='button'
                                    onClick={() =>
                                        setBrowseSubView('view')
                                    }
                                    className={`cursor-pointer whitespace-nowrap rounded-full px-3 py-0.5 font-semibold transition-colors ${browseSubView === 'view'
                                            ? 'bg-[#00E5FF] text-[#080D1A]'
                                            : 'bg-transparent text-[#A6ECFF] hover:text-white'
                                        }`}
                                >
                                    Voir les offres
                                </button>

                                <button
                                    type='button'
                                    onClick={() =>
                                        setBrowseSubView('mine')
                                    }
                                    className={`cursor-pointer whitespace-nowrap rounded-full px-3 py-0.5 font-semibold transition-colors ${browseSubView === 'mine'
                                            ? 'bg-[#00E5FF] text-[#080D1A]'
                                            : 'bg-transparent text-[#A6ECFF] hover:text-white'
                                        }`}
                                >
                                    Vos offres actives
                                </button>

                                <button
                                    type='button'
                                    onClick={() =>
                                        setBrowseSubView('publish')
                                    }
                                    className={`cursor-pointer whitespace-nowrap rounded-full px-3 py-0.5 font-semibold transition-colors ${browseSubView === 'publish'
                                            ? 'bg-[#00E5FF] text-[#080D1A]'
                                            : 'bg-transparent text-[#A6ECFF] hover:text-white'
                                        }`}
                                >
                                    Publier une annonce
                                </button>
                            </div>
                        </div>
                    )}

                </div>
            </div>

            {view === 'add' && (
                <p className='rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground'>
                    Envoyer une offre — à venir.
                </p>
            )}

            {view === 'browse' && browseSubView !== 'publish' && (
                <BrowseOffersPanel
                    refreshTick={browseRefreshTick}
                    teamId={user?.fantasyTeamId ?? null}
                    mode={browseSubView}
                    onOpenTeamRoster={(id, name) =>
                        setRosterPopupTeam({ id, name })
                    }
                />
            )}

            {view === 'browse' && browseSubView === 'publish' && (
                <AddOfferPanel
                    onPublished={() => {
                        // We're already on the Marché tab; just refresh
                        // the lists and drop the user on "Vos offres" so
                        // he sees the offer he just published.
                        setBrowseRefreshTick((t) => t + 1);
                        setBrowseSubView('mine');
                    }}
                    teamId={user?.fantasyTeamId ?? null}
                    teamName={user?.fantasyTeamName ?? null}
                />
            )}

            {view === 'received' && (
                <ReceivedOffersPanel
                    refreshTick={browseRefreshTick}
                    onOpenTeamRoster={(id, name) =>
                        setRosterPopupTeam({ id, name })
                    }
                />
            )}

            {view === 'sent' && (
                <SentOffersPanel
                    refreshTick={browseRefreshTick}
                    onOpenTeamRoster={(id, name) =>
                        setRosterPopupTeam({ id, name })
                    }
                />
            )}

            {rosterPopupTeam && (
                <ManagerRosterPopup
                    teamId={rosterPopupTeam.id}
                    teamName={rosterPopupTeam.name}
                    initialPositionFilter={
                        rosterPopupTeam.initialPositionFilter
                    }
                    onClose={() => setRosterPopupTeam(null)}
                />
            )}
        </section>
    );
}

// ---------------------------------------------------------------------
// Add offer panel
// ---------------------------------------------------------------------

function AddOfferPanel({
    teamId,
    teamName,
    onPublished,
}: {
    teamId: number | null;
    teamName: string | null;
    onPublished: () => void;
}) {
    const [roster, setRoster] = useState<TeamRoster | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [slots, setSlots] = useState<SlotState[]>([{ ...EMPTY_SLOT }]);

    /**
     * Index of the slot currently expanded in the "Ajouter une offre"
     * panel. When there's only one slot it's always expanded; when
     * there are several, only this index is expanded and every other
     * slot renders as a compact summary button.
     */
    const [expandedSlotIndex, setExpandedSlotIndex] = useState(0);

    const [note, setNote] = useState('');

    /**
     * Whether the optional message textarea is expanded. Collapsed by
     * default; clicking the "Ajouter un message" button reveals it.
     */
    const [showNote, setShowNote] = useState(false);

    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

    /**
     * True while the publish preview popup is open. The popup shows
     * an OfferCard rendering of the offer about to be published.
     */
    const [showPreview, setShowPreview] = useState(false);

    /**
     * Invalid criteria reported by the last submit attempt. When
     * non-empty, the validation popup is open. Cleared once the user
     * acknowledges it.
     */
    const [criteriaErrors, setCriteriaErrors] = useState<
        CriteriaError[]
    >([]);

    /**
     * One-shot "focus this slot" request, fired when the user
     * acknowledges the validation popup. The `token` changes every
     * time so the effect below re-runs even when the same slot has
     * the same error twice in a row.
     */
    const [focusRequest, setFocusRequest] = useState<{
        slotIndex: number;
        token: number;
    } | null>(null);

    /**
     * The user's roster, loaded once so the preview popup can resolve
     * each slot's offered player (name, position, contracts).
     */
    const entries: RosterEntry[] = useMemo(
        () => roster?.entries ?? [],
        [roster],
    );

    /**
     * Fake TradeOffer built from the current slot state, used only to
     * render the OfferCard in the preview popup. It is never sent to
     * the API: the actual publish call rebuilds the request from the
     * slot state.
     */
    const previewOffer: TradeOffer = useMemo(
        () => ({
            id: 0,
            createdByFantasyTeamId: teamId ?? 0,
            createdByFantasyTeamName: teamName ?? 'Mon équipe',
            createdAt: new Date().toISOString(),
            note: note.trim() === '' ? null : note.trim(),
            status: 'Active',
            isMine: true,
            isNew: false,
            slots: slots
                .filter(slotIsComplete)
                .map((s, i) => {
                    const entry =
                        s.offeringPlayerId != null
                            ? entries.find(
                                (e) =>
                                    e.playerId ===
                                    s.offeringPlayerId,
                            ) ?? null
                            : null;

                    return {
                        slotIndex: i,
                        positionGroup: s.positionGroup,
                        offeringPlayerId: s.offeringPlayerId,
                        offeringPlayerNhlPlayerId:
                            entry?.nhlPlayerId ?? null,
                        offeringPlayerFirstName:
                            entry?.firstName ?? null,
                        offeringPlayerLastName:
                            entry?.lastName ?? null,
                        offeringPlayerNhlTeam:
                            entry?.nhlTeamAbbreviation ?? null,
                        offeringPlayerPosition:
                            entry?.position ?? null,
                        offeringPlayerAge: entry?.age ?? null,
                        offeringPlayerCurrentContract:
                            entry?.currentContract ?? null,
                        offeringPlayerSecondContract:
                            entry?.secondContract ?? null,
                        offeringPlayerCurrentSeasonStats:
                            entry?.currentSeason ?? null,
                        offeringPlayerLastSeasonStats:
                            entry?.lastSeason ?? null,
                        demandMinContractYears: parseOptionalInt(
                            s.minContractYears,
                        ),
                        demandMaxSalary: parseOptionalMoney(
                            s.maxSalary,
                        ),
                        demandMaxAge: parseOptionalInt(s.maxAge),
                        demandMinPointsLastYear: parseOptionalInt(
                            s.minPointsLastYear,
                        ),
                    };
                }),
        }),
        [slots, note, entries, teamId, teamName],
    );

    useEffect(() => {
        if (teamId == null) {
            setLoading(false);
            setLoadError("Aucune équipe ne vous est assignée.");
            return;
        }

        let cancelled = false;
        setLoading(true);
        setLoadError(null);

        getTeamRoster(teamId)
            .then((data) => {
                if (!cancelled) setRoster(data);
            })
            .catch(() => {
                if (!cancelled) {
                    setLoadError("Impossible de charger votre équipe.");
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [teamId]);

    const usedPlayerIds = useMemo(() => {
        const set = new Set<number>();
        for (const s of slots) {
            if (s.offeringPlayerId != null) set.add(s.offeringPlayerId);
        }
        return set;
    }, [slots]);

    function updateSlot(index: number, patch: Partial<SlotState>) {
        setSlots((current) =>
            current.map((s, i) => (i === index ? { ...s, ...patch } : s)),
        );
    }

    function resetSlot(index: number) {
        setSlots((current) =>
            current.map((s, i) => (i === index ? { ...EMPTY_SLOT } : s)),
        );
    }

    function handlePlayerChange(index: number, playerIdRaw: string) {
        const playerId = playerIdRaw === '' ? null : Number(playerIdRaw);
        const slot = slots[index];

        if (playerId == null) {
            updateSlot(index, {
                offeringPlayerId: null,
                firstHandled: slot.positionGroup !== '' ? 'position' : null,
            });
            return;
        }

        const entry = entries.find((e) => e.playerId === playerId);
        const group = entry ? toPositionGroup(entry.position) : '';

        updateSlot(index, {
            offeringPlayerId: playerId,
            positionGroup: group,
            firstHandled: 'player',
        });
    }

    function handlePositionChange(index: number, positionRaw: string) {
        const position =
            positionRaw === '' ? '' : (positionRaw as PositionGroup);

        const slot = slots[index];

        let clearPlayer = false;

        if (slot.offeringPlayerId != null && position !== '') {
            const entry = entries.find(
                (e) => e.playerId === slot.offeringPlayerId,
            );
            const group = entry ? toPositionGroup(entry.position) : '';
            if (group !== position) clearPlayer = true;
        }

        updateSlot(index, {
            positionGroup: position,
            firstHandled: slot.firstHandled ?? 'position',
            offeringPlayerId: clearPlayer ? null : slot.offeringPlayerId,
        });
    }

    function addSlot() {
        if (slots.length >= MAX_SLOTS) return;

        const newIndex = slots.length;

        setSlots((current) => [...current, { ...EMPTY_SLOT }]);

        // Expand the freshly added slot; every older slot collapses.
        setExpandedSlotIndex(newIndex);

        // Bring it into view under the header.
        scrollToSlot(newIndex);
    }

    function removeSlot(index: number) {
        if (slots.length <= 1) return;

        setSlots((current) => current.filter((_, i) => i !== index));

        // Shift the expanded index so we don't end up pointing at a
        // slot that no longer exists.
        setExpandedSlotIndex((current) => {
            if (index < current) return current - 1;
            if (index === current) return Math.max(0, current - 1);
            return current;
        });
    }

    function handleResetAll() {
        setSlots([{ ...EMPTY_SLOT }]);
        setNote('');
        setShowNote(false);
        setSubmitError(null);
        setSubmitSuccess(null);
    }

    /**
     * Original indices of the slots that are actually filled in. Any
     * empty slot the user added but left untouched is dropped on
     * submit, so it never reaches the API and doesn't appear in the
     * preview. Kept as original indices so the preview popup can map
     * a display index back to the real slot in `slots`.
     */
    const completeSlotIndices = useMemo(
        () =>
            slots
                .map((s, i) => ({ s, i }))
                .filter(({ s }) => slotIsComplete(s))
                .map(({ i }) => i),
        [slots],
    );

    const lastSlotComplete = slotIsComplete(slots[slots.length - 1]);
    const canAddSlot = lastSlotComplete && slots.length < MAX_SLOTS;

    /**
     * Only the first slot must be complete (the trade needs at least
     * one side). Any additional slot the user added but left empty is
     * simply ignored — submitting with just a filled slot #1 and an
     * empty slot #2 is allowed.
     */
    const canSubmit =
        slots.length > 0 &&
        slotIsComplete(slots[0]) &&
        !submitting;

    /**
  * Runs through every filled slot and returns every invalid
  * criteria field. Empty slots (the user added a slot but never
  * touched it) are skipped: they're dropped on submit anyway.
  */
    function collectCriteriaErrors(): CriteriaError[] {
        const all: CriteriaError[] = [];

        for (let i = 0; i < slots.length; i++) {
            if (!slotIsComplete(slots[i])) continue;
            all.push(...validateSlotCriteria(slots[i], i));
        }

        return all;
    }

    /**
     * Fires whenever a new focus request is set. Expands the target
     * slot (collapsing the others) and smoothly scrolls to it.
     */
    useEffect(() => {
        if (!focusRequest) return;
        setExpandedSlotIndex(focusRequest.slotIndex);
        scrollToSlot(focusRequest.slotIndex);
    }, [focusRequest]);

    /**
     * Clicked from the main form: validates the criteria fields and,
     * if anything is invalid, opens the validation popup instead of
     * the preview. Only when everything is valid does the preview
     * popup open.
     */
    function handleSubmit() {
        if (!canSubmit) return;

        const errors = collectCriteriaErrors();
        if (errors.length > 0) {
            setCriteriaErrors(errors);
            return;
        }

        setSubmitError(null);
        setShowPreview(true);
    }

    /**
     * Clicked from the sticky bar: validates then sends the offer.
     * If anything is invalid, opens the validation popup and stops.
     */
    async function handleConfirmPublish() {
        if (!canSubmit) return;

        const errors = collectCriteriaErrors();
        if (errors.length > 0) {
            setCriteriaErrors(errors);
            return;
        }

        setSubmitting(true);
        setSubmitError(null);
        setSubmitSuccess(null);

        try {
            const request = {
                slots: slots
                    .filter(slotIsComplete)
                    .map(slotToRequest),
                note: note.trim() === '' ? null : note.trim(),
            };

            await createTradeOffer(request);

            setSubmitSuccess('Offre publiée.');
            setShowPreview(false);
            handleResetAll();
            onPublished();
        } catch (err) {
            setSubmitError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
            setShowPreview(false);
        } finally {
            setSubmitting(false);
        }
    }

    /**
     * Scrolls the given slot editor into view under the sticky header.
     * Deferred to the next tick so React can commit the state change
     * (expanding a collapsed slot, adding a new one, or resetting the
     * form) before we measure the target's position. The
     * `scroll-mt-[calc(var(--header-height)...)]` class on each slot
     * keeps it landing below the nav bar instead of behind it.
     */
    function scrollToSlot(slotIndex: number) {
        scrollElementIntoView(`slot-editor-${slotIndex}`);
    }

    if (loading) {
        return (
            <p className='text-center text-muted-foreground'>Chargement...</p>
        );
    }

    if (loadError) {
        return (
            <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                {loadError}
            </p>
        );
    }

    return (
        <div className='space-y-3'>
            {submitSuccess && (
                <p className='rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400'>
                    {submitSuccess}
                </p>
            )}

            {submitError && (
                <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                    {submitError}
                </p>
            )}

            {slots.map((slot, index) => (
                <SlotEditor
                    key={index}
                    index={index}
                    slot={slot}
                    entries={entries}
                    usedPlayerIds={usedPlayerIds}
                    canRemove={slots.length > 1}
                    isExpanded={
                        slots.length === 1 ||
                        expandedSlotIndex === index
                    }
                    onToggle={() => {
                        setExpandedSlotIndex(index);
                        scrollToSlot(index);
                    }}
                    onPlayerChange={(id) => handlePlayerChange(index, id)}
                    onPositionChange={(p) => handlePositionChange(index, p)}
                    onFieldChange={(patch) => updateSlot(index, patch)}
                    onResetSlot={() => resetSlot(index)}
                    onRemove={() => removeSlot(index)}
                    forceOpenFilterToken={
                        focusRequest?.slotIndex === index
                            ? focusRequest.token
                            : 0
                    }
                />
            ))}

            <div
                className='sticky bottom-0 z-30 mt-3 flex w-full flex-col gap-2'
                style={{
                    backgroundColor: FRAME_BG,
                    paddingTop: '0.6rem',
                    paddingBottom: '0.75rem',
                }}
            >
                {/* Add-slot button, sticky with the action bar so the
                    user can always add a new player to the trade
                    without scrolling back up. */}
                {canAddSlot && (
                    <button
                        type='button'
                        onClick={addSlot}
                        className='w-full cursor-pointer rounded-lg border border-dashed border-[#00A8FF]/60 bg-transparent px-3 py-2 text-xs font-semibold transition-colors hover:bg-[#00A8FF]/10'
                    >
                        <span className='italic text-zinc-400'>
                            Ajouter un {slots.length + 1}e joueur à
                            l'échange (
                            <span className='font-bold not-italic text-emerald-400'>
                                optionnel
                            </span>
                            )
                        </span>
                    </button>
                )}

                {/* Message toggle / textarea, sticky with the action
                    bar so the user always sees where to add an
                    optional note without having to scroll. */}
                {showNote ? (
                    <div className='block'>
                        <div className='flex items-center justify-between gap-2'>
                            <span className='text-xs italic font-semibold uppercase tracking-wider text-white'>
                                Message (
                                <span className='font-bold not-italic text-emerald-400'>
                                    optionnel
                                </span>
                                )
                            </span>

                            <button
                                type='button'
                                onClick={() => setShowNote(false)}
                                aria-label='Réduire le message'
                                className='cursor-pointer rounded px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-[#7DD3FC] transition-colors hover:bg-[#00A8FF]/10 hover:text-[#00E5FF]'
                            >
                                ▲ Réduire
                            </button>
                        </div>
                        <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            rows={2}
                            maxLength={1000}
                            placeholder='Ex : je cherche un jeune défenseur, je peux ajouter un choix de repêchage.'
                            className={`mt-1 ${inputClass}`}
                        />
                    </div>
                ) : (
                        <button
                            type='button'
                            onClick={() => setShowNote(true)}
                            className='w-full cursor-pointer rounded-lg border border-dotted border-white/70 bg-transparent px-3 py-2 text-xs font-semibold transition-colors hover:bg-white/5'
                        >
                        <span className='italic text-zinc-400'>
                            Ajouter un message (
                            <span className='font-bold not-italic text-emerald-400'>
                                optionnel
                            </span>
                            )
                        </span>
                    </button>
                )}

                <div className='flex w-full items-stretch gap-2'>
                    <button
                        type='button'
                        disabled={!canSubmit || submitting}
                        onClick={handleSubmit}
                        className='flex-1 cursor-pointer whitespace-nowrap rounded-lg border-2 border-[#00C8FF] bg-transparent px-3 py-1.5 text-center text-xs font-semibold text-white transition-colors hover:bg-[#00A8FF]/10 disabled:cursor-not-allowed disabled:opacity-40'
                    >
                        Prévisualiser l'offre
                    </button>

                    <button
                        type='button'
                        disabled={!canSubmit || submitting}
                        onClick={handleConfirmPublish}
                        className='flex-1 cursor-pointer whitespace-nowrap rounded-lg px-3 py-1.5 text-center text-xs font-bold uppercase tracking-wider text-[#F2F5FA] transition-opacity disabled:cursor-not-allowed disabled:opacity-40'
                        style={{
                            backgroundColor: FRAME_BG,
                            border: `3px solid ${PUBLISH_TUBE_COLOR}`,
                            boxShadow: [
                                `inset 0 0 0 1px ${PUBLISH_FILAMENT}`,
                                `inset 0 0 12px ${PUBLISH_BLOOM_NEAR}`,
                                `inset 0 0 28px ${PUBLISH_BLOOM_FAR}`,
                            ].join(', '),
                        }}
                    >
                        {submitting ? '...' : 'Publier'}
                    </button>
                </div>
            </div>

            {/*
             * Validation popup. Shown when the user tries to publish
             * an offer that has at least one invalid criteria field.
             * Lists every invalid field with the offending value and
             * reason. Clicking OK closes the popup and focuses the
             * first invalid slot.
             */}
            {criteriaErrors.length > 0 &&
                createPortal(
                    <div
                        className='fixed inset-0 z-[100] flex items-center justify-center px-4'
                        style={{ backgroundColor: '#080D1A' }}
                        role='dialog'
                        aria-modal='true'
                        aria-label='Valeurs invalides'
                    >
                        <div
                            className='w-full max-w-md overflow-hidden rounded-lg border'
                            style={{
                                borderColor: 'rgba(0, 168, 255, 0.6)',
                                backgroundColor: '#080D1A',
                                boxShadow:
                                    '0 0 22px rgba(0, 168, 255, 0.35), inset 0 0 18px rgba(0, 168, 255, 0.08)',
                            }}
                        >
                            <div
                                className='border-b px-3 py-2'
                                style={{
                                    borderColor:
                                        'rgba(0, 168, 255, 0.35)',
                                    background:
                                        'linear-gradient(180deg, rgba(0, 168, 255, 0.12), rgba(0, 168, 255, 0.02))',
                                }}
                            >
                                <p className='text-sm font-bold text-white'>
                                    Valeurs invalides
                                </p>
                            </div>

                            <div className='space-y-3 px-4 py-4'>
                                <p className='text-sm text-foreground'>
                                    Corrigez les champs suivants avant
                                    de publier votre offre :
                                </p>

                                <ul className='space-y-2'>
                                    {criteriaErrors.map((err, i) => (
                                        <li
                                            key={`${err.slotIndex}-${err.fieldLabel}-${i}`}
                                            className='rounded-md border px-3 py-2 text-xs'
                                            style={{
                                                borderColor:
                                                    'rgba(239, 68, 68, 0.35)',
                                                backgroundColor:
                                                    'rgba(239, 68, 68, 0.06)',
                                            }}
                                        >
                                            <p className='font-semibold text-white'>
                                                Joueur #{err.slotIndex + 1}
                                                {' · '}
                                                {err.fieldLabel}
                                            </p>
                                            <p className='mt-0.5 text-muted-foreground'>
                                                Valeur : « {err.rawValue} »
                                                {' — '}
                                                {err.reason}
                                            </p>
                                        </li>
                                    ))}
                                </ul>

                                <div className='flex justify-end'>
                                    <button
                                        type='button'
                                        onClick={() => {
                                            const first =
                                                criteriaErrors[0];
                                            setCriteriaErrors([]);
                                            if (first) {
                                                setFocusRequest({
                                                    slotIndex:
                                                        first.slotIndex,
                                                    token: Date.now(),
                                                });
                                            }
                                        }}
                                        className='cursor-pointer rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-emerald-950 transition-colors hover:bg-emerald-400'
                                    >
                                        OK
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>,
                    document.body,
                )}

            {/*
             * Publish preview popup. Renders the exact OfferCard the
             * browse tab uses, with three action buttons under it.
             * Portaled to document.body so it always sits above the
             * form and is never clipped.
             */}
            {showPreview &&
                createPortal(
                    <div
                        className='fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 overflow-y-auto px-4 py-6'
                        onClick={() => setShowPreview(false)}
                        role='dialog'
                        aria-modal='true'
                        aria-label="Aperçu de l'offre"
                        style={{ backgroundColor: '#080D1A' }}
                    >
                        <div
                            className='w-full max-w-md'
                            onClick={(e) => e.stopPropagation()}
                        >
                            <OfferCard
                                offer={previewOffer}
                                busy={false}
                                onCancel={() => { }}
                                userRoster={null}
                                hideInternalCancel
                                onSlotClick={(displayIndex) => {
                                    // The preview renumbers slots
                                    // after dropping empty ones; map
                                    // back to the real index in the
                                    // form's `slots` array.
                                    const realIndex =
                                        completeSlotIndices[
                                        displayIndex
                                        ];
                                    if (realIndex == null) return;

                                    setShowPreview(false);
                                    setExpandedSlotIndex(realIndex);
                                    scrollToSlot(realIndex);
                                }}
                            />
                        </div>

                        <div
                            className='flex w-full max-w-md items-center justify-center'
                            onClick={(e) => e.stopPropagation()}
                        >
                            <button
                                type='button'
                                onClick={() => setShowPreview(false)}
                                className='cursor-pointer rounded-lg border border-[#00C8FF] bg-transparent px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#00A8FF]/10'
                            >
                                Retour
                            </button>
                        </div>
                    </div>,
                    document.body,
                )}
        </div>
    );
}

// ---------------------------------------------------------------------
// One slot editor
// ---------------------------------------------------------------------

function SlotEditor({
    index,
    slot,
    entries,
    usedPlayerIds,
    canRemove,
    isExpanded,
    onToggle,
    onPlayerChange,
    onPositionChange,
    onFieldChange,
    onResetSlot,
    onRemove,
    forceOpenFilterToken,
}: {
    index: number;
    slot: SlotState;
    entries: RosterEntry[];
    usedPlayerIds: Set<number>;
    canRemove: boolean;
    isExpanded: boolean;
    onToggle: () => void;
    onPlayerChange: (playerIdRaw: string) => void;
    onPositionChange: (positionRaw: string) => void;
    onFieldChange: (patch: Partial<SlotState>) => void;
    onResetSlot: () => void;
    onRemove: () => void;
    /**
     * When this token changes to a non-zero value, the criteria
     * form auto-expands. Used by the validation popup so the user
     * lands directly on the offending field.
     */
    forceOpenFilterToken: number;
}) {
    /**
  * Opens the info popup when the user clicks the Demande dropdown
  * while it's locked by a selected Offre player.
  */
    const [showLockedPopup, setShowLockedPopup] = useState(false);

    /**
     * Whether the "Critères recherchés" form is expanded. Collapsed by
     * default so the slot doesn't take half the screen before the
     * user decides to filter.
     */
    const [filterExpanded, setFilterExpanded] = useState(false);

    // Open the criteria form whenever the parent bumps the token,
    // so that the validation flow lands the user on a visible
    // (not-collapsed) form.
    useEffect(() => {
        if (forceOpenFilterToken > 0) {
            setFilterExpanded(true);
        }
    }, [forceOpenFilterToken]);

    /**
     * Roster entries eligible for the "Offre" dropdown, grouped by
     * position group (F / D / G) and sorted alphabetically inside
     * each group.
     */
    const availablePlayersByGroup = useMemo(() => {
        const filtered = entries.filter((e) => {
            if (
                usedPlayerIds.has(e.playerId) &&
                e.playerId !== slot.offeringPlayerId
            ) {
                return false;
            }

            if (slot.positionGroup === '') return true;

            return toPositionGroup(e.position) === slot.positionGroup;
        });

        const groups: Record<PositionGroup, RosterEntry[]> = {
            F: [],
            D: [],
            G: [],
        };

        for (const entry of filtered) {
            groups[toPositionGroup(entry.position)].push(entry);
        }

        for (const key of ['F', 'D', 'G'] as const) {
            groups[key].sort((a, b) => {
                const byLast = a.lastName.localeCompare(b.lastName);
                if (byLast !== 0) return byLast;
                return a.firstName.localeCompare(b.firstName);
            });
        }

        return groups;
    }, [
        entries,
        usedPlayerIds,
        slot.positionGroup,
        slot.offeringPlayerId,
    ]);

    const showFilterForm = slot.positionGroup !== '';

    const slotIsEmpty =
        slot.positionGroup === '' &&
        slot.offeringPlayerId === null &&
        slot.minContractYears === '' &&
        slot.maxSalary === '' &&
        slot.maxAge === '' &&
        slot.minPointsLastYear === '';

    const positionLocked = slot.offeringPlayerId !== null;

    // When collapsed (only possible when there is more than one slot),
    // render a compact summary button instead of the full form.
    // Clicking it re-expands the full form for this slot and collapses
    // the others.
    if (!isExpanded) {
        return (
            <button
                id={`slot-editor-${index}`}
                type='button'
                onClick={onToggle}
                className='flex w-full scroll-mt-[calc(var(--header-height,4rem)+0.75rem)] items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors hover:brightness-110'
                style={{
                    borderColor: FRAME_BORDER,
                    backgroundColor: FRAME_BG,
                    boxShadow: FRAME_GLOW,
                }}
            >
                <span className='shrink-0 text-[0.65rem] font-bold uppercase tracking-wider text-[#00E5FF]'>
                    Joueur #{index + 1}
                </span>

                <span className='min-w-0 flex-1 truncate text-xs text-foreground'>
                    {slotSummary(slot, entries)}
                </span>

                <span
                    aria-hidden='true'
                    className='shrink-0 text-[#7DD3FC]'
                >
                    ▼
                </span>
            </button>
        );
    }

    return (
        <div
            id={`slot-editor-${index}`}
            className='overflow-hidden scroll-mt-[calc(var(--header-height,4rem)+0.75rem)] rounded-lg border'
            style={{
                borderColor: FRAME_BORDER,
                backgroundColor: FRAME_BG,
                boxShadow: FRAME_GLOW,
            }}
        >
            <div
                className='flex items-center justify-between gap-2 border-b px-3 py-2'
                style={{
                    borderColor: 'rgba(0, 168, 255, 0.35)',
                    background: HEADER_GRADIENT,
                }}
            >
                <span className='text-[0.65rem] font-bold uppercase tracking-wider text-[#00E5FF]'>
                    Joueur #{index + 1}
                </span>

                <div className='flex items-center gap-1'>
                    {!slotIsEmpty && (
                        <button
                            type='button'
                            onClick={onResetSlot}
                            className='cursor-pointer rounded px-2 py-0.5 text-xs font-semibold text-[#7DD3FC] transition-colors hover:bg-[#00A8FF]/10 hover:text-[#00E5FF]'
                        >
                            ↺ Réinitialiser
                        </button>
                    )}

                    {canRemove && (
                        <button
                            type='button'
                            onClick={onRemove}
                            className='cursor-pointer rounded px-2 py-0.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10'
                        >
                            Retirer
                        </button>
                    )}
                </div>
            </div>

            <div className='space-y-4 p-3'>
                <div className='space-y-2'>
                    <p className={labelClass}>
                        Offre (
                        <span className='font-bold text-emerald-400'>
                            Optionnel
                        </span>
                        )
                    </p>

                    <select
                        value={slot.offeringPlayerId ?? ''}
                        onChange={(e) => onPlayerChange(e.target.value)}
                        className={inputClass}
                    >
                        <option value=''>
                            — Ne pas offrir de joueur —
                        </option>

                        {(['F', 'D', 'G'] as const).map((groupKey) => {
                            const groupEntries =
                                availablePlayersByGroup[groupKey];

                            if (groupEntries.length === 0) {
                                return null;
                            }

                            return (
                                <optgroup
                                    key={groupKey}
                                    label={groupLabelPlural(groupKey)}
                                >
                                    {groupEntries.map((entry) => (
                                        <option
                                            key={entry.playerId}
                                            value={entry.playerId}
                                        >
                                            {entry.firstName}{' '}
                                            {entry.lastName} · {groupKey} ·{' '}
                                            {entry.nhlTeamAbbreviation}
                                        </option>
                                    ))}
                                </optgroup>
                            );
                        })}
                    </select>
                </div>

                <div className='space-y-2'>
                    <p className={labelClass}>Demande</p>

                    {/* Wrapper is `relative` so the transparent overlay
                        button can sit exactly on top of the disabled
                        select. Disabled selects do not fire click
                        events, so this is how we detect the user's
                        attempt to change the position. */}
                    <div className='relative'>
                        <select
                            value={slot.positionGroup}
                            onChange={(e) =>
                                onPositionChange(e.target.value)
                            }
                            disabled={positionLocked}
                            className={inputClass}
                        >
                            <option value=''>— Choisir une position —</option>
                            <option value='F'>Attaquant (F)</option>
                            <option value='D'>Défenseur (D)</option>
                            <option value='G'>Gardien (G)</option>
                        </select>

                        {positionLocked && (
                            <button
                                type='button'
                                aria-label='Position demandée verrouillée'
                                title='Retirez le joueur offert pour modifier la position demandée.'
                                onClick={() => setShowLockedPopup(true)}
                                className='absolute inset-0 cursor-pointer rounded-lg'
                            />
                        )}
                    </div>

                    {showFilterForm &&
                        (filterExpanded ? (
                            <FilterForm
                                slot={slot}
                                slotIndex={index}
                                onFieldChange={onFieldChange}
                                onCollapse={() =>
                                    setFilterExpanded(false)
                                }
                            />
                    ) : (
                        <button
                            type='button'
                            onClick={() => {
                                setFilterExpanded(true);
                                scrollElementIntoView(
                                    `filter-form-${index}`,
                                );
                            }}
                            className='mt-2 w-full cursor-pointer rounded-lg border border-dashed border-[#00A8FF]/60 bg-transparent px-3 py-2 text-xs font-semibold transition-colors hover:bg-[#00A8FF]/10'
                        >
                                {(() => {
                                    const summary =
                                        filterSummary(slot);

                                    if (summary) {
                                        return (
                                            <span className='italic text-zinc-400'>
                                                Critères :{' '}
                                                <span className='font-bold not-italic text-[#7DD3FC]'>
                                                    {summary}
                                                </span>
                                            </span>
                                        );
                                    }

                                    return (
                                        <span className='italic text-zinc-400'>
                                            Ajouter des critères
                                            recherchés (
                                            <span className='font-bold not-italic text-emerald-400'>
                                                optionnel
                                            </span>
                                            )
                                        </span>
                                    );
                                })()}
                            </button>
                        ))}
                </div>
            </div>

            {/*
             * Locked-demand popup. Portaled to document.body so it
             * renders above everything (the surrounding card uses
             * overflow-hidden, and portals guarantee the modal is
             * never clipped). Clicking the backdrop closes it, same
             * as the OK button.
             */}
            {showLockedPopup &&
                createPortal(
                    <div
                        className='fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4'
                        onClick={() => setShowLockedPopup(false)}
                        role='dialog'
                        aria-modal='true'
                        aria-label='Position demandée verrouillée'
                    >
                        <div
                            className='w-full max-w-sm overflow-hidden rounded-lg border'
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                borderColor: 'rgba(0, 168, 255, 0.6)',
                                backgroundColor: '#080D1A',
                                boxShadow:
                                    '0 0 22px rgba(0, 168, 255, 0.35), inset 0 0 18px rgba(0, 168, 255, 0.08)',
                            }}
                        >
                            <div
                                className='border-b px-3 py-2'
                                style={{
                                    borderColor:
                                        'rgba(0, 168, 255, 0.35)',
                                    background:
                                        'linear-gradient(180deg, rgba(0, 168, 255, 0.12), rgba(0, 168, 255, 0.02))',
                                }}
                            >
                                <p className='text-sm font-bold text-white'>
                                    Position demandée verrouillée
                                </p>
                            </div>

                            <div className='space-y-4 px-4 py-4'>
                                <p className='text-sm text-foreground'>
                                    Le joueur sélectionné de votre équipe
                                    est un{' '}
                                    <span className='font-semibold'>
                                        {groupLabel(
                                            slot.positionGroup as PositionGroup,
                                        ).toLowerCase()}
                                    </span>
                                    . Pour modifier la position demandée,
                                    vous devez d'abord retirer le joueur
                                    offert.
                                </p>

                                <div className='flex flex-col items-center gap-2'>
                                    <button
                                        type='button'
                                        onClick={() => {
                                            setShowLockedPopup(false);
                                            onResetSlot();
                                        }}
                                        className='w-full cursor-pointer rounded-lg border border-destructive/40 bg-transparent px-3 py-1.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10'
                                    >
                                        Retirer le joueur offert
                                    </button>

                                    <button
                                        type='button'
                                        onClick={() =>
                                            setShowLockedPopup(false)
                                        }
                                        className='w-full cursor-pointer rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-emerald-950 transition-colors hover:bg-emerald-400'
                                    >
                                        OK
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>,
                    document.body,
                )}
        </div>
    );
}

// ---------------------------------------------------------------------
// Filter form
// ---------------------------------------------------------------------

function FilterForm({
    slot,
    slotIndex,
    onFieldChange,
    onCollapse,
}: {
    slot: SlotState;
    slotIndex: number;
    onFieldChange: (patch: Partial<SlotState>) => void;
    onCollapse: () => void;
}) {
    /**
     * Compact field styling, deliberately smaller than the global
     * inputClass so the criteria form doesn't dominate the slot.
     */
    const compactLabelClass =
        'text-[0.6rem] font-semibold uppercase tracking-wider text-[#7DD3FC]';

    const compactInputClass =
        'w-full rounded border border-border bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring/50';

    return (
        <div
            id={`filter-form-${slotIndex}`}
            // React's onFocus bubbles (it emulates focusin), so this
            // single handler catches the user clicking into any of the
            // selects or inputs inside the form. The scroll-mt matches
            // the slot-scroll helper so both land under the nav bar.
            onFocus={() =>
                scrollElementIntoView(`filter-form-${slotIndex}`)
            }
            className='mt-1 scroll-mt-[calc(var(--header-height,4rem)+0.75rem)] space-y-1.5 rounded-md border p-2'
            style={{
                borderColor: 'rgba(0, 168, 255, 0.25)',
                backgroundColor: 'rgba(0, 168, 255, 0.04)',
            }}
        >
            <div className='flex items-center justify-between gap-2'>
                <p className='text-[0.6rem] font-semibold uppercase tracking-wider text-[#7DD3FC]'>
                    <span className='text-xs font-bold text-emerald-400'>
                        Optionnel
                    </span>
                    {' : Critères recherchés'}
                </p>

                <button
                    type='button'
                    onClick={onCollapse}
                    aria-label='Réduire les critères recherchés'
                    className='cursor-pointer rounded px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-[#7DD3FC] transition-colors hover:bg-[#00A8FF]/10 hover:text-[#00E5FF]'
                >
                    ▲ Réduire
                </button>
            </div>

            <div className='grid grid-cols-2 gap-x-2 gap-y-1.5'>
                <label className='block'>
                    <span className={compactLabelClass}>
                        Contrat min.
                    </span>
                    <select
                        value={slot.minContractYears}
                        onChange={(e) =>
                            onFieldChange({
                                minContractYears: e.target.value,
                            })
                        }
                        className={`mt-0.5 ${compactInputClass}`}
                    >
                        <option value=''>— Peu importe —</option>
                        <option value='1'>1 an</option>
                        <option value='2'>2 ans</option>
                        <option value='3'>3 ans</option>
                        <option value='4'>4 ans</option>
                        <option value='5'>5 ans et +</option>
                    </select>
                </label>

                <label className='block'>
                    <span className={compactLabelClass}>
                        Salaire max
                    </span>
                    <input
                        type='text'
                        inputMode='decimal'
                        value={slot.maxSalary}
                        onChange={(e) =>
                            onFieldChange({ maxSalary: e.target.value })
                        }
                        className={`mt-0.5 ${compactInputClass}`}
                    />
                </label>

                <label className='block'>
                    <span className={compactLabelClass}>Âge max</span>
                    <input
                        type='number'
                        min={16}
                        max={50}
                        value={slot.maxAge}
                        onChange={(e) =>
                            onFieldChange({ maxAge: e.target.value })
                        }
                        className={`mt-0.5 ${compactInputClass}`}
                    />
                </label>

                <label className='block'>
                    <span className={compactLabelClass}>
                        Points min. (an dernier)
                    </span>
                    <input
                        type='number'
                        min={0}
                        value={slot.minPointsLastYear}
                        onChange={(e) =>
                            onFieldChange({
                                minPointsLastYear: e.target.value,
                            })
                        }
                        className={`mt-0.5 ${compactInputClass}`}
                    />
                </label>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------
// Browse offers panel
// ---------------------------------------------------------------------

function BrowseOffersPanel({
    refreshTick,
    teamId,
    mode,
    onOpenTeamRoster,
}: {
    refreshTick: number;
    teamId: number | null;
    /**
     * 'view' → other managers' active offers (the default).
     * 'mine' → only the offers the current user published.
     *
     * The backend already knows how to exclude the user's own
     * offers and the ones he has responded to; passing
     * includeMine = (mode === 'mine') lets it do the heavy lifting,
     * and the client-side filter then narrows the payload to just
     * the side of the split we want.
     */
    mode: 'view' | 'mine';
    /**
     * Called when the user clicks a manager name in a card header.
     * The page opens a roster popup instead of navigating away to
     * /mon-equipe.
     */
    onOpenTeamRoster: (teamId: number, teamName: string) => void;
}) {
    const [offers, setOffers] = useState<TradeOffer[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<number | null>(null);

    const [userRoster, setUserRoster] = useState<TeamRoster | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            // includeMine = true when we want our own offers back.
            // In 'view' mode, includeMine = false already excludes
            // our own offers AND the ones we've already responded to,
            // which is what the browse tab has always shown.
            const data = await listTradeOffers(mode === 'mine');

            const filtered =
                mode === 'mine'
                    ? data.filter((o) => o.isMine)
                    : data;

            setOffers(filtered);
        } catch {
            setError('Impossible de charger les offres.');
        } finally {
            setLoading(false);
        }
    }, [mode]);

    useEffect(() => {
        void load();
    }, [load, refreshTick]);

    // Load the current user's roster once so OfferCard can filter his
    // players against each offer's demands. Non-fatal on failure: the
    // response UI just doesn't render.
    useEffect(() => {
        if (teamId == null) {
            setUserRoster(null);
            return;
        }

        let cancelled = false;

        getTeamRoster(teamId)
            .then((data) => {
                if (!cancelled) setUserRoster(data);
            })
            .catch(() => {
                if (!cancelled) setUserRoster(null);
            });

        return () => {
            cancelled = true;
        };
    }, [teamId]);

    /**
     * Debounced "mark these offers as seen" call (see previous notes
     * for the 2s rationale: StrictMode double-mount protection).
     */
    useEffect(() => {
        if (offers.length === 0) return;

        const ids = offers.map((o) => o.id);

        const timer = window.setTimeout(() => {
            markOffersSeen(ids).catch(() => {
                // Non-fatal.
            });
        }, MARK_SEEN_DELAY_MS);

        return () => {
            window.clearTimeout(timer);
        };
    }, [offers]);

    async function handleCancel(id: number) {
        if (!window.confirm('Annuler cette offre ?')) return;

        setBusyId(id);

        try {
            await cancelTradeOffer(id);
            await load();
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setBusyId(null);
        }
    }

    if (loading) {
        return (
            <p className='text-center text-muted-foreground'>Chargement...</p>
        );
    }

    if (error) {
        return (
            <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                {error}
            </p>
        );
    }

    if (offers.length === 0) {
        return (
            <p className='rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground'>
                {mode === 'mine'
                    ? "Vous n'avez publié aucune offre active pour le moment."
                    : 'Aucune offre active pour le moment.'}
            </p>
        );
    }

    return (
        <div className='space-y-3'>
            {offers.map((offer) => (
                <OfferCard
                    key={offer.id}
                    offer={offer}
                    busy={busyId === offer.id}
                    onCancel={() => handleCancel(offer.id)}
                    userRoster={userRoster}
                    onOpenTeamRoster={onOpenTeamRoster}
                />
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------
// Received offers panel ("Offres reçues")
// ---------------------------------------------------------------------

/**
 * Transforms a response into the shape OfferCard renders.
 *
 * The OfferCard layout is: left column = "Offre" (what the other
 * side is offering), right column = "Demande" (position + filters).
 * Either way the person who is offering players is the responder,
 * so the slot mapping is the same in both panels:
 *
 *   offeringPlayer*  ← the responding player
 *   positionGroup    ← from the original offer slot
 *   demand*          ← from the original offer slot
 *
 * The only thing that changes between the two panels is which team
 * name appears as the card header:
 *
 *   Received view → the responding team's name (who answered me)
 *   Sent view     → the original offer creator's name (whom I answered)
 *
 * The caller passes the right name in `headerTeamName`.
 */
function responseToOfferShape(
    response: TradeOfferResponse,
): TradeOffer {
    return {
        id: response.id,
        createdByFantasyTeamId: response.tradeOfferCreatedByFantasyTeamId,
        createdByFantasyTeamName: response.tradeOfferCreatedByFantasyTeamName,
        respondingFantasyTeamId: response.respondingFantasyTeamId,
        respondingFantasyTeamName: response.respondingFantasyTeamName,
        createdAt: response.createdAt,
        note: response.tradeOfferNote,
        status: response.status,
        isMine: false,
        isNew: false,
        slots: response.slots.map((s) => ({
            slotIndex: s.slotIndex,
            positionGroup: s.positionGroup,

            // LEFT: the offering player from the original offer.
            offeringPlayerId: s.offeringPlayerId,
            offeringPlayerNhlPlayerId: s.offeringPlayerNhlPlayerId,
            offeringPlayerFirstName: s.offeringPlayerFirstName,
            offeringPlayerLastName: s.offeringPlayerLastName,
            offeringPlayerNhlTeam: s.offeringPlayerNhlTeam,
            offeringPlayerPosition: s.offeringPlayerPosition,
            offeringPlayerAge: s.offeringPlayerAge,
            offeringPlayerCurrentContract: s.offeringPlayerCurrentContract,
            offeringPlayerSecondContract: s.offeringPlayerSecondContract,
            offeringPlayerCurrentSeasonStats:
                s.offeringPlayerCurrentSeasonStats,
            offeringPlayerLastSeasonStats:
                s.offeringPlayerLastSeasonStats,

            // RIGHT: the responding player.
            respondingPlayerId: s.respondingPlayerId,
            respondingPlayerNhlPlayerId: s.respondingPlayerNhlPlayerId,
            respondingPlayerFirstName: s.respondingPlayerFirstName,
            respondingPlayerLastName: s.respondingPlayerLastName,
            respondingPlayerNhlTeam: s.respondingPlayerNhlTeam,
            respondingPlayerPosition: s.respondingPlayerPosition,
            respondingPlayerAge: s.respondingPlayerAge,
            respondingPlayerCurrentContract:
                s.respondingPlayerCurrentContract,
            respondingPlayerSecondContract:
                s.respondingPlayerSecondContract,
            respondingPlayerCurrentSeasonStats:
                s.respondingPlayerCurrentSeasonStats,
            respondingPlayerLastSeasonStats:
                s.respondingPlayerLastSeasonStats,

            demandMinContractYears: s.demandMinContractYears,
            demandMaxSalary: s.demandMaxSalary,
            demandMaxAge: s.demandMaxAge,
            demandMinPointsLastYear: s.demandMinPointsLastYear,
        })),
    };
}

/**
 * "Offres reçues" panel. Lists every response to a still-active
 * offer that the current user created. Empty state when there are
 * none.
 */
function ReceivedOffersPanel({
    refreshTick,
    onOpenTeamRoster,
}: {
    refreshTick: number;
    onOpenTeamRoster: (teamId: number, teamName: string) => void;
}) {
    const [responses, setResponses] = useState<TradeOfferResponse[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    /**
     * Id of the response currently being acted on (accepted or
     * refused), or null. Used to disable the buttons on that card
     * only.
     */
    const [busyId, setBusyId] = useState<number | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const data = await listReceivedResponses();
            setResponses(data);
        } catch {
            setError('Impossible de charger les offres reçues.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load, refreshTick]);

    async function handleAccept(responseId: number) {
        setBusyId(responseId);
        setError(null);

        try {
            await acceptTradeOfferResponse(responseId);
            await load();
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setBusyId(null);
        }
    }

    async function handleReject(responseId: number) {
        if (
            !window.confirm(
                'Refuser cette réponse ? ' +
                'Votre annonce restera active sur le marché. ' +
                "L'autre gestionnaire ne verra plus cette réponse " +
                'dans ses offres envoyées.',
            )
        ) {
            return;
        }

        setBusyId(responseId);
        setError(null);

        try {
            await rejectTradeOfferResponse(responseId);
            await load();
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setBusyId(null);
        }
    }

    if (loading) {
        return (
            <p className='text-center text-muted-foreground'>
                Chargement...
            </p>
        );
    }

    if (error) {
        return (
            <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                {error}
            </p>
        );
    }

    if (responses.length === 0) {
        return (
            <p className='rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground'>
                Aucune offre reçue pour le moment.
            </p>
        );
    }

    return (
        <div className='space-y-3'>
            {responses.map((response) => (
                <OfferCard
                    key={response.id}
                    offer={responseToOfferShape(response)}
                    busy={busyId === response.id}
                    onCancel={() => {
                        // Responses cannot be cancelled by the recipient.
                        // No-op.
                    }}
                    userRoster={null}
                    onAccept={() => void handleAccept(response.id)}
                    onReject={() => void handleReject(response.id)}
                    onOpenTeamRoster={onOpenTeamRoster}
                />
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------
// Sent offers panel ("Offres envoyées")
// ---------------------------------------------------------------------

/**
 * Lists every response the current user's team has sent to someone
 * else's active offer. Same OfferCard as the received view, but the
 * header shows the original offer creator's name so the user knows
 * whom he answered.
 */
function SentOffersPanel({
    refreshTick,
    onOpenTeamRoster,
}: {
    refreshTick: number;
    onOpenTeamRoster: (teamId: number, teamName: string) => void;
}) {
    const [responses, setResponses] = useState<TradeOfferResponse[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<number | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const data = await listSentResponses();
            setResponses(data);
        } catch {
            setError('Impossible de charger les offres envoyées.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load, refreshTick]);

    async function handleCancel(responseId: number) {
        if (!window.confirm('Annuler cette offre envoyée ?')) return;

        setBusyId(responseId);
        setError(null);

        try {
            await cancelTradeOfferResponse(responseId);
            await load();
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setBusyId(null);
        }
    }

    if (loading) {
        return (
            <p className='text-center text-muted-foreground'>
                Chargement...
            </p>
        );
    }

    if (error) {
        return (
            <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                {error}
            </p>
        );
    }

    if (responses.length === 0) {
        return (
            <p className='rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground'>
                Aucune offre envoyée pour le moment.
            </p>
        );
    }

    return (
        <div className='space-y-3'>
            {responses.map((response) => (
                <OfferCard
                    key={response.id}
                    offer={responseToOfferShape(response)}
                    busy={busyId === response.id}
                    onCancel={() => {
                        // Response cards are not the user's own
                        // offer; the "Mon offre" header never
                        // renders on them, so this callback is
                        // never reached.
                    }}
                    responseStatus={response.status}
                    onCancelResponse={() =>
                        void handleCancel(response.id)
                    }
                    userRoster={null}
                    onOpenTeamRoster={onOpenTeamRoster}
                />
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------
// Small per-slot stat table
//
// Shows the current season and previous season of NHL stats for a
// player. The layout is:
//
//              GP  G  A  PTS  3B  FP     (skater)
//   26-27      X   X   X   X    X   X
//   25-26      X   X   X   X    X   X
//
// Goalies use W / L / OTL / SO instead of G / A / PTS / 3B.
// Null stat lines render as dashes so the row layout stays fixed.
// ---------------------------------------------------------------------

function StatLinesTable({
    current,
    previous,
    isGoalie,
    size = 'sm',
}: {
    current: SeasonStatLine | null;
    previous: SeasonStatLine | null;
    isGoalie: boolean;
    /**
     * 'sm' (default) is the compact sizing used on offer cards.
     * 'md' is one step bigger and is used inside the roster popup,
     * where there is more horizontal room and the cards are the
     * primary content.
     */
    size?: 'sm' | 'md';
}) {
    // Skater columns now show Time On Ice where the hat-trick
    // counter used to sit. Goalie columns are unchanged (they
    // never had a hat-trick column to begin with).
    const columns = isGoalie
        ? ['GP', 'W', 'L', 'OTL', 'SO', 'FP']
        : ['GP', 'G', 'A', 'PTS', 'TOI', 'FP'];

    function rowValues(line: SeasonStatLine | null): (string | number)[] {
        if (!line) {
            return ['—', '—', '—', '—', '—', '—'];
        }

        return isGoalie
            ? [
                line.gamesPlayed,
                line.wins,
                line.losses,
                line.overtimeLosses,
                line.shutouts,
                line.fantasyPoints,
            ]
            : [
                line.gamesPlayed,
                line.goals,
                line.assists,
                line.points,
                // Raw "MM:SS" string. The archive may not carry
                // ATOI for older seasons; in that case we show a
                // dash rather than a misleading "0".
                line.timeOnIce ?? '—',
                line.fantasyPoints,
            ];
    }

    function shortLabel(
        line: SeasonStatLine | null,
        fallback: string,
    ): string {
        const label = line?.label;

        if (!label) return fallback;

        // "2026-27" / "2026-2027" -> "26-27"
        return label.replace(/^20(\d{2})-(?:20)?(\d{2})$/, '$1-$2');
    }

    const currentValues = rowValues(current);
    const previousValues = rowValues(previous);

    return (
        <table
            className={`mt-1 w-full table-fixed border-collapse leading-tight tabular-nums ${size === 'md'
                    ? 'text-[0.7rem] md:text-xs'
                    : 'text-[0.55rem] md:text-[0.6rem]'
                }`}
        >
            {/*
             * Explicit column widths so nothing overflows into its
             * neighbour. The old layout used table-fixed with a single
             * w-8 on the label and gave every stat column the same
             * equal share of what was left, which was fine for "12" but
             * not for "21:19" — TOI was spilling into FP.
             *
             * - label gets enough room for "26-27" and no more, so it
             *   sits flush at the left edge.
             * - TOI gets the widest stat column, because it is the only
             *   one holding a 5-character "MM:SS" value.
             * - FP stays narrow so it renders close to the middle
             *   divider between the two sides of the offer card.
             */}
            <colgroup>
                <col style={{ width: '18%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '11%' }} />
            </colgroup>

            <thead>
                <tr className='text-[#7DD3FC]'>
                    <th className='px-0 text-left font-normal' />

                    {columns.map((column) => (
                        <th
                            key={column}
                            className='px-0 text-center font-normal'
                            style={{ color: statColumnColor(column) }}
                        >
                            {column}
                        </th>
                    ))}
                </tr>
            </thead>

            <tbody className='text-foreground'>
                <tr>
                    <td className='px-0 text-left text-[#7DD3FC]'>
                        {shortLabel(current, '26-27')}
                    </td>

                    {currentValues.map((value, index) => (
                        <td
                            key={index}
                            className='px-0 text-center'
                            style={{
                                color: statColumnColor(columns[index]),
                            }}
                        >
                            {value}
                        </td>
                    ))}
                </tr>

                <tr>
                    <td className='px-0 text-left text-[#7DD3FC]'>
                        {shortLabel(previous, '25-26')}
                    </td>

                    {previousValues.map((value, index) => (
                        <td
                            key={index}
                            className='px-0 text-center'
                            style={{
                                color: statColumnColor(columns[index]),
                            }}
                        >
                            {value}
                        </td>
                    ))}
                </tr>
            </tbody>
        </table>
    );
}

// ---------------------------------------------------------------------
// Slot player block
//
// Renders one player's identity, stats and contracts, matching the
// left column of an OfferCard slot. Extracted so a response card
// can use the exact same layout on BOTH sides: the offering player
// on the left, the responding player on the right.
// ---------------------------------------------------------------------

function SlotPlayerBlock({
    playerId,
    nhlPlayerId,
    firstName,
    lastName,
    nhlTeam,
    position,
    age,
    currentContract,
    secondContract,
    currentSeasonStats,
    lastSeasonStats,
    emptyLabel,
}: {
    playerId: number | null | undefined;
    nhlPlayerId: number | null | undefined;
    firstName: string | null | undefined;
    lastName: string | null | undefined;
    nhlTeam: string | null | undefined;
    position: string | null | undefined;
    /**
     * Player age in years, or null. Rendered as "{age} ans" next to
     * the player's name.
     */
    age: number | null | undefined;
    currentContract: PlayerContractLine | null | undefined;
    secondContract: PlayerContractLine | null | undefined;
    currentSeasonStats: SeasonStatLine | null | undefined;
    lastSeasonStats: SeasonStatLine | null | undefined;
    emptyLabel: string;
}) {
    if (playerId == null) {
        return (
            <p className='text-[0.65rem] font-bold uppercase tracking-wider text-[#7DD3FC] md:text-xs'>
                {emptyLabel}
            </p>
        );
    }

    const currentContractLabel = contractLabel(currentContract ?? null);
    const secondContractLabel = contractLabel(secondContract ?? null);

    return (
        <>
            <div className='flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-xs text-foreground md:text-sm'>
                {nhlTeam && (
                    <NhlTeamLogo abbreviation={nhlTeam} size={20} />
                )}

                {nhlPlayerId != null ? (
                    <Link
                        to={`/joueurs/${nhlPlayerId}`}
                        onClick={(e) => e.stopPropagation()}
                        className='truncate font-semibold text-foreground transition-colors hover:text-[#00E5FF]'
                    >
                        {firstName} {lastName}
                    </Link>
                ) : (
                    <span className='truncate font-semibold'>
                        {firstName} {lastName}
                    </span>
                )}

                {age != null && (
                    <span className='shrink-0 text-[0.65rem] font-normal text-white md:text-xs'>
                        {age} ans
                    </span>
                )}

                <span className='shrink-0 text-[0.6rem] uppercase text-white md:text-xs'>
                    {position}
                </span>
            </div>

            <StatLinesTable
                current={currentSeasonStats ?? null}
                previous={lastSeasonStats ?? null}
                isGoalie={toPositionGroup(position) === 'G'}
            />

            {currentContractLabel && (
                <div className='mt-0.5 flex flex-wrap items-center justify-center gap-x-1 text-[0.6rem] font-semibold text-emerald-400 md:text-xs'>
                    <span className='whitespace-nowrap'>
                        {currentContractLabel}
                    </span>

                    {secondContractLabel && (
                        <>
                            <span
                                aria-hidden='true'
                                className='opacity-80'
                            >
                                →
                            </span>
                            <span className='whitespace-nowrap'>
                                {secondContractLabel}
                            </span>
                        </>
                    )}
                </div>
            )}
        </>
    );
}

// ---------------------------------------------------------------------
// Responding player block
//
// Same visual layout as SlotPlayerBlock (logo + name + position,
// two-season stats table, contract line) but the "name" slot is a
// native <select> styled to look like text. Used on the right
// column of an offer slot once the responding manager has picked
// a player, so the card reads as "Jesper Bratt <-> Andrew
// Cristall" instead of "Jesper Bratt <-> Attaquant / criteria".
// ---------------------------------------------------------------------

function RespondingPlayerBlock({
    entry,
    matches,
    currentPick,
    onPick,
}: {
    entry: RosterEntry | null;
    matches: RosterEntry[];
    currentPick: number | null;
    onPick: (playerId: number | null) => void;
}) {
    const isGoalie = entry
        ? toPositionGroup(entry.position) === 'G'
        : false;

    const currentContractLabel = entry
        ? contractLabel(entry.currentContract) ??
        compactSalary(entry.fantasySalary)
        : null;

    const secondContractLabel = entry
        ? contractLabel(entry.secondContract)
        : null;

    return (
        <>
            <div className='flex flex-nowrap items-center justify-center text-xs text-foreground md:text-sm'>
                {/*
                 * Wrapper approach for the "dropdown with a logo
                 * inside" look.
                 *
                 * A native <select> cannot hold HTML inside its
                 * closed state or inside its <option> rows. So the
                 * visible rectangle is a plain <div> that renders
                 * the picked player's name and logo side by side,
                 * and the actual <select> sits on top, fully
                 * transparent, to capture the click and open the
                 * OS dropdown list. The user sees the div; the
                 * browser still drives the interaction.
                 *
                 * The div owns the border and background so the
                 * rectangle stays green / cyan and dark-themed.
                 * The select only carries `colorScheme: 'dark'`
                 * so the popup list itself stays dark.
                 */}
                <div
                    className='relative inline-flex max-w-[12rem] min-w-0 items-center justify-center rounded border bg-[#080D1A] px-2 py-0.5 md:max-w-[16rem]'
                    style={{
                        borderColor:
                            currentPick != null
                                ? '#22C55E'
                                : 'rgba(0, 229, 255, 0.4)',
                    }}
                >
                    {/* Visible content: centered logo + name + age,
                        logo on the left, age on the right. Truncated
                        when the name is too long.

                        `pr-2` nudges the whole group slightly left
                        so the age reads as sitting on the right
                        rather than pushing the name off-center. */}
                    <span className='flex min-w-0 items-center justify-center gap-x-1.5 truncate pr-2 text-xs font-semibold text-foreground md:text-sm'>
                        {entry?.nhlTeamAbbreviation && (
                            <NhlTeamLogo
                                abbreviation={entry.nhlTeamAbbreviation}
                                size={20}
                            />
                        )}

                        <span className='truncate'>
                            {entry
                                ? `${entry.firstName} ${entry.lastName}`
                                : matches.length === 0
                                    ? 'Aucun joueur admissible'
                                    : '— Choisir un joueur —'}
                        </span>

                        {entry?.age != null && (
                            <span className='shrink-0 text-[0.65rem] font-normal text-white md:text-xs'>
                                {entry.age} ans
                            </span>
                        )}
                    </span>

                    {/* Transparent overlay: the actual <select> that
                        drives the interaction. `opacity-0` hides it
                        visually; pointer events still hit it, so
                        clicking anywhere on the div opens the
                        native dropdown. `appearance-none` removes
                        the browser's own arrow so it does not
                        render inside the transparent area. */}
                    <select
                        value={currentPick ?? ''}
                        onChange={(e) => {
                            const v = e.target.value;
                            onPick(v === '' ? null : Number(v));
                        }}
                        disabled={matches.length === 0 && currentPick == null}
                        className='absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 focus:outline-none disabled:cursor-not-allowed'
                        style={{ colorScheme: 'dark' }}
                        aria-label='Choisir un joueur'
                    >
                        <option
                            value=''
                            style={{
                                backgroundColor: '#080D1A',
                                color: '#F2F5FA',
                            }}
                        >
                            {matches.length === 0
                                ? 'Aucun joueur admissible'
                                : '— Choisir un joueur —'}
                        </option>
                        {matches.map((m) => (
                            <option
                                key={m.playerId}
                                value={m.playerId}
                                style={{
                                    backgroundColor: '#080D1A',
                                    color: '#F2F5FA',
                                }}
                            >
                                {m.firstName} {m.lastName}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {entry && (
                <>
                    <StatLinesTable
                        current={entry.currentSeason}
                        previous={entry.lastSeason}
                        isGoalie={isGoalie}
                    />

                    {currentContractLabel && (
                        <div className='mt-0.5 flex flex-wrap items-center justify-center gap-x-1 text-[0.6rem] font-semibold text-emerald-400 md:text-xs'>
                            <span className='whitespace-nowrap'>
                                {currentContractLabel}
                            </span>

                            {secondContractLabel && (
                                <>
                                    <span
                                        aria-hidden='true'
                                        className='opacity-80'
                                    >
                                        →
                                    </span>
                                    <span className='whitespace-nowrap'>
                                        {secondContractLabel}
                                    </span>
                                </>
                            )}
                        </div>
                    )}
                </>
            )}
        </>
    );
}

// ---------------------------------------------------------------------
// Offer card
// ---------------------------------------------------------------------

function OfferCard({
    offer,
    busy,
    onCancel,
    userRoster,
    hideInternalCancel = false,
    onSlotClick,
    onAccept,
    onReject,
    responseStatus,
    onCancelResponse,
    onOpenTeamRoster,
}: {
    offer: TradeOffer;
    busy: boolean;
    onCancel: () => void;
    userRoster: TeamRoster | null;
    /**
     * When true, the card does NOT render its own "Annuler" button
     * even if the offer is the user's own. Used by the publish
     * preview popup, which has its own buttons below the card.
     */
    hideInternalCancel?: boolean;
    /**
     * When provided, each slot row becomes clickable and this
     * callback fires with the slot's index. Used by the publish
     * preview popup so the user can jump straight back into editing
     * that specific player.
     */
    onSlotClick?: (slotIndex: number) => void;
    /**
  * When provided AND the offer is still Pending, renders the
  * "Accepter" button. Only the "Offres reçues" panel passes this.
  * The "Offres envoyées" and "Regarder les offres" panels leave it
  * undefined, so no button appears there.
  */
    onAccept?: () => void;

    /**
     * When provided AND the offer is still Pending, renders the
     * "Refuser" button to the left of "Accepter". Only the "Offres
     * reçues" panel passes this.
     */
    onReject?: () => void;

    /**
     * When set, this card represents a response the current user's
     * team sent to someone else's offer. Renders a "Mon offre
     * envoyée" header and — when the status is still Pending — a
     * small "Annuler" button that calls `onCancelResponse`.
     *
     * The value is the raw status string from the response DTO
     * ("Pending", "Accepted", "Rejected" or "Cancelled").
     */
    responseStatus?: string;
    /**
     * When provided AND `responseStatus === 'Pending'`, the card
     * renders a small "Annuler" button in its header. Only the
     * "Offres envoyées" panel passes this.
     */
    onCancelResponse?: () => void;
    /**
     * When provided, the two manager names in the card header
     * become clickable buttons that call this callback with the
     * team id and name. MarketplacePage uses it to open a roster
     * popup instead of navigating to /mon-equipe. When undefined
     * (e.g. the publish preview popup), the names render as plain
     * non-interactive text.
     */
    onOpenTeamRoster?: (teamId: number, teamName: string) => void;
}) {
    // Name shown over the "Demande" column when the viewer is not
    // the offer's creator. The right column of the header represents
    // the responding side of the exchange, so it is only meaningful
    // on offers the viewer could respond to. On the viewer's own
    // offers (Vos offres actives, publish preview) the creator name
    // on the left already identifies the row, and repeating the
    // connected user's own team name on the right was redundant.
    //
    // Falls back to the account's display name, then to a generic
    // "Vous", so the column always has a label even for an
    // account that has not yet been assigned a fantasy team.
    const { user } = useAuth();
    const connectedUserName =
        user?.fantasyTeamName ?? user?.displayName ?? 'Vous';
    const connectedUserTeamId = user?.fantasyTeamId ?? null;

    // Right-column header team. On a response card it is the
    // responding team; on a normal offer it is the connected user
    // (i.e. "who is looking at this"). `showRightTeam` hides the
    // column entirely on the viewer's own offer.
    const rightTeamId =
        offer.respondingFantasyTeamId ?? connectedUserTeamId;
    const rightTeamName =
        offer.respondingFantasyTeamName ?? connectedUserName;
    const showRightTeam =
        offer.respondingFantasyTeamName != null || !offer.isMine;

    /**
    * True when the user can respond to this offer: not his own, and
    * we have his roster loaded so we can populate the dropdowns.
    */
    const canRespond = !offer.isMine && userRoster != null;

    /**
     * True when the underlying response has been accepted. Only
     * synthesized response cards (Reçues / Envoyées) can carry
     * this status: real TradeOffers only ever have Active, Closed
     * or Cancelled.
     *
     * When true, the card swaps its cyan contained-filament frame
     * for a gold one and the action row at the bottom shows a
     * single gold "OFFRE ACCEPTÉE" label instead of any button.
     */
    const isAccepted = offer.status === 'Accepted';

    /**
 * User's picks, keyed by slot index. null means "not picked yet".
 *
 * Initialized from the module-level store so the picks survive
 * an in-app navigation that unmounts this card (e.g. the user
 * opens the roster popup, clicks a player name, lands on
 * PlayerPage and clicks Fermer). The store is updated on every
 * change by `setPick` below.
 */
    const [picks, setPicks] = useState<Record<number, number | null>>(
        () => getPicksForOffer(offer.id),
    );

    /**
     * Matching user players for each slot: position group must match
     * and every demand criterion must be satisfied. Already-picked
     * players are excluded from OTHER slots so the same player cannot
     * be offered twice.
     */
    const matchingPlayersBySlot = useMemo(() => {
        if (!canRespond || !userRoster) return {} as Record<number, RosterEntry[]>;

        const pickedIds = new Set(
            Object.values(picks).filter((v): v is number => v != null),
        );

        const result: Record<number, RosterEntry[]> = {};

        for (const slot of offer.slots) {
            const currentPick = picks[slot.slotIndex] ?? null;

            result[slot.slotIndex] = userRoster.entries
                .filter((e) => {
                    // Keep the current slot's own pick visible even
                    // though it is in `pickedIds`.
                    if (
                        pickedIds.has(e.playerId) &&
                        e.playerId !== currentPick
                    ) {
                        return false;
                    }
                    return playerMatchesSlotDemand(e, slot);
                })
                .sort((a, b) => {
                    const byLast = a.lastName.localeCompare(b.lastName);
                    if (byLast !== 0) return byLast;
                    return a.firstName.localeCompare(b.firstName);
                });
        }

        return result;
    }, [canRespond, userRoster, offer.slots, picks]);

    /** True when every slot has a pick. */
    const allSlotsFilled = useMemo(() => {
        if (!canRespond) return false;
        return offer.slots.every((s) => picks[s.slotIndex] != null);
    }, [canRespond, offer.slots, picks]);

    function setPick(slotIndex: number, playerId: number | null) {
        setPicks((current) => {
            const next = { ...current, [slotIndex]: playerId };

            // Keep the module-level store in sync so the picks
            // survive a navigation that unmounts this card.
            setPicksForOffer(offer.id, next);

            return next;
        });
    }

    /**
   * Local state for the "Offrir" submit. Resets when the card
   * unmounts or the user picks a different offer.
   */
    const [respondBusy, setRespondBusy] = useState(false);
    const [respondSuccess, setRespondSuccess] = useState<string | null>(null);
    const [respondError, setRespondError] = useState<string | null>(null);

    async function handleOffer() {
        if (!canRespond || !allSlotsFilled || respondBusy) return;

        // Convert the picks-by-slot map into the flat list the API
        // expects. Every slot in the offer must be present, otherwise
        // the backend rejects the whole response.
        const picksArray: RespondToTradeOfferPick[] = [];

        for (const slot of offer.slots) {
            const pick = picks[slot.slotIndex];

            if (pick == null) {
                // Should not happen: the button is disabled unless
                // every slot has a pick.
                setRespondError(
                    'Tous les emplacements doivent avoir un joueur.',
                );
                return;
            }

            picksArray.push({
                slotIndex: slot.slotIndex,
                respondingPlayerId: pick,
            });
        }

        setRespondBusy(true);
        setRespondError(null);
        setRespondSuccess(null);

        try {
            const result = await respondToTradeOffer(offer.id, {
                picks: picksArray,
            });

            if (result.success) {
                setRespondSuccess(result.message);

                // Reset every dropdown on this card so the user
                // sees a clean box, exactly like before any pick
                // was made. The success banner stays visible so
                // he still gets confirmation that the offer went
                // through.
                //
                // Also drop the store entry: without this, a
                // subsequent mount of the same offer (should it
                // ever come back into view) would restore the
                // picks we just submitted.
                setPicks({});
                clearPicksForOffer(offer.id);
            } else {
                setRespondError(result.message);
            }
        } catch (err) {
            setRespondError(
                err instanceof Error
                    ? err.message
                    : 'Erreur lors de l\'envoi.',
            );
        } finally {
            setRespondBusy(false);
        }
    }

    // Contained-filament frame colors. Cyan by default, gold once
    // the underlying response has been accepted. Same two-layer
    // technique in both cases; only the palette changes.
    const tubeColor = isAccepted
        ? ACCEPTED_TUBE_COLOR
        : OFFER_TUBE_COLOR;

    const filamentColor = isAccepted
        ? ACCEPTED_FILAMENT
        : OFFER_FILAMENT;

    const bloomNear = isAccepted
        ? ACCEPTED_BLOOM_NEAR
        : OFFER_BLOOM_NEAR;

    const bloomFar = isAccepted
        ? ACCEPTED_BLOOM_FAR
        : OFFER_BLOOM_FAR;

    return (
        <article
            className='relative overflow-hidden rounded-lg'
            style={{
                backgroundColor: FRAME_BG,
                border: `${OFFER_TUBE_PX}px solid ${tubeColor}`,
                boxShadow: [
                    `inset 0 0 0 1px ${filamentColor}`,
                    `inset 0 0 10px ${bloomNear}`,
                    `inset 0 0 28px ${bloomFar}`,
                ].join(', '),
            }}
        >
            {/* Top-left badge. Only the "Nouvelle offre" case is
                rendered here. The accepted state is signalled by
                the gold frame and the gold "OFFRE ACCEPTÉE" label
                at the bottom, so a second green badge would just
                be visual noise. */}
            {offer.isNew && !offer.isMine ? (
                <span
                    className='absolute left-3 top-3 z-20 rounded px-1.5 py-0.5 text-[0.55rem] font-bold uppercase tracking-wider'
                    style={{
                        backgroundColor: '#22C55E',
                        color: '#04160A',
                        boxShadow: 'inset 0 0 0 1px #86EFAC',
                    }}
                >
                    Nouvelle offre
                </span>
            ) : null}

            {offer.isMine && !hideInternalCancel && (
                <div
                    className='relative border-b px-3 py-2'
                    style={{
                        borderColor: 'rgba(0, 168, 255, 0.35)',
                        background: HEADER_GRADIENT,
                    }}
                >
                    <span className='block text-center text-[0.6rem] font-semibold uppercase tracking-wider text-[#00E5FF]'>
                        Mon offre
                    </span>

                    <button
                        type='button'
                        onClick={onCancel}
                        disabled={busy}
                        className='absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer rounded border border-destructive/40 px-2 py-0.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50'
                    >
                        Annuler
                    </button>
                </div>
            )}

            {responseStatus != null && (
                <div
                    className='relative border-b px-3 py-2'
                    style={{
                        borderColor: 'rgba(0, 168, 255, 0.35)',
                        background: HEADER_GRADIENT,
                    }}
                >
                    <span className='block text-center text-[0.6rem] font-semibold uppercase tracking-wider text-[#00E5FF]'>
                        Mon offre envoyée
                    </span>

                    {responseStatus === 'Pending' &&
                        onCancelResponse && (
                            <button
                                type='button'
                                onClick={onCancelResponse}
                                disabled={busy}
                                className='absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer rounded border border-destructive/40 px-2 py-0.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50'
                            >
                                Annuler
                            </button>
                        )}
                </div>
            )}

            <div className='space-y-3 p-2 md:p-3'>
                <div>
                    <div
                        className='flex items-center border-b py-1'
                        style={{
                            borderColor: 'rgba(0, 168, 255, 0.2)',
                        }}
                    >
                        {onOpenTeamRoster ? (
                            <button
                                type='button'
                                onClick={() =>
                                    onOpenTeamRoster(
                                        offer.createdByFantasyTeamId,
                                        offer.createdByFantasyTeamName,
                                    )
                                }
                                className='flex-1 cursor-pointer truncate px-2 text-center text-[0.6rem] font-bold uppercase tracking-wider text-[#00E5FF] transition-colors hover:text-white md:text-xs'
                            >
                                {offer.createdByFantasyTeamName}
                            </button>
                        ) : (
                            <div className='flex-1 truncate px-2 text-center text-[0.6rem] font-bold uppercase tracking-wider text-[#00E5FF] md:text-xs'>
                                {offer.createdByFantasyTeamName}
                            </div>
                        )}
                        {showRightTeam ? (
                            onOpenTeamRoster && rightTeamId != null ? (
                                <button
                                    type='button'
                                    onClick={() =>
                                        onOpenTeamRoster(
                                            rightTeamId,
                                            rightTeamName,
                                        )
                                    }
                                    className='flex-1 cursor-pointer truncate px-2 text-center text-[0.6rem] font-bold uppercase tracking-wider text-[#00E5FF] transition-colors hover:text-white md:text-xs'
                                >
                                    {rightTeamName}
                                </button>
                            ) : (
                                <div className='flex-1 truncate px-2 text-center text-[0.6rem] font-bold uppercase tracking-wider text-[#00E5FF] md:text-xs'>
                                    {rightTeamName}
                                </div>
                            )
                        ) : (
                            <div className='flex-1' aria-hidden='true' />
                        )}
                    </div>

                    <div className='relative'>
                        <div
                            aria-hidden='true'
                            className='pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 border-l'
                            style={{
                                borderColor: 'rgba(0, 168, 255, 0.35)',
                            }}
                        />

                        <span
                            className='absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full px-1 text-base leading-none text-[#00E5FF]'
                            style={{
                                backgroundColor: 'rgba(8, 13, 26, 1)',
                            }}
                        >
                            ⇄
                        </span>

                        {offer.slots.map((slot, index) => {
                            const matches =
                                matchingPlayersBySlot[slot.slotIndex] ??
                                [];

                            const currentPick =
                                picks[slot.slotIndex] ?? null;

                            return (
                                <div
                                    key={slot.slotIndex}
                                    onClick={
                                        onSlotClick
                                            ? () =>
                                                onSlotClick(
                                                    slot.slotIndex,
                                                )
                                            : undefined
                                    }
                                    role={
                                        onSlotClick ? 'button' : undefined
                                    }
                                    tabIndex={onSlotClick ? 0 : undefined}
                                    onKeyDown={
                                        onSlotClick
                                            ? (e) => {
                                                if (
                                                    e.key === 'Enter' ||
                                                    e.key === ' '
                                                ) {
                                                    e.preventDefault();
                                                    onSlotClick(
                                                        slot.slotIndex,
                                                    );
                                                }
                                            }
                                            : undefined
                                    }
                                    className={`grid grid-cols-[1fr_auto_1fr] items-stretch px-1 py-2 transition-colors ${onSlotClick
                                        ? 'cursor-pointer hover:bg-[#00A8FF]/10 focus:outline-none focus-visible:bg-[#00A8FF]/15'
                                        : ''
                                        }`}
                                    style={{
                                        borderTop:
                                            index > 0
                                                ? '1px dashed rgba(0, 168, 255, 0.15)'
                                                : undefined,
                                    }}
                                >
                                    <div className='flex min-w-0 flex-col items-center justify-center text-center'>
                                        <SlotPlayerBlock
                                            playerId={slot.offeringPlayerId}
                                            nhlPlayerId={
                                                slot.offeringPlayerNhlPlayerId
                                            }
                                            firstName={
                                                slot.offeringPlayerFirstName
                                            }
                                            lastName={
                                                slot.offeringPlayerLastName
                                            }
                                            nhlTeam={
                                                slot.offeringPlayerNhlTeam
                                            }
                                            position={
                                                slot.offeringPlayerPosition
                                            }
                                            age={slot.offeringPlayerAge}
                                            currentContract={
                                                slot.offeringPlayerCurrentContract
                                            }
                                            secondContract={
                                                slot.offeringPlayerSecondContract
                                            }
                                            currentSeasonStats={
                                                slot.offeringPlayerCurrentSeasonStats
                                            }
                                            lastSeasonStats={
                                                slot.offeringPlayerLastSeasonStats
                                            }
                                            emptyLabel='Avis de recherche'
                                        />
                                    </div>

                                    <div
                                        aria-hidden='true'
                                        className={SLOT_ARROW_COL}
                                    />

                                    <div className='flex min-w-0 flex-col items-center justify-center text-center'>
                                        {slot.respondingPlayerId != null ? (
                                            <SlotPlayerBlock
                                                playerId={
                                                    slot.respondingPlayerId
                                                }
                                                nhlPlayerId={
                                                    slot.respondingPlayerNhlPlayerId
                                                }
                                                firstName={
                                                    slot.respondingPlayerFirstName
                                                }
                                                lastName={
                                                    slot.respondingPlayerLastName
                                                }
                                                nhlTeam={
                                                    slot.respondingPlayerNhlTeam
                                                }
                                                position={
                                                    slot.respondingPlayerPosition
                                                }
                                                age={
                                                    slot.respondingPlayerAge
                                                }
                                                currentContract={
                                                    slot.respondingPlayerCurrentContract
                                                }
                                                secondContract={
                                                    slot.respondingPlayerSecondContract
                                                }
                                                currentSeasonStats={
                                                    slot.respondingPlayerCurrentSeasonStats
                                                }
                                                lastSeasonStats={
                                                    slot.respondingPlayerLastSeasonStats
                                                }
                                                emptyLabel='Aucune réponse'
                                            />
                                        ) : canRespond && currentPick != null ? (
                                            <RespondingPlayerBlock
                                                entry={
                                                    userRoster?.entries.find(
                                                        (e) =>
                                                            e.playerId ===
                                                            currentPick,
                                                    ) ?? null
                                                }
                                                matches={matches}
                                                currentPick={currentPick}
                                                onPick={(id) =>
                                                    setPick(
                                                        slot.slotIndex,
                                                        id,
                                                    )
                                                }
                                            />
                                        ) : (
                                            <>
                                                <p className='text-xs font-semibold text-foreground md:text-sm'>
                                                    {groupLabel(
                                                        slot.positionGroup as PositionGroup,
                                                    )}
                                                </p>

                                                <ul className='mt-1 inline-block text-left text-[0.6rem] text-[#7DD3FC] md:text-[0.7rem]'>
                                                    {slot.demandMinContractYears !=
                                                        null && (
                                                            <li>
                                                                Contrat min :{' '}
                                                                {
                                                                    slot.demandMinContractYears
                                                                }{' '}
                                                                an
                                                                {slot.demandMinContractYears >
                                                                    1
                                                                    ? 's'
                                                                    : ''}
                                                            </li>
                                                        )}
                                                    {slot.demandMaxSalary != null && (
                                                        <li>
                                                            Salaire max :{' '}
                                                            {compactSalary(
                                                                slot.demandMaxSalary,
                                                            )}
                                                        </li>
                                                    )}
                                                    {slot.demandMaxAge != null && (
                                                        <li>
                                                            Âge max :{' '}
                                                            {slot.demandMaxAge}
                                                        </li>
                                                    )}
                                                    {slot.demandMinPointsLastYear !=
                                                        null && (
                                                            <li>
                                                                Points min (an dernier) :{' '}
                                                                {
                                                                    slot.demandMinPointsLastYear
                                                                }
                                                            </li>
                                                        )}
                                                    {slot.demandMinContractYears ==
                                                        null &&
                                                        slot.demandMaxSalary ==
                                                        null &&
                                                        slot.demandMaxAge == null &&
                                                        slot.demandMinPointsLastYear ==
                                                        null && (
                                                            <li className='italic opacity-70'>
                                                                Aucun critère
                                                                particulier
                                                            </li>
                                                        )}
                                                </ul>

                                                {/* Response picker: only shown
                                                    when the offer is not the
                                                    user's own and his roster
                                                    is loaded. */}
                                                {canRespond && (
                                                    <select
                                                        value={
                                                            currentPick ?? ''
                                                        }
                                                        onChange={(e) => {
                                                            const v =
                                                                e.target.value;
                                                            setPick(
                                                                slot.slotIndex,
                                                                v === ''
                                                                    ? null
                                                                    : Number(v),
                                                            );
                                                        }}
                                                        disabled={
                                                            matches.length === 0 &&
                                                            currentPick == null
                                                        }
                                                        className='mt-1 w-full cursor-pointer rounded border bg-[#080D1A] px-1 py-0.5 text-[0.6rem] font-semibold text-[#7DD3FC] focus:outline-none md:text-[0.7rem]'
                                                        style={{
                                                            borderColor:
                                                                currentPick != null
                                                                    ? '#22C55E'
                                                                    : 'rgba(0, 229, 255, 0.4)',
                                                        }}
                                                    >
                                                        <option value=''>
                                                            {matches.length === 0
                                                                ? 'Aucun joueur admissible'
                                                                : '— Choisir un joueur —'}
                                                        </option>
                                                        {matches.map((entry) => (
                                                            <option
                                                                key={entry.playerId}
                                                                value={entry.playerId}
                                                            >
                                                                {entry.firstName}{' '}
                                                                {entry.lastName}
                                                            </option>
                                                        ))}
                                                    </select>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {offer.note && (
                    <p className='rounded-md border border-[#00A8FF]/25 bg-[#00A8FF]/5 px-2 py-1.5 text-xs italic text-[#7DD3FC]'>
                        « {offer.note} »
                    </p>
                )}

                {/* Response button: only for offers the user does not
                    own. Greyed out until every slot has a matching pick,
                    green when ready. Shows an inline success or error
                    banner after the call. */}
                {canRespond && (
                    <div className='flex flex-col items-center gap-2 pt-1'>
                        {respondSuccess && (
                            <p className='w-full rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-center text-xs text-emerald-400'>
                                {respondSuccess}
                            </p>
                        )}

                        {respondError && (
                            <p className='w-full rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-center text-xs text-destructive'>
                                {respondError}
                            </p>
                        )}

                        <div className='flex items-center gap-2'>
                            <button
                                type='button'
                                disabled={respondBusy}
                                onClick={() => {
                                    // TODO: wire this to whatever the
                                    // Modifier action should do. Kept
                                    // as a no-op for now on purpose.
                                }}
                                className='w-32 cursor-pointer rounded-lg border-2 border-[#00C8FF] bg-transparent px-4 py-2 text-sm font-bold uppercase tracking-wider text-[#00C8FF] transition-colors hover:bg-[#00A8FF]/10 disabled:cursor-not-allowed disabled:opacity-40'
                            >
                                Modifier
                            </button>

                            <button
                                type='button'
                                disabled={!allSlotsFilled || respondBusy}
                                onClick={handleOffer}
                                className={`w-32 rounded-lg px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors ${allSlotsFilled && !respondBusy
                                    ? 'cursor-pointer bg-emerald-500 text-emerald-950 hover:bg-emerald-400'
                                    : 'cursor-not-allowed bg-zinc-800 text-zinc-500'
                                    }`}
                            >
                                {respondBusy ? 'Envoi...' : 'Offrir'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Response action buttons (Accepter / Refuser):
                    shown only when the parent wires at least one
                    callback (i.e. the "Offres reçues" panel) AND the
                    response is still Pending. Refuser sits to the
                    left of Accepter. Once the response flips to
                    Accepted, this block disappears entirely and the
                    gold "OFFRE ACCEPTÉE" label below takes its
                    place. */}
                {(onAccept || onReject) && offer.status === 'Pending' && (
                    <div className='flex justify-center gap-2 pt-1'>
                        {onReject && (
                            <button
                                type='button'
                                onClick={onReject}
                                disabled={busy}
                                className='w-32 cursor-pointer rounded-lg border border-destructive/60 bg-transparent px-4 py-2 text-sm font-bold uppercase tracking-wider text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50'
                            >
                                Refuser
                            </button>
                        )}

                        {onAccept && (
                            <button
                                type='button'
                                onClick={onAccept}
                                disabled={busy}
                                className='w-32 cursor-pointer rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold uppercase tracking-wider text-emerald-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50'
                            >
                                {busy ? 'Envoi...' : 'Accepter'}
                            </button>
                        )}
                    </div>
                )}

                {/* Accepted-state label. Rendered on every card whose
                    underlying response status is Accepted — which
                    means both sides of the exchange: the offer
                    creator's "Reçues" panel and the responder's
                    "Envoyées" panel. The gold color matches the
                    gold frame applied to the card above, so the
                    whole card reads as one accepted state. */}
                {isAccepted && (
                    <div className='flex justify-center pt-1'>
                        <span
                            className='text-lg font-bold uppercase tracking-widest'
                            style={{
                                color: '#FFC72C',
                                textShadow:
                                    '0 0 8px rgba(255, 199, 44, 0.5)',
                            }}
                        >
                            Offre acceptée
                        </span>
                    </div>
                )}
            </div>
        </article>
    );
}

// ---------------------------------------------------------------------
// Manager roster popup
// ---------------------------------------------------------------------

/**
 * French label for a RosterStatus, used as the section header in
 * the roster popup.
 */
function rosterStatusSectionLabel(status: string): string {
    switch (status) {
        case 'Active':
            return 'Alignement';
        case 'Bench':
            return 'Banc';
        case 'Prospect':
            return 'Prospects';
        default:
            return status;
    }
}

/**
 * One player row inside the ManagerRosterPopup. Same visual design
 * as the left column of an OfferCard slot: NHL team logo, player
 * name, position, two-season stat table, contract label. Wrapped
 * in a subtle bordered box so consecutive players are visually
 * separated.
 */
function RosterPlayerRow({
    entry,
    teamId,
    teamName,
    positionFilter,
}: {
    entry: RosterEntry;
    /**
     * The team this roster belongs to. Passed down so the player
     * Link can record which popup the user left, allowing
     * MarketplacePage to reopen it when the user comes back from
     * PlayerPage.
     */
    teamId: number;
    teamName: string;
    positionFilter: PositionGroup;
}) {
    const currentContractLabel =
        contractLabel(entry.currentContract) ??
        compactSalary(entry.fantasySalary);

    const secondContractLabel = contractLabel(entry.secondContract);

    const isGoalie = toPositionGroup(entry.position) === 'G';

    return (
        <div
            className='rounded-md border px-2 py-2'
            style={{
                borderColor: 'rgba(0, 168, 255, 0.2)',
                backgroundColor: 'rgba(0, 168, 255, 0.03)',
            }}
        >
                      <div className='flex min-w-0 flex-col items-center text-center'>
                <div className='flex flex-wrap items-baseline justify-center gap-x-1.5 gap-y-0.5 text-sm leading-none text-foreground md:text-base'>
                    {entry.nhlTeamAbbreviation && (
                        /*
                         * Wrapper holds the layout footprint at 16x16,
                         * which is the same footprint the logo had at
                         * size={16}. The inner NhlTeamLogo is 16px too,
                         * and the whole wrapper is scaled 1.25x with
                         * `transform` — which does NOT change layout, so
                         * the row's natural height stays exactly what it
                         * was before. The rendered logo reads as 20px
                         * (16 * 1.25), but the card never grows.
                         *
                         * `self-center` is still needed because the row
                         * uses items-baseline: without it, the logo
                         * would sit on the text baseline instead of
                         * being vertically centered against the row.
                         */
                        <span
                            className='shrink-0 self-center'
                            style={{
                                width: 16,
                                height: 16,
                                display: 'inline-block',
                                transform: 'scale(1.25)',
                                transformOrigin: 'center',
                            }}
                        >
                            <NhlTeamLogo
                                abbreviation={entry.nhlTeamAbbreviation}
                                size={16}
                            />
                        </span>
                    )}

                    <Link
                        to={`/joueurs/${entry.nhlPlayerId}`}
                        onClick={() =>
                            setMarketplacePopupRestore({
                                teamId,
                                teamName,
                                positionFilter,
                            })
                        }
                        className='truncate font-semibold text-foreground transition-colors hover:text-[#00E5FF]'
                    >
                        {entry.firstName} {entry.lastName}
                    </Link>

                    <span className='shrink-0 text-xs uppercase leading-none text-white md:text-sm'>
                        {entry.position}
                    </span>

                    {entry.age != null && (
                        <span className='shrink-0 text-xs font-normal leading-none text-white md:text-sm'>
                            {entry.age} ans
                        </span>
                    )}
                </div>

                <StatLinesTable
                    current={entry.currentSeason}
                    previous={entry.lastSeason}
                    isGoalie={isGoalie}
                    size='md'
                />

                {currentContractLabel && (
                    <div className='mt-1 flex flex-wrap items-center justify-center gap-x-1 text-xs leading-none font-semibold text-emerald-400 md:text-sm'>
                        <span className='whitespace-nowrap'>
                            {currentContractLabel}
                        </span>

                        {secondContractLabel && (
                            <>
                                <span
                                    aria-hidden='true'
                                    className='opacity-80'
                                >
                                    →
                                </span>
                                <span className='whitespace-nowrap'>
                                    {secondContractLabel}
                                </span>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * Popup that shows a fantasy team's full roster, using the same
 * visual design as the offer-card slots. Triggered by clicking a
 * manager name on any offer card inside MarketplacePage. Renders
 * via a portal so it always sits above the page.
 *
 * Size: 75% of the viewport, capped so it stays reasonable on an
 * ultrawide monitor. Layout: fixed header with the team name and
 * a Fermer button, scrollable body with the roster grouped by
 * RosterStatus (Alignement / Banc / Prospects).
 *
 * Only reads the roster via the existing GET /api/Roster/team/{id}
 * endpoint. No side effects anywhere else.
 */
function ManagerRosterPopup({
    teamId,
    teamName,
    initialPositionFilter,
    onClose,
}: {
    teamId: number;
    teamName: string;
    /**
     * Position group the popup should start on. Undefined means
     * 'F' (Attaquants), the default for a fresh open. Only read
     * on the first mount of this instance; changing it later does
     * not re-run the initializer.
     */
    initialPositionFilter?: PositionGroup;
    onClose: () => void;
}) {
    const [roster, setRoster] = useState<TeamRoster | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    /**
     * Position filter for the popup. One of 'F' | 'D' | 'G'.
     * Defaults to 'F' (Attaquants) on a fresh open, and to
     * whatever the parent restored when the popup was reopened
     * after a PlayerPage round-trip.
     */
    const [positionFilter, setPositionFilter] =
        useState<PositionGroup>(initialPositionFilter ?? 'F');

    /**
     * Close handler. Clears any pending restore so the popup does
     * not reopen on a subsequent visit to /marketplace, then
     * signals the parent to unmount it.
     *
     * Declared before the effects that reference it, because
     * `const` bindings are in the temporal dead zone until their
     * declaration is evaluated. The Escape handler below needs
     * this to be initialized by the time the effect body runs.
     */
    const handleClose = useCallback(() => {
        clearMarketplacePopupRestore();
        onClose();
    }, [onClose]);

    useEffect(() => {
        let cancelled = false;

        setLoading(true);
        setError(null);

        getTeamRoster(teamId)
            .then((data) => {
                if (!cancelled) setRoster(data);
            })
            .catch(() => {
                if (!cancelled) {
                    setError('Impossible de charger cette équipe.');
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [teamId]);

    // Close on Escape.
    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') handleClose();
        }

        document.addEventListener('keydown', onKeyDown);

        return () => {
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [handleClose]);

    /**
 * Group the roster entries by RosterStatus, filtered to the
 * currently selected position group, then sorted by current-
 * season fantasy points.
 *
 * The grouping pass relies on the backend's ordering (status,
 * slot, last name): it walks the filtered list and inserts a
 * new group every time the status changes. Doing the sort
 * after the grouping pass keeps the sections intact — the
 * sort re-orders players within each section, it never mixes
 * two statuses together.
 *
 * Sort key: current-season FP descending. A player with no
 * current-season row (rare — a prospect who never dressed, or
 * a fresh call-up) sorts to the bottom of his section. Ties
 * fall back to last name, then first name, so the order is
 * stable across renders.
 *
 * Sections whose entry list becomes empty after filtering are
 * dropped from the result, so the popup shows no dead section
 * headers when a team has no forwards on the bench, etc.
 */
    const sections = useMemo(() => {
        if (!roster) return [];

        const filteredEntries = roster.entries.filter(
            (entry) =>
                toPositionGroup(entry.position) === positionFilter,
        );

        const grouped: { status: string; entries: RosterEntry[] }[] =
            [];

        for (const entry of filteredEntries) {
            const last = grouped[grouped.length - 1];

            if (!last || last.status !== entry.rosterStatus) {
                grouped.push({
                    status: entry.rosterStatus,
                    entries: [entry],
                });
            } else {
                last.entries.push(entry);
            }
        }

        // Sort each section by FP descending. Sentinel -1 for the
        // missing-row case ensures those players always sort below
        // anyone who actually has a fantasy point total.
        for (const group of grouped) {
            group.entries.sort((a, b) => {
                const fpA = a.currentSeason?.fantasyPoints ?? -1;
                const fpB = b.currentSeason?.fantasyPoints ?? -1;

                if (fpA !== fpB) return fpB - fpA;

                const byLast = a.lastName.localeCompare(b.lastName);
                if (byLast !== 0) return byLast;

                return a.firstName.localeCompare(b.firstName);
            });
        }

        return grouped;
    }, [roster, positionFilter]);

    return createPortal(
        <div
            className='fixed inset-0 z-[100] flex items-center justify-center p-4'
            style={{ backgroundColor: 'rgba(8, 13, 26, 0.85)' }}
            onClick={handleClose}
            role='dialog'
            aria-modal='true'
            aria-label={`Alignement de ${teamName}`}
        >
            <div
                className='flex flex-col overflow-hidden rounded-lg'
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: '90vw',
                    height: '90vh',
                    maxWidth: '1400px',
                    maxHeight: '1400px',
                    backgroundColor: FRAME_BG,
                    border: `${OFFER_TUBE_PX}px solid ${OFFER_TUBE_COLOR}`,
                    boxShadow: [
                        `inset 0 0 0 1px ${OFFER_FILAMENT}`,
                        `inset 0 0 10px ${OFFER_BLOOM_NEAR}`,
                        `inset 0 0 28px ${OFFER_BLOOM_FAR}`,
                    ].join(', '),
                }}
            >
                <div
                    className='relative flex shrink-0 items-center justify-between border-b px-3 py-2'
                    style={{
                        borderColor: 'rgba(0, 168, 255, 0.35)',
                        background: HEADER_GRADIENT,
                    }}
                >
                    <span className='text-[0.6rem] font-semibold uppercase tracking-wider text-[#00E5FF]'>
                        Alignement
                    </span>

                    <span className='absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 truncate px-10 text-xs font-bold uppercase tracking-wider text-white md:text-sm'>
                        {teamName}
                    </span>

                    <button
                        type='button'
                        onClick={handleClose}
                        className='cursor-pointer rounded border border-destructive/40 px-2 py-0.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10'
                    >
                        Fermer
                    </button>
                </div>

                {/*
                 * Position filter, sitting between the popup header
                 * and the scrollable body. Placing it here — as a
                 * sibling of the header and the scroll container,
                 * not inside it — pins it right under the header
                 * while the section list scrolls underneath.
                 * `shrink-0` stops the popup's flex column from
                 * compressing it when the body grows.
                 *
                 * Same contained-filament look as the marketplace
                 * sub-toggle so the two read as the same control
                 * family. The `marketplace-sub-toggle` class
                 * reuses the mobile font-size reduction defined
                 * in index.css.
                 */}
                <div
                    className='shrink-0 border-b px-2 py-2 md:px-3'
                    style={{
                        borderColor: 'rgba(0, 168, 255, 0.2)',
                    }}
                >
                    <div className='flex items-center justify-center'>
                        <div
                            className='marketplace-sub-toggle flex items-center rounded-full border border-[#00E5FF]/60 bg-[#050A18]/80 p-0.5 text-xs'
                            style={{
                                boxShadow:
                                    '0 0 6px rgba(0, 229, 255, 0.35), inset 0 0 6px rgba(0, 229, 255, 0.08)',
                            }}
                        >
                            <button
                                type='button'
                                onClick={() => setPositionFilter('F')}
                                className={`cursor-pointer whitespace-nowrap rounded-full px-3 py-0.5 font-semibold transition-colors ${positionFilter === 'F'
                                        ? 'bg-[#00E5FF] text-[#080D1A]'
                                        : 'bg-transparent text-[#A6ECFF] hover:text-white'
                                    }`}
                            >
                                Attaquants
                            </button>

                            <button
                                type='button'
                                onClick={() => setPositionFilter('D')}
                                className={`cursor-pointer whitespace-nowrap rounded-full px-3 py-0.5 font-semibold transition-colors ${positionFilter === 'D'
                                        ? 'bg-[#00E5FF] text-[#080D1A]'
                                        : 'bg-transparent text-[#A6ECFF] hover:text-white'
                                    }`}
                            >
                                Défenseurs
                            </button>

                            <button
                                type='button'
                                onClick={() => setPositionFilter('G')}
                                className={`cursor-pointer whitespace-nowrap rounded-full px-3 py-0.5 font-semibold transition-colors ${positionFilter === 'G'
                                        ? 'bg-[#00E5FF] text-[#080D1A]'
                                        : 'bg-transparent text-[#A6ECFF] hover:text-white'
                                    }`}
                            >
                                Gardiens
                            </button>
                        </div>
                    </div>
                </div>

                <div className='flex-1 overflow-y-auto p-2 md:p-3'>
                    {loading && (
                        <p className='py-4 text-center text-sm text-muted-foreground'>
                            Chargement...
                        </p>
                    )}

                    {error && (
                        <p className='py-4 text-center text-sm text-destructive'>
                            {error}
                        </p>
                    )}

                    {!loading && !error && sections.length === 0 && (
                        <p className='py-4 text-center text-sm text-muted-foreground'>
                            {roster != null && roster.entries.length > 0
                                ? 'Aucun joueur à ce poste.'
                                : 'Aucun joueur dans cette équipe.'}
                        </p>
                    )}

                    {sections.map((section, sIdx) => (
                        <div
                            key={`${section.status}-${sIdx}`}
                            className={sIdx > 0 ? 'mt-3' : ''}
                        >
                            <div className='mb-2 flex justify-center'>
                                <span className='px-3 py-0.5 text-[0.75rem] font-bold uppercase tracking-widest text-[#00E5FF] md:text-sm'>
                                    {rosterStatusSectionLabel(
                                        section.status,
                                    )}
                                </span>
                            </div>

                            <div className='space-y-2'>
                                {section.entries.map((entry) => (
                                    <RosterPlayerRow
                                        key={entry.id}
                                        entry={entry}
                                        teamId={teamId}
                                        teamName={teamName}
                                        positionFilter={positionFilter}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>,
        document.body,
    );
}
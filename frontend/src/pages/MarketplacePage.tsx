import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import {
    Link,
    useNavigate,
    useSearchParams,
} from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import {
    acceptTradeOfferResponse,
    cancelTradeOffer,
    cancelTradeOfferResponse,
    createDirectOffer,
    createTradeOffer,
    rejectTradeOfferResponse,
    getLeagueTeams,
    getTeamDraftPicks,
    getTeamRoster,
    listReceivedResponses,
    listSentResponses,
    listTradeOffers,
    markOffersSeen,
    markResponsesSeen,
    respondToTradeOffer,
    updateTradeOffer,
    type CreateTradeOfferSlotRequest,
    type DraftPick,
    type FantasyTeam,
    type PlayerContractLine,
    type RespondToTradeOfferPick,
    type RosterEntry,
    type SeasonStatLine,
    type TeamRoster,
    type MarketplaceNotificationCount,
    type TradeOffer,
    type TradeOfferResponse,
    type TradeOfferSlot,
} from '@/api/client';
import { NhlTeamLogo } from '@/components/nhl/NhlTeamLogo';
import {
    clearMarketplacePopupRestore,
    consumeMarketplacePopupRestore,
    setMarketplacePopupRestore,
    type PendingDirectPickContext,
    type PendingPickContext,
    type PendingPublishPickContext,
    type TradeCapContext,
} from '@/lib/marketplacePopupRestoration';
import {
    clearCountering,
    getCounteringResponse,
    startCountering,
    subscribeToCounterOfferState,
} from '@/lib/marketplaceCounterOfferState';
import {
    getMarketplaceSection,
    setMarketplaceSection,
} from '@/lib/marketplaceSectionState';
import {
    consumeMarketplaceNavigationRequest,
    getMarketplaceNavigationRequestId,
    requestMarketplaceNavigation,
    subscribeToMarketplaceNavigationRequest,
} from '@/lib/marketplaceNavigationStore';
import * as DraftPicks from '@/lib/marketplacePicksState';
import {
    getMarketplaceNotificationsSnapshot,
    refreshMarketplaceNotificationsNow,
    subscribeToMarketplaceNotifications,
} from '@/lib/marketplaceNotificationsStore';
import { TradePicksSlot } from '@/components/marketplace/TradePicksSlot';
import {
    CLEARED_OFFERING_SENTINEL,
    clearOfferingForSlot,
    clearOfferingOverridesForOffer,
    getOfferingOverridesForOffer,
    setOfferingOverrideForSlot,
    subscribeToOfferingOverrides,
} from '@/lib/marketplaceOfferingOverrides';
import {
    getDirectOfferDraft,
    resetDirectOfferSlotsAndNote,
    subscribeToDirectOfferDraft,
    updateDirectOfferDraft,
} from '@/lib/directOfferState';
import {
    clearPicksForOffer,
    getPicksForOffer,
    pickForSlot,
    subscribeToPicks,
} from '@/lib/marketplaceTradeState';
import {
    addExtraResponderSlot,
    clearExtraResponderSlots,
    getExtraResponderSlots,
    removeExtraResponderSlot,
    subscribeToExtraResponderSlots,
} from '@/lib/marketplaceExtraResponderSlots';
import {
    clearPublishSlot,
    getPublishDraft,
    pickPublishSlot,
    resetPublishDraft,
    subscribeToPublishDraft,
    updatePublishDraft,
    type PublishSlotState,
} from '@/lib/publishOfferState';
import {
    clearResponseNote,
    getResponseNote,
    setResponseNote,
    subscribeToResponseNotes,
} from '@/lib/marketplaceResponseNotesState';
import {
    addRemovedCreatorPick,
    clearRemovedCreatorPicks,
    getRemovedCreatorPicks,
    removeRemovedCreatorPick,
    subscribeToRemovedCreatorPicks,
} from '@/lib/marketplaceRemovedCreatorPicksState';

/**
 * Defensive accessor for the accepted-sent-response count.
 *
 * The `unseenAcceptedSentResponses` field is present only when the
 * backend has been extended with the `UnseenAcceptedSentResponses`
 * count. On a deployment that has not yet shipped that backend
 * change, the field is missing from the JSON and reads as undefined
 * at runtime even if TypeScript says otherwise.
 *
 * Returning 0 in that case keeps the Envoyées badge hidden rather
 * than rendering "NaN" or throwing.
 */
function getAcceptedSentCount(
    notifications: MarketplaceNotificationCount,
): number {
    const raw = (notifications as {
        unseenAcceptedSentResponses?: number;
    }).unseenAcceptedSentResponses;

    return typeof raw === 'number' ? raw : 0;
}

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

type View = 'add' | 'browse' | 'received' | 'sent';

type PositionGroup = 'F' | 'D' | 'G';

type SlotState = PublishSlotState;

const EMPTY_SLOT: SlotState = {
    offeringPlayerId: null,
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

/**
 * Formats a player's name as "F. Lastname". Falls back to just the
 * last name when the first name is missing or empty.
 */
function shortName(
    firstName: string | null | undefined,
    lastName: string | null | undefined,
): string {
    const first = (firstName ?? '').trim();
    const last = (lastName ?? '').trim();

    if (first.length === 0) {
        return last;
    }

    return `${first.charAt(0).toUpperCase()}. ${last}`;
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

/**
 * A slot counts as "complete" (i.e. publishable) as soon as it has
 * EITHER a demanded position OR an offered player. The user is not
 * forced to fill both:
 *
 *   - Offering a player alone is a valid announcement
 *     ("I'm offering X, send me offers").
 *   - Picking a position alone is also valid
 *     ("I'm looking for a D, no specific player on the table").
 *
 * When only a player is picked, the position group that goes on
 * the wire is derived from the player's real position in
 * slotToRequest. When only a position is picked, the offering
 * player stays null and the slot is a pure demand.
 */
function slotIsComplete(slot: SlotState): boolean {
    return slot.offeringPlayerId !== null;
}

/**
 * Builds the request slot that goes on the wire.
 *
 * Position derivation:
 *   - If the user explicitly picked a position, use it.
 *   - Otherwise, if a player was picked, derive the position
 *     group from the player's real position on his roster entry.
 *     This lets the user announce a trade with only ONE of the
 *     two fields set: offering a player alone is a valid
 *     announcement, and the demand side silently inherits the
 *     player's position group so the backend accepts it.
 *   - Otherwise the slot is empty and the caller should have
 *     filtered it out before reaching this mapper.
 */
function slotToRequest(
    slot: SlotState,
    entries: RosterEntry[],
): CreateTradeOfferSlotRequest {
    // The backend still expects a valid F/D/G on every slot, but
    // there is no UI to pick one anymore. Derive it from the
    // offered player's own position. If the player cannot be
    // found (shouldn't happen for a freshly-built slot), default
    // to 'F' so the request stays valid.
    let positionGroup: PositionGroup = 'F';

    if (slot.offeringPlayerId != null) {
        const entry = entries.find(
            (e) => e.playerId === slot.offeringPlayerId,
        );

        if (entry) {
            positionGroup = toPositionGroup(entry.position);
        }
    }

    return {
        positionGroup,
        offeringPlayerId: slot.offeringPlayerId,
    };
}

/**
 * Stub retained for call sites that used to apply demand criteria.
 * The criterias were removed from the marketplace, so every slot
 * now matches every player.
 */
function playerMatchesSlotDemand(
    _entry: RosterEntry,
    _slot: TradeOfferSlot,
): boolean {
    return true;
}

/**
 * Builds a RosterEntry-shaped snapshot of the offering player on
 * a "Voir les offres" slot, so the roster popup can render it as a
 * sticky reference card while the responder browses his own roster.
 *
 * The offer DTO already carries every field the reference card
 * actually renders (logo, name, position, age, stats, contracts),
 * so we just pack them into the RosterEntry shape. Fields the
 * reference card never reads (roster slot, roster status, injury,
 * yesterday/today FP) get safe defaults.
 *
 * Returns null when the slot has no offering player — in that
 * case there is nothing to reference, and the popup opens exactly
 * like before.
 */
function buildReferenceFromSlot(
    slot: TradeOfferSlot,
): RosterEntry | null {
    if (slot.offeringPlayerId == null) {
        return null;
    }

    return {
        id: -1,
        fantasyTeamId: 0,
        playerId: slot.offeringPlayerId,
        nhlPlayerId: slot.offeringPlayerNhlPlayerId ?? 0,
        firstName: slot.offeringPlayerFirstName ?? '',
        lastName: slot.offeringPlayerLastName ?? '',
        position: slot.offeringPlayerPosition ?? '',
        age: slot.offeringPlayerAge,
        nhlTeamAbbreviation:
            slot.offeringPlayerNhlTeam ?? '',
        rosterStatus: 'Active',
        rosterSlot: 0,
        fantasySalary:
            slot.offeringPlayerCurrentContract?.salary ?? 0,
        headshotUrl: null,
        twoSeasonsAgo: null,
        lastSeason: slot.offeringPlayerLastSeasonStats,
        currentSeason: slot.offeringPlayerCurrentSeasonStats,
        currentContract:
            slot.offeringPlayerCurrentContract,
        secondContract:
            slot.offeringPlayerSecondContract,
        rosterLocation: null,
        yesterdayFantasyPoints: null,
        todayFantasyPoints: null,
        isInjured: false,
        injuryStatus: null,
        injuryKind: 'None',
        injuryShortDescription: null,
        injuryLongDescription: null,
        injuryType: null,
        injuryDetail: null,
        injurySide: null,
        injuryReturnDate: null,
        injuryFantasyStatus: null,
    };
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
    GP: '#00F0FF',
    G: '#FFFFFF',
    A: '#FFFFFF',
    PTS: '#00F0FF',
    TOI: '#FFFFFF',
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
const MARK_SEEN_DELAY_MS = 1000;

/**
 * Shared style for the two team-name buttons on the offer card
 * header (creator on the left, responder on the right). Both are
 * single buttons — not a segmented toggle — that open the roster
 * popup. They size to their content, so a short team name gets a
 * compact pill and a longer one still fits within the column with
 * an ellipsis.
 *
 * Colors mirror the "Marché" active segment on the main
 * marketplace toggle: solid fill, dark navy text, glow chain.
 * Fill uses the FP gold from ClassementPage (#FFC72C) so the two
 * header buttons read as part of the "highlighted" family, the
 * same accent the standings table uses for its FP column.
 *
 * Same object is reused on all four call sites (clickable and
 * non-clickable variants of both sides) so tuning the look is a
 * one-spot change.
 */
const TEAM_NAME_BUTTON_STYLE: React.CSSProperties = {
    backgroundColor: '#14B8A6',
    color: '#1D1B61',
    border: '1px solid #5EEAD4',
};

// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------

export default function MarketplacePage() {
    const { user } = useAuth();
    const navigate = useNavigate();

    // Restore the last section the user was on. Only read on the very
    // first mount: useState's initializer runs once, and the
    // browseSubView useState further down reads the same store the
    // same way. Every change is persisted back by the sync effect
    // below, so a remount (after clicking a player name and coming
    // back via Fermer or browser Back) lands on the same tab.
    /**
     * URL search params. Used to route the user to a specific
     * section when he arrives from the navbar's priority link.
     *
     * The section store remains the fallback: on a plain
     * `/marketplace` visit the params are absent and the store
     * decides what tab was last open.
     */
    const [searchParams, setSearchParams] = useSearchParams();

    const [view, setView] = useState<View>(() => {
        // First render: prefer the URL param, fall back to the store.
        const urlView = searchParams.get('view');

        if (
            urlView === 'received' ||
            urlView === 'sent' ||
            urlView === 'add' ||
            urlView === 'browse'
        ) {
            return urlView;
        }

        return getMarketplaceSection().view;
    });

    const [browseRefreshTick, setBrowseRefreshTick] = useState(0);

    /**
 * Live marketplace notification counts, per category:
 *
 *   - unseenOffers             → "Marché" (new or modified
 *                                 offers in Voir les offres)
 *   - unseenResponses          → "Reçues" (pending responses
 *                                 on the user's own offers)
 *   - unseenAcceptedSentResp.  → "Envoyées" (responses the
 *                                 user sent that have been
 *                                 accepted)
 *
 * Subscribed via useSyncExternalStore so the segmented button
 * labels update the moment the store's poll or a manual refresh
 * brings in new numbers — same source the navbar badge reads
 * from, so the two are always in sync.
 *
 * The counts are computed once per render and reused by the
 * four button labels below.
 */
    const marketplaceNotifications = useSyncExternalStore(
        subscribeToMarketplaceNotifications,
        getMarketplaceNotificationsSnapshot,
    );

    const marketplaceCount = marketplaceNotifications.unseenOffers;
    const receivedCount = marketplaceNotifications.unseenResponses;
    const sentCount = getAcceptedSentCount(marketplaceNotifications);

    /**
     * Team list + selected target for the "Créer" tab (direct
     * offers). Fetched once on mount; the dropdown excludes the
     * current user's own team, since a manager cannot send a
     * direct offer to himself.
     */
    const [directOfferTeams, setDirectOfferTeams] =
        useState<FantasyTeam[]>([]);

    /**
     * The "Créer" tab's draft state (selected target team, per-
     * slot picks, note) lives in a module-level store so it
     * survives a PlayerPage round-trip: if the user opens his
     * player detail from inside the pick roster popup and comes
     * back, the entire form is exactly where he left it.
     *
     * Only the selected target team id is read here — the slots
     * and note are read inside DirectOfferCard, which subscribes
     * to the same store.
     */
    const directOfferDraft = useSyncExternalStore(
        subscribeToDirectOfferDraft,
        getDirectOfferDraft,
    );
    const selectedDirectOfferTeamId =
        directOfferDraft.selectedTargetTeamId;

    /**
     * Token used to programmatically open the "Offrir à" team
     * picker from outside. Each increment opens the picker. Bumped
     * by DirectOfferCard's right-side "Choisir un gestionnaire"
     * button when no target team has been selected yet.
     */
    const [teamPickerOpenToken, setTeamPickerOpenToken] =
        useState(0);

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
        /**
         * When set, the popup is opened in "pick a player for this
         * offer slot" mode: the segmented position filter is locked
         * to the slot's required position, the other strict demand
         * criteria on the slot are applied as hard filters on the
         * roster, and each player row exposes a green "Ajouter"
         * button that calls `onPick` and closes the popup.
         *
         * When undefined, the popup behaves as before — the user
         * just wants to browse a roster.
         */
        pickContext?: {
            slot: TradeOfferSlot;
            /**
             * Id of the offer this pick belongs to. Used to rebuild
             * a fresh onPick on restore (see the mount effect
             * below) and to key the pick store.
             */
            offerId: number;
            /**
             * Index of the slot inside the offer. Same source as
             * `slot.slotIndex`; stored separately so the popup
             * can rebuild the pick context without needing the
             * full slot shape at hand.
             */
            slotIndex: number;
            onPick: (playerId: number) => void;
            /**
             * Cap-projection context, carried alongside the slot so
             * the roster popup can render the new cap row under
             * each player's contract row. Undefined when the offer
             * card lacked a cap number (rare — only if the backend
             * did not send a cap hit for either side, or the
             * season cap is 0).
             */
            capContext?: TradeCapContext;
            /**
             * Which side of the slot this pick is for.
             *
             *   'responding' (default): the responder is picking
             *   his own player for the slot. The "Retirer" button
             *   clears the responding pick.
             *
             *   'offering': the responder is overriding the offer
             *   creator's offering player. The "Retirer" button
             *   clears the override, which reverts the offering
             *   side to the creator's original player.
             */
            side?: 'responding' | 'offering';
            /**
             * Player ids the roster popup must hide from the list.
             * Carried from the OfferCard click site so players
             * already committed to other slots of the same trade
             * cannot be picked twice.
             */
            excludedPlayerIds?: number[];
        };
        /**
    * Pick context for the "Créer" tab. Mutually exclusive
    * with `pickContext` — a popup is either a Voir les
    * offres pick, a Créer pick, or (both undefined) a plain
    * roster browse.
    *
    * `capContext` carries the two teams' cap situation so
    * the popup can render the projected cap rows under each
    * player card.
    */
        directPickContext?: {
            slotIndex: number;
            side: 'offering' | 'target';
            lockedPosition?: PositionGroup;
            capContext?: TradeCapContext;
            /**
             * Player id of the current pick in the slot on the side
             * being picked. Null when that side is empty. Drives
             * the "Retirer" button in the popup.
             */
            currentPickedPlayerId: number | null;
            onPick: (playerId: number) => void;
            /**
             * Clears the current pick on that slot side. Only set
             * for Créer. Null for Voir les offres, where the
             * responding pick is changed by picking a different
             * player, not by removing one.
             */
            onClearPick?: () => void;
        };
        /**
         * Pick context for the "Publier une annonce" flow. Set when
         * the popup was opened from a SlotEditor's "Choisir un
         * joueur" button.
         *
         * Different from `directPickContext`:
         *
         *   - No `side` (there is only one side to pick — the
         *     user's own player, on the user's own team).
         *   - No `capContext` (a public announcement does not
         *     know who will respond, so no cap projection is
         *     possible).
         *   - `excludedPlayerIds` is carried on the context
         *     because the AddOfferPanel that owns the slot state
         *     lives in local React state and cannot be read live
         *     by MarketplacePage.
         *
         * Since the popup closes on every pick / clear, the
         * snapshot taken at open time stays valid for the
         * popup's whole lifetime.
         */
        publishPickContext?: {
            slotIndex: number;
            currentPickedPlayerId: number | null;
            lockedPosition?: PositionGroup;
            excludedPlayerIds: number[];
            onPick: (playerId: number) => void;
            onClearPick: () => void;
        };
        /**
         * Player from the OTHER side of the trade slot, rendered as
         * a sticky reference card at the top of the popup so the
         * user can see his stats and contracts while browsing the
         * other team's roster. Null when the other side of the slot
         * has no player picked (nothing to reference).
         */
        referencePlayer?: RosterEntry | null;
    } | null>(null);

    /**
    * Current pick on the side being picked for the Créer popup,
    * derived LIVE from the draft store instead of being frozen
    * into the pick context at open time.
    *
    * Why live: when the user clicks "Retirer" on that row, the
    * store writes null to the slot's field. If the popup read a
    * frozen snapshot from its own state, the row would keep
    * showing "Retirer" until the popup was closed and reopened.
    * Deriving it here means the popup re-renders with the new
    * value on the next store notification.
    *
    * Returns:
    *   - undefined when the popup is not in Créer pick mode
    *     (Voir les offres pick, plain browse, or closed);
    *   - null when the popup is in Créer pick mode and the side
    *     being picked has no pick yet;
    *   - the picked player's id otherwise.
    */
    const directPopupPickedPlayerId = (() => {
        const ctx = rosterPopupTeam?.directPickContext;
        if (ctx == null) return undefined;

        const slot = directOfferDraft.slots[ctx.slotIndex];
        if (slot == null) return null;

        return ctx.side === 'offering'
            ? slot.offeringPlayerId
            : slot.targetPlayerId;
    })();

    /**
     * Players already committed to another slot of the SAME trade
     * on the same side, so the popup can hide them and the user
     * cannot pick the same player twice.
     *
     * Scope:
     *   - Only the side being picked. Offering picks are on the
     *     connected user's roster, target picks are on the target
     *     team's roster. The popup shows one roster at a time, so
     *     only the picks from that side matter.
     *
     *   - Excludes the CURRENT slot's own pick. The popup still
     *     needs to display that player (pinned card, Retirer
     *     button), so it must not be filtered out.
     *
     * Undefined when the popup is not in Créer pick mode, or when
     * no other slot contributes a pick. Memoized so the popup's
     * own memos stay stable across re-renders of this component.
     */
    const directPopupExcludedPlayerIds = useMemo(() => {
        const ctx = rosterPopupTeam?.directPickContext;
        if (ctx == null) return undefined;

        const excluded: number[] = [];

        for (let i = 0; i < directOfferDraft.slots.length; i++) {
            if (i === ctx.slotIndex) continue;

            const slot = directOfferDraft.slots[i];
            const pick =
                ctx.side === 'offering'
                    ? slot.offeringPlayerId
                    : slot.targetPlayerId;

            if (pick != null) excluded.push(pick);
        }

        return excluded.length === 0 ? undefined : excluded;
    }, [rosterPopupTeam, directOfferDraft]);

    /**
     * Offer id and slot index for the Voir les offres pick mode,
     * or null when the popup is not in that mode.
     */
    const viewOffersOfferId =
        rosterPopupTeam?.pickContext?.offerId ?? null;
    const viewOffersSlotIndex =
        rosterPopupTeam?.pickContext?.slotIndex ?? null;

    /**
  * Live picks for the Voir les offres pick mode's offer.
  * Subscribed via useSyncExternalStore so the popup re-renders
  * the moment the user clicks "Retirer" or "Ajouter", without
  * needing to close and reopen.
  */
    const viewOffersPicks = useSyncExternalStore(
        subscribeToPicks,
        () =>
            getPicksForOffer(viewOffersOfferId ?? -1),
    );

    /**
     * Live offering-side overrides for the Voir les offres pick
     * mode's offer. Mirrors viewOffersPicks: when the popup is
     * opened for the offering side, the "Retirer" button must
     * clear the override on that slot, and the pinned card must
     * show the override player. Subscribed at the page level
     * because OfferCard's own `offeringOverrides` subscription is
     * scoped to that component and is not visible here.
     */
    const viewOffersOfferingOverrides = useSyncExternalStore(
        subscribeToOfferingOverrides,
        () =>
            getOfferingOverridesForOffer(viewOffersOfferId ?? -1),
    );

    /**
     * Player id of the current pick in the Voir les offres slot
     * being picked, or null when that slot has no pick. Undefined
     * when the popup is not in Voir les offres pick mode.
     *
     * Reads from whichever store the current side writes to:
     *   - 'offering': the offering-override store (creator-side).
     *   - 'responding' (or no side): the responder-picks store.
     */
    const viewOffersPickedPlayerId = (() => {
        if (viewOffersSlotIndex == null) return undefined;

        if (rosterPopupTeam?.pickContext?.side !== 'offering') {
            return viewOffersPicks[viewOffersSlotIndex] ?? null;
        }

        const raw =
            viewOffersOfferingOverrides[viewOffersSlotIndex];

        // Cleared: nothing pinned.
        if (raw === CLEARED_OFFERING_SENTINEL) return null;

        // Override set: pin the override player.
        if (raw != null) return raw;

        // No override: pin the offer creator's own offering
        // player for this slot, so the "Retirer" button is
        // available to clear him.
        return (
            rosterPopupTeam.pickContext.slot.offeringPlayerId ??
            null
        );
    })();

    /**
     * Synthesized onClearPick for Voir les offres. Writes null to
     * the same slot in the same store that onPick writes to. The
     * popup wraps this to also close itself, so from the user's
     * point of view clicking "Retirer" clears the pick and closes
     * the popup.
     */
    const viewOffersOnClearPick = (() => {
        const ctx = rosterPopupTeam?.pickContext;
        if (ctx == null) return undefined;

        if (ctx.side === 'offering') {
            return () =>
                clearOfferingForSlot(ctx.offerId, ctx.slotIndex);
        }

        return () => pickForSlot(ctx.offerId, ctx.slotIndex, null);
    })();

    /**
 * Player id of the current pick for the "Publier une annonce"
 * pick mode. Undefined when the popup is not in that mode.
 *
 * Unlike the Créer pick context, this value is a frozen
 * snapshot taken when the popup was opened: the AddOfferPanel
 * that owns the actual slot state lives in local React state
 * and does not survive a MarketplacePage remount, so there is
 * nothing to derive live from.
 */
    const publishPopupPickedPlayerId =
        rosterPopupTeam?.publishPickContext != null
            ? rosterPopupTeam.publishPickContext
                .currentPickedPlayerId
            : undefined;

    /**
     * Unified picked-player id for the popup: Voir les offres when
     * that path is active, then Créer, then Publier une annonce.
     * Undefined when no pick mode is active (plain roster browse,
     * or the popup is closed).
     *
     * Note: `null` is a meaningful value here (pick mode active,
     * side currently empty) and is passed through to the popup,
     * which then does not render the pinned card or the Retirer
     * button.
     */
    const popupPickedPlayerId =
        viewOffersPickedPlayerId !== undefined
            ? viewOffersPickedPlayerId
            : directPopupPickedPlayerId !== undefined
                ? directPopupPickedPlayerId
                : publishPopupPickedPlayerId;

    /**
  * Unified clear-pick callback for the popup: Voir les offres
  * writes to the offer-picks store, Créer writes to the
  * direct-offer draft store, Publier une annonce writes to the
  * AddOfferPanel's local slot state. Only one is ever set.
  */
    const popupOnClearPick =
        viewOffersOnClearPick ??
        rosterPopupTeam?.directPickContext?.onClearPick ??
        rosterPopupTeam?.publishPickContext?.onClearPick;

    /**
     * If the user just came back from a PlayerPage he reached by
     * clicking a player name inside the popup, reopen the popup on
     * the same team and with the same position filter. Consumes
     * the pending restore so it is only applied once.
     */
    useEffect(() => {
        const pending = consumeMarketplacePopupRestore();
        if (!pending) return;

        const pick = pending.pickContext;
        const directPick = pending.directPickContext;
        const publishPick = pending.publishPickContext;

        // A direct pick can only come from the Créer tab, so
        // make sure the page is on that tab when we reopen the
        // popup. A Voir les offres pick implies the browse tab,
        // which is the default.
        if (directPick) {
            setView('add');
        }

        setRosterPopupTeam({
            id: pending.teamId,
            name: pending.teamName,
            initialPositionFilter: pending.positionFilter,
            referencePlayer: pending.referencePlayer ?? null,
            pickContext: pick
                ? {
                    slot: pick.slot,
                    offerId: pick.offerId,
                    slotIndex: pick.slotIndex,
                    capContext: pick.capContext,
                    onPick: (playerId) =>
                        pickForSlot(
                            pick.offerId,
                            pick.slotIndex,
                            playerId,
                        ),
                }
                : undefined,
            directPickContext: directPick
                ? {
                    slotIndex: directPick.slotIndex,
                    side: directPick.side,
                    lockedPosition: directPick.lockedPosition,
                    capContext: directPick.capContext,
                    currentPickedPlayerId:
                        directPick.currentPickedPlayerId ?? null,
                    onPick: (playerId) => {
                        updateDirectOfferDraft((d) => ({
                            ...d,
                            slots: d.slots.map((sl, i) => {
                                if (i !== directPick.slotIndex) {
                                    return sl;
                                }
                                return directPick.side ===
                                    'offering'
                                    ? {
                                        ...sl,
                                        offeringPlayerId:
                                            playerId,
                                    }
                                    : {
                                        ...sl,
                                        targetPlayerId:
                                            playerId,
                                    };
                            }),
                        }));
                    },
                    onClearPick: () => {
                        updateDirectOfferDraft((d) => ({
                            ...d,
                            slots: d.slots.map((sl, i) => {
                                if (i !== directPick.slotIndex) {
                                    return sl;
                                }
                                return directPick.side ===
                                    'offering'
                                    ? {
                                        ...sl,
                                        offeringPlayerId: null,
                                    }
                                    : {
                                        ...sl,
                                        targetPlayerId: null,
                                    };
                            }),
                        }));
                    },
                }
                : undefined,
            publishPickContext: publishPick
                ? {
                    slotIndex: publishPick.slotIndex,
                    currentPickedPlayerId:
                        publishPick.currentPickedPlayerId,
                    lockedPosition: publishPick.lockedPosition,
                    excludedPlayerIds:
                        publishPick.excludedPlayerIds,
                    onPick: (playerId) =>
                        pickPublishSlot(
                            publishPick.slotIndex,
                            playerId,
                        ),
                    onClearPick: () =>
                        clearPublishSlot(publishPick.slotIndex),
                }
                : undefined,
        });
    }, []);

    /**
  * Fetch the fantasy team list once. Used by the Créer tab's
  * manager picker. Non-fatal on failure: the dropdown just stays
  * empty until the next mount.
  */
    useEffect(() => {
        let cancelled = false;

        getLeagueTeams()
            .then((data) => {
                if (!cancelled) {
                    setDirectOfferTeams(data);
                }
            })
            .catch(() => {
                // Non-fatal.
            });

        return () => {
            cancelled = true;
        };
    }, []);

    /**
     * Force a fresh marketplace notification count on mount.
     *
     * The notification store already refetches on tab visibility
     * and window focus, but a user who navigates to /marketplace
     * from another page in the same tab never leaves and re-enters
     * the tab, so neither of those fires. This call guarantees the
     * badge is current the moment the marketplace is opened, so a
     * count left over from a previous session (deleted offer,
     * already-accepted response, etc.) is corrected before the
     * user can act on it.
     *
     * Non-fatal: the store swallows network errors, and the next
     * scheduled poll retries.
     */
    useEffect(() => {
        refreshMarketplaceNotificationsNow();
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
    >(() => {
        // First render: prefer the URL param, fall back to the store.
        const urlSub = searchParams.get('sub');

        if (
            urlSub === 'view' ||
            urlSub === 'mine' ||
            urlSub === 'publish'
        ) {
            return urlSub;
        }

        return getMarketplaceSection().browseSubView;
    });

    // Persist the current section on every change so a remount
    // restores it. Covers every transition: browse sub-tabs, the
    // Créer tab, the Reçues / Envoyées tabs, and the post-publish
    // jump back to "Vos offres actives".
    useEffect(() => {
        setMarketplaceSection({ view, browseSubView });
    }, [view, browseSubView]);

    /**
     * Apply URL params on mount and on subsequent changes.
     *
     * The searchParams object is opaque to React so we depend on
     * its stringified form. Reading via a fresh URLSearchParams
     * inside the effect keeps the parse logic in one place.
     *
     * After applying, the params are removed from the URL (with
     * `replace: true` so the browser history does not grow). That
     * way, when the user switches tabs inside the page and later
     * remounts MarketplacePage, the section store takes over and
     * the user's last tab is restored — the priority navigation
     * only fires on an explicit navbar click.
     */
    const searchString = searchParams.toString();

    useEffect(() => {
        if (searchString === '') return;

        const params = new URLSearchParams(searchString);

        const urlView = params.get('view');
        const urlSub = params.get('sub');

        let applied = false;

        if (
            urlView === 'received' ||
            urlView === 'sent' ||
            urlView === 'add' ||
            urlView === 'browse'
        ) {
            setView(urlView);
            applied = true;
        }

        if (
            urlSub === 'view' ||
            urlSub === 'mine' ||
            urlSub === 'publish'
        ) {
            setBrowseSubView(urlSub);
            applied = true;
        }

        if (applied) {
            const next = new URLSearchParams(searchString);
            next.delete('view');
            next.delete('sub');
            setSearchParams(next, { replace: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchString, setSearchParams]);

    /**
     * Consume pending navigation requests from child panels.
     *
     * Any component below (OfferCard, DirectOfferCard, ...) can call
     * `requestMarketplaceNavigation('sent')` after a successful
     * action to ask the page to switch tabs. The page subscribes
     * here, consumes the request, and applies it.
     *
     * The request id is a monotonic counter, so every request
     * triggers exactly one re-render and one consume.
     */
    const navRequestId = useSyncExternalStore(
        subscribeToMarketplaceNavigationRequest,
        getMarketplaceNavigationRequestId,
    );

    useEffect(() => {
        const pending = consumeMarketplaceNavigationRequest();

        if (pending === null) return;

        setView(pending.view);

        if (pending.browseSubView !== null) {
            setBrowseSubView(pending.browseSubView);
        }
    }, [navRequestId]);

    /**
     * Offer currently being edited, or null when the user is
     * publishing a new one.
     *
     * The "Modifier" button on a "Mon offre" card sets this and
     * switches the sub-view to 'publish'. AddOfferPanel detects it
     * and renders in edit mode: the form is pre-populated from the
     * offer's slots and note, and the submit call goes through
     * updateTradeOffer instead of createTradeOffer. Clearing it
     * back to null returns the panel to its fresh-publish state.
     *
     * The offer itself is captured (not just its id) so the form
     * does not have to re-fetch it.
     */
    const [editingOffer, setEditingOffer] =
        useState<TradeOffer | null>(null);

    // The "Créer" tab no longer has a sub-toggle. Its only remaining
    // option ("Envoyer une offre", not built yet) renders directly.
    // The old "Publier une annonce" sub-view now lives in the Marché
    // tab.

    // NOTE: "Contre-offre" no longer navigates to the Créer tab. It
    // is now handled entirely inside ReceivedOffersPanel, which
    // swaps the clicked response's OfferCard for an inline
    // DirectOfferCard locked on the responding team. The shared
    // state lives in lib/marketplaceCounterOfferState.ts so the
    // in-progress counter survives a PlayerPage round-trip.

    return (
        <section className='-mt-4 space-y-4 sm:-mt-6'>
            <div className='mt-2 flex flex-col items-center gap-2'>
                <div className='flex w-full flex-col items-center gap-3'>
                    <div
                        className='flex w-full items-center rounded-full border border-[#00A8FF] bg-[#050A18] p-0.5'
                        style={{
                            boxShadow:
                                '0 0 5px rgba(0, 168, 255, 0.5), 0 0 10px rgba(0, 168, 255, 0.28), 0 0 16px rgba(0, 168, 255, 0.1), inset 0 0 5px rgba(0, 168, 255, 0.1)',
                        }}
                    >
                        {/* Four tabs. Labels are responsive: a short
                            version on narrow screens so the four fit
                            in one row, the full label from sm up. */}

                        <button
                            type='button'
                            onClick={() => {
                                // Clicking the "Marché" tab always
                                // lands on the (browse, view)
                                // subsection, regardless of which
                                // browse sub-tab was previously
                                // active. This makes the top-nav
                                // "Marché" button behave the same
                                // as the navbar marketplace icon:
                                // the user is dropped on "Voir les
                                // offres" and never on "Vos offres
                                // actives" or "Publier une annonce"
                                // by accident.
                                //
                                // The one exception is a back-
                                // navigation from a PlayerPage,
                                // which is handled by the URL-param
                                // logic on MarketplacePage's mount:
                                // there are no URL params on that
                                // return trip, so the section store
                                // restores the saved
                                // (browse, publish) state instead.
                                setView('browse');
                                setBrowseSubView('view');
                            }}
                            className={`flex-1 cursor-pointer whitespace-nowrap rounded-full px-1.5 py-0.5 text-[0.85rem] font-bold transition-all duration-200 sm:px-3 sm:text-base ${view === 'browse'
                                ? 'bg-white text-[#1D1B61]'
                                : 'bg-transparent text-[#F2F5FA] hover:bg-[#00A8FF]/15 hover:text-white'
                                }`}
                            style={
                                view === 'browse'
                                    ? {
                                        boxShadow:
                                            '0 0 4px rgba(255, 255, 255, 0.8), 0 0 8px rgba(0, 168, 255, 0.55), 0 0 16px rgba(0, 168, 255, 0.28), 0 0 26px rgba(0, 168, 255, 0.12), inset 0 0 3px rgba(0, 168, 255, 0.25)',
                                        textShadow:
                                            '0 0 2px rgba(0, 168, 255, 0.7), 0 0 4px rgba(0, 168, 255, 0.35)',
                                    }
                                    : undefined
                            }
                        >
                            Marché
                            {marketplaceCount > 0
                                ? ` (${marketplaceCount})`
                                : ''}
                        </button>

                        <button
                            type='button'
                            onClick={() => setView('add')}
                            className={`flex-1 cursor-pointer whitespace-nowrap rounded-full px-1.5 py-0.5 text-[0.85rem] font-bold transition-all duration-200 sm:px-3 sm:text-base ${view === 'add'
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
                            className={`flex-1 cursor-pointer whitespace-nowrap rounded-full px-1.5 py-0.5 text-[0.85rem] font-bold transition-all duration-200 sm:px-3 sm:text-base ${view === 'received'
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
                            <span className='hidden sm:inline'>
                                Offres reçues
                                {receivedCount > 0
                                    ? ` (${receivedCount})`
                                    : ''}
                            </span>
                            <span className='sm:hidden'>
                                Reçues
                                {receivedCount > 0
                                    ? ` (${receivedCount})`
                                    : ''}
                            </span>
                        </button>

                        <button
                            type='button'
                            onClick={() => setView('sent')}
                            className={`flex-1 cursor-pointer whitespace-nowrap rounded-full px-1.5 py-0.5 text-[0.85rem] font-bold transition-all duration-200 sm:px-3 sm:text-base ${view === 'sent'
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
                            <span className='hidden sm:inline'>
                                Offres envoyées
                                {sentCount > 0
                                    ? ` (${sentCount})`
                                    : ''}
                            </span>
                            <span className='sm:hidden'>
                                Envoyées
                                {sentCount > 0
                                    ? ` (${sentCount})`
                                    : ''}
                            </span>
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

                    {/*
                     * Créer view: manager picker. Rendered right
                     * under the segmented button, inside the same
                     * header container as the browse sub-toggle, so
                     * the two tabs feel structurally equivalent.
                     *
                     * Only shows managers other than the current
                     * user's own team — a manager cannot send a
                     * direct offer to himself.
                     */}
                    {view === 'add' && (
                        <div className='flex w-full items-center justify-center gap-2'>
                            <label
                                htmlFor='direct-offer-team'
                                className='shrink-0 text-sm font-semibold uppercase tracking-wider text-[#00E5FF]'
                            >
                                Offrir à :
                            </label>
                            <DirectOfferTeamPicker
                                teams={directOfferTeams}
                                selectedTeamId={
                                    selectedDirectOfferTeamId
                                }
                                excludedTeamId={
                                    user?.fantasyTeamId ?? null
                                }
                                openToken={teamPickerOpenToken}
                                onSelect={(id) =>
                                    updateDirectOfferDraft((d) => ({
                                        ...d,
                                        selectedTargetTeamId: id,
                                        // Target picks belong to the
                                        // previously selected team,
                                        // so drop them on any team
                                        // change.
                                        slots: d.slots.map((sl) => ({
                                            ...sl,
                                            targetPlayerId: null,
                                        })),
                                    }))
                                }
                            />
                        </div>
                    )}

                </div>
            </div>

            {view === 'add' && user?.fantasyTeamId != null && (() => {
                /*
                 * Compute the effective target team with a defensive
                 * filter: never let the current user offer to
                 * himself. The direct-offer draft store is a
                 * module-level singleton and could hold a stale
                 * selection from a previous session (e.g. two
                 * accounts used back-to-back in the same browser
                 * tab). The picker already excludes the user's own
                 * team from its list, but a value already stored in
                 * the draft bypasses that filter.
                 *
                 * When the stored target equals the current user's
                 * own team, we treat it as "no target selected" so
                 * the picker placeholder shows and the "Offrir"
                 * button stays disabled.
                 */
                const parsedTargetId =
                    selectedDirectOfferTeamId
                        ? Number(selectedDirectOfferTeamId)
                        : null;

                const effectiveTargetTeamId =
                    parsedTargetId === user.fantasyTeamId
                        ? null
                        : parsedTargetId;

                const effectiveTargetTeamName =
                    effectiveTargetTeamId != null
                        ? directOfferTeams.find(
                            (t) => t.id === effectiveTargetTeamId,
                        )?.name ?? null
                        : null;

                return (
                    <DirectOfferCard
                        connectedTeamId={user.fantasyTeamId}
                        connectedTeamName={
                            user.fantasyTeamName ?? 'Mon équipe'
                        }
                        targetTeamId={effectiveTargetTeamId}
                        targetTeamName={effectiveTargetTeamName}
                    onOpenTeamRoster={(id) =>
                        navigate(`/mon-equipe?teamId=${id}`)
                    }
                    onRequestPlayerPick={(req) =>
                        setRosterPopupTeam({
                            id: req.teamId,
                            name: req.teamName,
                            directPickContext: {
                                slotIndex: req.slotIndex,
                                side: req.side,
                                lockedPosition: req.lockedPosition,
                                capContext: req.capContext,
                                currentPickedPlayerId:
                                    req.currentPickedPlayerId,
                                onPick: req.onPick,
                                onClearPick: req.onClearPick,
                            },
                            referencePlayer:
                                req.referencePlayer ?? null,
                        })
                    }
                        onRequestTargetTeam={() =>
                            setTeamPickerOpenToken((t) => t + 1)
                        }
                        onSubmitted={() =>
                            requestMarketplaceNavigation('sent')
                        }
                    />
                );
            })()}

            {view === 'browse' && browseSubView !== 'publish' && (
                <BrowseOffersPanel
                    refreshTick={browseRefreshTick}
                    teamId={user?.fantasyTeamId ?? null}
                    mode={browseSubView}
                    onResponded={() =>
                        requestMarketplaceNavigation('sent')
                    }
                    onOpenTeamRoster={(id) =>
                        navigate(`/mon-equipe?teamId=${id}`)
                    }
                    onRequestPlayerPick={(teamId, teamName, pick) =>
                        setRosterPopupTeam({
                            id: teamId,
                            name: teamName,
                            pickContext: {
                                slot: pick.slot,
                                offerId: pick.offerId,
                                slotIndex: pick.slotIndex,
                                capContext: pick.capContext,
                                excludedPlayerIds:
                                    pick.excludedPlayerIds,
                                onPick: (playerId) =>
                                    pickForSlot(
                                        pick.offerId,
                                        pick.slotIndex,
                                        playerId,
                                    ),
                            },
                            referencePlayer:
                                pick.referencePlayer ?? null,
                        })
                    }
                    onRequestOfferingPlayerPick={(
                        teamId,
                        teamName,
                        pick,
                    ) =>
                        setRosterPopupTeam({
                            id: teamId,
                            name: teamName,
                            pickContext: {
                                slot: pick.slot,
                                offerId: pick.offerId,
                                slotIndex: pick.slotIndex,
                                capContext: pick.capContext,
                                side: 'offering',
                                excludedPlayerIds:
                                    pick.excludedPlayerIds,
                                onPick: (playerId) =>
                                    setOfferingOverrideForSlot(
                                        pick.offerId,
                                        pick.slotIndex,
                                        playerId,
                                    ),
                            },
                            referencePlayer: null,
                        })
                    }
                    onEditOffer={
                        // Only meaningful on "Vos offres actives":
                        // the "Modifier" button is rendered only on
                        // the user's own offers, and this callback
                        // switches the sub-view to 'publish' with
                        // the offer pre-loaded.
                        browseSubView === 'mine'
                            ? (offer) => {
                                setEditingOffer(offer);
                                setBrowseSubView('publish');
                            }
                            : undefined
                    }
                />
            )}

            {view === 'browse' && browseSubView === 'publish' && (
                <AddOfferPanel
                    onPublished={() => {
                        // We're already on the Marché tab; just refresh
                        // the lists and drop the user on "Vos offres" so
                        // he sees the offer he just published or
                        // modified.
                        setBrowseRefreshTick((t) => t + 1);
                        setBrowseSubView('mine');
                        setEditingOffer(null);
                    }}
                    onCancelEdit={() => {
                        // Back out of edit mode without touching the
                        // offer. Returns to "Vos offres actives".
                        setBrowseSubView('mine');
                        setEditingOffer(null);
                    }}
                    initialOffer={editingOffer}
                    teamId={user?.fantasyTeamId ?? null}
                    teamName={user?.fantasyTeamName ?? null}
                    onRequestPlayerPick={(req) => {
                        if (user?.fantasyTeamId == null) return;

                        setRosterPopupTeam({
                            id: user.fantasyTeamId,
                            name:
                                user.fantasyTeamName ??
                                'Mon équipe',
                            publishPickContext: {
                                slotIndex: req.slotIndex,
                                currentPickedPlayerId:
                                    req.currentPickedPlayerId,
                                lockedPosition:
                                    req.lockedPosition,
                                excludedPlayerIds:
                                    req.excludedPlayerIds,
                                onPick: req.onPick,
                                onClearPick: req.onClearPick,
                            },
                        });
                    }}
                />
            )}

            {view === 'received' && (
                <ReceivedOffersPanel
                    refreshTick={browseRefreshTick}
                    onOpenTeamRoster={(id) =>
                        navigate(`/mon-equipe?teamId=${id}`)
                    }
                    onRequestPlayerPick={(req) =>
                        setRosterPopupTeam({
                            id: req.teamId,
                            name: req.teamName,
                            directPickContext: {
                                slotIndex: req.slotIndex,
                                side: req.side,
                                lockedPosition: req.lockedPosition,
                                capContext: req.capContext,
                                currentPickedPlayerId:
                                    req.currentPickedPlayerId,
                                onPick: req.onPick,
                                onClearPick: req.onClearPick,
                            },
                            referencePlayer:
                                req.referencePlayer ?? null,
                        })
                    }
                />
            )}

            {view === 'sent' && (
                <SentOffersPanel
                    refreshTick={browseRefreshTick}
                    onOpenTeamRoster={(id) =>
                        navigate(`/mon-equipe?teamId=${id}`)
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
                    referencePlayer={rosterPopupTeam.referencePlayer}
                    // No locked position anywhere: managers can
                    // respond to or create a trade with a player of
                    // any position, regardless of what the other
                    // side of the slot demands.
                    filterSlot={
                        rosterPopupTeam.pickContext?.slot
                    }
                    capContext={
                        rosterPopupTeam.pickContext?.capContext
                    }
                    offerId={
                        rosterPopupTeam.pickContext?.offerId
                    }
                    directPickInfo={
                        rosterPopupTeam.directPickContext
                            ? {
                                slotIndex:
                                    rosterPopupTeam
                                        .directPickContext.slotIndex,
                                side: rosterPopupTeam
                                    .directPickContext.side,
                                lockedPosition: rosterPopupTeam
                                    .directPickContext
                                    .lockedPosition,
                                capContext: rosterPopupTeam
                                    .directPickContext.capContext,
                                currentPickedPlayerId:
                                    rosterPopupTeam
                                        .directPickContext
                                        .currentPickedPlayerId,
                            }
                            : undefined
                    }
                    publishPickInfo={
                        rosterPopupTeam.publishPickContext
                            ? {
                                slotIndex:
                                    rosterPopupTeam
                                        .publishPickContext.slotIndex,
                                currentPickedPlayerId:
                                    rosterPopupTeam
                                        .publishPickContext
                                        .currentPickedPlayerId,
                                lockedPosition:
                                    rosterPopupTeam
                                        .publishPickContext
                                        .lockedPosition,
                                excludedPlayerIds:
                                    rosterPopupTeam
                                        .publishPickContext
                                        .excludedPlayerIds,
                            }
                            : undefined
                    }
                    currentPickedPlayerId={popupPickedPlayerId}
                    pinnedPlayerId={popupPickedPlayerId}
                    excludedPlayerIds={
                        rosterPopupTeam.pickContext
                            ?.excludedPlayerIds ??
                        rosterPopupTeam.publishPickContext
                            ?.excludedPlayerIds ??
                        directPopupExcludedPlayerIds
                    }
                    onPlayerPick={
                        rosterPopupTeam.pickContext?.onPick ??
                        rosterPopupTeam.directPickContext?.onPick ??
                        rosterPopupTeam.publishPickContext?.onPick
                    }
                    onClearPick={popupOnClearPick}
                    onClose={() => setRosterPopupTeam(null)}
                />
            )}
        </section>
    );
}

// ---------------------------------------------------------------------
// Add offer panel
// ---------------------------------------------------------------------

/**
 * Payload the AddOfferPanel sends up when the user clicks a
 * "Choisir un joueur" button in a slot. MarketplacePage stores it
 * on `rosterPopupTeam.publishPickContext` so the roster popup
 * opens in pick mode for the given slot.
 *
 * Unlike the Créer tab's DirectOfferPickRequest, this shape has no
 * `side` (there is only one side to pick — the user's own player)
 * and no cap context (a public announcement does not know who will
 * respond, so no cap projection is possible).
 */
interface PublishPickRequest {
    slotIndex: number;
    /**
     * Player id of the current pick in this slot, or null when the
     * slot has no pick. Drives the "Retirer" button in the popup.
     */
    currentPickedPlayerId: number | null;
    /**
     * When the slot already has a demanded position (F / D / G),
     * the popup's segmented control is locked to it, so the user
     * cannot pick a player of another position. Matches the
     * backend rule that the offered player's position must match
     * the demanded position.
     */
    lockedPosition?: PositionGroup;
    /**
     * Player ids already picked in OTHER slots of the same form,
     * so the popup hides them and the user cannot pick the same
     * player twice.
     */
    excludedPlayerIds: number[];
    onPick: (playerId: number) => void;
    onClearPick: () => void;
}

function AddOfferPanel({
    teamId,
    teamName,
    onPublished,
    onCancelEdit,
    initialOffer,
    onRequestPlayerPick,
}: {
    teamId: number | null;
    teamName: string | null;
    onPublished: () => void;
    /**
     * When provided AND `initialOffer` is set, renders a small
     * "Modification de l'offre" header with an "Annuler" button
     * that backs out of edit mode without touching the offer.
     */
    onCancelEdit?: () => void;
    /**
     * Offer to edit. When set, the panel:
     *   - initializes its slots and note from this offer on first
     *     render,
     *   - renders a "Modification de l'offre" header,
     *   - switches the submit call to updateTradeOffer.
     *
     * When null, the panel is in fresh-publish mode.
     *
     * The panel is conditionally mounted by MarketplacePage only
     * when the sub-view is 'publish', so it always mounts fresh
     * with whatever initialOffer is current at that moment.
     */
    initialOffer?: TradeOffer | null;
    /**
     * Called when the user clicks a "Choisir un joueur" button on
     * any slot. The parent opens the roster popup in pick mode for
     * the given slot.
     */
    onRequestPlayerPick: (req: PublishPickRequest) => void;
}) {
    const [roster, setRoster] = useState<TeamRoster | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    /**
     * Slots and note live in a module-level store so they survive
     * a PlayerPage round-trip (the user opens the popup from a
     * slot, clicks a player name, lands on PlayerPage, clicks
     * Fermer, comes back). See publishOfferState.ts.
     *
     * The store is the single source of truth. Every write goes
     * through updatePublishDraft. The two aliases below let the
     * rest of this component keep calling setSlots / setNote the
     * same way it always did.
     */
    const publishDraft = useSyncExternalStore(
        subscribeToPublishDraft,
        getPublishDraft,
    );
    const slots = publishDraft.slots;
    const note = publishDraft.note;

    const setSlots = (
        updater:
            | SlotState[]
            | ((prev: SlotState[]) => SlotState[]),
    ) => {
        updatePublishDraft((d) => ({
            ...d,
            slots:
                typeof updater === 'function'
                    ? updater(d.slots)
                    : updater,
        }));
    };

    const setNote = (
        updater: string | ((prev: string) => string),
    ) => {
        updatePublishDraft((d) => ({
            ...d,
            note:
                typeof updater === 'function'
                    ? updater(d.note)
                    : updater,
        }));
    };

    /**
     * Seed the store from initialOffer on mount, synchronously
     * (useLayoutEffect) so there is no visible flash of the
     * previous draft. Only fires when the panel switches to a
     * different offer than the one already in the store.
     *
     * When initialOffer is null, the store is deliberately NOT
     * reset unless it currently holds an edit draft for another
     * offer. That preserves an in-progress new-publish draft
     * across the PlayerPage round-trip — which is the entire
     * point of the store.
     */
    useLayoutEffect(() => {
        const draft = getPublishDraft();

        if (initialOffer) {
            if (draft.editingOfferId !== initialOffer.id) {
                updatePublishDraft(() => ({
                    editingOfferId: initialOffer.id,
                    slots: initialOffer.slots.map(
                        (slot): SlotState => ({
                            offeringPlayerId:
                                slot.offeringPlayerId,
                        }),
                    ),
                    note: initialOffer.note ?? '',
                }));
            }
        } else {
            if (draft.editingOfferId != null) {
                resetPublishDraft();
            }
        }
    }, [initialOffer]);

    /**
     * Auto-append a trailing empty slot whenever the last slot
     * has a player in it, mirroring the "Créer" and "Voir les
     * offres" behaviour.
     *
     * The panel is created with one empty slot. As soon as the
     * user picks a player for the last slot, a fresh empty slot
     * is appended so its own "Choisir un joueur" button is
     * always available without the user having to press
     * "Ajouter un 2e joueur à l'échange".
     *
     * Reads the current draft from the store (rather than the
     * captured `slots` value) so a StrictMode double-invocation
     * cannot append the same slot twice: when the store already
     * ends on an empty slot, the updater is a no-op. Converges
     * because the newly appended slot is empty.
     *
     * Respects MAX_SLOTS: once the draft has reached the cap,
     * no further slot is added even if the last one is filled.
     */
    useLayoutEffect(() => {
        updatePublishDraft((d) => {
            if (d.slots.length === 0) {
                return {
                    ...d,
                    slots: [{ ...EMPTY_SLOT }],
                };
            }

            if (d.slots.length >= MAX_SLOTS) {
                return d;
            }

            const last = d.slots[d.slots.length - 1];

            if (last.offeringPlayerId != null) {
                return {
                    ...d,
                    slots: [
                        ...d.slots,
                        { ...EMPTY_SLOT },
                    ],
                };
            }

            return d;
        });
    }, [slots]);

    /**
   * The user's roster, used to resolve each picked player's
   * display info (name, position, contracts). Loaded once per
   * team and passed down to SlotEditor.
   *
   * The offered player's position is intentionally NOT synced to
   * the slot's PositionGroup. Managers can announce any demanded
   * position regardless of who they are offering — the two
   * fields are independent by design.
   */
    const entries = useMemo(
        () => roster?.entries ?? [],
        [roster],
    );

    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

    /**
     * True while the publish preview popup is open. The popup shows
     * an OfferCard rendering of the offer about to be published.
     */
    const [showPreview, setShowPreview] = useState(false);

    // -----------------------------------------------------------------
    // Draft picks ("Ajouter des choix de repêchage")
    //
    // A public offer only carries the creator's picks. The pick list
    // is stored in the module-level picks store under
    // PUBLISH_CREATOR_KEY so it survives a PlayerPage round-trip.
    //
    // When editing an existing offer (initialOffer is set), the
    // store is pre-loaded from the offer's picks on mount, so the
    // user starts from what the offer currently carries rather than
    // a stale list from a previous publish.
    // -----------------------------------------------------------------

    const [availablePicks, setAvailablePicks] = useState<DraftPick[]>(
        [],
    );

    const publishPickIds = useSyncExternalStore(
        DraftPicks.subscribeToPicks,
        () => DraftPicks.getPicks(DraftPicks.PUBLISH_CREATOR_KEY),
    );

    const selectedPicks = useMemo(
        () =>
            publishPickIds
                .map((id) => availablePicks.find((p) => p.id === id))
                .filter((p): p is DraftPick => p != null),
        [publishPickIds, availablePicks],
    );

    // Fetch the creator's picks once, when the team is known.
    useEffect(() => {
        if (teamId == null) {
            setAvailablePicks([]);
            return;
        }

        let cancelled = false;

        getTeamDraftPicks(teamId)
            .then((data) => {
                if (!cancelled) setAvailablePicks(data);
            })
            .catch(() => {
                if (!cancelled) setAvailablePicks([]);
            });

        return () => {
            cancelled = true;
        };
    }, [teamId]);

    // Seed the store from initialOffer (edit mode) or reset it
    // (fresh publish). Runs only when initialOffer changes, so a
    // mid-edit re-render does not clobber the user's selections.
    useEffect(() => {
        if (initialOffer) {
            DraftPicks.setPicks(
                DraftPicks.PUBLISH_CREATOR_KEY,
                initialOffer.picks.map((p) => p.id),
            );
        } else {
            DraftPicks.clearPublishPicks();
        }
    }, [initialOffer]);

    /**
     * The user's roster, loaded once so the preview popup can resolve
     * each slot's offered player (name, position, contracts).
     *
     * NOTE: `entries` is declared above (it powers the positionGroup
     * sync effect), so it is not redeclared here.
     */

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
            // Preview is a read-only rendering of the offer the user
            // is about to publish. The card still renders fine
            // without cap info: the cap-space line simply does not
            // appear because seasonSalaryCap is 0 and the per-team
            // cap hits are null.
            createdByFantasyTeamCapSalary: null,
            seasonSalaryCap: 0,
            createdAt: new Date().toISOString(),
            note: note.trim() === '' ? null : note.trim(),
            status: 'Active',
            isMine: true,
            isNew: false,
            picks: selectedPicks,
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

                    // Always derive the position group from
                    // the offered player, matching what
                    // slotToRequest will send to the API.
                    const positionGroup = entry
                        ? toPositionGroup(entry.position)
                        : 'F';

                    return {
                        slotIndex: i,
                        positionGroup,
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
                    };
                }),
        }),
        [slots, note, entries, teamId, teamName, selectedPicks],
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

    /**
  * Picks and clears now go through the publish-offer store
  * directly (see publishOfferState.ts). The slot's positionGroup
  * is synced separately by the layout effect above, so the
  * callback here only needs to write the player id.
  */

    /**
     * Returns the player ids picked in every OTHER slot of this
     * form, so the popup can hide them and the user cannot pick
     * the same player twice.
     */
    function excludedPlayerIdsForSlot(index: number): number[] {
        const excluded: number[] = [];

        for (let i = 0; i < slots.length; i++) {
            if (i === index) continue;

            const pick = slots[i].offeringPlayerId;
            if (pick != null) excluded.push(pick);
        }

        return excluded;
    }

    function removeSlot(index: number) {
        if (slots.length <= 1) return;

        setSlots((current) => current.filter((_, i) => i !== index));
    }

    function handleResetAll() {
        setSlots([{ ...EMPTY_SLOT }]);
        setNote('');
        DraftPicks.clearPublishPicks();
        setSubmitError(null);
        setSubmitSuccess(null);
    }

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
   * Clicked from the main form: opens the preview popup.
   */
    function handleSubmit() {
        if (!canSubmit) return;

        setSubmitError(null);
        setShowPreview(true);
    }

    /**
     * Clicked from the sticky bar: sends the offer.
     */
    async function handleConfirmPublish() {
        if (!canSubmit) return;

        setSubmitting(true);
        setSubmitError(null);
        setSubmitSuccess(null);

        try {
            const request = {
                slots: slots
                    .filter(slotIsComplete)
                    .map((s) => slotToRequest(s, entries)),
                note: note.trim() === '' ? null : note.trim(),
                draftPickIds: publishPickIds.slice(),
            };

            if (initialOffer) {
                // Edit mode: update the offer in place. Its identity
                // (Id, CreatedAt, per-user "seen" markers) is
                // preserved on the backend, so it keeps its place on
                // the browse list and does not show up as "Nouvelle
                // offre" again for users who had already seen it.
                await updateTradeOffer(initialOffer.id, request);
                setSubmitSuccess('Offre modifiée.');
            } else {
                await createTradeOffer(request);
                setSubmitSuccess('Offre publiée.');
            }

            setShowPreview(false);

            // In edit mode the parent clears initialOffer and drops
            // us back on "Vos offres actives", so there is nothing
            // to reset — the panel will remount fresh the next time
            // it is opened. In create mode, reset the form now so
            // the user can publish another offer without stale
            // data.
            if (!initialOffer) {
                handleResetAll();
            }

            // Clear the picks store unconditionally. In create
            // mode handleResetAll already did it (idempotent), but
            // in edit mode we need to clear it here so a subsequent
            // publish starts from a clean list.
            DraftPicks.clearPublishPicks();

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
            {initialOffer && (
                <div
                    className='flex items-center justify-between gap-2 rounded-lg border px-3 py-2'
                    style={{
                        borderColor: 'rgba(0, 200, 255, 0.6)',
                        backgroundColor: 'rgba(0, 200, 255, 0.08)',
                    }}
                >
                    <span className='text-xs font-semibold uppercase tracking-wider text-[#00C8FF]'>
                        Modification de l'offre
                    </span>

                    {onCancelEdit && (
                        <button
                            type='button'
                            onClick={onCancelEdit}
                            disabled={submitting}
                            className='cursor-pointer rounded border border-[#00C8FF]/60 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-[#00C8FF] transition-colors hover:bg-[#00A8FF]/10 disabled:opacity-50'
                        >
                            Annuler
                        </button>
                    )}
                </div>
            )}

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
                    canRemove={slots.length > 1}
                    onRequestPlayerPick={() =>
                        onRequestPlayerPick({
                            slotIndex: index,
                            currentPickedPlayerId:
                                slot.offeringPlayerId,
                            excludedPlayerIds:
                                excludedPlayerIdsForSlot(index),
                            onPick: (playerId) =>
                                pickPublishSlot(index, playerId),
                            onClearPick: () =>
                                clearPublishSlot(index),
                        })
                    }
                    onRemove={() => removeSlot(index)}
                />
            ))}

            {/* Draft picks section. A public offer only carries the
                creator's picks, so this slot has a single column. The
                section is always visible: unlike an offer card, a
                published offer is empty by default and picks are an
                expected part of the announcement. */}
            <div
                className='rounded-lg border px-3 py-3'
                style={{
                    borderColor: FRAME_BORDER,
                    backgroundColor: FRAME_BG,
                    boxShadow: FRAME_GLOW,
                }}
            >
                <p className='mb-2 text-center text-xs font-semibold uppercase tracking-wider text-[#00E5FF]'>
                    Choix de repêchage
                </p>

                <TradePicksSlot
                    selectedPicks={selectedPicks}
                    availablePicks={availablePicks}
                    editable
                    onAddPick={(id) =>
                        DraftPicks.addPick(
                            DraftPicks.PUBLISH_CREATOR_KEY,
                            id,
                        )
                    }
                    onRemovePick={(id) =>
                        DraftPicks.removePick(
                            DraftPicks.PUBLISH_CREATOR_KEY,
                            id,
                        )
                    }
                />
            </div>

            <div className='mt-3 flex w-full flex-col gap-2'>
                {/* Message field, always visible, same look as the
                    Créer tab and the "Voir les offres" response
                    form. No toggle — the label + textarea pattern
                    is the shared design. */}
                <div>
                    <label className='text-xs font-semibold uppercase tracking-wider text-[#7DD3FC]'>
                        Message (optionnel)
                    </label>
                    <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        maxLength={1000}
                        placeholder='Ex : je cherche un jeune défenseur, je peux ajouter un choix de repêchage.'
                        className={`mt-1 ${inputClass}`}
                    />
                </div>

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
                                onSlotClick={() => {
                                    // With the flat slot design there is no
                                    // "expand this slot" concept anymore.
                                    // Clicking a slot simply closes the
                                    // preview so the user is back on the
                                    // form, where every slot is always
                                    // visible and editable.
                                    setShowPreview(false);
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
    canRemove,
    onRequestPlayerPick,
    onRemove,
}: {
    index: number;
    slot: SlotState;
    entries: RosterEntry[];
    canRemove: boolean;
    onRequestPlayerPick: () => void;
    onRemove: () => void;
}) {
    const pickedEntry =
        slot.offeringPlayerId != null
            ? entries.find(
                (e) => e.playerId === slot.offeringPlayerId,
            ) ?? null
            : null;

    return (
        <div
            id={`slot-editor-${index}`}
            className='relative overflow-hidden scroll-mt-[calc(var(--header-height,4rem)+0.75rem)] rounded-lg border'
            style={{
                borderColor: FRAME_BORDER,
                backgroundColor: FRAME_BG,
                boxShadow: FRAME_GLOW,
            }}
        >
            {canRemove && (
                <button
                    type='button'
                    aria-label={`Retirer le joueur ${index + 1}`}
                    onClick={onRemove}
                    className='absolute right-2 top-2 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-[#EF4444] transition-colors hover:bg-[#DC2626]'
                >
                    <svg
                        viewBox='0 0 24 24'
                        className='h-[10px] w-[10px]'
                        fill='none'
                        stroke='white'
                        strokeWidth={4}
                        strokeLinecap='round'
                        aria-hidden='true'
                    >
                        <line
                            x1='5'
                            y1='12'
                            x2='19'
                            y2='12'
                        />
                    </svg>
                </button>
            )}

            <div className='px-3 py-3'>
                <p className='mb-3 text-center text-sm font-bold uppercase tracking-wider text-[#00E5FF]'>
                    Joueur {index + 1}
                </p>

                {slot.offeringPlayerId != null ? (
                    <button
                        type='button'
                        onClick={onRequestPlayerPick}
                        className='block w-full cursor-pointer rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:border-[#00C8FF]/60 hover:bg-[#00A8FF]/5'
                    >
                        <span className='min-w-0 truncate text-sm text-foreground'>
                            <span className='font-semibold'>
                                {pickedEntry
                                    ? `${pickedEntry.firstName} ${pickedEntry.lastName}`
                                    : 'Joueur inconnu'}
                            </span>
                            {pickedEntry && (
                                <>
                                    {' · '}
                                    {toPositionGroup(
                                        pickedEntry.position,
                                    )}
                                    {' · '}
                                    {pickedEntry.nhlTeamAbbreviation}
                                </>
                            )}
                        </span>
                    </button>
                ) : (
                    <button
                        type='button'
                        onClick={onRequestPlayerPick}
                        className='block w-full cursor-pointer rounded bg-emerald-500 px-3 py-2 text-xs font-semibold text-emerald-950 transition-colors hover:bg-emerald-400 md:text-sm'
                    >
                        Choisir un joueur
                    </button>
                )}
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
    onEditOffer,
    onRequestPlayerPick,
    onRequestOfferingPlayerPick,
    onResponded,
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
    /**
     * When provided, each "Mon offre" card renders a "Modifier"
     * button next to "Annuler". The callback receives the offer
     * the user wants to edit; the parent typically opens the
     * publish panel pre-populated with it.
     *
     * Undefined on the "Voir les offres" side: the user never
     * edits anyone else's offer.
     */
    onEditOffer?: (offer: TradeOffer) => void;
    /**
     * Called when the responder clicks the "Choisir un joueur"
     * button on an offer slot. The parent opens the roster popup
     * in pick mode for the given team and slot.
     */
    onRequestPlayerPick?: (
        teamId: number,
        teamName: string,
        pick: PendingPickContext,
    ) => void;
    /**
  * Called when the responder clicks the "Choisir un joueur"
  * (or "Changer") button on the OFFERING side of a browse offer
  * slot. The parent opens the OFFER CREATOR's roster in pick
  * mode and stores the result as an offering override.
  */
    onRequestOfferingPlayerPick?: (
        teamId: number,
        teamName: string,
        pick: PendingPickContext,
    ) => void;
    /**
     * Optional. Fired after the responder successfully sends a
     * response on any offer card in the browse list. MarketplacePage
     * uses this to switch to the Envoyées tab.
     */
    onResponded?: () => void;
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
            markOffersSeen(ids)
                .then(() => refreshMarketplaceNotificationsNow())
                .catch(() => {
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
                    onEdit={
                        onEditOffer
                            ? () => onEditOffer(offer)
                            : undefined
                    }
                    userRoster={userRoster}
                    onOpenTeamRoster={onOpenTeamRoster}
                    onRequestPlayerPick={onRequestPlayerPick}
                    onRequestOfferingPlayerPick={
                        onRequestOfferingPlayerPick
                    }
                    onResponded={onResponded}
                    swapSides
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
        createdByFantasyTeamCapSalary:
            response.tradeOfferCreatedByFantasyTeamCapSalary,
        respondingFantasyTeamId: response.respondingFantasyTeamId,
        respondingFantasyTeamName: response.respondingFantasyTeamName,
        respondingFantasyTeamCapSalary:
            response.respondingFantasyTeamCapSalary,
        seasonSalaryCap: response.seasonSalaryCap,
        createdAt: response.createdAt,
        // Show the RESPONDER's own message, not the offer
        // creator's original annonce message. The creator already
        // knows what he wrote on his own annonce; on the Reçues
        // panel he needs to see what the responder said. Same on
        // the Envoyées panel — the responder wants to see the
        // message he himself attached.
        note: response.note,
        status: response.status,
        isMine: false,
        isNew: response.isNew,
        picks: response.creatorPicks ?? [],
        requestedPicks: response.requestedPicks ?? [],
        respondingPicks: response.respondingPicks ?? [],
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
    onRequestPlayerPick,
}: {
    refreshTick: number;
    onOpenTeamRoster: (teamId: number, teamName: string) => void;
    onRequestPlayerPick: (req: DirectOfferPickRequest) => void;
}) {
    const { user } = useAuth();

    const [responses, setResponses] = useState<TradeOfferResponse[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    /**
     * Id of the response currently being acted on (accepted or
     * refused), or null. Used to disable the buttons on that card
     * only.
     */
    const [busyId, setBusyId] = useState<number | null>(null);

    /**
     * The response currently being countered, or null. When set,
     * the clicked response's OfferCard is swapped for a Créer-style
     * DirectOfferCard locked on the responding team. The state is
     * stored in a module-level store so it survives a PlayerPage
     * round-trip (the pick popup's player-name links navigate away).
     */
    const counteringResponse = useSyncExternalStore(
        subscribeToCounterOfferState,
        getCounteringResponse,
    );

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

    /**
     * Fire-and-forget "seen" marker, 2 seconds after the list has
     * been on screen. Same delay and reasoning as the browse tab:
     * long enough that a StrictMode double-mount never has time
     * to consume the "new" state before the user actually sees it,
     * short enough that the "Nouvelle offre" chips feel responsive.
     *
     * On success, forces an immediate refetch of the navbar badge
     * so the count drops without waiting for the next 60-second
     * poll tick.
     */
    useEffect(() => {
        if (responses.length === 0) return;

        const ids = responses.map((r) => r.id);

        const timer = window.setTimeout(() => {
            markResponsesSeen(ids)
                .then(() => refreshMarketplaceNotificationsNow())
                .catch(() => {
                    // Non-fatal.
                });
        }, MARK_SEEN_DELAY_MS);

        return () => {
            window.clearTimeout(timer);
        };
    }, [responses]);

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

    /**
     * Withdraws an already-accepted response. Uses the same backend
     * call as handleReject (the endpoint now accepts Accepted as
     * well as Pending), but with a message that reflects the
     * "changed my mind after accepting" intent.
     */
    async function handleCancelAccepted(responseId: number) {
        if (
            !window.confirm(
                'Annuler ce trade accepté ? ' +
                "L'autre gestionnaire ne verra plus cette réponse " +
                'et votre annonce restera active sur le marché.',
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

    /**
     * Opens the counter-offer card for the given response.
     *
     * Seeds the direct-offer draft from the response:
     *   - target team      = the responding manager
     *   - slot i (offering side) = the user's own offered player
     *                              on the original offer (unchanged)
     *   - slot i (target side)   = the responder's player on slot i
     *   - draft picks (offering) = offer.picks + response.requestedPicks
     *   - draft picks (target)   = response.respondingPicks
     *
     * Appends one fresh empty slot so the user always has a place
     * to add more players. The DirectOfferCard's own auto-append
     * effect takes over from there.
     *
     * The response is NOT rejected yet. It is only rejected once
     * the counter-offer is successfully sent (or left in place if
     * the user cancels).
     */
    function startCounterOffer(response: TradeOfferResponse): void {
        const sortedSlots = [...response.slots].sort(
            (a, b) => a.slotIndex - b.slotIndex,
        );

        const draftSlots = sortedSlots.map((s) => ({
            offeringPlayerId: s.offeringPlayerId ?? null,
            targetPlayerId: s.respondingPlayerId ?? null,
        }));

        draftSlots.push({
            offeringPlayerId: null,
            targetPlayerId: null,
        });

        updateDirectOfferDraft((d) => ({
            ...d,
            selectedTargetTeamId: String(
                response.respondingFantasyTeamId,
            ),
            slots: draftSlots,
            note: '',
        }));

        DraftPicks.setPicks(
            DraftPicks.DIRECT_OFFERING_KEY,
            [
                ...(response.creatorPicks ?? []).map((p) => p.id),
                ...(response.requestedPicks ?? []).map((p) => p.id),
            ],
        );

        DraftPicks.setPicks(
            DraftPicks.DIRECT_TARGET_KEY,
            (response.respondingPicks ?? []).map((p) => p.id),
        );

        startCountering(response);
    }

    /**
     * Backs out of an active counter-offer without sending
     * anything. Resets the draft and the pick store so a fresh
     * counter on another response starts clean.
     */
    function cancelCounterOffer(): void {
        clearCountering();
        resetDirectOfferSlotsAndNote();
        DraftPicks.clearDirectPicks();
    }

    /**
     * Fires after the DirectOfferCard has successfully sent the
     * counter-offer. Rejects the original response so it disappears
     * from Reçues (both sides see the withdrawal), then lets the
     * next refresh re-sync the list.
     */
    async function handleCounterSubmitted(): Promise<void> {
        const id = counteringResponse?.id ?? null;

        clearCountering();

        if (id === null) return;

        // Optimistically remove the response from the local list so
        // the panel does not briefly flash the OfferCard for it
        // before the reload lands.
        setResponses((prev) => prev.filter((r) => r.id !== id));

        try {
            await rejectTradeOfferResponse(id);
        } catch {
            // Non-fatal. The next scheduled refresh will re-add
            // the response if the reject did not go through.
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

    if (responses.length === 0 && counteringResponse == null) {
        return (
            <p className='rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground'>
                Aucune offre reçue pour le moment.
            </p>
        );
    }

    /**
     * Effective list of cards to render:
     *   - every received response, in the order returned by the API;
     *   - if the countering response is not in that list (edge case:
     *     the response briefly fell out during a re-fetch, or was
     *     removed by the optimistic delete before the server
     *     responded), append it at the end so the user does not
     *     lose his work in progress.
     */
    const renderedCards: TradeOfferResponse[] = [...responses];

    if (
        counteringResponse !== null &&
        !responses.some((r) => r.id === counteringResponse.id)
    ) {
        renderedCards.push(counteringResponse);
    }

    return (
        <div className='space-y-3'>
            {renderedCards.map((response) => {
                const isCountering =
                    counteringResponse?.id === response.id;

                if (isCountering && user?.fantasyTeamId != null) {
                    return (
                        <DirectOfferCard
                            key={`counter-${response.id}`}
                            connectedTeamId={user.fantasyTeamId}
                            connectedTeamName={
                                user.fantasyTeamName ?? 'Mon équipe'
                            }
                            targetTeamId={
                                response.respondingFantasyTeamId
                            }
                            targetTeamName={
                                response.respondingFantasyTeamName
                            }
                            onOpenTeamRoster={onOpenTeamRoster}
                            onRequestPlayerPick={onRequestPlayerPick}
                            onRequestTargetTeam={() => {
                                // No-op: the target team is locked
                                // when countering a received offer.
                            }}
                            onCancel={cancelCounterOffer}
                            onSubmitted={() => {
                                void handleCounterSubmitted();
                                requestMarketplaceNavigation('sent');
                            }}
                        />
                    );
                }

                return (
                    <OfferCard
                        key={response.id}
                        offer={responseToOfferShape(response)}
                        busy={busyId === response.id}
                        onCancel={() => {
                            // Responses cannot be cancelled by the
                            // recipient. No-op.
                        }}
                        userRoster={null}
                        onAccept={() => void handleAccept(response.id)}
                        onReject={() => void handleReject(response.id)}
                        onCounterOffer={() => startCounterOffer(response)}
                        onCancelAcceptedTrade={
                            response.status === 'Accepted'
                                ? () =>
                                    void handleCancelAccepted(response.id)
                                : undefined
                        }
                        onOpenTeamRoster={onOpenTeamRoster}
                    />
                );
            })}
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

    /**
     * Fire-and-forget "seen" marker, 2 seconds after the list has
     * been on screen. Marks the user's own sent responses as seen
     * so the "accepted" gold badge on the navbar clears once the
     * user has actually looked at the Envoyées panel.
     *
     * Uses the same markResponsesSeen endpoint as the Reçues
     * panel: the backend accepts either side of the response
     * (offer creator or responding team), and the shared view-row
     * table records both. A response is either received or sent,
     * never both, so the two panels never fight over the same
     * marker.
     *
     * On success, forces an immediate refetch of the navbar badge
     * so the count drops without waiting for the next 60-second
     * poll tick.
     */
    useEffect(() => {
        if (responses.length === 0) return;

        const ids = responses.map((r) => r.id);

        const timer = window.setTimeout(() => {
            markResponsesSeen(ids)
                .then(() => refreshMarketplaceNotificationsNow())
                .catch(() => {
                    // Non-fatal.
                });
        }, MARK_SEEN_DELAY_MS);

        return () => {
            window.clearTimeout(timer);
        };
    }, [responses]);

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
                    onCancelAcceptedTrade={
                        response.status === 'Accepted'
                            ? () => void handleCancel(response.id)
                            : undefined
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
            className={`w-full table-fixed border-collapse tabular-nums ${size === 'md'
                ? 'mt-1 text-sm md:text-base leading-snug'
                : 'mt-1 text-[0.6rem] md:text-[0.7rem] leading-tight'
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
                            className={`px-0 text-center ${column === 'FP' || column === 'GP' ? 'font-bold' : 'font-normal'}`}
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
                            className={`px-0 text-center ${columns[index] === 'FP' || columns[index] === 'GP' ? 'font-bold' : ''}`}
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
                            className={`px-0 text-center ${columns[index] === 'FP' || columns[index] === 'GP' ? 'font-bold' : ''}`}
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
// Custom player dropdown
//
// A native <select> element cannot render per-option layout: every
// <option> is a plain string, there is no way to align one piece of
// text to the left and another to the right inside the same row, and
// there is no way to style the option list beyond a couple of
// browser-supported properties.
//
// This custom dropdown gives us a full flex row per option so the
// player name can be pushed to the far left and his contract salary
// to the far right, matching the "PlayerName ---------- Salary"
// layout you asked for.
//
// The panel is rendered with createPortal to document.body so it is
// never clipped by the OfferCard's `overflow-hidden`, and it is
// positioned with `position: fixed` using the trigger's bounding
// rect. It closes on outside click, on Escape, and on scroll (same
// behavior as a native select on the desktop web).
// ---------------------------------------------------------------------

function PlayerDropdownPanel({
    anchorRef,
    panelRef,
    matches,
    currentPick,
    onPick,
    onClose,
    slotIndex,
    wouldBustCap,
}: {
    /**
     * Trigger element. The panel is anchored under its bottom edge.
     */
    anchorRef: React.RefObject<HTMLElement | null>;
    /**
     * Assigned to the portaled panel root so the parent's outside-
     * click check can test whether the click landed inside it.
     */
    panelRef: React.RefObject<HTMLUListElement | null>;
    matches: RosterEntry[];
    currentPick: number | null;
    onPick: (playerId: number | null) => void;
    onClose: () => void;
    /**
     * Slot this dropdown is picking a player for. Forwarded from
     * the parent so `wouldBustCap` can simulate the effect of a
     * candidate in exactly this slot.
     */
    slotIndex: number;
    /**
     * Cap simulation helper from OfferCard. Returns true when a
     * candidate player's salary would push either team below
     * zero cap space if selected in the given slot.
     */
    wouldBustCap: (
        candidateSalary: number,
        forSlotIndex: number,
    ) => boolean;
}) {
    // Snapshot the anchor's rect at first render. The parent closes
    // the panel on scroll, so there is nothing to recompute later.
    const [rect] = useState<DOMRect | null>(() =>
        anchorRef.current
            ? anchorRef.current.getBoundingClientRect()
            : null,
    );

    if (!rect) {
        return null;
    }

    // Panel is at least as wide as the trigger, and never narrower
    // than 260px. The row now carries four pieces of information
    // (name, position, FP, salary), so the old 180px floor was
    // too tight and forced the salary to hug the name.
    const panelWidth = Math.max(rect.width, 260);

    // Keep the panel inside the viewport horizontally. 8px margin
    // on each side.
    const left = Math.max(
        8,
        Math.min(rect.left, window.innerWidth - panelWidth - 8),
    );

    // If there isn't enough room below the trigger for a useful
    // amount of the panel, cap the height so it scrolls internally.
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const maxHeight = Math.max(140, Math.min(256, spaceBelow));

    return createPortal(
        <ul
            ref={panelRef}
            role='listbox'
            style={{
                position: 'fixed',
                top: rect.bottom + 4,
                left,
                width: panelWidth,
                maxHeight,
                zIndex: 200,
            }}
            className='overflow-y-auto rounded border border-[#00E5FF]/60 bg-[#080D1A] py-1 shadow-lg'
        >
            <li>
                <button
                    type='button'
                    onClick={() => {
                        onPick(null);
                        onClose();
                    }}
                    className='flex w-full cursor-pointer items-center px-2 py-1 text-left text-xs font-semibold text-[#F2F5FA] transition-colors hover:bg-[#00A8FF]/15'
                >
                    {matches.length === 0
                        ? 'Aucun joueur admissible'
                        : '— Choisir un joueur —'}
                </button>
            </li>

            {matches.map((m) => {
                const isSelected = currentPick === m.playerId;

                const salary =
                    m.currentContract?.salary ?? m.fantasySalary;

                // Simulate picking this player in this slot: if
                // either team would end up below zero cap space,
                // flag the salary in red so the user can see it's
                // off-limits before clicking. Same simulation the
                // "Offrir" button uses, but per candidate.
                const busts = wouldBustCap(salary, slotIndex);

                return (
                    <li key={m.playerId}>
                        <button
                            type='button'
                            onClick={() => {
                                onPick(m.playerId);
                                onClose();
                            }}
                            className={`flex w-full cursor-pointer items-center justify-between gap-2 px-2 py-1 text-left text-xs transition-colors hover:bg-[#00A8FF]/15 ${isSelected
                                ? 'bg-[#00A8FF]/10 font-semibold text-[#00E5FF]'
                                : 'text-[#F2F5FA]'
                                }`}
                        >
                            {/* Left group: name + position + FP,
                                all hugging each other so the
                                position reads as belonging to the
                                name and the FP as belonging to the
                                position. Only the name is allowed
                                to shrink; position and FP are
                                single-token values. */}
                            <span className='flex min-w-0 items-center gap-2'>
                                <span className='min-w-0 truncate font-semibold'>
                                    {m.firstName} {m.lastName}
                                </span>

                                <span className='shrink-0 text-[0.65rem] uppercase text-white'>
                                    {toPositionGroup(m.position)}
                                </span>

                                <span
                                    className='shrink-0 font-semibold tabular-nums'
                                    style={{ color: '#FFC72C' }}
                                >
                                    {m.currentSeason?.fantasyPoints ??
                                        0}
                                </span>
                            </span>

                            {/* Salary — pushed to the far right,
                                never truncates. Red when picking
                                this player would bust either
                                team's cap. */}
                            <span
                                className={`shrink-0 tabular-nums ${busts
                                    ? 'text-[#EF4444]'
                                    : 'text-[#7DD3FC]'
                                    }`}
                            >
                                {compactSalary(salary)}
                            </span>
                        </button>
                    </li>
                );
            })}
        </ul>,
        document.body,
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
    bordered = false,
    onClick,
    topLeftSlot,
    topRightSlot,
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
    /**
     * When true, the name row is wrapped in a 2px cyan-bordered
     * box, matching the visual weight of the offering side on the
     * browse offer card. Used on the responding side when the
     * player is coming from the server DTO rather than the client
     * store (rare: saved-response shape), so the two sides always
     * look the same.
     */
    bordered?: boolean;
    /**
     * When set, the name row becomes a clickable control that
     * calls this handler. Used to open the roster popup so the
     * responder can change or remove the current pick.
     */
    onClick?: () => void;
    /**
     * Optional absolutely-positioned overlay rendered at the
     * top-left corner of the name row. Used by OfferCard to place
     * the red "remove" circle on the responding side of a slot.
     * The overlay is anchored to the NAME ROW itself (not to the
     * wider column), so its offset lands on the player's bordered
     * card regardless of how wide the stat table below it is.
     */
    topLeftSlot?: React.ReactNode;
    /**
     * Same as topLeftSlot, but anchored to the top-right corner.
     * Used by OfferCard to place the red "remove" circle on the
     * offering side of a slot.
     */
    topRightSlot?: React.ReactNode;
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

    /**
   * When the block is clickable (onClick is set), the player name
   * is NOT a Link: the whole bordered box must be the single
   * click target that opens the roster popup, matching the
   * behaviour of the responding side (whose name is a plain span
   * inside its own button). Without this, the Link's own
   * navigation intercepts the click and the popup never opens.
   *
   * In read-only contexts (no onClick), the name stays a Link to
   * the player page as before.
   */
    const nameRowContent = (
        <>
            {nhlTeam && (
                <NhlTeamLogo abbreviation={nhlTeam} size={20} />
            )}

            {nhlPlayerId != null && onClick == null ? (
                <Link
                    to={`/joueurs/${nhlPlayerId}`}
                    onClick={(e) => e.stopPropagation()}
                    className='min-w-0 truncate font-semibold text-foreground transition-colors hover:text-[#00E5FF]'
                >
                    {shortName(firstName, lastName)}
                </Link>
            ) : (
                <span className='min-w-0 truncate font-semibold'>
                    {shortName(firstName, lastName)}
                </span>
            )}

            {age != null && (
                <span className='shrink-0 text-[0.6rem] font-normal text-white md:text-xs'>
                    {age} ans
                </span>
            )}

            <span className='shrink-0 text-[0.6rem] uppercase text-white md:text-xs'>
                {position}
            </span>
        </>
    );

    const nameRow = bordered ? (
        <button
            type='button'
            onClick={onClick}
            disabled={onClick == null}
            className='flex w-fit min-w-0 max-w-[14rem] items-center justify-start gap-x-1.5 rounded border-2 border-[#00E5FF] bg-[#080D1A] px-2 py-0.5 text-[0.8rem] text-foreground transition-colors enabled:cursor-pointer enabled:hover:bg-[#00E5FF]/10 disabled:cursor-default md:max-w-[18rem] md:text-[0.85rem]'
            style={
                onClick != null
                    ? {
                        boxShadow: [
                            '0 0 4px rgba(0, 229, 255, 0.9)',
                            '0 0 10px rgba(0, 229, 255, 0.55)',
                            '0 0 16px rgba(0, 229, 255, 0.25)',
                        ].join(', '),
                    }
                    : undefined
            }
        >
            {nameRowContent}
        </button>
    ) : (
        <div className='flex h-7 w-full items-center justify-start gap-x-1.5 text-[0.8rem] text-foreground md:text-[0.85rem]'>
            {nameRowContent}
        </div>
    );

    const hasOverlays =
        topLeftSlot != null || topRightSlot != null;

    return (
        <>
            {hasOverlays ? (
                <div className='relative w-fit'>
                    {nameRow}

                    {topLeftSlot != null && (
                        <div className='absolute left-1 top-1 z-20'>
                            {topLeftSlot}
                        </div>
                    )}

                    {topRightSlot != null && (
                        <div className='absolute right-1 top-1 z-20'>
                            {topRightSlot}
                        </div>
                    )}
                </div>
            ) : (
                nameRow
            )}

            <StatLinesTable
                current={currentSeasonStats ?? null}
                previous={lastSeasonStats ?? null}
                isGoalie={toPositionGroup(position) === 'G'}
            />

            {currentContractLabel && (
                <div className='mt-0.5 flex flex-wrap items-center justify-center gap-x-1 text-[0.7rem] leading-none font-semibold text-emerald-400 md:text-[0.75rem]'>
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
    slotIndex,
    wouldBustCap,
    onChangeRequest,
    topLeftSlot,
    topRightSlot,
}: {
    entry: RosterEntry | null;
    matches: RosterEntry[];
    currentPick: number | null;
    onPick: (playerId: number | null) => void;
    slotIndex: number;
    wouldBustCap: (candidateSalary: number, forSlotIndex: number) => boolean;
    onChangeRequest?: () => void;
    topLeftSlot?: React.ReactNode;
    topRightSlot?: React.ReactNode;
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

    /**
     * Custom dropdown state. Replaces the previous native-select
     * overlay so the option rows can push the player name to the
     * far left and the contract salary to the far right.
     */
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLUListElement | null>(null);

    useEffect(() => {
        if (!open) return;

        function onDocMouseDown(e: MouseEvent) {
            const target = e.target as Node;

            if (triggerRef.current?.contains(target)) return;
            if (panelRef.current?.contains(target)) return;

            setOpen(false);
        }

        function onDocKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                setOpen(false);
            }
        }

        function onWindowScroll() {
            setOpen(false);
        }

        document.addEventListener('mousedown', onDocMouseDown);
        document.addEventListener('keydown', onDocKeyDown);
        // No capture phase (no `true`): the scroll event does not
        // bubble, so without capture this listener only fires for
        // the page itself, never for the panel's own internal
        // scroll. With capture=true it caught the panel's scroll
        // too and closed the dropdown the moment the user tried
        // to scroll through the option list.
        window.addEventListener('scroll', onWindowScroll);

        return () => {
            document.removeEventListener('mousedown', onDocMouseDown);
            document.removeEventListener('keydown', onDocKeyDown);
            window.removeEventListener('scroll', onWindowScroll);
        };
    }, [open]);

    const disabled = matches.length === 0 && currentPick == null;

    return (
        <>
            <div className='flex h-7 flex-nowrap items-center justify-center text-sm text-foreground md:text-[0.9rem]'>
                {/*
                 * The trigger is now a real <button> that opens the
                 * custom dropdown panel. The rectangle styling
                 * (border, background, padding, rounded corners)
                 * moves onto the button, keeping the exact same
                 * appearance as before.
                 */}
                <div className='relative inline-flex w-fit min-w-0'>
                    {topLeftSlot != null && (
                        <div className='absolute left-1 top-1 z-20'>
                            {topLeftSlot}
                        </div>
                    )}

                    {topRightSlot != null && (
                        <div className='absolute right-1 top-1 z-20'>
                            {topRightSlot}
                        </div>
                    )}

                    <button
                        ref={triggerRef}
                        type='button'
                        disabled={disabled}
                        onClick={() => {
                            if (onChangeRequest) {
                                onChangeRequest();
                            } else {
                                setOpen((v) => !v);
                            }
                        }}
                        aria-haspopup={
                            onChangeRequest ? undefined : 'listbox'
                        }
                        aria-expanded={
                            onChangeRequest ? undefined : open
                        }
                        aria-label='Choisir un joueur'
                        className={`inline-flex w-fit min-w-0 max-w-[12rem] cursor-pointer items-center justify-center rounded bg-[#080D1A] px-2 py-0.5 disabled:cursor-not-allowed md:max-w-[16rem] ${currentPick != null ? 'border-2' : 'border'
                            }`}
                        style={{
                            borderColor:
                                currentPick != null
                                    ? '#00E5FF'
                                    : 'rgba(0, 229, 255, 0.4)',
                            boxShadow:
                                currentPick != null
                                    ? [
                                        '0 0 4px rgba(0, 229, 255, 0.9)',
                                        '0 0 10px rgba(0, 229, 255, 0.55)',
                                        '0 0 16px rgba(0, 229, 255, 0.25)',
                                    ].join(', ')
                                    : undefined,
                        }}
                    >
                        {/*
                         * Visible content: centered logo + name +
                         * age, logo on the left, age on the right.
                         * Truncated when the name is too long.
                         *
                         * `pr-2` nudges the whole group slightly
                         * left so the age reads as sitting on the
                         * right rather than pushing the name
                         * off-center.
                         */}
                        <span className='flex min-w-0 items-center justify-center gap-x-1.5 truncate pr-2 text-[0.8rem] font-semibold text-foreground md:text-[0.85rem]'>
                            {entry?.nhlTeamAbbreviation && (
                                /*
                                 * Wrapper holds the layout box at
                                 * 14x14 so the dropdown height stays
                                 * unchanged, and the inner span is
                                 * scaled 1.25x so the rendered logo
                                 * is ~17.5px. The transform never
                                 * affects layout, so the wrapper's
                                 * border-box is still 14x14 and the
                                 * button's total height is identical
                                 * to before.
                                 */
                                <span
                                    aria-hidden='true'
                                    className='shrink-0'
                                    style={{
                                        width: 14,
                                        height: 14,
                                        display: 'inline-block',
                                        transform: 'scale(1.25)',
                                        transformOrigin: 'center',
                                    }}
                                >
                                    <NhlTeamLogo
                                        abbreviation={
                                            entry.nhlTeamAbbreviation
                                        }
                                        size={14}
                                    />
                                </span>
                            )}

                            <span className='truncate'>
                                {entry
                                    ? shortName(
                                        entry.firstName,
                                        entry.lastName,
                                    )
                                    : matches.length === 0
                                        ? 'Aucun joueur admissible'
                                        : '— Choisir un joueur —'}
                            </span>

                            {entry?.age != null && (
                                <span className='shrink-0 text-[0.6rem] font-normal text-white md:text-xs'>
                                    {entry.age} ans
                                </span>
                            )}
                        </span>
                    </button>

                    {open && !disabled && !onChangeRequest && (
                        <PlayerDropdownPanel
                            anchorRef={triggerRef}
                            panelRef={panelRef}
                            matches={matches}
                            currentPick={null}
                            onPick={onPick}
                            onClose={() => setOpen(false)}
                            slotIndex={slotIndex}
                            wouldBustCap={wouldBustCap}
                        />
                    )}
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
                        <div className='mt-0.5 flex flex-wrap items-center justify-center gap-x-1 text-[0.7rem] leading-none font-semibold text-emerald-400 md:text-[0.75rem]'>
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
// Team cap line
//
// Renders, under a team name on the trade card header, the team's
// space under the salary cap: base value (today, without the trade)
// on the left, adjusted value (after the trade) on the right.
//
// The base value is always present when the card has enough data.
// The adjusted value depends on the picks the user has made on the
// card, so on a fresh card it equals the base value and the arrow
// reads as "no change".
//
// Everything is expressed as "X.XM $" to match the format used by
// the Masse salariale tab on Mon équipe.
// ---------------------------------------------------------------------

function TeamCapLine({
    baseCapSpace,
    adjustedCapSpace,
}: {
    baseCapSpace: number;
    adjustedCapSpace: number;
}) {
    // Only flag the adjusted value when it goes negative, i.e. the
    // team would be over the salary cap after the trade. A change in
    // either direction that stays within the cap is not interesting
    // for the user, so the value stays in the same cyan as the base.
    const busted = adjustedCapSpace < 0;

    return (
        <div className='flex items-center justify-center gap-x-1 text-sm font-semibold tabular-nums md:text-base'>
            <span className='text-[#7DD3FC]'>
                {compactSalary(baseCapSpace)} $
            </span>

            <span
                aria-hidden='true'
                className='text-[#7DD3FC]'
            >
                →
            </span>

            <span
                className={
                    busted
                        ? 'text-[#EF4444]'
                        : 'text-[#7DD3FC]'
                }
            >
                {compactSalary(adjustedCapSpace)} $
            </span>
        </div>
    );
}

// ---------------------------------------------------------------------
// Offer card
// ---------------------------------------------------------------------

/**
 * Builds a synthetic TradeOfferSlot for a responding-side extra slot
 * on the "Voir les offres" tab.
 *
 * An extra slot has no counterpart on the original offer, so every
 * offering-side field is null and every demand criterion is empty.
 * The struct only exists to satisfy the shape the pick popup expects
 * when the responder opens the roster popup to choose a player for
 * the extra.
 *
 * The positionGroup is set to "F" arbitrarily: the popup does not
 * enforce position on browse offers, and passing a position here
 * would incorrectly narrow the responder's choice.
 */
function buildSyntheticExtraSlot(slotIndex: number): TradeOfferSlot {
    return {
        slotIndex,
        positionGroup: 'F',
        offeringPlayerId: null,
        offeringPlayerNhlPlayerId: null,
        offeringPlayerFirstName: null,
        offeringPlayerLastName: null,
        offeringPlayerNhlTeam: null,
        offeringPlayerPosition: null,
        offeringPlayerAge: null,
        offeringPlayerCurrentContract: null,
        offeringPlayerSecondContract: null,
        offeringPlayerCurrentSeasonStats: null,
        offeringPlayerLastSeasonStats: null,
    };
}

function OfferCard({
    offer,
    busy,
    onCancel,
    onEdit,
    userRoster,
    hideInternalCancel = false,
    onSlotClick,
    onAccept,
    onReject,
    onCounterOffer,
    responseStatus,
    onCancelResponse,
    onCancelAcceptedTrade,
    onOpenTeamRoster,
    onRequestPlayerPick,
    onRequestOfferingPlayerPick,
    onResponded,
    swapSides = false,
}: {
    offer: TradeOffer;
    busy: boolean;
    onCancel: () => void;
    /**
     * When provided, a "Modifier" button is rendered on the
     * "Mon offre" header row, to the left of the "Annuler" button.
     * Only the "Vos offres actives" panel passes this: the
     * "Voir les offres" panel never edits anyone else's offer, and
     * the publish preview popup hides the entire header row.
     *
     * See the Mon offre header block below for the exact rendering.
     */
    onEdit?: () => void;
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
     * When provided AND the offer is still Pending, renders a
     * "Contre-offre" button to the left of "Refuser". Only the
     * "Offres reçues" panel passes this. The callback is
     * responsible for populating the Créer draft, switching the
     * tab, and rejecting the underlying response.
     */
    onCounterOffer?: () => void;

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
     * When provided AND the underlying response has been Accepted,
     * renders an "Annuler" button below the "OFFRE ACCEPTÉE" label.
     *
     * Both the Reçues and Envoyées panels pass this: the offer
     * creator to withdraw his acceptance, the responder to withdraw
     * his answer. Semantically this is the "changed my mind"
     * escape hatch for a private league where managers trust each
     * other.
     */
        onCancelAcceptedTrade?: () => void;
        /**
      * When provided, the two manager names in the card header
      * become clickable buttons that call this callback with the
      * team id and name. MarketplacePage uses it to open a roster
      * popup instead of navigating to /mon-equipe. When undefined
      * (e.g. the publish preview popup), the names render as plain
      * non-interactive text.
      */
        onOpenTeamRoster?: (teamId: number, teamName: string) => void;
        /**
         * Optional. Fired after the responder successfully sends a
         * response to the offer (the "Offrir" button's success branch).
         * MarketplacePage uses this to switch to the Envoyées tab so
         * the responder immediately sees his newly-sent response
         * listed there.
         */
        onResponded?: () => void;
    /**
  * When provided, the responder's picker is a "Choisir un
  * joueur" button that opens the roster popup in pick mode,
  * instead of an inline player dropdown. The callback also
  * receives an `onPick` closure the popup calls when the
  * responder clicks "Ajouter" on a player row.
  */
        onRequestPlayerPick?: (
            teamId: number,
            teamName: string,
            pick: PendingPickContext,
        ) => void;
        /**
   * When provided, the offering side of every slot renders a
   * "Choisir un joueur" (or "Changer") button that opens the
   * offer creator's roster in pick mode. The pick is stored as
   * an offering override for this slot and is submitted with the
   * response.
   */
        onRequestOfferingPlayerPick?: (
            teamId: number,
            teamName: string,
            pick: PendingPickContext,
        ) => void;
    /**
     * When true, the two sides of the card are rendered in the
     * opposite order:
     *
     *   - header:  the responder's team name goes on the LEFT,
     *              the creator's on the RIGHT.
     *   - slots:   the responding column (pick UI) goes on the
     *              LEFT, the offering column on the RIGHT.
     *
     * Used only by the "Voir les offres" tab so the connected
     * user — who is the responder in that context — sees his own
     * team on the left, matching the convention used everywhere
     * else in the app ("me" on the left, "other" on the right).
     *
     * Purely visual. The cap math, the pick store keys, the
     * responder/creator semantics, and every team-name click
     * handler are tied to identity, not to position, so none of
     * them need to change.
     *
     * Defaults to false, which is what Reçues / Envoyées / the
     * publish preview expect.
     */
    swapSides?: boolean;
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
     * True when this card represents a saved response (Reçues or
     * Envoyées tab) rather than a live browse offer.
     *
     * Used by the slot rendering to always show the SlotPlayerBlock
     * on the responding side, even when the responding player is
     * null. Unbalanced direct offers create response slots with no
     * responding player; without this flag those slots would fall
     * through to the demand-criteria block, which is wrong for a
     * saved response.
     *
     * `respondingFantasyTeamName` is only ever set on shapes built
     * from a TradeOfferResponse (see responseToOfferShape), so its
     * presence is a reliable discriminator between the two card
     * sources.
     */
    const isResponseCard =
        offer.respondingFantasyTeamName != null;

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
    /**
   * Picks are read from the module-level store via
   * useSyncExternalStore. The store is the single source of
   * truth, so a write from ANYWHERE (the offer card's own
   * picker, the roster popup's "Ajouter" button, a restore
   * after a PlayerPage round-trip) propagates immediately to
   * every mounted card.
   *
   * The 2nd arg caches its return per offer id, so React sees
   * the same snapshot reference between store changes and does
   * not enter a render loop.
   */
    const picks = useSyncExternalStore(
        subscribeToPicks,
        () => getPicksForOffer(offer.id),
    );

    /**
     * The responder's optional text message for this offer. Only
     * meaningful when the card is in respond mode (Voir les
     * offres); on other card shapes the value is ignored.
     */
    const responseNote = useSyncExternalStore(
        subscribeToResponseNotes,
        () => getResponseNote(offer.id),
    );

    /**
     * Extra responding slots the user has added on the "Voir les
     * offres" tab. Each entry is a slot index >= offer.slots.length.
     * The pick for that slot, if any, lives in the same `picks`
     * store above under that index; this list only tells us which
     * indices should be rendered as extras.
     */
    const extraResponderSlots = useSyncExternalStore(
        subscribeToExtraResponderSlots,
        () => getExtraResponderSlots(offer.id),
    );

    const offeringOverrides = useSyncExternalStore(
        subscribeToOfferingOverrides,
        () => getOfferingOverridesForOffer(offer.id),
    );

    /**
     * True when the responder explicitly emptied the offering side
     * of the given slot (as opposed to "no override, use the
     * creator's player").
     */
    const isOfferingCleared = (slotIndex: number): boolean =>
        offeringOverrides[slotIndex] === CLEARED_OFFERING_SENTINEL;

    /**
     * Effective offering player id for a BASE slot: the responder's
     * override if there is one, the creator's own offering player
     * otherwise. Returns null when the slot is explicitly cleared or
     * when there is no player on the offering side at all.
     */
    const effectiveOfferingPlayerIdForSlot = (
        slot: TradeOfferSlot,
    ): number | null => {
        const raw = offeringOverrides[slot.slotIndex];

        if (raw === CLEARED_OFFERING_SENTINEL) return null;
        if (raw != null) return raw;

        return slot.offeringPlayerId ?? null;
    };

    /**
     * Response-card slot filtering and ordering.
     *
     * On Reçues and Envoyées, the responder's answer is often
     * unbalanced: some slots of the original offer are answered
     * with a responding player, some are not, and some the
     * responder explicitly emptied on the offering side. The
     * rules:
     *
     *   - A slot that is empty on BOTH sides carries no
     *     information and is removed from the rendering
     *     entirely.
     *
     *   - A slot that is empty on ONE side is kept (it carries
     *     real information about which side the responder
     *     answered), but sorted BELOW the slots that are filled
     *     on both sides, so the meat of the trade always sits
     *     at the top of the card.
     *
     * Ordering within each group preserves the original slot
     * order, so a card whose slots are all one-sided does not
     * re-order unexpectedly.
     *
     * On every other card shape (browse, publish preview, own
     * offers) the original slot array is returned unchanged:
     * those cards always carry real content on both sides
     * because they represent the annonce itself.
     */
      /**
     * Response-card slot compaction.
     *
     * On Reçues and Envoyées the responder's answer is often
     * unbalanced: some slots carry a responding player, some
     * don't, and some carry no offering player at all. Raw, that
     * leaves holes on one side of a row while the other side is
     * populated, and both-empty rows sitting in the middle of the
     * card.
     *
     * The fix is a per-side compaction:
     *
     *   1. Walk the original slots in order and collect every
     *      player that lives on the LEFT side (offering) into one
     *      list, and every player on the RIGHT side (responding)
     *      into another list.
     *
     *   2. Re-pair the two lists by index. Merged row i takes the
     *      i-th left player and the i-th right player.
     *
     *   3. Rows where neither list has an entry at that index are
     *      simply never produced, so both-empty rows vanish.
     *
     * Concrete example: [Hagel|∅, ∅|Podkolzin, Marner|∅] becomes
     * [Hagel|Podkolzin, Marner|∅]. Podkolzin floated up into the
     * empty right cell of row 0, Marner floated up into the empty
     * left cell of row 1.
     *
     * On every other card shape (browse, publish preview, own
     * offers) the original slot array is returned unchanged —
     * those cards are the annonce itself and must not be
     * reordered.
     *
     * The merged row's slotIndex is taken from whichever original
     * slot provided its content. It is unique across the merged
     * array (each original slot contributes at most one row per
     * side, and the two lists are zipped with distinct indices),
     * so it remains safe as a React key.
     *
     * offeringOverrides is intentionally NOT consulted here.
     * Response cards are read-only — the store is always empty
     * on them, and effectiveOfferingPlayerIdForSlot already falls
     * back to slot.offeringPlayerId when no override exists.
     */
    const visibleResponseSlots = useMemo(() => {
        if (!isResponseCard) {
            return offer.slots;
        }

        const leftSlots: TradeOfferSlot[] = [];
        const rightSlots: TradeOfferSlot[] = [];

        for (const slot of offer.slots) {
            if (slot.offeringPlayerId != null) {
                leftSlots.push(slot);
            }

            if (slot.respondingPlayerId != null) {
                rightSlots.push(slot);
            }
        }

        const total = Math.max(
            leftSlots.length,
            rightSlots.length,
        );

        const merged: TradeOfferSlot[] = [];

        for (let i = 0; i < total; i++) {
            const left = leftSlots[i];
            const right = rightSlots[i];

            merged.push({
                slotIndex:
                    left?.slotIndex ?? right?.slotIndex ?? i,
                positionGroup:
                    left?.positionGroup ??
                    right?.positionGroup ??
                    'F',

                // ---- LEFT side: from the left list ----
                offeringPlayerId:
                    left?.offeringPlayerId ?? null,
                offeringPlayerNhlPlayerId:
                    left?.offeringPlayerNhlPlayerId ?? null,
                offeringPlayerFirstName:
                    left?.offeringPlayerFirstName ?? null,
                offeringPlayerLastName:
                    left?.offeringPlayerLastName ?? null,
                offeringPlayerNhlTeam:
                    left?.offeringPlayerNhlTeam ?? null,
                offeringPlayerPosition:
                    left?.offeringPlayerPosition ?? null,
                offeringPlayerAge:
                    left?.offeringPlayerAge ?? null,
                offeringPlayerCurrentContract:
                    left?.offeringPlayerCurrentContract ?? null,
                offeringPlayerSecondContract:
                    left?.offeringPlayerSecondContract ?? null,
                offeringPlayerCurrentSeasonStats:
                    left?.offeringPlayerCurrentSeasonStats ??
                    null,
                offeringPlayerLastSeasonStats:
                    left?.offeringPlayerLastSeasonStats ??
                    null,

                // ---- RIGHT side: from the right list ----
                respondingPlayerId:
                    right?.respondingPlayerId ?? null,
                respondingPlayerNhlPlayerId:
                    right?.respondingPlayerNhlPlayerId ?? null,
                respondingPlayerFirstName:
                    right?.respondingPlayerFirstName ?? null,
                respondingPlayerLastName:
                    right?.respondingPlayerLastName ?? null,
                respondingPlayerNhlTeam:
                    right?.respondingPlayerNhlTeam ?? null,
                respondingPlayerPosition:
                    right?.respondingPlayerPosition ?? null,
                respondingPlayerAge:
                    right?.respondingPlayerAge ?? null,
                respondingPlayerCurrentContract:
                    right?.respondingPlayerCurrentContract ??
                    null,
                respondingPlayerSecondContract:
                    right?.respondingPlayerSecondContract ??
                    null,
                respondingPlayerCurrentSeasonStats:
                    right?.respondingPlayerCurrentSeasonStats ??
                    null,
                respondingPlayerLastSeasonStats:
                    right?.respondingPlayerLastSeasonStats ??
                    null,
            });
        }

        return merged;
    }, [isResponseCard, offer.slots]);

    /**
  * Ensures a trailing empty extra slot exists as soon as every
  * base slot of the offer and every existing extra are filled.
  *
  * This is what replaced the "Ajouter un joueur" button on the
  * "Voir les offres" tab. As soon as the responder fills the
  * last empty responding slot, a new empty extra is appended,
  * so there is always exactly one "Choisir un joueur" chooser
  * on the responding side.
  *
  * The effect only fires on cards the connected user can
  * respond to (canRespond is false on own offers, saved
  * responses and the publish preview), so it never mutates
  * state in a context that cannot add slots anyway.
  *
  * Reads the CURRENT extras from the store rather than the
  * captured value, so a double-invocation in React strict mode
  * cannot append the same extra twice. Converges because the
  * newly appended extra is empty, which makes the effect a
  * no-op on the next render.
  */
    useLayoutEffect(() => {
        if (!canRespond) return;

        const baseCount = offer.slots.length;
        const currentExtras = getExtraResponderSlots(offer.id);

        // Full list of slot indices currently rendered: the offer's
        // base slots plus every extra the responder has added.
        const allSlotIndices = [
            ...offer.slots.map((s) => s.slotIndex),
            ...currentExtras,
        ];

        // Find the highest-index slot currently on screen. That is
        // the slot whose emptiness (or non-emptiness) drives the
        // append decision, exactly the way DirectOfferCard does it.
        const lastSlotIndex = Math.max(...allSlotIndices);

        const lastBaseSlot = offer.slots.find(
            (s) => s.slotIndex === lastSlotIndex,
        );

        const lastOfferingRaw = offeringOverrides[lastSlotIndex];

        // "Filled" for the offering side: an explicit override
        // counts, the offer creator's own offering player (base
        // slot, no override) counts, an explicit clear does NOT.
        const lastOfferingFilled =
            lastOfferingRaw === CLEARED_OFFERING_SENTINEL
                ? false
                : lastOfferingRaw != null
                    ? true
                    : lastBaseSlot?.offeringPlayerId != null;

        const lastRespondingFilled =
            picks[lastSlotIndex] != null;

        // If the last slot is empty on both sides, do nothing.
        // Otherwise append a fresh empty extra so both sides keep
        // a "Choisir un joueur" chooser available. This mirrors the
        // DirectOfferCard behaviour: one chooser per side, always.
        if (!lastOfferingFilled && !lastRespondingFilled) {
            return;
        }

        addExtraResponderSlot(offer.id, baseCount);
    }, [
        canRespond,
        offer.id,
        offer.slots,
        picks,
        extraResponderSlots,
        offeringOverrides,
    ]);

    /**
  * Slot index of the first empty OFFERING slot across the
  * offer's base slots and every existing extra. The
  * "Choisir un joueur" chooser on the offering side renders
  * ONLY on that slot; every other empty offering slot renders
  * as an empty cell. Mirrors firstEmptyRespondingIdx.
  *
  * Base slot offering is "filled" when the offer creator put a
  * player there (OfferingPlayerId) OR the responder set an
  * override. Extra slot offering is "filled" only when an
  * override exists. Null when every offering slot already has
  * a player; transient, because the auto-append effect adds a
  * new extra on the same render.
  */
    const firstEmptyOfferingIdx = (() => {
        for (const slot of offer.slots) {
            const raw = offeringOverrides[slot.slotIndex];

            // Cleared counts as empty, an override counts as
            // filled, no override falls back to the creator's
            // offering player.
            const hasOffering =
                raw === CLEARED_OFFERING_SENTINEL
                    ? false
                    : raw != null
                        ? true
                        : slot.offeringPlayerId != null;

            if (!hasOffering) {
                return slot.slotIndex;
            }
        }

        for (const idx of extraResponderSlots) {
            const raw = offeringOverrides[idx];

            const hasOffering =
                raw != null && raw !== CLEARED_OFFERING_SENTINEL;

            if (!hasOffering) {
                return idx;
            }
        }

        return null;
    })();

    /**
     * Slot index of the first empty responding slot across the
     * offer's base slots and every existing extra. The
     * "Choisir un joueur" chooser on the responding side renders
     * ONLY on that slot; every other empty responding slot renders
     * as an empty cell.
     *
     * Null when every responding slot already has a pick. That
     * state is transient: the effect above appends a new extra on
     * the same render, so on the very next render a chooser is
     * available again.
     */
    const firstEmptyRespondingIdx = (() => {
        for (const slot of offer.slots) {
            if (picks[slot.slotIndex] == null) {
                return slot.slotIndex;
            }
        }

        for (const idx of extraResponderSlots) {
            if (picks[idx] == null) {
                return idx;
            }
        }

        return null;
    })();

    // -----------------------------------------------------------------
    // Draft picks ("Ajouter des choix de repêchage")
    //
    // Three sources feed the picks slot:
    //
    //   - offer.picks            : creator-side picks, server data.
    //                              Read-only on every card.
    //
    //   - offer.respondingPicks  : responder-side picks, server data.
    //                              Only present on response cards
    //                              (Reçues / Envoyées). Read-only.
    //
    //   - DraftPicks store       : responder-side picks the connected
    //                              user is currently building. Only
    //                              used when the user can respond.
    //
    // Responder's draft picks IDs come from the store; the full
    // DraftPick objects come from a getTeamDraftPicks call against
    // the responding team, fetched once when the card mounts.
    // -----------------------------------------------------------------

    const responderDraftPickIds = useSyncExternalStore(
        DraftPicks.subscribeToPicks,
        () =>
            DraftPicks.getPicks(
                DraftPicks.offerPicksKey(offer.id, 'responder'),
            ),
    );

    /**
     * Ids of the extra picks the connected user is asking the offer's
     * creator to give, on top of whatever the offer already carries.
     * Stored under the offer:requested key so it survives a PlayerPage
     * round-trip. Only used in "Voir les offres" (swapSides = true).
     */
    const requestedDraftPickIds = useSyncExternalStore(
        DraftPicks.subscribeToPicks,
        () =>
            DraftPicks.getPicks(
                DraftPicks.offerPicksKey(offer.id, 'requested'),
            ),
    );

    const [responderAvailablePicks, setResponderAvailablePicks] =
        useState<DraftPick[]>([]);

    useEffect(() => {
        if (rightTeamId == null) {
            setResponderAvailablePicks([]);
            return;
        }

        let cancelled = false;

        getTeamDraftPicks(rightTeamId)
            .then((data) => {
                if (!cancelled) setResponderAvailablePicks(data);
            })
            .catch(() => {
                if (!cancelled) setResponderAvailablePicks([]);
            });

        return () => {
            cancelled = true;
        };
    }, [rightTeamId]);

    /**
     * Picks owned by the offer's creator, used by the "Ajouter un
     * choix" dropdown on the creator's side of the picks slot in
     * "Voir les offres". The dropdown needs the full list of the
     * creator's picks so the responder can request any of them; the
     * offer's own picks (offer.picks) are already filtered out by
     * TradePicksSlot because they are in the selected list.
     */
    const [creatorAvailablePicks, setCreatorAvailablePicks] =
        useState<DraftPick[]>([]);

    useEffect(() => {
        if (!swapSides) {
            setCreatorAvailablePicks([]);
            return;
        }

        let cancelled = false;

        getTeamDraftPicks(offer.createdByFantasyTeamId)
            .then((data) => {
                if (!cancelled) setCreatorAvailablePicks(data);
            })
            .catch(() => {
                if (!cancelled) setCreatorAvailablePicks([]);
            });

        return () => {
            cancelled = true;
        };
    }, [swapSides, offer.createdByFantasyTeamId]);

    /**
     * The offer creator's full roster. Fetched only on the "Voir
     * les offres" tab, where the responder can override the
     * offering player of any slot; the override UI needs each
     * player's full display data (name, logo, age, contracts,
     * current and previous season stats) to render the same
     * SlotPlayerBlock the left column already uses.
     *
     * Not used anywhere else: on Reçues / Envoyées the offering
     * side comes from the server DTO, and on the publish preview
     * there is no responder.
     */
    const [creatorRoster, setCreatorRoster] =
        useState<TeamRoster | null>(null);

    useEffect(() => {
        if (!swapSides) {
            setCreatorRoster(null);
            return;
        }

        let cancelled = false;

        getTeamRoster(offer.createdByFantasyTeamId)
            .then((data) => {
                if (!cancelled) setCreatorRoster(data);
            })
            .catch(() => {
                if (!cancelled) setCreatorRoster(null);
            });

        return () => {
            cancelled = true;
        };
    }, [swapSides, offer.createdByFantasyTeamId]);

    const creatorPicks = offer.picks;

    /**
     * Draft picks the responder has explicitly removed from the
     * offer's own pick list, subscribed via useSyncExternalStore
     * so the card re-renders the moment the store changes. The
     * effective creator-pick list subtracts these out.
     */
    const removedCreatorPickIds = useSyncExternalStore(
        subscribeToRemovedCreatorPicks,
        () => getRemovedCreatorPicks(offer.id),
    );

    /**
     * The creator's picks as seen by the responder: the offer's own
     * picks minus everything the responder removed. This is what
     * the right-column TradePicksSlot renders, and what the
     * `hasAnyPick` gate checks.
     */
    const effectiveCreatorPicks = useMemo(
        () =>
            creatorPicks.filter(
                (p) => !removedCreatorPickIds.includes(p.id),
            ),
        [creatorPicks, removedCreatorPickIds],
    );

    const responderPicks = useMemo(() => {
        if (offer.respondingPicks != null) {
            return offer.respondingPicks;
        }

        return responderDraftPickIds
            .map((id) =>
                responderAvailablePicks.find((p) => p.id === id),
            )
            .filter((p): p is DraftPick => p != null);
    }, [
        offer.respondingPicks,
        responderDraftPickIds,
        responderAvailablePicks,
    ]);

    const responderPicksEditable =
        canRespond && offer.respondingPicks == null;

    const hasAnyPicks =
        offer.picks.length > 0 ||
        (offer.respondingPicks?.length ?? 0) > 0 ||
        responderDraftPickIds.length > 0;

    /**
     * Whether the picks slot is rendered at all. The slot is always
     * expanded (no collapse toggle) and its two columns are always
     * present. It is only omitted entirely when there is nothing to
     * show AND the user cannot add picks.
     */
    const showPicksSlot = canRespond || hasAnyPicks;

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

    // allSlotsFilled was removed: unbalanced responses are now
    // allowed, so the responder is not required to fill every base
    // slot. The "Offrir" button is gated on hasAnyPick instead.

    function setPick(slotIndex: number, playerId: number | null) {
        // Single write path. The store handles the notify, so
        // every subscribed OfferCard re-renders with the new
        // picks automatically.
        pickForSlot(offer.id, slotIndex, playerId);
    }

    /**
* Local state for the "Offrir" submit. Resets when the card
* unmounts or the user picks a different offer.
*/
    const [respondBusy, setRespondBusy] = useState(false);
    const [respondSuccess, setRespondSuccess] = useState<string | null>(null);
    const [respondError, setRespondError] = useState<string | null>(null);

    // -----------------------------------------------------------------
    // Cap-space display
    //
    // Each side of the card shows its team's space under cap, first
    // as it stands today (base) and then as it would be after the
    // current trade (adjusted). Both sides share the same season
    // cap, which comes from the backend DTO.
    //
    // Base space under cap is (seasonCap - teamCapHit). The
    // teamCapHit comes from the backend for the creator, and from
    // the local userRoster for the responder when the card is a
    // browse card (the responder is the connected user in that
    // case). On synthesized response cards the backend supplies
    // both cap hits.
    //
    // Adjusted space under cap is (base + what the team gives up -
    // what the team receives). The current season contract salary
    // of each player on the card's "offering" side is what the
    // offering team gives up; the salary on the "responding" side
    // is what the responder gives up, which the offering team
    // receives.
    // -----------------------------------------------------------------

    const seasonCap = offer.seasonSalaryCap;

    /**
     * Sum of the current-season contract salaries the LEFT side is
     * offering. Zero when no slot on that side has a contract
     * covering the current season, or when there are no offering
     * players at all.
     */
    const creatorOfferedSalary = useMemo(() => {
        let sum = 0;

        // Base slots: the salary of the EFFECTIVE offering player
        // on each. Three states per slot:
        //   - cleared  -> skip (0)
        //   - override -> look up the override player's salary in
        //                 the offer creator's roster
        //   - else     -> use the offer DTO's own salary
        for (const slot of offer.slots) {
            const raw = offeringOverrides[slot.slotIndex];

            if (raw === CLEARED_OFFERING_SENTINEL) {
                continue;
            }

            if (raw != null) {
                const entry = creatorRoster?.entries.find(
                    (e) => e.playerId === raw,
                );

                const salary = entry?.currentContract?.salary;
                if (salary != null) {
                    sum += salary;
                }

                continue;
            }

            const salary =
                slot.offeringPlayerCurrentContract?.salary;
            if (salary != null) {
                sum += salary;
            }
        }

        // Extra slots: only the offering override contributes,
        // because extras have no counterpart on the original offer.
        for (const idx of extraResponderSlots) {
            const raw = offeringOverrides[idx];

            if (
                raw == null ||
                raw === CLEARED_OFFERING_SENTINEL
            ) {
                continue;
            }

            const entry = creatorRoster?.entries.find(
                (e) => e.playerId === raw,
            );

            const salary = entry?.currentContract?.salary;
            if (salary != null) {
                sum += salary;
            }
        }

        return sum;
    }, [
        offer.slots,
        offeringOverrides,
        creatorRoster,
        extraResponderSlots,
    ]);

    /**
     * Sum of the current-season contract salaries the RIGHT side is
     * offering.
     *
     * Two cases:
     *   - Saved-response card: the DTO already carries each
     *     responding player's contract, so we read it off the slot.
     *   - Interactive browse card: the user's pick is a local
     *     playerId. We look the picked player up in userRoster and
     *     read his current contract.
     */
    const responderOfferedSalary = useMemo(() => {
        let sum = 0;

        // Base slots: saved-response cards carry the salary on the
        // DTO itself; interactive browse cards look it up in the
        // user's own roster from the `picks` store.
        for (const slot of offer.slots) {
            const savedSalary =
                slot.respondingPlayerCurrentContract?.salary;

            if (savedSalary != null) {
                sum += savedSalary;
                continue;
            }

            const pick = picks[slot.slotIndex];
            if (pick == null) continue;

            const entry = userRoster?.entries.find(
                (e) => e.playerId === pick,
            );

            const salary = entry?.currentContract?.salary;
            if (salary != null) {
                sum += salary;
            }
        }

        // Extra responder slots: only live on browse cards, always
        // looked up in the user's roster by the pick store.
        for (const idx of extraResponderSlots) {
            const pick = picks[idx];
            if (pick == null) continue;

            const entry = userRoster?.entries.find(
                (e) => e.playerId === pick,
            );

            const salary = entry?.currentContract?.salary;
            if (salary != null) {
                sum += salary;
            }
        }

        return sum;
    }, [
        offer.slots,
        picks,
        userRoster,
        extraResponderSlots,
    ]);

    // Creator's base and adjusted cap space. Null when either the
    // season cap or the creator's cap hit is unknown.
    const creatorBaseCapSpace =
        seasonCap > 0 &&
            offer.createdByFantasyTeamCapSalary != null
            ? seasonCap - offer.createdByFantasyTeamCapSalary
            : null;

    const creatorAdjustedCapSpace =
        creatorBaseCapSpace != null
            ? creatorBaseCapSpace +
            creatorOfferedSalary -
            responderOfferedSalary
            : null;

    // Responder's base and adjusted cap space. Base cap hit comes
    // from the backend when available (synthesized response cards),
    // otherwise from the connected user's own roster (browse cards).
    const responderCapHit =
        offer.respondingFantasyTeamCapSalary ??
        userRoster?.capSalary ??
        null;

    const responderBaseCapSpace =
        seasonCap > 0 && responderCapHit != null
            ? seasonCap - responderCapHit
            : null;

    const responderAdjustedCapSpace =
        responderBaseCapSpace != null
            ? responderBaseCapSpace +
            responderOfferedSalary -
            creatorOfferedSalary
            : null;

    const showCreatorCapLine =
        creatorBaseCapSpace != null &&
        creatorAdjustedCapSpace != null;

    const showResponderCapLine =
        responderBaseCapSpace != null &&
        responderAdjustedCapSpace != null;

    /**
  * True when at least one dropdown on this card has a pick.
  * Used only to enable the "Réinitialiser" button.
  *
  * NOTE: there is deliberately NO cap-violation gate on this
  * card. Managers in this private league can send offers that
  * push either side over the salary cap. The projected cap
  * values on the card header still show the impact in red when
  * a side goes negative, but nothing is blocked.
  */
    const hasAnyPick = useMemo(
        () =>
            Object.values(picks).some((v) => v != null) ||
            Object.values(offeringOverrides).some(
                (v) => v != null,
            ) ||
            responderDraftPickIds.length > 0 ||
            requestedDraftPickIds.length > 0 ||
            removedCreatorPickIds.length > 0,
        [
            picks,
            offeringOverrides,
            responderDraftPickIds,
            requestedDraftPickIds,
            removedCreatorPickIds,
        ],
    );

    /**
  * Simulates picking the given player in the given slot and
  * returns true when either team would end up below zero cap
  * space with that pick in place.
  *
  * Used ONLY as a visual warning: the player dropdown colors a
  * would-be-busting option's salary in red so the manager can
  * see the impact before clicking. Nothing is blocked — the
  * offer can still be submitted with that pick.
  *
  * Returns false when cap data is incomplete (missing season
  * cap, missing base cap hit) — never flags a bust we cannot
  * prove.
  *
  * Plain function (not useCallback): the panel is short-lived
  * and only rendered while open, so re-creating the closure on
  * every render is cheaper than keeping a stale one in sync
  * with `offer`, `picks` and `userRoster`.
  */
    const wouldBustCap = (
        candidateSalary: number,
        forSlotIndex: number,
    ): boolean => {
        // Existing pick in this exact slot — its salary needs to
        // be removed from the total before adding the candidate,
        // so the simulation reflects "swap this pick", not "add
        // another pick on top".
        const existingPick = picks[forSlotIndex];
        let existingPickSalary = 0;

        if (existingPick != null) {
            const entry = userRoster?.entries.find(
                (e) => e.playerId === existingPick,
            );
            existingPickSalary =
                entry?.currentContract?.salary ??
                entry?.fantasySalary ??
                0;
        }

        const hypotheticalResponderTotal =
            responderOfferedSalary -
            existingPickSalary +
            candidateSalary;

        const hypotheticalCreatorAdjusted =
            creatorBaseCapSpace != null
                ? creatorBaseCapSpace +
                creatorOfferedSalary -
                hypotheticalResponderTotal
                : null;

        const hypotheticalResponderAdjusted =
            responderBaseCapSpace != null
                ? responderBaseCapSpace +
                hypotheticalResponderTotal -
                creatorOfferedSalary
                : null;

        return (
            (hypotheticalCreatorAdjusted != null &&
                hypotheticalCreatorAdjusted < 0) ||
            (hypotheticalResponderAdjusted != null &&
                hypotheticalResponderAdjusted < 0)
        );
    };

    /**
     * Clears every pick on this card (state + module-level store)
     * and wipes the success and error banners. Bound to the
     * "Réinitialiser" button in the action row.
     *
     * The store clear matters: without it, a later mount of the
     * same card would restore the picks we just cleared, since
     * OfferCard initializes `picks` from
     * `getPicksForOffer(offer.id)` on mount.
     */
    function handleResetPicks() {
        clearPicksForOffer(offer.id);
        clearExtraResponderSlots(offer.id);
        clearOfferingOverridesForOffer(offer.id);
        DraftPicks.clearOfferPicks(offer.id);
        clearRemovedCreatorPicks(offer.id);
        clearResponseNote(offer.id);
        setRespondSuccess(null);
        setRespondError(null);
    }

    async function handleOffer() {
        // `hasAnyPick` is the only structural gate on this side of
        // the guard: a response must contain at least one player or
        // at least one draft pick, otherwise there is nothing to
        // send. Beyond that, the trade is allowed to be as
        // unbalanced as the managers want: the responder can fill
        // zero base slots, some of them, or all of them, and can
        // add extras or attach picks without any matching
        // requirement on the other side. Cap violations are also
        // intentionally allowed; the red cap line is a warning, not
        // a block.
        if (
            !canRespond ||
            !hasAnyPick ||
            respondBusy
        ) {
            return;
        }

        // Convert the picks-by-slot map into the flat list the API
        // expects.
        //
        // Every BASE slot is submitted, even the ones that are
        // unfilled on both sides. Sending them with a null
        // responding player keeps the 1:1 slot mapping intact on
        // the offer creator's screen: he sees the full picture of
        // which slots the responder filled and which he left
        // empty, rather than a mysteriously short response.
        //
        // Extras are only submitted when they carry something (a
        // responding pick or an offering override). Empty extras
        // are skipped so a trailing auto-added placeholder never
        // produces a phantom slot.
        const picksArray: RespondToTradeOfferPick[] = [];

        for (const slot of offer.slots) {
            const pick = picks[slot.slotIndex] ?? null;

            const raw = offeringOverrides[slot.slotIndex];

            const cleared =
                raw === CLEARED_OFFERING_SENTINEL;

            const override =
                cleared ? null : raw ?? null;

            picksArray.push({
                slotIndex: slot.slotIndex,
                respondingPlayerId: pick,
                offeringPlayerOverrideId: override,
                removeOfferingPlayer: cleared,
            });
        }

        for (const slotIndex of extraResponderSlots) {
            const pick = picks[slotIndex] ?? null;

            const raw = offeringOverrides[slotIndex];

            const cleared =
                raw === CLEARED_OFFERING_SENTINEL;

            const override =
                cleared ? null : raw ?? null;

            if (pick == null && override == null && !cleared) {
                continue;
            }

            picksArray.push({
                slotIndex,
                respondingPlayerId: pick,
                offeringPlayerOverrideId: override,
                removeOfferingPlayer: cleared,
            });
        }

        setRespondBusy(true);
        setRespondError(null);
        setRespondSuccess(null);

        try {
            const trimmedNote = responseNote.trim();

            const result = await respondToTradeOffer(offer.id, {
                picks: picksArray,
                note: trimmedNote === '' ? null : trimmedNote,
                draftPickIds: responderDraftPickIds.slice(),
                requestedDraftPickIds:
                    requestedDraftPickIds.slice(),
                removedCreatorDraftPickIds:
                    Array.from(removedCreatorPickIds),
            });

            if (result.success) {
                setRespondSuccess(result.message);

                // Reset every dropdown on this card so the user
                // sees a clean box, exactly like before any pick
                // was made. The success banner stays visible so
                // he still gets confirmation that the offer went
                // through.
                //
                // Stores to clear:
                //   - marketplaceTradeState (per-slot player
                //     picks): clearPicksForOffer.
                //   - marketplaceExtraResponderSlots (trailing
                //     auto-added extras): clearExtraResponderSlots.
                //   - marketplaceOfferingOverrides (creator-side
                //     player overrides): clearOfferingOverridesForOffer.
                //   - marketplacePicksState (draft picks, all
                //     sides: responder / requested / creator):
                //     clearOfferPicks.
                //   - marketplaceRemovedCreatorPicks (creator picks
                //     the responder removed): clearRemovedCreatorPicks.
                //
                // Without these, a subsequent mount of the same
                // offer (should it ever come back into view)
                // would restore the state we just submitted.
                clearPicksForOffer(offer.id);
                clearExtraResponderSlots(offer.id);
                clearOfferingOverridesForOffer(offer.id);
                DraftPicks.clearOfferPicks(offer.id);
                clearRemovedCreatorPicks(offer.id);
                clearResponseNote(offer.id);

                // Ask the parent to switch to Envoyées. The parent
                // only wires this when the card is on the browse
                // tab, so the publish preview and the Reçues /
                // Envoyées panels are unaffected.
                onResponded?.();
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

    /**
  * Builds the list of player ids the popup must hide when the
  * responder picks the RESPONDING player for the given slot:
  * every player he has already committed to another responding
  * slot of the same trade (base or extra).
  *
  * The current slot's own pick is deliberately excluded so the
  * popup can still show it in the pinned card.
  */
    const buildExcludedRespondingIds = (
        currentSlotIndex: number,
    ): number[] => {
        const excluded: number[] = [];

        for (const s of offer.slots) {
            if (s.slotIndex === currentSlotIndex) continue;

            const pick = picks[s.slotIndex];
            if (pick != null) excluded.push(pick);
        }

        for (const idx of extraResponderSlots) {
            if (idx === currentSlotIndex) continue;

            const pick = picks[idx];
            if (pick != null) excluded.push(pick);
        }

        return excluded;
    };

    /**
     * Builds the list of player ids the popup must hide when the
     * responder picks the OFFERING player for the given slot:
     * every player already committed to the offering side of
     * another slot of the same trade. That covers both the offer
     * creator's original offerings and any overrides the responder
     * has already set.
     *
     * The current slot's own offered player is deliberately
     * excluded so the popup can still show him in the pinned card.
     */
    const buildExcludedOfferingIds = (
        currentSlotIndex: number,
    ): number[] => {
        const excluded: number[] = [];

        for (const s of offer.slots) {
            if (s.slotIndex === currentSlotIndex) continue;

            const raw = offeringOverrides[s.slotIndex];

            if (raw === CLEARED_OFFERING_SENTINEL) continue;
            if (raw != null) {
                excluded.push(raw);
            } else if (s.offeringPlayerId != null) {
                excluded.push(s.offeringPlayerId);
            }
        }

        for (const idx of extraResponderSlots) {
            if (idx === currentSlotIndex) continue;

            const raw = offeringOverrides[idx];

            if (raw == null) continue;
            if (raw === CLEARED_OFFERING_SENTINEL) continue;

            excluded.push(raw);
        }

        return excluded;
    };

    /**
     * Single entry point for "open the pick popup for this slot".
     * Called from the empty-state button and from the picked
     * player's trigger. Builds the cap context from the values
     * the card already has and forwards everything through
     * onRequestPlayerPick.
     *
     * capContext is only built when both cap hits are known and
     * the season cap is set. If any is missing, we pass undefined
     * and the popup simply does not render the projection row.
     */
    const requestPickForSlot = (slot: TradeOfferSlot) => {
        if (!onRequestPlayerPick || rightTeamId == null) return;

        const leftCapHit = offer.createdByFantasyTeamCapSalary;
        const rightCapHit = responderCapHit;

        // Salary the responder has already committed to OTHER
        // slots. The current slot's pick (if any) is excluded
        // because the popup will replace it with whichever
        // candidate the responder clicks.
        const existingPick = picks[slot.slotIndex];
        let existingPickSalary = 0;

        if (existingPick != null) {
            const entry = userRoster?.entries.find(
                (e) => e.playerId === existingPick,
            );
            existingPickSalary =
                entry?.currentContract?.salary ??
                entry?.fantasySalary ??
                0;
        }

        const responderOfferedSalaryExcludingCurrentSlot =
            responderOfferedSalary - existingPickSalary;

        const capContext: TradeCapContext | undefined =
            leftCapHit != null &&
                rightCapHit != null &&
                seasonCap > 0
                ? {
                    leftTeamName:
                        offer.createdByFantasyTeamName,
                    leftTeamCapHit: leftCapHit,
                    rightTeamName,
                    rightTeamCapHit: rightCapHit,
                    seasonSalaryCap: seasonCap,
                    creatorOfferedSalary,
                    responderOfferedSalaryExcludingCurrentSlot,
                    swapSides,
                }
                : undefined;

        const excluded = buildExcludedRespondingIds(
            slot.slotIndex,
        );

        // Build the reference card the popup shows at the top:
        // the EFFECTIVE offering player for this slot (post any
        // override or clear), not the offer slot's original DTO
        // field. If the responder has cleared the offering side,
        // this is null and the popup correctly shows no reference.
        //
        // Prefer the real roster entry (richer data: headshot,
        // contracts, injuries); fall back to the synthesized
        // snapshot built from the offer DTO when the creator
        // roster hasn't loaded yet AND the effective player is
        // the slot's own offering player.
        const effectiveOfferingId =
            effectiveOfferingPlayerIdForSlot(slot);

        let referencePlayer: RosterEntry | null = null;

        if (effectiveOfferingId != null) {
            const fromRoster = creatorRoster?.entries.find(
                (e) => e.playerId === effectiveOfferingId,
            );

            if (fromRoster) {
                referencePlayer = fromRoster;
            } else if (
                effectiveOfferingId === slot.offeringPlayerId
            ) {
                referencePlayer =
                    buildReferenceFromSlot(slot);
            }
        }

        onRequestPlayerPick(rightTeamId, rightTeamName, {
            offerId: offer.id,
            slotIndex: slot.slotIndex,
            slot,
            capContext,
            excludedPlayerIds:
                excluded.length > 0 ? excluded : undefined,
            referencePlayer,
        });
    };

    /**
     * Same as requestPickForSlot, but for the offering side of the
     * slot: opens the roster popup on the OFFER CREATOR's team so
     * the responder can override the offering player.
     *
     * Builds the same excluded list as above but on the offering
     * side, so a manager cannot pick a player who is already
     * committed to another offering slot of the same trade.
     */
    const requestOfferingPickForSlot = (
        slot: TradeOfferSlot,
    ) => {
        if (!onRequestOfferingPlayerPick) return;

        const excluded = buildExcludedOfferingIds(
            slot.slotIndex,
        );

        // -----------------------------------------------------------------
        // Cap projection context for the OFFERING side.
        //
        // Same shape as the responding side's context (built by
        // requestPickForSlot), with two differences:
        //
        //   - candidateSide: 'left' — the candidate joins the
        //     LEFT side of the cap context, which is always the
        //     offer creator. (Responding picks default to 'right'
        //     because they join the responder.)
        //
        //   - creatorOfferedSalary EXCLUDES the current offering
        //     player of this slot, because the candidate is
        //     REPLACING him, not adding to him. Whatever the
        //     creator had offered on this slot (via his own pick
        //     or via a previous override) is taken out first.
        //
        //   - responderOfferedSalaryExcludingCurrentSlot is the
        //     FULL responder salary. The candidate is not touching
        //     the responder's side, so nothing is excluded there.
        //
        // swapSides is passed through unchanged: the CARD renders
        // the responder on the LEFT and the creator on the RIGHT
        // in "Voir les offres", and the projection row mirrors
        // that layout.
        // -----------------------------------------------------------------
        const leftCapHit =
            offer.createdByFantasyTeamCapSalary;
        const rightCapHit = responderCapHit;

        const currentOfferingPlayerId =
            effectiveOfferingPlayerIdForSlot(slot);

        let existingOfferingSalary = 0;

        if (currentOfferingPlayerId != null) {
            // Prefer the creator's full roster entry (richer,
            // has EffectiveSalary applied). Fall back to the
            // offer DTO's own contract only when the roster
            // hasn't loaded AND the effective player is the
            // slot's own offering player.
            const entry = creatorRoster?.entries.find(
                (e) => e.playerId === currentOfferingPlayerId,
            );

            if (entry?.currentContract?.salary != null) {
                existingOfferingSalary =
                    entry.currentContract.salary;
            } else if (
                currentOfferingPlayerId ===
                slot.offeringPlayerId
            ) {
                existingOfferingSalary =
                    slot.offeringPlayerCurrentContract
                        ?.salary ?? 0;
            }
        }

        const capContext: TradeCapContext | undefined =
            leftCapHit != null &&
                rightCapHit != null &&
                seasonCap > 0
                ? {
                    leftTeamName:
                        offer.createdByFantasyTeamName,
                    leftTeamCapHit: leftCapHit,
                    rightTeamName,
                    rightTeamCapHit: rightCapHit,
                    seasonSalaryCap: seasonCap,
                    creatorOfferedSalary:
                        creatorOfferedSalary -
                        existingOfferingSalary,
                    responderOfferedSalaryExcludingCurrentSlot:
                        responderOfferedSalary,
                    candidateSide: 'left',
                    swapSides,
                }
                : undefined;

        onRequestOfferingPlayerPick(
            offer.createdByFantasyTeamId,
            offer.createdByFantasyTeamName,
            {
                offerId: offer.id,
                slotIndex: slot.slotIndex,
                slot,
                capContext,
                excludedPlayerIds:
                    excluded.length > 0 ? excluded : undefined,
                side: 'offering',
            },
        );
    };

    // ------------------------------------------------------------------
    // Header blocks
    //
    // The creator block and the responder block are declared as
    // standalone JSX values so the header row can render them in
    // either order without duplicating the markup. `swapSides` only
    // changes the order in which they appear. Both blocks are
    // declared as flex-1 so the "Nouvelle offre" badge stays
    // horizontally centered either way.
    // ------------------------------------------------------------------

    const creatorHeaderBlock = (
        <div className='flex min-w-0 flex-1 flex-col items-center justify-center gap-y-2'>
            {onOpenTeamRoster ? (
                <button
                    type='button'
                    onClick={() =>
                        onOpenTeamRoster(
                            offer.createdByFantasyTeamId,
                            offer.createdByFantasyTeamName,
                        )
                    }
                    className='max-w-full cursor-pointer truncate rounded px-3 py-0.5 text-center text-xs font-bold uppercase tracking-wider transition-all hover:brightness-110 md:text-sm'
                    style={TEAM_NAME_BUTTON_STYLE}
                >
                    {offer.createdByFantasyTeamName}
                </button>
            ) : (
                <div
                    className='max-w-full truncate rounded px-3 py-0.5 text-center text-xs font-bold uppercase tracking-wider md:text-sm'
                    style={TEAM_NAME_BUTTON_STYLE}
                >
                    {offer.createdByFantasyTeamName}
                </div>
            )}

            {showCreatorCapLine && (
                <TeamCapLine
                    baseCapSpace={creatorBaseCapSpace!}
                    adjustedCapSpace={creatorAdjustedCapSpace!}
                />
            )}
        </div>
    );

    const responderHeaderBlock = (
        <div className='flex min-w-0 flex-1 flex-col items-center justify-center gap-y-2'>
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
                        className='max-w-full cursor-pointer truncate rounded px-3 py-0.5 text-center text-xs font-bold uppercase tracking-wider transition-all hover:brightness-110 md:text-sm'
                        style={TEAM_NAME_BUTTON_STYLE}
                    >
                        {rightTeamName}
                    </button>
                ) : (
                    <div
                        className='max-w-full truncate rounded px-3 py-0.5 text-center text-xs font-bold uppercase tracking-wider md:text-sm'
                        style={TEAM_NAME_BUTTON_STYLE}
                    >
                        {rightTeamName}
                    </div>
                )
            ) : (
                <div className='w-full' aria-hidden='true' />
            )}

            {showRightTeam && showResponderCapLine && (
                <TeamCapLine
                    baseCapSpace={responderBaseCapSpace!}
                    adjustedCapSpace={responderAdjustedCapSpace!}
                />
            )}
        </div>
    );

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
            {offer.isMine && !hideInternalCancel && (
                <div
                    className='flex items-center justify-end gap-1.5 border-b px-3 py-2'
                    style={{
                        borderColor: 'rgba(0, 168, 255, 0.35)',
                        background: HEADER_GRADIENT,
                    }}
                >
                    {onEdit && (
                        <button
                            type='button'
                            onClick={onEdit}
                            disabled={busy}
                            className='cursor-pointer rounded border border-[#00E5FF] px-2 py-0.5 text-xs font-semibold text-[#00E5FF] transition-colors hover:bg-[#00E5FF]/15 disabled:opacity-50'
                        >
                            Modifier
                        </button>
                    )}

                    <button
                        type='button'
                        onClick={onCancel}
                        disabled={busy}
                        className='cursor-pointer rounded border border-destructive/40 px-2 py-0.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50'
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
                        className='relative flex items-center border-b py-1'
                        style={{
                            borderColor: 'rgba(0, 168, 255, 0.2)',
                        }}
                    >
                        {swapSides
                            ? responderHeaderBlock
                            : creatorHeaderBlock}

                        {/* ⇄ between the two team names. Moved here
                            from the middle of the slots area so the
                            exchange icon sits right at the header's
                            midpoint, above the divider. shrink-0 so
                            the two flex-1 team blocks stay equal
                            and the icon lands exactly centered. */}
                        <span
                            aria-hidden='true'
                            className='shrink-0 px-1 text-base leading-none text-[#00E5FF]'
                        >
                            ⇄
                        </span>

                        {swapSides
                            ? creatorHeaderBlock
                            : responderHeaderBlock}

                        {/* "Nouvelle offre" badge.
                            Absolutely positioned at the horizontal
                            center of the header row and at the same
                            vertical level as the two team-name
                            buttons (top-1 matches the parent's
                            py-1 so the badge's top edge lands on
                            the content-area top, exactly where the
                            team-name buttons sit).

                            Out of the flex flow on purpose: the two
                            team-name blocks stay flex-1 balanced,
                            the arrow stays dead center, and the
                            badge no longer pushes the layout to the
                            right.

                            pointer-events-none so the badge never
                            swallows a click meant for a team-name
                            button underneath it.

                            Rendered only for offers the user has
                            not created and has never seen before. */}
                        {offer.isNew && !offer.isMine && (
                            <span
                                className='pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 rounded px-1 py-0.5 text-[0.5rem] font-bold uppercase tracking-wider'
                                style={{
                                    backgroundColor: '#22C55E',
                                    color: '#04160A',
                                    boxShadow: 'inset 0 0 0 1px #86EFAC',
                                }}
                            >
                                Nouvelle offre
                            </span>
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

                        {visibleResponseSlots.map((slot, index) => {
                            const matches =
                                matchingPlayersBySlot[slot.slotIndex] ??
                                [];

                            const currentPick =
                                picks[slot.slotIndex] ?? null;

                            /*
                             * The two columns are declared as local
                             * JSX values so the row can render them
                             * in either order based on `swapSides`.
                             *
                             * Default (swapSides = false): offering
                             * column on the left, responding column
                             * on the right — matches the historical
                             * layout used by Reçues / Envoyées /
                             * publish preview.
                             *
                             * Voir les offres (swapSides = true):
                             * responding column on the left so the
                             * connected user (the responder) picks
                             * on the left side, offering column on
                             * the right.
                             */
                        

                            /**
 * Red "remove" button for the RESPONDING
 * side (the left card when swapSides is
 * true). Rendered inside the responding
 * player's own card, at the top-left of
 * the name row. Clicking it clears that
 * pick alone; the offering side is left
 * untouched.
 */
                            const respondingRemoveButton =
                                canRespond &&
                                    swapSides &&
                                    picks[slot.slotIndex] != null ? (
                                    <button
                                        type='button'
                                        aria-label='Retirer ce joueur'
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setPick(
                                                slot.slotIndex,
                                                null,
                                            );
                                        }}
                                        className='flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-[#EF4444] transition-colors hover:bg-[#DC2626]'
                                    >
                                        <svg
                                            viewBox='0 0 24 24'
                                            className='h-[10px] w-[10px]'
                                            fill='none'
                                            stroke='white'
                                            strokeWidth={4}
                                            strokeLinecap='round'
                                            aria-hidden='true'
                                        >
                                            <line
                                                x1='5'
                                                y1='12'
                                                x2='19'
                                                y2='12'
                                            />
                                        </svg>
                                    </button>
                                ) : undefined;

                            /**
                             * Red "remove" button for the OFFERING
                             * side (the right card when swapSides is
                             * true). Rendered inside the offering
                             * player's own card, at the top-right of
                             * the name row. Clicking it clears the
                             * offering side of the slot alone; the
                             * responding side is left untouched.
                             */
                            const offeringRemoveButton =
                                canRespond &&
                                    swapSides &&
                                    effectiveOfferingPlayerIdForSlot(
                                        slot,
                                    ) != null ? (
                                    <button
                                        type='button'
                                        aria-label='Retirer ce joueur'
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            clearOfferingForSlot(
                                                offer.id,
                                                slot.slotIndex,
                                            );
                                        }}
                                        className='flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-[#EF4444] transition-colors hover:bg-[#DC2626]'
                                    >
                                        <svg
                                            viewBox='0 0 24 24'
                                            className='h-[10px] w-[10px]'
                                            fill='none'
                                            stroke='white'
                                            strokeWidth={4}
                                            strokeLinecap='round'
                                            aria-hidden='true'
                                        >
                                            <line
                                                x1='5'
                                                y1='12'
                                                x2='19'
                                                y2='12'
                                            />
                                        </svg>
                                    </button>
                                ) : undefined;

                            const offeringColumn = (
                                <div className='flex min-w-0 flex-col items-center justify-start text-center'>
                                    {/*
                                     * No wrapper for the button
                                     * anymore: it is passed straight
                                     * into SlotPlayerBlock as
                                     * `topRightSlot`, which anchors it
                                     * to the name row's own bounding
                                     * box, not the wider stat table.
                                     */}
                                    <div className='flex flex-col items-center'>

                                        {(() => {
                                            const cleared =
                                                isOfferingCleared(
                                                    slot.slotIndex,
                                                );

                                            const effectiveId =
                                                effectiveOfferingPlayerIdForSlot(
                                                    slot,
                                                );

                                            const showingOverride =
                                                effectiveId != null &&
                                                !cleared &&
                                                effectiveId !==
                                                slot.offeringPlayerId;

                                            // CASE 1: an override player.
                                            if (showingOverride) {
                                                const overrideEntry =
                                                    creatorRoster?.entries.find(
                                                        (e) =>
                                                            e.playerId ===
                                                            effectiveId,
                                                    ) ?? null;

                                                if (!overrideEntry) {
                                                    return (
                                                        <div className='flex flex-col items-center gap-1'>
                                                            <span className='text-[0.65rem] font-bold uppercase tracking-wider text-[#00E5FF] md:text-xs'>
                                                                Joueur remplacé
                                                            </span>
                                                        </div>
                                                    );
                                                }

                                                return (
                                                    <SlotPlayerBlock
                                                        playerId={
                                                            overrideEntry.playerId
                                                        }
                                                        nhlPlayerId={
                                                            overrideEntry.nhlPlayerId
                                                        }
                                                        firstName={
                                                            overrideEntry.firstName
                                                        }
                                                        lastName={
                                                            overrideEntry.lastName
                                                        }
                                                        nhlTeam={
                                                            overrideEntry.nhlTeamAbbreviation
                                                        }
                                                        position={
                                                            overrideEntry.position
                                                        }
                                                        age={overrideEntry.age}
                                                        currentContract={
                                                            overrideEntry.currentContract
                                                        }
                                                        secondContract={
                                                            overrideEntry.secondContract
                                                        }
                                                        currentSeasonStats={
                                                            overrideEntry.currentSeason
                                                        }
                                                        lastSeasonStats={
                                                            overrideEntry.lastSeason
                                                        }
                                                        emptyLabel='Joueur remplacé'
                                                        bordered={canRespond}
                                                        onClick={
                                                            canRespond
                                                                ? () =>
                                                                    requestOfferingPickForSlot(
                                                                        slot,
                                                                    )
                                                                : undefined
                                                        }
                                                        topRightSlot={
                                                            offeringRemoveButton
                                                        }
                                                    />
                                                );
                                            }

                                            // CASE 2: the creator's own
                                            // offering player (no override,
                                            // not cleared).
                                            if (
                                                effectiveId != null &&
                                                !cleared
                                            ) {
                                                return (
                                                    <SlotPlayerBlock
                                                        playerId={
                                                            slot.offeringPlayerId
                                                        }
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
                                                        age={
                                                            slot.offeringPlayerAge
                                                        }
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
                                                        bordered={canRespond}
                                                        onClick={
                                                            canRespond
                                                                ? () =>
                                                                    requestOfferingPickForSlot(
                                                                        slot,
                                                                    )
                                                                : undefined
                                                        }
                                                        topRightSlot={
                                                            offeringRemoveButton
                                                        }
                                                    />
                                                );
                                            }

                                            // CASE 3: empty offering side
                                            // (cleared, or never set).
                                            if (canRespond) {
                                                return slot.slotIndex ===
                                                    firstEmptyOfferingIdx ? (
                                                    <button
                                                        type='button'
                                                        onClick={() =>
                                                            requestOfferingPickForSlot(
                                                                slot,
                                                            )
                                                        }
                                                        className='mt-1 w-fit cursor-pointer rounded bg-emerald-500 px-3 py-1 text-left text-xs font-semibold text-emerald-950 transition-colors hover:bg-emerald-400 md:text-sm'
                                                    >
                                                        Choisir un joueur
                                                    </button>
                                                ) : (
                                                    <div />
                                                );
                                            }

                                            // On response cards, an
                                            // empty offering side is
                                            // deliberately rendered as
                                            // nothing. The slot list has
                                            // already been filtered so a
                                            // slot only reaches here when
                                            // the responding side has
                                            // content, and pushing an
                                            // "Avis de recherche"
                                            // placeholder next to a real
                                            // responding player would be
                                            // misleading — the annonce's
                                            // demand is not what the
                                            // response is answering.
                                            if (isResponseCard) {
                                                return <div />;
                                            }

                                            return (
                                                <p className='text-[0.65rem] font-bold uppercase tracking-wider text-[#7DD3FC] md:text-xs'>
                                                    Avis de recherche
                                                </p>
                                            );
                                        })()}
                                    </div>
                                </div>
                            );

                            const respondingColumn = (
                                <div className='flex min-w-0 flex-col items-center justify-start text-center'>
                                    <div className='flex flex-col items-center'>
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
                                                bordered={canRespond}
                                                onClick={
                                                    canRespond &&
                                                        onRequestPlayerPick
                                                        ? () =>
                                                            requestPickForSlot(
                                                                slot,
                                                            )
                                                        : undefined
                                                }
                                                topLeftSlot={
                                                    respondingRemoveButton
                                                }
                                            />
                                        ) : isResponseCard ? (
                                            <div />
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
                                                slotIndex={slot.slotIndex}
                                                wouldBustCap={wouldBustCap}
                                                onChangeRequest={
                                                    onRequestPlayerPick &&
                                                        rightTeamId != null
                                                        ? () =>
                                                            requestPickForSlot(
                                                                slot,
                                                            )
                                                        : undefined
                                                }
                                                topLeftSlot={
                                                    respondingRemoveButton
                                                }
                                            />
                                        ) : (
                                            <>
                                                {/* Response picker: a
                                                        single button that
                                                        opens the roster
                                                        popup in pick mode.
                                                        Only shown when the
                                                        offer is not the
                                                        user's own and his
                                                        roster is loaded. */}
                                                {canRespond &&
                                                    slot.slotIndex ===
                                                    firstEmptyRespondingIdx && (
                                                        <button
                                                            type='button'
                                                            onClick={() =>
                                                                requestPickForSlot(
                                                                    slot,
                                                                )
                                                            }
                                                            disabled={
                                                                onRequestPlayerPick ==
                                                                null ||
                                                                rightTeamId ==
                                                                null
                                                            }
                                                            className='mt-1 w-fit cursor-pointer rounded bg-emerald-500 px-3 py-1 text-left text-xs font-semibold text-emerald-950 transition-colors hover:bg-emerald-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 md:text-sm'
                                                        >
                                                            Choisir un joueur
                                                        </button>
                                                    )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            );

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
                                    className={`relative grid grid-cols-[1fr_auto_1fr] items-stretch px-1 py-2 transition-colors ${onSlotClick
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
                                    {swapSides
                                        ? respondingColumn
                                        : offeringColumn}

                                    <div
                                        aria-hidden='true'
                                        className={SLOT_ARROW_COL}
                                    />

                                    {swapSides
                                        ? offeringColumn
                                        : respondingColumn}
                                </div>
                            );
                        })}

                        {/*
                         * Extra responding slots added on this tab.
                         *
                         * The responder clicked "Ajouter un joueur"
                         * one or more times. Each extra renders as a
                         * row with the responding player's picker on
                         * the left and a small "Retirer" button in
                         * the middle. There is no offering-side
                         * column because an extra has no counterpart
                         * on the original offer.
                         *
                         * Extras are only rendered on browse offers
                         * the connected user can respond to
                         * (`canRespond`), so swapSides is always
                         * true here and the responding column always
                         * sits on the left.
                         */}
                        {canRespond &&
                            extraResponderSlots.map((slotIndex) => {
                                const currentPick =
                                    picks[slotIndex] ?? null;

                                const entry =
                                    currentPick != null
                                        ? userRoster?.entries.find(
                                            (e) =>
                                                e.playerId ===
                                                currentPick,
                                        ) ?? null
                                        : null;

                                const overrideId =
                                    offeringOverrides[slotIndex] ??
                                    null;

                                /**
                                 * Red "remove" button for the
                                 * RESPONDING side of this extra.
                                 * Rendered inside the responding
                                 * player's card, at the top-left of
                                 * the name row. Clicking it clears
                                 * the responding pick; if that
                                 * leaves the extra empty on both
                                 * sides, the whole extra slot is
                                 * dropped.
                                 */
                                const respondingRemoveButton =
                                    currentPick != null ? (
                                        <button
                                            type='button'
                                            aria-label='Retirer ce joueur'
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                pickForSlot(
                                                    offer.id,
                                                    slotIndex,
                                                    null,
                                                );

                                                if (
                                                    overrideId == null ||
                                                    overrideId ===
                                                    CLEARED_OFFERING_SENTINEL
                                                ) {
                                                    removeExtraResponderSlot(
                                                        offer.id,
                                                        slotIndex,
                                                    );
                                                }
                                            }}
                                            className='flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-[#EF4444] transition-colors hover:bg-[#DC2626]'
                                        >
                                            <svg
                                                viewBox='0 0 24 24'
                                                className='h-[10px] w-[10px]'
                                                fill='none'
                                                stroke='white'
                                                strokeWidth={4}
                                                strokeLinecap='round'
                                                aria-hidden='true'
                                            >
                                                <line
                                                    x1='5'
                                                    y1='12'
                                                    x2='19'
                                                    y2='12'
                                                />
                                            </svg>
                                        </button>
                                    ) : undefined;

                                /**
                                 * Red "remove" button for the
                                 * OFFERING side of this extra.
                                 * Rendered inside the offering
                                 * player's card, at the top-right
                                 * of the name row. Clicking it
                                 * clears the offering override; if
                                 * that leaves the extra empty on
                                 * both sides, the whole extra slot
                                 * is dropped.
                                 */
                                const offeringRemoveButton =
                                    overrideId != null &&
                                        overrideId !==
                                        CLEARED_OFFERING_SENTINEL ? (
                                        <button
                                            type='button'
                                            aria-label='Retirer ce joueur'
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setOfferingOverrideForSlot(
                                                    offer.id,
                                                    slotIndex,
                                                    null,
                                                );

                                                if (currentPick == null) {
                                                    removeExtraResponderSlot(
                                                        offer.id,
                                                        slotIndex,
                                                    );
                                                }
                                            }}
                                            className='flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-[#EF4444] transition-colors hover:bg-[#DC2626]'
                                        >
                                            <svg
                                                viewBox='0 0 24 24'
                                                className='h-[10px] w-[10px]'
                                                fill='none'
                                                stroke='white'
                                                strokeWidth={4}
                                                strokeLinecap='round'
                                                aria-hidden='true'
                                            >
                                                <line
                                                    x1='5'
                                                    y1='12'
                                                    x2='19'
                                                    y2='12'
                                                />
                                            </svg>
                                        </button>
                                    ) : undefined;

                                return (
                                    <div
                                        key={`extra-${slotIndex}`}
                                        className='grid grid-cols-[1fr_auto_1fr] items-stretch px-1 py-2'
                                        style={{
                                            borderTop:
                                                '1px dashed rgba(0, 168, 255, 0.15)',
                                        }}
                                    >
                                        {/* ---- LEFT column: responding ---- */}
                                        <div className='flex min-w-0 flex-col items-center justify-center text-center'>
                                            <div className='flex flex-col items-center'>
                                                {entry ? (
                                                    <RespondingPlayerBlock
                                                        entry={entry}
                                                        matches={[]}
                                                        currentPick={
                                                            currentPick
                                                        }
                                                        onPick={() => { }}
                                                        slotIndex={slotIndex}
                                                        wouldBustCap={() =>
                                                            false
                                                        }
                                                        onChangeRequest={() =>
                                                            requestPickForSlot(
                                                                buildSyntheticExtraSlot(
                                                                    slotIndex,
                                                                ),
                                                            )
                                                        }
                                                        topLeftSlot={
                                                            respondingRemoveButton
                                                        }
                                                    />
                                                ) : slotIndex ===
                                                    firstEmptyRespondingIdx ? (
                                                    <button
                                                        type='button'
                                                        onClick={() =>
                                                            requestPickForSlot(
                                                                buildSyntheticExtraSlot(
                                                                    slotIndex,
                                                                ),
                                                            )
                                                        }
                                                        className='mt-1 w-fit cursor-pointer rounded bg-emerald-500 px-3 py-1 text-left text-xs font-semibold text-emerald-950 transition-colors hover:bg-emerald-400 focus:outline-none md:text-sm'
                                                    >
                                                        Choisir un joueur
                                                    </button>
                                                ) : (
                                                    <div />
                                                )}
                                            </div>
                                        </div>

                                        {/* ---- MIDDLE column: pure spacer.
                                             No button. Each side owns its
                                             own remove control. ---- */}
                                        <div className='flex w-5 items-center justify-center md:w-12' />

                                        {/* ---- RIGHT column: offering ---- */}
                                        <div className='flex min-w-0 flex-col items-center justify-center text-center'>
                                            <div className='flex flex-col items-center'>
                                                {overrideId != null &&
                                                    overrideId !==
                                                    CLEARED_OFFERING_SENTINEL ? (() => {
                                                        const overrideEntry =
                                                            creatorRoster?.entries.find(
                                                                (e) =>
                                                                    e.playerId ===
                                                                    overrideId,
                                                            ) ?? null;

                                                        if (!overrideEntry) {
                                                            return (
                                                                <div className='flex flex-col items-center gap-1'>
                                                                    <span className='text-[0.65rem] font-bold uppercase tracking-wider text-[#00E5FF] md:text-xs'>
                                                                        Joueur choisi
                                                                    </span>
                                                                </div>
                                                            );
                                                        }

                                                        return (
                                                            <SlotPlayerBlock
                                                                playerId={
                                                                    overrideEntry.playerId
                                                                }
                                                                nhlPlayerId={
                                                                    overrideEntry.nhlPlayerId
                                                                }
                                                                firstName={
                                                                    overrideEntry.firstName
                                                                }
                                                                lastName={
                                                                    overrideEntry.lastName
                                                                }
                                                                nhlTeam={
                                                                    overrideEntry.nhlTeamAbbreviation
                                                                }
                                                                position={
                                                                    overrideEntry.position
                                                                }
                                                                age={
                                                                    overrideEntry.age
                                                                }
                                                                currentContract={
                                                                    overrideEntry.currentContract
                                                                }
                                                                secondContract={
                                                                    overrideEntry.secondContract
                                                                }
                                                                currentSeasonStats={
                                                                    overrideEntry.currentSeason
                                                                }
                                                                lastSeasonStats={
                                                                    overrideEntry.lastSeason
                                                                }
                                                                emptyLabel='Joueur choisi'
                                                                bordered
                                                                onClick={() =>
                                                                    requestOfferingPickForSlot(
                                                                        buildSyntheticExtraSlot(
                                                                            slotIndex,
                                                                        ),
                                                                    )
                                                                }
                                                                topRightSlot={
                                                                    offeringRemoveButton
                                                                }
                                                            />
                                                        );
                                                    })() : slotIndex ===
                                                        firstEmptyOfferingIdx ? (
                                                    <button
                                                        type='button'
                                                        onClick={() =>
                                                            requestOfferingPickForSlot(
                                                                buildSyntheticExtraSlot(
                                                                    slotIndex,
                                                                ),
                                                            )
                                                        }
                                                        className='mt-1 w-fit cursor-pointer rounded bg-emerald-500 px-3 py-1 text-left text-xs font-semibold text-emerald-950 transition-colors hover:bg-emerald-400 focus:outline-none md:text-sm'
                                                    >
                                                        Choisir un joueur
                                                    </button>
                                                ) : (
                                                    <div />
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                    </div>
                </div>

                {/* Draft picks slot. Rendered between the player
                    slots and the note. Always expanded, two columns
                    (one per side).

                    LEFT column: the responder's side on a browse
                    offer (swapSides = true), the creator's side on a
                    response card or own offer (swapSides = false).

                    RIGHT column: the mirror.

                    On a browse offer (Voir les offres), both sides
                    are editable:
                      - left  = the responder's own picks he is
                                putting in the answer,
                      - right = the offer creator's picks, split
                                between the offer's own picks (locked,
                                already in the trade) and the picks
                                the responder is asking the creator
                                to add (removable).

                    On a response card or an own offer, both sides
                    are read-only server data. The right column on a
                    response card shows the responder's picks; the
                    left column shows the creator's picks including
                    the requested additions. */}
                {showPicksSlot && (
                    <div
                        className='grid grid-cols-[1fr_auto_1fr] items-stretch px-1 py-2'
                        style={{
                            borderTop:
                                '1px dashed rgba(0, 168, 255, 0.15)',
                        }}
                    >
                        {/* ---- LEFT column ---- */}
                        {swapSides ? (
                            // Browse offer: the responder's own picks,
                            // editable.
                            <div className='flex min-w-0 flex-col items-center justify-start text-center'>
                                <TradePicksSlot
                                    selectedPicks={responderPicks}
                                    availablePicks={
                                        responderAvailablePicks
                                    }
                                    editable={responderPicksEditable}
                                    onAddPick={(id) =>
                                        DraftPicks.addPick(
                                            DraftPicks.offerPicksKey(
                                                offer.id,
                                                'responder',
                                            ),
                                            id,
                                        )
                                    }
                                    onRemovePick={(id) =>
                                        DraftPicks.removePick(
                                            DraftPicks.offerPicksKey(
                                                offer.id,
                                                'responder',
                                            ),
                                            id,
                                        )
                                    }
                                />
                            </div>
                        ) : (
                            // Response card or own offer: the creator's
                            // side, read-only. Includes the offer's
                            // own picks plus any extra picks the
                            // responder requested (only present on
                            // response cards).
                            <div className='flex min-w-0 flex-col items-center justify-start text-center'>
                                <TradePicksSlot
                                    selectedPicks={[
                                        ...creatorPicks,
                                        ...(offer.requestedPicks ?? []),
                                    ]}
                                    availablePicks={[]}
                                    editable={false}
                                    lockedPickIds={[
                                        ...creatorPicks.map(
                                            (p) => p.id,
                                        ),
                                        ...(offer.requestedPicks ?? [])
                                            .map((p) => p.id),
                                    ]}
                                    onAddPick={() => {
                                        // Not reachable: editable is
                                        // false so TradePicksSlot does
                                        // not render the button.
                                    }}
                                    onRemovePick={() => {
                                        // Not reachable: editable is
                                        // false so no × is drawn.
                                    }}
                                />
                            </div>
                        )}

                        <div
                            aria-hidden='true'
                            className={SLOT_ARROW_COL}
                        />

                        {/* ---- RIGHT column ---- */}
                        {swapSides ? (
                            // Browse offer: the creator's side. The
                            // offer's own picks AND the requested
                            // additions are fully editable.
                            //
                            // Removing one of the offer's own picks
                            // records it in the removed-creator-picks
                            // store; the effective creator list
                            // subtracts it out. Removing a requested
                            // pick just drops it from the requested
                            // store. Re-adding a creator pick that
                            // was previously removed cancels the
                            // removal instead of adding to requested.
                            <div className='flex min-w-0 flex-col items-center justify-start text-center'>
                                <TradePicksSlot
                                    selectedPicks={[
                                        ...effectiveCreatorPicks,
                                        ...requestedDraftPickIds
                                            .map((id) =>
                                                creatorAvailablePicks.find(
                                                    (p) => p.id === id,
                                                ),
                                            )
                                            .filter(
                                                (
                                                    p,
                                                ): p is DraftPick =>
                                                    p != null,
                                            ),
                                    ]}
                                    availablePicks={
                                        creatorAvailablePicks
                                    }
                                    editable={canRespond}
                                    onAddPick={(id) => {
                                        const isCreatorOwnedPick =
                                            creatorPicks.some(
                                                (p) => p.id === id,
                                            );

                                        if (isCreatorOwnedPick) {
                                            // Re-adding a creator
                                            // pick that was previously
                                            // removed cancels the
                                            // removal.
                                            removeRemovedCreatorPick(
                                                offer.id,
                                                id,
                                            );
                                        } else {
                                            DraftPicks.addPick(
                                                DraftPicks.offerPicksKey(
                                                    offer.id,
                                                    'requested',
                                                ),
                                                id,
                                            );
                                        }
                                    }}
                                    onRemovePick={(id) => {
                                        const isCreatorOwnedPick =
                                            creatorPicks.some(
                                                (p) => p.id === id,
                                            );

                                        if (isCreatorOwnedPick) {
                                            addRemovedCreatorPick(
                                                offer.id,
                                                id,
                                            );
                                        } else {
                                            DraftPicks.removePick(
                                                DraftPicks.offerPicksKey(
                                                    offer.id,
                                                    'requested',
                                                ),
                                                id,
                                            );
                                        }
                                    }}
                                />
                            </div>
                        ) : (
                            // Response card or own offer: the
                            // responder's side, read-only. On own
                            // offers and previews this is typically
                            // empty; on response cards it is the
                            // responder's picks from the server.
                            <div className='flex min-w-0 flex-col items-center justify-start text-center'>
                                <TradePicksSlot
                                    selectedPicks={
                                        offer.respondingPicks ?? []
                                    }
                                    availablePicks={[]}
                                    editable={false}
                                    lockedPickIds={(
                                        offer.respondingPicks ?? []
                                    ).map((p) => p.id)}
                                    onAddPick={() => {
                                        // Not reachable: editable is
                                        // false.
                                    }}
                                    onRemovePick={() => {
                                        // Not reachable: editable is
                                        // false.
                                    }}
                                />
                            </div>
                        )}
                    </div>
                )}

                {/* The "Ajouter un joueur" button was removed. New
                    extra responding slots are appended automatically
                    by the useEffect that watches `extraResponderSlots`
                    above: once every base slot has a responding pick,
                    a trailing empty extra appears, and picking a
                    player on any trailing extra immediately creates
                    the next one. */}

                {offer.note && (
                    <p className='rounded-md border border-[#00A8FF]/25 bg-[#00A8FF]/5 px-2 py-1.5 text-sm italic text-[#FFC72C]'>
                        « {offer.note} »
                    </p>
                )}

                {/* Responder's optional message, matching the
                    "Message (optionnel)" field on the Créer card.
                    Only rendered on the "Voir les offres" side,
                    where the responder is building a reply. */}
                {canRespond && (
                    <div>
                        <label className='text-xs font-semibold uppercase tracking-wider text-[#7DD3FC]'>
                            Message (optionnel)
                        </label>
                        <textarea
                            value={responseNote}
                            onChange={(e) =>
                                setResponseNote(
                                    offer.id,
                                    e.target.value,
                                )
                            }
                            rows={2}
                            maxLength={1000}
                            placeholder='Ex : je peux ajouter un choix de repêchage si tu ajoutes un défenseur.'
                            className={`mt-1 ${inputClass}`}
                        />
                    </div>
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

                        <div className='flex flex-wrap items-stretch justify-center gap-1.5'>
                            <button
                                type='button'
                                disabled={respondBusy || !hasAnyPick}
                                onClick={handleResetPicks}
                                className='flex-1 cursor-pointer rounded-md border border-destructive/60 bg-transparent px-2 py-1 text-center text-xs font-bold uppercase tracking-wide text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40'
                            >
                                Réinitialiser
                            </button>

                            <button
                                type='button'
                                disabled={!hasAnyPick || respondBusy}
                                onClick={handleOffer}
                                className={`flex-1 rounded-md px-2 py-1 text-xs font-bold uppercase tracking-wide transition-colors ${hasAnyPick && !respondBusy
                                        ? 'cursor-pointer bg-emerald-500 text-emerald-950 hover:bg-emerald-400'
                                        : 'cursor-not-allowed bg-zinc-800 text-zinc-500'
                                    }`}
                            >
                                {respondBusy ? 'Envoi...' : 'Offrir'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Response action buttons (Contre-offre / Refuser /
                    Accepter): shown only when the parent wires at
                    least one callback AND the response is still
                    Pending. Once the response flips to Accepted,
                    this block disappears entirely and the gold
                    "OFFRE ACCEPTÉE" label below takes its place.
                    
                    The three buttons share the row equally via
                    flex-1, and the container's default
                    items-stretch makes the "Contre-offre" button
                    (smaller font, longer label) match the height
                    of the other two instead of being shorter. */}
                {(onCounterOffer || onAccept || onReject) &&
                    offer.status === 'Pending' && (
                        <div className='flex items-stretch justify-center gap-2 pt-1'>
                            {onCounterOffer && (
                                <button
                                    type='button'
                                    onClick={onCounterOffer}
                                    disabled={busy}
                                    className='flex-1 cursor-pointer rounded-lg border border-[#00C8FF]/60 bg-transparent px-2 py-2 text-xs font-bold uppercase tracking-wider text-[#00C8FF] transition-colors hover:bg-[#00A8FF]/10 disabled:cursor-not-allowed disabled:opacity-50'
                                >
                                    Contre-offre
                                </button>
                            )}

                            {onReject && (
                                <button
                                    type='button'
                                    onClick={onReject}
                                    disabled={busy}
                                    className='flex-1 cursor-pointer rounded-lg border border-destructive/60 bg-transparent px-2 py-2 text-sm font-bold uppercase tracking-wider text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50'
                                >
                                    Refuser
                                </button>
                            )}

                            {onAccept && (
                                <button
                                    type='button'
                                    onClick={onAccept}
                                    disabled={busy}
                                    className='flex-1 cursor-pointer rounded-lg bg-emerald-500 px-2 py-2 text-sm font-bold uppercase tracking-wider text-emerald-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50'
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
                    whole card reads as one accepted state.
                    
                    When `onCancelAcceptedTrade` is provided, an
                    "Annuler" button is rendered below the label so
                    either manager can withdraw his acceptance if
                    he changes his mind. Both panels pass this. */}
                {isAccepted && (
                    <div className='flex flex-col items-center gap-2 pt-1'>
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

                        {onCancelAcceptedTrade && (
                            <button
                                type='button'
                                onClick={onCancelAcceptedTrade}
                                disabled={busy}
                                className='cursor-pointer rounded-lg border border-destructive/60 bg-transparent px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50'
                            >
                                Annuler
                            </button>
                        )}
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
    capContext,
    pendingPickRestore,
    pendingDirectPickRestore,
    pendingPublishPickRestore,
    referencePlayerForRestore,
    currentPickedPlayerId,
    onClearPick,
    onAdd,
    isReference = false,
}: {
    entry: RosterEntry;
    teamId: number;
    teamName: string;
    positionFilter: PositionGroup;
    /**
     * Optional cap projection for the two sides of the trade.
     * When set, a new row is rendered under the contract row:
     * the left team's name and its projected cap hit (this
     * player added), then the right team's projected cap hit
     * (this player removed) and its name. Both numbers are
     * highlighted red when they exceed the season's salary cap.
     */
    capContext?: TradeCapContext;
    /**
     * When set, this row is running in pick mode and the player
     * Link must save this object to the popup-restore store on
     * click, so the popup reopens in pick mode after the user
     * comes back from the player page.
     */
    pendingPickRestore?: PendingPickContext;
        /**
      * Same as pendingPickRestore, but for the "Créer" tab's
      * direct-pick mode. Carries the slot index and side instead
      * of a full offer slot.
      */
        pendingDirectPickRestore?: PendingDirectPickContext;
        /**
         * Same as pendingPickRestore, but for the "Publier une
         * annonce" tab's pick mode. Carries the slot index, the
         * current pick, the locked position and the excluded player
         * ids.
         */
        pendingPublishPickRestore?: PendingPublishPickContext;
    /**
     * RosterEntry-shaped snapshot of the player on the OTHER side
     * of the trade slot, if any. Carried through every player
     * Link's restore payload so the popup reopens with its sticky
     * reference card still rendered after a PlayerPage round-trip.
     */
    referencePlayerForRestore?: RosterEntry | null;
    /**
     * Player id of the current pick in the slot on the side being
     * picked, or null when the side is empty. When this row's
     * player is the current pick, the green "Ajouter" button is
     * replaced by a red "Retirer" button.
     *
     * Read live from the draft store by MarketplacePage, so
     * clicking "Retirer" flips the row back to "Ajouter"
     * immediately, without closing the popup.
     */
    currentPickedPlayerId?: number | null;
    /**
     * Clears the current pick on the slot side. Only fires when
     * the row is showing the "Retirer" button.
     */
    onClearPick?: () => void;
    /**
  * When provided, renders a green "Ajouter" button on the left
  * of the player content. Used by the roster popup's pick mode
  * so the responder can add a player to the pending trade.
  */
    onAdd?: () => void;
    /**
     * True when this row is the sticky reference card showing the
     * player on the OTHER side of the trade slot. The row renders
     * with a lighter blue background so it visually stands apart
     * from the browsed team's own roster rows. Defaults to false.
     */
    isReference?: boolean;
}) {
    const currentContractLabel =
        contractLabel(entry.currentContract) ??
        compactSalary(entry.fantasySalary);

    const secondContractLabel = contractLabel(entry.secondContract);

    const isGoalie = toPositionGroup(entry.position) === 'G';

    /**
     * The player's cap contribution for the projection: his
     * current-season contract salary, or his fantasy salary as a
     * fallback. Same rule the offer card uses when summing a
     * side's offered salary.
     */
    const playerSalary =
        entry.currentContract?.salary ??
        entry.fantasySalary ??
        0;

    /**
   * Projected cap SPACE for each side once the trade closes with
   * this player picked in the current slot.
   *
   * The trade has two flows:
   *   - LEFT (creator) gives up every offered player on its
   *     slots and receives every responding player.
   *   - RIGHT (responder) gives up every responding player and
   *     receives every offered player.
   *
   * So each side's projected cap hit is:
   *   left  : leftTeamCapHit  - creatorOffered + responderOffered
   *   right : rightTeamCapHit - responderOffered + creatorOffered
   *
   * where `responderOffered` = responderOfferedExcludingCurrentSlot
   *                          + this candidate's salary.
   *
   * Cap space is then seasonSalaryCap - cap hit. Positive means
   * room left under the cap, negative means over the cap (and
   * renders red).
   *
   * Everything is null when capContext is undefined, in which
   * case the row below is not rendered at all.
   */
    /**
   * Which side the candidate is being picked for. Defaults to
   * 'right' — that is the Voir les offres case, where the pick
   * is always for the responder's side of the offer card.
   * Créer passes 'left' when the user is picking on the
   * connected team's side of a slot.
   */
    const candidateSide = capContext?.candidateSide ?? 'right';

    /**
     * Total salary the LEFT side is offering after the trade,
     * with the candidate's salary placed on whichever side he is
     * being picked for.
     */
    const leftOfferedTotal =
        capContext != null
            ? capContext.creatorOfferedSalary +
            (candidateSide === 'left' ? playerSalary : 0)
            : null;

    /**
     * Total salary the RIGHT side is offering after the trade,
     * with the candidate's salary placed on whichever side he is
     * being picked for.
     */
    const rightOfferedTotal =
        capContext != null
            ? capContext
                .responderOfferedSalaryExcludingCurrentSlot +
            (candidateSide === 'right' ? playerSalary : 0)
            : null;

    /**
     * Projected cap space for the left team after the trade:
     *   starting cap hit
     *     - what the left gives up
     *     + what the left receives
     * and the symmetric computation for the right.
     */
    const leftProjectedCapSpace =
        capContext != null &&
            leftOfferedTotal != null &&
            rightOfferedTotal != null
            ? capContext.seasonSalaryCap -
            (capContext.leftTeamCapHit -
                leftOfferedTotal +
                rightOfferedTotal)
            : null;

    const rightProjectedCapSpace =
        capContext != null &&
            leftOfferedTotal != null &&
            rightOfferedTotal != null
            ? capContext.seasonSalaryCap -
            (capContext.rightTeamCapHit -
                rightOfferedTotal +
                leftOfferedTotal)
            : null;

    const leftOverCap =
        leftProjectedCapSpace != null && leftProjectedCapSpace < 0;

    const rightOverCap =
        rightProjectedCapSpace != null && rightProjectedCapSpace < 0;

    /**
     * When the offer card that opened this popup is displaying the
     * responder on the LEFT (swapSides = true on the cap context),
     * the projection row must mirror that: the responder's team
     * name and projected space go on the left, the creator's on
     * the right.
     *
     * Only the visual positions flip. The math is unchanged —
     * `leftProjectedCapSpace` is still the offer creator's
     * projection, `rightProjectedCapSpace` is still the
     * responder's — because those are derived from
     * `capContext.leftTeamCapHit` / `capContext.rightTeamCapHit`
     * and the creator/responder offered-salary fields, none of
     * which change.
     */
    const swapSides = capContext?.swapSides === true;

    const displayLeftTeamName = swapSides
        ? capContext?.rightTeamName
        : capContext?.leftTeamName;

    const displayLeftSpace = swapSides
        ? rightProjectedCapSpace
        : leftProjectedCapSpace;

    const displayLeftOver = swapSides
        ? rightOverCap
        : leftOverCap;

    const displayRightTeamName = swapSides
        ? capContext?.leftTeamName
        : capContext?.rightTeamName;

    const displayRightSpace = swapSides
        ? leftProjectedCapSpace
        : rightProjectedCapSpace;

    const displayRightOver = swapSides
        ? leftOverCap
        : rightOverCap;

    return (
        <div
            className='relative rounded-md border px-2 py-2'
            style={{
                borderColor: isReference
                    ? 'rgba(239, 68, 68, 0.7)'
                    : 'rgba(0, 168, 255, 0.2)',
                backgroundColor: isReference
                    ? 'rgba(0, 168, 255, 0.24)'
                    : 'rgba(0, 168, 255, 0.03)',
            }}
        >
            {onClearPick != null &&
                currentPickedPlayerId != null &&
                entry.playerId === currentPickedPlayerId ? (
                    <button
                        type='button'
                        onClick={onClearPick}
                        className='absolute left-2 top-2 inline-flex h-[21.875px] shrink-0 cursor-pointer items-center justify-center rounded bg-red-600 px-1.5 text-[0.6rem] font-bold uppercase leading-none tracking-wide text-black transition-colors hover:bg-red-500 md:h-[25px] md:text-[0.65rem]'
                    >
                        Retirer
                    </button>
            ) : onAdd ? (
                    <button
                        type='button'
                        onClick={onAdd}
                        className={`absolute left-2 top-2 inline-flex h-[21.875px] shrink-0 cursor-pointer items-center justify-center rounded px-1.5 text-[0.6rem] font-bold uppercase leading-none tracking-wide transition-colors md:h-[25px] md:text-[0.65rem] ${capContext != null &&
                            (leftOverCap || rightOverCap)
                            ? 'bg-yellow-400 text-yellow-950 hover:bg-yellow-300'
                            : 'bg-emerald-500 text-emerald-950 hover:bg-emerald-400'
                            }`}
                    >
                        Ajouter
                    </button>
            ) : null}

            <div className='flex min-w-0 flex-col items-center text-center'>
                {/*
                 * The name row uses the exact same 7-column template
                 * as the StatLinesTable below it, so the team logo
                 * always sits at the same X as the GP column header,
                 * regardless of how long or short the player's name
                 * is. Column 1 (18%) is left empty as a spacer;
                 * column 2 (12%) holds the logo, centered like the GP
                 * header; columns 3-7 (70% total) hold the name,
                 * position and age.
                 *
                 * `w-full` is what makes the percentages meaningful:
                 * the parent is a flex column with `items-center`, so
                 * without it the grid would shrink to its content
                 * width and the logo would drift with the name length.
                 */}
                <div
                    className='grid w-full items-start text-left text-sm leading-none text-foreground md:text-base mb-1.5'
                    style={{
                        gridTemplateColumns:
                            '18% 12% 11% 11% 15% 22% 11%',
                    }}
                >
                    <div />

                    <div className='flex items-center justify-center'>
                        {entry.nhlTeamAbbreviation && (
                            /*
                             * Wrapper holds the layout footprint at
                             * 16x16 so the row's natural height is
                             * unchanged; the inner NhlTeamLogo is
                             * scaled 2x with `transform`, which
                             * does not affect layout. The rendered
                             * logo reads as 32px (16 * 2) but
                             * the card never grows.
                             */
                            <span
                                style={{
                                    width: 16,
                                    height: 16,
                                    display: 'inline-block',
                                    transform: 'scale(2)',
                                    transformOrigin: 'center',
                                    flexShrink: 0,
                                }}
                            >
                                <NhlTeamLogo
                                    abbreviation={
                                        entry.nhlTeamAbbreviation
                                    }
                                    size={16}
                                />
                            </span>
                        )}
                    </div>

                    <div className='col-span-5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5'>
                        <Link
                            to={`/joueurs/${entry.nhlPlayerId}`}
                            onClick={() =>
                                setMarketplacePopupRestore({
                                    teamId,
                                    teamName,
                                    positionFilter,
                                    pickContext: pendingPickRestore,
                                    directPickContext:
                                        pendingDirectPickRestore,
                                    publishPickContext:
                                        pendingPublishPickRestore,
                                    referencePlayer:
                                        referencePlayerForRestore,
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
                </div>

                <StatLinesTable
                    current={entry.currentSeason}
                    previous={entry.lastSeason}
                    isGoalie={isGoalie}
                    size='md'
                />

                {currentContractLabel && (
                    <div className='mt-1 flex flex-wrap items-center justify-center gap-x-1 text-sm leading-none font-semibold text-emerald-400 md:text-base'>
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

                {capContext &&
                    displayLeftSpace != null &&
                    displayRightSpace != null && (
                        <div className='mt-0.5 flex w-full items-center justify-between gap-2 text-sm font-semibold tabular-nums md:text-base'>
                            <div className='flex min-w-0 items-center gap-1'>
                                <span className='truncate text-[#00E5FF]'>
                                    {displayLeftTeamName}
                                </span>
                                <span
                                    aria-hidden='true'
                                    className='shrink-0 text-white'
                                >
                                    →
                                </span>
                                <span
                                    className={`shrink-0 ${displayLeftOver
                                        ? 'text-[#EF4444]'
                                        : 'text-white'
                                        }`}
                                >
                                    {compactSalary(
                                        displayLeftSpace,
                                    )}{' '}
                                    $
                                </span>
                            </div>

                            <div className='flex min-w-0 items-center gap-1'>
                                <span
                                    className={`shrink-0 ${displayRightOver
                                        ? 'text-[#EF4444]'
                                        : 'text-white'
                                        }`}
                                >
                                    {compactSalary(
                                        displayRightSpace,
                                    )}{' '}
                                    $
                                </span>
                                <span
                                    aria-hidden='true'
                                    className='shrink-0 text-white'
                                >
                                    ←
                                </span>
                                <span className='truncate text-[#00E5FF]'>
                                    {displayRightTeamName}
                                </span>
                            </div>
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
    lockedPosition,
    filterSlot,
    capContext,
    offerId,
    directPickInfo,
    publishPickInfo,
    currentPickedPlayerId,
    pinnedPlayerId,
    referencePlayer,
    excludedPlayerIds,
    onPlayerPick,
    onClearPick,
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
    /**
     * When set, the segmented position filter is locked to this
     * value: the matching button is highlighted and the other two
     * are disabled and greyed out. Used by the "pick a player for
     * this slot" flow, where the required position is dictated by
     * the offer slot.
     */
    lockedPosition?: PositionGroup;
    /**
     * When set, only players satisfying this slot's demand
     * criteria are shown. Same rules as the offer card's dropdown
     * (position already covered by `lockedPosition`; the other
     * four demand criteria are applied when their strict flag is
     * on and the corresponding value is set).
     */
    filterSlot?: TradeOfferSlot;
    /**
* Cap-projection context for the two sides of the trade, or
* undefined when the card did not carry cap data. When set,
* every player row shows a new row under its contract row
* with the left team's name and its projected cap hit (with
* this player added), and the right team's projected cap hit
* (with this player removed) and its name.
*/
    capContext?: TradeCapContext;
    /**
     * Id of the offer whose slot is currently being picked. Only
     * set in pick mode. Used to write the pending pick-restore
     * object that survives the PlayerPage round-trip, so the user
     * lands back on the same pick-mode popup he left.
     */
    offerId?: number;
        /**
   * Direct-pick info for the "Créer" tab. Set when the popup was
   * opened in pick mode from a DirectOfferCard slot. Used by the
   * player-name Links to save the pending pick-restore object
   * that survives the PlayerPage round-trip, so the user lands
   * back on the same pick-mode popup he left.
   *
   * Contains only the identifying info (slot index, side,
   * locked position, cap context, current pick). The onPick and
   * onClearPick callbacks are NOT carried here — MarketplacePage
   * rebuilds fresh ones on restore that write directly to the
   * draft store.
   */
        directPickInfo?: {
            slotIndex: number;
            side: 'offering' | 'target';
            lockedPosition?: PositionGroup;
            capContext?: TradeCapContext;
            currentPickedPlayerId?: number | null;
        };
        /**
         * Publish-pick info for the "Publier une annonce" tab. Set
         * when the popup was opened in pick mode from an
         * AddOfferPanel slot. Used by the player-name Links to save
         * the pending pick-restore object that survives the
         * PlayerPage round-trip.
         *
         * Same shape as the fields on publishPickContext except the
         * callbacks, which are rebuilt on restore.
         */
        publishPickInfo?: {
            slotIndex: number;
            currentPickedPlayerId: number | null;
            lockedPosition?: PositionGroup;
            excludedPlayerIds: number[];
        };
    /**
     * Player id of the current pick in the slot on the side being
     * picked, or null when the side is empty. Only meaningful in
     * Créer pick mode. Drives the "Retirer" button at the top of
     * the popup.
     */
    currentPickedPlayerId?: number | null;
    /**
     * When provided, every player row gets a green "Ajouter"
     * button on the left of its content. Clicking it calls this
     * callback with the player's id and closes the popup. Used by
     * the pick mode.
     */
    onPlayerPick?: (playerId: number) => void;
    /**
     * When provided together with currentPickedPlayerId, the
     * popup shows a red "Retirer <name>" button. Clicking it
     * calls this callback. Used by Créer to let the user remove
     * the current pick from the slot.
     */
    onClearPick?: () => void;
    /**
  * Player id to feature at the top of the roster list. When
  * set, the popup:
  *   - on first load, switches its position segmented control
  *     to that player's position;
  *   - renders that player's card above every section, while
  *     the rest of the list keeps its normal sort by fantasy
  *     points.
  *
  * Set by Créer to the currently picked player on the side
  * being picked, so a user who clicked on a picked player to
  * review or change the pick immediately sees that player.
  *
  * Undefined when the popup is not in a context that pins a
  * player (Voir les offres, plain browse, or an empty slot).
  */
        pinnedPlayerId?: number | null;
        /**
         * Player from the OTHER side of the trade slot. When set, the
         * popup renders his card in a fixed strip below the segmented
         * position filter and above the scrollable roster, so the user
         * can keep his stats and contracts in view while searching for
         * a player to offer in return.
         *
         * Null when the other side of the slot has no player picked —
         * the popup then opens exactly like before.
         */
        referencePlayer?: RosterEntry | null;
    /**
     * Player ids to hide from the roster list. Set by Créer to
     * every player already committed to another slot of the same
     * trade, on the same side, so the user cannot pick the same
     * player twice.
     *
     * Undefined or empty when there is nothing to exclude. The
     * pinned player is never included here by construction — the
     * caller skips the current slot.
     */
    excludedPlayerIds?: number[];
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
        useState<PositionGroup>(
            lockedPosition ?? initialPositionFilter ?? 'F',
        );

    /**
     * Tracks which pinned player's initial position filter has
     * already been applied, so the effect below only fires once
     * per pinned player. Without this, a later manual change of
     * the segmented control by the user would be overwritten.
     */
    const appliedPinnedFilterForRef = useRef<number | null>(null);

    /**
     * The player whose card is featured at the top of the list.
     * Derived from the roster once it loads. Null when no
     * pinnedPlayerId was passed, or when it does not match any
     * roster entry.
     */
    const pinnedEntry = useMemo(() => {
        if (pinnedPlayerId == null || !roster) return null;

        return (
            roster.entries.find(
                (e) => e.playerId === pinnedPlayerId,
            ) ?? null
        );
    }, [pinnedPlayerId, roster]);

    /**
     * Set form of excludedPlayerIds, for O(1) lookup inside the
     * sections filter. Null when nothing is excluded, so the
     * filter below can short-circuit on a plain reference check.
     */
    const excludedPlayerIdSet = useMemo(() => {
        if (
            excludedPlayerIds == null ||
            excludedPlayerIds.length === 0
        ) {
            return null;
        }

        return new Set(excludedPlayerIds);
    }, [excludedPlayerIds]);

    /**
     * On first load, switch the position segmented control to the
     * pinned player's position, so the user immediately sees his
     * group. If the popup is in pick mode and the slot dictated a
     * locked position, that wins — by construction it is the same
     * position as the pinned player, but using it keeps the
     * popup's behaviour explicit.
     *
     * Fires only once per pinned player; a subsequent manual
     * change of the segmented control by the user is respected.
     */
    useEffect(() => {
        if (!pinnedEntry) return;
        if (
            appliedPinnedFilterForRef.current ===
            pinnedEntry.playerId
        ) {
            return;
        }

        appliedPinnedFilterForRef.current =
            pinnedEntry.playerId;

        if (lockedPosition !== undefined) {
            setPositionFilter(lockedPosition);
        } else {
            setPositionFilter(
                toPositionGroup(pinnedEntry.position),
            );
        }
    }, [pinnedEntry, lockedPosition]);

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
            (entry) => {
                // The pinned player is rendered separately at the
                // top of the list, so exclude him here even when
                // he would otherwise match the filter.
                if (
                    pinnedEntry != null &&
                    entry.playerId === pinnedEntry.playerId
                ) {
                    return false;
                }

                // Hide players already committed to another slot
                // of the same trade, on the same side, so the user
                // cannot pick the same player twice.
                if (
                    excludedPlayerIdSet != null &&
                    excludedPlayerIdSet.has(entry.playerId)
                ) {
                    return false;
                }

                if (
                    toPositionGroup(entry.position) !==
                    positionFilter
                ) {
                    return false;
                }

                // In pick mode, the demand criteria on the offer
                // slot are applied as hard filters (same rules as
                // playerMatchesSlotDemand — each criterion is only
                // enforced when its strict flag is on and its
                // value is set). Position is a no-op here since
                // the position filter above already guarantees it.
                if (
                    filterSlot &&
                    !playerMatchesSlotDemand(entry, filterSlot)
                ) {
                    return false;
                }

                return true;
            },
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
    }, [
        roster,
        positionFilter,
        filterSlot,
        pinnedEntry,
        excludedPlayerIdSet,
    ]);

    /**
     * What the player-name Link saves to the popup-restore store
     * when the user clicks a player to open his page. When we are
     * in pick mode (offerId + filterSlot present), it also carries
     * the pick context so the popup reopens in pick mode on the
     * way back. In normal mode it is undefined and only the team
     * + position filter are restored.
     */
    /**
  * Effective cap context. The popup can be opened in pick mode
  * for either a Voir les offres slot (capContext prop) or a
  * Créer slot (directPickInfo.capContext). At most one is
  * ever set, so a nullish chain gives the right answer.
  */
    const effectiveCapContext =
        capContext ?? directPickInfo?.capContext;

    const pendingPickRestore: PendingPickContext | undefined =
        offerId != null && filterSlot != null
            ? {
                offerId,
                slotIndex: filterSlot.slotIndex,
                slot: filterSlot,
                capContext,
            }
            : undefined;

    const pendingDirectPickRestore: PendingDirectPickContext | undefined =
        directPickInfo != null
            ? {
                slotIndex: directPickInfo.slotIndex,
                side: directPickInfo.side,
                lockedPosition: directPickInfo.lockedPosition,
                capContext: directPickInfo.capContext,
            }
            : undefined;

    const pendingPublishPickRestore: PendingPublishPickContext | undefined =
        publishPickInfo != null
            ? {
                slotIndex: publishPickInfo.slotIndex,
                currentPickedPlayerId:
                    publishPickInfo.currentPickedPlayerId,
                lockedPosition: publishPickInfo.lockedPosition,
                excludedPlayerIds: publishPickInfo.excludedPlayerIds,
            }
            : undefined;

    /**
  * Renders one roster row with all the props shared by the
  * pinned card and the section cards. Kept as a helper so the
  * two render paths cannot drift apart.
  *
  * When `isReference` is true, the row is the sticky snapshot of
  * the player on the other side of the trade slot. It suppresses
  * the Ajouter/Retirer buttons (they only make sense for the
  * browsed team's own candidates) and the cap projection row (it
  * would simulate picking the reference player, which is
  * meaningless — he is not a candidate).
  */
    const renderRosterRow = (
        entry: RosterEntry,
        isReference = false,
    ) => (
        <RosterPlayerRow
            key={entry.id}
            entry={entry}
            teamId={teamId}
            teamName={teamName}
            positionFilter={positionFilter}
            capContext={
                isReference ? undefined : effectiveCapContext
            }
            pendingPickRestore={pendingPickRestore}
            pendingDirectPickRestore={pendingDirectPickRestore}
            pendingPublishPickRestore={pendingPublishPickRestore}
            referencePlayerForRestore={referencePlayer}
            currentPickedPlayerId={
                isReference ? undefined : currentPickedPlayerId
            }
            onClearPick={
                !isReference && onClearPick
                    ? () => {
                        onClearPick();
                        handleClose();
                    }
                    : undefined
            }
            onAdd={
                !isReference && onPlayerPick
                    ? () => {
                        onPlayerPick(entry.playerId);
                        handleClose();
                    }
                    : undefined
            }
            isReference={isReference}
        />
    );

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
                className='relative flex flex-col overflow-hidden rounded-lg'
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: '90vw',
                    height: '95vh',
                    maxWidth: '1400px',
                    maxHeight: '1500px',
                    backgroundColor: FRAME_BG,
                    border: `${OFFER_TUBE_PX}px solid ${OFFER_TUBE_COLOR}`,
                    boxShadow: [
                        `inset 0 0 0 1px ${OFFER_FILAMENT}`,
                        `inset 0 0 10px ${OFFER_BLOOM_NEAR}`,
                        `inset 0 0 28px ${OFFER_BLOOM_FAR}`,
                    ].join(', '),
                }}
            >
                {/*
                 * Fermer is a child of the popup, so `absolute`
                 * anchors to the popup's own top-right corner
                 * (not the viewport). z-10 keeps it above the
                 * header bar and the scrolling body.
                 */}
                <button
                    type='button'
                    onClick={handleClose}
                    className='absolute right-2 top-2 z-10 cursor-pointer rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-black transition-colors hover:bg-red-500'
                >
                    Fermer
                </button>

                <div
                    className='flex shrink-0 items-center justify-center border-b px-3 py-2'
                    style={{
                        borderColor: 'rgba(0, 168, 255, 0.35)',
                        background: HEADER_GRADIENT,
                    }}
                >
                    <span className='truncate text-xs font-bold uppercase tracking-wider text-white md:text-sm'>
                        {teamName}
                    </span>
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
                                disabled={
                                    lockedPosition !== undefined &&
                                    lockedPosition !== 'F'
                                }
                                title={
                                    lockedPosition !== undefined &&
                                        lockedPosition !== 'F'
                                        ? 'Position verrouillée par l’offre'
                                        : undefined
                                }
                                className={`whitespace-nowrap rounded-full px-3 py-0.5 font-semibold transition-colors ${lockedPosition !== undefined &&
                                        lockedPosition !== 'F'
                                        ? 'cursor-not-allowed text-[#A6ECFF]/30'
                                        : positionFilter === 'F'
                                            ? 'cursor-pointer bg-[#00E5FF] text-[#080D1A]'
                                            : 'cursor-pointer bg-transparent text-[#A6ECFF] hover:text-white'
                                    }`}
                            >
                                Attaquants
                            </button>

                            <button
                                type='button'
                                onClick={() => setPositionFilter('D')}
                                disabled={
                                    lockedPosition !== undefined &&
                                    lockedPosition !== 'D'
                                }
                                title={
                                    lockedPosition !== undefined &&
                                        lockedPosition !== 'D'
                                        ? 'Position verrouillée par l’offre'
                                        : undefined
                                }
                                className={`whitespace-nowrap rounded-full px-3 py-0.5 font-semibold transition-colors ${lockedPosition !== undefined &&
                                        lockedPosition !== 'D'
                                        ? 'cursor-not-allowed text-[#A6ECFF]/30'
                                        : positionFilter === 'D'
                                            ? 'cursor-pointer bg-[#00E5FF] text-[#080D1A]'
                                            : 'cursor-pointer bg-transparent text-[#A6ECFF] hover:text-white'
                                    }`}
                            >
                                Défenseurs
                            </button>

                            <button
                                type='button'
                                onClick={() => setPositionFilter('G')}
                                disabled={
                                    lockedPosition !== undefined &&
                                    lockedPosition !== 'G'
                                }
                                title={
                                    lockedPosition !== undefined &&
                                        lockedPosition !== 'G'
                                        ? 'Position verrouillée par l’offre'
                                        : undefined
                                }
                                className={`whitespace-nowrap rounded-full px-3 py-0.5 font-semibold transition-colors ${lockedPosition !== undefined &&
                                        lockedPosition !== 'G'
                                        ? 'cursor-not-allowed text-[#A6ECFF]/30'
                                        : positionFilter === 'G'
                                            ? 'cursor-pointer bg-[#00E5FF] text-[#080D1A]'
                                            : 'cursor-pointer bg-transparent text-[#A6ECFF] hover:text-white'
                                    }`}
                            >
                                Gardiens
                            </button>
                        </div>
                    </div>
                </div>

                {referencePlayer && (
                    <div
                        className='shrink-0 border-b px-2 py-2 md:px-3'
                        style={{
                            borderColor: 'rgba(0, 168, 255, 0.2)',
                        }}
                    >
                        <div className='mb-1 text-center text-[0.55rem] font-bold uppercase tracking-widest text-[#EF4444] md:text-[0.6rem]'>
                            Joueur de l'autre équipe
                        </div>
                        {renderRosterRow(referencePlayer, true)}
                    </div>
                )}

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

                    {!loading &&
                        !error &&
                        sections.length === 0 &&
                        pinnedEntry == null && (
                            <p className='py-4 text-center text-sm text-muted-foreground'>
                                {roster != null &&
                                    roster.entries.length > 0
                                    ? 'Aucun joueur à ce poste.'
                                    : 'Aucun joueur dans cette équipe.'}
                            </p>
                        )}

                    {pinnedEntry && (
                        <div className='mb-3'>
                            {renderRosterRow(pinnedEntry)}
                        </div>
                    )}

                    {sections.map((section, sIdx) => (
                        <div
                            key={`${section.status}-${sIdx}`}
                            className={sIdx > 0 ? 'mt-3' : ''}
                        >
                            <div className='mb-2 flex justify-center'>
                                <span className='px-3 py-0.5 text-sm font-bold uppercase tracking-widest text-[#00E5FF] md:text-base'>
                                    {rosterStatusSectionLabel(
                                        section.status,
                                    )}
                                </span>
                            </div>

                            <div className='space-y-2'>
                                {section.entries.map((entry) =>
                                    renderRosterRow(entry),
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>,
        document.body,
    );
}

// ---------------------------------------------------------------------
// Direct offer team picker (Créer tab)
//
// Custom dropdown that replaces the native <select> for the "Offrir à"
// field. A native select cannot be styled when its options list is
// expanded — the OS renders that popup — so matching the MonEquipePage
// team picker requires a custom button + portaled-style panel pair.
// The trigger keeps the cyan-bg + aura look; the expanded panel is
// class-for-class the same as MonEquipePage's picker.
// ---------------------------------------------------------------------

function DirectOfferTeamPicker({
    teams,
    selectedTeamId,
    excludedTeamId,
    onSelect,
    openToken,
}: {
    teams: FantasyTeam[];
    selectedTeamId: string;
    excludedTeamId: number | null;
    onSelect: (id: string) => void;
    /**
     * When this token changes to a non-zero value, the picker
     * opens. Used by DirectOfferCard's right-side "Choisir un
     * gestionnaire" button so a user who has not selected a
     * target team yet is guided back to the picker.
     */
    openToken?: number;
}) {
    const [open, setOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement | null>(null);

    const selectedTeam = teams.find(
        (t) => String(t.id) === selectedTeamId,
    );

    /**
     * Last token value the effect has already reacted to.
     *
     * Initialized to the current token so the effect does NOT
     * fire on mount: opening the picker on mount would mean the
     * dropdown pops open every time the user comes back to the
     * Créer tab, since the token remains non-zero after the
     * first bump. The effect should only open the picker when
     * the token INCREASES from its previous value.
     */
    const lastOpenTokenRef = useRef(openToken ?? 0);

    // React to external open requests. Only fires when the token
    // increases, so a remount with an unchanged non-zero token
    // does not re-open the picker. Opens the picker and scrolls
    // its wrapper into view, so the user sees the dropdown even
    // if he was scrolled down on a phone.
    useEffect(() => {
        const next = openToken ?? 0;

        if (next <= lastOpenTokenRef.current) return;

        lastOpenTokenRef.current = next;
        setOpen(true);

        wrapperRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
        });
    }, [openToken]);

    useEffect(() => {
        if (!open) return;

        function onDocMouseDown(e: MouseEvent) {
            const target = e.target as Node;
            if (wrapperRef.current?.contains(target)) return;
            setOpen(false);
        }

        function onDocKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') setOpen(false);
        }

        document.addEventListener('mousedown', onDocMouseDown);
        document.addEventListener('keydown', onDocKeyDown);

        return () => {
            document.removeEventListener(
                'mousedown',
                onDocMouseDown,
            );
            document.removeEventListener('keydown', onDocKeyDown);
        };
    }, [open]);

    const visibleTeams = teams.filter(
        (t) => t.id !== excludedTeamId,
    );

    return (
        <div
            ref={wrapperRef}
            className='relative w-full max-w-[10rem] min-w-0 scroll-mt-[calc(var(--header-height,4rem)+0.5rem)]'
        >
            <button
                id='direct-offer-team'
                type='button'
                aria-haspopup='listbox'
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className='flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-0.5 text-center text-xs font-semibold focus:outline-none'
                style={{
                    backgroundColor: '#22D3EE',
                    color: '#1D1B61',
                    border: '1px solid #00E5FF',
                    filter:
                        'drop-shadow(0 0 6px rgba(0, 229, 255, 0.85)) drop-shadow(0 0 14px rgba(0, 229, 255, 0.4))',
                }}
            >
                <span className='min-w-0 flex-1 truncate'>
                    {selectedTeam
                        ? selectedTeam.name
                        : '— Choisir un gestionnaire —'}
                </span>
                <span
                    aria-hidden='true'
                    className='shrink-0 text-[0.7rem]'
                >
                    ▼
                </span>
            </button>

            {open && (
                <ul
                    role='listbox'
                    className='absolute left-0 right-0 z-40 mt-1 max-h-72 overflow-y-auto rounded-lg border border-[#00E5FF]/50 bg-[#0F1626] shadow-[0_0_20px_rgba(0,229,255,0.35),0_8px_24px_rgba(0,0,0,0.6)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                >
                    {visibleTeams.map((t) => {
                        const isSelected =
                            String(t.id) === selectedTeamId;

                        return (
                            <li key={t.id}>
                                <button
                                    type='button'
                                    role='option'
                                    aria-selected={isSelected}
                                    onClick={() => {
                                        onSelect(String(t.id));
                                        setOpen(false);
                                    }}
                                    className={`w-full cursor-pointer border-b border-[#00E5FF]/15 px-4 py-2.5 text-center text-lg font-semibold transition-colors last:border-b-0 ${isSelected
                                            ? 'bg-[#00E5FF]/20 text-[#00E5FF]'
                                            : 'text-foreground hover:bg-[#00E5FF]/10 hover:text-[#00E5FF]'
                                        }`}
                                >
                                    {t.name}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------
// Direct offer card (Créer tab)
// ---------------------------------------------------------------------

interface DirectOfferSlot {
    offeringPlayerId: number | null;
    targetPlayerId: number | null;
}

/**
 * Payload the DirectOfferCard sends up when the user clicks a
 * "Choisir un joueur" button. MarketplacePage stores it on
 * `rosterPopupTeam.directPickContext` so the roster popup opens
 * in pick mode for the right team, slot and side.
 *
 * `lockedPosition` is set when the OTHER side of the same slot
 * already has a player: in that case the popup's segmented
 * control is locked to that player's position and the user can
 * only pick a player of the same position. When the other side
 * is empty, `lockedPosition` is undefined and the user may pick
 * any position.
 */
interface DirectOfferPickRequest {
    teamId: number;
    teamName: string;
    slotIndex: number;
    side: 'offering' | 'target';
    lockedPosition?: PositionGroup;
    /**
     * Cap projection context for the two teams in the trade. Only
     * built when both teams' cap hits are known and the season
     * cap is set. Undefined otherwise, and the popup simply does
     * not render the projection rows.
     */
    capContext?: TradeCapContext;
    /**
     * Full roster entry of the player already picked on the OTHER
     * side of this slot, if any. Forwarded to the roster popup so
     * it can render a sticky reference card above the browsed
     * team's list. Null when the other side of the slot is empty.
     */
    referencePlayer?: RosterEntry | null;
    /**
     * Player id of the current pick in this slot on this side, or
     * null when the side is empty. Drives the "Retirer" button in
     * the popup.
     */
    currentPickedPlayerId: number | null;
    onPick: (playerId: number) => void;
    /**
     * Clears the current pick on this slot side. Fires the same
     * kind of store write that onPick does, but sets the field to
     * null instead of a player id.
     */
    onClearPick: () => void;
}

function DirectOfferCard({
    connectedTeamId,
    connectedTeamName,
    targetTeamId,
    targetTeamName,
    onOpenTeamRoster,
    onRequestPlayerPick,
    onRequestTargetTeam,
    onCancel,
    onSubmitted,
}: {
    connectedTeamId: number;
    connectedTeamName: string;
    targetTeamId: number | null;
    targetTeamName: string | null;
    onOpenTeamRoster: (teamId: number, teamName: string) => void;
    onRequestPlayerPick: (req: DirectOfferPickRequest) => void;
    onRequestTargetTeam: () => void;
    onCancel?: () => void;
    onSubmitted?: () => void;
}) {
    const [connectedRoster, setConnectedRoster] =
        useState<TeamRoster | null>(null);
    const [targetRoster, setTargetRoster] =
        useState<TeamRoster | null>(null);

    /**
    * Local submit state for the "Offrir" call. `submitting`
    * disables the button while the request is in flight,
    * `submitSuccess` / `submitError` render the small banner
    * above the action row.
    */
    const [submitting, setSubmitting] = useState(false);
    const [submitSuccess, setSubmitSuccess] =
        useState<string | null>(null);
    const [submitError, setSubmitError] =
        useState<string | null>(null);

    /**
     * True while the Analyse popup is open. Currently renders only
     * the skeleton (frame + header + Fermer button); the body will
     * be filled in later.
     */
    const [showAnalyse, setShowAnalyse] = useState(false);

    /**
     * Active sub-tab inside the Analyse popup.
     *   'stats'    → player stats comparison
     *   'contracts' → contracts / cap projection
     */
    const [analyseSubView, setAnalyseSubView] = useState<
        'stats' | 'contracts'
    >('stats');

    /**
     * Slots and note come from the module-level draft store so
     * they survive a PlayerPage round-trip (user opens a player
     * from the pick roster popup and comes back). See
     * directOfferState.ts for the full rationale.
     */
    const directDraft = useSyncExternalStore(
        subscribeToDirectOfferDraft,
        getDirectOfferDraft,
    );
    const slots = directDraft.slots;
    const note = directDraft.note;

    /**
  * Ensures the slots array always has a trailing empty slot the
  * user can use to start a new trade pair.
  *
  * This is what replaced the "Ajouter un joueur" button on the
  * Créer tab. As soon as EITHER side of the last slot gets a
  * player, a fresh empty slot is appended, so the user always
  * has one "Choisir un joueur" chooser per side to work with
  * (see the first-empty-per-side rendering further down).
  *
  * Reads `d.slots` from the store rather than the captured
  * value, so a double-invocation in React strict mode cannot
  * append the same slot twice. When the last slot is empty on
  * both sides the effect is a no-op, which is what makes it
  * converge.
  */
    useLayoutEffect(() => {
        updateDirectOfferDraft((d) => {
            if (d.slots.length === 0) {
                return {
                    ...d,
                    slots: [
                        {
                            offeringPlayerId: null,
                            targetPlayerId: null,
                        },
                    ],
                };
            }

            const last = d.slots[d.slots.length - 1];

            if (
                last.offeringPlayerId != null ||
                last.targetPlayerId != null
            ) {
                return {
                    ...d,
                    slots: [
                        ...d.slots,
                        {
                            offeringPlayerId: null,
                            targetPlayerId: null,
                        },
                    ],
                };
            }

            return d;
        });
    }, [slots]);

    // Fetch the connected user's roster once.
    useEffect(() => {
        let cancelled = false;

        getTeamRoster(connectedTeamId)
            .then((data) => {
                if (!cancelled) setConnectedRoster(data);
            })
            .catch(() => {
                if (!cancelled) setConnectedRoster(null);
            });

        return () => {
            cancelled = true;
        };
    }, [connectedTeamId]);

    // Fetch the target team's roster whenever the selection changes.
    useEffect(() => {
        if (targetTeamId == null) {
            setTargetRoster(null);
            return;
        }

        let cancelled = false;

        getTeamRoster(targetTeamId)
            .then((data) => {
                if (!cancelled) setTargetRoster(data);
            })
            .catch(() => {
                if (!cancelled) setTargetRoster(null);
            });

        return () => {
            cancelled = true;
        };
    }, [targetTeamId]);

    // Fast lookup for the picked players' roster entries.
    // Declared BEFORE the salary memos below because those read
    // from these maps.
    const entriesById = useMemo(() => {
        const map = new Map<number, RosterEntry>();
        if (connectedRoster) {
            for (const e of connectedRoster.entries) {
                map.set(e.playerId, e);
            }
        }
        return map;
    }, [connectedRoster]);

    const targetEntriesById = useMemo(() => {
        const map = new Map<number, RosterEntry>();
        if (targetRoster) {
            for (const e of targetRoster.entries) {
                map.set(e.playerId, e);
            }
        }
        return map;
    }, [targetRoster]);

    // -----------------------------------------------------------------
    // Draft picks ("Ajouter des choix de repêchage")
    //
    // The Créer tab has two sides, so it has two pick lists: one on
    // the connected user's team (offering) and one on the target
    // team. Each list is stored under its own key in the module-level
    // picks store, which lets it survive a PlayerPage round-trip.
    //
    // Selected pick ids come from the store; the full DraftPick
    // objects come from a getTeamDraftPicks call against each team,
    // fetched once when the corresponding team is known.
    // -----------------------------------------------------------------

    const [connectedAvailablePicks, setConnectedAvailablePicks] =
        useState<DraftPick[]>([]);

    const [targetAvailablePicks, setTargetAvailablePicks] =
        useState<DraftPick[]>([]);

    const connectedPickIds = useSyncExternalStore(
        DraftPicks.subscribeToPicks,
        () => DraftPicks.getPicks(DraftPicks.DIRECT_OFFERING_KEY),
    );

    const targetPickIds = useSyncExternalStore(
        DraftPicks.subscribeToPicks,
        () => DraftPicks.getPicks(DraftPicks.DIRECT_TARGET_KEY),
    );

    // Fetch the connected team's picks once.
    useEffect(() => {
        let cancelled = false;

        getTeamDraftPicks(connectedTeamId)
            .then((data) => {
                if (!cancelled) setConnectedAvailablePicks(data);
            })
            .catch(() => {
                if (!cancelled) setConnectedAvailablePicks([]);
            });

        return () => {
            cancelled = true;
        };
    }, [connectedTeamId]);

    // Fetch the target team's picks whenever the target changes.
    useEffect(() => {
        if (targetTeamId == null) {
            setTargetAvailablePicks([]);
            return;
        }

        let cancelled = false;

        getTeamDraftPicks(targetTeamId)
            .then((data) => {
                if (!cancelled) setTargetAvailablePicks(data);
            })
            .catch(() => {
                if (!cancelled) setTargetAvailablePicks([]);
            });

        return () => {
            cancelled = true;
        };
    }, [targetTeamId]);

    const connectedSelectedPicks = useMemo(
        () =>
            connectedPickIds
                .map((id) =>
                    connectedAvailablePicks.find((p) => p.id === id),
                )
                .filter((p): p is DraftPick => p != null),
        [connectedPickIds, connectedAvailablePicks],
    );

    const targetSelectedPicks = useMemo(
        () =>
            targetPickIds
                .map((id) =>
                    targetAvailablePicks.find((p) => p.id === id),
                )
                .filter((p): p is DraftPick => p != null),
        [targetPickIds, targetAvailablePicks],
    );

    // Clear the target-side picks when the target team changes.
    //
    // Track the previous team id in a ref so the effect does NOT
    // fire on the initial mount: a remount after a PlayerPage
    // round-trip must preserve the restored target picks, which
    // belong to the still-selected team.
    const prevTargetTeamIdRef = useRef<number | null>(targetTeamId);

    useEffect(() => {
        if (prevTargetTeamIdRef.current === targetTeamId) {
            return;
        }

        prevTargetTeamIdRef.current = targetTeamId;
        DraftPicks.clearPicks(DraftPicks.DIRECT_TARGET_KEY);
    }, [targetTeamId]);

    const seasonSalaryCap =
        connectedRoster?.futureCapBySeason[0]?.salaryCap ?? 0;

    const connectedCapHit = connectedRoster?.capSalary ?? 0;
    const connectedBaseCapSpace = seasonSalaryCap - connectedCapHit;

    const targetCapHit = targetRoster?.capSalary ?? 0;
    const targetBaseCapSpace = seasonSalaryCap - targetCapHit;

    // Sum of the current-season contract salaries picked on each
    // side. Same rule as the "Voir les offres" offer card: when a
    // trade happens, the left side gives up whatever the left picks
    // are worth, and the right side gives up whatever the right
    // picks are worth.
    const connectedOfferedSalary = useMemo(() => {
        let sum = 0;
        for (const slot of slots) {
            if (slot.offeringPlayerId != null) {
                const entry = entriesById.get(slot.offeringPlayerId);
                const salary = entry?.currentContract?.salary;
                if (salary != null) sum += salary;
            }
        }
        return sum;
    }, [slots, entriesById]);

    const targetOfferedSalary = useMemo(() => {
        let sum = 0;
        for (const slot of slots) {
            if (slot.targetPlayerId != null) {
                const entry = targetEntriesById.get(slot.targetPlayerId);
                const salary = entry?.currentContract?.salary;
                if (salary != null) sum += salary;
            }
        }
        return sum;
    }, [slots, targetEntriesById]);

    // Adjusted cap space after the trade: each side gives up what
    // it's offering and gains what the other side is offering.
    const connectedAdjustedCapSpace =
        connectedBaseCapSpace +
        connectedOfferedSalary -
        targetOfferedSalary;

    const targetAdjustedCapSpace =
        targetBaseCapSpace +
        targetOfferedSalary -
        connectedOfferedSalary;

    /**
  * Number of slots with a player picked on the connected user's
  * side, and on the target team's side. A direct offer must be
  * a 1-for-1, 2-for-2, etc.: every player given up on one side
  * must be matched by a player on the other.
  *
  * NOTE: there is deliberately NO cap-violation gate on this
  * card. Managers can send a direct offer that pushes either
  * team over the salary cap; the projected cap values on the
  * card header still show the impact in red when a side goes
  * negative, but nothing is blocked.
  */
    const connectedPickedCount = useMemo(() => {
        let count = 0;
        for (const slot of slots) {
            if (slot.offeringPlayerId != null) count++;
        }
        return count;
    }, [slots]);

    const targetPickedCount = useMemo(() => {
        let count = 0;
        for (const slot of slots) {
            if (slot.targetPlayerId != null) count++;
        }
        return count;
    }, [slots]);

    /**
  * True when no player has been picked on either side.
  */
    const noPlayersSelected =
        connectedPickedCount === 0 && targetPickedCount === 0;

    /**
     * True when at least one draft pick is selected on either
     * side. A direct offer can be picks-only, in which case it is
     * valid with zero players on both sides.
     */
    const hasAnyPick =
        connectedPickIds.length > 0 || targetPickIds.length > 0;

    /**
     * Single "cannot offer" flag:
     *
     *   - noPlayersSelected && !hasAnyPick → nothing has been
     *     drafted at all (no players, no picks). Rejected.
     *
     * Unbalanced player counts and one-sided slots are allowed:
     * the two managers can agree on a trade where one side gives
     * more players than the other, or where a slot carries a
     * player on only one side.
     *
     * Cap violations are intentionally NOT blocking. A manager can
     * send a direct offer that puts either team over the cap; the
     * other manager decides whether to accept. The red cap line on
     * the header is a warning, not a gate.
     *
     * The "Offrir" button is disabled while this is true, and
     * `handleOffer` re-checks it defensively so a stray activation
     * can never slip a submission through.
     */
    const offerDisabled =
        noPlayersSelected && !hasAnyPick;

    // NOTE: the "clear target picks on target team change" logic
    // used to live here as an effect on [targetTeamId]. It is now
    // handled inline by the picker's onSelect in MarketplacePage,
    // because the effect fired on every mount as well, which wiped
    // restored picks when the user came back from a PlayerPage.

    function updateSlot(
        idx: number,
        patch: Partial<DirectOfferSlot>,
    ) {
        updateDirectOfferDraft((d) => ({
            ...d,
            slots: d.slots.map((sl, i) =>
                i === idx ? { ...sl, ...patch } : sl,
            ),
        }));
    }

    function handleReset() {
        // Keep the selected target team: the user is starting a
        // new offer to the SAME manager he picked before. Only
        // the players, the picks and the message are cleared.
        resetDirectOfferSlotsAndNote();
        DraftPicks.clearDirectPicks();
        setSubmitSuccess(null);
        setSubmitError(null);
    }

    async function handleOffer() {
        // Defensive guard: the button is already disabled while
        // `offerDisabled` is true, but a stray activation (keyboard,
        // automation, or a future change that re-wires the click
        // handler) must never be able to submit a completely empty
        // trade. Cap violations are allowed.
        if (offerDisabled) return;
        if (targetTeamId == null) return;
        if (submitting) return;

        // Defensive guard against self-targeting. The picker
        // excludes the user's own team and MarketplacePage coerces
        // a stale selection back to null, but a future code path
        // (a new entry point, a store bug, a race) must not be
        // able to submit a "trade with yourself" and rely on the
        // backend to reject it. The backend already refuses it;
        // surfacing the error here as a clear client-side message
        // gives the user a better experience and keeps the
        // invariant visible in the UI layer too.
        if (targetTeamId === connectedTeamId) {
            setSubmitError(
                'Vous ne pouvez pas vous envoyer une offre à vous-même.',
            );
            return;
        }

        // Build the request from the filled slots. A slot is kept
        // as long as it carries a player on at least one side, so
        // unbalanced and one-sided slots reach the backend. A slot
        // with neither side filled is dropped.
        //
        // It is possible for requestSlots to be empty when the
        // offer is picks-only; that is valid and the backend
        // accepts it.
        const requestSlots = slots
            .filter(
                (s) =>
                    s.offeringPlayerId != null ||
                    s.targetPlayerId != null,
            )
            .map((s) => ({
                connectedPlayerId: s.offeringPlayerId,
                targetPlayerId: s.targetPlayerId,
            }));

        if (requestSlots.length === 0) return;

        setSubmitting(true);
        setSubmitError(null);
        setSubmitSuccess(null);

        try {
            const result = await createDirectOffer({
                targetTeamId,
                slots: requestSlots,
                note: note.trim() === '' ? null : note.trim(),
                connectedDraftPickIds: connectedPickIds.slice(),
                targetDraftPickIds: targetPickIds.slice(),
            });

            if (result.success) {
                setSubmitSuccess(result.message);

                // Reset the slots, the picks and the note. The
                // selected target team is deliberately kept so the
                // user can fire off another offer to the same
                // manager without re-selecting him.
                resetDirectOfferSlotsAndNote();
                DraftPicks.clearDirectPicks();

                // Notify the parent. The Reçues panel's
                // "Contre-offre" workflow uses this to reject the
                // original response and refresh the list.
                onSubmitted?.();
            } else {
                setSubmitError(result.message);
            }
        } catch (err) {
            setSubmitError(
                err instanceof Error
                    ? err.message
                    : 'Erreur lors de l\'envoi.',
            );
        } finally {
            setSubmitting(false);
        }
    }

    /**
     * First empty slot index per side. The "Choisir un joueur"
     * chooser renders ONLY on that slot for each side, so the user
     * always sees exactly one chooser per side regardless of how
     * many slots exist. Slots beyond the first empty on a given
     * side render as an empty cell.
     */
    const firstEmptyLeftIdx = slots.findIndex(
        (s) => s.offeringPlayerId == null,
    );
    const firstEmptyRightIdx = slots.findIndex(
        (s) => s.targetPlayerId == null,
    );

    return (
        <article
            className='relative overflow-hidden rounded-lg'
            style={{
                backgroundColor: FRAME_BG,
                border: `${OFFER_TUBE_PX}px solid ${OFFER_TUBE_COLOR}`,
                boxShadow: [
                    `inset 0 0 0 1px ${OFFER_FILAMENT}`,
                    `inset 0 0 10px ${OFFER_BLOOM_NEAR}`,
                    `inset 0 0 28px ${OFFER_BLOOM_FAR}`,
                ].join(', '),
            }}
        >
            <div className='space-y-3 p-2 md:p-3'>
                {/* Header: connected team (left) + target (right) */}
                <div>
                    <div
                        className='flex items-center border-b py-1'
                        style={{
                            borderColor: 'rgba(0, 168, 255, 0.2)',
                        }}
                    >
                        {/* Left: connected user's team */}
                        <div className='flex min-w-0 flex-1 flex-col items-center justify-center gap-y-2'>
                            <button
                                type='button'
                                onClick={() =>
                                    onOpenTeamRoster(
                                        connectedTeamId,
                                        connectedTeamName,
                                    )
                                }
                                className='max-w-full cursor-pointer truncate rounded px-3 py-0.5 text-center text-xs font-bold uppercase tracking-wider transition-all hover:brightness-110 md:text-sm'
                                style={TEAM_NAME_BUTTON_STYLE}
                            >
                                {connectedTeamName}
                            </button>

                            {seasonSalaryCap > 0 &&
                                connectedRoster != null && (
                                    <TeamCapLine
                                        baseCapSpace={
                                            connectedBaseCapSpace
                                        }
                                        adjustedCapSpace={
                                            connectedAdjustedCapSpace
                                        }
                                    />
                                )}
                        </div>

                        {/* ⇄ between the two team names. Moved here
                            from the slot's middle column so the
                            exchange icon sits right at the header's
                            midpoint, above the divider. shrink-0 so
                            the two flex-1 team blocks stay equal
                            and the icon lands exactly centered. */}
                        <span
                            aria-hidden='true'
                            className='shrink-0 px-1 text-base leading-none text-[#00E5FF]'
                        >
                            ⇄
                        </span>

                        {/* Right: target team */}
                        <div className='flex min-w-0 flex-1 flex-col items-center justify-center gap-y-2'>
                            {targetTeamName && targetTeamId != null ? (
                                <button
                                    type='button'
                                    onClick={() =>
                                        onOpenTeamRoster(
                                            targetTeamId,
                                            targetTeamName,
                                        )
                                    }
                                    className='max-w-full cursor-pointer truncate rounded px-3 py-0.5 text-center text-xs font-bold uppercase tracking-wider transition-all hover:brightness-110 md:text-sm'
                                    style={TEAM_NAME_BUTTON_STYLE}
                                >
                                    {targetTeamName}
                                </button>
                            ) : (
                                <div
                                    className='w-full'
                                    aria-hidden='true'
                                />
                            )}

                            {targetTeamName &&
                                targetRoster != null &&
                                seasonSalaryCap > 0 && (
                                    <TeamCapLine
                                        baseCapSpace={
                                            targetBaseCapSpace
                                        }
                                        adjustedCapSpace={
                                            targetAdjustedCapSpace
                                        }
                                    />
                                )}
                        </div>
                    </div>

                    {/* Slots */}
                    <div className='relative'>
                        <div
                            aria-hidden='true'
                            className='pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 border-l'
                            style={{
                                borderColor:
                                    'rgba(0, 168, 255, 0.35)',
                            }}
                        />

                        {slots.map((slot, idx) => {
                            const leftPicked =
                                slot.offeringPlayerId != null
                                    ? entriesById.get(
                                        slot.offeringPlayerId,
                                    ) ?? null
                                    : null;

                            const rightPicked =
                                slot.targetPlayerId != null
                                    ? targetEntriesById.get(
                                        slot.targetPlayerId,
                                    ) ?? null
                                    : null;

                            const targetPickerDisabled =
                                targetTeamId == null ||
                                targetTeamName == null;

                            /**
* Salary of one picked player for the
* cap context, or 0 when the pick is
* empty or the entry cannot be found.
* Same lookup rule the salary memos use.
*/
                            const salaryOfLeftPick = (
                                playerId: number | null,
                            ): number => {
                                if (playerId == null) return 0;
                                const entry = entriesById.get(playerId);
                                if (!entry) return 0;
                                return (
                                    entry.currentContract?.salary ??
                                    entry.fantasySalary ??
                                    0
                                );
                            };

                            const salaryOfRightPick = (
                                playerId: number | null,
                            ): number => {
                                if (playerId == null) return 0;
                                const entry =
                                    targetEntriesById.get(playerId);
                                if (!entry) return 0;
                                return (
                                    entry.currentContract?.salary ??
                                    entry.fantasySalary ??
                                    0
                                );
                            };

                            /**
                             * Builds the cap projection context for
                             * a pick on the given side. Returns
                             * undefined when the season cap or
                             * either team's cap hit is unknown — in
                             * that case the popup simply does not
                             * render the projection rows.
                             *
                             * The "current slot's own pick" is
                             * excluded from the total so the popup
                             * treats the candidate as REPLACING the
                             * current pick, not adding on top of it.
                             */
                            const buildCapContext = (
                                forSide: 'left' | 'right',
                            ): TradeCapContext | undefined => {
                                if (
                                    seasonSalaryCap <= 0 ||
                                    connectedRoster == null ||
                                    targetRoster == null ||
                                    targetTeamName == null
                                ) {
                                    return undefined;
                                }

                                const existingLeftPickSalary =
                                    salaryOfLeftPick(
                                        slot.offeringPlayerId,
                                    );

                                const existingRightPickSalary =
                                    salaryOfRightPick(
                                        slot.targetPlayerId,
                                    );

                                if (forSide === 'left') {
                                    return {
                                        leftTeamName:
                                            connectedTeamName,
                                        leftTeamCapHit:
                                            connectedCapHit,
                                        rightTeamName:
                                            targetTeamName,
                                        rightTeamCapHit:
                                            targetCapHit,
                                        seasonSalaryCap,
                                        creatorOfferedSalary:
                                            connectedOfferedSalary -
                                            existingLeftPickSalary,
                                        responderOfferedSalaryExcludingCurrentSlot:
                                            targetOfferedSalary,
                                        candidateSide: 'left',
                                    };
                                }

                                return {
                                    leftTeamName: connectedTeamName,
                                    leftTeamCapHit: connectedCapHit,
                                    rightTeamName: targetTeamName,
                                    rightTeamCapHit: targetCapHit,
                                    seasonSalaryCap,
                                    creatorOfferedSalary:
                                        connectedOfferedSalary,
                                    responderOfferedSalaryExcludingCurrentSlot:
                                        targetOfferedSalary -
                                        existingRightPickSalary,
                                    candidateSide: 'right',
                                };
                            };

                            /**
                             * Opens the roster popup in pick mode for
                             * the LEFT (offering) side of this slot,
                             * on the connected user's team.
                             *
                             * If the RIGHT side already has a
                             * player, his position dictates the only
                             * position the picker can show — the
                             * popup's segmented control is locked to
                             * that position. Otherwise the user can
                             * pick any position.
                             */
                            const handleLeftClick = () => {
                                onRequestPlayerPick({
                                    teamId: connectedTeamId,
                                    teamName: connectedTeamName,
                                    slotIndex: idx,
                                    side: 'offering',
                                    // No locked position: the user
                                    // can pick a player of any
                                    // position, regardless of what
                                    // the other side of the slot
                                    // already has.
                                    capContext:
                                        buildCapContext('left'),
                                    referencePlayer: rightPicked,
                                    currentPickedPlayerId:
                                        slot.offeringPlayerId,
                                    onPick: (playerId) =>
                                        updateSlot(idx, {
                                            offeringPlayerId:
                                                playerId,
                                        }),
                                    onClearPick: () =>
                                        updateSlot(idx, {
                                            offeringPlayerId:
                                                null,
                                        }),
                                });
                            };

                            /**
   * Same as handleLeftClick, but for the
   * RIGHT (target) side of this slot. The
   * popup opens on the target team and the
   * position is locked to the left side's
   * pick when the left side has one.
   *
   * Guarded by targetPickerDisabled: if
   * the target team has not been selected
   * yet, there is nothing to open.
   */
                            const handleRightClick = () => {
                                if (
                                    targetTeamId == null ||
                                    targetTeamName == null
                                ) {
                                    return;
                                }

                                onRequestPlayerPick({
                                    teamId: targetTeamId,
                                    teamName: targetTeamName,
                                    slotIndex: idx,
                                    side: 'target',
                                    // No locked position: the user
                                    // can pick a player of any
                                    // position, regardless of what
                                    // the other side of the slot
                                    // already has.
                                    capContext:
                                        buildCapContext('right'),
                                    referencePlayer: leftPicked,
                                    currentPickedPlayerId:
                                        slot.targetPlayerId,
                                    onPick: (playerId) =>
                                        updateSlot(idx, {
                                            targetPlayerId:
                                                playerId,
                                        }),
                                    onClearPick: () =>
                                        updateSlot(idx, {
                                            targetPlayerId:
                                                null,
                                        }),
                                });
                            };

                            /**
                             * Per-player remove circles, matching
                             * the "Voir les offres" card. The left
                             * circle sits at the top-left of the
                             * left player's name box and clears
                             * ONLY that side; the right circle
                             * sits at the top-right and clears
                             * ONLY that side. Removing a player
                             * does not drop the slot itself —
                             * only the middle red X does that.
                             */
                            const leftRemoveButton = (
                                <button
                                    type='button'
                                    aria-label='Retirer ce joueur'
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        updateSlot(idx, {
                                            offeringPlayerId:
                                                null,
                                        });
                                    }}
                                    className='flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-[#EF4444] transition-colors hover:bg-[#DC2626]'
                                >
                                    <svg
                                        viewBox='0 0 24 24'
                                        className='h-[10px] w-[10px]'
                                        fill='none'
                                        stroke='white'
                                        strokeWidth={4}
                                        strokeLinecap='round'
                                        aria-hidden='true'
                                    >
                                        <line
                                            x1='5'
                                            y1='12'
                                            x2='19'
                                            y2='12'
                                        />
                                    </svg>
                                </button>
                            );

                            const rightRemoveButton = (
                                <button
                                    type='button'
                                    aria-label='Retirer ce joueur'
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        updateSlot(idx, {
                                            targetPlayerId:
                                                null,
                                        });
                                    }}
                                    className='flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-[#EF4444] transition-colors hover:bg-[#DC2626]'
                                >
                                    <svg
                                        viewBox='0 0 24 24'
                                        className='h-[10px] w-[10px]'
                                        fill='none'
                                        stroke='white'
                                        strokeWidth={4}
                                        strokeLinecap='round'
                                        aria-hidden='true'
                                    >
                                        <line
                                            x1='5'
                                            y1='12'
                                            x2='19'
                                            y2='12'
                                        />
                                    </svg>
                                </button>
                            );

                            return (
                                <div
                                    key={idx}
                                    className='grid min-h-[5.625rem] grid-cols-[1fr_auto_1fr] items-stretch px-1 py-2'
                                    style={{
                                        borderTop:
                                            idx > 0
                                                ? '1px dashed rgba(0, 168, 255, 0.15)'
                                                : undefined,
                                    }}
                                >
                                    {/* LEFT: offering player. Empty
                                        state shows the position
                                        label + EmptyPlayerPicker.
                                        Picked state shows the
                                        RespondingPlayerBlock pattern
                                        (green-bordered name that
                                        acts as the dropdown trigger)
                                        with the stat/contract block
                                        below — same as Voir les
                                        offres. */}
                                    <div className='flex min-w-0 flex-col items-center justify-center text-center'>
                                        {leftPicked ? (
                                            <RespondingPlayerBlock
                                                entry={leftPicked}
                                                matches={[]}
                                                currentPick={
                                                    slot.offeringPlayerId
                                                }
                                                onPick={() => { }}
                                                slotIndex={idx}
                                                wouldBustCap={() => false}
                                                onChangeRequest={
                                                    handleLeftClick
                                                }
                                                topLeftSlot={
                                                    leftRemoveButton
                                                }
                                            />
                                        ) : idx === firstEmptyLeftIdx ? (
                                            <button
                                                type='button'
                                                onClick={
                                                    handleLeftClick
                                                }
                                                className='w-fit cursor-pointer rounded bg-emerald-500 px-3 py-1 text-xs font-semibold text-emerald-950 transition-colors hover:bg-emerald-400 md:text-sm'
                                            >
                                                Choisir un joueur
                                            </button>
                                        ) : (
                                            <div />
                                        )}

                                    </div>

                                    <div
                                        aria-hidden='true'
                                        className={`flex items-center justify-center ${SLOT_ARROW_COL}`}
                                    />

                                    {/* RIGHT: target player — same
                                        two-state pattern. Before a
                                        target team is selected the
                                        EmptyPlayerPicker is force-
                                        disabled and shows the
                                        placeholder "Choisir un
                                        gestionnaire". */}
                                    <div className='flex min-w-0 flex-col items-center justify-center text-center'>
                                        {rightPicked ? (
                                            <RespondingPlayerBlock
                                                entry={rightPicked}
                                                matches={[]}
                                                currentPick={
                                                    slot.targetPlayerId
                                                }
                                                onPick={() => { }}
                                                slotIndex={idx}
                                                wouldBustCap={() => false}
                                                onChangeRequest={
                                                    targetPickerDisabled
                                                        ? undefined
                                                        : handleRightClick
                                                }
                                                topRightSlot={
                                                    rightRemoveButton
                                                }
                                            />
                                        ) : idx === firstEmptyRightIdx ? (
                                            <button
                                                type='button'
                                                onClick={
                                                    targetPickerDisabled
                                                        ? onRequestTargetTeam
                                                        : handleRightClick
                                                }
                                                className='w-fit cursor-pointer rounded bg-emerald-500 px-3 py-1 text-xs font-semibold text-emerald-950 transition-colors hover:bg-emerald-400 md:text-sm'
                                            >
                                                {targetPickerDisabled
                                                    ? 'Choisir un gestionnaire'
                                                    : 'Choisir un joueur'}
                                            </button>
                                        ) : (
                                            <div />
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Draft picks slot. Two columns: the connected user's
                    picks on the left, the target team's picks on the
                    right. Both sides are always editable, so both
                    "Ajouter un choix" buttons are visible from the
                    start. */}
                <div
                    className='grid grid-cols-[1fr_auto_1fr] items-stretch px-1 py-2'
                    style={{
                        borderTop:
                            '1px dashed rgba(0, 168, 255, 0.15)',
                    }}
                >
                    <div className='flex min-w-0 flex-col items-center justify-start text-center'>
                        <TradePicksSlot
                            selectedPicks={connectedSelectedPicks}
                            availablePicks={
                                connectedAvailablePicks
                            }
                            editable
                            onAddPick={(id) =>
                                DraftPicks.addPick(
                                    DraftPicks.DIRECT_OFFERING_KEY,
                                    id,
                                )
                            }
                            onRemovePick={(id) =>
                                DraftPicks.removePick(
                                    DraftPicks.DIRECT_OFFERING_KEY,
                                    id,
                                )
                            }
                        />
                    </div>

                    <div
                        aria-hidden='true'
                        className={SLOT_ARROW_COL}
                    />

                    <div className='flex min-w-0 flex-col items-center justify-start text-center'>
                        <TradePicksSlot
                            selectedPicks={targetSelectedPicks}
                            availablePicks={
                                targetAvailablePicks
                            }
                            editable={
                                targetTeamId != null &&
                                targetTeamName != null
                            }
                            onAddPick={(id) =>
                                DraftPicks.addPick(
                                    DraftPicks.DIRECT_TARGET_KEY,
                                    id,
                                )
                            }
                            onRemovePick={(id) =>
                                DraftPicks.removePick(
                                    DraftPicks.DIRECT_TARGET_KEY,
                                    id,
                                )
                            }
                        />
                    </div>
                </div>

                {/* The "Ajouter un joueur" button was removed. New
                    trade pairs are appended automatically by the
                    useEffect that watches `slots` above: once the
                    trailing empty slot becomes fully filled, a fresh
                    empty slot with a "Choisir un joueur" on both
                    sides is added below it. */}

                {/* Message (same style as Publier une annonce) */}
                <div>
                    <label className='text-xs font-semibold uppercase tracking-wider text-[#7DD3FC]'>
                        Message (optionnel)
                    </label>
                    <textarea
                        value={note}
                        onChange={(e) =>
                            updateDirectOfferDraft((d) => ({
                                ...d,
                                note: e.target.value,
                            }))
                        }
                        rows={2}
                        maxLength={1000}
                        placeholder='Ex : je cherche un jeune défenseur, je peux ajouter un choix de repêchage.'
                        className={`mt-1 ${inputClass}`}
                    />
                </div>

                {/* Success / error banners, matching the browse
                    tab's "Offrir" feedback pattern. */}
                {submitSuccess && (
                    <p className='w-full rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-center text-xs text-emerald-400'>
                        {submitSuccess}
                    </p>
                )}

                {submitError && (
                    <p className='w-full rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-center text-xs text-destructive'>
                        {submitError}
                    </p>
                )}

                {/* Action row — Retour (optional) / Analyse / Réinitialiser / Offrir */}
                <div className='flex items-stretch gap-1.5'>
                    {onCancel && (
                        <button
                            type='button'
                            disabled={submitting}
                            onClick={onCancel}
                            className='flex-1 cursor-pointer rounded-md border border-white/40 bg-transparent px-2 py-1 text-center text-xs font-bold uppercase tracking-wide text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40'
                        >
                            Retour
                        </button>
                    )}

                    <button
                        type='button'
                        disabled={submitting}
                        onClick={() => setShowAnalyse(true)}
                        className='flex-1 cursor-pointer rounded-md border border-[#00C8FF] bg-transparent px-2 py-1 text-center text-xs font-bold uppercase tracking-wide text-[#00C8FF] transition-colors hover:bg-[#00A8FF]/10 disabled:cursor-not-allowed disabled:opacity-40'
                    >
                        Analyse
                    </button>

                    <button
                        type='button'
                        disabled={submitting}
                        onClick={handleReset}
                        className='flex-1 cursor-pointer rounded-md border border-destructive/60 bg-transparent px-2 py-1 text-center text-xs font-bold uppercase tracking-wide text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40'
                    >
                        Réinitialiser
                    </button>

                    <button
                        type='button'
                        disabled={offerDisabled || submitting}
                        onClick={handleOffer}
                        className={`flex-1 rounded-md px-2 py-1 text-xs font-bold uppercase tracking-wide transition-colors ${offerDisabled || submitting
                            ? 'cursor-not-allowed bg-zinc-800 text-zinc-500'
                            : 'cursor-pointer bg-emerald-500 text-emerald-950 hover:bg-emerald-400'
                            }`}
                    >
                        {submitting ? '...' : 'Offrir'}
                    </button>
                </div>
            </div>

            {showAnalyse &&
                createPortal(
                    <div
                        className='fixed inset-0 z-[100] flex items-center justify-center p-4'
                        style={{ backgroundColor: 'rgba(8, 13, 26, 0.85)' }}
                        onClick={() => setShowAnalyse(false)}
                        role='dialog'
                        aria-modal='true'
                        aria-label='Analyse'
                    >
                        <div
                            className='relative flex flex-col overflow-hidden rounded-lg'
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                width: '90vw',
                                height: '95vh',
                                maxWidth: '1400px',
                                maxHeight: '1500px',
                                backgroundColor: FRAME_BG,
                                border: `${OFFER_TUBE_PX}px solid ${OFFER_TUBE_COLOR}`,
                                boxShadow: [
                                    `inset 0 0 0 1px ${OFFER_FILAMENT}`,
                                    `inset 0 0 10px ${OFFER_BLOOM_NEAR}`,
                                    `inset 0 0 28px ${OFFER_BLOOM_FAR}`,
                                ].join(', '),
                            }}
                        >
                            <button
                                type='button'
                                onClick={() => setShowAnalyse(false)}
                                className='absolute right-2 top-2 z-10 cursor-pointer rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-black transition-colors hover:bg-red-500'
                            >
                                Fermer
                            </button>

                            <div
                                className='flex shrink-0 items-center justify-center border-b px-3 py-2'
                                style={{
                                    borderColor: 'rgba(0, 168, 255, 0.35)',
                                    background: HEADER_GRADIENT,
                                }}
                            >
                                <span className='truncate text-xs font-bold uppercase tracking-wider text-white md:text-sm'>
                                    Analyse
                                </span>
                            </div>

                            {/* Segmented sub-toggle: same design as the
                                main marketplace toggle (Marché /
                                Créer / Reçues / Envoyées). */}
                            <div className='shrink-0 px-3 pt-3'>
                                <div
                                    className='flex w-full items-center rounded-full border border-[#00A8FF] bg-[#050A18] p-0.5'
                                    style={{
                                        boxShadow:
                                            '0 0 5px rgba(0, 168, 255, 0.5), 0 0 10px rgba(0, 168, 255, 0.28), 0 0 16px rgba(0, 168, 255, 0.1), inset 0 0 5px rgba(0, 168, 255, 0.1)',
                                    }}
                                >
                                    <button
                                        type='button'
                                        onClick={() =>
                                            setAnalyseSubView('stats')
                                        }
                                        className={`flex-1 cursor-pointer whitespace-nowrap rounded-full px-1.5 py-0.5 text-[0.85rem] font-bold transition-all duration-200 sm:px-3 sm:text-base ${analyseSubView === 'stats'
                                                ? 'bg-white text-[#1D1B61]'
                                                : 'bg-transparent text-[#F2F5FA] hover:bg-[#00A8FF]/15 hover:text-white'
                                            }`}
                                        style={
                                            analyseSubView === 'stats'
                                                ? {
                                                    boxShadow:
                                                        '0 0 6px rgba(255, 255, 255, 0.9), 0 0 14px rgba(0, 168, 255, 0.75), 0 0 28px rgba(0, 168, 255, 0.45), 0 0 44px rgba(0, 168, 255, 0.2), inset 0 0 4px rgba(0, 168, 255, 0.35)',
                                                    textShadow:
                                                        '0 0 3px rgba(0, 168, 255, 0.9), 0 0 6px rgba(0, 168, 255, 0.5)',
                                                }
                                                : undefined
                                        }
                                    >
                                        Stats
                                    </button>

                                    <button
                                        type='button'
                                        onClick={() =>
                                            setAnalyseSubView('contracts')
                                        }
                                        className={`flex-1 cursor-pointer whitespace-nowrap rounded-full px-1.5 py-0.5 text-[0.85rem] font-bold transition-all duration-200 sm:px-3 sm:text-base ${analyseSubView === 'contracts'
                                                ? 'bg-white text-[#1D1B61]'
                                                : 'bg-transparent text-[#F2F5FA] hover:bg-[#00A8FF]/15 hover:text-white'
                                            }`}
                                        style={
                                            analyseSubView === 'contracts'
                                                ? {
                                                    boxShadow:
                                                        '0 0 6px rgba(255, 255, 255, 0.9), 0 0 14px rgba(0, 168, 255, 0.75), 0 0 28px rgba(0, 168, 255, 0.45), 0 0 44px rgba(0, 168, 255, 0.2), inset 0 0 4px rgba(0, 168, 255, 0.35)',
                                                    textShadow:
                                                        '0 0 3px rgba(0, 168, 255, 0.9), 0 0 6px rgba(0, 168, 255, 0.5)',
                                                }
                                                : undefined
                                        }
                                    >
                                        Contrats
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>,
                    document.body,
                )}
        </article>
    );
}
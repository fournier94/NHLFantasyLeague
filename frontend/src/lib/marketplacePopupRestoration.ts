/**
 * Tiny module-level store that remembers the roster popup state
 * the user was in when he clicked a player name inside the
 * MarketplacePage popup.
 *
 * The problem it solves: the user opens the popup, clicks a
 * player name, lands on PlayerPage, and clicks "Fermer". PlayerPage
 * routes back to the last non-player location, which is
 * /marketplace. MarketplacePage remounts with fresh state, so the
 * popup is gone and the user has to re-find the team.
 *
 * This store lets MarketplacePage know, on mount, that it should
 * reopen the popup with the same team and the same position
 * filter the user had selected when he left.
 *
 * PICK MODES
 *
 * Three distinct pick modes can be carried through the restore:
 *
 *   - pickContext: the popup was opened from a "Voir les offres"
 *     offer slot. Carries the offer id, the slot, the slot
 *     index, and the cap context. MarketplacePage rebuilds a
 *     fresh onPick backed by the offer-picks store.
 *
 *   - directPickContext: the popup was opened from a "Créer"
 *     slot. Carries the slot index and the side ('offering' or
 *     'target'), plus the cap context. MarketplacePage rebuilds
 *     a fresh onPick backed by the direct-offer draft store.
 *
 *   - publishPickContext: the popup was opened from a "Publier
 *     une annonce" slot. Carries the slot index and the locked
 *     position, plus the excluded player ids. MarketplacePage
 *     rebuilds a fresh onPick backed by the publish-offer draft
 *     store.
 *
 * Only one of the three is set at a time. If none are set, the
 * popup was opened by clicking a team name — no pick mode, just
 * a plain roster browse.
 *
 * Lifecycle:
 *   - Set by the player Link's onClick, right before navigating.
 *   - Consumed by MarketplacePage on mount (read + clear).
 *   - Cleared by ManagerRosterPopup's close handler, so a user
 *     who closes the popup without navigating to a player does
 *     not get the popup reopened on his next visit.
 *
 * Like scrollRestoration.ts and playerNavigation.ts, this is a
 * plain module variable: there is only ever one pending restore
 * at a time, it does not trigger a re-render, and it must outlive
 * the component that set it. Nothing is persisted across reloads;
 * that is deliberate.
 */

import type { RosterEntry, TradeOfferSlot } from '@/api/client';

export type MarketplacePopupPosition = 'F' | 'D' | 'G';

/**
 * Snapshot of the two teams' cap situation at the moment the
 * pick popup is opened, plus the season's salary cap. Carried on
 * the pick context so the roster popup can show, under each
 * player's contract row, what each side's cap space would be if
 * the trade closed with that player picked in the current slot.
 *
 * Fields are read by RosterPlayerRow as follows:
 *
 *   leftTeamCapHit  -> the left team's cap hit BEFORE the trade
 *   rightTeamCapHit -> the right team's cap hit BEFORE the trade
 *
 *   creatorOfferedSalary
 *     -> the sum of the current-season salaries the LEFT side
 *        is offering, EXCLUDING the current slot's pick when the
 *        candidate is being picked for the LEFT side.
 *
 *   responderOfferedSalaryExcludingCurrentSlot
 *     -> the sum of the current-season salaries the RIGHT side
 *        is offering, EXCLUDING the current slot's pick when the
 *        candidate is being picked for the RIGHT side.
 *
 *   candidateSide
 *     -> which side the candidate is being picked for. Defaults
 *        to 'right', which is the Voir les offres case (the
 *        responder is on the right side of the offer card).
 *        Créer passes 'left' when the user is picking on the
 *        connected team's side of a slot, and 'right' when he is
 *        picking on the target team's side.
 *
 *   swapSides
 *     -> when true, the offer card that opened this popup is
 *        rendering the responder on the LEFT and the creator on
 *        the RIGHT (Voir les offres tab). The popup's cap
 *        projection row mirrors that layout: the responder's
 *        name and projected space render on the left, the
 *        creator's on the right.
 *
 *        Purely a visual flag. The math is unchanged: the
 *        "creator" fields still describe the offer creator, the
 *        "responder" fields still describe the responding team.
 *
 * For Voir les offres the names map directly:
 *   - "creator" is the offer creator (left side of the card)
 *   - "responder" is the current user (right side of the card)
 *
 * For Créer:
 *   - "creator" / "left"    = the connected user's team
 *   - "responder" / "right" = the target team
 */
export interface TradeCapContext {
    leftTeamName: string;
    leftTeamCapHit: number;
    rightTeamName: string;
    rightTeamCapHit: number;
    seasonSalaryCap: number;
    creatorOfferedSalary: number;
    responderOfferedSalaryExcludingCurrentSlot: number;
    candidateSide?: 'left' | 'right';
    swapSides?: boolean;
}

/**
 * Pick context for the "Voir les offres" tab. When set, the popup
 * was opened in pick mode from an offer slot. MarketplacePage
 * rebuilds the full pick context (slot, cap context, and a fresh
 * onPick backed by the offer picks store) from this on mount.
 */
export interface PendingPickContext {
    offerId: number;
    slotIndex: number;
    slot: TradeOfferSlot;
    capContext?: TradeCapContext;
}

/**
 * Pick context for the "Créer" tab. When set, the popup was
 * opened in pick mode from a DirectOfferCard slot. MarketplacePage
 * rebuilds a fresh onPick backed by the direct-offer draft store
 * from this on mount.
 */
export interface PendingDirectPickContext {
    slotIndex: number;
    side: 'offering' | 'target';
    lockedPosition?: MarketplacePopupPosition;
    /**
     * Cap projection context for the two teams, carried through
     * the PlayerPage round-trip so the popup reopens with the
     * same cap rows it had before the user navigated away.
     */
    capContext?: TradeCapContext;
    /**
     * Player id of the current pick in the slot, or null when the
     * slot is empty on that side. Carried through the round-trip
     * so the popup reopens with the "Retirer" button still
     * visible if the user had one.
     */
    currentPickedPlayerId?: number | null;
}

/**
 * Pick context for the "Publier une annonce" tab. When set, the
 * popup was opened in pick mode from an AddOfferPanel slot.
 * MarketplacePage rebuilds a fresh onPick backed by the
 * publish-offer draft store from this on mount.
 *
 * The callback signatures are NOT carried here: they are rebuilt
 * on restore so they target the fresh AddOfferPanel instance
 * (which reads its slots from the store).
 */
export interface PendingPublishPickContext {
    slotIndex: number;
    currentPickedPlayerId: number | null;
    lockedPosition?: MarketplacePopupPosition;
    excludedPlayerIds: number[];
}

export interface PendingMarketplacePopup {
    teamId: number;
    teamName: string;
    positionFilter: MarketplacePopupPosition;
    /**
     * Set when the popup was in pick mode for a Voir les offres
     * slot. Mutually exclusive with directPickContext and
     * publishPickContext.
     */
    pickContext?: PendingPickContext;
    /**
     * Set when the popup was in pick mode for a Créer slot.
     * Mutually exclusive with pickContext and publishPickContext.
     */
    directPickContext?: PendingDirectPickContext;
    /**
     * Set when the popup was in pick mode for a Publier une
     * annonce slot. Mutually exclusive with pickContext and
     * directPickContext.
     */
    publishPickContext?: PendingPublishPickContext;
    /**
     * Full RosterEntry-shaped snapshot of the player on the OTHER
     * side of the trade slot, kept so the popup reopens with its
     * sticky reference card still rendered. Null when the other
     * side of the slot had no player picked.
     */
    referencePlayer?: RosterEntry | null;
}

let pending: PendingMarketplacePopup | null = null;

/** Records the popup state so the next mount of MarketplacePage can restore it. */
export function setMarketplacePopupRestore(
    value: PendingMarketplacePopup,
): void {
    pending = value;
}

/**
 * Returns the pending restore and clears it, so it is only ever
 * applied once. Returns null when nothing is pending.
 */
export function consumeMarketplacePopupRestore(): PendingMarketplacePopup | null {
    const value = pending;
    pending = null;
    return value;
}

/**
 * Discards any pending restore. Called when the user closes the
 * popup by any means other than clicking a player name, so
 * coming back to /marketplace later does not reopen it.
 */
export function clearMarketplacePopupRestore(): void {
    pending = null;
}
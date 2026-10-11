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

export type MarketplacePopupPosition = 'F' | 'D' | 'G';

export interface PendingMarketplacePopup {
    teamId: number;
    teamName: string;
    positionFilter: MarketplacePopupPosition;
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
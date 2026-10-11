/**
 * Module-level store for the picks state of marketplace OfferCards.
 *
 * THE PROBLEM IT SOLVES
 *
 * A user is in "Marché" → "Voir les offres", picks players in the
 * response dropdowns of one or more OfferCards, then clicks a manager
 * name to open the ManagerRosterPopup. From there he clicks a player
 * name, lands on PlayerPage, and clicks Fermer. PlayerPage routes back
 * to /marketplace, which re-mounts every OfferCard with fresh local
 * state — so every pick he made is lost.
 *
 * This store keeps the picks for each OfferCard keyed by offerId.
 * OfferCard initializes its local `picks` from here on mount, and
 * writes back on every change. On a successful submit, the entry is
 * cleared so the card reads empty the next time it mounts.
 *
 * Like scrollRestoration.ts, playerNavigation.ts and
 * marketplacePopupRestoration.ts, this is a plain module-level store:
 *   - it does not need to trigger a re-render;
 *   - it must outlive the components that set it;
 *   - it is intentionally ephemeral (never persisted), so a page
 *     reload or a session change resets it to empty.
 *
 * Nothing is written to the DB or to any API. This is purely the SPA
 * remembering its own transient form state across an in-app
 * navigation.
 */

/**
 * Picks for one OfferCard: a map from slotIndex to the picked
 * player's playerId, or null when the slot has no pick yet.
 *
 * Matches the shape of the OfferCard's local `picks` state exactly,
 * so the two can be swapped without any translation.
 */
export type PicksBySlot = Record<number, number | null>;

const picksByOfferId = new Map<number, PicksBySlot>();

/**
 * Returns the picks currently stored for the given offer, or an
 * empty object when the offer has no stored picks.
 *
 * Always returns a fresh object when there is nothing stored, so the
 * caller can safely use it as a React state initializer without
 * sharing a mutable reference across multiple mounts of the same
 * card.
 */
export function getPicksForOffer(offerId: number): PicksBySlot {
    return picksByOfferId.get(offerId) ?? {};
}

/**
 * Stores the picks for the given offer. Called on every pick change
 * so that navigating away and back restores the exact state.
 *
 * An empty picks map removes the entry entirely, so the store never
 * carries a stale empty object for an offer the user has finished
 * with.
 */
export function setPicksForOffer(
    offerId: number,
    picks: PicksBySlot,
): void {
    if (Object.keys(picks).length === 0) {
        picksByOfferId.delete(offerId);
        return;
    }

    picksByOfferId.set(offerId, picks);
}

/**
 * Explicitly drops the picks for the given offer. Used after a
 * successful submit so the next mount of the same card reads empty.
 */
export function clearPicksForOffer(offerId: number): void {
    picksByOfferId.delete(offerId);
}
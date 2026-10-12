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
 * THE CURRENT DESIGN
 *
 * The store is the single source of truth. OfferCards do NOT keep a
 * local copy of their picks; they read from here via
 * useSyncExternalStore. Every write goes through setPicksForOffer (or
 * pickForSlot, which is a convenience wrapper around it). The store
 * notifies subscribers on every change, so any mounted OfferCard
 * re-renders with fresh data immediately — including when the change
 * was made from a component OUTSIDE the OfferCard tree, such as the
 * roster popup's "Ajouter" button.
 *
 * This is what makes the "click a player name in the popup → go to
 * PlayerPage → come back → click Ajouter" flow correct: the popup's
 * onPick writes to the store, and the (still-mounted) OfferCard
 * picks up the change on the next notify.
 *
 * This is a plain module-level store: it does not need to trigger a
 * re-render by itself (subscribers handle that), it must outlive the
 * components that set it, and it is intentionally ephemeral (never
 * persisted), so a page reload or a session change resets it to empty.
 */

/**
 * Picks for one OfferCard: a map from slotIndex to the picked
 * player's playerId, or null when the slot has no pick yet.
 */
export type PicksBySlot = Record<number, number | null>;

/**
 * Frozen shared empty object. Returned as the snapshot for any
 * offer whose picks have never been set. Sharing the same reference
 * across offers is safe because it is never mutated, and it means
 * useSyncExternalStore sees a stable reference between renders.
 */
const EMPTY_PICKS: PicksBySlot = Object.freeze({});

const picksByOfferId = new Map<number, PicksBySlot>();

/**
 * Cached snapshot per offer id. useSyncExternalStore requires
 * getSnapshot to return the same reference between store changes;
 * caching here guarantees that, so React never bails into an
 * infinite render loop.
 */
const snapshotCache = new Map<number, PicksBySlot>();

const listeners = new Set<() => void>();

function notify(): void {
    listeners.forEach((listener) => {
        try {
            listener();
        } catch {
            // Ignore listener errors: one bad subscriber must not
            // break the others.
        }
    });
}

/**
 * Subscribe to any picks change. Returns an unsubscribe function.
 * Every mounted OfferCard subscribes via useSyncExternalStore.
 */
export function subscribeToPicks(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Returns the picks currently stored for the given offer, or a
 * frozen empty object when the offer has no picks. The returned
 * reference is stable between store changes.
 */
export function getPicksForOffer(offerId: number): PicksBySlot {
    const cached = snapshotCache.get(offerId);
    if (cached) return cached;

    const current = picksByOfferId.get(offerId) ?? EMPTY_PICKS;
    snapshotCache.set(offerId, current);
    return current;
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
        if (picksByOfferId.delete(offerId)) {
            snapshotCache.set(offerId, EMPTY_PICKS);
            notify();
        }
        return;
    }

    picksByOfferId.set(offerId, picks);
    snapshotCache.set(offerId, picks);
    notify();
}

/**
 * Explicitly drops the picks for the given offer. Used after a
 * successful submit so the next mount of the same card reads empty.
 */
export function clearPicksForOffer(offerId: number): void {
    if (picksByOfferId.delete(offerId)) {
        snapshotCache.set(offerId, EMPTY_PICKS);
        notify();
    }
}

/**
 * Sets one slot's pick and leaves the others untouched. This is the
 * stable entry point the roster popup's "Ajouter" button uses: it
 * only needs the offer id and the slot index, both of which are
 * carried on the pick context, so it does not depend on any
 * component instance.
 */
export function pickForSlot(
    offerId: number,
    slotIndex: number,
    playerId: number | null,
): void {
    const current = getPicksForOffer(offerId);
    const next = { ...current, [slotIndex]: playerId };
    setPicksForOffer(offerId, next);
}
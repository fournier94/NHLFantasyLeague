/**
 * Module-level store for the extra responding slots a manager adds
 * on the "Voir les offres" tab.
 *
 * The offer that a manager is browsing defines N base slots (one per
 * player the offer's creator asked for). The responder must fill
 * every base slot. On top of that, the responder can click
 * "Ajouter un joueur" to add MORE responding slots, for trades where
 * he gives more players than the offer creator asked for.
 *
 * WHY A SEPARATE STORE
 *
 * The base slots and the extras live in different namespaces:
 *
 *   - Base slots are keyed by the offer's own SlotIndex (0..N-1).
 *     Their state lives in the existing pick store
 *     (marketplaceTradeState.ts), which maps offer id + slot index
 *     to a picked player id.
 *
 *   - Extras are keyed by slot indices >= N. Their STATE also lives
 *     in the same pick store (so pickForSlot / getPicksForOffer work
 *     uniformly for both kinds of slot); the ONLY thing that differs
 *     is the list of which slot indices are extras. That list is
 *     what this store holds.
 *
 * Keeping the extras list separate means the base pick store does
 * not need to grow a second axis of state, and the extras can be
 * cleared independently when the responder resets the offer.
 *
 * Slot indices for extras are monotonic per offer (a counter starts
 * at the base slot count and increments on every add). Removing an
 * extra drops only that index from the list; it does NOT renumber
 * the remaining extras, so any pick already stored at a surviving
 * index stays valid.
 *
 * Lifecycle mirrors every other marketplace store: process-scoped,
 * never persisted, survives a PlayerPage round-trip, cleared by a
 * full page reload.
 */

const slotsByOfferId = new Map<number, number[]>();
const nextSlotIndexByOfferId = new Map<number, number>();
const listeners = new Set<() => void>();
const snapshotCache = new Map<number, readonly number[]>();
const EMPTY: readonly number[] = Object.freeze([]);

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
 * Subscribes to any change in the extra-slots store. Returns an
 * unsubscribe function. Every mounted OfferCard subscribes via
 * useSyncExternalStore.
 */
export function subscribeToExtraResponderSlots(
    listener: () => void,
): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Returns the current list of extra slot indices for the given
 * offer, in insertion order. Empty when the responder has not added
 * any extras. The reference is stable between writes.
 */
export function getExtraResponderSlots(
    offerId: number,
): readonly number[] {
    const cached = snapshotCache.get(offerId);
    if (cached) return cached;

    const current = slotsByOfferId.get(offerId) ?? EMPTY;
    snapshotCache.set(offerId, current);
    return current;
}

/**
 * Appends a new extra slot to the given offer and returns the slot
 * index that was assigned to it.
 *
 * The first extra added to an offer is assigned index
 * `baseSlotCount`; each subsequent extra increments the counter. The
 * counter is monotonic so removing an extra never renumbers the
 * survivors.
 */
export function addExtraResponderSlot(
    offerId: number,
    baseSlotCount: number,
): number {
    const next = nextSlotIndexByOfferId.get(offerId) ?? baseSlotCount;
    nextSlotIndexByOfferId.set(offerId, next + 1);

    const current = getExtraResponderSlots(offerId);
    const updated = [...current, next];

    slotsByOfferId.set(offerId, updated);
    snapshotCache.set(offerId, updated);
    notify();

    return next;
}

/**
 * Removes one extra slot from the given offer by its slot index.
 * The remaining extras keep their original slot indices; the counter
 * used by addExtraResponderSlot is not rewound, so a subsequent add
 * gets a fresh index that cannot collide with a surviving one.
 *
 * Callers are responsible for clearing the pick at the removed slot
 * index in the pick store, since this store only tracks which slot
 * indices are extras, not the picked players.
 */
export function removeExtraResponderSlot(
    offerId: number,
    slotIndex: number,
): void {
    const current = getExtraResponderSlots(offerId);
    const updated = current.filter((idx) => idx !== slotIndex);

    if (updated.length === 0) {
        slotsByOfferId.delete(offerId);
        snapshotCache.set(offerId, EMPTY);
    } else {
        slotsByOfferId.set(offerId, updated);
        snapshotCache.set(offerId, updated);
    }

    notify();
}

/**
 * Clears every extra slot for the given offer and resets the
 * monotonic counter. Called by "Réinitialiser" on the offer card and
 * after a successful response submit.
 */
export function clearExtraResponderSlots(offerId: number): void {
    nextSlotIndexByOfferId.delete(offerId);

    if (slotsByOfferId.delete(offerId)) {
        snapshotCache.set(offerId, EMPTY);
        notify();
    }
}
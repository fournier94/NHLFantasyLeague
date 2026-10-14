/**
 * Module-level store for the draft picks the responder has
 * explicitly REMOVED from the offer's own pick list while building
 * a response in "Voir les offres".
 *
 * WHY A STORE
 *
 * Same reason as every other marketplace store: the responder can
 * navigate to a PlayerPage from the roster popup and come back.
 * The OfferCard remounts, and if the removed-pick state were local
 * React state it would be wiped. The store survives the round-trip.
 *
 * WHAT IT HOLDS
 *
 * For each offer id, the set of DraftPick ids that the responder
 * has removed from the creator's own pick list. This list is
 * SUBTRACTIVE against the offer's own picks (offer.picks), the
 * same way the requested-picks list is ADDITIVE.
 *
 * Semantics on submit: the ids are sent as
 * `removedCreatorDraftPickIds`, and the backend stores them on the
 * response so the accepted trade excludes those picks.
 *
 * Lifecycle mirrors every other marketplace store: process-scoped,
 * never persisted, cleared by a full page reload. Réinitialiser
 * clears the entry for the current offer.
 */

const removedByOfferId = new Map<number, number[]>();
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

export function subscribeToRemovedCreatorPicks(
    listener: () => void,
): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getRemovedCreatorPicks(
    offerId: number,
): readonly number[] {
    const cached = snapshotCache.get(offerId);
    if (cached) return cached;

    const current = removedByOfferId.get(offerId) ?? EMPTY;
    snapshotCache.set(offerId, current);
    return current;
}

export function addRemovedCreatorPick(
    offerId: number,
    pickId: number,
): void {
    const current = getRemovedCreatorPicks(offerId);

    if (current.includes(pickId)) {
        return;
    }

    const next = [...current, pickId];
    removedByOfferId.set(offerId, next);
    snapshotCache.set(offerId, next);
    notify();
}

export function removeRemovedCreatorPick(
    offerId: number,
    pickId: number,
): void {
    const current = getRemovedCreatorPicks(offerId);

    if (!current.includes(pickId)) {
        return;
    }

    const next = current.filter((id) => id !== pickId);

    if (next.length === 0) {
        removedByOfferId.delete(offerId);
        snapshotCache.set(offerId, EMPTY);
    } else {
        removedByOfferId.set(offerId, next);
        snapshotCache.set(offerId, next);
    }

    notify();
}

export function clearRemovedCreatorPicks(offerId: number): void {
    if (removedByOfferId.delete(offerId)) {
        snapshotCache.set(offerId, EMPTY);
        notify();
    }
}
/**
 * Module-level store for draft pick selections across the marketplace.
 *
 * THREE KEY SPACES, all in the same store:
 *
 *   - `offer:${offerId}:creator`   — creator-side picks on an
 *     existing offer (someone else's offer the user is browsing, or
 *     his own offer he is editing). Only used in "Vos offres actives"
 *     when the user wants to edit a published offer.
 *
 *   - `offer:${offerId}:responder` — responder-side picks on an
 *     existing offer. Used in "Voir les offres" when the user is
 *     building his answer.
 *
 *   - `offer:${offerId}:requested` — extra picks the responder is
 *     asking the offer's creator to give, on top of whatever the
 *     offer already carries. Used in "Voir les offres".
 *
 *   - `direct:offering`            — the calling user's picks in the
 *                                     "Créer" (direct offer) draft.
 *
 *   - `direct:target`              — the target team's picks in the
 *                                     "Créer" draft.
 *
 *   - `publish:creator`            — the creator's picks in the
 *                                     "Publier une annonce" draft.
 *
 * WHY A STORE AND NOT LOCAL STATE
 *
 * Same reason as `marketplaceTradeState.ts` and `directOfferState.ts`:
 * the user opens the popup, clicks a player name, lands on PlayerPage,
 * clicks Fermer, comes back to MarketplacePage and everything must
 * still be there. Local state on OfferCard is destroyed by that
 * round-trip; module-level state survives it.
 *
 * The store notifies subscribers on every write, so any mounted
 * consumer re-renders immediately. This is what makes the pick
 * dropdowns, the pick chips and the "Réinitialiser" button stay in
 * sync across the whole card.
 *
 * Snapshot references are cached per key so `useSyncExternalStore`
 * sees a stable reference between writes and does not loop.
 */

const listeners = new Set<() => void>();

const picksByKey = new Map<string, number[]>();

const snapshotCache = new Map<string, readonly number[]>();

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
 * Builds the store key for a specific (offer, side) pair. The side
 * is 'creator', 'responder' or 'requested' — never 'left' or
 * 'right', so the stored data survives a `swapSides` toggle without
 * migrating.
 */
export function offerPicksKey(
    offerId: number,
    side: 'creator' | 'responder' | 'requested',
): string {
    return `offer:${offerId}:${side}`;
}

export const DIRECT_OFFERING_KEY = 'direct:offering';
export const DIRECT_TARGET_KEY = 'direct:target';
export const PUBLISH_CREATOR_KEY = 'publish:creator';

/**
 * Subscribe to any picks change. Returns an unsubscribe function.
 * Every mounted consumer subscribes via useSyncExternalStore.
 */
export function subscribeToPicks(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Returns the current picks for the given key. The reference is
 * stable between writes, which is what useSyncExternalStore requires.
 * Empty keys return a shared frozen empty array, so two different
 * empty keys do not cause two different re-renders.
 */
export function getPicks(key: string): readonly number[] {
    const cached = snapshotCache.get(key);
    if (cached) return cached;

    const current = picksByKey.get(key) ?? EMPTY;
    snapshotCache.set(key, current);
    return current;
}

/**
 * Replaces the whole pick list for a key. An empty array removes
 * the entry entirely so the store never carries a stale empty list.
 */
export function setPicks(key: string, picks: number[]): void {
    const next = picks.slice();

    if (next.length === 0) {
        if (picksByKey.delete(key)) {
            snapshotCache.set(key, EMPTY);
            notify();
        }
        return;
    }

    picksByKey.set(key, next);
    snapshotCache.set(key, next);
    notify();
}

/**
 * Appends a pick id to the list for the given key, if it is not
 * already present. Idempotent: adding the same id twice is a no-op.
 */
export function addPick(key: string, pickId: number): void {
    const current = getPicks(key);

    if (current.includes(pickId)) {
        return;
    }

    setPicks(key, [...current, pickId]);
}

/**
 * Removes a pick id from the list for the given key. Idempotent:
 * removing an id that is not in the list is a no-op.
 */
export function removePick(key: string, pickId: number): void {
    const current = getPicks(key);

    if (!current.includes(pickId)) {
        return;
    }

    setPicks(
        key,
        current.filter((id) => id !== pickId),
    );
}

/**
 * Clears every pick for the given key.
 */
export function clearPicks(key: string): void {
    if (picksByKey.delete(key)) {
        snapshotCache.set(key, EMPTY);
        notify();
    }
}

/**
 * Clears every pick stored for the given offer, on all three sides.
 * Used by "Réinitialiser" on an offer card, and after a successful
 * submit.
 */
export function clearOfferPicks(offerId: number): void {
    const creatorKey = offerPicksKey(offerId, 'creator');
    const responderKey = offerPicksKey(offerId, 'responder');
    const requestedKey = offerPicksKey(offerId, 'requested');

    const hadCreator = picksByKey.delete(creatorKey);
    const hadResponder = picksByKey.delete(responderKey);
    const hadRequested = picksByKey.delete(requestedKey);

    if (hadCreator || hadResponder || hadRequested) {
        snapshotCache.set(creatorKey, EMPTY);
        snapshotCache.set(responderKey, EMPTY);
        snapshotCache.set(requestedKey, EMPTY);
        notify();
    }
}

/**
 * Clears both sides of the Créer draft. Called after a successful
 * submit or by "Réinitialiser" on the Créer card.
 */
export function clearDirectPicks(): void {
    const hadOffering = picksByKey.delete(DIRECT_OFFERING_KEY);
    const hadTarget = picksByKey.delete(DIRECT_TARGET_KEY);

    if (hadOffering || hadTarget) {
        snapshotCache.set(DIRECT_OFFERING_KEY, EMPTY);
        snapshotCache.set(DIRECT_TARGET_KEY, EMPTY);
        notify();
    }
}

/**
 * Clears the creator-side picks of the "Publier une annonce" draft.
 * Called after a successful publish or by "Réinitialiser" on the
 * publish panel.
 */
export function clearPublishPicks(): void {
    if (picksByKey.delete(PUBLISH_CREATOR_KEY)) {
        snapshotCache.set(PUBLISH_CREATOR_KEY, EMPTY);
        notify();
    }
}
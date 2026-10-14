/**
 * Module-level store for offering-side overrides on browse offers.
 *
 * On a "Voir les offres" offer the responder can replace the
 * player the offer's creator put on the offering side of a slot,
 * add a player there when the creator left the offering side
 * empty, OR explicitly clear the offering side entirely.
 *
 * Three states per slot:
 *
 *   - missing key / null value  -> no override; fall back to the
 *                                  offer creator's own offering
 *                                  player for that slot.
 *
 *   - CLEARED_OFFERING_SENTINEL -> the responder explicitly
 *                                  emptied the offering side; the
 *                                  creator's own player is ignored
 *                                  and the slot renders empty.
 *
 *   - positive player id        -> the responder replaced the
 *                                  creator's player with this one.
 *
 * Player ids are always positive, so -1 is a safe sentinel that
 * cannot collide with a real player.
 */

export const CLEARED_OFFERING_SENTINEL = -1;

export type OfferingOverridesBySlot = Record<number, number | null>;

const EMPTY: OfferingOverridesBySlot = Object.freeze({});

const overridesByOfferId =
    new Map<number, OfferingOverridesBySlot>();

const snapshotCache = new Map<number, OfferingOverridesBySlot>();

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

export function subscribeToOfferingOverrides(
    listener: () => void,
): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getOfferingOverridesForOffer(
    offerId: number,
): OfferingOverridesBySlot {
    const cached = snapshotCache.get(offerId);
    if (cached) return cached;

    const current = overridesByOfferId.get(offerId) ?? EMPTY;
    snapshotCache.set(offerId, current);
    return current;
}

export function setOfferingOverridesForOffer(
    offerId: number,
    overrides: OfferingOverridesBySlot,
): void {
    if (Object.keys(overrides).length === 0) {
        if (overridesByOfferId.delete(offerId)) {
            snapshotCache.set(offerId, EMPTY);
            notify();
        }
        return;
    }

    overridesByOfferId.set(offerId, overrides);
    snapshotCache.set(offerId, overrides);
    notify();
}

export function setOfferingOverrideForSlot(
    offerId: number,
    slotIndex: number,
    playerId: number | null,
): void {
    const current = getOfferingOverridesForOffer(offerId);
    const next = { ...current, [slotIndex]: playerId };
    setOfferingOverridesForOffer(offerId, next);
}

/**
 * Marks the offering side of the given slot as EXPLICITLY empty:
 * the responder does not want any of the creator's players on that
 * slot. Stored as CLEARED_OFFERING_SENTINEL so the renderer can
 * tell "no override, use the creator's player" apart from
 * "responder cleared the slot".
 */
export function clearOfferingForSlot(
    offerId: number,
    slotIndex: number,
): void {
    const current = getOfferingOverridesForOffer(offerId);
    const next = {
        ...current,
        [slotIndex]: CLEARED_OFFERING_SENTINEL,
    };
    setOfferingOverridesForOffer(offerId, next);
}

export function clearOfferingOverridesForOffer(
    offerId: number,
): void {
    if (overridesByOfferId.delete(offerId)) {
        snapshotCache.set(offerId, EMPTY);
        notify();
    }
}
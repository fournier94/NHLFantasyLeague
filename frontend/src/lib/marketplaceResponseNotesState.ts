/**
 * Module-level store for the responder's optional text message on a
 * marketplace response, keyed by offer id.
 *
 * WHY A STORE
 *
 * Same reason as every other marketplace store: the responder can
 * navigate to a PlayerPage from the roster popup and come back. The
 * OfferCard remounts, and if the note were local React state it
 * would be wiped. The store survives the round-trip.
 *
 * WHAT IT HOLDS
 *
 * One string per offer id, the responder's draft message. Empty or
 * missing = no message.
 *
 * Lifecycle mirrors every other marketplace store: process-scoped,
 * never persisted, cleared by a full page reload. Réinitialiser
 * clears the entry for the current offer.
 */

const noteByOfferId = new Map<number, string>();
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

export function subscribeToResponseNotes(
    listener: () => void,
): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getResponseNote(offerId: number): string {
    return noteByOfferId.get(offerId) ?? '';
}

export function setResponseNote(
    offerId: number,
    note: string,
): void {
    const current = noteByOfferId.get(offerId) ?? '';

    if (current === note) {
        return;
    }

    if (note === '') {
        noteByOfferId.delete(offerId);
    } else {
        noteByOfferId.set(offerId, note);
    }

    notify();
}

export function clearResponseNote(offerId: number): void {
    if (noteByOfferId.delete(offerId)) {
        notify();
    }
}
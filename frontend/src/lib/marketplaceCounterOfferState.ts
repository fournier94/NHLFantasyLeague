/**
 * Tiny module-level store that remembers which response in the
 * "Reçues" panel is currently being countered with an inline
 * Créer-style DirectOfferCard.
 *
 * Same lifecycle pattern as every other marketplace store: process-
 * scoped, never persisted, survives a PlayerPage round-trip. Only
 * one counter-offer can be active at a time, so the state is a
 * single nullable value instead of a map.
 *
 * The full response object is stored (not just its id) so the card
 * can still render even if the response momentarily falls out of
 * the fetched list — e.g. while a re-fetch is in flight after a
 * PlayerPage round-trip.
 */

import type { TradeOfferResponse } from '@/api/client';

let counteringResponse: TradeOfferResponse | null = null;

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

export function subscribeToCounterOfferState(
    listener: () => void,
): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Returns the response currently being countered, or null. The
 * reference is stable between writes, which is what
 * useSyncExternalStore requires.
 */
export function getCounteringResponse(): TradeOfferResponse | null {
    return counteringResponse;
}

export function startCountering(response: TradeOfferResponse): void {
    if (counteringResponse?.id === response.id) return;
    counteringResponse = response;
    notify();
}

export function clearCountering(): void {
    if (counteringResponse === null) return;
    counteringResponse = null;
    notify();
}
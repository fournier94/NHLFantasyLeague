/**
 * Module-level store for the marketplace notification badge count.
 *
 * Polls GET /api/Marketplace/notifications/count every 60 seconds
 * while at least one subscriber is mounted, and stops polling when
 * the last subscriber unmounts. Consumers read the count via
 * useSyncExternalStore, so they only re-render when the number
 * actually changes.
 *
 * A manual trigger (`refreshMarketplaceNotificationsNow`) is
 * exposed so the marketplace tabs can clear the count immediately
 * after a mark-seen call completes, without waiting for the next
 * 60-second tick.
 *
 * Race safety: each fetch takes a monotonic request token. When a
 * response comes back, if its token is no longer the latest one,
 * the response is discarded. That prevents an in-flight poll from
 * overwriting a fresher count produced by a manual refresh.
 *
 * Errors are swallowed: a transient network failure leaves the
 * last known count on screen and the next tick retries.
 */

import { getMarketplaceNotifications } from '@/api/client';

const POLL_INTERVAL_MS = 60_000;

let count = 0;
let pollTimer: number | null = null;
let requestToken = 0;

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

async function fetchCount(): Promise<void> {
    const myToken = ++requestToken;

    try {
        const data = await getMarketplaceNotifications();

        // Discard responses that have been superseded by a newer
        // fetch. This is what makes refreshMarketplaceNotificationsNow
        // safe to call while a scheduled poll is in flight.
        if (myToken !== requestToken) return;

        if (data.total !== count) {
            count = data.total;
            notify();
        }
    } catch {
        // Silent: next tick retries.
    }
}

/**
 * Subscribes to the count. On the first subscriber, starts the
 * polling loop and fires an immediate fetch so the badge is
 * populated without waiting 60 seconds. On the last unsubscribe,
 * stops the loop.
 */
export function subscribeToMarketplaceNotifications(
    listener: () => void,
): () => void {
    listeners.add(listener);

    if (listeners.size === 1) {
        void fetchCount();
        pollTimer = window.setInterval(
            () => void fetchCount(),
            POLL_INTERVAL_MS,
        );
    }

    return () => {
        listeners.delete(listener);

        if (listeners.size === 0 && pollTimer != null) {
            window.clearInterval(pollTimer);
            pollTimer = null;
        }
    };
}

export function getMarketplaceNotificationsSnapshot(): number {
    return count;
}

/**
 * Forces an immediate refetch. Called by the browse and received
 * tabs right after their mark-seen call completes, so the badge
 * clears in the same tick as the "Nouvelle offre" chips disappear.
 */
export function refreshMarketplaceNotificationsNow(): void {
    void fetchCount();
}
/**
 * Module-level store for the marketplace notification badge state.
 *
 * Polls GET /api/Marketplace/notifications/count every 60 seconds
 * while at least one subscriber is mounted, and stops polling when
 * the last subscriber unmounts. Consumers read the whole state via
 * useSyncExternalStore, so they only re-render when the counts
 * actually change.
 *
 * The store also exposes two "optimistic clear" helpers
 * (clearOffersCountLocally, clearReceivedResponsesCountLocally)
 * that the marketplace panels call the moment they mount. This is
 * what makes the navbar badge drop in the same frame the user lands
 * on a section, without waiting for a server round-trip and the
 * next poll. The server-side mark-seen call still fires from the
 * panel; when it resolves, refreshMarketplaceNotificationsNow()
 * brings the store back in sync. If the mark-seen call failed and
 * the count is genuinely still non-zero, the next poll re-populates
 * the badge, which is the correct self-healing behaviour.
 *
 * Race safety: each fetch takes a monotonic request token. When a
 * response comes back, if its token is no longer the latest one,
 * the response is discarded. That prevents an in-flight poll from
 * overwriting a fresher state produced by a manual refresh.
 *
 * Errors are swallowed: a transient network failure leaves the
 * last known state on screen and the next tick retries.
 *
 * NOTE ON THE FIVE FIELDS. Three of the fields are "unseen"
 * counters that drop to 0 when the user visits a section:
 *
 *   unseenOffers               -> "Marché" button + navbar badge
 *   unseenResponses            -> navbar badge only
 *   unseenAcceptedSentResponses -> navbar badge only
 *
 * The other two are persistent per-section totals that are NOT
 * affected by mark-seen calls:
 *
 *   totalReceivedResponses     -> "Reçues" button label
 *   totalSentResponses         -> "Envoyées" button label
 *
 * The change-detection check below includes every field, so a
 * response that only changes a total still triggers a re-render.
 */

import {
    getMarketplaceNotifications,
    type MarketplaceNotificationCount,
} from '@/api/client';

const POLL_INTERVAL_MS = 60_000;

/**
 * Frozen zero state. Returned as the initial snapshot and used for
 * comparison against every fetch, so a response that produced the
 * same counts does not trigger a re-render.
 */
const ZERO: MarketplaceNotificationCount = {
    unseenOffers: 0,
    unseenResponses: 0,
    unseenAcceptedSentResponses: 0,
    totalReceivedResponses: 0,
    totalSentResponses: 0,
    total: 0,
};

let state: MarketplaceNotificationCount = ZERO;
let pollTimer: number | null = null;
let requestToken = 0;

let visibilityHandler: (() => void) | null = null;
let focusHandler: (() => void) | null = null;

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
        // safe to call while a scheduled poll is in flight, and
        // what makes the optimistic local clears safe when they
        // race with a poll.
        if (myToken !== requestToken) return;

        const changed =
            data.total !== state.total ||
            data.unseenOffers !== state.unseenOffers ||
            data.unseenResponses !== state.unseenResponses ||
            data.unseenAcceptedSentResponses !==
            state.unseenAcceptedSentResponses ||
            data.totalReceivedResponses !==
            state.totalReceivedResponses ||
            data.totalSentResponses !== state.totalSentResponses;

        if (changed) {
            state = data;
            notify();
        }
    } catch {
        // Silent: next tick retries.
    }
}

/**
 * Subscribes to the state. On the first subscriber, starts the
 * polling loop, attaches the visibility/focus refetch listeners,
 * and fires an immediate fetch so the badge is populated without
 * waiting 60 seconds. On the last unsubscribe, tears everything
 * down.
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

        // Refetch the moment the tab becomes visible again. This is
        // the primary defence against the throttled-timer problem:
        // the poll may have been delayed by minutes while the tab
        // was hidden, so an immediate fetch on return guarantees the
        // user sees the current count the very first frame after
        // switching back.
        visibilityHandler = () => {
            if (document.visibilityState === 'visible') {
                void fetchCount();
            }
        };

        // Refetch on window focus. Covers the desktop case where
        // the user alt-tabs away and back without the tab ever
        // becoming hidden (some browsers only fire one of the two
        // events).
        focusHandler = () => {
            void fetchCount();
        };

        document.addEventListener(
            'visibilitychange',
            visibilityHandler,
        );
        window.addEventListener('focus', focusHandler);
    }

    return () => {
        listeners.delete(listener);

        if (listeners.size === 0 && pollTimer != null) {
            window.clearInterval(pollTimer);
            pollTimer = null;

            if (visibilityHandler != null) {
                document.removeEventListener(
                    'visibilitychange',
                    visibilityHandler,
                );
                visibilityHandler = null;
            }

            if (focusHandler != null) {
                window.removeEventListener('focus', focusHandler);
                focusHandler = null;
            }
        }
    };
}

/**
 * Returns the current state. The reference is stable between
 * store changes so useSyncExternalStore does not loop.
 */
export function getMarketplaceNotificationsSnapshot(): MarketplaceNotificationCount {
    return state;
}

/**
 * Forces an immediate refetch. Called by the browse, received and
 * sent tabs right after their mark-seen call completes, so the
 * store converges with the server in the same tick the server-side
 * mark-seen lands.
 */
export function refreshMarketplaceNotificationsNow(): void {
    void fetchCount();
}

/**
 * Optimistically zero out the "unseen offers" count and notify.
 *
 * Called the moment the user lands on Voir les offres, BEFORE the
 * server-side mark-seen call fires. The navbar badge drops in the
 * same frame, so the user sees the notification clear instantly
 * instead of after a round-trip.
 *
 * The server-side mark-seen still runs from the panel. When it
 * resolves, refreshMarketplaceNotificationsNow() re-syncs the
 * store with the server. If the mark-seen call failed and the
 * server really still shows a non-zero count, the next poll will
 * restore it, which is the correct self-healing behaviour.
 *
 * Idempotent: a no-op when the count is already 0, so it is safe
 * to call from an effect that may fire more than once.
 *
 * Deliberately does NOT touch totalReceivedResponses or
 * totalSentResponses: those are persistent per-section totals and
 * must not be optimistically zeroed on tab visit.
 */
export function clearOffersCountLocally(): void {
    if (state.unseenOffers === 0) return;

    state = {
        ...state,
        unseenOffers: 0,
        total: state.total - state.unseenOffers,
    };
    notify();
}

/**
 * Same as clearOffersCountLocally, for the "Reçues" count.
 *
 * NOTE: only the unseen counter is zeroed. totalReceivedResponses
 * stays as-is, because the "Reçues" button label is meant to keep
 * showing the true section count after the user opens the tab.
 */
export function clearReceivedResponsesCountLocally(): void {
    if (state.unseenResponses === 0) return;

    state = {
        ...state,
        unseenResponses: 0,
        total: state.total - state.unseenResponses,
    };
    notify();
}
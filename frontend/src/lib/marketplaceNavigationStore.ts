/**
 * Two related mechanisms for programmatic navigation inside the
 * Marketplace page:
 *
 *   1. `computeMarketplaceTargetPath` — used by the navbar to decide
 *      which section to open when the user clicks the marketplace
 *      icon. Encodes the league's priority rules:
 *
 *        Priority 1 — a received response (Reçues) is waiting, or
 *                     a sent response was accepted → Reçues.
 *        Priority 2 — a new or modified offer is waiting in Voir les
 *                     offres → Voir les offres.
 *        Priority 3 — no priority target, fall back to whatever tab
 *                     the user was last on (handled by the section
 *                     store on mount).
 *
 *   2. Pending navigation requests — used by marketplace sub-panels
 *      to ask the page to switch tabs after an action completes
 *      (e.g. after a successful offer submission → Envoyées).
 *
 * Both are process-scoped, never persisted. The pending navigation
 * pattern mirrors every other module-level store in this app so the
 * navigation survives a PlayerPage round-trip when the user takes
 * the pick popup out to a player page and comes back.
 */

import type {
    MarketplaceBrowseSubView,
    MarketplaceView,
} from './marketplaceSectionState';

/**
 * Shape the helper accepts. `unseenAcceptedSentResponses` is
 * optional so this file compiles whether or not the backend has
 * been extended with that field yet.
 */
interface NotificationSnapshotLike {
    unseenOffers: number;
    unseenResponses: number;
    unseenAcceptedSentResponses?: number;
}

/**
 * Returns the target marketplace URL the navbar should send the
 * user to when he clicks the marketplace icon.
 *
 * Encodes Priority 1 / 2 / 3 exactly as the league asked. Priority 1
 * wins over Priority 2 wins over Priority 3.
 *
 * The URL carries the target as a query param. MarketplacePage reads
 * those params on mount, applies them, then clears them so
 * subsequent internal tab switches are not overridden.
 */
export function computeMarketplaceTargetPath(
    notifications: NotificationSnapshotLike,
): string {
    // Priority 1 — Reçues has something new (a received response
    // waiting to be read, or a sent response that has been
    // accepted).
    const hasPriorityOne =
        notifications.unseenResponses > 0 ||
        (notifications.unseenAcceptedSentResponses ?? 0) > 0;

    if (hasPriorityOne) {
        return '/marketplace?view=received';
    }

    // Priority 2 — Voir les offres has something new (a fresh or
    // modified offer). The `sub=view` param pins the sub-tab to
    // "Voir les offres" and not "Vos offres actives" / "Publier
    // une annonce".
    if (notifications.unseenOffers > 0) {
        return '/marketplace?view=browse&sub=view';
    }

    // Priority 3 — nothing to prioritise. Fall back to the default
    // landing section: (browse, view).
    //
    // Emitted as URL params, exactly like Priority 2, so
    // MarketplacePage applies it the same way instead of restoring
    // whatever section the user was on before. This is what makes
    // the navbar marketplace icon always take the user to "Voir les
    // offres" when neither Reçues nor a new offer needs attention.
    //
    // The section store is still consulted on mount when NO params
    // are present — that is the return-from-PlayerPage case, where
    // PlayerPage navigates back to a clean /marketplace URL after
    // the user was deep in a section (typically Marché → Publier
    // une annonce), and its state must be restored.
    return '/marketplace?view=browse&sub=view';
}

// ---------------------------------------------------------------------
// Pending navigation requests
//
// Used by panels that want to switch the marketplace to a specific
// tab after a successful action, without prop-drilling a callback
// through three levels of components.
// ---------------------------------------------------------------------

interface NavigationRequest {
    view: MarketplaceView;
    browseSubView: MarketplaceBrowseSubView | null;
}

let pending: NavigationRequest | null = null;
let requestId = 0;

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

export function subscribeToMarketplaceNavigationRequest(
    listener: () => void,
): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Monotonic counter incremented on every request. Used as the
 * getSnapshot value for useSyncExternalStore: any increment triggers
 * a re-render in the consuming component.
 */
export function getMarketplaceNavigationRequestId(): number {
    return requestId;
}

/**
 * Asks the MarketplacePage to switch to the given view. The request
 * is consumed exactly once by the page. Multiple rapid requests
 * overwrite each other (only the last one matters).
 */
export function requestMarketplaceNavigation(
    view: MarketplaceView,
    browseSubView?: MarketplaceBrowseSubView,
): void {
    pending = {
        view,
        browseSubView: browseSubView ?? null,
    };
    requestId++;
    notify();
}

/**
 * Returns the pending navigation request and clears it, so it is
 * only ever applied once. Returns null when nothing is pending.
 */
export function consumeMarketplaceNavigationRequest(): NavigationRequest | null {
    const value = pending;
    pending = null;
    return value;
}
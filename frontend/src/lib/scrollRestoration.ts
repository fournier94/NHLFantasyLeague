/**
 * Tiny module-level store for cross-page scroll restoration.
 *
 * The problem it solves: when a user opens a player page from a
 * scrolled Mon équipe page and then comes back, we want Mon équipe to
 * reopen at exactly the same scroll position (or, as a fallback, with
 * the card the user clicked at the top of the viewport).
 *
 * React Router's navigation `state` does NOT survive the round-trip,
 * because state is attached to the entry you are navigating TO, not the
 * entry you are leaving. So we keep one ephemeral value here instead.
 *
 * This is intentionally a plain module variable, not React state:
 *   - There is only ever one "pending" restore at a time.
 *   - It does not need to trigger a re-render.
 *   - It must outlive the component that set it (PlayerPage) and be
 *     consumed by a different component (MonEquipePage) on the next
 *     mount.
 *
 * Nothing is persisted across reloads; that is deliberate.
 */

interface PendingRestore {
    /** Id of the card the user clicked, or null when unknown. */
    cardId: string | null;

    /** window.scrollY at the moment the user left the page. */
    scrollY: number;
}

let pendingRestore: PendingRestore | null = null;

/**
 * Records where the user was when they navigated away, so the next
 * consumer can restore the exact position.
 */
export function setPendingRestore(
    cardId: string | null,
    scrollY: number,
): void {
    pendingRestore = { cardId, scrollY };
}

/**
 * Returns the pending restore and clears it, so a scroll only ever
 * happens once per visit. Returns null when nothing is pending.
 */
export function consumePendingRestore(): PendingRestore | null {
    const value = pendingRestore;
    pendingRestore = null;
    return value;
}

/**
 * True when a restore is waiting to be consumed. Used by the layout to
 * skip its own scroll-to-top on the return navigation.
 *
 * Does NOT clear the pending value.
 */
export function hasPendingRestore(): boolean {
    return pendingRestore !== null;
}
/**
 * Tiny module-level store for cross-page scroll restoration.
 *
 * The problem it solves: when a user opens a player page from a scrolled
 * Mon équipe page and then comes back, we want Mon équipe to reopen with
 * the card the user clicked on at the top of the viewport.
 *
 * React Router's navigation `state` does NOT survive the round-trip,
 * because state is attached to the entry you are navigating TO, not the
 * entry you are leaving. So we keep one ephemeral value here instead.
 *
 * This is intentionally a plain module variable, not React state:
 *   - There is only ever one "pending" card at a time.
 *   - It does not need to trigger a re-render.
 *   - It must outlive the component that set it (PlayerPage) and be
 *     consumed by a different component (MonEquipePage) on the next
 *     mount.
 *
 * Nothing is persisted across reloads; that is deliberate.
 */

let pendingCardId: string | null = null;

/** Stores the id of the card we should scroll to on the next consume. */
export function setPendingCardId(cardId: string | null): void {
    pendingCardId = cardId;
}

/**
 * Returns the pending card id and clears it, so a scroll only ever
 * happens once per visit. Returns null when nothing is pending.
 */
export function consumePendingCardId(): string | null {
    const value = pendingCardId;
    pendingCardId = null;
    return value;
}
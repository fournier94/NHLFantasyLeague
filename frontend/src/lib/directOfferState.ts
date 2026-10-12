/**
 * Module-level store for the "Créer" tab's in-progress direct
 * offer. Holds three things:
 *
 *   - the selected target team id (the manager the user picked
 *     from the "Offrir à" dropdown),
 *   - the slots array (each slot carries the offering player on
 *     the connected user's side and the target player on the
 *     other team's side),
 *   - the optional note text.
 *
 * WHY THIS IS A MODULE-LEVEL STORE
 *
 * DirectOfferCard used to hold `slots` and `note` in local React
 * state, and MarketplacePage held the selected team id in its own
 * local state. Any navigation away from /marketplace (opening a
 * PlayerPage from the pick roster popup, for example) unmounted
 * both components and wiped their state, so coming back landed on
 * an empty form.
 *
 * The state lives here instead so it survives the unmount. The
 * store notifies its subscribers on every write, so any mounted
 * consumer re-renders immediately, including when the write comes
 * from a component outside the DirectOfferCard tree (the roster
 * popup's "Ajouter" button, the pending pick restore handler,
 * etc.).
 *
 * The store is ephemeral (never persisted) and process-scoped. A
 * page reload clears it — deliberate, same convention as the
 * other marketplace stores.
 */

export interface DirectOfferSlotState {
    offeringPlayerId: number | null;
    targetPlayerId: number | null;
}

export interface DirectOfferDraft {
    selectedTargetTeamId: string;
    slots: DirectOfferSlotState[];
    note: string;
}

/**
 * Frozen default. Returned as the snapshot before anything is
 * written, so useSyncExternalStore sees a stable reference and
 * does not loop.
 *
 * Consumers must treat the object (and its nested slots array)
 * as immutable — always build a new one with `updateDirectOfferDraft`,
 * never mutate in place.
 */
const DEFAULT_DRAFT: DirectOfferDraft = {
    selectedTargetTeamId: '',
    slots: [{ offeringPlayerId: null, targetPlayerId: null }],
    note: '',
};

let currentDraft: DirectOfferDraft = DEFAULT_DRAFT;

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

/**
 * Subscribe to any draft change. Returns an unsubscribe function.
 * Every mounted consumer subscribes via useSyncExternalStore.
 */
export function subscribeToDirectOfferDraft(
    listener: () => void,
): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Returns the current draft. The reference is stable between
 * writes, which is what useSyncExternalStore requires.
 */
export function getDirectOfferDraft(): DirectOfferDraft {
    return currentDraft;
}

/**
 * Functional update. The updater receives the current draft and
 * must return a new object. Returning the same reference is a
 * no-op (no notify).
 */
export function updateDirectOfferDraft(
    updater: (current: DirectOfferDraft) => DirectOfferDraft,
): void {
    const next = updater(currentDraft);
    if (next === currentDraft) return;
    currentDraft = next;
    notify();
}

/**
 * Resets the draft to its default (no target team, one empty
 * slot, no note). Kept for any future "full reset" caller that
 * wants to also clear the selected target team.
 */
export function resetDirectOfferDraft(): void {
    if (currentDraft !== DEFAULT_DRAFT) {
        currentDraft = DEFAULT_DRAFT;
        notify();
    }
}

/**
 * Resets the draft's slots and note but KEEPS the currently
 * selected target team. Called by "Réinitialiser" on the Créer
 * form: the user wants to start over on the players and the
 * message, but does not want to re-pick the manager he is
 * offering to.
 *
 * No-ops when the draft is already in the reset state (single
 * empty slot, empty note), so a double click does not spam
 * subscribers with no-op notifications.
 */
export function resetDirectOfferSlotsAndNote(): void {
    const alreadyReset =
        currentDraft.slots.length === 1 &&
        currentDraft.slots[0].offeringPlayerId === null &&
        currentDraft.slots[0].targetPlayerId === null &&
        currentDraft.note === '';

    if (alreadyReset) {
        return;
    }

    currentDraft = {
        selectedTargetTeamId: currentDraft.selectedTargetTeamId,
        slots: [{ offeringPlayerId: null, targetPlayerId: null }],
        note: '',
    };

    notify();
}
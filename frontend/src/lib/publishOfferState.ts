/**
 * Module-level store for the "Publier une annonce" form.
 *
 * Holds the user's in-progress offer: the slots array, the note,
 * and the id of the offer currently being edited (null for a new
 * publish).
 *
 * Survives a PlayerPage round-trip so the user does not lose the
 * form when he clicks a player name inside the roster popup and
 * comes back. Also serves as the bridge for the popup's pick
 * callback: the callback writes here, and whichever AddOfferPanel
 * instance is currently mounted reads from here.
 *
 * Same pattern as directOfferState.ts: useSyncExternalStore-
 * compatible, ephemeral, no persistence across reloads.
 *
 * A slot is just an offered player. There is no demanded position
 * and no demand criterias. The backend still requires a valid
 * F/D/G on every slot, but that value is derived from the offered
 * player's own position at submit time (see slotToRequest in
 * MarketplacePage.tsx), so it never lives in state.
 */

export interface PublishSlotState {
    offeringPlayerId: number | null;
}

export const EMPTY_PUBLISH_SLOT: PublishSlotState = {
    offeringPlayerId: null,
};

export interface PublishOfferDraft {
    slots: PublishSlotState[];
    note: string;
    /**
     * Id of the offer currently being edited, or null when the
     * draft is for a new publish. Used by AddOfferPanel to decide
     * whether to seed from `initialOffer` on mount.
     */
    editingOfferId: number | null;
}

function createDefaultDraft(): PublishOfferDraft {
    return {
        slots: [{ ...EMPTY_PUBLISH_SLOT }],
        note: '',
        editingOfferId: null,
    };
}

let currentDraft: PublishOfferDraft = createDefaultDraft();

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

export function subscribeToPublishDraft(
    listener: () => void,
): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getPublishDraft(): PublishOfferDraft {
    return currentDraft;
}

export function updatePublishDraft(
    updater: (current: PublishOfferDraft) => PublishOfferDraft,
): void {
    const next = updater(currentDraft);
    if (next === currentDraft) return;
    currentDraft = next;
    notify();
}

export function resetPublishDraft(): void {
    const d = currentDraft;

    if (
        d.editingOfferId === null &&
        d.note === '' &&
        d.slots.length === 1 &&
        d.slots[0].offeringPlayerId === null
    ) {
        return;
    }

    currentDraft = createDefaultDraft();
    notify();
}

/**
 * Sets the picked player for one slot. Called from the roster
 * popup when the user clicks "Ajouter".
 */
export function pickPublishSlot(
    slotIndex: number,
    playerId: number,
): void {
    updatePublishDraft((d) => ({
        ...d,
        slots: d.slots.map((s, i) =>
            i === slotIndex
                ? { ...s, offeringPlayerId: playerId }
                : s,
        ),
    }));
}

/**
 * Clears the picked player for one slot.
 */
export function clearPublishSlot(slotIndex: number): void {
    updatePublishDraft((d) => ({
        ...d,
        slots: d.slots.map((s, i) =>
            i === slotIndex
                ? { ...s, offeringPlayerId: null }
                : s,
        ),
    }));
}
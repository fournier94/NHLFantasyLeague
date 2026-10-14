import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DraftPick } from '@/api/client';

/**
 * One visual column of the draft picks slot on a trade card.
 *
 * Handles:
 *   - rendering the selected picks as compact chips, each with a
 *     "×" button to remove (unless the pick is locked),
 *   - clicking a removable chip reopens the picker in "replace"
 *     mode so the user can swap the pick for another one,
 *   - the "Ajouter un choix" button that opens a centered picker
 *     in "add" mode,
 *   - the picker itself, populated with the given team's draft
 *     picks, minus the ones already selected on this side,
 *   - outside-click and Escape handling to close the picker.
 *
 * The parent (OfferCard / DirectOfferCard / AddOfferPanel) owns the
 * selection state; this component is fully controlled. It only
 * forwards the user's intent via onAddPick / onRemovePick.
 *
 * The picker is rendered via createPortal to document.body and is
 * positioned as a centered overlay rather than being anchored to
 * the trigger. This is deliberate: an anchored dropdown near the
 * bottom of a long offer card ends up clipped by the viewport and
 * the user barely sees it. A centered overlay with a dim backdrop
 * is always fully visible regardless of where the trigger sits.
 *
 * Chip layout:
 *   - The chip height is driven ONLY by the label's line box. The
 *     "×" button is absolutely positioned so it never contributes
 *     to the chip's layout height, which lets the × grow freely
 *     without inflating the chip.
 *   - The × is anchored to the chip's right inner edge and
 *     vertically centered.
 *   - Chips that carry a removable × reserve right padding on the
 *     label so its truncation never runs under the ×. Locked chips
 *     (server-owned picks, no ×) keep a small right padding.
 *   - The label font is one step smaller than the standalone button
 *     font: text-[0.75rem] on phones, text-[0.85rem] from sm up.
 *
 * Column spacing:
 *   - The wrapper uses gap-3 (12px) so the chips and the "Ajouter
 *     un choix" button breathe. gap-1 (4px) made them hug each
 *     other, which read as a single control rather than two
 *     distinct elements.
 *
 * Edit-in-place behavior:
 *   - Clicking the body of a removable chip opens the picker with
 *     the chip's pick id recorded as `editingPickId`. When the user
 *     picks a new one, the component fires `onRemovePick(old)` then
 *     `onAddPick(new)` in the same handler. The store updates once
 *     for each call, so React batches and there is no flicker.
 *   - Clicking the × removes the pick without opening the picker.
 *     A stopPropagation on the × prevents the chip's own click
 *     handler from also firing.
 *   - Locked chips are not clickable and have no ×.
 *
 * Color rules:
 *   - The chips show the currently-selected picks in the app's
 *     accent cyan. These are unchanged across all cards.
 *   - The "Ajouter un choix" button is green so it reads as an
 *     "add" affordance, distinct from the cyan chips it sits under.
 *   - The picker's close control is a red "Fermer" button, matching
 *     the ManagerRosterPopup's close button in the marketplace.
 */
export function TradePicksSlot({
    selectedPicks,
    availablePicks,
    editable,
    lockedPickIds,
    onAddPick,
    onRemovePick,
}: {
    /**
     * The picks currently selected on this side, in display order.
     * Rendered as chips above the "Ajouter un choix" button.
     */
    selectedPicks: DraftPick[];

    /**
     * Every draft pick currently owned by this side's team. The
     * picker filters these against the picks already selected on
     * this side so a user cannot pick the same pick twice.
     */
    availablePicks: DraftPick[];

    /**
     * When true, the user can add, edit and remove picks on this
     * side. When false, only the currently selected picks are shown
     * and no "Ajouter un choix" button appears.
     */
    editable: boolean;

    /**
     * Picks that must be displayed as chips but cannot be removed
     * or replaced. Used when a card shows picks that belong to the
     * server (the offer creator's own offered picks on a browse
     * card, or the frozen picks on a response card) alongside picks
     * the connected user is currently adding. The locked picks
     * render without a "×" button and are not clickable.
     *
     * Optional. When undefined, every selected pick is editable
     * (subject to `editable`).
     */
    lockedPickIds?: readonly number[];

    onAddPick: (pickId: number) => void;
    onRemovePick: (pickId: number) => void;
}) {
    const [open, setOpen] = useState(false);

    /**
     * Pick id currently being replaced, or null when the picker is
     * in "add" mode. Set when the user clicks the body of a
     * removable chip; cleared as soon as the picker closes.
     */
    const [editingPickId, setEditingPickId] = useState<number | null>(
        null,
    );

    const panelRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open) return;

        function onDocKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') closePicker();
        }

        // Outside-click is handled on the backdrop element below,
        // so no document-level mousedown listener is needed here.
        document.addEventListener('keydown', onDocKeyDown);

        return () => {
            document.removeEventListener('keydown', onDocKeyDown);
        };
    }, [open]);

    const selectedIds = new Set(selectedPicks.map((p) => p.id));

    const selectable = availablePicks.filter(
        (p) => !selectedIds.has(p.id),
    );

    const hasSelected = selectedPicks.length > 0;

    if (!editable && !hasSelected) {
        return null;
    }

    const lockedSet = lockedPickIds != null
        ? new Set(lockedPickIds)
        : null;

    const isLocked = (pickId: number): boolean =>
        lockedSet != null && lockedSet.has(pickId);

    function openForAdd() {
        setEditingPickId(null);
        setOpen(true);
    }

    function openForEdit(pickId: number) {
        setEditingPickId(pickId);
        setOpen(true);
    }

    function closePicker() {
        setEditingPickId(null);
        setOpen(false);
    }

    function handleSelectPick(newPickId: number) {
        const replacing = editingPickId;

        if (replacing != null && replacing !== newPickId) {
            // Replace in the same handler so React batches both
            // store writes into a single render.
            onRemovePick(replacing);
            onAddPick(newPickId);
        } else if (replacing == null) {
            onAddPick(newPickId);
        }

        closePicker();
    }

    const pickerTitle =
        editingPickId != null ? 'Changer le choix' : 'Ajouter un choix';

    return (
        <div className='flex w-full min-w-0 flex-col items-center gap-3 text-center'>
            {selectedPicks.map((pick) => {
                const locked = isLocked(pick.id);
                const canEdit = editable && !locked;

                return (
                    <div
                        key={pick.id}
                        onClick={
                            canEdit
                                ? () => openForEdit(pick.id)
                                : undefined
                        }
                        role={canEdit ? 'button' : undefined}
                        tabIndex={canEdit ? 0 : undefined}
                        onKeyDown={
                            canEdit
                                ? (e) => {
                                    if (
                                        e.key === 'Enter' ||
                                        e.key === ' '
                                    ) {
                                        e.preventDefault();
                                        openForEdit(pick.id);
                                    }
                                }
                                : undefined
                        }
                        className={`relative flex w-full max-w-[20rem] items-center rounded border border-[#00E5FF]/40 bg-[#080D1A] py-1.5 pl-3 ${canEdit
                            ? 'cursor-pointer pr-10 transition-colors hover:bg-[#00E5FF]/10 focus:outline-none focus-visible:bg-[#00E5FF]/15'
                            : 'pr-3'
                            }`}
                    >
                        <span className='min-w-0 flex-1 truncate text-[0.75rem] font-semibold text-[#00E5FF] md:text-[0.85rem]'>
                            {formatPickLabel(pick)}
                        </span>

                        {canEdit && (
                            <button
                                type='button'
                                aria-label='Retirer ce choix'
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onRemovePick(pick.id);
                                }}
                                className='absolute right-[2px] top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-3xl font-bold leading-none text-[#EF4444] transition-colors hover:bg-[#EF4444]/15'
                            >
                                ×
                            </button>
                        )}
                    </div>
                );
            })}

            {editable && (
                <button
                    type='button'
                    onClick={openForAdd}
                    disabled={selectable.length === 0 && !open}
                    className='w-full max-w-[20rem] cursor-pointer rounded border border-emerald-500 bg-transparent px-2 py-1 text-[0.75rem] font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50 md:text-xs'
                >
                    Ajouter un choix
                </button>
            )}

            {open &&
                createPortal(
                    <div
                        className='fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4'
                        onClick={closePicker}
                        role='dialog'
                        aria-modal='true'
                        aria-label={pickerTitle}
                    >
                        <div
                            ref={panelRef}
                            onClick={(e) => e.stopPropagation()}
                            className='relative flex max-h-[70vh] w-full max-w-sm flex-col overflow-hidden rounded-lg border border-[#00E5FF]/50 bg-[#0F1626] shadow-[0_0_20px_rgba(0,229,255,0.35),0_8px_24px_rgba(0,0,0,0.6)]'
                        >
                            <button
                                type='button'
                                onClick={closePicker}
                                className='absolute right-2 top-2 z-10 cursor-pointer rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-black transition-colors hover:bg-red-500'
                            >
                                Fermer
                            </button>

                            <div className='border-b border-[#00E5FF]/20 px-4 py-2'>
                                <span className='text-xs font-bold uppercase tracking-wider text-[#00E5FF]'>
                                    {pickerTitle}
                                </span>
                            </div>

                            <ul
                                role='listbox'
                                className='flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                            >
                                {selectable.length === 0 && (
                                    <li>
                                        <div className='px-4 py-4 text-center text-sm font-semibold text-[#7DD3FC]/60'>
                                            Aucun choix disponible
                                        </div>
                                    </li>
                                )}

                                {selectable.map((pick) => (
                                    <li key={pick.id}>
                                        <button
                                            type='button'
                                            role='option'
                                            aria-selected={false}
                                            onClick={() =>
                                                handleSelectPick(pick.id)
                                            }
                                            className='w-full cursor-pointer border-b border-[#00E5FF]/15 px-4 py-2.5 text-center text-sm font-semibold text-foreground transition-colors last:border-b-0 hover:bg-[#00E5FF]/10 hover:text-[#00E5FF] md:text-base'
                                        >
                                            {formatPickLabel(pick)}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>,
                    document.body,
                )}
        </div>
    );
}

/**
 * Display label for one draft pick. Format requested by the league:
 * "Year, Ronde N, OriginalOwnerTeamName". No pick number — the real
 * order is set by the annual lottery and is unknown at trade time.
 */
export function formatPickLabel(pick: DraftPick): string {
    return `${pick.draftYear}, Ronde ${pick.round}, ${pick.originalOwnerFantasyTeamName}`;
}
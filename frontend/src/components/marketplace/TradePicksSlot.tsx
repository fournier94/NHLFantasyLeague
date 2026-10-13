import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DraftPick } from '@/api/client';

/**
 * One visual column of the draft picks slot on a trade card.
 *
 * Handles:
 *   - rendering the selected picks as compact chips, each with a
 *     "×" button to remove (unless the pick is locked),
 *   - the "Ajouter un choix" button that opens the dropdown,
 *   - the dropdown itself, populated with the given team's draft
 *     picks, minus the ones already selected on this side,
 *   - outside-click and Escape handling to close the dropdown,
 *   - closing on page scroll.
 *
 * The parent (OfferCard / DirectOfferCard / AddOfferPanel) owns the
 * selection state; this component is fully controlled. It only
 * forwards the user's intent via onAddPick / onRemovePick.
 *
 * The dropdown is rendered via createPortal to document.body and
 * positioned from the trigger's bounding rect, so it is never
 * clipped by an ancestor with overflow-hidden (OfferCard's article
 * has one). Same pattern as PlayerDropdownPanel.
 *
 * Color rules:
 *   - The chips show the currently-selected picks in the app's
 *     accent cyan. These are unchanged across all cards.
 *   - The "Ajouter un choix" button is green so it reads as an
 *     "add" affordance, distinct from the cyan chips it sits under.
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
     * dropdown filters these against the picks already selected on
     * this side so a user cannot pick the same pick twice.
     */
    availablePicks: DraftPick[];

    /**
     * When true, the user can add and remove picks on this side.
     * When false, only the currently selected picks are shown and
     * no "Ajouter un choix" button appears.
     */
    editable: boolean;

    /**
     * Picks that must be displayed as chips but cannot be removed.
     * Used when a card shows picks that belong to the server (the
     * offer creator's own offered picks on a browse card, or the
     * frozen picks on a response card) alongside picks the
     * connected user is currently adding. The locked picks render
     * without a "×" button, the rest render with one (when
     * `editable` is true).
     *
     * Optional. When undefined, every selected pick is removable
     * (subject to `editable`).
     */
    lockedPickIds?: readonly number[];

    onAddPick: (pickId: number) => void;
    onRemovePick: (pickId: number) => void;
}) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLUListElement | null>(null);
    const [panelRect, setPanelRect] = useState<DOMRect | null>(null);

    useEffect(() => {
        if (!open) {
            setPanelRect(null);
            return;
        }

        if (triggerRef.current) {
            setPanelRect(triggerRef.current.getBoundingClientRect());
        }

        function onDocMouseDown(e: MouseEvent) {
            const target = e.target as Node;
            if (triggerRef.current?.contains(target)) return;
            if (panelRef.current?.contains(target)) return;
            setOpen(false);
        }

        function onDocKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') setOpen(false);
        }

        function onWindowScroll() {
            setOpen(false);
        }

        document.addEventListener('mousedown', onDocMouseDown);
        document.addEventListener('keydown', onDocKeyDown);
        window.addEventListener('scroll', onWindowScroll);

        return () => {
            document.removeEventListener('mousedown', onDocMouseDown);
            document.removeEventListener('keydown', onDocKeyDown);
            window.removeEventListener('scroll', onWindowScroll);
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

    const panelWidth = panelRect ? Math.max(panelRect.width, 220) : 220;

    return (
        <div className='flex w-full min-w-0 flex-col items-center gap-1 text-center'>
            {selectedPicks.map((pick) => {
                const locked = isLocked(pick.id);

                return (
                    <div
                        key={pick.id}
                        className='flex w-full max-w-[18rem] items-center justify-between gap-1 rounded border border-[#00E5FF]/40 bg-[#080D1A] px-2 py-0.5'
                    >
                        <span className='min-w-0 truncate text-[0.7rem] font-semibold text-[#00E5FF] md:text-xs'>
                            {formatPickLabel(pick)}
                        </span>

                        {editable && !locked && (
                            <button
                                type='button'
                                aria-label='Retirer ce choix'
                                onClick={() => onRemovePick(pick.id)}
                                className='shrink-0 cursor-pointer rounded px-1 text-sm font-bold leading-none text-[#EF4444] transition-colors hover:bg-[#EF4444]/10'
                            >
                                ×
                            </button>
                        )}
                    </div>
                );
            })}

            {editable && (
                <button
                    ref={triggerRef}
                    type='button'
                    onClick={() => setOpen((v) => !v)}
                    disabled={selectable.length === 0 && !open}
                    className='w-full max-w-[18rem] cursor-pointer rounded border border-emerald-500 bg-transparent px-2 py-0.5 text-[0.7rem] font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50 md:text-xs'
                >
                    Ajouter un choix
                </button>
            )}

            {open &&
                panelRect &&
                createPortal(
                    <ul
                        ref={panelRef}
                        role='listbox'
                        style={{
                            position: 'fixed',
                            top: panelRect.bottom + 4,
                            left: Math.max(
                                8,
                                Math.min(
                                    panelRect.left,
                                    window.innerWidth - panelWidth - 8,
                                ),
                            ),
                            width: panelWidth,
                            maxHeight: Math.max(
                                140,
                                Math.min(
                                    288,
                                    window.innerHeight -
                                    panelRect.bottom -
                                    16,
                                ),
                            ),
                            zIndex: 200,
                        }}
                        className='overflow-y-auto rounded-lg border border-[#00E5FF]/50 bg-[#0F1626] shadow-[0_0_20px_rgba(0,229,255,0.35),0_8px_24px_rgba(0,0,0,0.6)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                    >
                        {selectable.length === 0 && (
                            <li>
                                <div className='px-4 py-2.5 text-center text-sm font-semibold text-[#7DD3FC]/60'>
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
                                    onClick={() => {
                                        onAddPick(pick.id);
                                        setOpen(false);
                                    }}
                                    className='w-full cursor-pointer border-b border-[#00E5FF]/15 px-4 py-2.5 text-center text-sm font-semibold transition-colors last:border-b-0 text-foreground hover:bg-[#00E5FF]/10 hover:text-[#00E5FF] md:text-base'
                                >
                                    {formatPickLabel(pick)}
                                </button>
                            </li>
                        ))}
                    </ul>,
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
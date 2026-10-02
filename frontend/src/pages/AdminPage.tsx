import { useEffect, useMemo, useState } from 'react';
import {
    assignPlayer,
    assignUserTeam,
    demoteUser,
    getLeagueTeams,
    getTeamRoster,
    getUsers,
    promoteUser,
    releasePlayer,
    resetUserPassword,
    searchPlayers,
    swapRosterStatus,
    unassignUserTeam,
    updateRosterEntry,
    deleteStatusHistory,
    getRosterStatusHistory,
    recomputeTeamTotals,
    updateStatusHistory,
    type RosterStatusHistoryRow,
    type AdminUserRow,
    type FantasyTeam,
    type PlayerSearchResult,
    type RosterEntry,
    type TeamRoster,
} from '@/api/client';
import { useAuraAll } from '@/lib/auraContext';
import { AURA_CHANNELS } from '@/lib/auraConfig';
import { AuraButton } from '@/components/ui/AuraButton';

// ---------------------------------------------------------------------
// Position grouping (mirrors the backend PositionGroup helper).
// ---------------------------------------------------------------------

type PositionGroup = 'F' | 'D' | 'G' | 'U';

function positionGroup(rawPosition: string | null | undefined): PositionGroup {
    if (!rawPosition) return 'U';

    const normalized = rawPosition
        .trim()
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');

    if (
        normalized === 'G' ||
        normalized === 'GK' ||
        normalized === 'GB' ||
        normalized === 'GOALIE' ||
        normalized === 'GOALTENDER' ||
        normalized === 'GARDIEN' ||
        normalized === 'GARDIEN DE BUT'
    ) {
        return 'G';
    }

    if (
        normalized === 'D' ||
        normalized === 'LD' ||
        normalized === 'RD' ||
        normalized === 'DEFENSE' ||
        normalized === 'DEFENCE' ||
        normalized === 'DEFENSEMAN' ||
        normalized === 'DEFENCEMAN' ||
        normalized === 'LEFT DEFENSE' ||
        normalized === 'RIGHT DEFENSE' ||
        normalized === 'DEFENSEUR' ||
        normalized === 'ARRIERE'
    ) {
        return 'D';
    }

    if (
        normalized === 'C' ||
        normalized === 'CENTER' ||
        normalized === 'CENTRE' ||
        normalized === 'L' ||
        normalized === 'LW' ||
        normalized === 'LEFT WING' ||
        normalized === 'LEFTWING' ||
        normalized === 'R' ||
        normalized === 'RW' ||
        normalized === 'RIGHT WING' ||
        normalized === 'RIGHTWING' ||
        normalized === 'W' ||
        normalized === 'WINGER' ||
        normalized === 'WING' ||
        normalized === 'F' ||
        normalized === 'FORWARD' ||
        normalized === 'AG' ||
        normalized === 'AD' ||
        normalized === 'A' ||
        normalized === 'AILIER' ||
        normalized === 'AILIER GAUCHE' ||
        normalized === 'AILIER DROIT' ||
        normalized === 'AVANT' ||
        normalized === 'ATTAQUANT'
    ) {
        return 'F';
    }

    return 'U';
}

function groupLabel(group: PositionGroup): string {
    switch (group) {
        case 'F': return 'Attaquants';
        case 'D': return 'Défenseurs';
        case 'G': return 'Gardiens';
        default: return 'Inconnu';
    }
}

/**
 * Converts a value from <input type="datetime-local"> (which is in the
 * browser's local time zone and has no seconds) into an ISO 8601 UTC
 * string suitable for the API. Returns null when the input is empty
 * or malformed.
 */
function localDateTimeToUtcIso(localValue: string): string | null {
    if (!localValue) return null;

    const parsed = new Date(localValue);
    if (Number.isNaN(parsed.getTime())) return null;

    return parsed.toISOString();
}

/** Today's local date at 00:00, formatted for a datetime-local input. */
function todayLocalDateInputValue(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T00:00`;
}

const ROSTER_STATUSES = [
    { value: 'Active', label: 'Actif' },
    { value: 'Bench', label: 'Banc' },
    { value: 'Prospect', label: 'Prospect' },
] as const;

const MIN_SEARCH_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;

function statusLabel(status: string): string {
    return ROSTER_STATUSES.find((entry) => entry.value === status)?.label ?? status;
}

const selectClass =
    'w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50';

const primaryButtonClass =
    'cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50';

const secondaryButtonClass =
    'cursor-pointer rounded-lg border border-border bg-transparent px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50';

const dangerButtonClass =
    'cursor-pointer rounded-lg border border-destructive/40 bg-transparent px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50';

export default function AdminPage() {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<PlayerSearchResult[]>([]);
    const [selectedPlayer, setSelectedPlayer] = useState<PlayerSearchResult | null>(null);
    const [teams, setTeams] = useState<FantasyTeam[]>([]);
    const [fantasyTeamId, setFantasyTeamId] = useState('');
    const [rosterStatus, setRosterStatus] = useState('Active');
    const [searching, setSearching] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [releaseArmed, setReleaseArmed] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [rosterTeamId, setRosterTeamId] = useState('');
    const [teamRoster, setTeamRoster] = useState<TeamRoster | null>(null);
    const [rosterLoading, setRosterLoading] = useState(false);
    const [rosterError, setRosterError] = useState<string | null>(null);

    // EffectiveAt for the assigned-player update form (used only when
    // the target team differs from the current one, i.e. a trade).
    const [updateEffectiveAt, setUpdateEffectiveAt] = useState(
        todayLocalDateInputValue,
    );

    // --- Team history section state ---
    const [histTeamId, setHistTeamId] = useState('');
    const [histRoster, setHistRoster] = useState<TeamRoster | null>(null);
    const [histLoading, setHistLoading] = useState(false);
    const [histError, setHistError] = useState<string | null>(null);
    const [histSuccess, setHistSuccess] = useState<string | null>(null);

    // Per-player history rows, keyed by playerId.
    const [historyByPlayer, setHistoryByPlayer] = useState<
        Record<number, RosterStatusHistoryRow[]>
    >({});

    // Which player's history is expanded.
    const [expandedPlayerId, setExpandedPlayerId] = useState<number | null>(null);

    // Which row is being edited.
    const [editingRowId, setEditingRowId] = useState<number | null>(null);
    const [editingEffectiveAt, setEditingEffectiveAt] = useState('');
    const [editingNote, setEditingNote] = useState('');
    const [historyBusy, setHistoryBusy] = useState(false);

    // --- Users section state ---
    const [adminUsers, setAdminUsers] = useState<AdminUserRow[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [usersError, setUsersError] = useState<string | null>(null);
    const [usersSuccess, setUsersSuccess] = useState<string | null>(null);
    const [usersBusyId, setUsersBusyId] = useState<number | null>(null);
    const [resetPasswordFor, setResetPasswordFor] = useState<number | null>(null);
    const [resetPasswordValue, setResetPasswordValue] = useState('');
    const [assignTeamFor, setAssignTeamFor] = useState<number | null>(null);
    const [assignTeamValue, setAssignTeamValue] = useState('');

    const [showAppearance, setShowAppearance] = useState(false);

    // --- Swap section state ---
    const [swapTeamId, setSwapTeamId] = useState('');
    const [swapTeamRoster, setSwapTeamRoster] = useState<TeamRoster | null>(null);
    const [swapLoading, setSwapLoading] = useState(false);
    const [swapError, setSwapError] = useState<string | null>(null);

    // Active <-> Bench swap
    const [abEffectiveAt, setAbEffectiveAt] = useState(todayLocalDateInputValue);
    const [abPlayerAId, setAbPlayerAId] = useState('');
    const [abPlayerBId, setAbPlayerBId] = useState('');

    // Prospect swap
    const [prEffectiveAt, setPrEffectiveAt] = useState(todayLocalDateInputValue);
    const [prProspectId, setPrProspectId] = useState('');
    const [prTargetId, setPrTargetId] = useState('');

    const [swapSubmitting, setSwapSubmitting] = useState(false);
    const [swapSuccess, setSwapSuccess] = useState<string | null>(null);

    const { intensities, setIntensity, reset } = useAuraAll();

    useEffect(() => {
        let cancelled = false;

        getLeagueTeams()
            .then((data) => {
                if (!cancelled) {
                    setTeams(data);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setError('Impossible de charger les équipes. Vérifiez que le serveur API est démarré.');
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    // Load the users list once on mount.
    useEffect(() => {
        void loadUsers();
    }, []);

    useEffect(() => {
        const text = query.trim();

        if (text.length < MIN_SEARCH_LENGTH || selectedPlayer) {
            setResults([]);
            setSearching(false);
            return;
        }

        setSearching(true);

        let cancelled = false;

        const timer = setTimeout(() => {
            searchPlayers(text)
                .then((data) => {
                    if (!cancelled) {
                        setResults(data);
                    }
                })
                .catch(() => {
                    if (!cancelled) {
                        setResults([]);
                    }
                })
                .finally(() => {
                    if (!cancelled) {
                        setSearching(false);
                    }
                });
        }, SEARCH_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [query, selectedPlayer]);

    useEffect(() => {
        if (!rosterTeamId) {
            setTeamRoster(null);
            setRosterError(null);
            return;
        }

        let cancelled = false;
        setRosterLoading(true);
        setRosterError(null);

        getTeamRoster(Number(rosterTeamId))
            .then((data) => {
                if (!cancelled) {
                    setTeamRoster(data);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setRosterError('Impossible de charger cette équipe.');
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setRosterLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [rosterTeamId]);

    // --- Swap section: load the roster of the selected team ---
    useEffect(() => {
        if (!swapTeamId) {
            setSwapTeamRoster(null);
            setSwapError(null);
            return;
        }

        let cancelled = false;
        setSwapLoading(true);
        setSwapError(null);

        getTeamRoster(Number(swapTeamId))
            .then((data) => {
                if (!cancelled) {
                    setSwapTeamRoster(data);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setSwapError('Impossible de charger cette équipe.');
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setSwapLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [swapTeamId]);

    // Reset the swap dropdowns whenever the team changes.
    useEffect(() => {
        setAbPlayerAId('');
        setAbPlayerBId('');
        setPrProspectId('');
        setPrTargetId('');
        setSwapSuccess(null);
        setSwapError(null);
    }, [swapTeamId]);

    function handleSelect(player: PlayerSearchResult) {
        setSelectedPlayer(player);
        setQuery(`${player.firstName} ${player.lastName}`);
        setResults([]);
        setReleaseArmed(false);

        if (player.rosterEntryId != null) {
            setFantasyTeamId(player.fantasyTeamId != null ? String(player.fantasyTeamId) : '');
            setRosterStatus(player.rosterStatus ?? 'Active');
        } else {
            setFantasyTeamId('');
            setRosterStatus('Active');
        }

        setSuccess(null);
        setError(null);
    }

    function resetForm() {
        setQuery('');
        setResults([]);
        setSelectedPlayer(null);
        setFantasyTeamId('');
        setRosterStatus('Active');
        setReleaseArmed(false);
    }

    async function refreshRosterIfVisible() {
        if (!rosterTeamId || !teamRoster) {
            return;
        }

        try {
            setTeamRoster(await getTeamRoster(Number(rosterTeamId)));
        } catch {
            setRosterError('Impossible de recharger cette équipe.');
        }
    }

    // ---------------------------------------------------------------
    // Swap section: derived lists
    // ---------------------------------------------------------------

    const swapEntries = swapTeamRoster?.entries ?? [];

    const activeOrBenchByGroup = useMemo(() => {
        const groups: Record<PositionGroup, RosterEntry[]> = {
            F: [], D: [], G: [], U: [],
        };

        for (const entry of swapEntries) {
            if (entry.rosterStatus !== 'Active' && entry.rosterStatus !== 'Bench') {
                continue;
            }
            groups[positionGroup(entry.position)].push(entry);
        }

        return groups;
    }, [swapEntries]);

    const prospectsByGroup = useMemo(() => {
        const groups: Record<PositionGroup, RosterEntry[]> = {
            F: [], D: [], G: [], U: [],
        };

        for (const entry of swapEntries) {
            if (entry.rosterStatus !== 'Prospect') continue;
            groups[positionGroup(entry.position)].push(entry);
        }

        return groups;
    }, [swapEntries]);

    // --- Active <-> Bench: pick the two players of the same group ---

    // Whichever side the user picked first defines the group filter.
    const abSelectedGroup = useMemo<PositionGroup | null>(() => {
        const fromA = swapEntries.find((e) => String(e.playerId) === abPlayerAId);
        if (fromA) return positionGroup(fromA.position);

        const fromB = swapEntries.find((e) => String(e.playerId) === abPlayerBId);
        if (fromB) return positionGroup(fromB.position);

        return null;
    }, [swapEntries, abPlayerAId, abPlayerBId]);

    // Dropdown A: every Active or Bench player (optionally filtered by group).
    const abOptionsA = useMemo(() => {
        if (!abSelectedGroup) {
            return activeOrBenchByGroup.F
                .concat(activeOrBenchByGroup.D)
                .concat(activeOrBenchByGroup.G);
        }
        return activeOrBenchByGroup[abSelectedGroup];
    }, [abSelectedGroup, activeOrBenchByGroup]);

    // Dropdown B: same, minus the one already picked in A.
    const abOptionsB = useMemo(() => {
        return abOptionsA.filter(
            (e) => String(e.playerId) !== abPlayerAId,
        );
    }, [abOptionsA, abPlayerAId]);

    const abSelectionValid =
        abPlayerAId !== '' &&
        abPlayerBId !== '' &&
        abEffectiveAt !== '' &&
        abSelectedGroup !== null;

    // --- Prospect swap: prospect first, then target ---

    const prProspect = useMemo(
        () => swapEntries.find((e) => String(e.playerId) === prProspectId) ?? null,
        [swapEntries, prProspectId],
    );

    const prProspectGroup = prProspect
        ? positionGroup(prProspect.position)
        : null;

    // Target dropdown unlocks only after a prospect is picked.
    // Shows Active or Bench players of the SAME position group.
    const prTargets = useMemo(() => {
        if (!prProspectGroup) return [];
        return activeOrBenchByGroup[prProspectGroup];
    }, [prProspectGroup, activeOrBenchByGroup]);

    const prSelectionValid =
        prProspectId !== '' &&
        prTargetId !== '' &&
        prEffectiveAt !== '' &&
        prProspectGroup !== null;

    // ---------------------------------------------------------------
    // Swap section: submit handlers
    // ---------------------------------------------------------------

    async function runSwap(
        label: string,
        playerAId: number,
        playerBId: number,
        localEffectiveAt: string,
    ) {
        if (!swapTeamRoster) return;

        const iso = localDateTimeToUtcIso(localEffectiveAt);
        if (!iso) {
            setSwapError('Date et heure invalides.');
            return;
        }

        setSwapSubmitting(true);
        setSwapError(null);
        setSwapSuccess(null);

        try {
            const result = await swapRosterStatus({
                fantasyTeamId: swapTeamRoster.fantasyTeamId,
                playerAId,
                playerBId,
                effectiveAt: iso,
                note: label,
            });

            setSwapSuccess(result.message);

            // Refresh the local swap roster so dropdowns reflect the
            // new statuses immediately.
            const fresh = await getTeamRoster(swapTeamRoster.fantasyTeamId);
            setSwapTeamRoster(fresh);

            // Also refresh the "Alignement d'une équipe" panel if it's
            // showing the same team.
            if (rosterTeamId === String(swapTeamRoster.fantasyTeamId)) {
                setTeamRoster(fresh);
            }

            setAbPlayerAId('');
            setAbPlayerBId('');
            setPrProspectId('');
            setPrTargetId('');
        } catch (err) {
            setSwapError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setSwapSubmitting(false);
        }
    }

    function handleActiveBenchSwap() {
        if (!abSelectionValid) return;
        return runSwap(
            'Swap Active <-> Bench',
            Number(abPlayerAId),
            Number(abPlayerBId),
            abEffectiveAt,
        );
    }

    function handleProspectSwap() {
        if (!prSelectionValid) return;
        return runSwap(
            'Swap Prospect <-> Active/Bench',
            Number(prProspectId),
            Number(prTargetId),
            prEffectiveAt,
        );
    }

    // ---------------------------------------------------------------
    // Team history section
    // ---------------------------------------------------------------

    const CURRENT_SEASON_NHL_CODE = 20262027;

    useEffect(() => {
        if (!histTeamId) {
            setHistRoster(null);
            setHistoryByPlayer({});
            setExpandedPlayerId(null);
            setHistError(null);
            setHistSuccess(null);
            return;
        }

        let cancelled = false;
        setHistLoading(true);
        setHistError(null);
        setHistSuccess(null);
        setExpandedPlayerId(null);

        getTeamRoster(Number(histTeamId))
            .then((data) => {
                if (!cancelled) {
                    setHistRoster(data);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setHistError('Impossible de charger cette équipe.');
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setHistLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [histTeamId]);

    async function togglePlayerHistory(playerId: number) {
        if (expandedPlayerId === playerId) {
            setExpandedPlayerId(null);
            return;
        }

        setExpandedPlayerId(playerId);

        if (historyByPlayer[playerId] != null) {
            return;
        }

        try {
            const rows = await getRosterStatusHistory(
                playerId,
                histRoster?.seasonId,
            );
            setHistoryByPlayer((prev) => ({
                ...prev,
                [playerId]: rows,
            }));
        } catch {
            setHistError(
                "Impossible de charger l'historique de ce joueur.",
            );
        }
    }

    async function reloadPlayerHistory(playerId: number) {
        try {
            const rows = await getRosterStatusHistory(
                playerId,
                histRoster?.seasonId,
            );
            setHistoryByPlayer((prev) => ({
                ...prev,
                [playerId]: rows,
            }));
        } catch {
            setHistError(
                "Impossible de recharger l'historique de ce joueur.",
            );
        }
    }

    function beginEditRow(row: RosterStatusHistoryRow) {
        setEditingRowId(row.id);

        // datetime-local expects "YYYY-MM-DDTHH:mm" in local time.
        const d = new Date(row.effectiveAt);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        setEditingEffectiveAt(`${yyyy}-${mm}-${dd}T00:00`);
        setEditingNote(row.note ?? '');
    }

    async function saveEditedRow(playerId: number) {
        if (editingRowId == null) return;

        const iso = localDateTimeToUtcIso(editingEffectiveAt);
        if (!iso) {
            setHistError('Date et heure invalides.');
            return;
        }

        setHistoryBusy(true);
        setHistError(null);
        setHistSuccess(null);

        try {
            const result = await updateStatusHistory(editingRowId, {
                effectiveAt: iso,
                note: editingNote.trim() || undefined,
            });

            await recomputeTeamTotals(CURRENT_SEASON_NHL_CODE);
            await reloadPlayerHistory(playerId);

            setHistSuccess(result.message);
            setEditingRowId(null);
            setEditingEffectiveAt('');
            setEditingNote('');
        } catch (err) {
            setHistError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setHistoryBusy(false);
        }
    }

    async function deleteHistoryRow(
        playerId: number,
        rowId: number,
    ) {
        if (!window.confirm(
            'Supprimer cette ligne d’historique ? ' +
            'Toutes les lignes au même instant pour ce joueur seront ' +
            'supprimées.'
        )) {
            return;
        }

        setHistoryBusy(true);
        setHistError(null);
        setHistSuccess(null);

        try {
            const result = await deleteStatusHistory(rowId);

            await recomputeTeamTotals(CURRENT_SEASON_NHL_CODE);
            await reloadPlayerHistory(playerId);

            setHistSuccess(result.message);
        } catch (err) {
            setHistError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setHistoryBusy(false);
        }
    }

    // ---------------------------------------------------------------
    // Users section
    // ---------------------------------------------------------------

    async function loadUsers() {
        setUsersLoading(true);
        setUsersError(null);

        try {
            const data = await getUsers();
            setAdminUsers(data);
        } catch (err) {
            setUsersError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setUsersLoading(false);
        }
    }

    async function handlePromote(userId: number) {
        setUsersBusyId(userId);
        setUsersError(null);
        setUsersSuccess(null);

        try {
            const result = await promoteUser(userId);
            setUsersSuccess(result.message);
            await loadUsers();
        } catch (err) {
            setUsersError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setUsersBusyId(null);
        }
    }

    async function handleDemote(userId: number) {
        setUsersBusyId(userId);
        setUsersError(null);
        setUsersSuccess(null);

        try {
            const result = await demoteUser(userId);
            setUsersSuccess(result.message);
            await loadUsers();
        } catch (err) {
            setUsersError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setUsersBusyId(null);
        }
    }

    async function handleResetPassword(userId: number) {
        if (!resetPasswordValue) {
            setUsersError('Entrez un nouveau mot de passe.');
            return;
        }

        setUsersBusyId(userId);
        setUsersError(null);
        setUsersSuccess(null);

        try {
            const result = await resetUserPassword(userId, resetPasswordValue);
            setUsersSuccess(result.message);
            setResetPasswordFor(null);
            setResetPasswordValue('');
        } catch (err) {
            setUsersError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setUsersBusyId(null);
        }
    }

    async function handleAssignTeam(userId: number) {
        if (!assignTeamValue) {
            setUsersError('Choisissez une équipe.');
            return;
        }

        setUsersBusyId(userId);
        setUsersError(null);
        setUsersSuccess(null);

        try {
            const result = await assignUserTeam(userId, Number(assignTeamValue));
            setUsersSuccess(result.message);
            setAssignTeamFor(null);
            setAssignTeamValue('');
            await loadUsers();
        } catch (err) {
            setUsersError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setUsersBusyId(null);
        }
    }

    async function handleUnassignTeam(userId: number) {
        setUsersBusyId(userId);
        setUsersError(null);
        setUsersSuccess(null);

        try {
            const result = await unassignUserTeam(userId);
            setUsersSuccess(result.message);
            await loadUsers();
        } catch (err) {
            setUsersError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setUsersBusyId(null);
        }
    }

    function handleRosterEntrySelect(entry: RosterEntry) {
        const selection: PlayerSearchResult = {
            playerId: entry.playerId,
            nhlPlayerId: entry.nhlPlayerId,
            firstName: entry.firstName,
            lastName: entry.lastName,
            position: entry.position,
            nhlTeamAbbreviation: entry.nhlTeamAbbreviation,
            rosterEntryId: entry.id,
            rosterStatus: entry.rosterStatus,
            fantasyTeamId: teamRoster?.fantasyTeamId,
            fantasyTeamName: teamRoster?.fantasyTeamName,
        };

        setSelectedPlayer(selection);
        setQuery(`${entry.firstName} ${entry.lastName}`);
        setResults([]);
        setReleaseArmed(false);
        setFantasyTeamId(
            teamRoster?.fantasyTeamId != null ? String(teamRoster.fantasyTeamId) : '',
        );
        setRosterStatus(entry.rosterStatus ?? 'Active');
        setSuccess(null);
        setError(null);
    }

    async function runMovement(call: () => Promise<{ message: string }>) {
        setSubmitting(true);
        setError(null);
        setSuccess(null);

        try {
            const result = await call();

            setSuccess(result.message);
            resetForm();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Erreur lors de l'opération.");
        } finally {
            setSubmitting(false);
        }
    }

    function handleAssign() {
        if (!selectedPlayer || !fantasyTeamId) {
            return;
        }

        const playerId = selectedPlayer.playerId;

        return runMovement(async () => {
            const result = await assignPlayer({
                fantasyTeamId: Number(fantasyTeamId),
                playerId,
                rosterStatus,
            });

            void refreshRosterIfVisible();

            return result;
        });
    }

    async function handleCombinedUpdate() {
        if (!selectedPlayer?.rosterEntryId) {
            return;
        }

        // Capture the id in a local so TS narrowing survives into the
        // try block below.
        const entryId = selectedPlayer.rosterEntryId;

        // A team change is a trade and needs an EffectiveAt.
        const teamIsChanging =
            selectedPlayer.fantasyTeamId != null &&
            String(selectedPlayer.fantasyTeamId) !== fantasyTeamId;

        let effectiveAtIso: string | undefined;

        if (teamIsChanging) {
            const iso = localDateTimeToUtcIso(updateEffectiveAt);
            if (!iso) {
                setError(
                    "Un changement d'équipe est un échange et nécessite " +
                    'une date et une heure valides.',
                );
                return;
            }
            effectiveAtIso = iso;
        }

        setSubmitting(true);
        setError(null);
        setSuccess(null);

        try {
            const result = await updateRosterEntry({
                rosterEntryId: entryId,
                rosterStatus,
                fantasyTeamId: Number(fantasyTeamId),
                effectiveAt: effectiveAtIso,
            });

            setSuccess(result.message);
            void refreshRosterIfVisible();

            resetForm();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Erreur inconnue.');
        } finally {
            setSubmitting(false);
        }
    }

    function handleRelease() {
        if (!selectedPlayer?.rosterEntryId) {
            return;
        }

        const entryId = selectedPlayer.rosterEntryId;

        return runMovement(async () => {
            const result = await releasePlayer({
                rosterEntryId: entryId,
            });

            void refreshRosterIfVisible();

            return result;
        });
    }

    const isAssigned = selectedPlayer?.rosterEntryId != null;

    const currentStatusLabel = selectedPlayer
        ? ROSTER_STATUSES.find(
            (status) => status.value === selectedPlayer.rosterStatus,
        )?.label
        : undefined;

    const assignDisabled = submitting || !selectedPlayer || !fantasyTeamId;

    return (
        <section className='space-y-6'>
            <div>
                <h2 className='text-2xl font-semibold text-foreground'>
                    Gestion des joueurs
                </h2>

                <p className='mt-1 text-muted-foreground'>
                    Recherchez un joueur, puis ajoutez-le à une équipe, transférez-le,
                    changez son statut ou libérez-le.
                </p>
            </div>

            {success && (
                <p className='rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400'>
                    {success}
                </p>
            )}

            {error && (
                <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                    {error}
                </p>
            )}

            <div className='max-w-lg space-y-3'>
                <div className='relative'>
                    <input
                        type='text'
                        value={query}
                        autoComplete='off'
                        onChange={(event) => {
                            setQuery(event.target.value);
                            setSelectedPlayer(null);
                        }}
                        placeholder='Rechercher un joueur (min. 2 lettres)'
                        className={selectClass}
                    />

                    {results.length > 0 && (
                        <div className='absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg'>
                            {results.map((player) => (
                                <button
                                    key={player.playerId}
                                    type='button'
                                    onClick={() => handleSelect(player)}
                                    className='flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-secondary'
                                >
                                    <span className='text-foreground'>
                                        {player.firstName} {player.lastName}
                                    </span>

                                    <span className='text-xs text-muted-foreground'>
                                        {player.nhlTeamAbbreviation} · {player.position}

                                        {player.fantasyTeamName ? (
                                            <span className='text-primary'>
                                                {' '}
                                                (déjà avec {player.fantasyTeamName})
                                            </span>
                                        ) : null}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {!searching &&
                    !selectedPlayer &&
                    query.trim().length >= MIN_SEARCH_LENGTH &&
                    results.length === 0 && (
                        <p className='text-sm text-muted-foreground'>
                            Aucun joueur trouvé.
                        </p>
                    )}

                {selectedPlayer && !isAssigned && (
                    <>
                        <select
                            value={fantasyTeamId}
                            onChange={(event) => setFantasyTeamId(event.target.value)}
                            className={selectClass}
                        >
                            <option value='' disabled>
                                Choisir une équipe
                            </option>

                            {teams.map((team) => (
                                <option key={team.id} value={team.id}>
                                    {team.name}
                                </option>
                            ))}
                        </select>

                        <select
                            value={rosterStatus}
                            onChange={(event) => setRosterStatus(event.target.value)}
                            className={selectClass}
                        >
                            {ROSTER_STATUSES.map((status) => (
                                <option key={status.value} value={status.value}>
                                    {status.label}
                                </option>
                            ))}
                        </select>

                        <button
                            type='button'
                            onClick={handleAssign}
                            disabled={assignDisabled}
                            className={primaryButtonClass}
                        >
                            {submitting ? 'Ajout...' : 'Ajouter le joueur'}
                        </button>
                    </>
                )}

                {selectedPlayer && isAssigned && (
                    <>
                        <div className='rounded-lg border border-border bg-card px-3 py-2 text-sm'>
                            <p className='text-foreground'>
                                Équipe actuelle : {selectedPlayer.fantasyTeamName ?? '—'}
                            </p>

                            <p className='text-muted-foreground'>
                                Statut actuel : {currentStatusLabel ?? '—'}
                            </p>
                        </div>

                        <label className='text-sm font-medium text-muted-foreground'>
                            Équipe
                        </label>

                        <select
                            value={fantasyTeamId}
                            onChange={(event) => setFantasyTeamId(event.target.value)}
                            className={selectClass}
                        >
                            {teams.map((team) => (
                                <option key={team.id} value={team.id}>
                                    {team.name}
                                </option>
                            ))}
                        </select>

                        <label className='text-sm font-medium text-muted-foreground'>
                            Statut
                        </label>

                        <select
                            value={rosterStatus}
                            onChange={(event) => setRosterStatus(event.target.value)}
                            className={selectClass}
                        >
                            {ROSTER_STATUSES.map((status) => (
                                <option key={status.value} value={status.value}>
                                    {status.label}
                                </option>
                            ))}
                        </select>

                        <label className='text-sm font-medium text-muted-foreground'>
                            Date et heure d'entrée en vigueur (échange seulement)
                        </label>

                        <input
                            type='datetime-local'
                            value={updateEffectiveAt}
                            onChange={(event) =>
                                setUpdateEffectiveAt(event.target.value)
                            }
                            className={selectClass}
                        />

                        <button
                            type='button'
                            onClick={handleCombinedUpdate}
                            disabled={submitting || !fantasyTeamId}
                            className={primaryButtonClass}
                        >
                            Mettre à jour
                        </button>

                        <p className='text-sm font-semibold uppercase tracking-wide text-muted-foreground'>
                            Libérer
                        </p>

                        {!releaseArmed ? (
                            <button
                                type='button'
                                onClick={() => setReleaseArmed(true)}
                                disabled={submitting}
                                className={dangerButtonClass}
                            >
                                Libérer
                            </button>
                        ) : (
                            <div className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm'>
                                <p className='text-destructive'>
                                    Confirmer la libération de {selectedPlayer.firstName}{' '}
                                    {selectedPlayer.lastName} ?
                                </p>

                                <div className='mt-2 flex gap-2'>
                                    <button
                                        type='button'
                                        onClick={handleRelease}
                                        disabled={submitting}
                                        className={dangerButtonClass}
                                    >
                                        Oui, libérer
                                    </button>

                                    <button
                                        type='button'
                                        onClick={() => setReleaseArmed(false)}
                                        disabled={submitting}
                                        className={secondaryButtonClass}
                                    >
                                        Annuler
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            <div className='max-w-lg space-y-3'>
                <h3 className='text-lg font-semibold text-foreground'>
                    Alignement d'une équipe
                </h3>

                <select
                    value={rosterTeamId}
                    onChange={(event) => setRosterTeamId(event.target.value)}
                    className={selectClass}
                >
                    <option value='' disabled>
                        Choisir une équipe
                    </option>

                    {teams.map((team) => (
                        <option key={team.id} value={team.id}>
                            {team.name}
                        </option>
                    ))}
                </select>

                {rosterLoading && (
                    <p className='text-sm text-muted-foreground'>
                        Chargement...
                    </p>
                )}

                {rosterError && (
                    <p className='text-sm text-destructive'>
                        {rosterError}
                    </p>
                )}

                {teamRoster && teamRoster.entries.length === 0 && (
                    <p className='text-sm text-muted-foreground'>
                        Aucun joueur dans cette équipe.
                    </p>
                )}

                {teamRoster && teamRoster.entries.length > 0 && (
                    <ul className='space-y-1'>
                        {teamRoster.entries.map((entry) => (
                            <li key={entry.id}>
                                <button
                                    type='button'
                                    onClick={() => handleRosterEntrySelect(entry)}
                                    className='w-full cursor-pointer rounded-lg px-3 py-1.5 text-left text-sm text-foreground hover:bg-secondary'
                                >
                                    {entry.firstName} {entry.lastName}

                                    <span className='ml-2 text-xs text-muted-foreground'>
                                        · {entry.position} · {statusLabel(entry.rosterStatus)}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* ============================================================
                Changement de statut (swaps)
                ============================================================ */}
            <div className='max-w-3xl space-y-3'>
                <h3 className='text-lg font-semibold text-foreground'>
                    Changement de statut
                </h3>

                <p className='text-sm text-muted-foreground'>
                    Chaque changement est un échange entre deux joueurs du
                    même groupe de position. Le format 12F/6D/1G actifs,
                    4F/2D/1G banc, 3 prospects est toujours respecté.
                </p>

                <select
                    value={swapTeamId}
                    onChange={(event) => setSwapTeamId(event.target.value)}
                    className={selectClass}
                >
                    <option value='' disabled>
                        Choisir une équipe
                    </option>
                    {teams.map((team) => (
                        <option key={team.id} value={team.id}>
                            {team.name}
                        </option>
                    ))}
                </select>

                {swapLoading && (
                    <p className='text-sm text-muted-foreground'>
                        Chargement...
                    </p>
                )}

                {swapError && (
                    <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                        {swapError}
                    </p>
                )}

                {swapSuccess && (
                    <p className='rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400'>
                        {swapSuccess}
                    </p>
                )}

                {swapTeamRoster && (
                    <>
                        {/* ------- Active <-> Bench ------- */}
                        <div className='space-y-3 rounded-lg border border-border bg-card p-3'>
                            <h4 className='text-sm font-semibold uppercase tracking-wide text-muted-foreground'>
                                Actif &lt;-&gt; Banc
                            </h4>

                            <label className='text-sm font-medium text-muted-foreground'>
                                Date et heure d'entrée en vigueur
                            </label>
                            <input
                                type='datetime-local'
                                value={abEffectiveAt}
                                onChange={(event) =>
                                    setAbEffectiveAt(event.target.value)
                                }
                                className={selectClass}
                            />

                            <label className='text-sm font-medium text-muted-foreground'>
                                Joueur A
                            </label>
                            <select
                                value={abPlayerAId}
                                onChange={(event) => {
                                    setAbPlayerAId(event.target.value);
                                    setAbPlayerBId('');
                                }}
                                className={selectClass}
                            >
                                <option value=''>Choisir un joueur</option>
                                {abOptionsA.map((entry) => (
                                    <option
                                        key={entry.playerId}
                                        value={entry.playerId}
                                    >
                                        {entry.firstName} {entry.lastName} ·{' '}
                                        {entry.position} · {entry.rosterStatus}
                                    </option>
                                ))}
                            </select>

                            <label className='text-sm font-medium text-muted-foreground'>
                                Joueur B
                            </label>
                            <select
                                value={abPlayerBId}
                                onChange={(event) =>
                                    setAbPlayerBId(event.target.value)
                                }
                                disabled={abPlayerAId === ''}
                                className={selectClass}
                            >
                                <option value=''>Choisir un joueur</option>
                                {abOptionsB.map((entry) => (
                                    <option
                                        key={entry.playerId}
                                        value={entry.playerId}
                                    >
                                        {entry.firstName} {entry.lastName} ·{' '}
                                        {entry.position} · {entry.rosterStatus}
                                    </option>
                                ))}
                            </select>

                            {abSelectedGroup && (
                                <p className='text-xs text-muted-foreground'>
                                    Groupe filtré : {groupLabel(abSelectedGroup)}
                                </p>
                            )}

                            <button
                                type='button'
                                onClick={handleActiveBenchSwap}
                                disabled={!abSelectionValid || swapSubmitting}
                                className={primaryButtonClass}
                            >
                                {swapSubmitting ? 'Traitement...' : 'Échanger'}
                            </button>
                        </div>

                        {/* ------- Prospect <-> Actif/Banc ------- */}
                        <div className='space-y-3 rounded-lg border border-border bg-card p-3'>
                            <h4 className='text-sm font-semibold uppercase tracking-wide text-muted-foreground'>
                                Prospect &lt;-&gt; Actif/Banc
                            </h4>

                            <label className='text-sm font-medium text-muted-foreground'>
                                Date et heure d'entrée en vigueur
                            </label>
                            <input
                                type='datetime-local'
                                value={prEffectiveAt}
                                onChange={(event) =>
                                    setPrEffectiveAt(event.target.value)
                                }
                                className={selectClass}
                            />

                            <label className='text-sm font-medium text-muted-foreground'>
                                Prospect
                            </label>
                            <select
                                value={prProspectId}
                                onChange={(event) => {
                                    setPrProspectId(event.target.value);
                                    setPrTargetId('');
                                }}
                                className={selectClass}
                            >
                                <option value=''>Choisir un prospect</option>
                                {(['F', 'D', 'G'] as const).flatMap((g) =>
                                    prospectsByGroup[g].map((entry) => (
                                        <option
                                            key={entry.playerId}
                                            value={entry.playerId}
                                        >
                                            {entry.firstName} {entry.lastName} ·{' '}
                                            {entry.position}
                                        </option>
                                    )),
                                )}
                            </select>

                            <label className='text-sm font-medium text-muted-foreground'>
                                Joueur Actif ou Banc (même groupe)
                            </label>
                            <select
                                value={prTargetId}
                                onChange={(event) =>
                                    setPrTargetId(event.target.value)
                                }
                                disabled={prProspectId === ''}
                                className={selectClass}
                            >
                                <option value=''>
                                    {prProspectId === ''
                                        ? 'Sélectionnez un prospect en premier'
                                        : prTargets.length === 0
                                            ? 'Aucun joueur admissible'
                                            : 'Choisir un joueur'}
                                </option>
                                {prTargets.map((entry) => (
                                    <option
                                        key={entry.playerId}
                                        value={entry.playerId}
                                    >
                                        {entry.firstName} {entry.lastName} ·{' '}
                                        {entry.position} · {entry.rosterStatus}
                                    </option>
                                ))}
                            </select>

                            {prProspectGroup && (
                                <p className='text-xs text-muted-foreground'>
                                    Groupe filtré : {groupLabel(prProspectGroup)}
                                </p>
                            )}

                            <button
                                type='button'
                                onClick={handleProspectSwap}
                                disabled={!prSelectionValid || swapSubmitting}
                                className={primaryButtonClass}
                            >
                                {swapSubmitting ? 'Traitement...' : 'Échanger'}
                            </button>
                        </div>
                    </>
                )}
            </div>

            {/* ============================================================
                Historique d'équipe
                ============================================================ */}
            <div className='max-w-3xl space-y-3'>
                <h3 className='text-lg font-semibold text-foreground'>
                    Historique d'équipe
                </h3>

                <p className='text-sm text-muted-foreground'>
                    Sélectionnez une équipe, puis cliquez sur un joueur pour
                    voir l'historique de ses changements d'équipe et de
                    statut. Vous pouvez corriger la date d'une ligne ou la
                    supprimer. Après chaque modification, les totaux sont
                    recalculés automatiquement.
                </p>

                <select
                    value={histTeamId}
                    onChange={(event) => setHistTeamId(event.target.value)}
                    className={selectClass}
                >
                    <option value='' disabled>
                        Choisir une équipe
                    </option>
                    {teams.map((team) => (
                        <option key={team.id} value={team.id}>
                            {team.name}
                        </option>
                    ))}
                </select>

                {histLoading && (
                    <p className='text-sm text-muted-foreground'>
                        Chargement...
                    </p>
                )}

                {histError && (
                    <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                        {histError}
                    </p>
                )}

                {histSuccess && (
                    <p className='rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400'>
                        {histSuccess}
                    </p>
                )}

                {histRoster && histRoster.entries.length === 0 && (
                    <p className='text-sm text-muted-foreground'>
                        Aucun joueur dans cette équipe.
                    </p>
                )}

                {histRoster && histRoster.entries.length > 0 && (
                    <ul className='space-y-1'>
                        {histRoster.entries.map((entry) => {
                            const isOpen = expandedPlayerId === entry.playerId;
                            const rows = historyByPlayer[entry.playerId];

                            return (
                                <li
                                    key={entry.id}
                                    className='rounded-lg border border-border bg-card'
                                >
                                    <button
                                        type='button'
                                        onClick={() =>
                                            void togglePlayerHistory(entry.playerId)
                                        }
                                        className='flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-secondary'
                                    >
                                        <span className='text-foreground'>
                                            {entry.firstName} {entry.lastName}
                                            <span className='ml-2 text-xs text-muted-foreground'>
                                                · {entry.position} · {entry.rosterStatus}
                                            </span>
                                        </span>
                                        <span className='text-xs text-muted-foreground'>
                                            {isOpen ? '▲' : '▼'}
                                        </span>
                                    </button>

                                    {isOpen && (
                                        <div className='border-t border-border px-3 py-2'>
                                            {rows == null && (
                                                <p className='text-xs text-muted-foreground'>
                                                    Chargement...
                                                </p>
                                            )}

                                            {rows != null && rows.length === 0 && (
                                                <p className='text-xs text-muted-foreground'>
                                                    Aucune ligne d'historique.
                                                </p>
                                            )}

                                            {rows != null && rows.length > 0 && (
                                                <table className='w-full text-xs'>
                                                    <thead>
                                                        <tr className='text-left text-muted-foreground'>
                                                            <th className='py-1 pr-2'>Équipe</th>
                                                            <th className='py-1 pr-2'>Statut</th>
                                                            <th className='py-1 pr-2'>Date effective</th>
                                                            <th className='py-1 pr-2'>Note</th>
                                                            <th className='py-1' />
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {rows.map((row) => {
                                                            const isEditing =
                                                                editingRowId === row.id;

                                                            return (
                                                                <tr
                                                                    key={row.id}
                                                                    className='border-t border-border/40 align-top'
                                                                >
                                                                    <td className='py-1 pr-2 text-foreground'>
                                                                        {row.fantasyTeamName}
                                                                    </td>
                                                                    <td className='py-1 pr-2 text-foreground'>
                                                                        {row.rosterStatus}
                                                                    </td>
                                                                    <td className='py-1 pr-2 text-foreground'>
                                                                        {isEditing ? (
                                                                            <input
                                                                                type='datetime-local'
                                                                                value={editingEffectiveAt}
                                                                                onChange={(event) =>
                                                                                    setEditingEffectiveAt(event.target.value)
                                                                                }
                                                                                className='rounded border border-border bg-background px-2 py-1 text-xs'
                                                                            />
                                                                        ) : (
                                                                            row.effectiveAt.slice(0, 10)
                                                                        )}
                                                                    </td>
                                                                    <td className='py-1 pr-2 text-muted-foreground'>
                                                                        {isEditing ? (
                                                                            <input
                                                                                type='text'
                                                                                value={editingNote}
                                                                                onChange={(event) =>
                                                                                    setEditingNote(event.target.value)
                                                                                }
                                                                                placeholder='Note (optionnel)'
                                                                                className='w-full rounded border border-border bg-background px-2 py-1 text-xs'
                                                                            />
                                                                        ) : (
                                                                            row.note ?? '—'
                                                                        )}
                                                                    </td>
                                                                    <td className='whitespace-nowrap py-1 text-right'>
                                                                        {isEditing ? (
                                                                            <>
                                                                                <button
                                                                                    type='button'
                                                                                    onClick={() => void saveEditedRow(entry.playerId)}
                                                                                    disabled={historyBusy}
                                                                                    className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50'
                                                                                >
                                                                                    Enregistrer
                                                                                </button>
                                                                                <button
                                                                                    type='button'
                                                                                    onClick={() => setEditingRowId(null)}
                                                                                    disabled={historyBusy}
                                                                                    className='ml-2 cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50'
                                                                                >
                                                                                    Annuler
                                                                                </button>
                                                                            </>
                                                                        ) : (
                                                                            <>
                                                                                <button
                                                                                    type='button'
                                                                                    onClick={() => beginEditRow(row)}
                                                                                    disabled={historyBusy}
                                                                                    className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50'
                                                                                >
                                                                                    Modifier
                                                                                </button>
                                                                                <button
                                                                                    type='button'
                                                                                    onClick={() =>
                                                                                        void deleteHistoryRow(entry.playerId, row.id)
                                                                                    }
                                                                                    disabled={historyBusy}
                                                                                    className='ml-2 cursor-pointer rounded border border-destructive/40 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50'
                                                                                >
                                                                                    Supprimer
                                                                                </button>
                                                                            </>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            )}
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {/* ============================================================
                Utilisateurs
                ============================================================ */}
            <div className='max-w-4xl space-y-3'>
                <h3 className='text-lg font-semibold text-foreground'>
                    Utilisateurs
                </h3>

                <p className='text-sm text-muted-foreground'>
                    Liste des comptes enregistrés. Assignez une équipe,
                    gérez les rôles de commissaire, ou réinitialisez un
                    mot de passe.
                </p>

                {usersError && (
                    <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                        {usersError}
                    </p>
                )}

                {usersSuccess && (
                    <p className='rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400'>
                        {usersSuccess}
                    </p>
                )}

                {usersLoading && (
                    <p className='text-sm text-muted-foreground'>
                        Chargement...
                    </p>
                )}

                {!usersLoading && adminUsers.length === 0 && (
                    <p className='text-sm text-muted-foreground'>
                        Aucun utilisateur enregistré.
                    </p>
                )}

                {!usersLoading && adminUsers.length > 0 && (
                    <div className='overflow-x-auto rounded-lg border border-border bg-card'>
                        <table className='w-full min-w-[720px] text-sm'>
                            <thead className='border-b border-border text-xs uppercase tracking-wide text-foreground'>
                                <tr>
                                    <th className='px-2 py-2 text-left font-medium'>Utilisateur</th>
                                    <th className='px-2 py-2 text-left font-medium'>Équipe</th>
                                    <th className='px-2 py-2 text-center font-medium'>Commissaire</th>
                                    <th className='px-2 py-2 text-center font-medium'>Actions</th>
                                </tr>
                            </thead>
                            <tbody className='text-foreground'>
                                {adminUsers.map((u, index) => (
                                    <tr
                                        key={u.id}
                                        className={
                                            index % 2 === 0
                                                ? 'bg-transparent'
                                                : 'bg-secondary/20'
                                        }
                                    >
                                        <td className='px-2 py-2 align-top'>
                                            <div className='font-medium'>
                                                {u.userName}
                                            </div>
                                        </td>
                                        <td className='px-2 py-2 align-top'>
                                            {u.fantasyTeamName ?? '—'}
                                        </td>
                                        <td className='px-2 py-2 text-center align-top'>
                                            {u.isCommissioner ? '✓' : ''}
                                        </td>
                                        <td className='px-2 py-2 text-center align-top'>
                                            <div className='flex flex-wrap items-center justify-center gap-2'>
                                                {/* Promote / demote */}
                                                {u.isCommissioner ? (
                                                    <button
                                                        type='button'
                                                        onClick={() => void handleDemote(u.id)}
                                                        disabled={usersBusyId === u.id}
                                                        className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50'
                                                    >
                                                        Retirer commissaire
                                                    </button>
                                                ) : (
                                                    <button
                                                        type='button'
                                                        onClick={() => void handlePromote(u.id)}
                                                        disabled={usersBusyId === u.id}
                                                        className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50'
                                                    >
                                                        Promouvoir
                                                    </button>
                                                )}

                                                {/* Team assign / unassign */}
                                                {u.fantasyTeamId == null ? (
                                                    <>
                                                        {assignTeamFor === u.id ? (
                                                            <>
                                                                <select
                                                                    value={assignTeamValue}
                                                                    onChange={(event) =>
                                                                        setAssignTeamValue(event.target.value)
                                                                    }
                                                                    className='rounded border border-border bg-background px-2 py-0.5 text-xs'
                                                                >
                                                                    <option value=''>— équipe —</option>
                                                                    {teams
                                                                        .filter((t) =>
                                                                            adminUsers.every(
                                                                                (other) =>
                                                                                    other.fantasyTeamId !== t.id,
                                                                            ),
                                                                        )
                                                                        .map((t) => (
                                                                            <option key={t.id} value={t.id}>
                                                                                {t.name}
                                                                            </option>
                                                                        ))}
                                                                </select>
                                                                <button
                                                                    type='button'
                                                                    onClick={() => void handleAssignTeam(u.id)}
                                                                    disabled={usersBusyId === u.id}
                                                                    className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50'
                                                                >
                                                                    OK
                                                                </button>
                                                                <button
                                                                    type='button'
                                                                    onClick={() => {
                                                                        setAssignTeamFor(null);
                                                                        setAssignTeamValue('');
                                                                    }}
                                                                    className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary'
                                                                >
                                                                    Annuler
                                                                </button>
                                                            </>
                                                        ) : (
                                                            <button
                                                                type='button'
                                                                onClick={() => {
                                                                    setAssignTeamFor(u.id);
                                                                    setAssignTeamValue('');
                                                                }}
                                                                className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary'
                                                            >
                                                                Assigner équipe
                                                            </button>
                                                        )}
                                                    </>
                                                ) : (
                                                    <button
                                                        type='button'
                                                        onClick={() => void handleUnassignTeam(u.id)}
                                                        disabled={usersBusyId === u.id}
                                                        className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50'
                                                    >
                                                        Désassigner équipe
                                                    </button>
                                                )}

                                                {/* Reset password */}
                                                {resetPasswordFor === u.id ? (
                                                    <>
                                                        <input
                                                            type='text'
                                                            value={resetPasswordValue}
                                                            onChange={(event) =>
                                                                setResetPasswordValue(event.target.value)
                                                            }
                                                            placeholder='Nouveau mot de passe'
                                                            className='rounded border border-border bg-background px-2 py-0.5 text-xs'
                                                        />
                                                        <button
                                                            type='button'
                                                            onClick={() => void handleResetPassword(u.id)}
                                                            disabled={usersBusyId === u.id}
                                                            className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50'
                                                        >
                                                            OK
                                                        </button>
                                                        <button
                                                            type='button'
                                                            onClick={() => {
                                                                setResetPasswordFor(null);
                                                                setResetPasswordValue('');
                                                            }}
                                                            className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary'
                                                        >
                                                            Annuler
                                                        </button>
                                                    </>
                                                ) : (
                                                    <button
                                                        type='button'
                                                        onClick={() => {
                                                            setResetPasswordFor(u.id);
                                                            setResetPasswordValue('');
                                                        }}
                                                        className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary'
                                                    >
                                                        Réinitialiser mot de passe
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>


            {/* Appearance settings (hidden behind a toggle) */}
            <div className='max-w-2xl space-y-3'>
                <AuraButton
                    active={showAppearance}
                    onClick={() => setShowAppearance((v) => !v)}
                >
                    {showAppearance ? '▼ Masquer l\'apparence' : '▶ Apparence'}
                </AuraButton>

                {showAppearance && (
                    <div className='space-y-3'>
                        <div className='flex items-center justify-end'>
                            <button
                                type='button'
                                onClick={reset}
                                className={secondaryButtonClass}
                            >
                                Réinitialiser
                            </button>
                        </div>

                        <div className='space-y-6'>
                            {Object.entries(
                                AURA_CHANNELS.reduce<
                                    Record<string, typeof AURA_CHANNELS>
                                >((groups, channel) => {
                                    (groups[channel.group] ??= []).push(channel);
                                    return groups;
                                }, {}),
                            ).map(([groupName, channels]) => (
                                <div key={groupName} className='space-y-3'>
                                    <h4 className='text-sm font-semibold uppercase tracking-wide text-muted-foreground'>
                                        {groupName}
                                    </h4>

                                    <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
                                        {channels.map(({ key, label }) => (
                                            <div
                                                key={key}
                                                className='rounded-lg border border-border bg-card p-3'
                                            >
                                                <div className='flex items-center justify-between'>
                                                    <label
                                                        htmlFor={`aura-${key}`}
                                                        className='text-sm font-medium text-foreground'
                                                    >
                                                        {label}
                                                    </label>

                                                    <span className='text-sm font-semibold text-primary'>
                                                        {intensities[key]}/10
                                                    </span>
                                                </div>

                                                <input
                                                    id={`aura-${key}`}
                                                    type='range'
                                                    min='0'
                                                    max='10'
                                                    step='1'
                                                    value={intensities[key]}
                                                    onChange={(event) =>
                                                        setIntensity(key, Number(event.target.value))
                                                    }
                                                    className='mt-2 w-full cursor-pointer'
                                                />

                                                <div className='mt-1 flex justify-between text-[0.65rem] text-muted-foreground'>
                                                    <span>Off</span>
                                                    <span>Max</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
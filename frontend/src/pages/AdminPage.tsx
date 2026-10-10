import { useEffect, useMemo, useState } from 'react';
import {
    assignPlayer,
    assignUserTeam,
    clearSystemEventLogs,
    demoteUser,
    getLeagueTeams,
    getSystemEventLogs,
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
    getProtectedSalaries,
    getPlayerContracts,
    upsertProtectedSalary,
    deleteProtectedSalary,
    getManualContractPlayers,
    setPlayerSkipCapFreeze,
    createManualContract,
    updateManualContract,
    deleteManualContract,
    refreshSinglePlayer,
    startRefreshAllGameLogs,
    getJobStatus,
    type RosterStatusHistoryRow,
    type ProtectedSalaryRow,
    type PlayerContractRow,
    type ManualContractPlayerRow,
    type RefreshedPlayer,
    type AdminUserRow,
    type BackgroundJobStatus,
    type FantasyTeam,
    type PlayerSearchResult,
    type RosterEntry,
    type SystemEventLog,
    type TeamRoster,
} from '@/api/client';
import { useAuraAll } from '@/lib/auraContext';
import { AURA_CHANNELS } from '@/lib/auraConfig';
import { AuraButton } from '@/components/ui/AuraButton';
import { useAuth } from '@/lib/AuthContext';

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

/**
 * Formats a UTC ISO timestamp as a short, human-readable "time
 * since" string: "À l'instant", "Il y a 5 min", "Il y a 2 h",
 * "Il y a 3 j". Falls back to a full date when the value is more
 * than a week old, and returns "Jamais" when the value is null
 * (user has never made an authenticated request since the feature
 * shipped).
 */
function formatLastActive(iso: string | null): string {
    if (!iso) return 'Jamais';

    const date = new Date(iso);

    if (Number.isNaN(date.getTime())) return '—';

    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

    if (seconds < 60) return "À l'instant";

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Il y a ${minutes} min`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Il y a ${hours} h`;

    const days = Math.floor(hours / 24);
    if (days < 7) return `Il y a ${days} j`;

    return new Intl.DateTimeFormat('fr-CA', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    }).format(date);
}

/**
 * Sort order used by the ROSTERS export: forwards first, then
 * defensemen, then goalies, then by last name within each group.
 */
function sortRosterForExport(entries: RosterEntry[]): RosterEntry[] {
    const order: Record<PositionGroup, number> = {
        F: 0,
        D: 1,
        G: 2,
        U: 3,
    };

    return [...entries].sort((a, b) => {
        const ga = order[positionGroup(a.position)] ?? 9;
        const gb = order[positionGroup(b.position)] ?? 9;
        if (ga !== gb) return ga - gb;
        return a.lastName.localeCompare(b.lastName);
    });
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

    // Export rosters section state.
    const [exportingRosters, setExportingRosters] = useState(false);
    const [exportRostersError, setExportRostersError] = useState<string | null>(null);

    // --- Protected salaries section state (per-contract locks) ---

    const [protectedSalaries, setProtectedSalaries] = useState<
        ProtectedSalaryRow[]
    >([]);
    const [protectedSalariesLoading, setProtectedSalariesLoading] =
        useState(false);
    const [protectedSalariesError, setProtectedSalariesError] =
        useState<string | null>(null);
    const [protectedSalariesSuccess, setProtectedSalariesSuccess] =
        useState<string | null>(null);
    const [protectedSalariesBusy, setProtectedSalariesBusy] =
        useState(false);

    // Search + contracts form for adding a new protected salary.
    const [newProtectedSearch, setNewProtectedSearch] = useState('');
    const [newProtectedSearchResults, setNewProtectedSearchResults] =
        useState<PlayerSearchResult[]>([]);
    const [newProtectedSearching, setNewProtectedSearching] = useState(false);
    const [newProtectedSelectedPlayer, setNewProtectedSelectedPlayer] =
        useState<PlayerSearchResult | null>(null);
    const [newProtectedContracts, setNewProtectedContracts] = useState<
        PlayerContractRow[]
    >([]);
    const [newProtectedContractsLoading, setNewProtectedContractsLoading] =
        useState(false);
    const [newProtectedSelectedContractId, setNewProtectedSelectedContractId] =
        useState<number | null>(null);
    const [newProtectedSalaryInput, setNewProtectedSalaryInput] =
        useState('');
    const [newProtectedNoteInput, setNewProtectedNoteInput] = useState('');

    // Inline edit state for the list: which contract row is being
    // edited and what the current draft values are.
    const [editingProtectedContractId, setEditingProtectedContractId] =
        useState<number | null>(null);
    const [editingProtectedSalaryValue, setEditingProtectedSalaryValue] =
        useState('');
    const [editingProtectedNoteValue, setEditingProtectedNoteValue] =
        useState('');

    // --- Manual contracts section state ---

    const [manualPlayers, setManualPlayers] = useState<
        ManualContractPlayerRow[]
    >([]);
    const [manualPlayersLoading, setManualPlayersLoading] = useState(false);

    const [manualError, setManualError] = useState<string | null>(null);
    const [manualSuccess, setManualSuccess] = useState<string | null>(null);
    const [manualBusy, setManualBusy] = useState(false);

    // Search for a player to manage manually.
    const [manualSearch, setManualSearch] = useState('');
    const [manualSearchResults, setManualSearchResults] = useState<
        PlayerSearchResult[]
    >([]);
    const [manualSearching, setManualSearching] = useState(false);

    // Currently selected player (either from search or from the list).
    const [manualSelectedPlayer, setManualSelectedPlayer] = useState<{
        nhlPlayerId: number;
        firstName: string;
        lastName: string;
        teamAbbreviation: string | null;
        skipCapFreezeSync: boolean;
    } | null>(null);

    // The selected player's contracts.
    const [manualContracts, setManualContracts] = useState<
        PlayerContractRow[]
    >([]);
    const [manualContractsLoading, setManualContractsLoading] =
        useState(false);

    // "Add new contract" form state.
    const [manualNewStartYear, setManualNewStartYear] = useState('');
    const [manualNewEndYear, setManualNewEndYear] = useState('');
    const [manualNewSalary, setManualNewSalary] = useState('');

    // Which existing contract row is being edited inline.
    const [manualEditingContractId, setManualEditingContractId] =
        useState<number | null>(null);
    const [manualEditingStartYear, setManualEditingStartYear] = useState('');
    const [manualEditingEndYear, setManualEditingEndYear] = useState('');
    const [manualEditingSalary, setManualEditingSalary] = useState('');

    // --- Refresh single player section state ---

    const [refreshPlayerIdInput, setRefreshPlayerIdInput] = useState('');
    const [refreshPlayerBusy, setRefreshPlayerBusy] = useState(false);
    const [refreshPlayerSuccess, setRefreshPlayerSuccess] =
        useState<string | null>(null);
    const [refreshPlayerError, setRefreshPlayerError] =
        useState<string | null>(null);
    const [lastRefreshedPlayer, setLastRefreshedPlayer] =
        useState<RefreshedPlayer | null>(null);

    // System event logs section state.
    const [eventLogs, setEventLogs] = useState<SystemEventLog[]>([]);
    const [eventLogsLoading, setEventLogsLoading] = useState(false);
    const [eventLogsError, setEventLogsError] = useState<string | null>(null);
    const [eventLogsSeverityFilter, setEventLogsSeverityFilter] = useState<
        '' | 'Warning' | 'Error'
    >('');
    const [eventLogsSourceFilter, setEventLogsSourceFilter] = useState('');
    const [eventLogsExpandedId, setEventLogsExpandedId] = useState<
        number | null
    >(null);
    const [eventLogsClearing, setEventLogsClearing] = useState(false);

    // --- Maintenance tools state ---
    const [refreshAllJobId, setRefreshAllJobId] = useState<string | null>(
        null,
    );
    const [refreshAllJob, setRefreshAllJob] =
        useState<BackgroundJobStatus | null>(null);
    const [refreshAllStarting, setRefreshAllStarting] = useState(false);
    const [refreshAllError, setRefreshAllError] = useState<string | null>(
        null,
    );

    // Poll the background job while it runs. Stops as soon as the
    // job reports Completed or Failed, so no timer is left running.
    useEffect(() => {
        if (!refreshAllJobId) return;

        let cancelled = false;
        let timeoutId: number | null = null;

        const poll = async () => {
            try {
                const status = await getJobStatus(refreshAllJobId);

                if (cancelled) return;

                setRefreshAllJob(status);

                if (status.status === 'Running') {
                    timeoutId = window.setTimeout(poll, 3000);
                }
            } catch {
                // Stop polling on error. The last known status stays
                // on screen and the user can refresh if needed.
            }
        };

        void poll();

        return () => {
            cancelled = true;
            if (timeoutId != null) window.clearTimeout(timeoutId);
        };
    }, [refreshAllJobId]);

    async function handleStartRefreshAll() {
        if (
            !window.confirm(
                'Lancer le rafraîchissement de tous les logs de match ? ' +
                'Cela peut prendre plusieurs minutes et va réécrire les ' +
                'données de chaque partie déjà en base.',
            )
        ) {
            return;
        }

        setRefreshAllStarting(true);
        setRefreshAllError(null);

        try {
            const result = await startRefreshAllGameLogs();
            setRefreshAllJobId(result.jobId);
            setRefreshAllJob(null);
        } catch (err) {
            setRefreshAllError(
                err instanceof Error
                    ? err.message
                    : 'Erreur inconnue.',
            );
        } finally {
            setRefreshAllStarting(false);
        }
    }

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

    // Current user, used to hide the demote button on our own row.
    const { user: authUser } = useAuth();

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

    // Load protected salaries once on mount.
    useEffect(() => {
        void loadProtectedSalaries();
    }, []);

    // Load manual-contract players once on mount.
    useEffect(() => {
        void loadManualPlayers();
    }, []);

    // Debounced player search for the manual-contracts section.
    useEffect(() => {
        const text = manualSearch.trim();

        if (text.length < MIN_SEARCH_LENGTH) {
            setManualSearchResults([]);
            setManualSearching(false);
            return;
        }

        setManualSearching(true);

        let cancelled = false;

        const timer = setTimeout(() => {
            searchPlayers(text)
                .then((data) => {
                    if (!cancelled) {
                        setManualSearchResults(data);
                    }
                })
                .catch(() => {
                    if (!cancelled) {
                        setManualSearchResults([]);
                    }
                })
                .finally(() => {
                    if (!cancelled) {
                        setManualSearching(false);
                    }
                });
        }, SEARCH_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [manualSearch]);

    // Debounced player search for the "add protected salary" form.
    // Same 300 ms cadence used by the main roster search above.
    useEffect(() => {
        const text = newProtectedSearch.trim();

        if (text.length < MIN_SEARCH_LENGTH || newProtectedSelectedPlayer) {
            setNewProtectedSearchResults([]);
            setNewProtectedSearching(false);
            return;
        }

        setNewProtectedSearching(true);

        let cancelled = false;

        const timer = setTimeout(() => {
            searchPlayers(text)
                .then((data) => {
                    if (!cancelled) {
                        setNewProtectedSearchResults(data);
                    }
                })
                .catch(() => {
                    if (!cancelled) {
                        setNewProtectedSearchResults([]);
                    }
                })
                .finally(() => {
                    if (!cancelled) {
                        setNewProtectedSearching(false);
                    }
                });
        }, SEARCH_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [newProtectedSearch, newProtectedSelectedPlayer]);

    // Load system event logs once on mount.
    useEffect(() => {
        void loadEventLogs();
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

    async function loadProtectedSalaries() {
        setProtectedSalariesLoading(true);
        setProtectedSalariesError(null);

        try {
            const data = await getProtectedSalaries();
            setProtectedSalaries(data);
        } catch (err) {
            setProtectedSalariesError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setProtectedSalariesLoading(false);
        }
    }

    function resetProtectedSalaryForm() {
        setNewProtectedSearch('');
        setNewProtectedSearchResults([]);
        setNewProtectedSelectedPlayer(null);
        setNewProtectedContracts([]);
        setNewProtectedSelectedContractId(null);
        setNewProtectedSalaryInput('');
        setNewProtectedNoteInput('');
    }

    /**
     * Parses the salary input the same way the marketplace's criteria
     * parser does: a value under 1000 is treated as millions and
     * multiplied by 1 000 000; anything larger is treated as raw
     * dollars. So "8.5" -> 8 500 000 and "8500000" -> 8 500 000.
     */
    function parseProtectedSalaryInput(raw: string): number | null {
        const trimmed = raw.trim();
        if (trimmed === '') return null;

        const n = Number(trimmed);
        if (!Number.isFinite(n) || n < 0) return null;

        return n < 1000 ? Math.round(n * 1_000_000) : Math.round(n);
    }

    function formatSeasonRange(
        startSeason: number,
        endSeason: number,
    ): string {
        const startYear = Math.floor(startSeason / 10000);
        const endYear = endSeason % 100;
        return `${startYear}-${String(endYear).padStart(2, '0')}`;
    }

    async function loadPlayerContractsForAdmin(
        nhlPlayerId: number,
    ): Promise<void> {
        setNewProtectedContractsLoading(true);
        setNewProtectedContracts([]);
        setNewProtectedSelectedContractId(null);

        try {
            const contracts = await getPlayerContracts(nhlPlayerId);
            setNewProtectedContracts(contracts);
        } catch (err) {
            setProtectedSalariesError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setNewProtectedContractsLoading(false);
        }
    }

    async function handleAddProtectedSalary() {
        if (newProtectedSelectedContractId == null) {
            setProtectedSalariesError('Choisissez un contrat à protéger.');
            return;
        }

        const salary = parseProtectedSalaryInput(newProtectedSalaryInput);

        if (salary == null) {
            setProtectedSalariesError(
                'Salaire invalide. Entrez un nombre, ex: 10 ou 10000000.',
            );
            return;
        }

        setProtectedSalariesBusy(true);
        setProtectedSalariesError(null);
        setProtectedSalariesSuccess(null);

        try {
            await upsertProtectedSalary(
                newProtectedSelectedContractId,
                salary,
                newProtectedNoteInput.trim() || null,
            );

            setProtectedSalariesSuccess('Salaire protégé.');

            resetProtectedSalaryForm();
            await loadProtectedSalaries();
        } catch (err) {
            setProtectedSalariesError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setProtectedSalariesBusy(false);
        }
    }

    async function handleSaveProtectedSalary(playerContractId: number) {
        const salary = parseProtectedSalaryInput(
            editingProtectedSalaryValue,
        );

        if (salary == null) {
            setProtectedSalariesError('Salaire invalide.');
            return;
        }

        setProtectedSalariesBusy(true);
        setProtectedSalariesError(null);
        setProtectedSalariesSuccess(null);

        try {
            await upsertProtectedSalary(
                playerContractId,
                salary,
                editingProtectedNoteValue.trim() || null,
            );

            setProtectedSalariesSuccess('Salaire mis à jour.');
            setEditingProtectedContractId(null);
            setEditingProtectedSalaryValue('');
            setEditingProtectedNoteValue('');
            await loadProtectedSalaries();
        } catch (err) {
            setProtectedSalariesError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setProtectedSalariesBusy(false);
        }
    }

    async function handleDeleteProtectedSalary(
        playerContractId: number,
        playerName: string,
        startSeason: number,
        endSeason: number,
    ) {
        if (
            !window.confirm(
                `Retirer la protection du contrat de ${playerName} ` +
                `(${formatSeasonRange(startSeason, endSeason)}) ? ` +
                'Le prochain sync CapFreeze écrasera la valeur actuelle.',
            )
        ) {
            return;
        }

        setProtectedSalariesBusy(true);
        setProtectedSalariesError(null);
        setProtectedSalariesSuccess(null);

        try {
            await deleteProtectedSalary(playerContractId);
            setProtectedSalariesSuccess('Protection retirée.');
            await loadProtectedSalaries();
        } catch (err) {
            setProtectedSalariesError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setProtectedSalariesBusy(false);
        }
    }

    // ---------------------------------------------------------------
    // Manual contracts section
    // ---------------------------------------------------------------

    async function loadManualPlayers() {
        setManualPlayersLoading(true);

        try {
            const data = await getManualContractPlayers();
            setManualPlayers(data);
        } catch {
            // Non-fatal: the section will just show an empty list.
        } finally {
            setManualPlayersLoading(false);
        }
    }

    /**
     * Parses a 4-digit year input like "2026" into a season code like
     * 20262027. Also accepts a full 8-digit code like "20262027" as
     * an alternative. Returns null when the value is not recognized.
     */
    function parseYearToSeason(raw: string): number | null {
        const t = raw.trim();
        if (t === '') return null;

        const n = Number(t);
        if (!Number.isFinite(n) || !Number.isInteger(n)) return null;

        // Full 8-digit season code, e.g. 20262027. Sanity-check the
        // second half: it must equal startYear + 1.
        if (n >= 10000000) {
            const startYear = Math.floor(n / 10000);
            const endYear = n % 10000;
            if (endYear !== startYear + 1) return null;
            return n;
        }

        // 4-digit year, e.g. 2026 -> 20262027.
        if (n >= 1900 && n <= 2200) {
            return n * 10000 + (n + 1);
        }

        return null;
    }

    async function selectManualPlayer(nhlPlayerId: number) {
        setManualError(null);
        setManualSuccess(null);
        setManualSearch('');
        setManualSearchResults([]);

        // Find the player's identity from the current list of manual
        // players, or from the search results if not already flagged.
        const fromList = manualPlayers.find(
            (p) => p.nhlPlayerId === nhlPlayerId,
        );

        if (fromList) {
            setManualSelectedPlayer({
                nhlPlayerId: fromList.nhlPlayerId,
                firstName: fromList.firstName,
                lastName: fromList.lastName,
                teamAbbreviation: fromList.teamAbbreviation,
                skipCapFreezeSync: true,
            });
        }

        setManualContractsLoading(true);
        setManualEditingContractId(null);

        try {
            const contracts = await getPlayerContracts(nhlPlayerId);
            setManualContracts(contracts);
        } catch (err) {
            setManualError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
            setManualContracts([]);
        } finally {
            setManualContractsLoading(false);
        }
    }

    function selectManualPlayerFromSearch(player: PlayerSearchResult) {
        setManualSelectedPlayer({
            nhlPlayerId: player.nhlPlayerId,
            firstName: player.firstName,
            lastName: player.lastName,
            teamAbbreviation: player.nhlTeamAbbreviation,
            skipCapFreezeSync: manualPlayers.some(
                (p) => p.nhlPlayerId === player.nhlPlayerId,
            ),
        });

        setManualSearch('');
        setManualSearchResults([]);
        setManualError(null);
        setManualSuccess(null);
        setManualEditingContractId(null);

        setManualContractsLoading(true);

        getPlayerContracts(player.nhlPlayerId)
            .then((data) => {
                setManualContracts(data);
            })
            .catch((err) => {
                setManualError(
                    err instanceof Error ? err.message : 'Erreur inconnue.',
                );
                setManualContracts([]);
            })
            .finally(() => {
                setManualContractsLoading(false);
            });
    }

    async function handleToggleManualSkip() {
        if (!manualSelectedPlayer) return;

        const next = !manualSelectedPlayer.skipCapFreezeSync;

        setManualBusy(true);
        setManualError(null);
        setManualSuccess(null);

        try {
            await setPlayerSkipCapFreeze(
                manualSelectedPlayer.nhlPlayerId,
                next,
            );

            setManualSelectedPlayer({
                ...manualSelectedPlayer,
                skipCapFreezeSync: next,
            });

            setManualSuccess(
                next
                    ? 'Synchronisation CapFreeze désactivée pour ce joueur.'
                    : 'Synchronisation CapFreeze réactivée. Le prochain sync écrasera les valeurs manuelles.',
            );

            await loadManualPlayers();
        } catch (err) {
            setManualError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setManualBusy(false);
        }
    }

    function resetManualAddForm() {
        setManualNewStartYear('');
        setManualNewEndYear('');
        setManualNewSalary('');
    }

    async function handleAddManualContract() {
        if (!manualSelectedPlayer) return;

        const startSeason = parseYearToSeason(manualNewStartYear);
        const endSeason = parseYearToSeason(manualNewEndYear);
        const salary = parseProtectedSalaryInput(manualNewSalary);

        if (startSeason == null) {
            setManualError(
                "Saison de début invalide. Exemple : 2026.",
            );
            return;
        }

        if (endSeason == null) {
            setManualError(
                "Saison de fin invalide. Exemple : 2031.",
            );
            return;
        }

        if (endSeason < startSeason) {
            setManualError(
                'La saison de fin doit être après la saison de début.',
            );
            return;
        }

        if (salary == null) {
            setManualError(
                'Salaire invalide. Entrez un nombre, ex: 11.6 ou 11600000.',
            );
            return;
        }

        setManualBusy(true);
        setManualError(null);
        setManualSuccess(null);

        try {
            await createManualContract({
                nhlPlayerId: manualSelectedPlayer.nhlPlayerId,
                startSeason,
                endSeason,
                salary,
            });

            setManualSuccess('Contrat créé.');
            resetManualAddForm();

            const contracts = await getPlayerContracts(
                manualSelectedPlayer.nhlPlayerId,
            );
            setManualContracts(contracts);
            await loadManualPlayers();
        } catch (err) {
            setManualError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setManualBusy(false);
        }
    }

    function beginEditManualContract(row: PlayerContractRow) {
        setManualEditingContractId(row.playerContractId);
        setManualEditingStartYear(
            String(Math.floor(row.startSeason / 10000)),
        );
        setManualEditingEndYear(
            String(Math.floor(row.endSeason / 10000)),
        );
        setManualEditingSalary(
            (row.salary / 1_000_000)
                .toFixed(2)
                .replace(/\.?0+$/, ''),
        );
    }

    async function handleSaveManualContract() {
        if (manualEditingContractId == null) return;

        const startSeason = parseYearToSeason(manualEditingStartYear);
        const endSeason = parseYearToSeason(manualEditingEndYear);
        const salary = parseProtectedSalaryInput(manualEditingSalary);

        if (startSeason == null || endSeason == null) {
            setManualError('Saisons invalides.');
            return;
        }

        if (endSeason < startSeason) {
            setManualError(
                'La saison de fin doit être après la saison de début.',
            );
            return;
        }

        if (salary == null) {
            setManualError('Salaire invalide.');
            return;
        }

        setManualBusy(true);
        setManualError(null);
        setManualSuccess(null);

        try {
            await updateManualContract(manualEditingContractId, {
                startSeason,
                endSeason,
                salary,
            });

            setManualSuccess('Contrat mis à jour.');
            setManualEditingContractId(null);

            if (manualSelectedPlayer) {
                const contracts = await getPlayerContracts(
                    manualSelectedPlayer.nhlPlayerId,
                );
                setManualContracts(contracts);
                await loadManualPlayers();
            }
        } catch (err) {
            setManualError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setManualBusy(false);
        }
    }

    async function handleDeleteManualContract(
        playerContractId: number,
        startSeason: number,
        endSeason: number,
    ) {
        if (
            !window.confirm(
                `Supprimer le contrat ${formatSeasonRange(startSeason, endSeason)} ?`,
            )
        ) {
            return;
        }

        setManualBusy(true);
        setManualError(null);
        setManualSuccess(null);

        try {
            await deleteManualContract(playerContractId);
            setManualSuccess('Contrat supprimé.');

            if (manualSelectedPlayer) {
                const contracts = await getPlayerContracts(
                    manualSelectedPlayer.nhlPlayerId,
                );
                setManualContracts(contracts);
                await loadManualPlayers();
            }
        } catch (err) {
            setManualError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setManualBusy(false);
        }
    }

    // ---------------------------------------------------------------
    // Refresh single player section
    // ---------------------------------------------------------------

    async function handleRefreshSinglePlayer() {
        const trimmed = refreshPlayerIdInput.trim();

        if (trimmed === '') {
            setRefreshPlayerError('Entrez un NhlPlayerId.');
            return;
        }

        const nhlId = Number(trimmed);

        if (
            !Number.isFinite(nhlId) ||
            !Number.isInteger(nhlId) ||
            nhlId <= 0
        ) {
            setRefreshPlayerError(
                'NhlPlayerId invalide. Entrez un entier positif, ex: 8478402.',
            );
            return;
        }

        setRefreshPlayerBusy(true);
        setRefreshPlayerError(null);
        setRefreshPlayerSuccess(null);

        try {
            const player = await refreshSinglePlayer(nhlId);

            setLastRefreshedPlayer(player);
            setRefreshPlayerSuccess(
                `Rafraîchi : ${player.firstName} ${player.lastName} ` +
                `(${player.position}, NhlPlayerId ${player.nhlPlayerId}).`,
            );
        } catch (err) {
            setLastRefreshedPlayer(null);
            setRefreshPlayerError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setRefreshPlayerBusy(false);
        }
    }

    async function loadEventLogs() {
        setEventLogsLoading(true);
        setEventLogsError(null);

        try {
            const filters: Parameters<typeof getSystemEventLogs>[0] = {
                limit: 200,
            };
            if (eventLogsSeverityFilter) {
                filters.severity = eventLogsSeverityFilter;
            }
            if (eventLogsSourceFilter.trim()) {
                filters.source = eventLogsSourceFilter.trim();
            }

            const data = await getSystemEventLogs(filters);
            setEventLogs(data);
        } catch (err) {
            setEventLogsError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setEventLogsLoading(false);
        }
    }

    async function handleClearEventLogs() {
        if (
            !window.confirm(
                'Effacer tous les journaux d’événements ? Cette action ' +
                'est irréversible.',
            )
        ) {
            return;
        }

        setEventLogsClearing(true);
        setEventLogsError(null);

        try {
            const result = await clearSystemEventLogs();
            setEventLogs([]);
            setEventLogsExpandedId(null);
            setUsersSuccess(result.message);
            window.setTimeout(() => setUsersSuccess(null), 3000);
        } catch (err) {
            setEventLogsError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setEventLogsClearing(false);
        }
    }

    function formatLogTimestamp(iso: string): string {
        try {
            const d = new Date(iso);
            return new Intl.DateTimeFormat('fr-CA', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            }).format(d);
        } catch {
            return iso;
        }
    }

    function severityBadgeClass(severity: string): string {
        if (severity === 'Error') {
            return 'border-red-500/40 bg-red-500/10 text-red-300';
        }
        return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
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

    // ---------------------------------------------------------------
    // Export rosters
    // ---------------------------------------------------------------

    /**
     * Fetches every fantasy team's roster, builds a plain-text report
     * grouping each team's players by status (Alignement / Banc /
     * Prospects), and downloads it as a .txt file named
     * "ROSTERS YYYY-MM-DD.txt".
     */
    async function handleExportRosters() {
        if (teams.length === 0) {
            setExportRostersError('Aucune équipe à exporter.');
            return;
        }

        setExportingRosters(true);
        setExportRostersError(null);

        try {
            const now = new Date();
            const dateLabel =
                `${now.getFullYear()}-` +
                `${String(now.getMonth() + 1).padStart(2, '0')}-` +
                `${String(now.getDate()).padStart(2, '0')}`;

            const timeLabel =
                `${String(now.getHours()).padStart(2, '0')}:` +
                `${String(now.getMinutes()).padStart(2, '0')}`;

            const lines: string[] = [];

            lines.push(`ROSTERS ${dateLabel}`);
            lines.push(`Généré le ${dateLabel} à ${timeLabel}`);
            lines.push('');

            for (const team of teams) {
                const roster = await getTeamRoster(team.id);

                lines.push('='.repeat(60));
                lines.push(`ÉQUIPE: ${team.name}`);
                lines.push(`Joueurs: ${roster.totalPlayers}`);
                lines.push(`Masse salariale: ${(roster.totalSalary / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`);
                lines.push('='.repeat(60));
                lines.push('');

                const active = roster.entries.filter(
                    (e) => e.rosterStatus === 'Active',
                );
                const bench = roster.entries.filter(
                    (e) => e.rosterStatus === 'Bench',
                );
                const prospects = roster.entries.filter(
                    (e) => e.rosterStatus === 'Prospect',
                );

                const sections: Array<[string, RosterEntry[]]> = [
                    ['ALIGNEMENT PRINCIPAL', sortRosterForExport(active)],
                    ['BANC', sortRosterForExport(bench)],
                    ['PROSPECTS', sortRosterForExport(prospects)],
                ];

                for (const [title, entries] of sections) {
                    lines.push(`--- ${title} (${entries.length}) ---`);

                    if (entries.length === 0) {
                        lines.push('  (vide)');
                    } else {
                        for (const entry of entries) {
                            const group = positionGroup(entry.position);

                            const salary = (entry.fantasySalary / 1_000_000)
                                .toFixed(2)
                                .replace(/\.?0+$/, '');

                            lines.push(
                                `  ${entry.firstName} ${entry.lastName} | ${group} | ${entry.nhlTeamAbbreviation} | ${salary}M`,
                            );
                        }
                    }

                    lines.push('');
                }

                lines.push('');
            }

            const blob = new Blob(
                [lines.join('\n')],
                { type: 'text/plain;charset=utf-8' },
            );

            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `ROSTERS ${dateLabel}.txt`;

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            URL.revokeObjectURL(url);
        } catch (err) {
            setExportRostersError(
                err instanceof Error ? err.message : 'Erreur lors de l\'export.',
            );
        } finally {
            setExportingRosters(false);
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
                                    <th className='px-2 py-2 text-left font-medium'>
                                        Dernière activité
                                    </th>
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
                                        <td className='px-2 py-2 text-left align-top text-muted-foreground'>
                                            {formatLastActive(u.lastActiveAt)}
                                        </td>
                                        <td className='px-2 py-2 text-center align-top'>
                                            <div className='flex flex-wrap items-center justify-center gap-2'>
                                                {/* Promote / demote.
                                                    Demote is hidden for
                                                    protected commissioners
                                                    and for our own row; the
                                                    backend refuses both
                                                    anyway, this just avoids
                                                    a dead button. */}
                                                {u.isCommissioner ? (
                                                    u.isProtected ? (
                                                        <span
                                                            className='cursor-default rounded border border-border bg-secondary/40 px-2 py-0.5 text-xs italic text-muted-foreground'
                                                            title='Commissaire protégé : ne peut pas être rétrogradé'
                                                        >
                                                            🔒 Protégé
                                                        </span>
                                                    ) : authUser?.id === u.id ? (
                                                        <span
                                                            className='cursor-default rounded border border-border bg-secondary/40 px-2 py-0.5 text-xs italic text-muted-foreground'
                                                            title='Vous ne pouvez pas retirer votre propre rôle'
                                                        >
                                                            Vous-même
                                                        </span>
                                                    ) : (
                                                        <button
                                                            type='button'
                                                            onClick={() => void handleDemote(u.id)}
                                                            disabled={usersBusyId === u.id}
                                                            className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50'
                                                        >
                                                            Retirer commissaire
                                                        </button>
                                                    )
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


            {/* ============================================================
                Journaux d'événements (erreurs + avertissements)
                ============================================================ */}
            <div className='max-w-4xl space-y-3'>
                <h3 className='text-lg font-semibold text-foreground'>
                    Journaux d'événements
                </h3>

                <p className='text-sm text-muted-foreground'>
                    Erreurs et avertissements capturés automatiquement :
                    échecs HTTP (429, 5xx), pannes des jobs planifiés.
                    Les événements identiques dans une fenêtre de 60
                    secondes sont regroupés.
                </p>

                {eventLogsError && (
                    <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                        {eventLogsError}
                    </p>
                )}

                <div className='flex flex-wrap items-end gap-2'>
                    <div>
                        <label className='text-xs font-medium text-muted-foreground'>
                            Sévérité
                        </label>
                        <select
                            value={eventLogsSeverityFilter}
                            onChange={(e) =>
                                setEventLogsSeverityFilter(
                                    e.target.value as '' | 'Warning' | 'Error',
                                )
                            }
                            className='mt-0.5 block rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground'
                        >
                            <option value=''>Tout</option>
                            <option value='Warning'>Avertissements</option>
                            <option value='Error'>Erreurs</option>
                        </select>
                    </div>

                    <div>
                        <label className='text-xs font-medium text-muted-foreground'>
                            Source (préfixe)
                        </label>
                        <input
                            type='text'
                            value={eventLogsSourceFilter}
                            onChange={(e) =>
                                setEventLogsSourceFilter(e.target.value)
                            }
                            placeholder='ex: NhlApi, ScheduledJob:'
                            className='mt-0.5 block rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground'
                        />
                    </div>

                    <button
                        type='button'
                        onClick={() => void loadEventLogs()}
                        disabled={eventLogsLoading}
                        className={secondaryButtonClass}
                    >
                        {eventLogsLoading ? 'Chargement...' : 'Rafraîchir'}
                    </button>

                    <button
                        type='button'
                        onClick={() => void handleClearEventLogs()}
                        disabled={eventLogsClearing || eventLogs.length === 0}
                        className={dangerButtonClass}
                    >
                        {eventLogsClearing ? 'Effacement...' : 'Tout effacer'}
                    </button>
                </div>

                {!eventLogsLoading && eventLogs.length === 0 && !eventLogsError && (
                    <p className='rounded-lg border border-border bg-card px-3 py-4 text-sm text-muted-foreground'>
                        Aucun événement enregistré. Bonne nouvelle.
                    </p>
                )}

                {eventLogs.length > 0 && (
                    <div className='space-y-1'>
                        {eventLogs.map((log) => {
                            const isExpanded = eventLogsExpandedId === log.id;

                            return (
                                <div
                                    key={log.id}
                                    className='rounded-lg border border-border bg-card'
                                >
                                    <button
                                        type='button'
                                        onClick={() =>
                                            setEventLogsExpandedId(
                                                isExpanded ? null : log.id,
                                            )
                                        }
                                        className='flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left text-sm hover:bg-secondary/50'
                                    >
                                        <span
                                            className={`mt-0.5 inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${severityBadgeClass(
                                                log.severity,
                                            )}`}
                                        >
                                            {log.severity}
                                        </span>

                                        <div className='min-w-0 flex-1'>
                                            <div className='flex flex-wrap items-baseline gap-x-2 gap-y-0.5'>
                                                <span className='font-mono text-xs text-muted-foreground'>
                                                    {formatLogTimestamp(
                                                        log.lastSeenUtc,
                                                    )}
                                                </span>

                                                <span className='font-mono text-xs text-foreground'>
                                                    {log.source}
                                                </span>

                                                <span className='font-mono text-xs text-muted-foreground'>
                                                    · {log.category}
                                                </span>

                                                {log.count > 1 && (
                                                    <span className='rounded bg-secondary px-1.5 py-0.5 text-[0.65rem] font-semibold text-foreground'>
                                                        ×{log.count}
                                                    </span>
                                                )}
                                            </div>

                                            <p className='mt-0.5 truncate text-foreground'>
                                                {log.message}
                                            </p>
                                        </div>

                                        <span className='mt-0.5 shrink-0 text-xs text-muted-foreground'>
                                            {isExpanded ? '▲' : '▼'}
                                        </span>
                                    </button>

                                    {isExpanded && (
                                        <div className='border-t border-border px-3 py-2 text-xs'>
                                            <p className='text-muted-foreground'>
                                                <span className='font-semibold'>
                                                    Première occurrence :
                                                </span>{' '}
                                                {formatLogTimestamp(
                                                    log.timestampUtc,
                                                )}
                                            </p>

                                            <p className='mt-1 text-muted-foreground'>
                                                <span className='font-semibold'>
                                                    Dernière occurrence :
                                                </span>{' '}
                                                {formatLogTimestamp(
                                                    log.lastSeenUtc,
                                                )}
                                            </p>

                                            {log.details && (
                                                <pre className='mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 text-[0.7rem] text-muted-foreground'>
                                                    {log.details}
                                                </pre>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ============================================================
                Outils de maintenance
                ============================================================ */}
            <div className='max-w-2xl space-y-3'>
                <h3 className='text-lg font-semibold text-foreground'>
                    Outils de maintenance
                </h3>

                <p className='text-sm text-muted-foreground'>
                    Actions ponctuelles pour repeupler ou réparer les
                    données. Ces opérations s'exécutent en arrière-plan
                    et peuvent prendre plusieurs minutes.
                </p>

                {refreshAllError && (
                    <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                        {refreshAllError}
                    </p>
                )}

                <button
                    type='button'
                    onClick={() => void handleStartRefreshAll()}
                    disabled={
                        refreshAllStarting ||
                        refreshAllJob?.status === 'Running'
                    }
                    className={secondaryButtonClass}
                >
                    {refreshAllStarting
                        ? 'Démarrage...'
                        : refreshAllJob?.status === 'Running'
                            ? 'En cours...'
                            : 'Rafraîchir tous les logs de match'}
                </button>

                <p className='text-xs text-muted-foreground'>
                    Retélécharge la saison régulière complète pour chaque
                    joueur depuis l'API LNH. Utile après l'ajout d'une
                    colonne à la table des logs de match (par exemple le
                    TOI).
                </p>

                {refreshAllJob && (
                    <div className='rounded-lg border border-border bg-card px-3 py-2 text-sm'>
                        <p className='text-foreground'>
                            <span className='font-semibold'>
                                Statut :
                            </span>{' '}
                            {refreshAllJob.status}
                        </p>

                        {refreshAllJob.progressTotal > 0 && (
                            <p className='text-muted-foreground'>
                                {refreshAllJob.progressCurrent} /{' '}
                                {refreshAllJob.progressTotal}
                            </p>
                        )}

                        {refreshAllJob.message && (
                            <p className='text-muted-foreground'>
                                {refreshAllJob.message}
                            </p>
                        )}

                        {refreshAllJob.error && (
                            <p className='text-destructive'>
                                {refreshAllJob.error}
                            </p>
                        )}

                        {refreshAllJob.status === 'Completed' && (
                            <p className='text-emerald-400'>
                                Terminé.
                            </p>
                        )}
                    </div>
                )}
            </div>

            {/* ============================================================
                Rafraîchir un joueur
                ============================================================ */}
            <div className='max-w-2xl space-y-3'>
                <h3 className='text-lg font-semibold text-foreground'>
                    Rafraîchir un joueur
                </h3>

                <p className='text-sm text-muted-foreground'>
                    Force un rafraîchissement immédiat des données d'un
                    seul joueur depuis sa page NHL : identité, équipe,
                    repêchage, bio, photo, statistiques de carrière,
                    et colonnes de la saison en cours. Un seul appel
                    à l'API LNH par clic. Utile quand les jobs
                    planifiés (hebdomadaire, quotidien) n'ont pas
                    encore passé, ou pour corriger un joueur précis.
                </p>

                {refreshPlayerError && (
                    <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                        {refreshPlayerError}
                    </p>
                )}

                {refreshPlayerSuccess && (
                    <p className='rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400'>
                        {refreshPlayerSuccess}
                    </p>
                )}

                <div className='flex items-end gap-2'>
                    <div className='flex-1'>
                        <label className='text-xs font-medium text-muted-foreground'>
                            NhlPlayerId (ex: 8478402)
                        </label>
                        <input
                            type='text'
                            inputMode='numeric'
                            value={refreshPlayerIdInput}
                            autoComplete='off'
                            onChange={(event) =>
                                setRefreshPlayerIdInput(event.target.value)
                            }
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void handleRefreshSinglePlayer();
                                }
                            }}
                            placeholder='8478402'
                            className={`mt-1 ${selectClass}`}
                        />
                    </div>

                    <button
                        type='button'
                        onClick={() => void handleRefreshSinglePlayer()}
                        disabled={
                            refreshPlayerBusy ||
                            refreshPlayerIdInput.trim() === ''
                        }
                        className={primaryButtonClass}
                    >
                        {refreshPlayerBusy
                            ? 'Rafraîchissement...'
                            : 'Rafraîchir'}
                    </button>
                </div>

                {lastRefreshedPlayer && (
                    <div className='flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2'>
                        {lastRefreshedPlayer.headshotUrl ? (
                            <img
                                src={lastRefreshedPlayer.headshotUrl}
                                alt={`${lastRefreshedPlayer.firstName} ${lastRefreshedPlayer.lastName}`}
                                className='h-10 w-10 rounded-md bg-white object-cover'
                                loading='lazy'
                            />
                        ) : (
                            <div className='flex h-10 w-10 items-center justify-center rounded-md bg-secondary text-xs font-semibold text-foreground'>
                                {lastRefreshedPlayer.firstName.charAt(0)}
                                {lastRefreshedPlayer.lastName.charAt(0)}
                            </div>
                        )}

                        <div className='min-w-0 flex-1'>
                            <p className='truncate text-sm font-medium text-foreground'>
                                {lastRefreshedPlayer.firstName}{' '}
                                {lastRefreshedPlayer.lastName}
                            </p>
                            <p className='text-xs text-muted-foreground'>
                                {lastRefreshedPlayer.position}
                                {' · NhlPlayerId '}
                                {lastRefreshedPlayer.nhlPlayerId}
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* ============================================================
                Salaires protégés (per-contract)
                ============================================================ */}
            <div className='max-w-3xl space-y-3'>
                <h3 className='text-lg font-semibold text-foreground'>
                    Salaires protégés
                </h3>

                <p className='text-sm text-muted-foreground'>
                    Salaires réels (avant rétention) qui ne seront jamais
                    écrasés par CapFreeze. Utile quand un joueur a été
                    échangé avec une retenue salariale : CapFreeze affiche
                    le montant après retenue, mais pour notre ligue on
                    veut la valeur totale du contrat.{' '}
                    <span className='font-semibold text-foreground'>
                        Seul le salaire du contrat sélectionné est verrouillé
                    </span>
                    ; les années et les autres contrats continuent d'être
                    mis à jour normalement. La protection disparaît
                    automatiquement quand le contrat se termine et que
                    CapFreeze retourne un nouveau contrat.
                </p>

                {protectedSalariesError && (
                    <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                        {protectedSalariesError}
                    </p>
                )}

                {protectedSalariesSuccess && (
                    <p className='rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400'>
                        {protectedSalariesSuccess}
                    </p>
                )}

                {/* Add form */}
                <div className='space-y-3 rounded-lg border border-border bg-card p-3'>
                    <h4 className='text-sm font-semibold uppercase tracking-wide text-muted-foreground'>
                        Ajouter un salaire protégé
                    </h4>

                    {/* Player search */}
                    <div className='relative'>
                        <input
                            type='text'
                            value={newProtectedSearch}
                            autoComplete='off'
                            disabled={newProtectedSelectedPlayer != null}
                            onChange={(event) => {
                                setNewProtectedSearch(event.target.value);
                                setNewProtectedSelectedPlayer(null);
                                setNewProtectedContracts([]);
                                setNewProtectedSelectedContractId(null);
                            }}
                            placeholder='Rechercher un joueur (min. 2 lettres)'
                            className={selectClass}
                        />

                        {newProtectedSearchResults.length > 0 && (
                            <div className='absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg'>
                                {newProtectedSearchResults.map((player) => (
                                    <button
                                        key={player.playerId}
                                        type='button'
                                        onClick={() => {
                                            setNewProtectedSelectedPlayer(
                                                player,
                                            );
                                            setNewProtectedSearchResults([]);
                                            void loadPlayerContractsForAdmin(
                                                player.nhlPlayerId,
                                            );
                                        }}
                                        className='flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-secondary'
                                    >
                                        <span className='text-foreground'>
                                            {player.firstName}{' '}
                                            {player.lastName}
                                        </span>
                                        <span className='text-xs text-muted-foreground'>
                                            {player.nhlTeamAbbreviation} ·{' '}
                                            {player.position}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {newProtectedSearching &&
                        !newProtectedSelectedPlayer && (
                            <p className='text-xs text-muted-foreground'>
                                Recherche...
                            </p>
                        )}

                    {newProtectedSelectedPlayer && (
                        <div className='flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm'>
                            <span className='text-foreground'>
                                {newProtectedSelectedPlayer.firstName}{' '}
                                {newProtectedSelectedPlayer.lastName} ·{' '}
                                {newProtectedSelectedPlayer.nhlTeamAbbreviation} ·{' '}
                                {newProtectedSelectedPlayer.position}
                            </span>
                            <button
                                type='button'
                                onClick={resetProtectedSalaryForm}
                                className='cursor-pointer rounded px-2 py-0.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground'
                            >
                                Changer
                            </button>
                        </div>
                    )}

                    {newProtectedSelectedPlayer &&
                        newProtectedContractsLoading && (
                            <p className='text-xs text-muted-foreground'>
                                Chargement des contrats...
                            </p>
                        )}

                    {newProtectedSelectedPlayer &&
                        !newProtectedContractsLoading &&
                        newProtectedContracts.length === 0 && (
                            <p className='text-xs text-muted-foreground'>
                                Aucun contrat en base pour ce joueur.
                            </p>
                        )}

                    {newProtectedContracts.length > 0 && (
                        <div className='space-y-1'>
                            <p className='text-xs font-medium text-muted-foreground'>
                                Choisir le contrat à protéger :
                            </p>
                            <ul className='space-y-1'>
                                {newProtectedContracts.map((c) => {
                                    const selected =
                                        newProtectedSelectedContractId ===
                                        c.playerContractId;

                                    return (
                                        <li key={c.playerContractId}>
                                            <button
                                                type='button'
                                                onClick={() => {
                                                    setNewProtectedSelectedContractId(
                                                        c.playerContractId,
                                                    );
                                                    setNewProtectedSalaryInput(
                                                        c.protectedSalary != null
                                                            ? (c.protectedSalary / 1_000_000)
                                                                .toFixed(2)
                                                                .replace(/\.?0+$/, '')
                                                            : (c.salary / 1_000_000)
                                                                .toFixed(2)
                                                                .replace(/\.?0+$/, ''),
                                                    );
                                                    setNewProtectedNoteInput(
                                                        c.protectionNote ?? '',
                                                    );
                                                }}
                                                className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left text-sm ${selected
                                                        ? 'border-[#00A8FF] bg-[#00A8FF]/10'
                                                        : 'border-border hover:bg-secondary'
                                                    }`}
                                            >
                                                <span className='text-foreground'>
                                                    {formatSeasonRange(
                                                        c.startSeason,
                                                        c.endSeason,
                                                    )}
                                                </span>
                                                <span className='text-xs text-muted-foreground'>
                                                    CapFreeze :{' '}
                                                    {(c.salary / 1_000_000)
                                                        .toFixed(2)
                                                        .replace(/\.?0+$/, '')}
                                                    M
                                                    {c.protectedSalary !=
                                                        null && (
                                                            <span className='ml-2 font-semibold text-emerald-400'>
                                                                · Protégé :{' '}
                                                                {(
                                                                    c.protectedSalary /
                                                                    1_000_000
                                                                )
                                                                    .toFixed(2)
                                                                    .replace(
                                                                        /\.?0+$/,
                                                                        '',
                                                                    )}
                                                                M
                                                            </span>
                                                        )}
                                                </span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}

                    {newProtectedSelectedContractId != null && (
                        <>
                            <div>
                                <label className='text-xs font-medium text-muted-foreground'>
                                    Salaire réel (ex: 10 ou 10000000)
                                </label>
                                <input
                                    type='text'
                                    inputMode='decimal'
                                    value={newProtectedSalaryInput}
                                    onChange={(event) =>
                                        setNewProtectedSalaryInput(
                                            event.target.value,
                                        )
                                    }
                                    className={`mt-1 ${selectClass}`}
                                />
                            </div>

                            <div>
                                <label className='text-xs font-medium text-muted-foreground'>
                                    Note (optionnel, ex: 25% retenu)
                                </label>
                                <input
                                    type='text'
                                    value={newProtectedNoteInput}
                                    maxLength={500}
                                    onChange={(event) =>
                                        setNewProtectedNoteInput(
                                            event.target.value,
                                        )
                                    }
                                    className={`mt-1 ${selectClass}`}
                                />
                            </div>

                            <div className='flex justify-end'>
                                <button
                                    type='button'
                                    onClick={() =>
                                        void handleAddProtectedSalary()
                                    }
                                    disabled={
                                        protectedSalariesBusy ||
                                        newProtectedSalaryInput.trim() === ''
                                    }
                                    className={primaryButtonClass}
                                >
                                    {protectedSalariesBusy
                                        ? 'Traitement...'
                                        : 'Protéger ce contrat'}
                                </button>
                            </div>
                        </>
                    )}
                </div>

                {/* List */}
                {protectedSalariesLoading && (
                    <p className='text-sm text-muted-foreground'>
                        Chargement...
                    </p>
                )}

                {!protectedSalariesLoading &&
                    protectedSalaries.length === 0 &&
                    !protectedSalariesError && (
                        <p className='text-sm text-muted-foreground'>
                            Aucun salaire protégé pour le moment.
                        </p>
                    )}

                {!protectedSalariesLoading &&
                    protectedSalaries.length > 0 && (
                        <ul className='space-y-2'>
                            {protectedSalaries.map((row) => {
                                const isEditing =
                                    editingProtectedContractId ===
                                    row.playerContractId;

                                return (
                                    <li
                                        key={row.playerContractId}
                                        className='rounded-lg border border-border bg-card px-3 py-2 text-sm'
                                    >
                                        <div className='flex items-center justify-between gap-2'>
                                            <div className='min-w-0 flex-1'>
                                                <div className='flex items-baseline gap-2'>
                                                    <span className='truncate font-medium text-foreground'>
                                                        {row.playerName}
                                                    </span>
                                                    {row.teamAbbreviation && (
                                                        <span className='shrink-0 text-xs text-muted-foreground'>
                                                            {row.teamAbbreviation}
                                                        </span>
                                                    )}
                                                    <span className='shrink-0 text-xs text-muted-foreground'>
                                                        {formatSeasonRange(
                                                            row.startSeason,
                                                            row.endSeason,
                                                        )}
                                                    </span>
                                                </div>
                                                {row.protectionNote && (
                                                    <p className='mt-0.5 text-xs italic text-muted-foreground'>
                                                        {row.protectionNote}
                                                    </p>
                                                )}
                                            </div>

                                            {isEditing ? (
                                                <div className='flex shrink-0 flex-col items-end gap-1'>
                                                    <input
                                                        type='text'
                                                        inputMode='decimal'
                                                        value={editingProtectedSalaryValue}
                                                        onChange={(event) =>
                                                            setEditingProtectedSalaryValue(
                                                                event.target.value,
                                                            )
                                                        }
                                                        className='w-32 rounded border border-border bg-background px-2 py-1 text-xs'
                                                    />
                                                    <input
                                                        type='text'
                                                        value={editingProtectedNoteValue}
                                                        maxLength={500}
                                                        placeholder='Note (optionnel)'
                                                        onChange={(event) =>
                                                            setEditingProtectedNoteValue(
                                                                event.target.value,
                                                            )
                                                        }
                                                        className='w-48 rounded border border-border bg-background px-2 py-1 text-xs'
                                                    />
                                                    <div className='flex gap-2'>
                                                        <button
                                                            type='button'
                                                            onClick={() =>
                                                                void handleSaveProtectedSalary(
                                                                    row.playerContractId,
                                                                )
                                                            }
                                                            disabled={protectedSalariesBusy}
                                                            className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50'
                                                        >
                                                            Enregistrer
                                                        </button>
                                                        <button
                                                            type='button'
                                                            onClick={() => {
                                                                setEditingProtectedContractId(
                                                                    null,
                                                                );
                                                                setEditingProtectedSalaryValue(
                                                                    '',
                                                                );
                                                                setEditingProtectedNoteValue(
                                                                    '',
                                                                );
                                                            }}
                                                            disabled={protectedSalariesBusy}
                                                            className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50'
                                                        >
                                                            Annuler
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className='flex shrink-0 items-center gap-2'>
                                                    <span className='text-sm font-semibold text-emerald-400'>
                                                        {(
                                                            (row.protectedSalary ??
                                                                row.salary) /
                                                            1_000_000
                                                        )
                                                            .toFixed(2)
                                                            .replace(/\.?0+$/, '')}
                                                        M
                                                    </span>
                                                    <button
                                                        type='button'
                                                        onClick={() => {
                                                            setEditingProtectedContractId(
                                                                row.playerContractId,
                                                            );
                                                            setEditingProtectedSalaryValue(
                                                                (
                                                                    (row.protectedSalary ??
                                                                        row.salary) /
                                                                    1_000_000
                                                                )
                                                                    .toFixed(2)
                                                                    .replace(
                                                                        /\.?0+$/,
                                                                        '',
                                                                    ),
                                                            );
                                                            setEditingProtectedNoteValue(
                                                                row.protectionNote ??
                                                                '',
                                                            );
                                                        }}
                                                        disabled={protectedSalariesBusy}
                                                        className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50'
                                                    >
                                                        Modifier
                                                    </button>
                                                    <button
                                                        type='button'
                                                        onClick={() =>
                                                            void handleDeleteProtectedSalary(
                                                                row.playerContractId,
                                                                row.playerName,
                                                                row.startSeason,
                                                                row.endSeason,
                                                            )
                                                        }
                                                        disabled={protectedSalariesBusy}
                                                        className='cursor-pointer rounded border border-destructive/40 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50'
                                                    >
                                                        Retirer
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
            </div>

            {/* ============================================================
                Contrats manuels
                ============================================================ */}
            <div className='max-w-3xl space-y-3'>
                <h3 className='text-lg font-semibold text-foreground'>
                    Contrats manuels
                </h3>

                <p className='text-sm text-muted-foreground'>
                    Joueurs dont le contrat est géré manuellement et
                    qui sont complètement ignorés par la synchronisation
                    CapFreeze (contrats, années, statut). Utile quand
                    CapFreeze ne peut pas distinguer deux joueurs du
                    même nom — par exemple les deux Elias Pettersson.{' '}
                    <span className='font-semibold text-foreground'>
                        Tant que la synchronisation est désactivée pour
                        un joueur, ses contrats ne seront jamais écrasés.
                    </span>{' '}
                    Réactivez la synchronisation si vous voulez que
                    CapFreeze reprenne le contrôle.
                </p>

                {manualError && (
                    <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                        {manualError}
                    </p>
                )}

                {manualSuccess && (
                    <p className='rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400'>
                        {manualSuccess}
                    </p>
                )}

                {/* Player search */}
                <div className='relative'>
                    <input
                        type='text'
                        value={manualSearch}
                        autoComplete='off'
                        onChange={(event) =>
                            setManualSearch(event.target.value)
                        }
                        placeholder='Rechercher un joueur (min. 2 lettres)'
                        className={selectClass}
                    />

                    {manualSearchResults.length > 0 && (
                        <div className='absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg'>
                            {manualSearchResults.map((player) => (
                                <button
                                    key={player.playerId}
                                    type='button'
                                    onClick={() =>
                                        selectManualPlayerFromSearch(player)
                                    }
                                    className='flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-secondary'
                                >
                                    <span className='text-foreground'>
                                        {player.firstName}{' '}
                                        {player.lastName}
                                    </span>
                                    <span className='text-xs text-muted-foreground'>
                                        {player.nhlTeamAbbreviation} ·{' '}
                                        {player.position}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {manualSearching && (
                    <p className='text-xs text-muted-foreground'>
                        Recherche...
                    </p>
                )}

                {/* List of currently manual players (click to select) */}
                {manualPlayers.length > 0 && (
                    <div className='rounded-lg border border-border bg-card p-3'>
                        <p className='mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                            Joueurs gérés manuellement
                        </p>
                        <div className='flex flex-wrap gap-1'>
                            {manualPlayers.map((p) => {
                                const isSelected =
                                    manualSelectedPlayer?.nhlPlayerId ===
                                    p.nhlPlayerId;

                                return (
                                    <button
                                        key={p.nhlPlayerId}
                                        type='button'
                                        onClick={() =>
                                            void selectManualPlayer(
                                                p.nhlPlayerId,
                                            )
                                        }
                                        className={`cursor-pointer rounded-full border px-2 py-0.5 text-xs transition-colors ${isSelected
                                                ? 'border-[#00A8FF] bg-[#00A8FF]/15 text-white'
                                                : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground'
                                            }`}
                                    >
                                        {p.firstName} {p.lastName}
                                        {p.teamAbbreviation && (
                                            <span className='ml-1 opacity-70'>
                                                · {p.teamAbbreviation}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {manualPlayersLoading && manualPlayers.length === 0 && (
                    <p className='text-xs text-muted-foreground'>
                        Chargement...
                    </p>
                )}

                {/* Selected player panel */}
                {manualSelectedPlayer && (
                    <div className='space-y-3 rounded-lg border border-border bg-card p-3'>
                        <div className='flex flex-wrap items-center justify-between gap-2'>
                            <div>
                                <p className='font-medium text-foreground'>
                                    {manualSelectedPlayer.firstName}{' '}
                                    {manualSelectedPlayer.lastName}
                                </p>
                                <p className='text-xs text-muted-foreground'>
                                    {manualSelectedPlayer.teamAbbreviation ??
                                        '—'}
                                    {' · NhlPlayerId '}
                                    {manualSelectedPlayer.nhlPlayerId}
                                </p>
                            </div>

                            <button
                                type='button'
                                onClick={() =>
                                    void handleToggleManualSkip()
                                }
                                disabled={manualBusy}
                                className={
                                    manualSelectedPlayer.skipCapFreezeSync
                                        ? 'cursor-pointer rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/20 disabled:opacity-50'
                                        : 'cursor-pointer rounded-lg border border-border bg-transparent px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-50'
                                }
                            >
                                {manualSelectedPlayer.skipCapFreezeSync
                                    ? '✓ Synchronisation désactivée'
                                    : 'Synchronisation activée'}
                            </button>
                        </div>

                        {/* Contracts list */}
                        <div className='space-y-1'>
                            <p className='text-xs font-medium text-muted-foreground'>
                                Contrats :
                            </p>

                            {manualContractsLoading && (
                                <p className='text-xs text-muted-foreground'>
                                    Chargement des contrats...
                                </p>
                            )}

                            {!manualContractsLoading &&
                                manualContracts.length === 0 && (
                                    <p className='text-xs text-muted-foreground'>
                                        Aucun contrat en base pour ce joueur.
                                    </p>
                                )}

                            {!manualContractsLoading &&
                                manualContracts.map((row) => {
                                    const isEditing =
                                        manualEditingContractId ===
                                        row.playerContractId;

                                    return (
                                        <div
                                            key={row.playerContractId}
                                            className='rounded-lg border border-border bg-background px-3 py-2 text-sm'
                                        >
                                            {isEditing ? (
                                                <div className='space-y-2'>
                                                    <div className='flex items-center gap-2'>
                                                        <label className='text-xs text-muted-foreground'>
                                                            Début
                                                        </label>
                                                        <input
                                                            type='text'
                                                            inputMode='numeric'
                                                            value={manualEditingStartYear}
                                                            onChange={(e) =>
                                                                setManualEditingStartYear(
                                                                    e.target
                                                                        .value,
                                                                )
                                                            }
                                                            className='w-20 rounded border border-border bg-card px-2 py-1 text-xs'
                                                        />
                                                        <label className='text-xs text-muted-foreground'>
                                                            Fin
                                                        </label>
                                                        <input
                                                            type='text'
                                                            inputMode='numeric'
                                                            value={manualEditingEndYear}
                                                            onChange={(e) =>
                                                                setManualEditingEndYear(
                                                                    e.target
                                                                        .value,
                                                                )
                                                            }
                                                            className='w-20 rounded border border-border bg-card px-2 py-1 text-xs'
                                                        />
                                                        <label className='text-xs text-muted-foreground'>
                                                            Salaire (M)
                                                        </label>
                                                        <input
                                                            type='text'
                                                            inputMode='decimal'
                                                            value={manualEditingSalary}
                                                            onChange={(e) =>
                                                                setManualEditingSalary(
                                                                    e.target
                                                                        .value,
                                                                )
                                                            }
                                                            className='w-24 rounded border border-border bg-card px-2 py-1 text-xs'
                                                        />
                                                    </div>
                                                    <div className='flex gap-2'>
                                                        <button
                                                            type='button'
                                                            onClick={() =>
                                                                void handleSaveManualContract()
                                                            }
                                                            disabled={manualBusy}
                                                            className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50'
                                                        >
                                                            Enregistrer
                                                        </button>
                                                        <button
                                                            type='button'
                                                            onClick={() =>
                                                                setManualEditingContractId(
                                                                    null,
                                                                )
                                                            }
                                                            disabled={manualBusy}
                                                            className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50'
                                                        >
                                                            Annuler
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className='flex flex-wrap items-center justify-between gap-2'>
                                                    <span className='text-foreground'>
                                                        {formatSeasonRange(
                                                            row.startSeason,
                                                            row.endSeason,
                                                        )}
                                                        {' · '}
                                                        <span className='font-semibold text-emerald-400'>
                                                            {(row.salary /
                                                                1_000_000)
                                                                .toFixed(2)
                                                                .replace(
                                                                    /\.?0+$/,
                                                                    '',
                                                                )}
                                                            M
                                                        </span>
                                                    </span>
                                                    <div className='flex gap-2'>
                                                        <button
                                                            type='button'
                                                            onClick={() =>
                                                                beginEditManualContract(
                                                                    row,
                                                                )
                                                            }
                                                            disabled={manualBusy}
                                                            className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50'
                                                        >
                                                            Modifier
                                                        </button>
                                                        <button
                                                            type='button'
                                                            onClick={() =>
                                                                void handleDeleteManualContract(
                                                                    row.playerContractId,
                                                                    row.startSeason,
                                                                    row.endSeason,
                                                                )
                                                            }
                                                            disabled={manualBusy}
                                                            className='cursor-pointer rounded border border-destructive/40 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50'
                                                        >
                                                            Supprimer
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                        </div>

                        {/* Add new contract */}
                        <div className='space-y-2 rounded-lg border border-dashed border-border bg-background/50 p-3'>
                            <p className='text-xs font-medium text-muted-foreground'>
                                Ajouter un contrat :
                            </p>
                            <div className='flex flex-wrap items-center gap-2'>
                                <label className='text-xs text-muted-foreground'>
                                    Début
                                </label>
                                <input
                                    type='text'
                                    inputMode='numeric'
                                    value={manualNewStartYear}
                                    onChange={(e) =>
                                        setManualNewStartYear(e.target.value)
                                    }
                                    placeholder='2026'
                                    className='w-20 rounded border border-border bg-card px-2 py-1 text-xs'
                                />
                                <label className='text-xs text-muted-foreground'>
                                    Fin
                                </label>
                                <input
                                    type='text'
                                    inputMode='numeric'
                                    value={manualNewEndYear}
                                    onChange={(e) =>
                                        setManualNewEndYear(e.target.value)
                                    }
                                    placeholder='2031'
                                    className='w-20 rounded border border-border bg-card px-2 py-1 text-xs'
                                />
                                <label className='text-xs text-muted-foreground'>
                                    Salaire (M)
                                </label>
                                <input
                                    type='text'
                                    inputMode='decimal'
                                    value={manualNewSalary}
                                    onChange={(e) =>
                                        setManualNewSalary(e.target.value)
                                    }
                                    placeholder='11.6'
                                    className='w-24 rounded border border-border bg-card px-2 py-1 text-xs'
                                />
                                <button
                                    type='button'
                                    onClick={() =>
                                        void handleAddManualContract()
                                    }
                                    disabled={
                                        manualBusy ||
                                        manualNewStartYear.trim() === '' ||
                                        manualNewEndYear.trim() === '' ||
                                        manualNewSalary.trim() === ''
                                    }
                                    className='cursor-pointer rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50'
                                >
                                    {manualBusy ? '...' : 'Créer'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* ============================================================
                Export des alignements
                ============================================================ */}
            <div className='max-w-2xl space-y-3'>
                <h3 className='text-lg font-semibold text-foreground'>
                    Export des alignements
                </h3>

                <p className='text-sm text-muted-foreground'>
                    Télécharge un fichier texte contenant l'alignement
                    actuel de chaque équipe (Alignement principal, Banc,
                    Prospects) avec les positions et les salaires.
                </p>

                {exportRostersError && (
                    <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                        {exportRostersError}
                    </p>
                )}

                <button
                    type='button'
                    onClick={() => void handleExportRosters()}
                    disabled={exportingRosters || teams.length === 0}
                    className={primaryButtonClass}
                >
                    {exportingRosters
                        ? 'Préparation du fichier...'
                        : 'Télécharger ROSTERS'}
                </button>
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
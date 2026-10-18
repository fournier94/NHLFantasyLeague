import { useEffect, useMemo, useState } from 'react';
import {
    assignPlayer,
    assignUserTeam,
    clearSystemEventLogs,
    demoteUser,
    getLeagueTeams,
    getSystemEventLogs,
    getTeamDraftPicks,
    getTeamRoster,
    getTeamRosterAtDate,
    getUsers,
    promoteUser,
    releasePlayer,
    resetPlayerFantasyHistory,
    resetUserPassword,
    searchPlayers,
    swapRosterStatus,
    transferDraftPick,
    unassignUserTeam,
    updateRosterEntry,
    deleteStatusHistory,
    getRosterStatusHistory,
    getPlayerFullStatusHistory,
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
    getAcceptedTrades,
    deleteAcceptedTrade,
    getRosterShapeViolations,
    getActiveGameLogsForTeam,
    startCapFreezeContractsJob,
    finalizeAdminTrade,
    getAdminTradeHistory,
    changeAdminTradeDate,
    revertAdminTrade,
    finalizeStatusChange,
    getStatusChangeHistory,
    changeStatusChangeDate,
    revertStatusChange,
    listBackups,
    triggerBackup,
    downloadBackupUrl,
    type DraftPick,
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
    type RosterShapeViolation,
    type SystemEventLog,
    type TeamRoster,
    type AcceptedTradeRow,
    type ActivePlayerGameLog,
    type AdminTradePlayerSide,
    type AdminTradePickSide,
    type FinalizeAdminTradeRequest,
    type TradeHistoryDto,
    type AdminStatusChangePlayerSide,
    type StatusChangePair,
    type StatusChangePairRequest,
    type StatusChangeHistoryDto,
    type FinalizeStatusChangeRequest,
    type BackupFile,
} from '@/api/client';
import { useAuraAll } from '@/lib/auraContext';
import { AURA_CHANNELS } from '@/lib/auraConfig';
import { AuraButton } from '@/components/ui/AuraButton';
import { useAuth } from '@/lib/AuthContext';

// ---------------------------------------------------------------------
// Position grouping (mirrors the backend PositionGroup helper).
// ---------------------------------------------------------------------

type PositionGroup = 'F' | 'D' | 'G' | 'U';

/**
 * Client-side preview of a trade, built from the current form state.
 * Displayed in the confirm popup before the backend call. Same shape
 * as TradeHistoryDto minus the ID / season / confirmedAt fields.
 */
interface AdminTradePreview {
    teamAId: number;
    teamAName: string;
    teamBId: number;
    teamBName: string;
    effectiveAt: string;
    note: string | null;
    teamASentPlayers: AdminTradePlayerSide[];
    teamBSentPlayers: AdminTradePlayerSide[];
    teamASentPicks: AdminTradePickSide[];
    teamBSentPicks: AdminTradePickSide[];
}

interface StatusChangePreview {
    fantasyTeamId: number;
    fantasyTeamName: string;
    statusAName: string;
    statusBName: string;
    effectiveAt: string;
    note: string | null;
    pairs: StatusChangePair[];
}

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

/**
 * Statuses allowed on a RosterStatusHistory row. "Released" is a
 * terminal status that only ever appears on history rows, never
 * on a live RosterEntry. The history edit form needs it so the
 * admin can correct a mistaken release or mark a past row as
 * terminal.
 */
const ROSTER_STATUSES_WITH_RELEASED = [
    ...ROSTER_STATUSES,
    { value: 'Released', label: 'Libéré' },
] as const;

/**
 * Parses a season display name like "2026-2027" into the
 * corresponding NHL season code (20262027). Returns null when the
 * name does not match the "YYYY-YYYY" format.
 */
function seasonCodeFromName(
    name: string | null | undefined,
): number | null {
    if (!name) return null;

    const parts = name.split('-');
    if (parts.length !== 2) return null;

    const start = Number(parts[0]);
    const end = Number(parts[1]);

    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (start < 1900 || start > 2200) return null;
    if (end < 1900 || end > 2200) return null;

    return start * 10000 + end;
}

const MIN_SEARCH_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;

function statusLabel(status: string): string {
    return ROSTER_STATUSES.find((entry) => entry.value === status)?.label ?? status;
}

/**
 * Display label for one draft pick on an accepted trade card.
 * Same format as the marketplace pick chips: "Year, Ronde N,
 * OriginalOwnerTeamName". No pick number — the real order is set
 * by the annual lottery and is unknown at trade time.
 */
function formatAcceptedTradePick(pick: DraftPick): string {
    return `${pick.draftYear}, Ronde ${pick.round}, ${pick.originalOwnerFantasyTeamName}`;
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

interface ProjectedShape {
    activeF: number;
    activeD: number;
    activeG: number;
    benchF: number;
    benchD: number;
    benchG: number;
    prospects: number;
    isValid: boolean;
}

/**
 * Computes the roster shape a team WOULD have after a trade, given
 * its current roster, the set of its players being sent away, and
 * the (position + new status) of every player arriving from the
 * other side.
 *
 * Used purely for display: a broken projected shape does NOT block
 * the trade. The backend was relaxed to accept it, and the
 * commissioner fixes the resulting statuses manually via the
 * "Gestion des joueurs" edit form.
 */
function computeProjectedShape(
    currentEntries: RosterEntry[],
    outgoingPlayerIds: ReadonlySet<number>,
    incomingPlayers: ReadonlyArray<{
        position: string;
        newStatus: string;
    }>,
): ProjectedShape {
    const counts = {
        activeF: 0,
        activeD: 0,
        activeG: 0,
        benchF: 0,
        benchD: 0,
        benchG: 0,
        prospects: 0,
    };

    function addToBucket(group: PositionGroup, status: string): void {
        if (status === 'Prospect') {
            counts.prospects++;
            return;
        }
        if (status === 'Active') {
            if (group === 'F') counts.activeF++;
            else if (group === 'D') counts.activeD++;
            else if (group === 'G') counts.activeG++;
        } else if (status === 'Bench') {
            if (group === 'F') counts.benchF++;
            else if (group === 'D') counts.benchD++;
            else if (group === 'G') counts.benchG++;
        }
    }

    for (const entry of currentEntries) {
        if (outgoingPlayerIds.has(entry.playerId)) continue;
        addToBucket(positionGroup(entry.position), entry.rosterStatus);
    }

    for (const incoming of incomingPlayers) {
        addToBucket(positionGroup(incoming.position), incoming.newStatus);
    }

    const isValid =
        counts.activeF === 12 &&
        counts.activeD === 6 &&
        counts.activeG === 1 &&
        counts.benchF === 4 &&
        counts.benchD === 2 &&
        counts.benchG === 1 &&
        counts.prospects === 3;

    return { ...counts, isValid };
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
    const [assignEffectiveAt, setAssignEffectiveAt] = useState('');
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

    // Accepted trades section state.
    const [showAcceptedTrades, setShowAcceptedTrades] = useState(false);
    const [acceptedTrades, setAcceptedTrades] =
        useState<AcceptedTradeRow[]>([]);
    const [acceptedTradesLoading, setAcceptedTradesLoading] =
        useState(false);
    const [acceptedTradesError, setAcceptedTradesError] =
        useState<string | null>(null);
    const [acceptedTradesBusyId, setAcceptedTradesBusyId] =
        useState<number | null>(null);

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

    // --- CapFreeze contracts job state ---
    const [capFreezeJobId, setCapFreezeJobId] = useState<string | null>(null);
    const [capFreezeJob, setCapFreezeJob] = useState<BackgroundJobStatus | null>(null);
    const [capFreezeStarting, setCapFreezeStarting] = useState(false);
    const [capFreezeError, setCapFreezeError] = useState<string | null>(null);

    // --- Draft pick transfer section state ---
    const [draftTransferFromTeamId, setDraftTransferFromTeamId] =
        useState('');
    const [draftTransferToTeamId, setDraftTransferToTeamId] =
        useState('');
    const [draftTransferPicks, setDraftTransferPicks] =
        useState<DraftPick[]>([]);
    const [draftTransferPickId, setDraftTransferPickId] = useState('');
    const [draftTransferPicksLoading, setDraftTransferPicksLoading] =
        useState(false);
    const [draftTransferBusy, setDraftTransferBusy] = useState(false);
    const [draftTransferError, setDraftTransferError] =
        useState<string | null>(null);
    const [draftTransferSuccess, setDraftTransferSuccess] =
        useState<string | null>(null);

    // --- Player movement history section state ---
    const [movementSearch, setMovementSearch] = useState('');
    const [movementResults, setMovementResults] = useState<
        PlayerSearchResult[]
    >([]);
    const [movementSearching, setMovementSearching] = useState(false);
    const [movementSelectedPlayer, setMovementSelectedPlayer] =
        useState<PlayerSearchResult | null>(null);
    const [movementHistory, setMovementHistory] = useState<
        RosterStatusHistoryRow[]
    >([]);
    const [movementHistoryLoading, setMovementHistoryLoading] =
        useState(false);
    const [movementHistoryError, setMovementHistoryError] =
        useState<string | null>(null);
    const [movementHistorySuccess, setMovementHistorySuccess] =
        useState<string | null>(null);
    const [movementHistoryBusy, setMovementHistoryBusy] =
        useState(false);

    // Inline edit state for the movement history table.
    const [movementEditingRowId, setMovementEditingRowId] =
        useState<number | null>(null);
    const [movementEditingEffectiveAt, setMovementEditingEffectiveAt] =
        useState('');
    const [movementEditingStatus, setMovementEditingStatus] =
        useState('Active');
    const [movementEditingNote, setMovementEditingNote] = useState('');

    // Debounced player search for the movement history section.
    // Same 300 ms cadence used by the other search inputs in this
    // page.
    useEffect(() => {
        const text = movementSearch.trim();

        if (text.length < MIN_SEARCH_LENGTH || movementSelectedPlayer) {
            setMovementResults([]);
            setMovementSearching(false);
            return;
        }

        setMovementSearching(true);

        let cancelled = false;

        const timer = setTimeout(() => {
            searchPlayers(text)
                .then((data) => {
                    if (!cancelled) setMovementResults(data);
                })
                .catch(() => {
                    if (!cancelled) setMovementResults([]);
                })
                .finally(() => {
                    if (!cancelled) setMovementSearching(false);
                });
        }, SEARCH_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [movementSearch, movementSelectedPlayer]);

    // --- Reset player fantasy history section state ---

    const [resetPlayerSearch, setResetPlayerSearch] = useState('');
    const [resetPlayerSearchResults, setResetPlayerSearchResults] =
        useState<PlayerSearchResult[]>([]);
    const [resetPlayerSearching, setResetPlayerSearching] = useState(false);
    const [resetPlayerSelected, setResetPlayerSelected] =
        useState<PlayerSearchResult | null>(null);
    const [resetPlayerConfirmFor, setResetPlayerConfirmFor] =
        useState<number | null>(null);
    const [resetPlayerConfirmInput, setResetPlayerConfirmInput] =
        useState('');
    const [resetPlayerBusy, setResetPlayerBusy] = useState(false);
    const [resetPlayerError, setResetPlayerError] = useState<string | null>(
        null,
    );
    const [resetPlayerSuccess, setResetPlayerSuccess] = useState<
        string | null
    >(null);

    // Debounced player search for the "Réinitialiser l'historique
    // fantasy d'un joueur" section.
    useEffect(() => {
        const text = resetPlayerSearch.trim();

        if (text.length < MIN_SEARCH_LENGTH || resetPlayerSelected) {
            setResetPlayerSearchResults([]);
            setResetPlayerSearching(false);
            return;
        }

        setResetPlayerSearching(true);

        let cancelled = false;

        const timer = setTimeout(() => {
            searchPlayers(text)
                .then((data) => {
                    if (!cancelled) setResetPlayerSearchResults(data);
                })
                .catch(() => {
                    if (!cancelled) setResetPlayerSearchResults([]);
                })
                .finally(() => {
                    if (!cancelled) setResetPlayerSearching(false);
                });
        }, SEARCH_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [resetPlayerSearch, resetPlayerSelected]);

    // --- Shape audit state ---
    const [shapeViolations, setShapeViolations] = useState<
        RosterShapeViolation[]
    >([]);
    const [shapeViolationsLoading, setShapeViolationsLoading] =
        useState(false);
    const [shapeViolationsError, setShapeViolationsError] =
        useState<string | null>(null);
    const [shapeViolationsLoaded, setShapeViolationsLoaded] =
        useState(false);

    // --- Active Lineup Game Logs state ---
    const [activeLogsTeamId, setActiveLogsTeamId] = useState('');
    const [activeLogs, setActiveLogs] = useState<ActivePlayerGameLog[]>([]);
    const [activeLogsLoading, setActiveLogsLoading] = useState(false);
    const [activeLogsError, setActiveLogsError] = useState<string | null>(null);

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

    // Poll the CapFreeze job while it runs.
    useEffect(() => {
        if (!capFreezeJobId) return;

        let cancelled = false;
        let timeoutId: number | null = null;

        const poll = async () => {
            try {
                const status = await getJobStatus(capFreezeJobId);

                if (cancelled) return;

                setCapFreezeJob(status);

                if (status.status === 'Running') {
                    timeoutId = window.setTimeout(poll, 3000);
                }
            } catch {
                // Stop polling on error.
            }
        };

        void poll();

        return () => {
            cancelled = true;
            if (timeoutId != null) window.clearTimeout(timeoutId);
        };
    }, [capFreezeJobId]);

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

    async function handleStartCapFreezeContracts() {
        if (
            !window.confirm(
                'Lancer le rafraîchissement des contrats CapFreeze ? ' +
                'Cela va mettre à jour les salaires, les saisons et les statuts pour tous les joueurs. ' +
                'Cela peut prendre plusieurs minutes.',
            )
        ) {
            return;
        }

        setCapFreezeStarting(true);
        setCapFreezeError(null);

        try {
            const result = await startCapFreezeContractsJob();
            setCapFreezeJobId(result.jobId);
            setCapFreezeJob(null);
        } catch (err) {
            setCapFreezeError(
                err instanceof Error
                    ? err.message
                    : 'Erreur inconnue.',
            );
        } finally {
            setCapFreezeStarting(false);
        }
    }

    async function handleMovementPlayerSelect(
        player: PlayerSearchResult,
    ) {
        setMovementSelectedPlayer(player);
        setMovementSearch(`${player.firstName} ${player.lastName}`);
        setMovementResults([]);
        setMovementHistory([]);
        setMovementHistoryError(null);
        setMovementHistoryLoading(true);
        setMovementHistorySuccess(null);
        setMovementEditingRowId(null);
        setMovementEditingEffectiveAt('');
        setMovementEditingStatus('Active');
        setMovementEditingNote('');

        try {
            const rows = await getPlayerFullStatusHistory(
                player.playerId,
            );
            setMovementHistory(rows);
        } catch (err) {
            setMovementHistoryError(
                err instanceof Error
                    ? err.message
                    : 'Erreur inconnue.',
            );
        } finally {
            setMovementHistoryLoading(false);
        }
    }

    function handleMovementClear() {
        setMovementSelectedPlayer(null);
        setMovementSearch('');
        setMovementResults([]);
        setMovementHistory([]);
        setMovementHistoryError(null);
        setMovementHistoryLoading(false);
        setMovementHistorySuccess(null);
        setMovementEditingRowId(null);
        setMovementEditingEffectiveAt('');
        setMovementEditingStatus('Active');
        setMovementEditingNote('');
    }

    function handleResetPlayerPick(player: PlayerSearchResult) {
        setResetPlayerSelected(player);
        setResetPlayerSearch(`${player.firstName} ${player.lastName}`);
        setResetPlayerSearchResults([]);
        setResetPlayerError(null);
        setResetPlayerSuccess(null);
    }

    async function handleResetPlayerFantasyHistory() {
        if (!resetPlayerSelected) return;

        // The button is already disabled until the confirmation text
        // matches, but double-check here so a programmatic click
        // cannot bypass the guard.
        if (
            resetPlayerConfirmInput.trim().toUpperCase() !== 'SUPPRIMER'
        ) {
            setResetPlayerError('Tapez SUPPRIMER pour confirmer.');
            return;
        }

        setResetPlayerBusy(true);
        setResetPlayerError(null);
        setResetPlayerSuccess(null);

        try {
            const result = await resetPlayerFantasyHistory(
                resetPlayerSelected.playerId,
            );

            setResetPlayerSuccess(result.message);

            setResetPlayerConfirmFor(null);
            setResetPlayerConfirmInput('');

            // Clear the selection: the player no longer has any
            // fantasy linkage, so there is nothing more to delete
            // on a second click. Re-searching him will show him as
            // a free agent.
            setResetPlayerSelected(null);
            setResetPlayerSearch('');
            setResetPlayerSearchResults([]);
        } catch (err) {
            setResetPlayerError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setResetPlayerBusy(false);
        }
    }

    function beginEditMovementRow(row: RosterStatusHistoryRow) {
        setMovementEditingRowId(row.id);

        // The backend stores effectiveAt at day precision UTC
        // ("YYYY-MM-DDT00:00:00Z"). We display the raw UTC
        // value in the datetime-local input, without any local
        // timezone conversion, so the round-trip is lossless.
        setMovementEditingEffectiveAt(row.effectiveAt.slice(0, 16));
        setMovementEditingStatus(row.rosterStatus);
        setMovementEditingNote(row.note ?? '');
        setMovementHistoryError(null);
        setMovementHistorySuccess(null);
    }

    function cancelEditMovementRow() {
        setMovementEditingRowId(null);
        setMovementEditingEffectiveAt('');
        setMovementEditingStatus('Active');
        setMovementEditingNote('');
    }

    async function saveMovementRow() {
        if (movementEditingRowId == null) return;

        const trimmed = movementEditingEffectiveAt.trim();

        if (trimmed.length < 16) {
            setMovementHistoryError('Date invalide.');
            return;
        }

        // The input is "YYYY-MM-DDTHH:mm". Treat the whole value
        // as UTC and complete it to a valid ISO instant. The
        // backend normalizes to day precision regardless.
        const effectiveAtIso = `${trimmed}:00Z`;

        // Find the target row so we can recompute the correct
        // season after the edit.
        const targetRow = movementHistory.find(
            (r) => r.id === movementEditingRowId,
        );

        setMovementHistoryBusy(true);
        setMovementHistoryError(null);
        setMovementHistorySuccess(null);

        try {
            const result = await updateStatusHistory(
                movementEditingRowId,
                {
                    effectiveAt: effectiveAtIso,
                    rosterStatus: movementEditingStatus,
                    note: movementEditingNote.trim() || undefined,
                },
            );

            // Recompute the season the row belongs to. Falls back
            // to the current season when the row carries no
            // season name (older rows created before the season
            // rows existed).
            const seasonCode =
                seasonCodeFromName(targetRow?.seasonName) ??
                CURRENT_SEASON_NHL_CODE;

            await recomputeTeamTotals(seasonCode);

            // Reload the player's full history so the edited row
            // shows its new values, and so any other row that
            // moved with it (siblings sharing the same
            // EffectiveAt) is refreshed.
            if (movementSelectedPlayer) {
                const rows = await getPlayerFullStatusHistory(
                    movementSelectedPlayer.playerId,
                );
                setMovementHistory(rows);
            }

            setMovementHistorySuccess(result.message);
            cancelEditMovementRow();
        } catch (err) {
            setMovementHistoryError(
                err instanceof Error
                    ? err.message
                    : 'Erreur inconnue.',
            );
        } finally {
            setMovementHistoryBusy(false);
        }
    }

    async function handleCheckShapeViolations() {
        setShapeViolationsLoading(true);
        setShapeViolationsError(null);

        try {
            const data = await getRosterShapeViolations();
            setShapeViolations(data);
            setShapeViolationsLoaded(true);
        } catch (err) {
            setShapeViolationsError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setShapeViolationsLoading(false);
        }
    }

    // Load active game logs when team selection changes
    useEffect(() => {
        if (!activeLogsTeamId) {
            setActiveLogs([]);
            setActiveLogsError(null);
            return;
        }

        let cancelled = false;
        setActiveLogsLoading(true);
        setActiveLogsError(null);

        getActiveGameLogsForTeam(Number(activeLogsTeamId))
            .then((data) => {
                if (!cancelled) setActiveLogs(data);
            })
            .catch((err) => {
                if (!cancelled) {
                    setActiveLogsError(
                        err instanceof Error ? err.message : 'Erreur inconnue.',
                    );
                }
            })
            .finally(() => {
                if (!cancelled) setActiveLogsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [activeLogsTeamId]);

    // Aggregated per-player totals from the raw per-game log.
    //
    // Each ActivePlayerGameLog row is one game. Grouping by PlayerId
    // and summing FantasyPoints gives us the player's contribution
    // while he was in the Active starting lineup for this team.
    //
    // Sorted by total FP desc, then by last name so ties are stable.
    const activeLogTotals = useMemo(() => {
        const map = new Map<
            number,
            {
                playerId: number;
                nhlPlayerId: number;
                firstName: string;
                lastName: string;
                gp: number;
                fp: number;
            }
        >();

        for (const row of activeLogs) {
            const existing = map.get(row.playerId);

            if (existing) {
                existing.gp += 1;
                existing.fp += row.fantasyPoints;
            } else {
                map.set(row.playerId, {
                    playerId: row.playerId,
                    nhlPlayerId: row.nhlPlayerId,
                    firstName: row.firstName,
                    lastName: row.lastName,
                    gp: 1,
                    fp: row.fantasyPoints,
                });
            }
        }

        return Array.from(map.values()).sort((a, b) => {
            if (b.fp !== a.fp) return b.fp - a.fp;
            return a.lastName.localeCompare(b.lastName);
        });
    }, [activeLogs]);

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

    // ---------------------------------------------------------------
    // Trades history / Créer un échange state
    // ---------------------------------------------------------------
    const [showAdminTradeForm, setShowAdminTradeForm] = useState(false);
    const [adminTradeDate, setAdminTradeDate] = useState(
        todayLocalDateInputValue().slice(0, 10),
    );
    const [adminTradeTeamAId, setAdminTradeTeamAId] = useState('');
    const [adminTradeTeamBId, setAdminTradeTeamBId] = useState('');
    const [adminTradeTeamAPlayerSlots, setAdminTradeTeamAPlayerSlots] =
        useState<string[]>(['']);
    const [
        adminTradeTeamAPlayerNewStatuses,
        setAdminTradeTeamAPlayerNewStatuses,
    ] = useState<string[]>(['']);
    const [adminTradeTeamBPlayerSlots, setAdminTradeTeamBPlayerSlots] =
        useState<string[]>(['']);
    const [
        adminTradeTeamBPlayerNewStatuses,
        setAdminTradeTeamBPlayerNewStatuses,
    ] = useState<string[]>(['']);
    const [adminTradeTeamAPickIds, setAdminTradeTeamAPickIds] =
        useState<number[]>([]);
    const [adminTradeTeamBPickIds, setAdminTradeTeamBPickIds] =
        useState<number[]>([]);
    const [adminTradeNote, setAdminTradeNote] = useState('');

    const [adminTradeTeamARoster, setAdminTradeTeamARoster] =
        useState<TeamRoster | null>(null);
    const [adminTradeTeamBRoster, setAdminTradeTeamBRoster] =
        useState<TeamRoster | null>(null);
    const [adminTradeTeamAPicks, setAdminTradeTeamAPicks] =
        useState<DraftPick[]>([]);
    const [adminTradeTeamBPicks, setAdminTradeTeamBPicks] =
        useState<DraftPick[]>([]);

    const [adminTradePickPopupSide, setAdminTradePickPopupSide] =
        useState<'A' | 'B' | null>(null);

    const [adminTradePreviewOpen, setAdminTradePreviewOpen] =
        useState(false);
    const [adminTradePreview, setAdminTradePreview] =
        useState<AdminTradePreview | null>(null);
    const [adminTradeSubmitting, setAdminTradeSubmitting] = useState(false);
    const [adminTradeError, setAdminTradeError] =
        useState<string | null>(null);
    const [adminTradeSuccess, setAdminTradeSuccess] =
        useState<string | null>(null);

    const [adminTradeHistory, setAdminTradeHistory] =
        useState<TradeHistoryDto[]>([]);
    const [adminTradeHistoryLoading, setAdminTradeHistoryLoading] =
        useState(false);
    const [showAdminTradeHistory, setShowAdminTradeHistory] =
        useState(false);

    // Per-trade date-change editing state. Only one trade can be in
    // edit mode at a time.
    const [adminTradeDateEditFor, setAdminTradeDateEditFor] =
        useState<number | null>(null);
    const [adminTradeDateEditValue, setAdminTradeDateEditValue] =
        useState('');
    const [adminTradeDateEditReason, setAdminTradeDateEditReason] =
        useState('');
    const [adminTradeDateEditBusy, setAdminTradeDateEditBusy] =
        useState(false);
    const [adminTradeDateEditError, setAdminTradeDateEditError] =
        useState<string | null>(null);

    // Revert-trade confirmation state. Only one trade can be in
    // "pending revert" mode at a time; the admin must type the
    // trade ID to confirm.
    const [adminTradeRevertFor, setAdminTradeRevertFor] =
        useState<number | null>(null);
    const [adminTradeRevertConfirmInput, setAdminTradeRevertConfirmInput] =
        useState('');
    const [adminTradeRevertBusy, setAdminTradeRevertBusy] =
        useState(false);
    const [adminTradeRevertError, setAdminTradeRevertError] =
        useState<string | null>(null);

    async function handleRevertTrade(tradeId: number) {
        if (adminTradeRevertConfirmInput.trim() !== String(tradeId)) {
            setAdminTradeRevertError(
                `Tapez le numéro de l'échange (${tradeId}) pour confirmer.`,
            );
            return;
        }

        setAdminTradeRevertBusy(true);
        setAdminTradeRevertError(null);

        try {
            const result = await revertAdminTrade(tradeId);

            setAdminTradeHistory((prev) =>
                prev.filter((t) => t.id !== tradeId),
            );

            setAdminTradeRevertFor(null);
            setAdminTradeRevertConfirmInput('');
            setAdminTradeSuccess(result.message);
        } catch (err) {
            setAdminTradeRevertError(
                err instanceof Error
                    ? err.message
                    : 'Erreur inconnue.',
            );
        } finally {
            setAdminTradeRevertBusy(false);
        }
    }

    async function handleChangeTradeDate(tradeId: number) {
        if (!adminTradeDateEditValue) {
            setAdminTradeDateEditError('Choisissez une date.');
            return;
        }

        setAdminTradeDateEditBusy(true);
        setAdminTradeDateEditError(null);

        try {
            const newEffectiveAtIso = new Date(
                adminTradeDateEditValue + 'T00:00:00Z',
            ).toISOString();

            const result = await changeAdminTradeDate(
                tradeId,
                newEffectiveAtIso,
                adminTradeDateEditReason.trim() || null,
            );

            if (!result.success || !result.tradeHistory) {
                setAdminTradeDateEditError(
                    result.message || 'Erreur inconnue.',
                );
                return;
            }

            setAdminTradeHistory((prev) =>
                prev.map((t) =>
                    t.id === tradeId ? result.tradeHistory! : t,
                ),
            );

            setAdminTradeDateEditFor(null);
            setAdminTradeDateEditValue('');
            setAdminTradeDateEditReason('');
        } catch (err) {
            setAdminTradeDateEditError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setAdminTradeDateEditBusy(false);
        }
    }

    useEffect(() => {
        void loadAdminTradeHistory();
    }, []);

    useEffect(() => {
        if (!adminTradeTeamAId || adminTradeDate.trim() === '') {
            setAdminTradeTeamARoster(null);
            setAdminTradeTeamAPicks([]);
            setAdminTradeTeamAPlayerSlots(['']);
            setAdminTradeTeamAPlayerNewStatuses(['']);
            setAdminTradeTeamAPickIds([]);
            return;
        }

        let cancelled = false;

        Promise.all([
            getTeamRosterAtDate(
                Number(adminTradeTeamAId),
                adminTradeDate,
            ),
            getTeamDraftPicks(Number(adminTradeTeamAId)),
        ])
            .then(([roster, picks]) => {
                if (cancelled) return;
                setAdminTradeTeamARoster(roster);
                setAdminTradeTeamAPicks(picks);
                setAdminTradeTeamAPlayerSlots(['']);
                setAdminTradeTeamAPlayerNewStatuses(['']);
                setAdminTradeTeamAPickIds([]);
            })
            .catch(() => {
                if (cancelled) return;
                setAdminTradeTeamARoster(null);
                setAdminTradeTeamAPicks([]);
            });

        return () => {
            cancelled = true;
        };
    }, [adminTradeTeamAId, adminTradeDate]);

    useEffect(() => {
        if (!adminTradeTeamBId || adminTradeDate.trim() === '') {
            setAdminTradeTeamBRoster(null);
            setAdminTradeTeamBPicks([]);
            setAdminTradeTeamBPlayerSlots(['']);
            setAdminTradeTeamBPlayerNewStatuses(['']);
            setAdminTradeTeamBPickIds([]);
            return;
        }

        let cancelled = false;

        Promise.all([
            getTeamRosterAtDate(
                Number(adminTradeTeamBId),
                adminTradeDate,
            ),
            getTeamDraftPicks(Number(adminTradeTeamBId)),
        ])
            .then(([roster, picks]) => {
                if (cancelled) return;
                setAdminTradeTeamBRoster(roster);
                setAdminTradeTeamBPicks(picks);
                setAdminTradeTeamBPlayerSlots(['']);
                setAdminTradeTeamBPlayerNewStatuses(['']);
                setAdminTradeTeamBPickIds([]);
            })
            .catch(() => {
                if (cancelled) return;
                setAdminTradeTeamBRoster(null);
                setAdminTradeTeamBPicks([]);
            });

        return () => {
            cancelled = true;
        };
    }, [adminTradeTeamBId, adminTradeDate]);

    async function loadAdminTradeHistory() {
        setAdminTradeHistoryLoading(true);
        try {
            const rows = await getAdminTradeHistory();
            setAdminTradeHistory(rows);
        } catch {
            setAdminTradeHistory([]);
        } finally {
            setAdminTradeHistoryLoading(false);
        }
    }

    function addAdminTradePlayerSlot() {
        setAdminTradeTeamAPlayerSlots((prev) => [...prev, '']);
        setAdminTradeTeamAPlayerNewStatuses((prev) => [...prev, '']);
        setAdminTradeTeamBPlayerSlots((prev) => [...prev, '']);
        setAdminTradeTeamBPlayerNewStatuses((prev) => [...prev, '']);
    }

    function removeAdminTradePlayerSlot(index: number) {
        setAdminTradeTeamAPlayerSlots((prev) =>
            prev.length > 1
                ? prev.filter((_, i) => i !== index)
                : prev,
        );
        setAdminTradeTeamAPlayerNewStatuses((prev) =>
            prev.length > 1
                ? prev.filter((_, i) => i !== index)
                : prev,
        );
        setAdminTradeTeamBPlayerSlots((prev) =>
            prev.length > 1
                ? prev.filter((_, i) => i !== index)
                : prev,
        );
        setAdminTradeTeamBPlayerNewStatuses((prev) =>
            prev.length > 1
                ? prev.filter((_, i) => i !== index)
                : prev,
        );
    }

    function setAdminTradeTeamAPlayerSlot(index: number, value: string) {
        setAdminTradeTeamAPlayerSlots((prev) =>
            prev.map((v, i) => (i === index ? value : v)),
        );

        // When the player changes, reset his status override so the
        // dropdown reflects the new player's current status.
        setAdminTradeTeamAPlayerNewStatuses((prev) =>
            prev.map((v, i) => (i === index ? '' : v)),
        );
    }

    function setAdminTradeTeamAPlayerNewStatus(
        index: number,
        value: string,
    ) {
        setAdminTradeTeamAPlayerNewStatuses((prev) =>
            prev.map((v, i) => (i === index ? value : v)),
        );
    }

    function setAdminTradeTeamBPlayerSlot(index: number, value: string) {
        setAdminTradeTeamBPlayerSlots((prev) =>
            prev.map((v, i) => (i === index ? value : v)),
        );

        setAdminTradeTeamBPlayerNewStatuses((prev) =>
            prev.map((v, i) => (i === index ? '' : v)),
        );
    }

    function setAdminTradeTeamBPlayerNewStatus(
        index: number,
        value: string,
    ) {
        setAdminTradeTeamBPlayerNewStatuses((prev) =>
            prev.map((v, i) => (i === index ? value : v)),
        );
    }

    function toggleAdminTradePick(side: 'A' | 'B', pickId: number) {
        if (side === 'A') {
            setAdminTradeTeamAPickIds((prev) =>
                prev.includes(pickId)
                    ? prev.filter((id) => id !== pickId)
                    : [...prev, pickId],
            );
        } else {
            setAdminTradeTeamBPickIds((prev) =>
                prev.includes(pickId)
                    ? prev.filter((id) => id !== pickId)
                    : [...prev, pickId],
            );
        }
    }

    function buildAdminTradePreview(): AdminTradePreview | null {
        setAdminTradeError(null);
        setAdminTradeSuccess(null);

        const teamA = teams.find(
            (t) => String(t.id) === adminTradeTeamAId,
        );
        const teamB = teams.find(
            (t) => String(t.id) === adminTradeTeamBId,
        );

        if (!teamA) {
            setAdminTradeError('Choisissez Équipe 1.');
            return null;
        }
        if (!teamB) {
            setAdminTradeError('Choisissez Équipe 2.');
            return null;
        }
        if (adminTradeDate.trim() === '') {
            setAdminTradeError("Choisissez la date d'entrée en vigueur.");
            return null;
        }

        // Validate: every slot with a player on one side must have one
        // on the other side too, because slots are paired.
        for (let i = 0; i < adminTradeTeamAPlayerSlots.length; i++) {
            const a = adminTradeTeamAPlayerSlots[i];
            const b = adminTradeTeamBPlayerSlots[i];
            if ((a === '') !== (b === '')) {
                setAdminTradeError(
                    `Slot ${i + 1} : remplissez les deux côtés ou aucun.`,
                );
                return null;
            }
        }

        // Pairs of { playerId, newStatus } derived from the slot arrays
        // and the parallel override arrays. Empty newStatus means "no
        // override, keep the current status".
        const aPlayerRequests: { playerId: number; newStatus: string }[] = [];
        const bPlayerRequests: { playerId: number; newStatus: string }[] = [];

        for (let i = 0; i < adminTradeTeamAPlayerSlots.length; i++) {
            const aId = adminTradeTeamAPlayerSlots[i];
            const bId = adminTradeTeamBPlayerSlots[i];

            if (aId !== '') {
                aPlayerRequests.push({
                    playerId: Number(aId),
                    newStatus: adminTradeTeamAPlayerNewStatuses[i] || '',
                });
            }
            if (bId !== '') {
                bPlayerRequests.push({
                    playerId: Number(bId),
                    newStatus: adminTradeTeamBPlayerNewStatuses[i] || '',
                });
            }
        }

        if (
            aPlayerRequests.length === 0 &&
            bPlayerRequests.length === 0 &&
            adminTradeTeamAPickIds.length === 0 &&
            adminTradeTeamBPickIds.length === 0
        ) {
            setAdminTradeError(
                'Ajoutez au moins un joueur ou un choix de repêchage.',
            );
            return null;
        }

        const effectiveAt = new Date(
            adminTradeDate + 'T00:00:00Z',
        ).toISOString();

        const buildPlayerSide = (
            playerId: number,
            overrideStatus: string,
            roster: TeamRoster | null,
        ): AdminTradePlayerSide | null => {
            if (!roster) return null;
            const e = roster.entries.find((x) => x.playerId === playerId);
            if (!e) return null;
            return {
                playerId: e.playerId,
                nhlPlayerId: e.nhlPlayerId,
                firstName: e.firstName,
                lastName: e.lastName,
                position: e.position,
                nhlTeamAbbreviation: e.nhlTeamAbbreviation,
                salary: e.currentContract?.salary ?? e.fantasySalary,
                yearsRemaining: e.currentContract?.yearsRemaining ?? 1,
                previousStatus: e.rosterStatus,
                newStatus: overrideStatus || e.rosterStatus,
            };
        };

        const buildPickSide = (
            id: number,
            picks: DraftPick[],
        ): AdminTradePickSide | null => {
            const p = picks.find((x) => x.id === id);
            if (!p) return null;
            return {
                draftPickId: p.id,
                draftYear: p.draftYear,
                round: p.round,
                originalOwnerFantasyTeamName:
                    p.originalOwnerFantasyTeamName,
            };
        };

        const aPlayers = aPlayerRequests
            .map((r) =>
                buildPlayerSide(
                    r.playerId,
                    r.newStatus,
                    adminTradeTeamARoster,
                ),
            )
            .filter((x): x is AdminTradePlayerSide => x != null);

        const bPlayers = bPlayerRequests
            .map((r) =>
                buildPlayerSide(
                    r.playerId,
                    r.newStatus,
                    adminTradeTeamBRoster,
                ),
            )
            .filter((x): x is AdminTradePlayerSide => x != null);

        const aPicks = adminTradeTeamAPickIds
            .map((id) => buildPickSide(id, adminTradeTeamAPicks))
            .filter((x): x is AdminTradePickSide => x != null);

        const bPicks = adminTradeTeamBPickIds
            .map((id) => buildPickSide(id, adminTradeTeamBPicks))
            .filter((x): x is AdminTradePickSide => x != null);

        return {
            teamAId: teamA.id,
            teamAName: teamA.name,
            teamBId: teamB.id,
            teamBName: teamB.name,
            effectiveAt,
            note: adminTradeNote.trim() || null,
            teamASentPlayers: aPlayers,
            teamBSentPlayers: bPlayers,
            teamASentPicks: aPicks,
            teamBSentPicks: bPicks,
        };
    }

    function submitAdminTrade() {
        const preview = buildAdminTradePreview();
        if (!preview) return;
        setAdminTradePreview(preview);
        setAdminTradePreviewOpen(true);
    }

    async function confirmAdminTrade() {
        if (!adminTradePreview) return;

        setAdminTradeSubmitting(true);
        setAdminTradeError(null);

        try {
            const payload: FinalizeAdminTradeRequest = {
                teamAId: adminTradePreview.teamAId,
                teamBId: adminTradePreview.teamBId,
                effectiveAt: adminTradePreview.effectiveAt,
                note: adminTradePreview.note,
                teamASendingPlayers:
                    adminTradePreview.teamASentPlayers.map((p) => ({
                        playerId: p.playerId,
                        newStatus:
                            p.newStatus !== p.previousStatus
                                ? p.newStatus
                                : null,
                    })),
                teamBSendingPlayers:
                    adminTradePreview.teamBSentPlayers.map((p) => ({
                        playerId: p.playerId,
                        newStatus:
                            p.newStatus !== p.previousStatus
                                ? p.newStatus
                                : null,
                    })),
                teamASendingDraftPickIds:
                    adminTradePreview.teamASentPicks.map(
                        (p) => p.draftPickId,
                    ),
                teamBSendingDraftPickIds:
                    adminTradePreview.teamBSentPicks.map(
                        (p) => p.draftPickId,
                    ),
            };

            const result = await finalizeAdminTrade(payload);

            setAdminTradeSuccess(result.message);
            setAdminTradePreviewOpen(false);
            setAdminTradePreview(null);
            setAdminTradeTeamAPlayerSlots(['']);
            setAdminTradeTeamBPlayerSlots(['']);
            setAdminTradeTeamAPickIds([]);
            setAdminTradeTeamBPickIds([]);
            setAdminTradeNote('');

            await loadAdminTradeHistory();

            if (adminTradeTeamAId) {
                getTeamRoster(Number(adminTradeTeamAId))
                    .then((r) => setAdminTradeTeamARoster(r))
                    .catch(() => undefined);
                getTeamDraftPicks(Number(adminTradeTeamAId))
                    .then((p) => setAdminTradeTeamAPicks(p))
                    .catch(() => undefined);
            }

            if (adminTradeTeamBId) {
                getTeamRoster(Number(adminTradeTeamBId))
                    .then((r) => setAdminTradeTeamBRoster(r))
                    .catch(() => undefined);
                getTeamDraftPicks(Number(adminTradeTeamBId))
                    .then((p) => setAdminTradeTeamBPicks(p))
                    .catch(() => undefined);
            }
        } catch (err) {
            setAdminTradeError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setAdminTradeSubmitting(false);
        }
    }

    // ---------------------------------------------------------------
    // Batch status change state
    // ---------------------------------------------------------------
    const [showStatusChangeForm, setShowStatusChangeForm] =
        useState(false);
    const [statusChangeTeamId, setStatusChangeTeamId] = useState('');
    const [statusChangeDate, setStatusChangeDate] = useState(
        todayLocalDateInputValue().slice(0, 10),
    );
    const [statusChangeA, setStatusChangeA] = useState<
        'Active' | 'Bench' | 'Prospect'
    >('Active');
    const [statusChangeB, setStatusChangeB] = useState<
        'Active' | 'Bench' | 'Prospect'
    >('Bench');
    const [statusChangePairs, setStatusChangePairs] = useState<
        { aId: string; bId: string }[]
    >([{ aId: '', bId: '' }]);
    const [statusChangeNote, setStatusChangeNote] = useState('');
    const [statusChangeTeamRoster, setStatusChangeTeamRoster] =
        useState<TeamRoster | null>(null);

    const [statusChangePreviewOpen, setStatusChangePreviewOpen] =
        useState(false);
    const [statusChangePreview, setStatusChangePreview] =
        useState<StatusChangePreview | null>(null);
    const [statusChangeSubmitting, setStatusChangeSubmitting] =
        useState(false);
    const [statusChangeError, setStatusChangeError] =
        useState<string | null>(null);
    const [statusChangeSuccess, setStatusChangeSuccess] =
        useState<string | null>(null);

    const [statusChangeHistory, setStatusChangeHistory] = useState<
        StatusChangeHistoryDto[]
    >([]);
    const [statusChangeHistoryLoading, setStatusChangeHistoryLoading] =
        useState(false);
    const [showStatusChangeHistory, setShowStatusChangeHistory] =
        useState(false);

    const [statusChangeDateEditFor, setStatusChangeDateEditFor] =
        useState<number | null>(null);
    const [statusChangeDateEditValue, setStatusChangeDateEditValue] =
        useState('');
    const [statusChangeDateEditReason, setStatusChangeDateEditReason] =
        useState('');
    const [statusChangeDateEditBusy, setStatusChangeDateEditBusy] =
        useState(false);
    const [statusChangeDateEditError, setStatusChangeDateEditError] =
        useState<string | null>(null);

    const [statusChangeRevertFor, setStatusChangeRevertFor] =
        useState<number | null>(null);
    const [
        statusChangeRevertConfirmInput,
        setStatusChangeRevertConfirmInput,
    ] = useState('');
    const [statusChangeRevertBusy, setStatusChangeRevertBusy] =
        useState(false);
    const [statusChangeRevertError, setStatusChangeRevertError] =
        useState<string | null>(null);

    useEffect(() => {
        void loadStatusChangeHistory();
    }, []);

    useEffect(() => {
        if (!statusChangeTeamId || statusChangeDate.trim() === '') {
            setStatusChangeTeamRoster(null);
            setStatusChangePairs([{ aId: '', bId: '' }]);
            return;
        }

        let cancelled = false;

        getTeamRosterAtDate(
            Number(statusChangeTeamId),
            statusChangeDate,
        )
            .then((r) => {
                if (cancelled) return;
                setStatusChangeTeamRoster(r);
                setStatusChangePairs([{ aId: '', bId: '' }]);
            })
            .catch(() => {
                if (cancelled) return;
                setStatusChangeTeamRoster(null);
            });

        return () => {
            cancelled = true;
        };
    }, [statusChangeTeamId, statusChangeDate]);

    async function loadStatusChangeHistory() {
        setStatusChangeHistoryLoading(true);
        try {
            const rows = await getStatusChangeHistory();
            setStatusChangeHistory(rows);
        } catch {
            setStatusChangeHistory([]);
        } finally {
            setStatusChangeHistoryLoading(false);
        }
    }

    function addStatusChangePair() {
        setStatusChangePairs((prev) => [
            ...prev,
            { aId: '', bId: '' },
        ]);
    }

    function removeStatusChangePair(index: number) {
        setStatusChangePairs((prev) =>
            prev.length > 1 ? prev.filter((_, i) => i !== index) : prev,
        );
    }

    function setStatusChangePairA(index: number, value: string) {
        setStatusChangePairs((prev) =>
            prev.map((p, i) => (i === index ? { ...p, aId: value } : p)),
        );
    }

    function setStatusChangePairB(index: number, value: string) {
        setStatusChangePairs((prev) =>
            prev.map((p, i) => (i === index ? { ...p, bId: value } : p)),
        );
    }

    function buildStatusChangePreview(): StatusChangePreview | null {
        setStatusChangeError(null);
        setStatusChangeSuccess(null);

        const team = teams.find(
            (t) => String(t.id) === statusChangeTeamId,
        );

        if (!team) {
            setStatusChangeError('Choisissez une équipe.');
            return null;
        }

        if (statusChangeA === statusChangeB) {
            setStatusChangeError(
                'Status 1 et Status 2 doivent être différents.',
            );
            return null;
        }

        if (statusChangeDate.trim() === '') {
            setStatusChangeError(
                "Choisissez la date d'entrée en vigueur.",
            );
            return null;
        }

        if (!statusChangeTeamRoster) {
            setStatusChangeError("Chargement de l'équipe en cours...");
            return null;
        }

        const filledPairs = statusChangePairs.filter(
            (p) => p.aId !== '' && p.bId !== '',
        );

        if (
            filledPairs.length !==
            statusChangePairs.filter(
                (p) => p.aId !== '' || p.bId !== '',
            ).length
        ) {
            setStatusChangeError(
                'Chaque slot doit avoir deux joueurs, ou aucun.',
            );
            return null;
        }

        if (filledPairs.length === 0) {
            setStatusChangeError(
                'Ajoutez au moins une paire de joueurs.',
            );
            return null;
        }

        const effectiveAt = new Date(
            statusChangeDate + 'T00:00:00Z',
        ).toISOString();

        const pairs: StatusChangePair[] = filledPairs.map(
            (p, idx) => {
                const eA = statusChangeTeamRoster.entries.find(
                    (e) => String(e.playerId) === p.aId,
                );
                const eB = statusChangeTeamRoster.entries.find(
                    (e) => String(e.playerId) === p.bId,
                );

                const buildSide = (
                    e: typeof eA,
                    prevStatus: string,
                    newStatus: string,
                ): AdminStatusChangePlayerSide => ({
                    playerId: e!.playerId,
                    nhlPlayerId: e!.nhlPlayerId,
                    firstName: e!.firstName,
                    lastName: e!.lastName,
                    position: e!.position,
                    nhlTeamAbbreviation: e!.nhlTeamAbbreviation,
                    previousStatusName: prevStatus,
                    newStatusName: newStatus,
                });

                return {
                    slotIndex: idx,
                    statusASide: buildSide(
                        eA,
                        statusChangeA,
                        statusChangeB,
                    ),
                    statusBSide: buildSide(
                        eB,
                        statusChangeB,
                        statusChangeA,
                    ),
                };
            },
        );

        return {
            fantasyTeamId: team.id,
            fantasyTeamName: team.name,
            statusAName: statusChangeA,
            statusBName: statusChangeB,
            effectiveAt,
            note: statusChangeNote.trim() || null,
            pairs,
        };
    }

    function submitStatusChange() {
        const preview = buildStatusChangePreview();
        if (!preview) return;
        setStatusChangePreview(preview);
        setStatusChangePreviewOpen(true);
    }

    async function confirmStatusChange() {
        if (!statusChangePreview) return;

        setStatusChangeSubmitting(true);
        setStatusChangeError(null);

        try {
            const pairs: StatusChangePairRequest[] =
                statusChangePreview.pairs.map((p) => ({
                    statusASidePlayerId: p.statusASide.playerId,
                    statusBSidePlayerId: p.statusBSide.playerId,
                }));

            const payload: FinalizeStatusChangeRequest = {
                fantasyTeamId: statusChangePreview.fantasyTeamId,
                effectiveAt: statusChangePreview.effectiveAt,
                statusA: statusChangePreview.statusAName,
                statusB: statusChangePreview.statusBName,
                note: statusChangePreview.note,
                pairs,
            };

            const result = await finalizeStatusChange(payload);

            setStatusChangeSuccess(result.message);
            setStatusChangePreviewOpen(false);
            setStatusChangePreview(null);
            setStatusChangePairs([{ aId: '', bId: '' }]);
            setStatusChangeNote('');

            await loadStatusChangeHistory();

            if (statusChangeTeamId) {
                getTeamRoster(Number(statusChangeTeamId))
                    .then((r) => setStatusChangeTeamRoster(r))
                    .catch(() => undefined);
            }
        } catch (err) {
            setStatusChangeError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setStatusChangeSubmitting(false);
        }
    }

    async function handleChangeStatusChangeDate(id: number) {
        if (!statusChangeDateEditValue) {
            setStatusChangeDateEditError('Choisissez une date.');
            return;
        }

        setStatusChangeDateEditBusy(true);
        setStatusChangeDateEditError(null);

        try {
            const newIso = new Date(
                statusChangeDateEditValue + 'T00:00:00Z',
            ).toISOString();

            const result = await changeStatusChangeDate(
                id,
                newIso,
                statusChangeDateEditReason.trim() || null,
            );

            if (!result.success || !result.statusChangeHistory) {
                setStatusChangeDateEditError(
                    result.message || 'Erreur inconnue.',
                );
                return;
            }

            setStatusChangeHistory((prev) =>
                prev.map((h) =>
                    h.id === id
                        ? result.statusChangeHistory!
                        : h,
                ),
            );

            setStatusChangeDateEditFor(null);
            setStatusChangeDateEditValue('');
            setStatusChangeDateEditReason('');
        } catch (err) {
            setStatusChangeDateEditError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setStatusChangeDateEditBusy(false);
        }
    }

    async function handleRevertStatusChange(id: number) {
        if (statusChangeRevertConfirmInput.trim() !== String(id)) {
            setStatusChangeRevertError(
                `Tapez le numéro (${id}) pour confirmer.`,
            );
            return;
        }

        setStatusChangeRevertBusy(true);
        setStatusChangeRevertError(null);

        try {
            const result = await revertStatusChange(id);

            setStatusChangeHistory((prev) =>
                prev.filter((h) => h.id !== id),
            );

            setStatusChangeRevertFor(null);
            setStatusChangeRevertConfirmInput('');
            setStatusChangeSuccess(result.message);
        } catch (err) {
            setStatusChangeRevertError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setStatusChangeRevertBusy(false);
        }
    }

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

    // Load accepted trades whenever the section is opened.
    useEffect(() => {
        if (!showAcceptedTrades) return;
        void loadAcceptedTrades();
    }, [showAcceptedTrades]);

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

    // --- Draft transfer: load the source team's picks when it changes ---
    useEffect(() => {
        if (!draftTransferFromTeamId) {
            setDraftTransferPicks([]);
            setDraftTransferPicksLoading(false);
            return;
        }

        let cancelled = false;

        setDraftTransferPicksLoading(true);

        getTeamDraftPicks(Number(draftTransferFromTeamId))
            .then((data) => {
                if (!cancelled) {
                    setDraftTransferPicks(data);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setDraftTransferPicks([]);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setDraftTransferPicksLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [draftTransferFromTeamId]);

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
        setAssignEffectiveAt('');
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

    async function loadAcceptedTrades() {
        setAcceptedTradesLoading(true);
        setAcceptedTradesError(null);

        try {
            const data = await getAcceptedTrades();
            setAcceptedTrades(data);
        } catch (err) {
            setAcceptedTradesError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setAcceptedTradesLoading(false);
        }
    }

    async function handleDeleteAcceptedTrade(responseId: number) {
        if (
            !window.confirm(
                'Supprimer ce trade accepté ? Cette action est ' +
                'irréversible.',
            )
        ) {
            return;
        }

        setAcceptedTradesBusyId(responseId);
        setAcceptedTradesError(null);

        try {
            await deleteAcceptedTrade(responseId);
            await loadAcceptedTrades();
        } catch (err) {
            setAcceptedTradesError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setAcceptedTradesBusyId(null);
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

    async function handleTransferDraftPick() {
        const pickId = Number(draftTransferPickId);
        const newOwnerId = Number(draftTransferToTeamId);

        if (!pickId || !newOwnerId) {
            return;
        }

        if (draftTransferFromTeamId === draftTransferToTeamId) {
            setDraftTransferError(
                "L'équipe de destination doit être différente de " +
                "l'équipe de départ.",
            );
            return;
        }

        const pick = draftTransferPicks.find((p) => p.id === pickId);

        const pickLabel = pick
            ? `${pick.seasonName} — Ronde ${pick.round}, ` +
            `Choix ${pick.pickNumber}`
            : `Choix #${pickId}`;

        const fromTeamName =
            teams.find((t) => String(t.id) === draftTransferFromTeamId)
                ?.name ?? 'équipe source';

        const toTeamName =
            teams.find((t) => String(t.id) === draftTransferToTeamId)
                ?.name ?? 'équipe cible';

        if (
            !window.confirm(
                `Transférer ce choix de repêchage ?\n\n` +
                `De : ${fromTeamName}\n` +
                `Vers : ${toTeamName}\n` +
                `Choix : ${pickLabel}`,
            )
        ) {
            return;
        }

        setDraftTransferBusy(true);
        setDraftTransferError(null);
        setDraftTransferSuccess(null);

        try {
            const result = await transferDraftPick(pickId, newOwnerId);

            setDraftTransferSuccess(result.message);

            // Refresh the source team's list so the transferred pick
            // disappears from it. The POST cleared the client-side GET
            // cache on success, so this hits the API.
            if (draftTransferFromTeamId) {
                const fresh = await getTeamDraftPicks(
                    Number(draftTransferFromTeamId),
                );
                setDraftTransferPicks(fresh);
            }

            setDraftTransferPickId('');
        } catch (err) {
            setDraftTransferError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setDraftTransferBusy(false);
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

        // Convert the optional date to a UTC ISO instant at 00:00 UTC
        // on that calendar day. Building it directly from the
        // yyyy-MM-dd value (instead of via the browser's local
        // timezone) guarantees a negative UTC offset cannot shift
        // the chosen date by one.
        let effectiveAt: string | undefined;

        if (assignEffectiveAt.trim() !== '') {
            const parsed = new Date(
                `${assignEffectiveAt}T00:00:00Z`,
            );

            if (Number.isNaN(parsed.getTime())) {
                setError("Date d'entrée en vigueur invalide.");
                return;
            }

            effectiveAt = parsed.toISOString();
        }

        return runMovement(async () => {
            const result = await assignPlayer({
                fantasyTeamId: Number(fantasyTeamId),
                playerId,
                rosterStatus,
                effectiveAt,
            });

            void refreshRosterIfVisible();

            // Reset the date input so the next assignment starts
            // with the safe "tomorrow" default.
            setAssignEffectiveAt('');

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

    // ---------------------------------------------------------------
    // Backups
    //
    // Primary use case: pull a fresh pg_dump to the admin's PC so a
    // VPS wipe cannot take out both the DB and the on-server backups.
    // A secondary list of historical backups is shown so the admin
    // can re-download an older one without triggering a new dump.
    // ---------------------------------------------------------------

    const [backups, setBackups] = useState<BackupFile[]>([]);
    const [backupsLoading, setBackupsLoading] = useState(false);
    const [backupsTriggering, setBackupsTriggering] = useState(false);
    const [backupsError, setBackupsError] = useState<string | null>(null);
    const [backupsSuccess, setBackupsSuccess] = useState<string | null>(
        null,
    );

    async function loadBackups() {
        setBackupsLoading(true);
        setBackupsError(null);

        try {
            setBackups(await listBackups());
        } catch (err) {
            setBackupsError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setBackupsLoading(false);
        }
    }

    async function handleCreateAndDownloadBackup() {
        setBackupsTriggering(true);
        setBackupsError(null);
        setBackupsSuccess(null);

        try {
            const result = await triggerBackup();

            setBackupsSuccess(
                `Sauvegarde créée : ${result.filename}. ` +
                'Le téléchargement va démarrer.',
            );

            await loadBackups();

            // Hand the download off to the browser. The server sets
            // Content-Disposition: attachment so the file saves
            // instead of rendering, and the browser stays on this
            // page. Being on a separate request from the trigger
            // keeps each HTTP call under the ASP.NET request timeout.
            window.location.href = downloadBackupUrl(result.filename);
        } catch (err) {
            setBackupsError(
                err instanceof Error ? err.message : 'Erreur inconnue.',
            );
        } finally {
            setBackupsTriggering(false);
        }
    }

    useEffect(() => {
        void loadBackups();
    }, []);

    // ---------------------------------------------------------------
    // Trade form: projected roster shape per side
    //
    // For team A we keep every A player that is NOT in one of A's
    // outgoing slots, and add every B player that sits in one of B's
    // slots (their status is what the admin set next to that player in
    // the B column, or their current B status if no override is set).
    // The mirror case covers team B.
    //
    // Recomputed on every change, so the summary under each column
    // always reflects "what would happen if I hit Confirmer right now".
    // ---------------------------------------------------------------

    const teamAProjection = useMemo<ProjectedShape | null>(() => {
        if (!adminTradeTeamARoster) return null;

        const outgoing = new Set(
            adminTradeTeamAPlayerSlots
                .filter((s) => s !== '')
                .map((s) => Number(s)),
        );

        const incoming: { position: string; newStatus: string }[] = [];

        if (adminTradeTeamBRoster) {
            for (let i = 0; i < adminTradeTeamBPlayerSlots.length; i++) {
                const pid = adminTradeTeamBPlayerSlots[i];
                if (pid === '') continue;

                const entry = adminTradeTeamBRoster.entries.find(
                    (e) => String(e.playerId) === pid,
                );
                if (!entry) continue;

                const newStatus =
                    adminTradeTeamBPlayerNewStatuses[i] || entry.rosterStatus;

                incoming.push({ position: entry.position, newStatus });
            }
        }

        return computeProjectedShape(
            adminTradeTeamARoster.entries,
            outgoing,
            incoming,
        );
    }, [
        adminTradeTeamARoster,
        adminTradeTeamBRoster,
        adminTradeTeamAPlayerSlots,
        adminTradeTeamBPlayerSlots,
        adminTradeTeamBPlayerNewStatuses,
    ]);

    const teamBProjection = useMemo<ProjectedShape | null>(() => {
        if (!adminTradeTeamBRoster) return null;

        const outgoing = new Set(
            adminTradeTeamBPlayerSlots
                .filter((s) => s !== '')
                .map((s) => Number(s)),
        );

        const incoming: { position: string; newStatus: string }[] = [];

        if (adminTradeTeamARoster) {
            for (let i = 0; i < adminTradeTeamAPlayerSlots.length; i++) {
                const pid = adminTradeTeamAPlayerSlots[i];
                if (pid === '') continue;

                const entry = adminTradeTeamARoster.entries.find(
                    (e) => String(e.playerId) === pid,
                );
                if (!entry) continue;

                const newStatus =
                    adminTradeTeamAPlayerNewStatuses[i] || entry.rosterStatus;

                incoming.push({ position: entry.position, newStatus });
            }
        }

        return computeProjectedShape(
            adminTradeTeamBRoster.entries,
            outgoing,
            incoming,
        );
    }, [
        adminTradeTeamBRoster,
        adminTradeTeamARoster,
        adminTradeTeamBPlayerSlots,
        adminTradeTeamAPlayerSlots,
        adminTradeTeamAPlayerNewStatuses,
    ]);

    return (
        <section className='space-y-6'>
            {/* ============================================================
                Historique des matchs de l'alignement (par équipe)
                ============================================================ */}
            <div className='max-w-4xl space-y-3'>
                <h3 className='text-lg font-semibold text-foreground'>
                    Historique des matchs de l'alignement
                </h3>

                <p className='text-sm text-muted-foreground'>
                    Sélectionnez une équipe pour voir tous les matchs joués
                    par les joueurs qui ont été dans son alignement partant
                    cette saison. Utile pour repérer les erreurs de
                    changement de joueur.
                </p>

                {activeLogsError && (
                    <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                        {activeLogsError}
                    </p>
                )}

                <select
                    value={activeLogsTeamId}
                    onChange={(event) => setActiveLogsTeamId(event.target.value)}
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

                {activeLogsLoading && (
                    <p className='text-sm text-muted-foreground'>
                        Chargement...
                    </p>
                )}

                {!activeLogsLoading && activeLogsTeamId !== '' && activeLogs.length === 0 && !activeLogsError && (
                    <p className='text-sm text-muted-foreground'>
                        Aucun match trouvé pour l'alignement de cette équipe.
                    </p>
                )}

                {activeLogs.length > 0 && (
                    <div className='overflow-x-auto rounded-lg border border-border bg-card'>
                        <table className='w-full min-w-[600px] text-sm'>
                            <thead className='border-b border-border text-xs uppercase tracking-wide text-foreground'>
                                <tr>
                                    <th className='px-2 py-2 text-left font-medium'>Joueur</th>
                                    <th className='px-2 py-2 text-center font-medium'>Date</th>
                                    <th className='px-2 py-2 text-center font-medium'>GP</th>
                                    <th className='px-2 py-2 text-center font-medium'>B</th>
                                    <th className='px-2 py-2 text-center font-medium'>A</th>
                                    <th className='px-2 py-2 text-center font-medium'>PTS</th>
                                    <th className='px-2 py-2 text-center font-medium text-[#FFC72C]'>FP</th>
                                </tr>
                            </thead>
                            <tbody className='text-foreground'>
                                {activeLogs.map((row, idx) => (
                                    <tr
                                        key={`${row.playerId}-${row.gameDate}`}
                                        className={
                                            idx % 2 === 0
                                                ? 'bg-transparent'
                                                : 'bg-secondary/20'
                                        }
                                    >
                                        <td className='px-2 py-1.5 text-left'>
                                            {row.firstName} {row.lastName}
                                        </td>
                                        <td className='px-2 py-1.5 text-center text-muted-foreground'>
                                            {row.gameDate.slice(0, 10)}
                                        </td>
                                        <td className='px-2 py-1.5 text-center text-[#7DD3FC]'>
                                            1
                                        </td>
                                        <td className='px-2 py-1.5 text-center'>
                                            {row.goals}
                                        </td>
                                        <td className='px-2 py-1.5 text-center'>
                                            {row.assists}
                                        </td>
                                        <td className='px-2 py-1.5 text-center text-[#00F0FF]'>
                                            {row.points}
                                        </td>
                                        <td className='px-2 py-1.5 text-center font-semibold text-[#FFC72C]'>
                                            {row.fantasyPoints}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {activeLogTotals.length > 0 && (
                    <div className='overflow-x-auto rounded-lg border border-border bg-card'>
                        <table className='w-full min-w-[400px] text-sm'>
                            <thead className='border-b border-border text-xs uppercase tracking-wide text-foreground'>
                                <tr>
                                    <th className='px-2 py-2 text-left font-medium'>Joueur</th>
                                    <th className='px-2 py-2 text-center font-medium'>GP</th>
                                    <th className='px-2 py-2 text-center font-medium text-[#FFC72C]'>FP</th>
                                </tr>
                            </thead>
                            <tbody className='text-foreground'>
                                {activeLogTotals.map((row, idx) => (
                                    <tr
                                        key={row.playerId}
                                        className={
                                            idx % 2 === 0
                                                ? 'bg-transparent'
                                                : 'bg-secondary/20'
                                        }
                                    >
                                        <td className='px-2 py-1.5 text-left'>
                                            {row.firstName} {row.lastName}
                                        </td>
                                        <td className='px-2 py-1.5 text-center text-[#7DD3FC]'>
                                            {row.gp}
                                        </td>
                                        <td className='px-2 py-1.5 text-center font-semibold text-[#FFC72C]'>
                                            {row.fp}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
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
                Journaux d'événements (erreurs et avertissements)
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

                        <label className='text-sm font-medium text-muted-foreground'>
                            Date d'entrée en vigueur (optionnel)
                        </label>

                        <input
                            type='date'
                            value={assignEffectiveAt}
                            onChange={(event) =>
                                setAssignEffectiveAt(event.target.value)
                            }
                            className={selectClass}
                        />

                        <p className='text-xs text-muted-foreground'>
                            Laisser vide pour que le joueur rejoigne
                            l'équipe demain. Choisir une date passée
                            (par exemple le début de la saison) fait
                            comme s'il avait toujours été sur cette
                            équipe depuis cette date.
                        </p>

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
                Historique des mouvements d'un joueur
                ============================================================ */}
            <div className='max-w-4xl space-y-3'>
                <h3 className='text-lg font-semibold text-foreground'>
                    Historique des mouvements d'un joueur
                </h3>

                <p className='text-sm text-muted-foreground'>
                    Recherchez un joueur, puis sélectionnez-le pour
                    voir l'historique complet de ses changements
                    d'équipe et de statut, toutes saisons confondues.
                </p>

                <div className='relative max-w-lg'>
                    <input
                        type='text'
                        value={movementSearch}
                        autoComplete='off'
                        onChange={(event) => {
                            setMovementSearch(event.target.value);
                            setMovementSelectedPlayer(null);
                            setMovementHistory([]);
                            setMovementHistoryError(null);
                        }}
                        placeholder='Rechercher un joueur (min. 2 lettres)'
                        className={selectClass}
                    />

                    {movementResults.length > 0 && (
                        <div className='absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg'>
                            {movementResults.map((player) => (
                                <button
                                    key={player.playerId}
                                    type='button'
                                    onClick={() =>
                                        void handleMovementPlayerSelect(
                                            player,
                                        )
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
                                        {player.fantasyTeamName ? (
                                            <span className='text-primary'>
                                                {' '}
                                                (
                                                {
                                                    player.fantasyTeamName
                                                }
                                                )
                                            </span>
                                        ) : null}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {movementSearching && !movementSelectedPlayer && (
                    <p className='text-sm text-muted-foreground'>
                        Recherche...
                    </p>
                )}

                {!movementSearching &&
                    !movementSelectedPlayer &&
                    movementSearch.trim().length >=
                    MIN_SEARCH_LENGTH &&
                    movementResults.length === 0 && (
                        <p className='text-sm text-muted-foreground'>
                            Aucun joueur trouvé.
                        </p>
                    )}

                {movementSelectedPlayer && (
                    <>
                        <div className='flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm'>
                            <div className='min-w-0'>
                                <p className='font-medium text-foreground'>
                                    {movementSelectedPlayer.firstName}{' '}
                                    {movementSelectedPlayer.lastName}
                                </p>
                                <p className='text-xs text-muted-foreground'>
                                    {
                                        movementSelectedPlayer.nhlTeamAbbreviation
                                    }{' '}
                                    ·{' '}
                                    {movementSelectedPlayer.position}
                                    {movementSelectedPlayer.fantasyTeamName && (
                                        <span className='ml-1 text-primary'>
                                            ·{' '}
                                            {
                                                movementSelectedPlayer.fantasyTeamName
                                            }
                                        </span>
                                    )}
                                </p>
                            </div>

                            <button
                                type='button'
                                onClick={handleMovementClear}
                                className='shrink-0 cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary'
                            >
                                Changer
                            </button>
                        </div>

                        {movementHistoryLoading && (
                            <p className='text-sm text-muted-foreground'>
                                Chargement de l'historique...
                            </p>
                        )}

                        {movementHistoryError && (
                            <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                                {movementHistoryError}
                            </p>
                        )}

                        {!movementHistoryLoading &&
                            !movementHistoryError &&
                            movementHistory.length === 0 && (
                                <p className='text-sm text-muted-foreground'>
                                    Aucun mouvement enregistré pour ce
                                    joueur.
                                </p>
                            )}

                        {movementHistorySuccess && (
                            <p className='rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400'>
                                {movementHistorySuccess}
                            </p>
                        )}

                        {!movementHistoryLoading &&
                            movementHistory.length > 0 && (
                                <div className='overflow-x-auto rounded-lg border border-border bg-card'>
                                    <table className='w-full min-w-[820px] text-sm'>
                                        <thead className='border-b border-border text-xs uppercase tracking-wide text-foreground'>
                                            <tr>
                                                <th className='px-2 py-2 text-left font-medium'>
                                                    Saison
                                                </th>
                                                <th className='px-2 py-2 text-left font-medium'>
                                                    Équipe
                                                </th>
                                                <th className='px-2 py-2 text-left font-medium'>
                                                    Statut
                                                </th>
                                                <th className='px-2 py-2 text-left font-medium'>
                                                    Date effective
                                                </th>
                                                <th className='px-2 py-2 text-left font-medium'>
                                                    Note
                                                </th>
                                                <th className='px-2 py-2' />
                                            </tr>
                                        </thead>
                                        <tbody className='text-foreground'>
                                            {movementHistory.map(
                                                (row, idx) => {
                                                    const isEditing =
                                                        movementEditingRowId ===
                                                        row.id;

                                                    return (
                                                        <tr
                                                            key={row.id}
                                                            className={
                                                                idx % 2 ===
                                                                    0
                                                                    ? 'bg-transparent'
                                                                    : 'bg-secondary/20'
                                                            }
                                                        >
                                                            <td className='px-2 py-2 align-top text-muted-foreground'>
                                                                {row.seasonName ??
                                                                    `#${row.seasonId}`}
                                                            </td>
                                                            <td className='px-2 py-2 align-top'>
                                                                {
                                                                    row.fantasyTeamName
                                                                }
                                                            </td>
                                                            <td className='px-2 py-2 align-top'>
                                                                {isEditing ? (
                                                                    <select
                                                                        value={
                                                                            movementEditingStatus
                                                                        }
                                                                        onChange={(
                                                                            e,
                                                                        ) =>
                                                                            setMovementEditingStatus(
                                                                                e
                                                                                    .target
                                                                                    .value,
                                                                            )
                                                                        }
                                                                        className='w-full rounded border border-border bg-background px-2 py-1 text-xs'
                                                                    >
                                                                        {ROSTER_STATUSES_WITH_RELEASED.map(
                                                                            (
                                                                                s,
                                                                            ) => (
                                                                                <option
                                                                                    key={
                                                                                        s.value
                                                                                    }
                                                                                    value={
                                                                                        s.value
                                                                                    }
                                                                                >
                                                                                    {
                                                                                        s.label
                                                                                    }
                                                                                </option>
                                                                            ),
                                                                        )}
                                                                    </select>
                                                                ) : (
                                                                    row.rosterStatus
                                                                )}
                                                            </td>
                                                            <td className='px-2 py-2 align-top text-muted-foreground'>
                                                                {isEditing ? (
                                                                    <input
                                                                        type='datetime-local'
                                                                        value={
                                                                            movementEditingEffectiveAt
                                                                        }
                                                                        onChange={(
                                                                            e,
                                                                        ) =>
                                                                            setMovementEditingEffectiveAt(
                                                                                e
                                                                                    .target
                                                                                    .value,
                                                                            )
                                                                        }
                                                                        className='rounded border border-border bg-background px-2 py-1 text-xs'
                                                                    />
                                                                ) : (
                                                                    row.effectiveAt.slice(
                                                                        0,
                                                                        10,
                                                                    )
                                                                )}
                                                            </td>
                                                            <td className='px-2 py-2 align-top text-muted-foreground'>
                                                                {isEditing ? (
                                                                    <input
                                                                        type='text'
                                                                        value={
                                                                            movementEditingNote
                                                                        }
                                                                        onChange={(
                                                                            e,
                                                                        ) =>
                                                                            setMovementEditingNote(
                                                                                e
                                                                                    .target
                                                                                    .value,
                                                                            )
                                                                        }
                                                                        placeholder='Note (optionnel)'
                                                                        className='w-full rounded border border-border bg-background px-2 py-1 text-xs'
                                                                    />
                                                                ) : (
                                                                    row.note ??
                                                                    '—'
                                                                )}
                                                            </td>
                                                            <td className='whitespace-nowrap px-2 py-2 text-right align-top'>
                                                                {isEditing ? (
                                                                    <>
                                                                        <button
                                                                            type='button'
                                                                            onClick={() =>
                                                                                void saveMovementRow()
                                                                            }
                                                                            disabled={
                                                                                movementHistoryBusy
                                                                            }
                                                                            className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50'
                                                                        >
                                                                            Enregistrer
                                                                        </button>
                                                                        <button
                                                                            type='button'
                                                                            onClick={
                                                                                cancelEditMovementRow
                                                                            }
                                                                            disabled={
                                                                                movementHistoryBusy
                                                                            }
                                                                            className='ml-2 cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50'
                                                                        >
                                                                            Annuler
                                                                        </button>
                                                                    </>
                                                                ) : (
                                                                    <button
                                                                        type='button'
                                                                        onClick={() =>
                                                                            beginEditMovementRow(
                                                                                row,
                                                                            )
                                                                        }
                                                                        disabled={
                                                                            movementHistoryBusy
                                                                        }
                                                                        className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50'
                                                                    >
                                                                        Modifier
                                                                    </button>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                },
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                    </>
                )}
            </div>

            {/* ============================================================
                Réinitialiser l'historique fantasy d'un joueur
                ============================================================ */}
            <div className='max-w-2xl space-y-3'>
                <h3 className='text-lg font-semibold text-foreground'>
                    Réinitialiser l'historique fantasy d'un joueur
                </h3>

                <p className='text-sm text-muted-foreground'>
                    Supprime tous les liens entre un joueur et les équipes
                    fantasy où il a été pendant la saison courante : son
                    entrée de roster, tout son historique de statut, et
                    toute offre ou réponse du marché qui le référence.
                    Après cette action, il est traité comme s'il n'avait
                    jamais été dans une équipe cette saison : aucun de ses
                    points (passés ni futurs) ne sera compté nulle part.
                    Les échanges et changements de statut enregistrés qui
                    l'impliquaient restent en tant qu'audit, mais ne
                    pourront plus être revertés.
                </p>

                {resetPlayerError && (
                    <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                        {resetPlayerError}
                    </p>
                )}

                {resetPlayerSuccess && (
                    <p className='rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400'>
                        {resetPlayerSuccess}
                    </p>
                )}

                <div className='relative'>
                    <input
                        type='text'
                        value={resetPlayerSearch}
                        autoComplete='off'
                        onChange={(event) => {
                            setResetPlayerSearch(event.target.value);
                            setResetPlayerSelected(null);
                            setResetPlayerSuccess(null);
                            setResetPlayerError(null);
                        }}
                        placeholder='Rechercher un joueur (min. 2 lettres)'
                        className={selectClass}
                    />

                    {resetPlayerSearchResults.length > 0 && (
                        <div className='absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg'>
                            {resetPlayerSearchResults.map((player) => (
                                <button
                                    key={player.playerId}
                                    type='button'
                                    onClick={() =>
                                        handleResetPlayerPick(player)
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
                                        {player.fantasyTeamName ? (
                                            <span className='ml-1 text-[#FFC72C]'>
                                                ({player.fantasyTeamName})
                                            </span>
                                        ) : (
                                            <span className='ml-1 italic'>
                                                (libre)
                                            </span>
                                        )}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {resetPlayerSearching && !resetPlayerSelected && (
                    <p className='text-xs text-muted-foreground'>
                        Recherche...
                    </p>
                )}

                {!resetPlayerSearching &&
                    !resetPlayerSelected &&
                    resetPlayerSearch.trim().length >=
                    MIN_SEARCH_LENGTH &&
                    resetPlayerSearchResults.length === 0 && (
                        <p className='text-sm text-muted-foreground'>
                            Aucun joueur trouvé.
                        </p>
                    )}

                {resetPlayerSelected && (
                    <div className='space-y-3 rounded-lg border border-border bg-card p-3'>
                        <div className='flex flex-wrap items-center justify-between gap-2'>
                            <div className='min-w-0'>
                                <p className='font-medium text-foreground'>
                                    {resetPlayerSelected.firstName}{' '}
                                    {resetPlayerSelected.lastName}
                                </p>
                                <p className='text-xs text-muted-foreground'>
                                    {resetPlayerSelected.nhlTeamAbbreviation}{' '}
                                    · {resetPlayerSelected.position}
                                    {resetPlayerSelected.fantasyTeamName ? (
                                        <span className='ml-1 text-[#FFC72C]'>
                                            · actuellement sur{' '}
                                            {resetPlayerSelected.fantasyTeamName}
                                        </span>
                                    ) : (
                                        <span className='ml-1 italic'>
                                            · agent libre
                                        </span>
                                    )}
                                </p>
                            </div>

                            <button
                                type='button'
                                onClick={() => {
                                    setResetPlayerSelected(null);
                                    setResetPlayerSearch('');
                                    setResetPlayerSuccess(null);
                                    setResetPlayerError(null);
                                }}
                                className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary'
                            >
                                Changer
                            </button>
                        </div>

                        <button
                            type='button'
                            onClick={() => {
                                setResetPlayerConfirmFor(
                                    resetPlayerSelected.playerId,
                                );
                                setResetPlayerConfirmInput('');
                                setResetPlayerError(null);
                            }}
                            className='w-full cursor-pointer rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/20'
                        >
                            Supprimer tous les liens fantasy
                        </button>
                    </div>
                )}
            </div>

            {/* Confirm popup for player reset */}
            {resetPlayerConfirmFor !== null && resetPlayerSelected && (
                <div
                    className='fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4'
                    onClick={() => {
                        if (resetPlayerBusy) return;
                        setResetPlayerConfirmFor(null);
                        setResetPlayerConfirmInput('');
                        setResetPlayerError(null);
                    }}
                    role='dialog'
                    aria-modal='true'
                >
                    <div
                        className='flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-destructive/60 bg-[#0F1626] shadow-[0_0_20px_rgba(220,38,38,0.5),0_8px_24px_rgba(0,0,0,0.6)]'
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className='flex items-center justify-between border-b border-destructive/40 px-3 py-2'>
                            <h3 className='text-sm font-bold uppercase tracking-wider text-destructive'>
                                Supprimer l'historique fantasy
                            </h3>
                            <button
                                type='button'
                                onClick={() => {
                                    if (resetPlayerBusy) return;
                                    setResetPlayerConfirmFor(null);
                                    setResetPlayerConfirmInput('');
                                    setResetPlayerError(null);
                                }}
                                disabled={resetPlayerBusy}
                                className='cursor-pointer rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-black hover:bg-red-500 disabled:opacity-50'
                            >
                                Fermer
                            </button>
                        </div>

                        <div className='flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm text-foreground'>
                            <p className='font-semibold text-destructive'>
                                Cette action est irréversible.
                            </p>

                            <p>
                                Joueur :{' '}
                                <span className='font-semibold'>
                                    {resetPlayerSelected.firstName}{' '}
                                    {resetPlayerSelected.lastName}
                                </span>
                                {resetPlayerSelected.fantasyTeamName && (
                                    <>
                                        {' '}
                                        (actuellement sur{' '}
                                        <span className='text-[#FFC72C]'>
                                            {resetPlayerSelected.fantasyTeamName}
                                        </span>
                                        )
                                    </>
                                )}
                            </p>

                            <p>
                                Tous ses liens avec une équipe fantasy pour
                                la saison courante seront supprimés :
                            </p>

                            <ul className='ml-4 list-disc space-y-1 text-xs'>
                                <li>
                                    Entrée de roster (s'il est sur une
                                    équipe).
                                </li>
                                <li>
                                    Toutes ses lignes d'historique de
                                    statut et de changement d'équipe pour
                                    la saison.
                                </li>
                                <li>
                                    Toutes les offres du marché actives
                                    qui l'annoncent.
                                </li>
                                <li>
                                    Toutes les réponses (en attente ou
                                    acceptées) qui le proposent.
                                </li>
                            </ul>

                            <p className='rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive'>
                                Les échanges et changements de statut
                                enregistrés qui l'impliquaient{' '}
                                <span className='font-semibold'>
                                    restent en tant qu'audit
                                </span>
                                , mais ne pourront plus être revertés par
                                la suite (l'historique d'un des joueurs du
                                groupe aura été supprimé).
                            </p>

                            <p className='text-xs'>
                                Pour confirmer, tapez{' '}
                                <span className='font-mono font-semibold'>
                                    SUPPRIMER
                                </span>{' '}
                                ci-dessous.
                            </p>

                            <input
                                type='text'
                                value={resetPlayerConfirmInput}
                                onChange={(event) =>
                                    setResetPlayerConfirmInput(
                                        event.target.value,
                                    )
                                }
                                placeholder='SUPPRIMER'
                                disabled={resetPlayerBusy}
                                className={`${selectClass} text-center font-mono uppercase`}
                            />

                            {resetPlayerError && (
                                <p className='rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive'>
                                    {resetPlayerError}
                                </p>
                            )}
                        </div>

                        <div className='flex justify-end gap-2 border-t border-destructive/40 px-3 py-2'>
                            <button
                                type='button'
                                onClick={() => {
                                    if (resetPlayerBusy) return;
                                    setResetPlayerConfirmFor(null);
                                    setResetPlayerConfirmInput('');
                                    setResetPlayerError(null);
                                }}
                                disabled={resetPlayerBusy}
                                className='cursor-pointer rounded border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary disabled:opacity-50'
                            >
                                Annuler
                            </button>
                            <button
                                type='button'
                                onClick={() =>
                                    void handleResetPlayerFantasyHistory()
                                }
                                disabled={
                                    resetPlayerBusy ||
                                    resetPlayerConfirmInput
                                        .trim()
                                        .toUpperCase() !== 'SUPPRIMER'
                                }
                                className='cursor-pointer rounded bg-destructive px-3 py-1.5 text-sm font-semibold text-destructive-foreground hover:brightness-110 disabled:opacity-50'
                            >
                                {resetPlayerBusy
                                    ? 'Suppression...'
                                    : 'Supprimer'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ============================================================
                Trades en attentes
                ============================================================ */}
            <div className='max-w-4xl space-y-3'>
                <button
                    type='button'
                    onClick={() =>
                        setShowAcceptedTrades((v) => !v)
                    }
                    className='cursor-pointer rounded-lg px-4 py-2 text-sm font-bold uppercase tracking-wider text-[#F2F5FA] transition-opacity hover:brightness-110'
                    style={{
                        backgroundColor: '#080D1A',
                        border: '3px solid #FFC72C',
                        boxShadow: [
                            'inset 0 0 0 1px rgba(255, 250, 220, 0.95)',
                            'inset 0 0 12px rgba(255, 199, 44, 0.55)',
                            'inset 0 0 28px rgba(255, 199, 44, 0.15)',
                        ].join(', '),
                    }}
                >
                    {showAcceptedTrades
                        ? '▼ Masquer les trades en attentes'
                        : '▶ Trades en attentes'}
                </button>

                {showAcceptedTrades && (
                    <div className='space-y-3'>
                        {acceptedTradesError && (
                            <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                                {acceptedTradesError}
                            </p>
                        )}

                        {acceptedTradesLoading &&
                            acceptedTrades.length === 0 && (
                                <p className='text-sm text-muted-foreground'>
                                    Chargement...
                                </p>
                            )}

                        {!acceptedTradesLoading &&
                            acceptedTrades.length === 0 &&
                            !acceptedTradesError && (
                                <p className='rounded-lg border border-border bg-card px-3 py-4 text-sm text-muted-foreground'>
                                    Aucun trade accepté en attente.
                                </p>
                            )}

                        {acceptedTrades.map((trade) => (
                            <div
                                key={trade.responseId}
                                className='rounded-lg border border-border bg-card p-3'
                            >
                                <div className='flex items-start justify-between gap-2'>
                                    <div className='min-w-0'>
                                        <p className='truncate text-sm font-semibold text-foreground'>
                                            {trade.offerCreatorTeamName}
                                            {' → '}
                                            {trade.respondingTeamName}
                                        </p>
                                        <p className='mt-0.5 text-xs text-muted-foreground'>
                                            Reçue le{' '}
                                            {new Date(
                                                trade.createdAt,
                                            ).toLocaleDateString(
                                                'fr-CA',
                                            )}
                                        </p>
                                    </div>

                                    <button
                                        type='button'
                                        onClick={() =>
                                            void handleDeleteAcceptedTrade(
                                                trade.responseId,
                                            )
                                        }
                                        disabled={
                                            acceptedTradesBusyId ===
                                            trade.responseId
                                        }
                                        className='shrink-0 cursor-pointer rounded border border-destructive/40 px-2 py-0.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50'
                                    >
                                        Supprimer
                                    </button>
                                </div>

                                {trade.note && (
                                    <p className='mt-2 rounded border border-[#00A8FF]/25 bg-[#00A8FF]/5 px-2 py-1 text-xs italic text-[#7DD3FC]'>
                                        « {trade.note} »
                                    </p>
                                )}

                                <ul className='mt-2 space-y-1'>
                                    {trade.slots.map((slot) => (
                                        <li
                                            key={slot.slotIndex}
                                            className='grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded border border-border/50 bg-background px-2 py-1 text-xs'
                                        >
                                            <span className='min-w-0 truncate text-foreground'>
                                                {slot.offeringPlayerFirstName &&
                                                    slot.offeringPlayerLastName
                                                    ? `${slot.offeringPlayerFirstName} ${slot.offeringPlayerLastName}`
                                                    : '—'}
                                                {slot.offeringPlayerNhlTeam && (
                                                    <span className='ml-1 text-muted-foreground'>
                                                        (
                                                        {
                                                            slot.offeringPlayerNhlTeam
                                                        }
                                                        )
                                                    </span>
                                                )}
                                            </span>

                                            <span
                                                aria-hidden='true'
                                                className='shrink-0 text-[#7DD3FC]'
                                            >
                                                ⇄
                                            </span>

                                            <span className='min-w-0 truncate text-right text-foreground'>
                                                {
                                                    slot.respondingPlayerFirstName
                                                }{' '}
                                                {
                                                    slot.respondingPlayerLastName
                                                }
                                                {slot.respondingPlayerNhlTeam && (
                                                    <span className='ml-1 text-muted-foreground'>
                                                        (
                                                        {
                                                            slot.respondingPlayerNhlTeam
                                                        }
                                                        )
                                                    </span>
                                                )}
                                            </span>
                                        </li>
                                    ))}
                                </ul>

                                {(trade.offerCreatorPicks.length > 0 ||
                                    trade.respondingPicks.length > 0) && (
                                        <div className='mt-2 space-y-1'>
                                            {trade.offerCreatorPicks.length > 0 && (
                                                <div className='rounded border border-[#00E5FF]/30 bg-[#00E5FF]/5 px-2 py-1'>
                                                    <p className='text-[0.6rem] font-semibold uppercase tracking-wider text-[#7DD3FC]'>
                                                        Choix de{' '}
                                                        {
                                                            trade.offerCreatorTeamName
                                                        }
                                                    </p>
                                                    <ul className='mt-0.5 space-y-0.5'>
                                                        {trade.offerCreatorPicks.map(
                                                            (pick) => (
                                                                <li
                                                                    key={pick.id}
                                                                    className='text-xs text-foreground'
                                                                >
                                                                    {formatAcceptedTradePick(
                                                                        pick,
                                                                    )}
                                                                </li>
                                                            ),
                                                        )}
                                                    </ul>
                                                </div>
                                            )}

                                            {trade.respondingPicks.length > 0 && (
                                                <div className='rounded border border-[#00E5FF]/30 bg-[#00E5FF]/5 px-2 py-1'>
                                                    <p className='text-[0.6rem] font-semibold uppercase tracking-wider text-[#7DD3FC]'>
                                                        Choix de{' '}
                                                        {
                                                            trade.respondingTeamName
                                                        }
                                                    </p>
                                                    <ul className='mt-0.5 space-y-0.5'>
                                                        {trade.respondingPicks.map(
                                                            (pick) => (
                                                                <li
                                                                    key={pick.id}
                                                                    className='text-xs text-foreground'
                                                                >
                                                                    {formatAcceptedTradePick(
                                                                        pick,
                                                                    )}
                                                                </li>
                                                            ),
                                                        )}
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                    )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ============================================================
                Créer un échange (commissioner-only trade execution)
                ============================================================ */}
            <div className='max-w-4xl space-y-3'>
                <button
                    type='button'
                    onClick={() => setShowAdminTradeForm((v) => !v)}
                    className='cursor-pointer rounded-lg px-4 py-2 text-sm font-bold uppercase tracking-wider text-[#F2F5FA] transition-opacity hover:brightness-110'
                    style={{
                        backgroundColor: '#080D1A',
                        border: '3px solid #00E5FF',
                        boxShadow: [
                            'inset 0 0 0 1px rgba(220, 250, 255, 0.95)',
                            'inset 0 0 12px rgba(0, 229, 255, 0.55)',
                            'inset 0 0 28px rgba(0, 229, 255, 0.15)',
                        ].join(', '),
                    }}
                >
                    {showAdminTradeForm
                        ? '▼ Masquer la création d\'échange'
                        : '▶ Créer un échange'}
                </button>

                {showAdminTradeForm && (
                    <div className='space-y-4 rounded-lg border border-border bg-card p-3'>
                        <div>
                            <label className='text-sm font-medium text-muted-foreground'>
                                Date d'entrée en vigueur
                            </label>
                            <input
                                type='date'
                                value={adminTradeDate}
                                onChange={(event) =>
                                    setAdminTradeDate(event.target.value)
                                }
                                className={`mt-1 ${selectClass}`}
                            />
                            <p className='mt-1 text-xs text-muted-foreground'>
                                Les changements de statut des joueurs
                                seront appliqués à cette date.
                            </p>
                        </div>

                        <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                            {/* ---- Team A column ---- */}
                            <div className='space-y-2 rounded-lg border border-border bg-background p-2'>
                                <label className='text-sm font-medium text-muted-foreground'>
                                    Équipe 1
                                </label>
                                <select
                                    value={adminTradeTeamAId}
                                    onChange={(event) =>
                                        setAdminTradeTeamAId(
                                            event.target.value,
                                        )
                                    }
                                    className={selectClass}
                                >
                                    <option value=''>— équipe —</option>
                                    {teams.map((team) => (
                                        <option
                                            key={team.id}
                                            value={team.id}
                                        >
                                            {team.name}
                                        </option>
                                    ))}
                                </select>

                                {adminTradeTeamAId !== '' &&
                                    adminTradeTeamARoster && (
                                        <>
                                            {adminTradeTeamAPlayerSlots.map(
                                                (_slot, index) => {
                                                    const selectedPlayerId =
                                                        adminTradeTeamAPlayerSlots[
                                                        index
                                                        ];

                                                    const selectedEntry =
                                                        selectedPlayerId !==
                                                            ''
                                                            ? adminTradeTeamARoster.entries.find(
                                                                (e) =>
                                                                    String(
                                                                        e.playerId,
                                                                    ) ===
                                                                    selectedPlayerId,
                                                            )
                                                            : undefined;

                                                    const currentStatus =
                                                        selectedEntry?.rosterStatus ??
                                                        '';

                                                    const effectiveStatus =
                                                        adminTradeTeamAPlayerNewStatuses[
                                                        index
                                                        ] || currentStatus;

                                                    return (
                                                        <div
                                                            key={index}
                                                            className='flex flex-wrap items-center gap-2'
                                                        >
                                                            <select
                                                                value={
                                                                    adminTradeTeamAPlayerSlots[
                                                                    index
                                                                    ]
                                                                }
                                                                onChange={(
                                                                    event,
                                                                ) =>
                                                                    setAdminTradeTeamAPlayerSlot(
                                                                        index,
                                                                        event
                                                                            .target
                                                                            .value,
                                                                    )
                                                                }
                                                                className={`${selectClass} flex-1 min-w-[10rem]`}
                                                            >
                                                                <option value=''>
                                                                    — Ajouter un joueur{' '}
                                                                    {index > 0
                                                                        ? index +
                                                                        1
                                                                        : ''}{' '}
                                                                    —
                                                                </option>
                                                                {(adminTradeTeamARoster?.entries ??
                                                                    [])
                                                                    .filter(
                                                                        (
                                                                            e,
                                                                        ) => {
                                                                            return !adminTradeTeamAPlayerSlots.some(
                                                                                (
                                                                                    v,
                                                                                    i,
                                                                                ) =>
                                                                                    i !==
                                                                                    index &&
                                                                                    v !==
                                                                                    '' &&
                                                                                    Number(
                                                                                        v,
                                                                                    ) ===
                                                                                    e.playerId,
                                                                            );
                                                                        },
                                                                    )
                                                                    .map(
                                                                        (
                                                                            e,
                                                                        ) => (
                                                                            <option
                                                                                key={
                                                                                    e.playerId
                                                                                }
                                                                                value={
                                                                                    e.playerId
                                                                                }
                                                                            >
                                                                                {
                                                                                    e.firstName
                                                                                }{' '}
                                                                                {
                                                                                    e.lastName
                                                                                }{' '}
                                                                                (
                                                                                {
                                                                                    e.position
                                                                                }
                                                                                ,{' '}
                                                                                {
                                                                                    e.nhlTeamAbbreviation
                                                                                }
                                                                                ){' '}
                                                                                ·{' '}
                                                                                {
                                                                                    e.rosterStatus
                                                                                }
                                                                            </option>
                                                                        ),
                                                                    )}
                                                            </select>

                                                            {selectedPlayerId !==
                                                                '' && (
                                                                    <select
                                                                        value={
                                                                            effectiveStatus
                                                                        }
                                                                        onChange={(
                                                                            event,
                                                                        ) =>
                                                                            setAdminTradeTeamAPlayerNewStatus(
                                                                                index,
                                                                                event
                                                                                    .target
                                                                                    .value,
                                                                            )
                                                                        }
                                                                        className={`${selectClass} flex-shrink-0`}
                                                                        aria-label='Nouveau statut'
                                                                        title='Statut après échange'
                                                                    >
                                                                        <option value='Active'>
                                                                            Active
                                                                        </option>
                                                                        <option value='Bench'>
                                                                            Bench
                                                                        </option>
                                                                        <option value='Prospect'>
                                                                            Prospect
                                                                        </option>
                                                                    </select>
                                                                )}

                                                            {adminTradeTeamAPlayerSlots.length >
                                                                1 && (
                                                                    <button
                                                                        type='button'
                                                                        onClick={() =>
                                                                            removeAdminTradePlayerSlot(
                                                                                index,
                                                                            )
                                                                        }
                                                                        aria-label='Retirer ce slot'
                                                                        className='cursor-pointer rounded border border-destructive/40 px-1.5 py-0.5 text-xs text-destructive hover:bg-destructive/10'
                                                                    >
                                                                        ×
                                                                    </button>
                                                                )}
                                                        </div>
                                                    );
                                                },
                                            )}

                                        <button
                                            type='button'
                                            onClick={
                                                addAdminTradePlayerSlot
                                            }
                                            className='w-full cursor-pointer rounded border border-emerald-500 bg-transparent px-2 py-1 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/10'
                                        >
                                            + Ajouter un joueur
                                        </button>

                                        <button
                                            type='button'
                                            onClick={() =>
                                                setAdminTradePickPopupSide(
                                                    'A',
                                                )
                                            }
                                            className='w-full cursor-pointer rounded border border-border bg-transparent px-2 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-secondary'
                                        >
                                            Ajouter des choix de repêchage
                                        </button>

                                            {adminTradeTeamAPickIds.length >
                                                0 && (
                                                    <ul className='space-y-1'>
                                                        {adminTradeTeamAPickIds.map(
                                                            (pickId) => {
                                                                const pick =
                                                                    adminTradeTeamAPicks.find(
                                                                        (p) =>
                                                                            p.id ===
                                                                            pickId,
                                                                    );

                                                                if (!pick)
                                                                    return null;

                                                                return (
                                                                    <li
                                                                        key={
                                                                            pickId
                                                                        }
                                                                        className='flex items-center justify-between gap-2 rounded border border-[#00E5FF]/30 bg-[#00E5FF]/5 px-2 py-1 text-xs text-[#00E5FF]'
                                                                    >
                                                                        <span className='truncate'>
                                                                            {
                                                                                pick.draftYear
                                                                            }
                                                                            , Ronde{' '}
                                                                            {
                                                                                pick.round
                                                                            }
                                                                            ,{' '}
                                                                            {
                                                                                pick.originalOwnerFantasyTeamName
                                                                            }
                                                                        </span>
                                                                        <button
                                                                            type='button'
                                                                            onClick={() =>
                                                                                toggleAdminTradePick(
                                                                                    'A',
                                                                                    pickId,
                                                                                )
                                                                            }
                                                                            className='shrink-0 cursor-pointer rounded px-1 text-xs text-destructive hover:bg-destructive/10'
                                                                        >
                                                                            ×
                                                                        </button>
                                                                    </li>
                                                                );
                                                            },
                                                        )}
                                                    </ul>
                                                )}

                                            {teamAProjection && (
                                                <div
                                                    className={`mt-3 rounded-lg border p-2 text-xs ${teamAProjection.isValid
                                                            ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-300'
                                                            : 'border-amber-500/40 bg-amber-500/5 text-amber-300'
                                                        }`}
                                                >
                                                    <p className='font-semibold'>
                                                        {teamAProjection.isValid
                                                            ? '✓ Structure après échange : valide'
                                                            : '⚠ Structure après échange : non-respectée'}
                                                    </p>
                                                    <p className='mt-1 tabular-nums'>
                                                        Actifs :{' '}
                                                        {teamAProjection.activeF}F /{' '}
                                                        {teamAProjection.activeD}D /{' '}
                                                        {teamAProjection.activeG}G
                                                        <span className='ml-1 text-[0.65rem] opacity-70'>
                                                            (12/6/1)
                                                        </span>
                                                    </p>
                                                    <p className='tabular-nums'>
                                                        Banc :{' '}
                                                        {teamAProjection.benchF}F /{' '}
                                                        {teamAProjection.benchD}D /{' '}
                                                        {teamAProjection.benchG}G
                                                        <span className='ml-1 text-[0.65rem] opacity-70'>
                                                            (4/2/1)
                                                        </span>
                                                    </p>
                                                    <p className='tabular-nums'>
                                                        Prospects :{' '}
                                                        {teamAProjection.prospects}
                                                        <span className='ml-1 text-[0.65rem] opacity-70'>
                                                            (3)
                                                        </span>
                                                    </p>
                                                    {!teamAProjection.isValid && (
                                                        <p className='mt-1 italic'>
                                                            L'échange sera quand
                                                            même appliqué. Corrigez
                                                            les statuts manuellement
                                                            après.
                                                        </p>
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    )}
                            </div>

                            {/* ---- Team B column ---- */}
                            <div className='space-y-2 rounded-lg border border-border bg-background p-2'>
                                <label className='text-sm font-medium text-muted-foreground'>
                                    Équipe 2
                                </label>
                                <select
                                    value={adminTradeTeamBId}
                                    onChange={(event) =>
                                        setAdminTradeTeamBId(
                                            event.target.value,
                                        )
                                    }
                                    className={selectClass}
                                >
                                    <option value=''>— équipe —</option>
                                    {teams
                                        .filter(
                                            (t) =>
                                                String(t.id) !==
                                                adminTradeTeamAId,
                                        )
                                        .map((team) => (
                                            <option
                                                key={team.id}
                                                value={team.id}
                                            >
                                                {team.name}
                                            </option>
                                        ))}
                                </select>

                                {adminTradeTeamBId !== '' &&
                                    adminTradeTeamBRoster && (
                                        <>
                                            {adminTradeTeamBPlayerSlots.map(
                                                (_slot, index) => {
                                                    const selectedPlayerId =
                                                        adminTradeTeamBPlayerSlots[
                                                        index
                                                        ];

                                                    const selectedEntry =
                                                        selectedPlayerId !==
                                                            ''
                                                            ? adminTradeTeamBRoster.entries.find(
                                                                (e) =>
                                                                    String(
                                                                        e.playerId,
                                                                    ) ===
                                                                    selectedPlayerId,
                                                            )
                                                            : undefined;

                                                    const currentStatus =
                                                        selectedEntry?.rosterStatus ??
                                                        '';

                                                    const effectiveStatus =
                                                        adminTradeTeamBPlayerNewStatuses[
                                                        index
                                                        ] || currentStatus;

                                                    return (
                                                        <div
                                                            key={index}
                                                            className='flex flex-wrap items-center gap-2'
                                                        >
                                                            <select
                                                                value={
                                                                    adminTradeTeamBPlayerSlots[
                                                                    index
                                                                    ]
                                                                }
                                                                onChange={(
                                                                    event,
                                                                ) =>
                                                                    setAdminTradeTeamBPlayerSlot(
                                                                        index,
                                                                        event
                                                                            .target
                                                                            .value,
                                                                    )
                                                                }
                                                                className={`${selectClass} flex-1 min-w-[10rem]`}
                                                            >
                                                                <option value=''>
                                                                    — Ajouter un joueur{' '}
                                                                    {index > 0
                                                                        ? index +
                                                                        1
                                                                        : ''}{' '}
                                                                    —
                                                                </option>
                                                                {(adminTradeTeamBRoster?.entries ??
                                                                    [])
                                                                    .filter(
                                                                        (
                                                                            e,
                                                                        ) => {
                                                                            return !adminTradeTeamBPlayerSlots.some(
                                                                                (
                                                                                    v,
                                                                                    i,
                                                                                ) =>
                                                                                    i !==
                                                                                    index &&
                                                                                    v !==
                                                                                    '' &&
                                                                                    Number(
                                                                                        v,
                                                                                    ) ===
                                                                                    e.playerId,
                                                                            );
                                                                        },
                                                                    )
                                                                    .map(
                                                                        (
                                                                            e,
                                                                        ) => (
                                                                            <option
                                                                                key={
                                                                                    e.playerId
                                                                                }
                                                                                value={
                                                                                    e.playerId
                                                                                }
                                                                            >
                                                                                {
                                                                                    e.firstName
                                                                                }{' '}
                                                                                {
                                                                                    e.lastName
                                                                                }{' '}
                                                                                (
                                                                                {
                                                                                    e.position
                                                                                }
                                                                                ,{' '}
                                                                                {
                                                                                    e.nhlTeamAbbreviation
                                                                                }
                                                                                ){' '}
                                                                                ·{' '}
                                                                                {
                                                                                    e.rosterStatus
                                                                                }
                                                                            </option>
                                                                        ),
                                                                    )}
                                                            </select>

                                                            {selectedPlayerId !==
                                                                '' && (
                                                                    <select
                                                                        value={
                                                                            effectiveStatus
                                                                        }
                                                                        onChange={(
                                                                            event,
                                                                        ) =>
                                                                            setAdminTradeTeamBPlayerNewStatus(
                                                                                index,
                                                                                event
                                                                                    .target
                                                                                    .value,
                                                                            )
                                                                        }
                                                                        className={`${selectClass} flex-shrink-0`}
                                                                        aria-label='Nouveau statut'
                                                                        title='Statut après échange'
                                                                    >
                                                                        <option value='Active'>
                                                                            Active
                                                                        </option>
                                                                        <option value='Bench'>
                                                                            Bench
                                                                        </option>
                                                                        <option value='Prospect'>
                                                                            Prospect
                                                                        </option>
                                                                    </select>
                                                                )}

                                                            {adminTradeTeamBPlayerSlots.length >
                                                                1 && (
                                                                    <button
                                                                        type='button'
                                                                        onClick={() =>
                                                                            removeAdminTradePlayerSlot(
                                                                                index,
                                                                            )
                                                                        }
                                                                        aria-label='Retirer ce slot'
                                                                        className='cursor-pointer rounded border border-destructive/40 px-1.5 py-0.5 text-xs text-destructive hover:bg-destructive/10'
                                                                    >
                                                                        ×
                                                                    </button>
                                                                )}
                                                        </div>
                                                    );
                                                },
                                            )}

                                        <button
                                            type='button'
                                            onClick={
                                                addAdminTradePlayerSlot
                                            }
                                            className='w-full cursor-pointer rounded border border-emerald-500 bg-transparent px-2 py-1 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/10'
                                        >
                                            + Ajouter un joueur
                                        </button>

                                        <button
                                            type='button'
                                            onClick={() =>
                                                setAdminTradePickPopupSide(
                                                    'B',
                                                )
                                            }
                                            className='w-full cursor-pointer rounded border border-border bg-transparent px-2 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-secondary'
                                        >
                                            Ajouter des choix de repêchage
                                        </button>

                                            {adminTradeTeamBPickIds.length >
                                                0 && (
                                                    <ul className='space-y-1'>
                                                        {adminTradeTeamBPickIds.map(
                                                            (pickId) => {
                                                                const pick =
                                                                    adminTradeTeamBPicks.find(
                                                                        (p) =>
                                                                            p.id ===
                                                                            pickId,
                                                                    );

                                                                if (!pick)
                                                                    return null;

                                                                return (
                                                                    <li
                                                                        key={
                                                                            pickId
                                                                        }
                                                                        className='flex items-center justify-between gap-2 rounded border border-[#00E5FF]/30 bg-[#00E5FF]/5 px-2 py-1 text-xs text-[#00E5FF]'
                                                                    >
                                                                        <span className='truncate'>
                                                                            {
                                                                                pick.draftYear
                                                                            }
                                                                            , Ronde{' '}
                                                                            {
                                                                                pick.round
                                                                            }
                                                                            ,{' '}
                                                                            {
                                                                                pick.originalOwnerFantasyTeamName
                                                                            }
                                                                        </span>
                                                                        <button
                                                                            type='button'
                                                                            onClick={() =>
                                                                                toggleAdminTradePick(
                                                                                    'B',
                                                                                    pickId,
                                                                                )
                                                                            }
                                                                            className='shrink-0 cursor-pointer rounded px-1 text-xs text-destructive hover:bg-destructive/10'
                                                                        >
                                                                            ×
                                                                        </button>
                                                                    </li>
                                                                );
                                                            },
                                                        )}
                                                    </ul>
                                                )}

                                            {teamBProjection && (
                                                <div
                                                    className={`mt-3 rounded-lg border p-2 text-xs ${teamBProjection.isValid
                                                            ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-300'
                                                            : 'border-amber-500/40 bg-amber-500/5 text-amber-300'
                                                        }`}
                                                >
                                                    <p className='font-semibold'>
                                                        {teamBProjection.isValid
                                                            ? '✓ Structure après échange : valide'
                                                            : '⚠ Structure après échange : non-respectée'}
                                                    </p>
                                                    <p className='mt-1 tabular-nums'>
                                                        Actifs :{' '}
                                                        {teamBProjection.activeF}F /{' '}
                                                        {teamBProjection.activeD}D /{' '}
                                                        {teamBProjection.activeG}G
                                                        <span className='ml-1 text-[0.65rem] opacity-70'>
                                                            (12/6/1)
                                                        </span>
                                                    </p>
                                                    <p className='tabular-nums'>
                                                        Banc :{' '}
                                                        {teamBProjection.benchF}F /{' '}
                                                        {teamBProjection.benchD}D /{' '}
                                                        {teamBProjection.benchG}G
                                                        <span className='ml-1 text-[0.65rem] opacity-70'>
                                                            (4/2/1)
                                                        </span>
                                                    </p>
                                                    <p className='tabular-nums'>
                                                        Prospects :{' '}
                                                        {teamBProjection.prospects}
                                                        <span className='ml-1 text-[0.65rem] opacity-70'>
                                                            (3)
                                                        </span>
                                                    </p>
                                                    {!teamBProjection.isValid && (
                                                        <p className='mt-1 italic'>
                                                            L'échange sera quand
                                                            même appliqué. Corrigez
                                                            les statuts manuellement
                                                            après.
                                                        </p>
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    )}
                            </div>
                        </div>

                        <div>
                            <label className='text-sm font-medium text-muted-foreground'>
                                Note (optionnel)
                            </label>
                            <input
                                type='text'
                                value={adminTradeNote}
                                maxLength={500}
                                onChange={(event) =>
                                    setAdminTradeNote(event.target.value)
                                }
                                className={`mt-1 ${selectClass}`}
                            />
                        </div>

                        {adminTradeError && (
                            <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                                {adminTradeError}
                            </p>
                        )}

                        {adminTradeSuccess && (
                            <p className='rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400'>
                                {adminTradeSuccess}
                            </p>
                        )}

                        <div className='flex justify-end'>
                            <button
                                type='button'
                                onClick={submitAdminTrade}
                                disabled={adminTradeSubmitting}
                                className={primaryButtonClass}
                            >
                                Confirmer
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* ============================================================
                Trades history (permanent audit trail)
                ============================================================ */}
            <div className='max-w-4xl space-y-3'>
                <button
                    type='button'
                    onClick={() =>
                        setShowAdminTradeHistory((v) => !v)
                    }
                    className='cursor-pointer rounded-lg px-4 py-2 text-sm font-bold uppercase tracking-wider text-[#F2F5FA] transition-opacity hover:brightness-110'
                    style={{
                        backgroundColor: '#080D1A',
                        border: '3px solid #A855F7',
                        boxShadow: [
                            'inset 0 0 0 1px rgba(240, 220, 255, 0.95)',
                            'inset 0 0 12px rgba(168, 85, 247, 0.55)',
                            'inset 0 0 28px rgba(168, 85, 247, 0.15)',
                        ].join(', '),
                    }}
                >
                    {showAdminTradeHistory
                        ? '▼ Masquer l\'historique'
                        : '▶ Trades history'}
                </button>

                {showAdminTradeHistory && (
                    <div className='space-y-3'>
                        <div className='flex items-center justify-end'>
                            <button
                                type='button'
                                onClick={() =>
                                    void loadAdminTradeHistory()
                                }
                                disabled={adminTradeHistoryLoading}
                                className={secondaryButtonClass}
                            >
                                {adminTradeHistoryLoading
                                    ? 'Chargement...'
                                    : 'Rafraîchir'}
                            </button>
                        </div>

                        {adminTradeHistoryLoading &&
                            adminTradeHistory.length === 0 && (
                                <p className='text-sm text-muted-foreground'>
                                    Chargement...
                                </p>
                            )}

                        {!adminTradeHistoryLoading &&
                            adminTradeHistory.length === 0 && (
                                <p className='rounded-lg border border-border bg-card px-3 py-4 text-sm text-muted-foreground'>
                                    Aucun échange enregistré.
                                </p>
                            )}

                        {adminTradeHistory.map((trade) => (
                            <div
                                key={trade.id}
                                className='space-y-2 rounded-lg border border-border bg-card p-3'
                            >
                                <div className='flex flex-wrap items-baseline justify-between gap-2'>
                                    <p className='text-sm font-semibold text-foreground'>
                                        #{trade.id} ·{' '}
                                        {trade.teamAName}
                                        {' ⇄ '}
                                        {trade.teamBName}
                                    </p>
                                    <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
                                        <span>
                                            Saison {trade.seasonName} ·
                                            Effectif le{' '}
                                            {trade.effectiveAt.slice(
                                                0,
                                                10,
                                            )}
                                        </span>
                                        {adminTradeDateEditFor !==
                                            trade.id && (
                                                <>
                                                    <button
                                                        type='button'
                                                        onClick={() => {
                                                            setAdminTradeDateEditFor(
                                                                trade.id,
                                                            );
                                                            setAdminTradeDateEditValue(
                                                                trade.effectiveAt.slice(
                                                                    0,
                                                                    10,
                                                                ),
                                                            );
                                                            setAdminTradeDateEditReason(
                                                                '',
                                                            );
                                                            setAdminTradeDateEditError(
                                                                null,
                                                            );
                                                        }}
                                                        className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground transition-colors hover:bg-secondary'
                                                    >
                                                        Modifier la date
                                                    </button>
                                                    <button
                                                        type='button'
                                                        onClick={() => {
                                                            setAdminTradeRevertFor(
                                                                trade.id,
                                                            );
                                                            setAdminTradeRevertConfirmInput(
                                                                '',
                                                            );
                                                            setAdminTradeRevertError(
                                                                null,
                                                            );
                                                        }}
                                                        className='cursor-pointer rounded border border-destructive/40 px-2 py-0.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10'
                                                    >
                                                        Revertir l'échange
                                                    </button>
                                                </>
                                            )}
                                    </div>
                                </div>

                                {adminTradeDateEditFor === trade.id && (
                                    <div className='space-y-2 rounded border border-[#00E5FF]/30 bg-[#00E5FF]/5 p-2'>
                                        <p className='text-xs font-semibold uppercase tracking-wider text-[#7DD3FC]'>
                                            Changer la date d'entrée en
                                            vigueur
                                        </p>

                                        <div className='flex flex-wrap items-end gap-2'>
                                            <div>
                                                <label className='text-[0.65rem] font-medium text-muted-foreground'>
                                                    Nouvelle date
                                                </label>
                                                <input
                                                    type='date'
                                                    value={
                                                        adminTradeDateEditValue
                                                    }
                                                    onChange={(event) =>
                                                        setAdminTradeDateEditValue(
                                                            event.target
                                                                .value,
                                                        )
                                                    }
                                                    className={`mt-0.5 ${selectClass}`}
                                                />
                                            </div>

                                            <div className='flex-1 min-w-[12rem]'>
                                                <label className='text-[0.65rem] font-medium text-muted-foreground'>
                                                    Raison (optionnel)
                                                </label>
                                                <input
                                                    type='text'
                                                    value={
                                                        adminTradeDateEditReason
                                                    }
                                                    maxLength={500}
                                                    onChange={(event) =>
                                                        setAdminTradeDateEditReason(
                                                            event.target
                                                                .value,
                                                        )
                                                    }
                                                    className={`mt-0.5 ${selectClass}`}
                                                />
                                            </div>
                                        </div>

                                        {adminTradeDateEditError && (
                                            <p className='rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive'>
                                                {adminTradeDateEditError}
                                            </p>
                                        )}

                                        <div className='flex justify-end gap-2'>
                                            <button
                                                type='button'
                                                onClick={() => {
                                                    setAdminTradeDateEditFor(
                                                        null,
                                                    );
                                                    setAdminTradeDateEditValue(
                                                        '',
                                                    );
                                                    setAdminTradeDateEditReason(
                                                        '',
                                                    );
                                                    setAdminTradeDateEditError(
                                                        null,
                                                    );
                                                }}
                                                disabled={
                                                    adminTradeDateEditBusy
                                                }
                                                className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50'
                                            >
                                                Annuler
                                            </button>
                                            <button
                                                type='button'
                                                onClick={() =>
                                                    void handleChangeTradeDate(
                                                        trade.id,
                                                    )
                                                }
                                                disabled={
                                                    adminTradeDateEditBusy
                                                }
                                                className='cursor-pointer rounded bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-black hover:bg-emerald-500 disabled:opacity-50'
                                            >
                                                {adminTradeDateEditBusy
                                                    ? 'Enregistrement...'
                                                    : 'Enregistrer'}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {trade.note && (
                                    <p className='rounded border border-[#00A8FF]/25 bg-[#00A8FF]/5 px-2 py-1 text-xs italic text-[#7DD3FC]'>
                                        « {trade.note} »
                                    </p>
                                )}

                                <div className='grid grid-cols-1 gap-2 md:grid-cols-2'>
                                    <div className='rounded border border-[#00E5FF]/30 bg-[#00E5FF]/5 p-2'>
                                        <p className='text-[0.65rem] font-semibold uppercase tracking-wider text-[#7DD3FC]'>
                                            {trade.teamAName} envoie à{' '}
                                            {trade.teamBName}
                                        </p>

                                        {trade.teamASentPlayers.length ===
                                            0 &&
                                            trade.teamASentPicks.length ===
                                            0 && (
                                                <p className='mt-1 text-xs text-muted-foreground'>
                                                    (rien)
                                                </p>
                                            )}

                                        {trade.teamASentPlayers.length >
                                            0 && (
                                                <ul className='mt-1 space-y-0.5'>
                                                    {trade.teamASentPlayers.map(
                                                        (p) => (
                                                            <li
                                                                key={
                                                                    p.playerId
                                                                }
                                                                className='text-xs text-foreground'
                                                            >
                                                                {p.firstName}{' '}
                                                                {p.lastName} (
                                                                {p.position},{' '}
                                                                {
                                                                    p.nhlTeamAbbreviation
                                                                }
                                                                ) ·{' '}
                                                                {(
                                                                    p.salary /
                                                                    1_000_000
                                                                )
                                                                    .toFixed(2)
                                                                    .replace(
                                                                        /\.?0+$/,
                                                                        '',
                                                                    )}
                                                                M ·{' '}
                                                                {
                                                                    p.yearsRemaining
                                                                }{' '}
                                                                an
                                                                {p.yearsRemaining >
                                                                    1
                                                                    ? 's'
                                                                    : ''}
                                                                {p.previousStatus &&
                                                                    (p.previousStatus ===
                                                                        p.newStatus ? (
                                                                        <span className='ml-1 text-muted-foreground'>
                                                                            ·{' '}
                                                                            {
                                                                                p.newStatus
                                                                            }
                                                                        </span>
                                                                    ) : (
                                                                        <span className='ml-1 font-semibold text-[#FFC72C]'>
                                                                            ·{' '}
                                                                            {
                                                                                p.previousStatus
                                                                            }{' '}
                                                                            →{' '}
                                                                            {
                                                                                p.newStatus
                                                                            }
                                                                        </span>
                                                                    ))}
                                                            </li>
                                                        ),
                                                    )}
                                                </ul>
                                            )}

                                        {trade.teamASentPicks.length >
                                            0 && (
                                                <ul className='mt-1 space-y-0.5'>
                                                    {trade.teamASentPicks.map(
                                                        (p) => (
                                                            <li
                                                                key={
                                                                    p.draftPickId
                                                                }
                                                                className='text-xs text-[#FFC72C]'
                                                            >
                                                                {
                                                                    p.draftYear
                                                                }
                                                                , Ronde{' '}
                                                                {p.round},{' '}
                                                                {
                                                                    p.originalOwnerFantasyTeamName
                                                                }
                                                            </li>
                                                        ),
                                                    )}
                                                </ul>
                                            )}
                                    </div>

                                    <div className='rounded border border-[#A855F7]/30 bg-[#A855F7]/5 p-2'>
                                        <p className='text-[0.65rem] font-semibold uppercase tracking-wider text-[#D8B4FE]'>
                                            {trade.teamBName} envoie à{' '}
                                            {trade.teamAName}
                                        </p>

                                        {trade.teamBSentPlayers.length ===
                                            0 &&
                                            trade.teamBSentPicks.length ===
                                            0 && (
                                                <p className='mt-1 text-xs text-muted-foreground'>
                                                    (rien)
                                                </p>
                                            )}

                                        {trade.teamBSentPlayers.length >
                                            0 && (
                                                <ul className='mt-1 space-y-0.5'>
                                                    {trade.teamBSentPlayers.map(
                                                        (p) => (
                                                            <li
                                                                key={
                                                                    p.playerId
                                                                }
                                                                className='text-xs text-foreground'
                                                            >
                                                                {p.firstName}{' '}
                                                                {p.lastName} (
                                                                {p.position},{' '}
                                                                {
                                                                    p.nhlTeamAbbreviation
                                                                }
                                                                ) ·{' '}
                                                                {(
                                                                    p.salary /
                                                                    1_000_000
                                                                )
                                                                    .toFixed(2)
                                                                    .replace(
                                                                        /\.?0+$/,
                                                                        '',
                                                                    )}
                                                                M ·{' '}
                                                                {
                                                                    p.yearsRemaining
                                                                }{' '}
                                                                an
                                                                {p.yearsRemaining >
                                                                    1
                                                                    ? 's'
                                                                    : ''}
                                                                {p.previousStatus &&
                                                                    (p.previousStatus ===
                                                                        p.newStatus ? (
                                                                        <span className='ml-1 text-muted-foreground'>
                                                                            ·{' '}
                                                                            {
                                                                                p.newStatus
                                                                            }
                                                                        </span>
                                                                    ) : (
                                                                        <span className='ml-1 font-semibold text-[#FFC72C]'>
                                                                            ·{' '}
                                                                            {
                                                                                p.previousStatus
                                                                            }{' '}
                                                                            →{' '}
                                                                            {
                                                                                p.newStatus
                                                                            }
                                                                        </span>
                                                                    ))}
                                                            </li>
                                                        ),
                                                    )}
                                                </ul>
                                            )}

                                        {trade.teamBSentPicks.length >
                                            0 && (
                                                <ul className='mt-1 space-y-0.5'>
                                                    {trade.teamBSentPicks.map(
                                                        (p) => (
                                                            <li
                                                                key={
                                                                    p.draftPickId
                                                                }
                                                                className='text-xs text-[#FFC72C]'
                                                            >
                                                                {
                                                                    p.draftYear
                                                                }
                                                                , Ronde{' '}
                                                                {p.round},{' '}
                                                                {
                                                                    p.originalOwnerFantasyTeamName
                                                                }
                                                            </li>
                                                        ),
                                                    )}
                                                </ul>
                                            )}
                                    </div>
                                </div>

                                {trade.dateChanges.length > 0 && (
                                    <div className='rounded border border-[#FFC72C]/30 bg-[#FFC72C]/5 p-2'>
                                        <p className='text-[0.65rem] font-semibold uppercase tracking-wider text-[#FFC72C]'>
                                            Historique des changements
                                            de date
                                        </p>
                                        <ul className='mt-1 space-y-0.5 text-xs'>
                                            {trade.dateChanges.map(
                                                (dc) => (
                                                    <li
                                                        key={dc.id}
                                                        className='text-foreground'
                                                    >
                                                        <span className='font-mono'>
                                                            {dc.previousEffectiveAt.slice(
                                                                0,
                                                                10,
                                                            )}
                                                        </span>
                                                        {' → '}
                                                        <span className='font-mono font-semibold'>
                                                            {dc.newEffectiveAt.slice(
                                                                0,
                                                                10,
                                                            )}
                                                        </span>
                                                        <span className='ml-2 text-muted-foreground'>
                                                            (
                                                            {new Date(
                                                                dc.changedAt,
                                                            ).toLocaleString(
                                                                'fr-CA',
                                                            )}
                                                            )
                                                        </span>
                                                        {dc.reason && (
                                                            <span className='ml-2 italic text-muted-foreground'>
                                                                «{' '}
                                                                {
                                                                    dc.reason
                                                                }{' '}
                                                                »
                                                            </span>
                                                        )}
                                                    </li>
                                                ),
                                            )}
                                        </ul>
                                    </div>
                                )}

                                <p className='text-[0.65rem] text-muted-foreground'>
                                    Confirmé le{' '}
                                    {new Date(
                                        trade.confirmedAt,
                                    ).toLocaleString('fr-CA')}
                                </p>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Pick-selection popup for the trade form */}
            {adminTradePickPopupSide !== null && (
                <div
                    className='fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4'
                    onClick={() =>
                        setAdminTradePickPopupSide(null)
                    }
                    role='dialog'
                    aria-modal='true'
                >
                    <div
                        className='flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-[#00E5FF]/50 bg-[#0F1626] shadow-[0_0_20px_rgba(0,229,255,0.35),0_8px_24px_rgba(0,0,0,0.6)]'
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className='flex items-center justify-between border-b border-[#00E5FF]/20 px-3 py-2'>
                            <h3 className='text-sm font-bold uppercase tracking-wider text-white'>
                                Ajouter des choix de repêchage
                            </h3>
                            <button
                                type='button'
                                onClick={() =>
                                    setAdminTradePickPopupSide(null)
                                }
                                className='cursor-pointer rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-black hover:bg-red-500'
                            >
                                Fermer
                            </button>
                        </div>

                        <div className='flex-1 overflow-y-auto'>
                            {(() => {
                                const picks =
                                    adminTradePickPopupSide === 'A'
                                        ? adminTradeTeamAPicks
                                        : adminTradeTeamBPicks;
                                const selected =
                                    adminTradePickPopupSide === 'A'
                                        ? adminTradeTeamAPickIds
                                        : adminTradeTeamBPickIds;

                                if (picks.length === 0) {
                                    return (
                                        <p className='px-3 py-4 text-center text-sm text-muted-foreground'>
                                            Aucun choix disponible pour cette
                                            équipe.
                                        </p>
                                    );
                                }

                                return (
                                    <ul className='space-y-0.5 p-2'>
                                        {picks.map((pick) => {
                                            const isSelected =
                                                selected.includes(pick.id);

                                            return (
                                                <li key={pick.id}>
                                                    <button
                                                        type='button'
                                                        onClick={() =>
                                                            toggleAdminTradePick(
                                                                adminTradePickPopupSide,
                                                                pick.id,
                                                            )
                                                        }
                                                        className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${isSelected
                                                                ? 'bg-[#00E5FF]/20 text-[#00E5FF]'
                                                                : 'text-foreground hover:bg-[#00E5FF]/10'
                                                            }`}
                                                    >
                                                        <span>
                                                            {pick.draftYear},
                                                            Ronde{' '}
                                                            {pick.round},{' '}
                                                            {
                                                                pick.originalOwnerFantasyTeamName
                                                            }
                                                        </span>
                                                        <span className='text-xs'>
                                                            {isSelected
                                                                ? '✓'
                                                                : ''}
                                                        </span>
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                );
                            })()}
                        </div>

                        <div className='border-t border-[#00E5FF]/20 px-3 py-2'>
                            <button
                                type='button'
                                onClick={() =>
                                    setAdminTradePickPopupSide(null)
                                }
                                className='w-full cursor-pointer rounded border border-emerald-500 bg-transparent px-2 py-1.5 text-sm font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/10'
                            >
                                Terminé
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirm popup for the trade form */}
            {adminTradePreviewOpen && adminTradePreview !== null && (
                <div
                    className='fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4'
                    onClick={() => setAdminTradePreviewOpen(false)}
                    role='dialog'
                    aria-modal='true'
                >
                    <div
                        className='flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[#00E5FF]/50 bg-[#0F1626] shadow-[0_0_20px_rgba(0,229,255,0.35),0_8px_24px_rgba(0,0,0,0.6)]'
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className='flex items-center justify-between border-b border-[#00E5FF]/20 px-3 py-2'>
                            <h3 className='text-sm font-bold uppercase tracking-wider text-white'>
                                Confirmer l'échange
                            </h3>
                            <button
                                type='button'
                                onClick={() =>
                                    setAdminTradePreviewOpen(false)
                                }
                                className='cursor-pointer rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-black hover:bg-red-500'
                            >
                                Fermer
                            </button>
                        </div>

                        <div className='flex-1 space-y-3 overflow-y-auto px-3 py-3'>
                            <p className='text-sm text-foreground'>
                                <span className='font-semibold'>
                                    Date d'entrée en vigueur :
                                </span>{' '}
                                {adminTradePreview.effectiveAt.slice(
                                    0,
                                    10,
                                )}
                            </p>

                            {adminTradePreview.note && (
                                <p className='rounded border border-[#00A8FF]/25 bg-[#00A8FF]/5 px-2 py-1 text-xs italic text-[#7DD3FC]'>
                                    « {adminTradePreview.note} »
                                </p>
                            )}

                            <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
                                <div className='rounded border border-[#00E5FF]/30 bg-[#00E5FF]/5 p-2'>
                                    <p className='text-[0.65rem] font-semibold uppercase tracking-wider text-[#7DD3FC]'>
                                        {adminTradePreview.teamAName}{' '}
                                        envoie à{' '}
                                        {adminTradePreview.teamBName}
                                    </p>

                                    {adminTradePreview.teamASentPlayers
                                        .length === 0 &&
                                        adminTradePreview.teamASentPicks
                                            .length === 0 && (
                                            <p className='mt-1 text-xs text-muted-foreground'>
                                                (rien)
                                            </p>
                                        )}

                                    {adminTradePreview.teamASentPlayers
                                        .length > 0 && (
                                            <ul className='mt-1 space-y-0.5'>
                                                {adminTradePreview.teamASentPlayers.map(
                                                    (p) => (
                                                        <li
                                                            key={p.playerId}
                                                            className='text-xs text-foreground'
                                                        >
                                                            {p.firstName}{' '}
                                                            {p.lastName} (
                                                            {p.position},{' '}
                                                            {
                                                                p.nhlTeamAbbreviation
                                                            }
                                                            ) ·{' '}
                                                            {(
                                                                p.salary /
                                                                1_000_000
                                                            )
                                                                .toFixed(2)
                                                                .replace(
                                                                    /\.?0+$/,
                                                                    '',
                                                                )}
                                                            M ·{' '}
                                                            {
                                                                p.yearsRemaining
                                                            }{' '}
                                                            an
                                                            {p.yearsRemaining >
                                                                1
                                                                ? 's'
                                                                : ''}
                                                            {p.previousStatus &&
                                                                (p.previousStatus ===
                                                                    p.newStatus ? (
                                                                    <span className='ml-1 text-muted-foreground'>
                                                                        ·{' '}
                                                                        {
                                                                            p.newStatus
                                                                        }
                                                                    </span>
                                                                ) : (
                                                                    <span className='ml-1 font-semibold text-[#FFC72C]'>
                                                                        ·{' '}
                                                                        {
                                                                            p.previousStatus
                                                                        }{' '}
                                                                        →{' '}
                                                                        {
                                                                            p.newStatus
                                                                        }
                                                                    </span>
                                                                ))}
                                                        </li>
                                                    ),
                                                )}
                                            </ul>
                                        )}

                                    {adminTradePreview.teamASentPicks
                                        .length > 0 && (
                                            <ul className='mt-1 space-y-0.5'>
                                                {adminTradePreview.teamASentPicks.map(
                                                    (p) => (
                                                        <li
                                                            key={p.draftPickId}
                                                            className='text-xs text-[#FFC72C]'
                                                        >
                                                            {p.draftYear},
                                                            Ronde {p.round},{' '}
                                                            {
                                                                p.originalOwnerFantasyTeamName
                                                            }
                                                        </li>
                                                    ),
                                                )}
                                            </ul>
                                        )}
                                </div>

                                <div className='rounded border border-[#A855F7]/30 bg-[#A855F7]/5 p-2'>
                                    <p className='text-[0.65rem] font-semibold uppercase tracking-wider text-[#D8B4FE]'>
                                        {adminTradePreview.teamBName}{' '}
                                        envoie à{' '}
                                        {adminTradePreview.teamAName}
                                    </p>

                                    {adminTradePreview.teamBSentPlayers
                                        .length === 0 &&
                                        adminTradePreview.teamBSentPicks
                                            .length === 0 && (
                                            <p className='mt-1 text-xs text-muted-foreground'>
                                                (rien)
                                            </p>
                                        )}

                                    {adminTradePreview.teamBSentPlayers
                                        .length > 0 && (
                                            <ul className='mt-1 space-y-0.5'>
                                                {adminTradePreview.teamBSentPlayers.map(
                                                    (p) => (
                                                        <li
                                                            key={p.playerId}
                                                            className='text-xs text-foreground'
                                                        >
                                                            {p.firstName}{' '}
                                                            {p.lastName} (
                                                            {p.position},{' '}
                                                            {
                                                                p.nhlTeamAbbreviation
                                                            }
                                                            ) ·{' '}
                                                            {(
                                                                p.salary /
                                                                1_000_000
                                                            )
                                                                .toFixed(2)
                                                                .replace(
                                                                    /\.?0+$/,
                                                                    '',
                                                                )}
                                                            M ·{' '}
                                                            {
                                                                p.yearsRemaining
                                                            }{' '}
                                                            an
                                                            {p.yearsRemaining >
                                                                1
                                                                ? 's'
                                                                : ''}
                                                            {p.previousStatus &&
                                                                (p.previousStatus ===
                                                                    p.newStatus ? (
                                                                    <span className='ml-1 text-muted-foreground'>
                                                                        ·{' '}
                                                                        {
                                                                            p.newStatus
                                                                        }
                                                                    </span>
                                                                ) : (
                                                                    <span className='ml-1 font-semibold text-[#FFC72C]'>
                                                                        ·{' '}
                                                                        {
                                                                            p.previousStatus
                                                                        }{' '}
                                                                        →{' '}
                                                                        {
                                                                            p.newStatus
                                                                        }
                                                                    </span>
                                                                ))}
                                                        </li>
                                                    ),
                                                )}
                                            </ul>
                                        )}

                                    {adminTradePreview.teamBSentPicks
                                        .length > 0 && (
                                            <ul className='mt-1 space-y-0.5'>
                                                {adminTradePreview.teamBSentPicks.map(
                                                    (p) => (
                                                        <li
                                                            key={p.draftPickId}
                                                            className='text-xs text-[#FFC72C]'
                                                        >
                                                            {p.draftYear},
                                                            Ronde {p.round},{' '}
                                                            {
                                                                p.originalOwnerFantasyTeamName
                                                            }
                                                        </li>
                                                    ),
                                                )}
                                            </ul>
                                        )}
                                </div>
                            </div>

                            {adminTradeError && (
                                <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                                    {adminTradeError}
                                </p>
                            )}
                        </div>

                        <div className='flex justify-end gap-2 border-t border-[#00E5FF]/20 px-3 py-2'>
                            <button
                                type='button'
                                onClick={() =>
                                    setAdminTradePreviewOpen(false)
                                }
                                disabled={adminTradeSubmitting}
                                className='cursor-pointer rounded border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary disabled:opacity-50'
                            >
                                Annuler
                            </button>
                            <button
                                type='button'
                                onClick={() => void confirmAdminTrade()}
                                disabled={adminTradeSubmitting}
                                className='cursor-pointer rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-black hover:bg-emerald-500 disabled:opacity-50'
                            >
                                {adminTradeSubmitting
                                    ? 'Enregistrement...'
                                    : 'Confirmer'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Revert-trade confirmation popup */}
            {adminTradeRevertFor !== null && (
                <div
                    className='fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4'
                    onClick={() => {
                        if (adminTradeRevertBusy) return;
                        setAdminTradeRevertFor(null);
                        setAdminTradeRevertConfirmInput('');
                        setAdminTradeRevertError(null);
                    }}
                    role='dialog'
                    aria-modal='true'
                >
                    <div
                        className='flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-destructive/60 bg-[#0F1626] shadow-[0_0_20px_rgba(220,38,38,0.5),0_8px_24px_rgba(0,0,0,0.6)]'
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className='flex items-center justify-between border-b border-destructive/40 px-3 py-2'>
                            <h3 className='text-sm font-bold uppercase tracking-wider text-destructive'>
                                Revertir l'échange #{adminTradeRevertFor}
                            </h3>
                            <button
                                type='button'
                                onClick={() => {
                                    if (adminTradeRevertBusy) return;
                                    setAdminTradeRevertFor(null);
                                    setAdminTradeRevertConfirmInput('');
                                    setAdminTradeRevertError(null);
                                }}
                                disabled={adminTradeRevertBusy}
                                className='cursor-pointer rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-black hover:bg-red-500 disabled:opacity-50'
                            >
                                Fermer
                            </button>
                        </div>

                        <div className='flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm text-foreground'>
                            <p className='font-semibold text-destructive'>
                                Cette action est irréversible.
                            </p>

                            <p>Revertir l'échange va :</p>

                            <ul className='ml-4 list-disc space-y-1 text-xs'>
                                <li>
                                    Déplacer chaque joueur échangé vers
                                    son équipe d'origine.
                                </li>
                                <li>
                                    Déplacer chaque choix de repêchage
                                    échangé vers son propriétaire
                                    d'origine.
                                </li>
                                <li>
                                    Supprimer définitivement toutes les
                                    lignes d'historique de statut
                                    créées par cet échange.
                                </li>
                                <li>
                                    Supprimer définitivement l'échange
                                    de cette liste.
                                </li>
                                <li>
                                    Recalculer les totaux de la saison
                                    comme si l'échange n'avait jamais
                                    eu lieu.
                                </li>
                            </ul>

                            <p className='rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive'>
                                Note : les offres du marché qui ont été
                                supprimées automatiquement lors de la
                                création de l'échange ne seront pas
                                restaurées.
                            </p>

                            <p className='text-xs'>
                                Pour confirmer, tapez le numéro de
                                l'échange ({adminTradeRevertFor})
                                ci-dessous.
                            </p>

                            <input
                                type='text'
                                value={adminTradeRevertConfirmInput}
                                onChange={(event) =>
                                    setAdminTradeRevertConfirmInput(
                                        event.target.value,
                                    )
                                }
                                placeholder={String(adminTradeRevertFor)}
                                disabled={adminTradeRevertBusy}
                                className={`${selectClass} text-center font-mono`}
                            />

                            {adminTradeRevertError && (
                                <p className='rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive'>
                                    {adminTradeRevertError}
                                </p>
                            )}
                        </div>

                        <div className='flex justify-end gap-2 border-t border-destructive/40 px-3 py-2'>
                            <button
                                type='button'
                                onClick={() => {
                                    if (adminTradeRevertBusy) return;
                                    setAdminTradeRevertFor(null);
                                    setAdminTradeRevertConfirmInput('');
                                    setAdminTradeRevertError(null);
                                }}
                                disabled={adminTradeRevertBusy}
                                className='cursor-pointer rounded border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary disabled:opacity-50'
                            >
                                Annuler
                            </button>
                            <button
                                type='button'
                                onClick={() =>
                                    void handleRevertTrade(
                                        adminTradeRevertFor,
                                    )
                                }
                                disabled={
                                    adminTradeRevertBusy ||
                                    adminTradeRevertConfirmInput.trim() !==
                                    String(adminTradeRevertFor)
                                }
                                className='cursor-pointer rounded bg-destructive px-3 py-1.5 text-sm font-semibold text-destructive-foreground hover:brightness-110 disabled:opacity-50'
                            >
                                {adminTradeRevertBusy
                                    ? 'Revert en cours...'
                                    : "Revertir l'échange"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ============================================================
                Changer des statuts (commissioner-only batch swap)
                ============================================================ */}
            <div className='max-w-4xl space-y-3'>
                <button
                    type='button'
                    onClick={() => setShowStatusChangeForm((v) => !v)}
                    className='cursor-pointer rounded-lg px-4 py-2 text-sm font-bold uppercase tracking-wider text-[#F2F5FA] transition-opacity hover:brightness-110'
                    style={{
                        backgroundColor: '#080D1A',
                        border: '3px solid #22C55E',
                        boxShadow: [
                            'inset 0 0 0 1px rgba(220, 255, 230, 0.95)',
                            'inset 0 0 12px rgba(34, 197, 94, 0.55)',
                            'inset 0 0 28px rgba(34, 197, 94, 0.15)',
                        ].join(', '),
                    }}
                >
                    {showStatusChangeForm
                        ? '▼ Masquer les changements de statut'
                        : '▶ Changer des statuts'}
                </button>

                {showStatusChangeForm && (
                    <div className='space-y-4 rounded-lg border border-border bg-card p-3'>
                        <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
                            <div>
                                <label className='text-sm font-medium text-muted-foreground'>
                                    Équipe
                                </label>
                                <select
                                    value={statusChangeTeamId}
                                    onChange={(event) =>
                                        setStatusChangeTeamId(
                                            event.target.value,
                                        )
                                    }
                                    className={`mt-1 ${selectClass}`}
                                >
                                    <option value=''>— équipe —</option>
                                    {teams.map((team) => (
                                        <option
                                            key={team.id}
                                            value={team.id}
                                        >
                                            {team.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className='text-sm font-medium text-muted-foreground'>
                                    Date d'entrée en vigueur
                                </label>
                                <input
                                    type='date'
                                    value={statusChangeDate}
                                    onChange={(event) =>
                                        setStatusChangeDate(
                                            event.target.value,
                                        )
                                    }
                                    className={`mt-1 ${selectClass}`}
                                />
                            </div>

                            <div />

                            <div>
                                <label className='text-sm font-medium text-muted-foreground'>
                                    Status 1
                                </label>
                                <select
                                    value={statusChangeA}
                                    onChange={(event) =>
                                        setStatusChangeA(
                                            event.target.value as
                                            | 'Active'
                                            | 'Bench'
                                            | 'Prospect',
                                        )
                                    }
                                    className={`mt-1 ${selectClass}`}
                                >
                                    <option value='Active'>Active</option>
                                    <option value='Bench'>Bench</option>
                                    <option value='Prospect'>
                                        Prospect
                                    </option>
                                </select>
                            </div>

                            <div>
                                <label className='text-sm font-medium text-muted-foreground'>
                                    Status 2
                                </label>
                                <select
                                    value={statusChangeB}
                                    onChange={(event) =>
                                        setStatusChangeB(
                                            event.target.value as
                                            | 'Active'
                                            | 'Bench'
                                            | 'Prospect',
                                        )
                                    }
                                    className={`mt-1 ${selectClass}`}
                                >
                                    <option value='Active'>Active</option>
                                    <option value='Bench'>Bench</option>
                                    <option value='Prospect'>
                                        Prospect
                                    </option>
                                </select>
                            </div>
                        </div>

                        {statusChangeTeamId !== '' &&
                            statusChangeTeamRoster && (
                                <div className='space-y-2'>
                                    {statusChangePairs.map(
                                        (_pair, index) => {
                                            const aId =
                                                statusChangePairs[
                                                    index
                                                ].aId;
                                            const bId =
                                                statusChangePairs[
                                                    index
                                                ].bId;

                                            const aOptions =
                                                statusChangeTeamRoster.entries.filter(
                                                    (e) =>
                                                        e.rosterStatus ===
                                                        statusChangeA &&
                                                        !statusChangePairs.some(
                                                            (p, i) =>
                                                                i !==
                                                                index &&
                                                                p.aId ===
                                                                String(
                                                                    e.playerId,
                                                                ),
                                                        ),
                                                );

                                            const bOptions =
                                                statusChangeTeamRoster.entries.filter(
                                                    (e) =>
                                                        e.rosterStatus ===
                                                        statusChangeB &&
                                                        !statusChangePairs.some(
                                                            (p, i) =>
                                                                i !==
                                                                index &&
                                                                p.bId ===
                                                                String(
                                                                    e.playerId,
                                                                ),
                                                        ),
                                                );

                                            return (
                                                <div
                                                    key={index}
                                                    className='flex flex-wrap items-center gap-2 rounded border border-border bg-background p-2'
                                                >
                                                    <div className='flex-1 min-w-[12rem]'>
                                                        <label className='text-xs text-muted-foreground'>
                                                            {statusChangeA}
                                                        </label>
                                                        <select
                                                            value={aId}
                                                            onChange={(e) =>
                                                                setStatusChangePairA(
                                                                    index,
                                                                    e
                                                                        .target
                                                                        .value,
                                                                )
                                                            }
                                                            className={`mt-0.5 ${selectClass}`}
                                                        >
                                                            <option value=''>
                                                                —
                                                                Choisir
                                                                —
                                                            </option>
                                                            {aOptions.map(
                                                                (e) => (
                                                                    <option
                                                                        key={
                                                                            e.playerId
                                                                        }
                                                                        value={
                                                                            e.playerId
                                                                        }
                                                                    >
                                                                        {
                                                                            e.firstName
                                                                        }{' '}
                                                                        {
                                                                            e.lastName
                                                                        }{' '}
                                                                        (
                                                                        {
                                                                            e.position
                                                                        }
                                                                        )
                                                                    </option>
                                                                ),
                                                            )}
                                                        </select>
                                                    </div>

                                                    <span className='pt-4 text-lg text-muted-foreground'>
                                                        ⇄
                                                    </span>

                                                    <div className='flex-1 min-w-[12rem]'>
                                                        <label className='text-xs text-muted-foreground'>
                                                            {statusChangeB}
                                                        </label>
                                                        <select
                                                            value={bId}
                                                            onChange={(e) =>
                                                                setStatusChangePairB(
                                                                    index,
                                                                    e
                                                                        .target
                                                                        .value,
                                                                )
                                                            }
                                                            className={`mt-0.5 ${selectClass}`}
                                                        >
                                                            <option value=''>
                                                                —
                                                                Choisir
                                                                —
                                                            </option>
                                                            {bOptions.map(
                                                                (e) => (
                                                                    <option
                                                                        key={
                                                                            e.playerId
                                                                        }
                                                                        value={
                                                                            e.playerId
                                                                        }
                                                                    >
                                                                        {
                                                                            e.firstName
                                                                        }{' '}
                                                                        {
                                                                            e.lastName
                                                                        }{' '}
                                                                        (
                                                                        {
                                                                            e.position
                                                                        }
                                                                        )
                                                                    </option>
                                                                ),
                                                            )}
                                                        </select>
                                                    </div>

                                                    {statusChangePairs.length >
                                                        1 && (
                                                            <button
                                                                type='button'
                                                                onClick={() =>
                                                                    removeStatusChangePair(
                                                                        index,
                                                                    )
                                                                }
                                                                aria-label='Retirer cette paire'
                                                                className='mt-4 shrink-0 cursor-pointer rounded border border-destructive/40 px-1.5 py-0.5 text-xs text-destructive hover:bg-destructive/10'
                                                            >
                                                                ×
                                                            </button>
                                                        )}
                                                </div>
                                            );
                                        },
                                    )}

                                    <button
                                        type='button'
                                        onClick={addStatusChangePair}
                                        className='w-full cursor-pointer rounded border border-emerald-500 bg-transparent px-2 py-1 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/10'
                                    >
                                        + Ajouter une paire
                                    </button>
                                </div>
                            )}

                        <div>
                            <label className='text-sm font-medium text-muted-foreground'>
                                Note (optionnel)
                            </label>
                            <input
                                type='text'
                                value={statusChangeNote}
                                maxLength={500}
                                onChange={(event) =>
                                    setStatusChangeNote(
                                        event.target.value,
                                    )
                                }
                                className={`mt-1 ${selectClass}`}
                            />
                        </div>

                        {statusChangeError && (
                            <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                                {statusChangeError}
                            </p>
                        )}

                        {statusChangeSuccess && (
                            <p className='rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400'>
                                {statusChangeSuccess}
                            </p>
                        )}

                        <div className='flex justify-end'>
                            <button
                                type='button'
                                onClick={submitStatusChange}
                                disabled={statusChangeSubmitting}
                                className={primaryButtonClass}
                            >
                                Confirmer
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* ============================================================
                Status changes history
                ============================================================ */}
            <div className='max-w-4xl space-y-3'>
                <button
                    type='button'
                    onClick={() =>
                        setShowStatusChangeHistory((v) => !v)
                    }
                    className='cursor-pointer rounded-lg px-4 py-2 text-sm font-bold uppercase tracking-wider text-[#F2F5FA] transition-opacity hover:brightness-110'
                    style={{
                        backgroundColor: '#080D1A',
                        border: '3px solid #F59E0B',
                        boxShadow: [
                            'inset 0 0 0 1px rgba(255, 245, 220, 0.95)',
                            'inset 0 0 12px rgba(245, 158, 11, 0.55)',
                            'inset 0 0 28px rgba(245, 158, 11, 0.15)',
                        ].join(', '),
                    }}
                >
                    {showStatusChangeHistory
                        ? "▼ Masquer l'historique"
                        : '▶ Status changes history'}
                </button>

                {showStatusChangeHistory && (
                    <div className='space-y-3'>
                        <div className='flex items-center justify-end'>
                            <button
                                type='button'
                                onClick={() =>
                                    void loadStatusChangeHistory()
                                }
                                disabled={statusChangeHistoryLoading}
                                className={secondaryButtonClass}
                            >
                                {statusChangeHistoryLoading
                                    ? 'Chargement...'
                                    : 'Rafraîchir'}
                            </button>
                        </div>

                        {statusChangeHistoryLoading &&
                            statusChangeHistory.length === 0 && (
                                <p className='text-sm text-muted-foreground'>
                                    Chargement...
                                </p>
                            )}

                        {!statusChangeHistoryLoading &&
                            statusChangeHistory.length === 0 && (
                                <p className='rounded-lg border border-border bg-card px-3 py-4 text-sm text-muted-foreground'>
                                    Aucun changement de statut
                                    enregistré.
                                </p>
                            )}

                        {statusChangeHistory.map((h) => (
                            <div
                                key={h.id}
                                className='space-y-2 rounded-lg border border-border bg-card p-3'
                            >
                                <div className='flex flex-wrap items-baseline justify-between gap-2'>
                                    <p className='text-sm font-semibold text-foreground'>
                                        #{h.id} · {h.fantasyTeamName} ·{' '}
                                        {h.statusAName} ↔ {h.statusBName}
                                    </p>
                                    <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
                                        <span>
                                            Saison {h.seasonName} ·
                                            Effectif le{' '}
                                            {h.effectiveAt.slice(0, 10)}
                                        </span>
                                        {statusChangeDateEditFor !==
                                            h.id && (
                                                <>
                                                    <button
                                                        type='button'
                                                        onClick={() => {
                                                            setStatusChangeDateEditFor(
                                                                h.id,
                                                            );
                                                            setStatusChangeDateEditValue(
                                                                h.effectiveAt.slice(
                                                                    0,
                                                                    10,
                                                                ),
                                                            );
                                                            setStatusChangeDateEditReason(
                                                                '',
                                                            );
                                                            setStatusChangeDateEditError(
                                                                null,
                                                            );
                                                        }}
                                                        className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary'
                                                    >
                                                        Modifier la date
                                                    </button>
                                                    <button
                                                        type='button'
                                                        onClick={() => {
                                                            setStatusChangeRevertFor(
                                                                h.id,
                                                            );
                                                            setStatusChangeRevertConfirmInput(
                                                                '',
                                                            );
                                                            setStatusChangeRevertError(
                                                                null,
                                                            );
                                                        }}
                                                        className='cursor-pointer rounded border border-destructive/40 px-2 py-0.5 text-xs font-semibold text-destructive hover:bg-destructive/10'
                                                    >
                                                        Revertir
                                                    </button>
                                                </>
                                            )}
                                    </div>
                                </div>

                                {statusChangeDateEditFor === h.id && (
                                    <div className='space-y-2 rounded border border-[#22C55E]/30 bg-[#22C55E]/5 p-2'>
                                        <p className='text-xs font-semibold uppercase tracking-wider text-[#22C55E]'>
                                            Changer la date
                                        </p>

                                        <div className='flex flex-wrap items-end gap-2'>
                                            <div>
                                                <label className='text-[0.65rem] font-medium text-muted-foreground'>
                                                    Nouvelle date
                                                </label>
                                                <input
                                                    type='date'
                                                    value={
                                                        statusChangeDateEditValue
                                                    }
                                                    onChange={(event) =>
                                                        setStatusChangeDateEditValue(
                                                            event.target
                                                                .value,
                                                        )
                                                    }
                                                    className={`mt-0.5 ${selectClass}`}
                                                />
                                            </div>

                                            <div className='flex-1 min-w-[12rem]'>
                                                <label className='text-[0.65rem] font-medium text-muted-foreground'>
                                                    Raison (optionnel)
                                                </label>
                                                <input
                                                    type='text'
                                                    value={
                                                        statusChangeDateEditReason
                                                    }
                                                    maxLength={500}
                                                    onChange={(event) =>
                                                        setStatusChangeDateEditReason(
                                                            event.target
                                                                .value,
                                                        )
                                                    }
                                                    className={`mt-0.5 ${selectClass}`}
                                                />
                                            </div>
                                        </div>

                                        {statusChangeDateEditError && (
                                            <p className='rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive'>
                                                {
                                                    statusChangeDateEditError
                                                }
                                            </p>
                                        )}

                                        <div className='flex justify-end gap-2'>
                                            <button
                                                type='button'
                                                onClick={() => {
                                                    setStatusChangeDateEditFor(
                                                        null,
                                                    );
                                                    setStatusChangeDateEditValue(
                                                        '',
                                                    );
                                                    setStatusChangeDateEditReason(
                                                        '',
                                                    );
                                                    setStatusChangeDateEditError(
                                                        null,
                                                    );
                                                }}
                                                disabled={
                                                    statusChangeDateEditBusy
                                                }
                                                className='cursor-pointer rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50'
                                            >
                                                Annuler
                                            </button>
                                            <button
                                                type='button'
                                                onClick={() =>
                                                    void handleChangeStatusChangeDate(
                                                        h.id,
                                                    )
                                                }
                                                disabled={
                                                    statusChangeDateEditBusy
                                                }
                                                className='cursor-pointer rounded bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-black hover:bg-emerald-500 disabled:opacity-50'
                                            >
                                                {statusChangeDateEditBusy
                                                    ? 'Enregistrement...'
                                                    : 'Enregistrer'}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {h.note && (
                                    <p className='rounded border border-[#00A8FF]/25 bg-[#00A8FF]/5 px-2 py-1 text-xs italic text-[#7DD3FC]'>
                                        « {h.note} »
                                    </p>
                                )}

                                <div className='space-y-1'>
                                    {h.pairs.map((pair) => (
                                        <div
                                            key={pair.slotIndex}
                                            className='grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded border border-border/50 bg-background px-2 py-1 text-xs'
                                        >
                                            <span className='min-w-0 truncate text-foreground'>
                                                {
                                                    pair.statusASide
                                                        .firstName
                                                }{' '}
                                                {pair.statusASide.lastName}{' '}
                                                (
                                                {
                                                    pair.statusASide
                                                        .position
                                                }
                                                ) ·{' '}
                                                {
                                                    pair.statusASide
                                                        .previousStatusName
                                                }{' '}
                                                →{' '}
                                                {
                                                    pair.statusASide
                                                        .newStatusName
                                                }
                                            </span>
                                            <span
                                                aria-hidden='true'
                                                className='shrink-0 text-[#7DD3FC]'
                                            >
                                                ⇄
                                            </span>
                                            <span className='min-w-0 truncate text-right text-foreground'>
                                                {
                                                    pair.statusBSide
                                                        .firstName
                                                }{' '}
                                                {pair.statusBSide.lastName}{' '}
                                                (
                                                {
                                                    pair.statusBSide
                                                        .position
                                                }
                                                ) ·{' '}
                                                {
                                                    pair.statusBSide
                                                        .previousStatusName
                                                }{' '}
                                                →{' '}
                                                {
                                                    pair.statusBSide
                                                        .newStatusName
                                                }
                                            </span>
                                        </div>
                                    ))}
                                </div>

                                {h.dateChanges.length > 0 && (
                                    <div className='rounded border border-[#FFC72C]/30 bg-[#FFC72C]/5 p-2'>
                                        <p className='text-[0.65rem] font-semibold uppercase tracking-wider text-[#FFC72C]'>
                                            Historique des changements
                                            de date
                                        </p>
                                        <ul className='mt-1 space-y-0.5 text-xs'>
                                            {h.dateChanges.map((dc) => (
                                                <li
                                                    key={dc.id}
                                                    className='text-foreground'
                                                >
                                                    <span className='font-mono'>
                                                        {dc.previousEffectiveAt.slice(
                                                            0,
                                                            10,
                                                        )}
                                                    </span>
                                                    {' → '}
                                                    <span className='font-mono font-semibold'>
                                                        {dc.newEffectiveAt.slice(
                                                            0,
                                                            10,
                                                        )}
                                                    </span>
                                                    <span className='ml-2 text-muted-foreground'>
                                                        (
                                                        {new Date(
                                                            dc.changedAt,
                                                        ).toLocaleString(
                                                            'fr-CA',
                                                        )}
                                                        )
                                                    </span>
                                                    {dc.reason && (
                                                        <span className='ml-2 italic text-muted-foreground'>
                                                            «{' '}
                                                            {dc.reason}{' '}
                                                            »
                                                        </span>
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                <p className='text-[0.65rem] text-muted-foreground'>
                                    Confirmé le{' '}
                                    {new Date(
                                        h.confirmedAt,
                                    ).toLocaleString('fr-CA')}
                                </p>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Preview popup for status change */}
            {statusChangePreviewOpen && statusChangePreview !== null && (
                <div
                    className='fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4'
                    onClick={() => setStatusChangePreviewOpen(false)}
                    role='dialog'
                    aria-modal='true'
                >
                    <div
                        className='flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[#22C55E]/50 bg-[#0F1626] shadow-[0_0_20px_rgba(34,197,94,0.35),0_8px_24px_rgba(0,0,0,0.6)]'
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className='flex items-center justify-between border-b border-[#22C55E]/20 px-3 py-2'>
                            <h3 className='text-sm font-bold uppercase tracking-wider text-white'>
                                Confirmer le changement de statut
                            </h3>
                            <button
                                type='button'
                                onClick={() =>
                                    setStatusChangePreviewOpen(false)
                                }
                                className='cursor-pointer rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-black hover:bg-red-500'
                            >
                                Fermer
                            </button>
                        </div>

                        <div className='flex-1 space-y-3 overflow-y-auto px-3 py-3'>
                            <p className='text-sm text-foreground'>
                                <span className='font-semibold'>
                                    Équipe :
                                </span>{' '}
                                {statusChangePreview.fantasyTeamName}
                            </p>

                            <p className='text-sm text-foreground'>
                                <span className='font-semibold'>
                                    Swap :
                                </span>{' '}
                                {statusChangePreview.statusAName}{' '}
                                ⇄{' '}
                                {statusChangePreview.statusBName}
                            </p>

                            <p className='text-sm text-foreground'>
                                <span className='font-semibold'>
                                    Date d'entrée en vigueur :
                                </span>{' '}
                                {statusChangePreview.effectiveAt.slice(
                                    0,
                                    10,
                                )}
                            </p>

                            {statusChangePreview.note && (
                                <p className='rounded border border-[#00A8FF]/25 bg-[#00A8FF]/5 px-2 py-1 text-xs italic text-[#7DD3FC]'>
                                    « {statusChangePreview.note} »
                                </p>
                            )}

                            <div className='space-y-1'>
                                {statusChangePreview.pairs.map(
                                    (pair) => (
                                        <div
                                            key={pair.slotIndex}
                                            className='grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded border border-border/50 bg-background px-2 py-1 text-xs'
                                        >
                                            <span className='min-w-0 truncate text-foreground'>
                                                {
                                                    pair.statusASide
                                                        .firstName
                                                }{' '}
                                                {pair.statusASide.lastName}{' '}
                                                (
                                                {
                                                    pair.statusASide
                                                        .position
                                                }
                                                ) ·{' '}
                                                {
                                                    pair.statusASide
                                                        .previousStatusName
                                                }{' '}
                                                →{' '}
                                                {
                                                    pair.statusASide
                                                        .newStatusName
                                                }
                                            </span>
                                            <span
                                                aria-hidden='true'
                                                className='shrink-0 text-[#7DD3FC]'
                                            >
                                                ⇄
                                            </span>
                                            <span className='min-w-0 truncate text-right text-foreground'>
                                                {
                                                    pair.statusBSide
                                                        .firstName
                                                }{' '}
                                                {pair.statusBSide.lastName}{' '}
                                                (
                                                {
                                                    pair.statusBSide
                                                        .position
                                                }
                                                ) ·{' '}
                                                {
                                                    pair.statusBSide
                                                        .previousStatusName
                                                }{' '}
                                                →{' '}
                                                {
                                                    pair.statusBSide
                                                        .newStatusName
                                                }
                                            </span>
                                        </div>
                                    ),
                                )}
                            </div>

                            {statusChangeError && (
                                <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                                    {statusChangeError}
                                </p>
                            )}
                        </div>

                        <div className='flex justify-end gap-2 border-t border-[#22C55E]/20 px-3 py-2'>
                            <button
                                type='button'
                                onClick={() =>
                                    setStatusChangePreviewOpen(false)
                                }
                                disabled={statusChangeSubmitting}
                                className='cursor-pointer rounded border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary disabled:opacity-50'
                            >
                                Annuler
                            </button>
                            <button
                                type='button'
                                onClick={() => void confirmStatusChange()}
                                disabled={statusChangeSubmitting}
                                className='cursor-pointer rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-black hover:bg-emerald-500 disabled:opacity-50'
                            >
                                {statusChangeSubmitting
                                    ? 'Enregistrement...'
                                    : 'Confirmer'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Revert status change confirmation popup */}
            {statusChangeRevertFor !== null && (
                <div
                    className='fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4'
                    onClick={() => {
                        if (statusChangeRevertBusy) return;
                        setStatusChangeRevertFor(null);
                        setStatusChangeRevertConfirmInput('');
                        setStatusChangeRevertError(null);
                    }}
                    role='dialog'
                    aria-modal='true'
                >
                    <div
                        className='flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-destructive/60 bg-[#0F1626] shadow-[0_0_20px_rgba(220,38,38,0.5),0_8px_24px_rgba(0,0,0,0.6)]'
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className='flex items-center justify-between border-b border-destructive/40 px-3 py-2'>
                            <h3 className='text-sm font-bold uppercase tracking-wider text-destructive'>
                                Revertir le changement #{statusChangeRevertFor}
                            </h3>
                            <button
                                type='button'
                                onClick={() => {
                                    if (statusChangeRevertBusy) return;
                                    setStatusChangeRevertFor(null);
                                    setStatusChangeRevertConfirmInput('');
                                    setStatusChangeRevertError(null);
                                }}
                                disabled={statusChangeRevertBusy}
                                className='cursor-pointer rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-black hover:bg-red-500 disabled:opacity-50'
                            >
                                Fermer
                            </button>
                        </div>

                        <div className='flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm text-foreground'>
                            <p className='font-semibold text-destructive'>
                                Cette action est irréversible.
                            </p>

                            <p>Revertir ce changement va :</p>

                            <ul className='ml-4 list-disc space-y-1 text-xs'>
                                <li>
                                    Remettre chaque joueur à son statut
                                    d'origine.
                                </li>
                                <li>
                                    Supprimer définitivement toutes les
                                    lignes d'historique de statut créées
                                    par ce changement.
                                </li>
                                <li>
                                    Supprimer définitivement ce
                                    changement de cette liste.
                                </li>
                                <li>
                                    Recalculer les totaux de la saison
                                    comme si ce changement n'avait
                                    jamais eu lieu.
                                </li>
                            </ul>

                            <p className='text-xs'>
                                Pour confirmer, tapez le numéro (
                                {statusChangeRevertFor}) ci-dessous.
                            </p>

                            <input
                                type='text'
                                value={statusChangeRevertConfirmInput}
                                onChange={(event) =>
                                    setStatusChangeRevertConfirmInput(
                                        event.target.value,
                                    )
                                }
                                placeholder={String(
                                    statusChangeRevertFor,
                                )}
                                disabled={statusChangeRevertBusy}
                                className={`${selectClass} text-center font-mono`}
                            />

                            {statusChangeRevertError && (
                                <p className='rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive'>
                                    {statusChangeRevertError}
                                </p>
                            )}
                        </div>

                        <div className='flex justify-end gap-2 border-t border-destructive/40 px-3 py-2'>
                            <button
                                type='button'
                                onClick={() => {
                                    if (statusChangeRevertBusy) return;
                                    setStatusChangeRevertFor(null);
                                    setStatusChangeRevertConfirmInput('');
                                    setStatusChangeRevertError(null);
                                }}
                                disabled={statusChangeRevertBusy}
                                className='cursor-pointer rounded border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary disabled:opacity-50'
                            >
                                Annuler
                            </button>
                            <button
                                type='button'
                                onClick={() =>
                                    void handleRevertStatusChange(
                                        statusChangeRevertFor,
                                    )
                                }
                                disabled={
                                    statusChangeRevertBusy ||
                                    statusChangeRevertConfirmInput.trim() !==
                                    String(statusChangeRevertFor)
                                }
                                className='cursor-pointer rounded bg-destructive px-3 py-1.5 text-sm font-semibold text-destructive-foreground hover:brightness-110 disabled:opacity-50'
                            >
                                {statusChangeRevertBusy
                                    ? 'Revert en cours...'
                                    : 'Revertir'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ============================================================
                Transfert de choix de repêchage
                ============================================================ */}
            <div className='max-w-3xl space-y-3'>
                <h3 className='text-lg font-semibold text-foreground'>
                    Transfert de choix de repêchage
                </h3>

                <p className='text-sm text-muted-foreground'>
                    Transférez un choix de repêchage d'une équipe vers
                    une autre. Le propriétaire d'origine ne change
                    jamais ; seul le propriétaire actuel est mis à
                    jour.
                </p>

                {draftTransferError && (
                    <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                        {draftTransferError}
                    </p>
                )}

                {draftTransferSuccess && (
                    <p className='rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400'>
                        {draftTransferSuccess}
                    </p>
                )}

                <div className='space-y-2 rounded-lg border border-border bg-card p-3'>
                    <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                        Équipe source
                    </p>

                    <select
                        value={draftTransferFromTeamId}
                        onChange={(event) => {
                            setDraftTransferFromTeamId(event.target.value);
                            setDraftTransferPickId('');
                            setDraftTransferError(null);
                            setDraftTransferSuccess(null);

                            // If the destination was the same team,
                            // clear it so the form stays consistent.
                            if (
                                event.target.value ===
                                draftTransferToTeamId
                            ) {
                                setDraftTransferToTeamId('');
                            }
                        }}
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

                    {draftTransferFromTeamId !== '' && (
                        <>
                            {draftTransferPicksLoading && (
                                <p className='text-xs text-muted-foreground'>
                                    Chargement...
                                </p>
                            )}

                            {!draftTransferPicksLoading &&
                                draftTransferPicks.length === 0 && (
                                    <p className='text-xs text-muted-foreground'>
                                        Aucun choix pour cette équipe.
                                    </p>
                                )}

                            {!draftTransferPicksLoading &&
                                draftTransferPicks.length > 0 && (
                                    <select
                                        value={draftTransferPickId}
                                        onChange={(event) =>
                                            setDraftTransferPickId(
                                                event.target.value,
                                            )
                                        }
                                        className={selectClass}
                                    >
                                        <option value='' disabled>
                                            Choisir un choix
                                        </option>
                                    {draftTransferPicks.map((p) => (
                                        <option
                                            key={p.id}
                                            value={p.id}
                                        >
                                            {p.seasonName} · Ronde{' '}
                                            {p.round} · Choix{' '}
                                            {p.pickNumber}
                                            {` (de ${p.originalOwnerFantasyTeamName})`}
                                        </option>
                                    ))}
                                    </select>
                                )}
                        </>
                    )}
                </div>

                <div className='space-y-2 rounded-lg border border-border bg-card p-3'>
                    <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                        Équipe de destination
                    </p>

                    <select
                        value={draftTransferToTeamId}
                        onChange={(event) => {
                            setDraftTransferToTeamId(event.target.value);
                            setDraftTransferError(null);
                            setDraftTransferSuccess(null);
                        }}
                        className={selectClass}
                    >
                        <option value='' disabled>
                            Choisir une équipe
                        </option>
                        {teams
                            .filter(
                                (t) =>
                                    String(t.id) !==
                                    draftTransferFromTeamId,
                            )
                            .map((team) => (
                                <option key={team.id} value={team.id}>
                                    {team.name}
                                </option>
                            ))}
                    </select>

                    {draftTransferFromTeamId !== '' &&
                        draftTransferToTeamId === '' && (
                            <p className='text-xs text-muted-foreground'>
                                Choisissez une autre équipe que la source.
                            </p>
                        )}
                </div>

                <button
                    type='button'
                    onClick={() => void handleTransferDraftPick()}
                    disabled={
                        draftTransferBusy ||
                        draftTransferPickId === '' ||
                        draftTransferToTeamId === '' ||
                        draftTransferFromTeamId === draftTransferToTeamId
                    }
                    className={primaryButtonClass}
                >
                    {draftTransferBusy
                        ? 'Transfert...'
                        : 'Transférer le choix'}
                </button>
            </div>

            {/* ============================================================
                Audit des effectifs invalides
                ============================================================ */}
            <div className='max-w-4xl space-y-3'>
                <h3 className='text-lg font-semibold text-foreground'>
                    Audit des effectifs invalides
                </h3>

                <p className='text-sm text-muted-foreground'>
                    Scanne l'historique de la saison et affiche chaque
                    période pendant laquelle une équipe n'avait pas la
                    structure requise : 12F/6D/1G actifs, 4F/2D/1G sur
                    le banc, 3 prospects. Les dates sont celles de la
                    journée où le changement est devenu effectif.
                </p>

                {shapeViolationsError && (
                    <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                        {shapeViolationsError}
                    </p>
                )}

                <button
                    type='button'
                    onClick={() => void handleCheckShapeViolations()}
                    disabled={shapeViolationsLoading}
                    className={primaryButtonClass}
                >
                    {shapeViolationsLoading
                        ? 'Vérification...'
                        : 'Lancer la vérification'}
                </button>

                {shapeViolationsLoaded &&
                    !shapeViolationsLoading &&
                    shapeViolations.length === 0 && (
                        <p className='rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400'>
                            Aucun effectif invalide trouvé dans
                            l'historique de la saison.
                        </p>
                    )}

                {shapeViolations.map((v, idx) => {
                    const startDate = v.startEffectiveAt.slice(0, 10);
                    const endDate = v.endEffectiveAt
                        ? v.endEffectiveAt.slice(0, 10)
                        : null;
                    const isOngoing = endDate === null;

                    const activeFWrong =
                        v.activeForwards !== v.expectedActiveForwards;
                    const activeDWrong =
                        v.activeDefensemen !==
                        v.expectedActiveDefensemen;
                    const activeGWrong =
                        v.activeGoalies !== v.expectedActiveGoalies;
                    const benchFWrong =
                        v.benchForwards !== v.expectedBenchForwards;
                    const benchDWrong =
                        v.benchDefensemen !== v.expectedBenchDefensemen;
                    const benchGWrong =
                        v.benchGoalies !== v.expectedBenchGoalies;
                    const prospectsWrong =
                        v.prospects !== v.expectedProspects;

                    return (
                        <div
                            key={`${v.fantasyTeamId}-${v.startEffectiveAt}-${idx}`}
                            className='rounded-lg border border-border bg-card p-3'
                        >
                            <div className='flex flex-wrap items-baseline justify-between gap-2'>
                                <span className='text-sm font-semibold text-foreground'>
                                    {v.fantasyTeamName}
                                </span>
                                <span className='text-xs text-muted-foreground'>
                                    {startDate}
                                    {endDate
                                        ? ` → ${endDate}`
                                        : ' → en cours'}
                                </span>
                            </div>

                            <div className='mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs tabular-nums sm:grid-cols-4'>
                                <span className='text-muted-foreground'>
                                    Actifs
                                </span>
                                <span
                                    className={
                                        activeFWrong ||
                                            activeDWrong ||
                                            activeGWrong
                                            ? 'text-destructive font-semibold'
                                            : 'text-foreground'
                                    }
                                >
                                    {v.activeForwards}F /{' '}
                                    {v.activeDefensemen}D /{' '}
                                    {v.activeGoalies}G
                                </span>
                                <span className='text-muted-foreground'>
                                    Attendu
                                </span>
                                <span className='text-foreground'>
                                    {v.expectedActiveForwards}F /{' '}
                                    {v.expectedActiveDefensemen}D /{' '}
                                    {v.expectedActiveGoalies}G
                                </span>

                                <span className='text-muted-foreground'>
                                    Banc
                                </span>
                                <span
                                    className={
                                        benchFWrong ||
                                            benchDWrong ||
                                            benchGWrong
                                            ? 'text-destructive font-semibold'
                                            : 'text-foreground'
                                    }
                                >
                                    {v.benchForwards}F /{' '}
                                    {v.benchDefensemen}D /{' '}
                                    {v.benchGoalies}G
                                </span>
                                <span className='text-muted-foreground'>
                                    Attendu
                                </span>
                                <span className='text-foreground'>
                                    {v.expectedBenchForwards}F /{' '}
                                    {v.expectedBenchDefensemen}D /{' '}
                                    {v.expectedBenchGoalies}G
                                </span>

                                <span className='text-muted-foreground'>
                                    Prospects
                                </span>
                                <span
                                    className={
                                        prospectsWrong
                                            ? 'text-destructive font-semibold'
                                            : 'text-foreground'
                                    }
                                >
                                    {v.prospects}
                                </span>
                                <span className='text-muted-foreground'>
                                    Attendu
                                </span>
                                <span className='text-foreground'>
                                    {v.expectedProspects}
                                </span>
                            </div>

                            {isOngoing && (
                                <p className='mt-2 text-xs font-semibold text-destructive'>
                                    Cette structure est encore invalide
                                    aujourd'hui.
                                </p>
                            )}

                            {v.players.length > 0 && (
                                <details className='mt-2'>
                                    <summary className='cursor-pointer text-xs font-medium text-[#7DD3FC] hover:text-[#00E5FF]'>
                                        Voir les {v.players.length} joueur(s)
                                        au début de la période
                                    </summary>
                                    <ul className='mt-1 space-y-0.5 text-xs'>
                                        {v.players.map((p) => (
                                            <li
                                                key={p.playerId}
                                                className='flex items-center gap-2 text-foreground'
                                            >
                                                <span
                                                    className={
                                                        p.rosterStatus ===
                                                            'Active'
                                                            ? 'text-[#00F0FF]'
                                                            : p.rosterStatus ===
                                                                'Bench'
                                                                ? 'text-amber-400'
                                                                : 'text-muted-foreground'
                                                    }
                                                >
                                                    [{p.rosterStatus}]
                                                </span>
                                                <span>
                                                    {p.firstName}{' '}
                                                    {p.lastName}
                                                </span>
                                                <span className='text-muted-foreground'>
                                                    ({p.positionGroup})
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </details>
                            )}
                        </div>
                    );
                })}
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

                {capFreezeError && (
                    <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                        {capFreezeError}
                    </p>
                )}

                <button
                    type='button'
                    onClick={() => void handleStartCapFreezeContracts()}
                    disabled={
                        capFreezeStarting ||
                        capFreezeJob?.status === 'Running'
                    }
                    className={secondaryButtonClass}
                >
                    {capFreezeStarting
                        ? 'Démarrage...'
                        : capFreezeJob?.status === 'Running'
                            ? 'En cours...'
                            : 'Rafraîchir les contrats (CapFreeze)'}
                </button>

                <p className='text-xs text-muted-foreground'>
                    Met à jour les contrats, les années et les statuts de tous
                    les joueurs depuis CapFreeze. Ignore les joueurs en
                    contrats manuels.
                </p>

                {capFreezeJob && (
                    <div className='rounded-lg border border-border bg-card px-3 py-2 text-sm'>
                        <p className='text-foreground'>
                            <span className='font-semibold'>Statut :</span>{' '}
                            {capFreezeJob.status}
                        </p>

                        {capFreezeJob.message && (
                            <p className='text-muted-foreground'>
                                {capFreezeJob.message}
                            </p>
                        )}

                        {capFreezeJob.error && (
                            <p className='text-destructive'>
                                {capFreezeJob.error}
                            </p>
                        )}

                        {capFreezeJob.status === 'Completed' && (
                            <p className='text-emerald-400'>Terminé.</p>
                        )}
                    </div>
                )}

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

            {/* ============================================================
                Sauvegardes de la base de données
                ============================================================ */}
            <div className='max-w-2xl space-y-3'>
                <h3 className='text-lg font-semibold text-foreground'>
                    Sauvegardes de la base de données
                </h3>

                <p className='text-sm text-muted-foreground'>
                    Téléchargez une copie complète de la base de données
                    au format <span className='font-mono'>pg_dump</span>{' '}
                    (binaire compressé) pour la conserver sur votre PC.
                    Conservez cette copie hors du serveur pour vous
                    protéger contre une perte du VPS. Pour restaurer,
                    utilisez{' '}
                    <span className='font-mono'>
                        pg_restore --clean --if-exists
                    </span>.
                </p>

                {backupsError && (
                    <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
                        {backupsError}
                    </p>
                )}

                {backupsSuccess && (
                    <p className='rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400'>
                        {backupsSuccess}
                    </p>
                )}

                <button
                    type='button'
                    onClick={() => void handleCreateAndDownloadBackup()}
                    disabled={backupsTriggering}
                    className={primaryButtonClass}
                >
                    {backupsTriggering
                        ? 'Sauvegarde en cours...'
                        : 'Créer et télécharger une sauvegarde fraîche'}
                </button>

                {backupsTriggering && (
                    <p className='text-xs text-muted-foreground'>
                        L'opération prend généralement de 30 à 60 secondes.
                        Ne fermez pas cette page.
                    </p>
                )}

                {backupsLoading && backups.length === 0 && (
                    <p className='text-sm text-muted-foreground'>
                        Chargement...
                    </p>
                )}

                {!backupsLoading && backups.length === 0 && !backupsError && (
                    <p className='text-sm text-muted-foreground'>
                        Aucune sauvegarde pour le moment.
                    </p>
                )}

                {backups.length > 0 && (
                    <ul className='space-y-2'>
                        {backups.map((b) => {
                            const sizeMb = b.sizeBytes / (1024 * 1024);

                            const createdAt = new Date(
                                b.createdAtUtc,
                            ).toLocaleString('fr-CA', {
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                            });

                            return (
                                <li
                                    key={b.filename}
                                    className='flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm'
                                >
                                    <div className='min-w-0 flex-1'>
                                        <p className='truncate font-mono text-xs text-foreground'>
                                            {b.filename}
                                        </p>
                                        <p className='mt-0.5 text-xs text-muted-foreground'>
                                            {sizeMb.toFixed(2)} Mo ·{' '}
                                            {createdAt}
                                        </p>
                                    </div>

                                    <a
                                        href={downloadBackupUrl(b.filename)}
                                        className='shrink-0 cursor-pointer rounded border border-border px-3 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-secondary'
                                    >
                                        Télécharger
                                    </a>
                                </li>
                            );
                        })}
                    </ul>
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
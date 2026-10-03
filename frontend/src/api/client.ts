// One small place that knows how to talk to our API.
// '/api' is a RELATIVE url: the Vite dev proxy (vite.config.ts) forwards it to
// the ASP.NET backend, so the browser never triggers a CORS check.
const API_BASE = '/api';

/**
 * Every fetch sends cookies (credentials: 'include'). The auth cookie
 * is HttpOnly and set by the server on login; the browser stores it
 * and returns it on every request. Because the Vite proxy makes the
 * API same-origin as the SPA, no CORS preflight is needed.
 */
const FETCH_CREDENTIALS: RequestCredentials = 'include';

/**
 * Shared 401 handler. When any API call returns 401, we clear the
 * cached auth user and let the caller deal with the error. The
 * AuthProvider also subscribes so it can drop its cached user.
 */
type UnauthorizedHandler = () => void;
const unauthorizedHandlers = new Set<UnauthorizedHandler>();

export function onUnauthorized(handler: UnauthorizedHandler): () => void {
    unauthorizedHandlers.add(handler);
    return () => {
        unauthorizedHandlers.delete(handler);
    };
}

function notifyUnauthorized() {
    unauthorizedHandlers.forEach((handler) => {
        try {
            handler();
        } catch {
            // Ignore handler errors.
        }
    });
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
    try {
        const payload = (await response.json()) as {
            message?: string;
            detail?: string;
        };
        return payload.message ?? payload.detail ?? fallback;
    } catch {
        return fallback;
    }
}

async function apiGet<T>(path: string): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
        credentials: FETCH_CREDENTIALS,
    });

    if (response.status === 401) {
        notifyUnauthorized();
        throw new Error(await readErrorMessage(response, 'Non authentifié.'));
    }

    if (!response.ok) {
        throw new Error(
            await readErrorMessage(
                response,
                `Erreur API ${response.status} sur ${path}`,
            ),
        );
    }

    return (await response.json()) as T;
}

/**
 * Like apiGet, but for POST requests: sends JSON and unwraps the JSON reply.
 * On failure it prefers the API's own message so the UI can display it.
 */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: FETCH_CREDENTIALS,
        body: JSON.stringify(body),
    });

    if (response.status === 401) {
        notifyUnauthorized();
        throw new Error(await readErrorMessage(response, 'Non authentifié.'));
    }

    if (!response.ok) {
        throw new Error(
            await readErrorMessage(response, `Erreur API ${response.status}`),
        );
    }

    return (await response.json()) as T;
}

/**
 * Like apiPost, but for PATCH: sends JSON, expects JSON back.
 */
export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: FETCH_CREDENTIALS,
        body: JSON.stringify(body),
    });

    if (response.status === 401) {
        notifyUnauthorized();
        throw new Error(await readErrorMessage(response, 'Non authentifié.'));
    }

    if (!response.ok) {
        throw new Error(
            await readErrorMessage(response, `Erreur API ${response.status}`),
        );
    }

    return (await response.json()) as T;
}

/**
 * Like apiGet, but for DELETE.
 */
export async function apiDelete<T>(path: string): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
        method: 'DELETE',
        credentials: FETCH_CREDENTIALS,
    });

    if (response.status === 401) {
        notifyUnauthorized();
        throw new Error(await readErrorMessage(response, 'Non authentifié.'));
    }

    if (!response.ok) {
        throw new Error(
            await readErrorMessage(response, `Erreur API ${response.status}`),
        );
    }

    return (await response.json()) as T;
}

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------

export type PlayerPageStyle = 'Neon' | 'Classic';

export interface AuthUser {
    id: number;
    userName: string;
    displayName: string;
    fantasyTeamId: number | null;
    fantasyTeamName: string | null;
    isCommissioner: boolean;
    playerPageStyle: PlayerPageStyle;
}

export interface LoginRequest {
    userName: string;
    password: string;
}

export interface RegisterRequest {
    userName: string;
    password: string;
    inviteCode: string;
    fantasyTeamId?: number | null;
}

export interface UnclaimedTeam {
    id: number;
    name: string;
}

export interface AdminUserRow {
    id: number;
    userName: string;
    displayName: string;
    fantasyTeamId: number | null;
    fantasyTeamName: string | null;
    isCommissioner: boolean;
    /** True when the user is in the protected list and can't be demoted. */
    isProtected: boolean;
    createdAt: string;
}

export const login = (request: LoginRequest) =>
    apiPost<AuthUser>('/Auth/login', request);

export const register = (request: RegisterRequest) =>
    apiPost<AuthUser>('/Auth/register', request);

export const logout = () =>
    apiPost<{ message: string }>('/Auth/logout', {});

export const getCurrentUser = () => apiGet<AuthUser>('/Auth/me');

export const getUnclaimedTeams = () =>
    apiGet<UnclaimedTeam[]>('/Auth/unclaimed-teams');

export const changePassword = (currentPassword: string, newPassword: string) =>
    apiPost<{ message: string }>('/Auth/change-password', {
        currentPassword,
        newPassword,
    });

export const setPlayerPageStyle = (style: PlayerPageStyle) =>
    apiPost<AuthUser>('/Auth/player-page-style', { style });

// ---------------------------------------------------------------------
// Users (commissioner only)
// ---------------------------------------------------------------------

export const getUsers = () => apiGet<AdminUserRow[]>('/Users');

export const promoteUser = (id: number) =>
    apiPost<{ message: string }>(`/Users/${id}/promote`, {});

export const demoteUser = (id: number) =>
    apiPost<{ message: string }>(`/Users/${id}/demote`, {});

export const resetUserPassword = (id: number, newPassword: string) =>
    apiPost<{ message: string }>(`/Users/${id}/reset-password`, {
        newPassword,
    });

export const assignUserTeam = (id: number, fantasyTeamId: number) =>
    apiPost<{ message: string }>(`/Users/${id}/assign-team`, {
        fantasyTeamId,
    });

export const unassignUserTeam = (id: number) =>
    apiPost<{ message: string }>(`/Users/${id}/unassign-team`, {});

// ---------------------------------------------------------------------
// League
// ---------------------------------------------------------------------

export interface League {
    id: number;
    name: string;
    maximumRosterSize: number;
}

export interface FantasyTeam {
    id: number;
    name: string;
    leagueId: number;
}

export const getLeague = () => apiGet<League>('/League');
export const getLeagueTeams = () => apiGet<FantasyTeam[]>('/League/teams');

// ---------------------------------------------------------------------
// Roster types
// ---------------------------------------------------------------------

/** One NHL season of statistics shown on a player card. */
export interface SeasonStatLine {
    label: string;
    nhlSeasonCode: number;
    leagueAbbreviation: string;
    teamName: string | null;
    gameTypeId: number;
    gamesPlayed: number;
    goals: number;
    assists: number;
    points: number;
    wins: number;
    losses: number;
    overtimeLosses: number;
    /** Hat tricks recorded this season (skaters). */
    hatTricks: number;
    /** Shutouts recorded this season (goalies). */
    shutouts: number;
    /** Total fantasy points scored this season. */
    fantasyPoints: number;
}

/** One contract line on a player card: salary + seasons left. */
export interface PlayerContractLine {
    salary: number;
    yearsRemaining: number;
    startSeason: number;
    endSeason: number;
}

/** Committed cap hit for one future season. */
export interface SeasonCap {
    nhlSeasonCode: number;
    label: string;
    capSalary: number;
    salaryCap: number;
    signedPlayers: number;
}

/** One player on a fantasy team's roster (GET /api/Roster/team/{id}). */
export interface RosterEntry {
    id: number;
    fantasyTeamId: number;
    playerId: number;
    nhlPlayerId: number;
    firstName: string;
    lastName: string;
    position: string;
    nhlTeamAbbreviation: string;
    rosterStatus: string;
    rosterSlot: number;
    fantasySalary: number;
    headshotUrl: string | null;
    twoSeasonsAgo: SeasonStatLine | null;
    lastSeason: SeasonStatLine | null;
    currentSeason: SeasonStatLine | null;
    currentContract: PlayerContractLine | null;
    secondContract: PlayerContractLine | null;

    /** "NhlRoster" | "AhlRoster" | "Injured" | "NotOnActiveRoster" | null */
    rosterLocation: string | null;

    /** FP yesterday; null = didn't play, 0 = played, no points. */
    yesterdayFantasyPoints: number | null;

    /** FP today; null = hasn't played yet, 0 = played, no points. */
    todayFantasyPoints: number | null;

    isInjured: boolean;
    injuryStatus: string | null;
    injuryKind: 'None' | 'Injury' | 'Suspension';
    injuryShortDescription: string | null;
    injuryLongDescription: string | null;
    injuryType: string | null;
    injuryDetail: string | null;
    injurySide: string | null;
    injuryReturnDate: string | null;
    injuryFantasyStatus: string | null;
}

/** Full roster of one fantasy team for one season. */
export interface TeamRoster {
    fantasyTeamId: number;
    fantasyTeamName: string;
    seasonId: number;
    seasonName: string;
    leagueMaximumRosterSize: number;
    leagueProspectCount: number;
    totalPlayers: number;
    activeCount: number;
    benchCount: number;
    prospectCount: number;
    totalSalary: number;
    capSalary: number;
    futureCapBySeason: SeasonCap[];
    entries: RosterEntry[];
}

/** Fetches the full roster (with totals and stat lines) of one fantasy team. */
export const getTeamRoster = (fantasyTeamId: number) =>
    apiGet<TeamRoster>(`/Roster/team/${fantasyTeamId}`);

/** One player row returned by the roster search (GET /api/Roster/search). */
export interface PlayerSearchResult {
    playerId: number;
    nhlPlayerId: number;
    firstName: string;
    lastName: string;
    position: string;
    nhlTeamAbbreviation: string;
    fantasyTeamId?: number | null;
    fantasyTeamName?: string | null;
    rosterEntryId?: number | null;
    rosterStatus?: string | null;
    isInjured?: boolean;
    injuryStatus?: string | null;
    injuryKind?: 'None' | 'Injury' | 'Suspension';
    injuryShortDescription?: string | null;
    injuryLongDescription?: string | null;
    injuryType?: string | null;
    injuryDetail?: string | null;
    injurySide?: string | null;
    injuryReturnDate?: string | null;
    injuryFantasyStatus?: string | null;
}

/** Request body of POST /api/Roster/assign. */
export interface AssignPlayerRequest {
    fantasyTeamId: number;
    playerId: number;
    rosterStatus: string;
}

/** Result of a roster write endpoint: success flag + readable message. */
export interface RosterActionResult {
    success: boolean;
    message: string;
    entry?: unknown;
}

/** Searches players by name; the endpoint is a GET even though it is a search. */
export function searchPlayers(query: string): Promise<PlayerSearchResult[]> {
    return apiGet<PlayerSearchResult[]>(
        `/Roster/search?search=${encodeURIComponent(query)}`,
    );
}

/** Assigns a player to a fantasy team; rosterStatus must be 'Active', 'Bench' or 'Prospect'. */
export function assignPlayer(request: AssignPlayerRequest): Promise<RosterActionResult> {
    return apiPost<RosterActionResult>('/Roster/assign', request);
}

/** Request body of POST /api/Roster/move. */
export interface MovePlayerRequest {
    playerId: number;
    newFantasyTeamId: number;
    effectiveAt: string;
    note?: string;
}

/** Request body of POST /api/Roster/update (team + status can change together). */
export interface UpdateRosterEntryRequest {
    rosterEntryId: number;
    rosterStatus: string;
    fantasyTeamId?: number;
    effectiveAt?: string;
    note?: string;
}

/** Request body of POST /api/Roster/release. */
export interface ReleasePlayerRequest {
    rosterEntryId: number;
}

/** Transfers a player to another fantasy team (POST /api/Roster/move). */
export const movePlayer = (request: MovePlayerRequest) =>
    apiPost<RosterActionResult>('/Roster/move', request);

/** Changes the roster status of an entry (POST /api/Roster/update). */
export const updateRosterEntry = (request: UpdateRosterEntryRequest) =>
    apiPost<RosterActionResult>('/Roster/update', request);

/** Removes a roster entry, making the player a free agent again (POST /api/Roster/release). */
export const releasePlayer = (request: ReleasePlayerRequest) =>
    apiPost<RosterActionResult>('/Roster/release', request);

// ---------------------------------------------------------------------
// Roster swaps / status history
// ---------------------------------------------------------------------

export interface SwapRosterStatusRequest {
    fantasyTeamId: number;
    playerAId: number;
    playerBId: number;
    seasonId?: number;
    effectiveAt: string;
    note?: string;
}

export interface SetRosterStatusRequest {
    fantasyTeamId: number;
    playerId: number;
    newRosterStatus: string;
    seasonId?: number;
    effectiveAt: string;
    note?: string;
}

export interface BackfillStatusHistoryRequest {
    seasonId?: number;
    effectiveAt: string;
}

export interface RosterStatusHistoryRow {
    id: number;
    playerId: number;
    playerFirstName: string;
    playerLastName: string;
    fantasyTeamId: number;
    fantasyTeamName: string;
    seasonId: number;
    rosterStatus: string;
    effectiveAt: string;
    createdAt: string;
    note: string | null;
}

export interface UpdateRosterStatusHistoryRequest {
    effectiveAt: string;
    note?: string;
}

export function swapRosterStatus(
    request: SwapRosterStatusRequest,
): Promise<RosterActionResult> {
    return apiPost<RosterActionResult>('/Roster/swap-status', request);
}

export function setRosterStatus(
    request: SetRosterStatusRequest,
): Promise<RosterActionResult> {
    return apiPost<RosterActionResult>('/Roster/set-status', request);
}

export function getRosterStatusHistory(
    playerId: number,
    seasonId?: number,
): Promise<RosterStatusHistoryRow[]> {
    const query = seasonId != null ? `?seasonId=${seasonId}` : '';
    return apiGet<RosterStatusHistoryRow[]>(
        `/Roster/status-history/${playerId}${query}`,
    );
}

export function backfillStatusHistory(
    request: BackfillStatusHistoryRequest,
): Promise<RosterActionResult> {
    return apiPost<RosterActionResult>(
        '/Roster/backfill-status-history',
        request,
    );
}

export function updateStatusHistory(
    id: number,
    request: UpdateRosterStatusHistoryRequest,
): Promise<RosterActionResult> {
    return apiPatch<RosterActionResult>(
        `/Roster/status-history/${id}`,
        request,
    );
}

export function deleteStatusHistory(id: number): Promise<RosterActionResult> {
    return apiDelete<RosterActionResult>(`/Roster/status-history/${id}`);
}

export function recomputeTeamTotals(seasonCode: number): Promise<unknown> {
    return apiPost<unknown>(
        `/NhlGameLog/season/${seasonCode}/recompute-team-totals`,
        {},
    );
}

// ---------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------

export interface StandingsRow {
    rank: number;
    fantasyTeamId: number;
    fantasyTeamName: string;

    skaterGamesPlayed: number;
    skaterGoals: number;
    skaterAssists: number;
    skaterPoints: number;
    skaterHatTricks: number;

    goalieGamesPlayed: number;
    goalieWins: number;
    goalieLosses: number;
    goalieOvertimeLosses: number;
    goalieShutouts: number;
    goaliePoints: number;

    /** FP from games that started yesterday (UTC). */
    yesterdayFantasyPoints: number;

    /** FP from games that started today (UTC). */
    todayFantasyPoints: number;

    totalFantasyPoints: number;
    totalFantasyPointsComputedAt: string | null;
}

export function getStandings(seasonId?: number): Promise<StandingsRow[]> {
    const query = seasonId != null ? `?seasonId=${seasonId}` : '';
    return apiGet<StandingsRow[]>(`/Standings${query}`);
}

// ---------------------------------------------------------------------
// Player detail (GET /api/NhlPlayerDetail/{nhlPlayerId})
// ---------------------------------------------------------------------

export interface CareerRow {
    season: number;
    seasonLabel: string;
    leagueAbbreviation: string;
    teamName: string | null;
    gameTypeId: number;
    gamesPlayed: number;
    goals: number;
    assists: number;
    points: number;
    penaltyMinutes: number;
    plusMinus: number;

    powerPlayGoals: number;
    powerPlayPoints: number;
    shorthandedGoals: number;
    shorthandedPoints: number;
    gameWinningGoals: number;
    overtimeGoals: number;
    shots: number;
    shootingPercentage: number;
    averageTimeOnIce: string | null;
    faceoffWinningPercentage: number | null;

    wins: number;
    losses: number;
    overtimeLosses: number;
    shutouts: number;
    saves: number;
    shotsAgainst: number;
    savePercentage: number;
    goalsAgainst: number;
    goalsAgainstAverage: number;

    hatTricks: number | null;
}

export interface CurrentSeasonStats {
    gamesPlayed: number;
    goals: number;
    assists: number;
    points: number;
    hatTricks: number;
    fantasyPoints: number;
    wins: number;
    losses: number;
    overtimeLosses: number;
    shutouts: number;
}

export interface CareerTotals {
    gamesPlayed: number;
    goals: number;
    assists: number;
    points: number;
    penaltyMinutes: number;
    plusMinus: number;
    powerPlayPoints: number;
    shots: number;
    gameWinningGoals: number;

    playoffGamesPlayed: number;
    playoffGoals: number;
    playoffAssists: number;
    playoffPoints: number;
    playoffPenaltyMinutes: number;
    playoffPowerPlayPoints: number;
    playoffShots: number;
    playoffGameWinningGoals: number;

    wins: number;
    losses: number;
    overtimeLosses: number;
    shutouts: number;
    saves: number;
    shotsAgainst: number;
    goalsAgainst: number;

    savePercentage: number;

    playoffWins: number;
    playoffLosses: number;
    playoffOvertimeLosses: number;
    playoffShutouts: number;
}

export interface GameLogRow {
    nhlGameId: number;
    gameDate: string;
    opponentAbbreviation: string;
    isHomeGame: boolean;
    goals: number;
    assists: number;
    points: number;
    penaltyMinutes: number;
    plusMinus: number;
    shots: number;
    fantasyPoints: number;

    goalieWin: boolean;
    goalieOvertimeLoss: boolean;
    shutout: boolean;
    goalsAgainst: number;
    shotsAgainst: number;
    saves: number;
}

export interface Month {
    label: string;
    startDate: string;
    endDate: string;

    gamesPlayed: number;

    goals: number;
    assists: number;
    points: number;
    penaltyMinutes: number;
    plusMinus: number;
    shots: number;

    wins: number;
    losses: number;
    overtimeLosses: number;
    shutouts: number;
    saves: number;
    shotsAgainst: number;
    goalsAgainst: number;

    fantasyPoints: number;
}

export interface InjuryHistoryRow {
    injuryStatus: string;
    injuryDescription: string | null;
    teamAbbreviation: string;
    firstSeenAt: string;
    lastSeenAt: string;
    resolvedAt: string | null;
}

export interface PlayerContract {
    salary: number;
    startSeason: number;
    endSeason: number;
    yearsRemaining: number;
}

export interface PlayerDetail {
    playerId: number;
    nhlPlayerId: number;
    firstName: string;
    lastName: string;
    position: string;
    shootsCatches: string | null;
    headshotUrl: string | null;
    heroImageUrl: string | null;

    nhlTeamAbbreviation: string | null;
    nhlTeamName: string | null;
    nhlTeamLogoUrl: string | null;
    previousNhlTeamAbbreviation: string | null;
    previousNhlTeamName: string | null;
    status: string;

    /** "NhlRoster" | "AhlRoster" | "Injured" | "NotOnActiveRoster" | null */
    rosterLocation: string | null;
    rosterLocationUpdatedAt: string | null;

    birthDate: string | null;
    age: number | null;
    birthCity: string | null;
    birthCountry: string | null;

    heightInInches: number | null;
    heightInCentimeters: number | null;
    weightInPounds: number | null;
    weightInKilograms: number | null;

    draftYear: number | null;
    draftTeamAbbreviation: string | null;
    draftRound: number | null;
    draftPickInRound: number | null;
    draftOverallPick: number | null;

    isInjured: boolean;
    injuryStatus: string | null;
    injuryKind: 'None' | 'Injury' | 'Suspension';
    injuryShortDescription: string | null;
    injuryLongDescription: string | null;
    injuryType: string | null;
    injuryDetail: string | null;
    injurySide: string | null;
    injuryReturnDate: string | null;
    injuryFantasyStatus: string | null;
    injuryUpdatedAt: string | null;
    injuryHistory: InjuryHistoryRow[];

    contracts: PlayerContract[];
    currentCapHit: number | null;

    fantasyTeamId: number | null;
    fantasyTeamName: string | null;
    rosterStatus: string | null;
    rosterSlot: number | null;
    fantasySalary: number | null;
    seasonFantasyPoints: number | null;
    seasonHatTricks: number | null;
    currentSeasonStats: CurrentSeasonStats | null;
    lastSeasonStats: CurrentSeasonStats | null;

    regularSeason: CareerRow[];
    playoffs: CareerRow[];
    nhlTotals: CareerTotals;
    tournaments: CareerRow[];
    youthMinor: CareerRow[];

    recentGames: GameLogRow[];
    seasonMonths: Month[];
}

export const getPlayerDetail = (nhlPlayerId: number) =>
    apiGet<PlayerDetail>(`/NhlPlayerDetail/${nhlPlayerId}`);

// ---------------------------------------------------------------------
// External source health (commissioner only)
// ---------------------------------------------------------------------

export type ExternalSourceStatus = 'Healthy' | 'Degraded' | 'Broken';

export interface ExternalSourceHealthRow {
    sourceName: string;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    lastError: string | null;
    consecutiveFailures: number;
    status: ExternalSourceStatus;
}

export interface ExternalSourceHealthResponse {
    playerStatusEnabled: boolean;
    overallStatus: ExternalSourceStatus;
    sources: ExternalSourceHealthRow[];
}

export function getExternalSourceHealth(): Promise<ExternalSourceHealthResponse> {
    return apiGet<ExternalSourceHealthResponse>('/Health/external-sources');
}

// ---------------------------------------------------------------------
// Protected contracts (commissioner only view)
// ---------------------------------------------------------------------

export interface ProtectedContractLine {
    startSeason: number;
    endSeason: number;
    salary: number;
}

export interface ProtectedPlayerContract {
    nhlPlayerId: number;
    playerName: string;
    teamAbbreviation: string | null;
    contracts: ProtectedContractLine[];
    expiresAfterSeason: number;
    isActive: boolean;
}

export interface ProtectedContractsResponse {
    currentSeasonNhlCode: number;
    protectedContracts: ProtectedPlayerContract[];
}

export function getProtectedContracts(): Promise<ProtectedContractsResponse> {
    return apiGet<ProtectedContractsResponse>(
        '/CapFreezeContract/capfreeze/protected-contracts',
    );
}
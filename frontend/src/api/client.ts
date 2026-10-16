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

// ---------------------------------------------------------------------
// Response cache
//
// GET responses are cached in memory for a short window (default 30
// seconds). Repeat navigations to the same page return instantly
// instead of waiting for another round-trip to Render + Neon.
//
// In-flight requests are deduplicated: if two components ask for the
// same URL at the same time, only one network call fires.
//
// Any mutation (POST / PATCH / DELETE) clears the whole cache so the
// next GET sees fresh data.
// ---------------------------------------------------------------------

const DEFAULT_CACHE_TTL_MS = 30_000;

interface CacheEntry<T> {
    data: T;
    expiresAt: number;
}

const responseCache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

function readCache<T>(key: string): { hit: true; data: T } | { hit: false } {
    const entry = responseCache.get(key);
    if (!entry) return { hit: false };
    if (Date.now() > entry.expiresAt) {
        responseCache.delete(key);
        return { hit: false };
    }
    return { hit: true, data: entry.data as T };
}

function writeCache<T>(key: string, data: T, ttlMs: number): void {
    responseCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/**
 * Clears the whole response cache. Called on logout (so the next
 * session starts clean) and after every mutation (so a subsequent
 * GET refetches).
 */
export function clearApiCache(): void {
    responseCache.clear();
    inFlight.clear();
}

/**
 * Options for apiGet. Everything is optional; the defaults are fine
 * for most callers.
 */
interface ApiGetOptions {
    /** Cache TTL in ms. Pass 0 to bypass the cache entirely. */
    cacheTtlMs?: number;
}

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

async function apiGet<T>(path: string, options?: ApiGetOptions): Promise<T> {
    const ttl = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

    // Serve from cache if fresh.
    if (ttl > 0) {
        const cached = readCache<T>(path);
        if (cached.hit) {
            return cached.data;
        }

        // Deduplicate an in-flight request for the same URL.
        const existing = inFlight.get(path);
        if (existing) {
            return existing as Promise<T>;
        }
    }

    const promise = (async (): Promise<T> => {
        const response = await fetch(`${API_BASE}${path}`, {
            credentials: FETCH_CREDENTIALS,
        });

        if (response.status === 401) {
            clearApiCache();
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

        const data = (await response.json()) as T;

        if (ttl > 0) {
            writeCache(path, data, ttl);
        }

        return data;
    })();

    if (ttl > 0) {
        inFlight.set(path, promise);
        void promise.finally(() => inFlight.delete(path));
    }

    return promise;
}

/**
 * Like apiGet, but for POST requests: sends JSON and unwraps the JSON reply.
 * On failure it prefers the API's own message so the UI can display it.
 * Clears the GET cache on success so the next read refetches.
 */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: FETCH_CREDENTIALS,
        body: JSON.stringify(body),
    });

    if (response.status === 401) {
        clearApiCache();
        notifyUnauthorized();
        throw new Error(await readErrorMessage(response, 'Non authentifié.'));
    }

    if (!response.ok) {
        throw new Error(
            await readErrorMessage(response, `Erreur API ${response.status}`),
        );
    }

    clearApiCache();

    return (await response.json()) as T;
}

/**
 * Like apiPost, but for PUT: sends JSON, expects JSON back.
 * Clears the GET cache on success so the next read refetches.
 */
export async function apiPut<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: FETCH_CREDENTIALS,
        body: JSON.stringify(body),
    });

    if (response.status === 401) {
        clearApiCache();
        notifyUnauthorized();
        throw new Error(await readErrorMessage(response, 'Non authentifié.'));
    }

    if (!response.ok) {
        throw new Error(
            await readErrorMessage(response, `Erreur API ${response.status}`),
        );
    }

    clearApiCache();

    return (await response.json()) as T;
}

/**
 * Like apiPost, but for PATCH: sends JSON, expects JSON back.
 * Clears the GET cache on success so the next read refetches.
 */
export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: FETCH_CREDENTIALS,
        body: JSON.stringify(body),
    });

    if (response.status === 401) {
        clearApiCache();
        notifyUnauthorized();
        throw new Error(await readErrorMessage(response, 'Non authentifié.'));
    }

    if (!response.ok) {
        throw new Error(
            await readErrorMessage(response, `Erreur API ${response.status}`),
        );
    }

    clearApiCache();

    return (await response.json()) as T;
}

/**
 * Like apiGet, but for DELETE.
 * Clears the GET cache on success so the next read refetches.
 */
export async function apiDelete<T>(path: string): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
        method: 'DELETE',
        credentials: FETCH_CREDENTIALS,
    });

    if (response.status === 401) {
        clearApiCache();
        notifyUnauthorized();
        throw new Error(await readErrorMessage(response, 'Non authentifié.'));
    }

    if (!response.ok) {
        throw new Error(
            await readErrorMessage(response, `Erreur API ${response.status}`),
        );
    }

    clearApiCache();

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
    /** UTC instant of the last authenticated request, or null. */
    lastActiveAt: string | null;
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
    /**
     * Total fantasy points scored this season.
     *
     * Always from NHL stats: FP is only amassed in the NHL by
     * league rule. Null when this row is a non-NHL fallback (a
     * player with no NHL games this season whose stat columns come
     * from whatever league he actually plays in) or when no season
     * row exists at all. The UI renders null as "—".
     */
    fantasyPoints: number | null;
    /**
     * Average time on ice for the season, formatted "MM:SS", or
     * null when the archive does not carry it. Sourced on the
     * backend from PlayerCareerStat.AverageTimeOnIce.
     */
    timeOnIce: string | null;
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
    /** Player age in years, or null when unknown. */
    age: number | null;
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
    apiGet<TeamRoster>(`/Roster/team/${fantasyTeamId}`, {
        cacheTtlMs: 5_000,
    });

/** One row from GET /api/Roster/ownership. */
export interface PlayerOwnership {
    nhlPlayerId: number;
    fantasyTeamId: number;
    fantasyTeamName: string;
    rosterStatus: string;
}

/**
 * Returns which fantasy team currently owns each of the given NHL
 * players in the current season. Used by the Game Day page to
 * display the team name next to each player in an expanded
 * boxscore. Players not on any fantasy team are omitted.
 *
 * Cached client-side for 30 seconds: a single boxscore is opened
 * and closed repeatedly, and the ownership map is identical for
 * every call within a short window.
 */
export function getPlayerOwnership(
    nhlPlayerIds: number[],
): Promise<PlayerOwnership[]> {
    if (nhlPlayerIds.length === 0) return Promise.resolve([]);
    const params = new URLSearchParams();
    for (const id of nhlPlayerIds) {
        params.append('nhlPlayerIds', String(id));
    }
    return apiGet<PlayerOwnership[]>(
        `/Roster/ownership?${params.toString()}`,
        { cacheTtlMs: 30_000 },
    );
}

/** One row from GET /api/Roster/game-stats-for-date. */
export interface RosterPlayerGameStat {
    playerId: number;
    nhlPlayerId: number;
    gameId: number;
    goals: number;
    assists: number;
    points: number;
    plusMinus: number;
    /** "MM:SS" time on ice, or null when unknown. */
    timeOnIce: string | null;
    shots: number;
    fantasyPoints: number;
}

/**
 * Returns per-game stats for the fantasy team's players who dressed
 * on the given date (yyyy-MM-dd, ET). Reads from PlayerGameLog
 * server-side, so it never hits the NHL API.
 *
 * Used by ClassementPage's "Hier" table.
 */
export function getRosterGameStatsForDate(
    fantasyTeamId: number,
    date: string,
): Promise<RosterPlayerGameStat[]> {
    const params = new URLSearchParams();
    params.set('fantasyTeamId', String(fantasyTeamId));
    params.set('date', date);
    return apiGet<RosterPlayerGameStat[]>(
        `/Roster/game-stats-for-date?${params.toString()}`,
        { cacheTtlMs: 5 * 60_000 },
    );
}

// ---------------------------------------------------------------------
// Roster shape violations (commissioner audit)
//
// Retrospective scan of the season's RosterStatusHistory. Reports
// every continuous window during which a fantasy team's shape was
// not 12F/6D/1G active + 4F/2D/1G bench + 3 prospects.
//
// Instants are UTC at day precision (00:00:00), matching every
// other RosterStatusHistory row. Display them with .slice(0, 10)
// when you only want the calendar day, same convention the
// existing history table uses.
// ---------------------------------------------------------------------

export interface RosterShapeViolationPlayer {
    playerId: number;
    nhlPlayerId: number;
    firstName: string;
    lastName: string;
    position: string;
    /** "F", "D" or "G". */
    positionGroup: string;
    /** "Active", "Bench" or "Prospect". */
    rosterStatus: string;
}

export interface RosterShapeViolation {
    fantasyTeamId: number;
    fantasyTeamName: string;

    /** UTC instant the wrong shape first became effective. */
    startEffectiveAt: string;

    /** UTC instant the shape was fixed, or null when still wrong. */
    endEffectiveAt: string | null;

    // Actual counts during the window (snapshot at start).
    activeForwards: number;
    activeDefensemen: number;
    activeGoalies: number;
    benchForwards: number;
    benchDefensemen: number;
    benchGoalies: number;
    prospects: number;

    // Expected counts.
    expectedActiveForwards: number;
    expectedActiveDefensemen: number;
    expectedActiveGoalies: number;
    expectedBenchForwards: number;
    expectedBenchDefensemen: number;
    expectedBenchGoalies: number;
    expectedProspects: number;

    players: RosterShapeViolationPlayer[];
}

/**
 * Runs the retrospective shape audit for one season. Cached with
 * cacheTtlMs 0 so the admin always sees the current scan result;
 * the computation itself is fast (a few hundred ms on a full
 * season).
 */
export function getRosterShapeViolations(
    seasonId?: number,
): Promise<RosterShapeViolation[]> {
    const query = seasonId != null ? `?seasonId=${seasonId}` : '';
    return apiGet<RosterShapeViolation[]>(
        `/Roster/shape-violations${query}`,
        { cacheTtlMs: 0 },
    );
}

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

/**
 * Searches players by name; the endpoint is a GET even though it is a search.
 * Cached briefly (5s) to dedup rapid keystroke requests.
 */
export function searchPlayers(query: string): Promise<PlayerSearchResult[]> {
    return apiGet<PlayerSearchResult[]>(
        `/Roster/search?search=${encodeURIComponent(query)}`,
        { cacheTtlMs: 5_000 },
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
    /**
     * Display name of the season (e.g. "2026-2027"). Populated by the
     * cross-season endpoint; null on the per-season endpoint.
     */
    seasonName: string | null;
    rosterStatus: string;
    effectiveAt: string;
    createdAt: string;
    note: string | null;
}

export interface UpdateRosterStatusHistoryRequest {
    effectiveAt: string;
    /**
     * Optional. When provided, replaces the RosterStatus on the
     * specific history row identified by the route id. Does NOT
     * apply to sibling rows that share the same EffectiveAt, since
     * siblings can legitimately hold different statuses (a trade
     * that also changed status writes two rows with different
     * statuses at the same instant).
     *
     * Accepted values: "Active", "Bench", "Prospect", "Released".
     */
    rosterStatus?: string;
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

/**
 * Full movement history of one player across every season, newest
 * first. Each row carries the season name so a cross-season view
 * can label it.
 *
 * Commissioner-only. Cached with cacheTtlMs 0 so a just-made
 * movement shows up on the next visit to the section.
 */
export function getPlayerFullStatusHistory(
    playerId: number,
): Promise<RosterStatusHistoryRow[]> {
    return apiGet<RosterStatusHistoryRow[]>(
        `/Roster/status-history/${playerId}/all`,
        { cacheTtlMs: 0 },
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

    /**
     * FP credited to this team from games where the Active player
     * was a forward (or had an unclassifiable position). Sliced from
     * RosterStatusHistory at the moment of each game, so a player
     * who was Active on this team for part of the season and then
     * traded away keeps contributing to THIS team's forward total
     * for the games he played here.
     */
    forwardFantasyPoints: number;

    /**
     * FP credited to this team from games where the Active player
     * was a defenseman. Same history rule as forwardFantasyPoints.
     */
    defenseFantasyPoints: number;

    /**
     * FP credited to this team from games where the Active player
     * was a goalie. Same history rule as forwardFantasyPoints.
     */
    goalieFantasyPoints: number;

    /** FP from games that started yesterday (real ET calendar day). */
    yesterdayFantasyPoints: number;

    /** FP from games that started today (real ET calendar day). */
    todayFantasyPoints: number;

    totalFantasyPoints: number;
    totalFantasyPointsComputedAt: string | null;
}

export function getStandings(seasonId?: number): Promise<StandingsRow[]> {
    const query = seasonId != null ? `?seasonId=${seasonId}` : '';
    return apiGet<StandingsRow[]>(`/Standings${query}`, {
        cacheTtlMs: 5_000,
    });
}

// ---------------------------------------------------------------------
// Draft picks
//
// Read-only. Each pick is a single round pick in a single draft.
// A team with the full 5 picks for both 2027 and 2028 sees 10 rows.
// ---------------------------------------------------------------------

/**
 * One draft pick currently owned by a fantasy team.
 */
export interface DraftPick {
    id: number;
    draftId: number;

    /** Year of the draft, e.g. 2027. */
    draftYear: number;

    /** NHL season code the draft belongs to, e.g. 20272028. */
    nhlSeasonCode: number;

    /** Display name of the season, e.g. "2027-2028". */
    seasonName: string;

    /** Round number, 1-based. */
    round: number;

    /** Position within the round, 1-based. */
    pickNumber: number;

    originalOwnerFantasyTeamId: number;
    originalOwnerFantasyTeamName: string;

    currentOwnerFantasyTeamId: number;

    /**
     * True when the pick has never been traded away from its original
     * owner. When false, the card shows where it came from.
     */
    isOriginallyOwned: boolean;
}

/**
 * Returns every draft pick currently owned by the given fantasy team.
 *
 * Cached client-side for 60 seconds so toggling between Lineup /
 * Masse salariale / Repêchage does not refetch on every switch. The
 * data only changes when the commissioner seeds new picks or trades
 * them.
 */
export function getTeamDraftPicks(
    fantasyTeamId: number,
): Promise<DraftPick[]> {
    return apiGet<DraftPick[]>(
        `/DraftPick/team/${fantasyTeamId}`,
        { cacheTtlMs: 60_000 },
    );
}

/**
 * Transfers one draft pick from its current owner to another team.
 * Commissioner-only.
 *
 * Only the pick's CurrentOwnerFantasyTeamId is rewritten; its
 * OriginalOwnerFantasyTeamId is left alone.
 *
 * The POST goes through apiPost, which clears the client-side GET
 * cache on success, so the next getTeamDraftPicks call for either
 * team refetches.
 */
export function transferDraftPick(
    pickId: number,
    newOwnerFantasyTeamId: number,
): Promise<{ message: string }> {
    return apiPost<{ message: string }>(
        '/DraftPick/transfer',
        { pickId, newOwnerFantasyTeamId },
    );
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
    /** Time on ice in this game, formatted "MM:SS", or null. */
    timeOnIce: string | null;
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
    // Skip cache: this is a live health check.
    return apiGet<ExternalSourceHealthResponse>(
        '/Health/external-sources',
        { cacheTtlMs: 0 },
    );
}

// (Protected contracts section removed — replaced by the
//  per-contract protected salaries below.)

// ---------------------------------------------------------------------
// Protected salaries (commissioner only)
//
// Per-contract salary locks. Used for contracts with salary
// retention: CapFreeze shows the post-retention amount, but the
// fantasy league wants the player's full contract value.
//
// The protection is stored on the PlayerContract row itself and
// disappears automatically when CapFreeze removes that row as
// stale (i.e. when the contract ends and a new one is signed).
// ---------------------------------------------------------------------

/** One contract row of a specific player, with its protection state. */
export interface PlayerContractRow {
    playerContractId: number;
    startSeason: number;
    endSeason: number;
    salary: number;
    protectedSalary: number | null;
    protectionNote: string | null;
}

/** A protected contract, joined with the player's identity. */
export interface ProtectedSalaryRow {
    playerContractId: number;
    nhlPlayerId: number;
    playerName: string;
    teamAbbreviation: string | null;
    startSeason: number;
    endSeason: number;
    salary: number;
    protectedSalary: number | null;
    protectionNote: string | null;
}

export function getProtectedSalaries(): Promise<ProtectedSalaryRow[]> {
    return apiGet<ProtectedSalaryRow[]>(
        '/CapFreezeContract/capfreeze/protected-salaries',
    );
}

export function getPlayerContracts(
    nhlPlayerId: number,
): Promise<PlayerContractRow[]> {
    return apiGet<PlayerContractRow[]>(
        `/CapFreezeContract/capfreeze/player-contracts/${nhlPlayerId}`,
        { cacheTtlMs: 0 },
    );
}

export function upsertProtectedSalary(
    playerContractId: number,
    protectedSalary: number,
    protectionNote?: string | null,
): Promise<PlayerContractRow> {
    return apiPost<PlayerContractRow>(
        '/CapFreezeContract/capfreeze/protected-salaries',
        {
            playerContractId,
            protectedSalary,
            protectionNote: protectionNote ?? null,
        },
    );
}

export function deleteProtectedSalary(
    playerContractId: number,
): Promise<{ message: string }> {
    return apiDelete<{ message: string }>(
        `/CapFreezeContract/capfreeze/protected-salaries/${playerContractId}`,
    );
}

// ---------------------------------------------------------------------
// Manual contracts (commissioner only)
//
// A player flagged with skipCapFreezeSync=true is never touched by
// the CapFreeze sync. His contract rows are managed entirely by the
// commissioner through the admin page. Used for players whose
// CapFreeze data cannot be trusted (the two Elias Pettersson
// records are the canonical case).
// ---------------------------------------------------------------------

export interface ManualContractRow {
    playerContractId: number;
    startSeason: number;
    endSeason: number;
    salary: number;
    protectedSalary: number | null;
    protectionNote: string | null;
}

export interface ManualContractPlayerRow {
    playerId: number;
    nhlPlayerId: number;
    firstName: string;
    lastName: string;
    teamAbbreviation: string | null;
    contracts: ManualContractRow[];
}

export function getManualContractPlayers(): Promise<ManualContractPlayerRow[]> {
    return apiGet<ManualContractPlayerRow[]>(
        '/CapFreezeContract/capfreeze/manual-contracts/players',
        { cacheTtlMs: 0 },
    );
}

export function setPlayerSkipCapFreeze(
    nhlPlayerId: number,
    skip: boolean,
): Promise<{ nhlPlayerId: number; skipCapFreezeSync: boolean }> {
    return apiPost<{ nhlPlayerId: number; skipCapFreezeSync: boolean }>(
        '/CapFreezeContract/capfreeze/manual-contracts/set-skip',
        { nhlPlayerId, skip },
    );
}

export interface CreateManualContractRequest {
    nhlPlayerId: number;
    startSeason: number;
    endSeason: number;
    salary: number;
}

export function createManualContract(
    request: CreateManualContractRequest,
): Promise<ManualContractRow> {
    return apiPost<ManualContractRow>(
        '/CapFreezeContract/capfreeze/manual-contracts/contract',
        request,
    );
}

export interface UpdateManualContractRequest {
    startSeason: number;
    endSeason: number;
    salary: number;
}

export function updateManualContract(
    playerContractId: number,
    request: UpdateManualContractRequest,
): Promise<ManualContractRow> {
    return apiPatch<ManualContractRow>(
        `/CapFreezeContract/capfreeze/manual-contracts/contract/${playerContractId}`,
        request,
    );
}

export function deleteManualContract(
    playerContractId: number,
): Promise<{ message: string }> {
    return apiDelete<{ message: string }>(
        `/CapFreezeContract/capfreeze/manual-contracts/contract/${playerContractId}`,
    );
}

// ---------------------------------------------------------------------
// System event logs (commissioner only)
// ---------------------------------------------------------------------

export interface SystemEventLog {
    id: number;
    timestampUtc: string;
    lastSeenUtc: string;
    /** How many identical events have been folded into this row. */
    count: number;
    source: string;
    category: string;
    severity: 'Warning' | 'Error';
    message: string;
    details: string | null;
}

export interface SystemEventLogFilters {
    severity?: 'Warning' | 'Error';
    /** Prefix match on Source, e.g. "ScheduledJob:" */
    source?: string;
    limit?: number;
}

export function getSystemEventLogs(
    filters: SystemEventLogFilters = {},
): Promise<SystemEventLog[]> {
    const params = new URLSearchParams();
    if (filters.severity) params.set('severity', filters.severity);
    if (filters.source) params.set('source', filters.source);
    if (filters.limit != null) params.set('limit', String(filters.limit));

    const query = params.toString();
    const path = query ? `/SystemEventLog?${query}` : '/SystemEventLog';

    // Skip client cache: this is a live diagnostic view.
    return apiGet<SystemEventLog[]>(path, { cacheTtlMs: 0 });
}

export function clearSystemEventLogs(): Promise<{
    message: string;
    removed: number;
}> {
    return apiDelete<{ message: string; removed: number }>(
        '/SystemEventLog',
    );
}

// ---------------------------------------------------------------------
// Game Day
// ---------------------------------------------------------------------

/** One game as shown on the Game Day page's list. */
export interface GameDayGameSummary {
    gameId: number;
    gameDate: string;
    startTimeUtc: string;
    /** FUT, PRE, LIVE, CRIT, FINAL. */
    gameState: string;

    awayAbbreviation: string;
    awayFullName: string;
    awayCommonName: string;
    awayPlaceName: string;
    /** W-L-OTL format, e.g. "10-5-2". Null before the first
     *  daily team stats sync has run. */
    awayRecord: string | null;
    awayArenaName: string | null;
    awayScore: number | null;
    /**
     * Shots on goal for the away team. Populated for games that have
     * a cached boxscore (LIVE, CRIT, FINAL, OFF). Null for FUT/PRE
     * games and for past-date views, where the backend does not
     * fetch one boxscore per game. The card hides the shots row
     * when this is null.
     */
    awayShots: number | null;

    homeAbbreviation: string;
    homeFullName: string;
    homeCommonName: string;
    homePlaceName: string;
    homeRecord: string | null;
    homeArenaName: string | null;
    homeScore: number | null;
    /** Same rule as awayShots. */
    homeShots: number | null;

    periodNumber: number | null;
    periodType: string | null;
    /**
     * Time remaining in the current period, "MM:SS". Populated for
     * live games only; null for scheduled games, final games, and
     * past-date views where no boxscore is cached.
     */
    periodTimeRemaining: string | null;
    /**
     * True when the game is between periods. Null when unknown.
     */
    isIntermission: boolean | null;
    hasBoxscore: boolean;
}

export interface GameDayScheduleResponse {
    lastRefreshUtc: string | null;
    isFresh: boolean;

    /**
     * Current fantasy date in ET, format "yyyy-MM-dd". This is the
     * real ET calendar date, except between 00:00 and 03:00 ET, when
     * it stays on the previous calendar day. It is the single source
     * of truth for the "Aujourd'hui" / "Hier" columns:
     *
     *   - "Aujourd'hui" table = games whose ET start date equals this
     *   - "Hier" table        = games whose ET start date equals this
     *                           minus one day
     *
     * The backend applies the 3 AM cutoff; the frontend never
     * recomputes it in JavaScript.
     */
    currentFantasyDate: string;

    /**
     * Real ET calendar date right now, format "yyyy-MM-dd". No
     * cutoff applied. Use this to detect the 3 AM rollover and for
     * anything that needs the unambiguous ET date.
     */
    currentEtDate: string;

    games: GameDayGameSummary[];
}

/** Named-value pair the NHL uses for player and team names. */
export interface NhlLocalizedName {
    default: string;
}

export interface NhlPeriodDescriptor {
    number: number;
    periodType: string;
}

export interface NhlGameClock {
    /** Time remaining in the current period, formatted "MM:SS". */
    timeRemaining: string;
    secondsRemaining: number;
    running: boolean;
    inIntermission: boolean;
}

export interface NhlSkaterStats {
    playerId: number;
    sweaterNumber: number | null;
    name: NhlLocalizedName;
    position: string;
    goals: number;
    assists: number;
    points: number;
    plusMinus: number;
    pim: number;
    hits: number;
    powerPlayGoals: number;
    shots: number;
    headshot: string | null;
    /**
     * Time on ice in this game, formatted "MM:SS".
     *
     * IMPORTANT: the JSON key is "toi", not "timeOnIce". The backend
     * DTO carries [JsonPropertyName("toi")] because that is the key
     * the NHL boxscore endpoint itself uses, and the same DTO is
     * reused for both deserialization (from the NHL) and
     * serialization (to us). Renaming this field on the C# side
     * would break the incoming NHL payload, so we match the actual
     * wire name here instead.
     */
    toi: string | null;
}

export interface NhlGoalieStats {
    playerId: number;
    sweaterNumber: number | null;
    name: NhlLocalizedName;
    decision: string | null;
    goals: number;
    assists: number;
    points: number;
    goalsAgainst: number;
    shotsAgainst: number;
    saves: number;
    shutouts: number;
    savePctg: number;
    starter: boolean;
    /**
     * Time on ice in this game, formatted "MM:SS".
     *
     * IMPORTANT: the JSON key is "toi", not "timeOnIce". See
     * NhlSkaterStats.toi for the full explanation.
     */
    toi: string | null;
}

export interface NhlTeamPlayerStats {
    forwards: NhlSkaterStats[];
    defense: NhlSkaterStats[];
    goalies: NhlGoalieStats[];
}

export interface NhlBoxscoreTeam {
    id: number;
    abbrev: string;
    score: number;
    sog: number;
}

export interface NhlBoxscoreResponse {
    id: number;
    season: number;
    gameType: number;
    gameDate: string;
    gameState: string;
    /** Live game clock, or null before the game starts. */
    clock: NhlGameClock | null;
    periodDescriptor: NhlPeriodDescriptor | null;
    awayTeam: NhlBoxscoreTeam;
    homeTeam: NhlBoxscoreTeam;
    playerByGameStats: {
        awayTeam: NhlTeamPlayerStats;
        homeTeam: NhlTeamPlayerStats;
    };
}

/**
 * Today's NHL schedule with live scores.
 *
 * Pass refresh = true to force a synchronous live refresh on the
 * backend before it responds. Otherwise the backend serves whatever
 * is in its in-memory cache.
 *
 * Skipped from the response cache on purpose: the backend cache
 * updates every 7 minutes during live games, so a cached client
 * response would go stale silently.
 */
export function getTodayGames(
    refresh = false,
): Promise<GameDayScheduleResponse> {
    const query = refresh ? '?refresh=true' : '';
    return apiGet<GameDayScheduleResponse>(
        `/Games/today${query}`,
        { cacheTtlMs: 0 },
    );
}

/**
 * Full boxscore for a single game, served from the backend's live
 * cache. Never touches the database.
 */
export function getGameBoxscore(
    gameId: number,
): Promise<NhlBoxscoreResponse> {
    return apiGet<NhlBoxscoreResponse>(
        `/Games/${gameId}/boxscore`,
        { cacheTtlMs: 0 },
    );
}

/**
 * Schedule for a specific NHL calendar date (yyyy-MM-dd, ET). Used
 * by the Game Day date picker to show the last 6 days.
 *
 * Cached client-side for 5 minutes. Past days don't change once
 * the games are final, but a small TTL keeps score corrections
 * (which the NHL occasionally issues after the fact) visible
 * without hammering the NHL API.
 */
export function getGamesByDate(
    date: string,
): Promise<GameDayScheduleResponse> {
    return apiGet<GameDayScheduleResponse>(
        `/Games/by-date/${date}`,
        { cacheTtlMs: 5 * 60_000 },
    );
}

// ---------------------------------------------------------------------
// Injuries
// ---------------------------------------------------------------------

export interface InjuryRow {
    playerId: number;
    nhlPlayerId: number;
    firstName: string;
    lastName: string;
    position: string;
    nhlTeamAbbreviation: string | null;
    nhlTeamName: string | null;
    headshotUrl: string | null;

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

    fantasyTeamId: number | null;
    fantasyTeamName: string | null;
    rosterStatus: string | null;
}

export interface InjuryFilters {
    search?: string;
    nhlTeam?: string;
    fantasyTeamId?: number;
    kind?: 'Injury' | 'Suspension';
}

/**
 * Every injured or suspended player, with optional filters. Cached
 * client-side for 30 seconds so rapid filter changes and page
 * navigations don't spam the backend.
 */
export function getInjuries(
    filters: InjuryFilters = {},
): Promise<InjuryRow[]> {
    const params = new URLSearchParams();

    if (filters.search) params.set('search', filters.search);
    if (filters.nhlTeam) params.set('nhlTeam', filters.nhlTeam);
    if (filters.fantasyTeamId != null) {
        params.set('fantasyTeamId', String(filters.fantasyTeamId));
    }
    if (filters.kind) params.set('kind', filters.kind);

    const query = params.toString();
    const path = query ? `/Injuries?${query}` : '/Injuries';

    return apiGet<InjuryRow[]>(path, { cacheTtlMs: 30_000 });
}

// ---------------------------------------------------------------------
// Marketplace
// ---------------------------------------------------------------------

/** One slot inside a marketplace trade offer. */
export interface TradeOfferSlot {
    slotIndex: number;

    /** "F", "D" or "G". */
    positionGroup: string;

    /** Optional player the creator is offering. */
    offeringPlayerId: number | null;

    /**
     * NHL API id of the offered player. Used to link the player's
     * name to /joueurs/{nhlPlayerId}. Null when the slot has no
     * offering player.
     */
    offeringPlayerNhlPlayerId: number | null;

    offeringPlayerFirstName: string | null;
    offeringPlayerLastName: string | null;
    offeringPlayerNhlTeam: string | null;
    offeringPlayerPosition: string | null;

    /**
     * Age in years, computed server-side from the player's birth
     * date. Null when the birth date is unknown. Rendered next to
     * the player's name on the offer card.
     */
    offeringPlayerAge: number | null;

    /**
     * Contract covering the current season for the offered player, or
     * null. Displayed first under the player's name on the browse tab.
     */
    offeringPlayerCurrentContract: PlayerContractLine | null;

    /**
 * Second contract to display, e.g. a future deal, or null. When
 * present, the browse tab renders "current -> second" exactly like
 * the Mon équipe player cards.
 */
    offeringPlayerSecondContract: PlayerContractLine | null;

    /**
     * NHL regular-season stats for the offered player in the current
     * season, or null when no row exists yet. Rendered as a small
     * table under the player's name on the offer card.
     */
    offeringPlayerCurrentSeasonStats: SeasonStatLine | null;

    /**
  * NHL regular-season stats for the offered player in the previous
  * season, or null.
  */
    offeringPlayerLastSeasonStats: SeasonStatLine | null;

    /**
     * Responding player, only present on slots synthesized from a
     * TradeOfferResponse (Reçues / Envoyées panels).
     */
    respondingPlayerId?: number | null;
    respondingPlayerNhlPlayerId?: number | null;
    respondingPlayerFirstName?: string | null;
    respondingPlayerLastName?: string | null;
    respondingPlayerNhlTeam?: string | null;
    respondingPlayerPosition?: string | null;
    respondingPlayerAge?: number | null;
    respondingPlayerCurrentContract?: PlayerContractLine | null;
    respondingPlayerSecondContract?: PlayerContractLine | null;
    respondingPlayerCurrentSeasonStats?: SeasonStatLine | null;
    respondingPlayerLastSeasonStats?: SeasonStatLine | null;
}

/** A published marketplace trade offer. */
export interface TradeOffer {
    id: number;
    createdByFantasyTeamId: number;
    createdByFantasyTeamName: string;

    /**
     * Creator's current cap hit for the season. Null when the
     * backend did not load cap info for this DTO (e.g. a response
     * synthesized on the client side where the creator's cap was
     * not provided).
     */
    createdByFantasyTeamCapSalary: number | null;

    /**
     * Responding team's current cap hit for the season. Only set
     * on shapes synthesized from a TradeOfferResponse; on real
     * browse offers the responder is the connected user, so his
     * cap comes from his own roster on the client.
     */
    respondingFantasyTeamCapSalary?: number | null;

    /**
     * Salary cap for the season this offer belongs to, in dollars.
     * Same value for both teams. 0 when the backend could not
     * resolve the season — the frontend hides the cap line in that
     * case.
     */
    seasonSalaryCap: number;

    createdAt: string;
    note: string | null;

    /** "Active", "Closed" or "Cancelled". */
    status: string;

    /** True when the offer was created by the current user's team. */
    isMine: boolean;

    /**
     * True when the caller has never loaded this offer in the browse
     * tab before. Drives the green "Nouvelle offre" badge on the
     * frontend.
     */
    isNew: boolean;

    /**
  * Responding team, only set on shapes synthesized from a
  * TradeOfferResponse. When present, the card header renders this
  * team name in the right column instead of the connected user.
  */
    respondingFantasyTeamId?: number;
    respondingFantasyTeamName?: string;

    slots: TradeOfferSlot[];

    /**
   * Draft picks the offer's creator is putting on the table.
   * Referenced, not transferred. Empty when the offer carries no
   * picks. Ordered by year, then round.
   */
    picks: DraftPick[];

    /**
     * Extra picks the responding team asked the creator to give,
     * on top of `picks`. Only populated on shapes synthesized from
     * a TradeOfferResponse (Reçues / Envoyées panels). Undefined on
     * real TradeOffers, where the responder's request comes from
     * the local draft store.
     */
    requestedPicks?: DraftPick[];

    /**
     * Draft picks the responding team is putting on the table. Only
     * populated on shapes synthesized from a TradeOfferResponse
     * (Reçues / Envoyées panels). Undefined on real TradeOffers, where
     * the responder's picks come from the local draft store.
     */
    respondingPicks?: DraftPick[];
}

/** One slot of a create-trade-offer request. */
export interface CreateTradeOfferSlotRequest {
    /** "F", "D" or "G". */
    positionGroup: string;
    offeringPlayerId?: number | null;
}

/** Body of POST /api/Marketplace/offers. */
export interface CreateTradeOfferRequest {
    slots: CreateTradeOfferSlotRequest[];
    note?: string | null;
    /**
     * Ids of the creator's draft picks being offered. Each id must
     * reference a DraftPick owned by the creator's team. Referenced,
     * not transferred. Replaces the offer's pick list on an update.
     */
    draftPickIds?: number[];
}

/**
 * Publishes a new trade offer for the current user's team. The backend
 * resolves the team from the authenticated user; the client never sends it.
 */
export function createTradeOffer(
    request: CreateTradeOfferRequest,
): Promise<TradeOffer> {
    return apiPost<TradeOffer>('/Marketplace/offers', request);
}

/**
 * Updates an existing marketplace offer owned by the calling user's
 * team. Same payload shape as createTradeOffer: the backend replaces
 * every slot and the note in place. The offer's Id, CreatedAt, and
 * every per-user "seen" marker are preserved, so it keeps its place
 * on the browse list and does not pop up as "Nouvelle offre" again.
 *
 * The backend refuses the update if the offer has any Pending or
 * Accepted response.
 */
export function updateTradeOffer(
    offerId: number,
    request: CreateTradeOfferRequest,
): Promise<TradeOffer> {
    return apiPut<TradeOffer>(
        `/Marketplace/offers/${offerId}`,
        request,
    );
}

/**
 * Lists active trade offers. By default, offers from the current user's
 * own team are excluded, so the browse tab only shows what other
 * managers are looking for.
 *
 * Read-only: this call never marks anything as seen. The frontend
 * explicitly calls markOffersSeen() a couple of seconds after the list
 * has been shown.
 */
export function listTradeOffers(
    includeMine = false,
): Promise<TradeOffer[]> {
    const query = includeMine ? '?includeMine=true' : '';
    return apiGet<TradeOffer[]>(
        `/Marketplace/offers${query}`,
        { cacheTtlMs: 0 },
    );
}

/**
 * Records that the current user has seen the given offers. Fire-and-
 * forget: the browse tab schedules this a couple of seconds after the
 * list has been rendered, so a StrictMode double-mount never has time
 * to consume the "new" state.
 */
export function markOffersSeen(
    offerIds: number[],
): Promise<{ inserted: number }> {
    return apiPost<{ inserted: number }>(
        '/Marketplace/offers/mark-seen',
        { offerIds },
    );
}

/**
 * Records that the current user has seen the given received
 * responses on his Reçues tab. Fire-and-forget, same convention
 * as markOffersSeen: the tab schedules this a couple of seconds
 * after the list has been rendered.
 */
export function markResponsesSeen(
    responseIds: number[],
): Promise<{ inserted: number }> {
    return apiPost<{ inserted: number }>(
        '/Marketplace/responses/mark-seen',
        { responseIds },
    );
}

/**
 * Navbar notification badge payload. `total` is what the badge
 * renders: unseen browse offers + unseen received responses for
 * the connected user.
 *
 * Fetched with cacheTtlMs 0 so the polling loop always hits the
 * API and never serves a stale cached count.
 */
export interface MarketplaceNotificationCount {
    /** Green: new or modified offers in "Voir les offres". */
    unseenOffers: number;

    /** Gold: new pending responses on the user's own offers. */
    unseenResponses: number;

    /** Gold: responses the user sent that have been accepted. */
    unseenAcceptedSentResponses: number;

    /**
     * Total rows the Reçues panel renders: Pending + Accepted
     * responses on the user's own still-active offers. Persistent
     * — not reduced when the user marks responses as seen. Drives
     * the "Reçues" segmented button label.
     */
    totalReceivedResponses: number;

    /**
     * Total rows the Envoyées panel renders: Pending + Accepted
     * responses the user's team sent to still-active offers. Same
     * persistence rule as totalReceivedResponses. Drives the
     * "Envoyées" segmented button label.
     */
    totalSentResponses: number;

    /** Combined unseen count. This is what the navbar badge renders. */
    total: number;
}

export function getMarketplaceNotifications(): Promise<MarketplaceNotificationCount> {
    return apiGet<MarketplaceNotificationCount>(
        '/Marketplace/notifications/count',
        { cacheTtlMs: 0 },
    );
}

/** Cancels one of the current user's own active offers. */
export function cancelTradeOffer(
    id: number,
): Promise<{ message: string }> {
    return apiDelete<{ message: string }>(
        `/Marketplace/offers/${id}`,
    );
}

// ---------------------------------------------------------------------
// Marketplace responses ("Offres reçues")
// ---------------------------------------------------------------------

/**
 * One pick in a response: for the offer slot at slotIndex, the
 * responding team offers respondingPlayerId.
 *
 * `respondingPlayerId` is nullable to support unbalanced direct
 * offers (a slot where the responder gives no player).
 *
 * `offeringPlayerOverrideId`, when set, replaces the offering
 * player the offer creator originally put on this slot, or adds
 * one if the creator left the offering side empty.
 */
export interface RespondToTradeOfferPick {
    slotIndex: number;
    respondingPlayerId: number | null;
    offeringPlayerOverrideId?: number | null;
    /**
     * When true, the responder is explicitly removing the offering
     * player from this slot: even if the offer's creator had put
     * someone there, the response says "leave this slot empty on
     * the offering side". Mutually exclusive with
     * offeringPlayerOverrideId.
     */
    removeOfferingPlayer?: boolean;
}

export interface RespondToTradeOfferRequest {
    picks: RespondToTradeOfferPick[];
    /**
     * Optional free-text message from the responding manager.
     * A response may be sent with this Note as its only content
     * (no players, no picks), so a manager can send a message like
     * "what would you offer for this player?" without committing
     * to a full trade shape.
     */
    note?: string | null;
    /**
     * Ids of the responding team's draft picks being offered. Each
     * id must reference a DraftPick owned by the responding team.
     * Referenced, not transferred.
     */
    draftPickIds?: number[];
    /**
     * Ids of the offer CREATOR's draft picks the responding team
     * is requesting on top of whatever the offer already carries.
     * Each id must reference a DraftPick owned by the offer's
     * creator. Referenced, not transferred.
     */
    requestedDraftPickIds?: number[];
    /**
     * Ids of the offer CREATOR's draft picks the responding team
     * is REMOVING from the offer's own pick list. Each id must
     * reference a DraftPick already offered on the original
     * TradeOffer. Referenced, not transferred.
     */
    removedCreatorDraftPickIds?: number[];
}

/** One slot of a received response. Mirrors TradeOfferResponseSlotDto. */
export interface TradeOfferResponseSlot {
    slotIndex: number;
    positionGroup: string;

    // --- LEFT: the offering player from the original offer ---

    /**
     * True when the responder explicitly emptied the offering side
     * of this slot. When true, all offeringPlayer* fields are null
     * by design.
     */
    removeOfferingPlayer: boolean;

    offeringPlayerId: number | null;
    offeringPlayerNhlPlayerId: number | null;
    offeringPlayerFirstName: string | null;
    offeringPlayerLastName: string | null;
    offeringPlayerNhlTeam: string | null;
    offeringPlayerPosition: string | null;
    offeringPlayerAge: number | null;
    offeringPlayerCurrentContract: PlayerContractLine | null;
    offeringPlayerSecondContract: PlayerContractLine | null;
    offeringPlayerCurrentSeasonStats: SeasonStatLine | null;
    offeringPlayerLastSeasonStats: SeasonStatLine | null;

    // --- RIGHT: the responding player ---

    /**
     * The responding player for this slot, or null when the
     * responding team is not giving a player for it. Null only
     * happens on unbalanced direct offers where the target side
     * gave a player but the connected side did not.
     */
    respondingPlayerId: number | null;

    /**
     * NHL API id of the responding player. Used to link the
     * player's name to /joueurs/{nhlPlayerId}.
     */
    respondingPlayerNhlPlayerId: number | null;

    respondingPlayerFirstName: string | null;
    respondingPlayerLastName: string | null;
    respondingPlayerNhlTeam: string | null;
    respondingPlayerPosition: string | null;
    respondingPlayerAge: number | null;
    respondingPlayerCurrentContract: PlayerContractLine | null;
    respondingPlayerSecondContract: PlayerContractLine | null;

    /**
     * NHL regular-season stats for the responding player in the
     * current season, or null. Mirrors the offering side.
     */
    respondingPlayerCurrentSeasonStats: SeasonStatLine | null;

    /**
     * NHL regular-season stats for the responding player in the
     * previous season, or null.
     */
    respondingPlayerLastSeasonStats: SeasonStatLine | null;
}

/**
 * A response to a TradeOffer. Serves both sides of the exchange:
 *
 *   - "Offres reçues"   uses `respondingFantasyTeamName` as the
 *                       card header (who answered my offer).
 *   - "Offres envoyées" uses `tradeOfferCreatedByFantasyTeamName`
 *                       as the card header (whose offer I answered).
 */
export interface TradeOfferResponse {
    id: number;
    tradeOfferId: number;
    tradeOfferNote: string | null;

    /**
     * Optional free-text message from the responding manager.
     * Distinct from `tradeOfferNote`, which is the message the
     * offer's creator wrote when he published the offer. This is
     * the message that shows on the Reçues and Envoyées cards.
     */
    note: string | null;

    /**
     * True when this response is still Pending and the current
     * user has never loaded the Reçues panel with this response
     * in view. Drives the "Nouvelle offre" badge on the Reçues
     * card and the navbar notification count.
     */
    isNew: boolean;

    tradeOfferCreatedByFantasyTeamId: number;
    tradeOfferCreatedByFantasyTeamName: string;

    /**
     * Creator's cap hit for the season. Null when the backend did
     * not load cap info.
     */
    tradeOfferCreatedByFantasyTeamCapSalary: number | null;

    respondingFantasyTeamId: number;
    respondingFantasyTeamName: string;

    /**
     * Responding team's cap hit for the season. Null when the
     * backend did not load cap info.
     */
    respondingFantasyTeamCapSalary: number | null;

    /**
     * Salary cap for the season this response belongs to. 0 when
     * the backend could not resolve the season — the frontend hides
     * the cap line in that case.
     */
    seasonSalaryCap: number;

    createdAt: string;
    status: string;
    slots: TradeOfferResponseSlot[];

    /**
 * Draft picks the original offer's creator is putting on the
 * table. Rendered on the LEFT side of the response card.
 * Referenced, not transferred.
 */
    creatorPicks: DraftPick[];

    /**
     * Extra draft picks the responding team asked the offer's
     * creator to give on top of `creatorPicks`. Same side of the
     * card (creator's column), same rules. Referenced, not
     * transferred.
     */
    requestedPicks: DraftPick[];

    /**
     * Draft picks the responding team is putting on the table.
     * Rendered on the RIGHT side of the response card. Referenced,
     * not transferred.
     */
    respondingPicks: DraftPick[];

    /**
     * Draft picks the responding team removed from the offer's own
     * pick list. Already excluded from `creatorPicks` on the
     * response DTO; kept here so the frontend can display what was
     * removed. Referenced, not transferred.
     */
    removedCreatorPicks: DraftPick[];
}

/** Result of POST /Marketplace/offers/{id}/respond. */
export interface RespondToTradeOfferResult {
    success: boolean;
    message: string;
    response: TradeOfferResponse | null;
}

/**
 * Records a response to another manager's offer. Every slot of the
 * offer must be filled with a player from the calling user's roster
 * matching the slot's demanded position group.
 */
export function respondToTradeOffer(
    offerId: number,
    request: RespondToTradeOfferRequest,
): Promise<RespondToTradeOfferResult> {
    return apiPost<RespondToTradeOfferResult>(
        `/Marketplace/offers/${offerId}/respond`,
        request,
    );
}

// ---------------------------------------------------------------------
// Direct offers ("Créer" tab)
//
// A direct offer is a fully-specified trade proposal built by one
// manager and sent straight to another, without going through the
// public marketplace. The backend records it as a TradeOffer owned
// by the TARGET team plus a TradeOfferResponse from the CONNECTED
// team, so it lands in the target's "Reçues" (actionable) and in
// the connected user's "Envoyées" (cancellable).
// ---------------------------------------------------------------------

/**
 * One slot inside a direct offer. Each slot can carry a player
 * on both sides, only on the connected side, or only on the
 * target side. Unbalanced slots let the two managers agree on a
 * trade where one side gives more players than the other.
 *
 * At least one of connectedPlayerId / targetPlayerId must be
 * set. A slot that is null on both sides is rejected by the
 * backend.
 *
 * A direct offer can also carry zero slots if it only exchanges
 * draft picks.
 */
export interface CreateDirectOfferSlotRequest {
    /** Player on the calling user's roster (what he offers). */
    connectedPlayerId?: number | null;

    /** Player on the target team's roster (what he wants). */
    targetPlayerId?: number | null;
}

/** Body of POST /api/Marketplace/direct-offers. */
export interface CreateDirectOfferRequest {
    targetTeamId: number;
    slots: CreateDirectOfferSlotRequest[];
    note?: string | null;
    /**
     * Ids of the calling user's draft picks being offered. Must be
     * owned by the calling user's team.
     */
    connectedDraftPickIds?: number[];
    /**
     * Ids of the target team's draft picks the calling user wants
     * back. Must be owned by the target team.
     */
    targetDraftPickIds?: number[];
}

/**
 * Sends a direct trade offer from the calling user's team to the
 * given target team. Returns the same result shape as
 * `respondToTradeOffer`, since the backend creates a response in
 * the same transaction.
 */
export function createDirectOffer(
    request: CreateDirectOfferRequest,
): Promise<RespondToTradeOfferResult> {
    return apiPost<RespondToTradeOfferResult>(
        '/Marketplace/direct-offers',
        request,
    );
}

/**
 * Lists every Pending response to a still-active offer that the
 * calling user created. This is the "Offres reçues" section.
 */
export function listReceivedResponses(): Promise<TradeOfferResponse[]> {
    return apiGet<TradeOfferResponse[]>(
        '/Marketplace/responses',
        { cacheTtlMs: 0 },
    );
}

/**
 * Lists every Pending response the calling user's team has sent to
 * someone else's still-active offer. This is the "Offres envoyées"
 * section.
 */
export function listSentResponses(): Promise<TradeOfferResponse[]> {
    return apiGet<TradeOfferResponse[]>(
        '/Marketplace/responses/sent',
        { cacheTtlMs: 0 },
    );
}

/**
 * Accepts a Pending response to one of the calling user's own offers.
 * Pure state change on the response row: no player movement, no
 * roster mutation. Both sides of the exchange see the "ACCEPTÉE"
 * badge on their panel.
 */
export function acceptTradeOfferResponse(
    responseId: number,
): Promise<{ message: string }> {
    return apiPost<{ message: string }>(
        `/Marketplace/responses/${responseId}/accept`,
        {},
    );
}

/**
 * Cancels a Pending response that the calling user's team sent to
 * someone else's offer. The original offer stays Active — the
 * response is simply withdrawn.
 */
export function cancelTradeOfferResponse(
    responseId: number,
): Promise<{ message: string }> {
    return apiPost<{ message: string }>(
        `/Marketplace/responses/${responseId}/cancel`,
        {},
    );
}

/**
 * Refuses a Pending response to one of the calling user's own
 * offers. Deletes the entire TradeOffer, which cascades to every
 * response and every "seen" marker tied to it. The offer is
 * withdrawn on both sides of the exchange.
 */
export function rejectTradeOfferResponse(
    responseId: number,
): Promise<{ message: string }> {
    return apiPost<{ message: string }>(
        `/Marketplace/responses/${responseId}/reject`,
        {},
    );
}

// ---------------------------------------------------------------------
// Admin: accepted trades awaiting manual player swaps
// (commissioner only)
// ---------------------------------------------------------------------

/** One slot of an accepted trade, as returned by the admin endpoint. */
export interface AcceptedTradeSlot {
    slotIndex: number;
    /** "F", "D" or "G". */
    positionGroup: string;

    // --- Side offered by the original offer creator ---
    offeringPlayerId: number | null;
    offeringPlayerNhlPlayerId: number | null;
    offeringPlayerFirstName: string | null;
    offeringPlayerLastName: string | null;
    offeringPlayerNhlTeam: string | null;

    // --- Side offered by the responding team ---
    /**
     * Null on unbalanced direct offers where the responding team
     * did not give a player for this slot.
     */
    respondingPlayerId: number | null;
    respondingPlayerNhlPlayerId: number | null;
    respondingPlayerFirstName: string | null;
    respondingPlayerLastName: string | null;
    respondingPlayerNhlTeam: string | null;
}

/** One accepted response, as returned by the admin endpoint. */
export interface AcceptedTradeRow {
    responseId: number;
    tradeOfferId: number;
    offerCreatorTeamId: number;
    offerCreatorTeamName: string;
    respondingTeamId: number;
    respondingTeamName: string;
    createdAt: string;
    note: string | null;
    slots: AcceptedTradeSlot[];
    /**
     * Draft picks the offer creator is giving away, from the
     * original offer.
     */
    offerCreatorPicks: DraftPick[];
    /**
     * Extra draft picks the offer creator is giving away, requested
     * by the responding team on top of the offer's own picks.
     */
    requestedPicks: DraftPick[];
    /**
   * Draft picks the responding team is giving away.
   */
    respondingPicks: DraftPick[];

    /**
     * Draft picks the responding team removed from the offer's own
     * pick list. Already excluded from `offerCreatorPicks` on the
     * admin card; kept here so the admin can display what was
     * removed.
     */
    removedCreatorPicks: DraftPick[];
}

/**
 * Lists every accepted response across the league, newest first.
 * Commissioner-only. Skips the client cache so the list is always
 * current when the admin opens the section.
 */
export function getAcceptedTrades(): Promise<AcceptedTradeRow[]> {
    return apiGet<AcceptedTradeRow[]>(
        '/Marketplace/admin/accepted-trades',
        { cacheTtlMs: 0 },
    );
}

/**
 * Deletes the TradeOffer that owns the given accepted response.
 * Cascades to every response and every "seen" marker tied to it.
 * Commissioner-only.
 */
export function deleteAcceptedTrade(
    responseId: number,
): Promise<{ message: string }> {
    return apiDelete<{ message: string }>(
        `/Marketplace/admin/accepted-trades/${responseId}`,
    );
}

// ---------------------------------------------------------------------
// Background jobs (commissioner only)
// ---------------------------------------------------------------------

export interface BackgroundJobStatus {
    id: string;
    name: string;
    /** "Running", "Completed" or "Failed". */
    status: string;
    startedAt: string;
    completedAt: string | null;
    error: string | null;
    message: string | null;
    progressCurrent: number;
    progressTotal: number;
    result: unknown;
}

export interface StartJobResponse {
    jobId: string;
    name: string;
    startedAt: string;
    message: string;
}

/**
 * Starts the "refresh every player's game logs for the season"
 * background job. Re-downloads the full game log for every player,
 * upserts PlayerGameLog rows, and recomputes PlayerSeasonStat.
 *
 * Used by the admin page for backfilling columns after they are
 * added (e.g. TimeOnIce).
 *
 * RATE LIMIT — do not lower this default.
 *
 * The backend job makes TWO HTTP calls to the NHL API per player:
 *   1. landing page (Player + PlayerCareerStat + PlayerSeasonStat
 *      landing-owned columns),
 *   2. game-log endpoint.
 *
 * The `delayMsBetweenPlayers` pause runs AFTER those two calls,
 * so the effective NHL-side rate is 2 requests per
 * delayMsBetweenPlayers milliseconds. The NHL tolerates about one
 * request every 500 ms (2 req/sec); anything faster returns 429
 * Too Many Requests and those players silently fail to refresh.
 *
 *   500 ms  -> 4 req/sec  -> trips 429s
 *   1000 ms -> 2 req/sec  -> safe (500 ms per request, average)
 *
 * If the NHL tightens its rate limit, raise this to 1500 or 2000.
 * Do not lower it without checking the math above.
 */
export function startRefreshAllGameLogs(
    seasonCode = 20262027,
    delayMsBetweenPlayers = 1000,
): Promise<StartJobResponse> {
    const params = new URLSearchParams();
    params.set('seasonCode', String(seasonCode));
    params.set(
        'delayMsBetweenPlayers',
        String(delayMsBetweenPlayers),
    );

    return apiPost<StartJobResponse>(
        `/Jobs/refresh-all/start?${params.toString()}`,
        {},
    );
}

/**
 * Returns the current state of a background job. Skips the client
 * cache so the progress numbers are always fresh.
 */
export function getJobStatus(
    jobId: string,
): Promise<BackgroundJobStatus> {
    return apiGet<BackgroundJobStatus>(`/Jobs/${jobId}`, {
        cacheTtlMs: 0,
    });
}

// ---------------------------------------------------------------------
// Manual single-player NHL landing refresh (commissioner only)
//
// Forces an immediate refresh of one player's data from his NHL
// landing page: identity, team, draft, bio, headshot, career
// stats, and the landing-owned columns of his current-season
// PlayerSeasonStat. One NHL API call per invocation.
// ---------------------------------------------------------------------

export interface RefreshedPlayer {
    id: number;
    nhlPlayerId: number;
    firstName: string;
    lastName: string;
    position: string;
    headshotUrl: string | null;
    nhlTeamId: number | null;
    previousNhlTeamId: number | null;
}

export function refreshSinglePlayer(
    nhlPlayerId: number,
): Promise<RefreshedPlayer> {
    return apiPost<RefreshedPlayer>(
        `/NhlPlayer/player/${nhlPlayerId}/refresh`,
        {},
    );
}
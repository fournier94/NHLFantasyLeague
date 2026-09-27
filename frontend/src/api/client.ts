// One small place that knows how to talk to our API.
// '/api' is a RELATIVE url: the Vite dev proxy (vite.config.ts) forwards it to
// the ASP.NET backend, so the browser never triggers a CORS check.
const API_BASE = '/api';

async function apiGet<T>(path: string): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`);
    if (!response.ok) {
        throw new Error(`Erreur API ${response.status} sur ${path}`);
    }
    return (await response.json()) as T;
}

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

/** One NHL season of statistics shown on a player card. */
export interface SeasonStatLine {
    label: string;
    nhlSeasonCode: number;
    /** League the stats were recorded in ("NHL", "AHL", "SHL", ...). */
    leagueAbbreviation: string;
    /** Team name, or null when unknown. */
    teamName: string | null;
    /** 2 = regular season, 3 = playoffs. */
    gameTypeId: number;
    gamesPlayed: number;
    goals: number;
    assists: number;
    points: number;
    wins: number;
    losses: number;
    overtimeLosses: number;
}

/** One contract line on a player card: salary + seasons left. */
export interface PlayerContractLine {
    /** Salary in dollars. */
    salary: number;
    /** Number of seasons left on the contract, from the displayed season. */
    yearsRemaining: number;
    /** First season code of the contract (e.g. 20252026). */
    startSeason: number;
    /** Last season code of the contract (e.g. 20282029). */
    endSeason: number;
}

/** Committed cap hit for one future season. */
export interface SeasonCap {
    nhlSeasonCode: number;
    /** Short label, e.g. "27-28". */
    label: string;
    /** Sum of the Active + Bench players' salaries for this season, in dollars. */
    capSalary: number;
    /** Salary cap that applies to this season, in dollars. */
    salaryCap: number;
    /** Number of Active + Bench players with a contract covering this season. */
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
    /** Contract covering the displayed season, or null. */
    currentContract: PlayerContractLine | null;
    /** Second contract to display (e.g. a future deal), or null. */
    secondContract: PlayerContractLine | null;

    /** True when ESPN currently lists the player as injured or suspended. */
    isInjured: boolean;
    /** Raw ESPN status ("Out", "Day-To-Day", "Injured Reserve", "Suspension"), or null. */
    injuryStatus: string | null;
    /** "None", "Injury" or "Suspension" — used to pick the right icon. */
    injuryKind: 'None' | 'Injury' | 'Suspension';
    /** Short injury note, used almost everywhere. */
    injuryShortDescription: string | null;
    /** Long injury note, used on the injuries page and player page. */
    injuryLongDescription: string | null;
}

/** Full roster of one fantasy team for one season. */
export interface TeamRoster {
    fantasyTeamId: number;
    fantasyTeamName: string;
    seasonId: number;
    seasonName: string;
    /** Maximum number of players per fantasy team (active + bench + prospects). */
    leagueMaximumRosterSize: number;
    /** Number of prospects per fantasy team. */
    leagueProspectCount: number;
    totalPlayers: number;
    activeCount: number;
    benchCount: number;
    prospectCount: number;
    totalSalary: number;
    /**
     * Cap hit: sum of the fantasy salaries of the Active and Bench entries.
     * Prospects are excluded.
     */
    capSalary: number;
    /**
     * Committed cap hit for the current season and the next four, based on
     * the contracts already in the system. Prospects are excluded.
     */
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
    /** Roster entry id for the current season, or null when the player is a free agent. */
    rosterEntryId?: number | null;
    /** "Active", "Bench" or "Prospect" for the current season, or null when free agent. */
    rosterStatus?: string | null;
}

/** Request body of POST /api/Roster/assign (the salary is derived server-side). */
export interface AssignPlayerRequest {
    fantasyTeamId: number;
    playerId: number;
    /** Must be exactly 'Active', 'Bench' or 'Prospect'. */
    rosterStatus: string;
}

/** Result of a roster write endpoint: success flag + readable message. */
export interface RosterActionResult {
    success: boolean;
    message: string;
    entry?: unknown;
}

/**
 * Like apiGet, but for POST requests: sends JSON and unwraps the JSON reply.
 * On failure it prefers the API's own message so the UI can display it.
 */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        // Read the API's own message ({ message }) or the ASP.NET ProblemDetails
        // ({ detail }) so the caller can display it directly.
        let message: string | undefined;
        try {
            const payload = (await response.json()) as { message?: string; detail?: string };
            message = payload.message ?? payload.detail;
        } catch {
            // Body was not JSON - fall through to the generic message.
        }
        throw new Error(message ?? `Erreur API ${response.status}`);
    }

    return (await response.json()) as T;
}

/** Searches players by name; the endpoint is a GET even though it is a search. */
export function searchPlayers(query: string): Promise<PlayerSearchResult[]> {
    return apiGet<PlayerSearchResult[]>(`/Roster/search?search=${encodeURIComponent(query)}`);
}

/** Assigns a player to a fantasy team; rosterStatus must be 'Active', 'Bench' or 'Prospect'. */
export function assignPlayer(request: AssignPlayerRequest): Promise<RosterActionResult> {
    return apiPost<RosterActionResult>('/Roster/assign', request);
}

// Salary and season fields are deliberately absent from these requests:
// the salary always comes from PlayerContracts server-side, and omitting
// seasonId makes the API use the current season.

/** Request body of POST /api/Roster/move. */
export interface MovePlayerRequest {
    playerId: number;
    newFantasyTeamId: number;
}

/** Request body of POST /api/Roster/update (team + status can change together). */
export interface UpdateRosterEntryRequest {
    rosterEntryId: number;
    rosterStatus: string;
    /** When provided, the player is also transferred to this fantasy team. */
    fantasyTeamId?: number;
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
// Player detail (GET /api/NhlPlayerDetail/{nhlPlayerId})
// ---------------------------------------------------------------------

/** One row of the career table on the player detail page. */
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

    // Skater extras
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

    // Goalie extras
    wins: number;
    losses: number;
    overtimeLosses: number;
    shutouts: number;
    saves: number;
    shotsAgainst: number;
    savePercentage: number;
    goalsAgainst: number;
    goalsAgainstAverage: number;
}

/** NHL totals block at the bottom of the career table. */
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

    /** Save percentage across NHL regular-season games, computed server-side. */
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

/** One quarter of the regular season, computed from the league schedule. */
export interface Quarter {
    /** "Q1", "Q2", "Q3" or "Q4". */
    label: string;
    /** First day of the quarter, ISO date. */
    startDate: string;
    /** Last day of the quarter, ISO date (inclusive). */
    endDate: string;

    gamesPlayed: number;

    // Skater fields
    goals: number;
    assists: number;
    points: number;
    penaltyMinutes: number;
    plusMinus: number;
    shots: number;

    // Goalie fields
    wins: number;
    losses: number;
    overtimeLosses: number;
    shutouts: number;
    saves: number;
    shotsAgainst: number;
    goalsAgainst: number;

    fantasyPoints: number;
}

/** One injury spell from PlayerInjuryHistory. */
export interface InjuryHistoryRow {
    injuryStatus: string;
    injuryDescription: string | null;
    teamAbbreviation: string;
    firstSeenAt: string;
    lastSeenAt: string;
    resolvedAt: string | null;
}

/** One contract of the player. */
export interface PlayerContract {
    salary: number;
    startSeason: number;
    endSeason: number;
    yearsRemaining: number;
}

/** Full payload of GET /api/NhlPlayerDetail/{nhlPlayerId}. */
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
    injuryUpdatedAt: string | null;
    injuryHistory: InjuryHistoryRow[];

    contracts: PlayerContract[];
    currentCapHit: number | null;

    fantasyTeamName: string | null;
    rosterStatus: string | null;
    rosterSlot: number | null;
    fantasySalary: number | null;
    seasonFantasyPoints: number | null;
    seasonHatTricks: number | null;

    regularSeason: CareerRow[];
    playoffs: CareerRow[];
    nhlTotals: CareerTotals;
    tournaments: CareerRow[];
    youthMinor: CareerRow[];

    recentGames: GameLogRow[];
    /** Four rows, one per calendar quarter of the regular season. */
    seasonQuarters: Quarter[];
}

/** Fetches everything the player detail page needs, by NHL player id. */
export const getPlayerDetail = (nhlPlayerId: number) =>
    apiGet<PlayerDetail>(`/NhlPlayerDetail/${nhlPlayerId}`);
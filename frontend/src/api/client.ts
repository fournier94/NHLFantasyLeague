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
  gamesPlayed: number;
  goals: number;
  assists: number;
  points: number;
  wins: number;
  losses: number;
  overtimeLosses: number;
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
  lastSeason: SeasonStatLine | null;
  currentSeason: SeasonStatLine | null;
}

/** Full roster of one fantasy team for one season. */
export interface TeamRoster {
  fantasyTeamId: number;
  fantasyTeamName: string;
  seasonId: number;
  seasonName: string;
  totalPlayers: number;
  activeCount: number;
  benchCount: number;
  prospectCount: number;
  totalSalary: number;
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

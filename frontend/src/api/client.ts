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
